#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Command } from 'commander';

import {
  seaManifestSchema,
  seaManifestTargetSchema,
  type SeaManifest,
  type SeaManifestTarget,
} from '../src/types/sea-manifest';
import { SEA_TARGETS, archiveNameForTarget } from '../src/runtime/targets';

export type { SeaManifest } from '../src/types/sea-manifest';

const DEFAULT_RELEASE_BASE = 'https://github.com/terrazul-ai/tz/releases/download';

export interface BuildSeaManifestOptions {
  cliVersion: string;
  distDir?: string;
  baseUrl?: string;
  releaseTag?: string;
  outputPath?: string;
  signatureFile?: string;
  signatureType?: string;
}

async function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', (error) => reject(error));
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function resolveBaseUrl({ baseUrl, releaseTag, cliVersion }: BuildSeaManifestOptions): string {
  if (baseUrl) return baseUrl;
  if (releaseTag) return `${DEFAULT_RELEASE_BASE}/${releaseTag}`;
  return `${DEFAULT_RELEASE_BASE}/tz-v${cliVersion}`;
}

function getSeaDir(distDir: string): string {
  return path.join(distDir, 'sea');
}

async function listTargets(seaDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(seaDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`SEA artifacts directory not found at ${seaDir}`);
    }
    throw error;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadSignature(signatureFile?: string, signatureType = 'raw') {
  if (!signatureFile) return;
  const absolutePath = path.resolve(signatureFile);
  const contents = await fs.readFile(absolutePath);
  return [
    {
      type: signatureType,
      value: contents.toString('base64'),
    },
  ];
}

export async function buildSeaManifest(options: BuildSeaManifestOptions): Promise<SeaManifest> {
  const distDir = path.resolve(options.distDir ?? path.join(process.cwd(), 'dist'));
  const seaDir = getSeaDir(distDir);
  const targets = await listTargets(seaDir);

  if (targets.length === 0) {
    throw new Error(`No SEA artifacts found under ${seaDir}`);
  }

  const baseUrl = resolveBaseUrl(options);

  const manifestTargets: Record<string, SeaManifestTarget> = {};

  for (const target of targets) {
    const definition = SEA_TARGETS.find((candidate) => candidate.target === target);
    if (!definition) {
      console.warn(`Unknown target directory ${target}; skipping.`);
      continue;
    }
    const artifactName = `tz-${target}.zst`;
    const expectedArchive = archiveNameForTarget(definition);
    const archiveCandidates = [expectedArchive, artifactName];
    let artifactPath: string | undefined;
    for (const candidate of archiveCandidates) {
      const candidatePath = path.join(seaDir, target, candidate);
      if (await fileExists(candidatePath)) {
        artifactPath = candidatePath;
        break;
      }
    }
    if (!artifactPath) {
      throw new Error(`Missing SEA artifact for target ${target} (expected ${expectedArchive})`);
    }
    const selectedArchive = path.basename(artifactPath);
    try {
      const stat = await fs.stat(artifactPath);
      if (!stat.isFile()) {
        throw new Error(`Expected SEA artifact file at ${artifactPath}`);
      }
      const sha256 = await computeSha256(artifactPath);
      manifestTargets[target] = {
        url: `${baseUrl}/${selectedArchive}`,
        size: stat.size,
        sha256,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Missing SEA artifact for target ${target} at ${artifactPath}`);
      }
      throw error;
    }
  }

  const signatures = await loadSignature(options.signatureFile, options.signatureType);

  const manifestCandidate = {
    schemaVersion: 1 as const,
    cliVersion: options.cliVersion,
    cdn: { baseUrl },
    targets: manifestTargets,
    ...(signatures ? { signatures } : {}),
  } satisfies SeaManifest;

  const manifest = seaManifestSchema.parse(manifestCandidate);

  const outputPath = path.resolve(options.outputPath ?? path.join(distDir, 'manifest.json'));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return manifest;
}

function buildCli() {
  const program = new Command();
  program
    .name('build-sea-manifest')
    .description('Generate the SEA binary manifest for on-demand fetching')
    .requiredOption('--version <semver>', 'CLI version to embed in the manifest')
    .option('--dist-dir <path>', 'Path to the dist directory', path.join(process.cwd(), 'dist'))
    .option('--output <path>', 'Path to the manifest output file')
    .option('--base-url <url>', 'Override base URL for released binaries')
    .option('--tag <releaseTag>', 'Release tag used to compute default CDN URL')
    .option('--signature <file>', 'Path to release signature to embed')
    .option('--signature-type <type>', 'Type identifier for the embedded signature', 'raw')
    .action(
      async (cmdOptions: {
        version: string;
        distDir: string;
        output?: string;
        baseUrl?: string;
        tag?: string;
        signature?: string;
        signatureType?: string;
      }) => {
        try {
          const manifest = await buildSeaManifest({
            cliVersion: cmdOptions.version,
            distDir: cmdOptions.distDir,
            baseUrl: cmdOptions.baseUrl,
            releaseTag: cmdOptions.tag,
            outputPath: cmdOptions.output,
            signatureFile: cmdOptions.signature,
            signatureType: cmdOptions.signatureType,
          });
          console.log(
            `SEA manifest generated with ${Object.keys(manifest.targets).length} targets.`,
          );
        } catch (error) {
          console.error(
            'Failed to generate SEA manifest:',
            error instanceof Error ? error.message : error,
          );
          process.exitCode = 1;
        }
      },
    );

  return program;
}

function shouldRunCli() {
  const entryPoint = process.argv?.[1];
  if (!entryPoint) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entryPoint)).href;
  } catch (error) {
    console.warn('Unable to resolve CLI entry point for build-sea-manifest:', error);
    return false;
  }
}

if (shouldRunCli()) {
  const program = buildCli();
  program.parseAsync(process.argv).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export const manifestSchemas = {
  manifest: seaManifestSchema,
  target: seaManifestTargetSchema,
};
