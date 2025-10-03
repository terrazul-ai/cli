import { promises as fs } from 'node:fs';
import path from 'node:path';

import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTempDir, startSeaFixtureServer, writeFixtureManifest } from './tools/sea-fixtures';
import { ensureSeaBinary } from '../../src/runtime/sea-fetcher';

const tempDirs: string[] = [];

async function seedPreviousVersion(cacheDir: string, binaryContents: string): Promise<string> {
  const versionDir = path.join(cacheDir, '1.2.2', 'linux-x64');
  await fs.mkdir(versionDir, { recursive: true });
  const binaryPath = path.join(versionDir, 'tz-linux-x64');
  await fs.writeFile(binaryPath, binaryContents, 'utf8');
  return binaryPath;
}

beforeAll(() => {
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

describe('ensureSeaBinary integration', () => {
  it('downloads, caches, and reuses binaries offline', async () => {
    const server = await startSeaFixtureServer();
    tempDirs.push(server.rootDir);

    const cacheDir = await makeTempDir('sea-cache-');
    tempDirs.push(cacheDir);
    const manifestDir = await makeTempDir('sea-manifest-');
    tempDirs.push(manifestDir);
    const manifestPath = path.join(manifestDir, 'manifest.json');
    await writeFixtureManifest({
      destination: manifestPath,
      baseUrl: server.baseUrl,
      cliVersion: '1.2.3',
    });

    try {
      const binaryPath = await ensureSeaBinary({
        cacheDir,
        manifestPath,
        cliVersion: '1.2.3',
        platform: 'linux',
        arch: 'x64',
      });

      const cached = await fs.readFile(binaryPath, 'utf8');
      expect(cached).toContain('fixture linux x64');

      await server.close();

      const cachedAgain = await ensureSeaBinary({
        cacheDir,
        manifestPath,
        cliVersion: '1.2.3',
        platform: 'linux',
        arch: 'x64',
      });

      expect(cachedAgain).toEqual(binaryPath);
    } finally {
      try {
        await server.close();
      } catch {
        // already closed
      }
    }
  });

  it('falls back to previous cached version when download fails', async () => {
    const cacheDir = await makeTempDir('sea-cache-');
    tempDirs.push(cacheDir);
    const manifestDir = await makeTempDir('sea-manifest-');
    tempDirs.push(manifestDir);
    const manifestPath = path.join(manifestDir, 'manifest.json');

    await seedPreviousVersion(cacheDir, '#!/usr/bin/env bash\necho "previous"\n');

    const server = await startSeaFixtureServer();
    tempDirs.push(server.rootDir);
    await writeFixtureManifest({
      destination: manifestPath,
      baseUrl: server.baseUrl,
      cliVersion: '1.2.3',
    });

    try {
      await server.close();
      const fallbackPath = await ensureSeaBinary({
        cacheDir,
        manifestPath,
        cliVersion: '1.2.3',
        platform: 'linux',
        arch: 'x64',
        retries: 1,
      });

      expect(fallbackPath).toContain(path.join(cacheDir, '1.2.2', 'linux-x64'));
      const fallbackContents = await fs.readFile(fallbackPath, 'utf8');
      expect(fallbackContents).toContain('previous');
    } finally {
      try {
        await server.close();
      } catch {
        // already closed
      }
    }
  });
});
