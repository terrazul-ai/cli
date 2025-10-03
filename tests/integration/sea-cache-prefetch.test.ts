import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { makeTempDir, startSeaFixtureServer, writeFixtureManifest } from './tools/sea-fixtures';

async function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function ensureBuilt(): Promise<void> {
  await run('node', ['build.config.mjs']);
}

const tempDirs: string[] = [];

beforeAll(async () => {
  await ensureBuilt();
  process.env.TERRAZUL_SEA_SKIP_DECOMPRESS = '1';
});

afterAll(() => {
  delete process.env.TERRAZUL_SEA_SKIP_DECOMPRESS;
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  ).catch(() => {
    // ignore cleanup failures
  });
});

describe('tz cache prefetch (integration)', () => {
  it('downloads the requested target into the cache directory', async () => {
    const server = await startSeaFixtureServer();
    tempDirs.push(server.rootDir);

    const manifestDir = await makeTempDir('sea-manifest-');
    tempDirs.push(manifestDir);
    const manifestPath = path.join(manifestDir, 'manifest.json');
    await writeFixtureManifest({
      destination: manifestPath,
      baseUrl: server.baseUrl,
      cliVersion: '3.1.4',
    });

    const cacheDir = await makeTempDir('sea-cache-');
    tempDirs.push(cacheDir);

    const cliPath = path.join(process.cwd(), 'dist', 'tz.mjs');
    const env = {
      ...process.env,
      TERRAZUL_SEA_SKIP_DECOMPRESS: '1',
    };

    try {
      const { stdout } = await run(
        'node',
        [
          cliPath,
          'cache',
          'prefetch',
          '--cli-version',
          '3.1.4',
          '--targets',
          'linux-x64',
          '--manifest',
          manifestPath,
          '--cache-dir',
          cacheDir,
          '--base-url',
          server.baseUrl,
        ],
        env,
      );

      expect(stdout).toMatch(/Prefetched SEA binaries/);
      const binaryPath = path.join(cacheDir, '3.1.4', 'linux-x64', 'tz-linux-x64');
      await expect(fs.readFile(binaryPath, 'utf8')).resolves.toContain('fixture linux x64');
    } finally {
      await server.close();
    }
  });
});
