import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SeaManifest } from '../../../src/types/sea-manifest';

const tempDirs: string[] = [];

vi.mock('../../../src/utils/compression', () => {
  return {
    decompressZst: vi.fn(async (source: string, destination: string) => {
      const data = await fs.readFile(source);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, data);
    }),
  };
});

const compressionModule = await import('../../../src/utils/compression');
const decompressMock = vi.mocked(compressionModule.decompressZst, true);

beforeEach(() => {
  decompressMock.mockClear();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  decompressMock.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function createTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

async function writeManifest(filePath: string, manifest: SeaManifest) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
}

function computeSha(buffer: Buffer | string) {
  const buf = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
  return createHash('sha256').update(buf).digest('hex');
}

describe('ensureSeaBinary', () => {
  it('downloads, verifies, and caches the binary for the current target', async () => {
    const cacheDir = await createTempDir('sea-cache');
    const manifestDir = await createTempDir('sea-manifest');
    const manifestPath = path.join(manifestDir, 'manifest.json');

    const artifactData = Buffer.from('sea-binary-payload');
    const sha = computeSha(artifactData);
    const manifest: SeaManifest = {
      schemaVersion: 1,
      cliVersion: '0.3.1',
      cdn: { baseUrl: 'https://example.com/releases/cli-v0.3.1' },
      targets: {
        'darwin-arm64': {
          url: 'https://example.com/releases/cli-v0.3.1/tz-darwin-arm64.zst',
          size: artifactData.length,
          sha256: sha,
        },
      },
    };

    await writeManifest(manifestPath, manifest);

    const fetchMock = vi.fn(() => Promise.resolve(new Response(artifactData)));
    vi.stubGlobal('fetch', fetchMock);

    const { ensureSeaBinary } = await import('../../../src/runtime/sea-fetcher');
    const binaryPath: string = await ensureSeaBinary({
      cliVersion: '0.3.1',
      platform: 'darwin',
      arch: 'arm64',
      manifestPath,
      cacheDir,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/releases/cli-v0.3.1/tz-darwin-arm64.zst',
      expect.any(Object),
    );
    expect(decompressMock).toHaveBeenCalledTimes(1);
    const binary = await fs.readFile(binaryPath, 'utf8');
    expect(binary).toBe('sea-binary-payload');
    expect(binaryPath).toContain(path.join(cacheDir, '0.3.1', 'darwin-arm64'));
  });

  it('throws when downloaded artifact hash mismatches the manifest', async () => {
    const cacheDir = await createTempDir('sea-cache');
    const manifestDir = await createTempDir('sea-manifest');
    const manifestPath = path.join(manifestDir, 'manifest.json');

    const artifactData = Buffer.from('corrupted-data');
    const manifest: SeaManifest = {
      schemaVersion: 1,
      cliVersion: '0.9.0',
      cdn: { baseUrl: 'https://cdn.invalid/releases' },
      targets: {
        'linux-x64': {
          url: 'https://cdn.invalid/releases/tz-linux-x64.zst',
          size: artifactData.length,
          sha256: computeSha('expected-data'),
        },
      },
    };

    await writeManifest(manifestPath, manifest);
    const fetchMock = vi.fn(() => Promise.resolve(new Response(artifactData)));
    vi.stubGlobal('fetch', fetchMock);

    const { ensureSeaBinary } = await import('../../../src/runtime/sea-fetcher');

    await expect(
      ensureSeaBinary({
        cliVersion: '0.9.0',
        platform: 'linux',
        arch: 'x64',
        manifestPath,
        cacheDir,
      }),
    ).rejects.toThrow(/sha256 mismatch/i);

    expect(decompressMock).not.toHaveBeenCalled();
  });

  it('falls back to the most recent cached version when download fails', async () => {
    const cacheDir = await createTempDir('sea-cache');
    const manifestDir = await createTempDir('sea-manifest');
    const manifestPath = path.join(manifestDir, 'manifest.json');

    const manifest: SeaManifest = {
      schemaVersion: 1,
      cliVersion: '1.5.0',
      cdn: { baseUrl: 'https://example.com/releases/cli-v1.5.0' },
      targets: {
        'linux-arm64': {
          url: 'https://example.com/releases/cli-v1.5.0/tz-linux-arm64.zst',
          size: 42,
          sha256: computeSha('placeholder'),
        },
      },
    };

    await writeManifest(manifestPath, manifest);

    const previousVersionDir = path.join(cacheDir, '1.4.0', 'linux-arm64');
    const fallbackBinaryPath = path.join(previousVersionDir, 'tz-linux-arm64');
    await fs.mkdir(previousVersionDir, { recursive: true });
    await fs.writeFile(fallbackBinaryPath, 'fallback-binary');

    const fetchMock = vi.fn(() => Promise.reject(new Error('network down')));
    vi.stubGlobal('fetch', fetchMock);

    const { ensureSeaBinary } = await import('../../../src/runtime/sea-fetcher');
    const binaryPath: string = await ensureSeaBinary({
      cliVersion: '1.5.0',
      platform: 'linux',
      arch: 'arm64',
      manifestPath,
      cacheDir,
    });

    expect(binaryPath).toBe(fallbackBinaryPath);
    expect(fetchMock).toHaveBeenCalled();
    expect(decompressMock).not.toHaveBeenCalled();
  });

  it('respects TERRAZUL_SEA_BASE_URL overrides for downloads', async () => {
    const cacheDir = await createTempDir('sea-cache');
    const manifestDir = await createTempDir('sea-manifest');
    const manifestPath = path.join(manifestDir, 'manifest.json');

    const data = Buffer.from('override-data');
    const manifest: SeaManifest = {
      schemaVersion: 1,
      cliVersion: '2.0.0',
      cdn: { baseUrl: 'https://example.com/ignored' },
      targets: {
        'win32-x64': {
          url: 'https://example.com/ignored/tz-win32-x64.zst',
          size: data.length,
          sha256: computeSha(data),
        },
      },
    };

    await writeManifest(manifestPath, manifest);

    const fetchMock = vi.fn(() => Promise.resolve(new Response(data)));
    vi.stubGlobal('fetch', fetchMock);

    const { ensureSeaBinary } = await import('../../../src/runtime/sea-fetcher');
    await ensureSeaBinary({
      cliVersion: '2.0.0',
      platform: 'win32',
      arch: 'x64',
      manifestPath,
      cacheDir,
      env: { TERRAZUL_SEA_BASE_URL: 'https://local.test/assets' } as NodeJS.ProcessEnv,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://local.test/assets/tz-win32-x64.zst',
      expect.any(Object),
    );
  });
});
