import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { StorageManager } from '../../../src/core/storage';

async function makeTarball(
  dir: string,
  files: Record<string, { content: string; mode?: number }>,
  outFile: string,
): Promise<void> {
  // Write files to a temp dir
  for (const [rel, { content, mode }] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
    if (mode !== undefined) {
      await fs.chmod(full, mode);
    }
  }
  const fileList = Object.keys(files);
  // Create directly to a file for deterministic output
  const tar = await import('tar');
  await tar.create({ gzip: true, cwd: dir, portable: true, file: outFile }, fileList);
}

describe('core/storage', () => {
  let tmpDir = '';
  let cacheDir = '';
  let storeDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-storage-'));
    cacheDir = path.join(tmpDir, 'cache');
    storeDir = path.join(tmpDir, 'store');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('stores and retrieves by content hash', () => {
    const s = new StorageManager({ cacheDir, storeDir });
    const buf = Buffer.from('hello world');
    const hash = s.store(buf);
    expect(hash).toMatch(/^[\da-f]{64}$/);
    expect(s.verify(hash)).toBe(true);
    const out = s.retrieve(hash);
    expect(out?.toString('utf8')).toBe('hello world');
  });

  it('stores a stream and returns its hash', async () => {
    const s = new StorageManager({ cacheDir, storeDir });
    const data = 'streamy data';
    const stream = Readable.from([Buffer.from(data)]);
    const hash = await s.storeStream(stream);
    const out = s.retrieve(hash);
    expect(out?.toString('utf8')).toBe(data);
  });

  it('extracts a tarball safely to store dir and strips exec bits', async () => {
    const s = new StorageManager({ cacheDir, storeDir });
    const buildDir = path.join(tmpDir, 'build');
    await fs.mkdir(buildDir, { recursive: true });
    const tarPath = path.join(tmpDir, 'pkg.tgz');

    await makeTarball(
      buildDir,
      {
        'README.md': { content: '# Demo', mode: 0o777 },
        'agents/a.txt': { content: 'A' },
      },
      tarPath,
    );

    await s.extractTarball(tarPath, '@user/demo', '1.0.0');
    const outPath = s.getPackagePath('@user/demo', '1.0.0');
    const readme = path.join(outPath, 'README.md');
    const agents = path.join(outPath, 'agents', 'a.txt');
    const readmeStat = await fs.stat(readme);
    const agentsStat = await fs.stat(agents);
    expect(readmeStat.isFile()).toBe(true);
    expect(agentsStat.isFile()).toBe(true);

    if (process.platform !== 'win32') {
      // Exec bits should be stripped
      expect(readmeStat.mode & 0o111).toBe(0);
    }
  });
});
