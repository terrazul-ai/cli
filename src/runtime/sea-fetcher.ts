import { createHash } from 'node:crypto';
import { createWriteStream, constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { lt, rcompare, valid } from 'semver';

import {
  SEA_TARGETS,
  archiveNameForTarget,
  binaryNameFromArchive,
  resolveSeaTarget,
} from './targets';
import { seaManifestSchema, type SeaManifest, type SeaManifestTarget } from '../types/sea-manifest';
import { decompressZst } from '../utils/compression';
import { runCommand } from '../utils/proc';

import type { ReadableStream as WebReadableStream } from 'node:stream/web';

const DEFAULT_CACHE_ROOT = path.join(os.homedir(), '.terrazul', 'cache', 'sea');
const DEFAULT_RETRIES = 3;
const RETRY_BASE_MS = 250;

export interface EnsureSeaBinaryOptions {
  cliVersion?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  manifestPath?: string;
  manifest?: SeaManifest;
  cacheDir?: string;
  baseUrlOverride?: string;
  env?: NodeJS.ProcessEnv;
  retries?: number;
}

function defaultManifestPath(): string {
  // eslint-disable-next-line unicorn/prefer-module
  return path.join(__dirname, '..', 'manifest.json');
}

async function loadManifest(manifestPath: string): Promise<SeaManifest> {
  const contents = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(contents);
  return seaManifestSchema.parse(parsed);
}

function computeDownloadUrl(
  entry: SeaManifestTarget,
  baseOverride?: string,
): { url: string; artifactName: string } {
  const originalUrl = entry.url;
  const artifactName = path.posix.basename(originalUrl);
  if (!baseOverride) {
    return { url: originalUrl, artifactName };
  }
  const trimmed = baseOverride.replace(/\/?$/, '');
  return { url: `${trimmed}/${artifactName}`, artifactName };
}

async function downloadWithRetries(
  url: string,
  destination: string,
  expectedSize: number,
  retries: number,
): Promise<void> {
  let attempt = 0;
  let lastError: unknown;
  await fs.mkdir(path.dirname(destination), { recursive: true });

  while (attempt < retries) {
    attempt += 1;
    try {
      await downloadOnce(url, destination);
      const stats = await fs.stat(destination);
      if (expectedSize > 0 && stats.size !== expectedSize) {
        throw new Error(
          `Downloaded size ${stats.size} does not match manifest size ${expectedSize} for ${url}`,
        );
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
      await delay(backoff);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to download ${url}: ${String(lastError)}`);
}

async function downloadOnce(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  // eslint-disable-next-line n/no-unsupported-features/node-builtins
  const nodeStream = Readable.fromWeb(response.body as unknown as WebReadableStream);
  const writeStream = createWriteStream(destination, { mode: 0o600 });
  try {
    await pipeline(nodeStream, writeStream);
  } catch (error) {
    writeStream.destroy();
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const fileHandle = await fs.open(filePath, fsConstants.O_RDONLY);
  try {
    const stream = fileHandle.createReadStream();
    return await new Promise<string>((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  } finally {
    await fileHandle.close();
  }
}

async function ensureDirectoryExists(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function moveFileAtomic(source: string, destination: string) {
  await fs.rm(destination, { force: true }).catch(() => {});
  await fs.rename(source, destination);
}

async function setExecutablePermissions(filePath: string, platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return;
  }
  await fs.chmod(filePath, 0o755);
}

async function signBinaryMacOS(filePath: string): Promise<void> {
  const result = await runCommand('codesign', ['--sign', '-', '--force', filePath]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to sign binary: ${result.stderr || result.stdout}`);
  }
}

async function ensureBinarySigned(filePath: string, platform: NodeJS.Platform): Promise<void> {
  if (platform !== 'darwin') {
    return;
  }
  await signBinaryMacOS(filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findFallbackBinary(
  cacheRoot: string,
  target: string,
  currentVersion: string,
  binaryName: string,
): Promise<string | null> {
  try {
    const versionEntries = await fs.readdir(cacheRoot, { withFileTypes: true });
    const candidates = versionEntries
      .filter((entry) => entry.isDirectory() && valid(entry.name))
      .map((entry) => entry.name)
      .filter((version) => version !== currentVersion)
      .sort(rcompare);

    for (const version of candidates) {
      if (lt(version, currentVersion) || !valid(currentVersion)) {
        const candidatePath = path.join(cacheRoot, version, target, binaryName);
        if (await fileExists(candidatePath)) {
          return candidatePath;
        }
      }
    }
  } catch (error) {
    void error;
  }

  return null;
}

function resolveCacheRoot(options: EnsureSeaBinaryOptions, env: NodeJS.ProcessEnv): string {
  return path.resolve(options.cacheDir ?? env.TERRAZUL_SEA_CACHE_DIR ?? DEFAULT_CACHE_ROOT);
}

function resolveManifestLocation(options: EnsureSeaBinaryOptions, env: NodeJS.ProcessEnv): string {
  return path.resolve(options.manifestPath ?? env.TERRAZUL_SEA_MANIFEST ?? defaultManifestPath());
}

export async function ensureSeaBinary(options: EnsureSeaBinaryOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = resolveSeaTarget(platform, arch);

  const manifest = options.manifest ?? (await loadManifest(resolveManifestLocation(options, env)));
  const cliVersion = options.cliVersion ?? manifest.cliVersion;
  const targetEntry = manifest.targets[target.target];
  if (!targetEntry) {
    throw new Error(`Manifest is missing target ${target.target}`);
  }

  const cacheRoot = resolveCacheRoot(options, env);
  const versionDir = path.join(cacheRoot, cliVersion, target.target);
  const defaultArchive = archiveNameForTarget(target);
  const { url, artifactName } = computeDownloadUrl(
    targetEntry,
    options.baseUrlOverride ?? env.TERRAZUL_SEA_BASE_URL,
  );
  const binaryName = binaryNameFromArchive(artifactName || defaultArchive);
  const binaryPath = path.join(versionDir, binaryName);

  if (await fileExists(binaryPath)) {
    return binaryPath;
  }

  const retries = Math.max(1, options.retries ?? DEFAULT_RETRIES);

  try {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-sea-download-'));
    const downloadPath = path.join(tempDir, artifactName);

    try {
      await downloadWithRetries(url, downloadPath, targetEntry.size, retries);
      const digest = await hashFile(downloadPath);
      if (digest.toLowerCase() !== targetEntry.sha256.toLowerCase()) {
        throw new Error(
          `SEA artifact sha256 mismatch for ${target.target}. Expected ${targetEntry.sha256}, got ${digest}`,
        );
      }

      await ensureDirectoryExists(versionDir);
      const tmpBinary = path.join(versionDir, `${binaryName}.tmp`);
      await decompressZst(downloadPath, tmpBinary);
      await moveFileAtomic(tmpBinary, binaryPath);
      await setExecutablePermissions(binaryPath, platform);
      await ensureBinarySigned(binaryPath, platform);
      return binaryPath;
    } finally {
      await fs.rm(downloadPath, { force: true }).catch(() => {});
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    const fallback = await findFallbackBinary(cacheRoot, target.target, cliVersion, binaryName);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

export async function prefetchSeaTargets(
  options: EnsureSeaBinaryOptions & { targets?: string[] },
): Promise<Record<string, string>> {
  const env = options.env ?? process.env;
  const manifest = options.manifest ?? (await loadManifest(resolveManifestLocation(options, env)));
  const cliVersion = options.cliVersion ?? manifest.cliVersion;

  const targetsToFetch = options.targets?.length
    ? SEA_TARGETS.filter((definition) => options.targets?.includes(definition.target))
    : SEA_TARGETS;

  const results: Record<string, string> = {};
  for (const target of targetsToFetch) {
    if (!manifest.targets[target.target]) {
      continue;
    }
    results[target.target] = await ensureSeaBinary({
      ...options,
      manifest,
      cliVersion,
      platform: target.platform,
      arch: target.arch,
    });
  }
  return results;
}

export function listSupportedTargets(): string[] {
  return SEA_TARGETS.map((target) => target.target);
}
