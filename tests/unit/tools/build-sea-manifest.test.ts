import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SEA_TARGETS, archiveNameForTarget } from '../../../src/runtime/targets';
import { buildSeaManifest } from '../../../tools/build-sea-manifest';

import type { SeaManifest } from '../../../tools/build-sea-manifest';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempDist() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sea-manifest-test-'));
  tempDirs.push(tmpRoot);
  const distDir = path.join(tmpRoot, 'dist');
  await fs.mkdir(distDir, { recursive: true });
  return { tmpRoot, distDir } as const;
}

async function writeArtifact(distDir: string, target: string, contents: string) {
  const targetDir = path.join(distDir, 'sea', target);
  await fs.mkdir(targetDir, { recursive: true });
  const definition = SEA_TARGETS.find((entry) => entry.target === target);
  const archiveName = definition ? archiveNameForTarget(definition) : `tz-${target}.zst`;
  const artifactPath = path.join(targetDir, archiveName);
  await fs.writeFile(artifactPath, contents, 'utf8');
  return artifactPath;
}

describe('buildSeaManifest', () => {
  it('creates a manifest with computed hashes and sizes for available targets', async () => {
    const { distDir } = await createTempDist();
    const darwinPath = await writeArtifact(distDir, 'darwin-arm64', 'darwin-bytes');
    const linuxPath = await writeArtifact(distDir, 'linux-x64', 'linux-bytes');

    const manifest = await buildSeaManifest({
      distDir,
      cliVersion: '0.3.1',
    });

    const manifestPath = path.join(distDir, 'manifest.json');
    const manifestFromDisk = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as SeaManifest;

    const expectedBaseUrl = 'https://github.com/terrazul-ai/cli/releases/download/cli-v0.3.1';

    expect(manifestFromDisk).toEqual(manifest);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.cliVersion).toBe('0.3.1');
    expect(manifest.cdn.baseUrl).toBe(expectedBaseUrl);
    expect(Object.keys(manifest.targets)).toEqual(['darwin-arm64', 'linux-x64']);

    const darwinEntry = manifest.targets['darwin-arm64'];
    const linuxEntry = manifest.targets['linux-x64'];
    const darwinHash = createHash('sha256').update('darwin-bytes').digest('hex');
    const linuxHash = createHash('sha256').update('linux-bytes').digest('hex');

    expect(darwinEntry.sha256).toBe(darwinHash);
    const darwinStat = await fs.stat(darwinPath);
    expect(darwinEntry.size).toBe(darwinStat.size);
    expect(darwinEntry.url).toBe(`${expectedBaseUrl}/tz-darwin-arm64.zst`);

    expect(linuxEntry.sha256).toBe(linuxHash);
    const linuxStat = await fs.stat(linuxPath);
    expect(linuxEntry.size).toBe(linuxStat.size);
    expect(linuxEntry.url).toBe(`${expectedBaseUrl}/tz-linux-x64.zst`);
  });

  it('honors an explicit base URL override', async () => {
    const { distDir } = await createTempDist();
    await writeArtifact(distDir, 'linux-arm64', 'linux-arm');

    const manifest = await buildSeaManifest({
      distDir,
      cliVersion: '1.0.0',
      baseUrl: 'https://cdn.terrazul.dev/releases/cli-v1.0.0',
    });

    expect(manifest.cdn.baseUrl).toBe('https://cdn.terrazul.dev/releases/cli-v1.0.0');
    expect(manifest.targets['linux-arm64'].url).toBe(
      'https://cdn.terrazul.dev/releases/cli-v1.0.0/tz-linux-arm64.zst',
    );
  });

  it('throws when expected artifacts are missing', async () => {
    const { distDir } = await createTempDist();
    await fs.mkdir(path.join(distDir, 'sea', 'darwin-x64'), { recursive: true });

    await expect(
      buildSeaManifest({
        distDir,
        cliVersion: '0.3.2',
      }),
    ).rejects.toThrow(/Missing SEA artifact for target darwin-x64/);
  });

  it('attaches signature metadata when a signature file is provided', async () => {
    const { distDir, tmpRoot } = await createTempDist();
    await writeArtifact(distDir, 'win32-x64', 'windows-bytes');
    const signaturePath = path.join(tmpRoot, 'signature.sig');
    await fs.writeFile(signaturePath, 'signed-data', 'utf8');

    const manifest = await buildSeaManifest({
      distDir,
      cliVersion: '2.0.0',
      signatureFile: signaturePath,
      signatureType: 'minisign',
    });

    expect(manifest.signatures).toEqual([
      {
        type: 'minisign',
        value: Buffer.from('signed-data', 'utf8').toString('base64'),
      },
    ]);
  });
});
