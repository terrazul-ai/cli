#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import { promises as fs, constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { coerce, lt, minVersion } from 'semver';

import type { SeaManifest } from '../src/types/sea-manifest';

interface StageOptions {
  releaseVersion: string;
  stagingRoot?: string;
  repo?: string;
  runId: string;
  workflowUrl: string;
  ghPath?: string;
  env?: NodeJS.ProcessEnv;
}

interface StageResult {
  stagingRoot: string;
  packageDir: string;
}

interface VerifyOptions {
  packageDir: string;
  nodeBinary: string;
  requireLaunch?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function mergeEnv(overrides?: NodeJS.ProcessEnv) {
  if (!overrides) {
    return { ...process.env } as NodeJS.ProcessEnv;
  }
  return { ...process.env, ...overrides } as NodeJS.ProcessEnv;
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: any } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? 'inherit',
      cwd: options.cwd,
      env: options.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

export async function stageReleasePackage(options: StageOptions): Promise<StageResult> {
  const stagingRoot = options.stagingRoot
    ? path.resolve(options.stagingRoot)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'tz-stage-'));
  const packageDir = path.join(stagingRoot, 'package');

  await fs.mkdir(stagingRoot, { recursive: true });

  const scriptPath = path.join(repoRoot, 'scripts', 'stage_release.sh');
  const args = [
    scriptPath,
    '--release-version',
    options.releaseVersion,
    '--tmp',
    stagingRoot,
    '--run-id',
    options.runId,
    '--run-url',
    options.workflowUrl,
  ];

  if (options.repo) {
    args.push('--repo', options.repo);
  }

  const env = mergeEnv(options.env);
  if (options.ghPath) {
    env.GH_CLI = options.ghPath;
  }

  await runCommand('bash', args, { cwd: repoRoot, env });

  return { stagingRoot, packageDir };
}

async function readJson<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
}

async function ensurePathExists(targetPath: string, mode: number) {
  await fs.access(targetPath, mode);
}

async function collectSeaArtifacts(seaDir: string) {
  const entries = await fs.readdir(seaDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await fs.readdir(path.join(seaDir, entry.name));
      files.push(...nested.map((name) => path.join(seaDir, entry.name, name)));
    }
  }
  return files;
}

async function ensureNodeVersion(nodeBinary: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(nodeBinary, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to determine Node version from ${nodeBinary}`));
        return;
      }
      resolve(output.trim());
    });
  });
}

export async function verifyStagedPackage(options: VerifyOptions): Promise<void> {
  const packageDir = path.resolve(options.packageDir);
  const packageJsonPath = path.join(packageDir, 'package.json');
  let packageJson: any;
  try {
    packageJson = await readJson<any>(packageJsonPath);
  } catch {
    throw new TypeError(`Unable to read staged package.json: ${packageJsonPath}`);
  }

  if (packageJson?.bin?.tz !== 'bin/app.mjs') {
    throw new TypeError('Staged package must expose bin/app.mjs as the tz launcher');
  }

  const engineRange = packageJson?.engines?.node;
  if (typeof engineRange !== 'string') {
    throw new TypeError('Staged package must define engines.node');
  }
  const minimumVersion = minVersion(engineRange);
  if (!minimumVersion || lt(minimumVersion, '20.0.0')) {
    throw new RangeError('Staged package engines.node must require Node >=20');
  }

  const files = Array.isArray(packageJson?.files) ? packageJson.files : [];
  if (!files.includes('dist')) {
    throw new TypeError('Staged package files array must include dist');
  }
  if (!files.includes('bin')) {
    throw new TypeError('Staged package files array must include bin');
  }

  const manifestPath = path.join(packageDir, 'dist', 'manifest.json');
  try {
    await ensurePathExists(manifestPath, fsConstants.F_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new TypeError('Staged package must include dist/manifest.json');
    }
    throw error;
  }
  const manifest = await readJson<SeaManifest>(manifestPath);
  const targets: Record<string, unknown> = manifest.targets ?? {};
  if (Object.keys(targets).length === 0) {
    throw new TypeError('Manifest must declare at least one SEA target');
  }

  const seaDir = path.join(packageDir, 'dist', 'sea');
  try {
    await ensurePathExists(seaDir, fsConstants.F_OK);
    const remaining = await collectSeaArtifacts(seaDir);
    if (remaining.length > 0) {
      throw new TypeError('Staged package must not bundle dist/sea artifacts');
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  if (options.requireLaunch === false) {
    return;
  }

  const nodeVersionOutput = await ensureNodeVersion(options.nodeBinary);
  const normalizedVersion = nodeVersionOutput.replace(/^v/, '');
  const parsed = coerce(normalizedVersion);
  if (!parsed || lt(parsed, '20.0.0')) {
    throw new RangeError(
      `Node binary ${options.nodeBinary} must be Node >=20 (found ${nodeVersionOutput})`,
    );
  }

  await runCommand(options.nodeBinary, ['bin/app.mjs', '--help'], {
    cwd: packageDir,
    env: mergeEnv(),
    stdio: 'ignore',
  });
}

function parseCliArgs(argv: string[]) {
  const args = [...argv];
  const options: {
    releaseVersion?: string;
    runId?: string;
    workflowUrl?: string;
    repo?: string;
    ghPath?: string;
    nodeBinary?: string;
    stagingRoot?: string;
    keepStage?: boolean;
    skipLaunch?: boolean;
  } = {};

  while (args.length > 0) {
    const arg = args.shift();
    switch (arg) {
      case '--release-version': {
        options.releaseVersion = args.shift();
        break;
      }
      case '--run-id': {
        options.runId = args.shift();
        break;
      }
      case '--workflow-url': {
        options.workflowUrl = args.shift();
        break;
      }
      case '--repo': {
        options.repo = args.shift();
        break;
      }
      case '--gh': {
        options.ghPath = args.shift();
        break;
      }
      case '--node20': {
        options.nodeBinary = args.shift();
        break;
      }
      case '--staging-root': {
        options.stagingRoot = args.shift();
        break;
      }
      case '--keep-stage': {
        options.keepStage = true;
        break;
      }
      case '--skip-launch': {
        options.skipLaunch = true;
        break;
      }
      default: {
        throw new TypeError(`Unknown argument: ${arg}`);
      }
    }
  }

  if (!options.releaseVersion) {
    throw new TypeError('--release-version is required');
  }

  return options;
}

async function main(argv: string[]) {
  const args = parseCliArgs(argv);
  const releaseVersion = args.releaseVersion!;
  const runId = args.runId ?? 'local-stage';
  const workflowUrl = args.workflowUrl ?? `https://example.com/run/${runId}`;
  const nodeBinary = args.nodeBinary ?? process.execPath;

  const stageResult = await stageReleasePackage({
    releaseVersion,
    stagingRoot: args.stagingRoot,
    repo: args.repo,
    runId,
    workflowUrl,
    ghPath: args.ghPath,
  });

  try {
    await verifyStagedPackage({
      packageDir: stageResult.packageDir,
      nodeBinary,
      requireLaunch: args.skipLaunch !== true,
    });
  } finally {
    if (!args.keepStage && !args.stagingRoot) {
      await fs.rm(stageResult.stagingRoot, { recursive: true, force: true });
    }
  }
}

const shouldRunCli = (() => {
  const argvEntry = process.argv?.[1];
  if (!argvEntry) return false;
  try {
    return import.meta.url === pathToFileURL(argvEntry).href;
  } catch {
    return false;
  }
})();

if (shouldRunCli) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('verify-sea-package failed:', error?.message ?? error);
    process.exit(1);
  });
}
