import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { StorageManager } from '../../../src/core/storage';

async function makeTarWithOptions(
  dir: string,
  files: Record<string, { content?: string }>,
  outFile: string,
  opts?: { prefix?: string; preservePaths?: boolean },
): Promise<void> {
  // Write files to a temp dir
  for (const [rel, { content }] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content ?? '', 'utf8');
  }
  const fileList = Object.keys(files);
  const tar = await import('tar');
  await tar.create(
    {
      gzip: true,
      cwd: dir,
      portable: true,
      file: outFile,
      // Intentionally allow dangerous names when building tarballs for tests
      preservePaths: opts?.preservePaths ?? false,
      prefix: opts?.prefix,
    },
    fileList,
  );
}

describe('core/storage security', () => {
  let tmpDir = '';
  let cacheDir = '';
  let storeDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-storage-sec-'));
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

  it('rejects symlink entries during extraction', async () => {
    if (process.platform === 'win32') {
      // Creating symlinks on Windows often requires privileges; skip.
      expect(true).toBe(true);
      return;
    }
    const s = new StorageManager({ cacheDir, storeDir });
    const buildDir = path.join(tmpDir, 'build-link');
    await fs.mkdir(buildDir, { recursive: true });
    // Create a regular file and a symlink to it
    const target = path.join(buildDir, 'data.txt');
    await fs.writeFile(target, 'payload', 'utf8');
    const link = path.join(buildDir, 'link.txt');
    await fs.symlink('data.txt', link);

    const tarPath = path.join(tmpDir, 'symlink.tgz');
    const tar = await import('tar');
    await tar.create({ gzip: true, cwd: buildDir, portable: true, file: tarPath }, [
      'data.txt',
      'link.txt',
    ]);

    await s.extractTarball(tarPath, '@user/sec', '0.0.1');
    const outPath = s.getPackagePath('@user/sec', '0.0.1');
    const dataOut = path.join(outPath, 'data.txt');
    const linkOut = path.join(outPath, 'link.txt');
    const stData = await fs.stat(dataOut);
    expect(stData.isFile()).toBe(true);
    // The symlink should have been rejected; reading stats should fail
    await expect(fs.stat(linkOut)).rejects.toBeTruthy();
  });

  it('does not extract entries with absolute path headers', async () => {
    const s = new StorageManager({ cacheDir, storeDir });
    const buildDir = path.join(tmpDir, 'build-abs');
    await fs.mkdir(buildDir, { recursive: true });
    const tarPath = path.join(tmpDir, 'abs.tgz');

    await makeTarWithOptions(buildDir, { 'safe.txt': { content: 'ok' } }, tarPath, {
      prefix: '/abs',
      preservePaths: true,
    });

    await s.extractTarball(tarPath, '@user/sec', '0.0.2');
    const outPath = s.getPackagePath('@user/sec', '0.0.2');
    // Nothing should be extracted because header paths were absolute and rejected
    const entries = await fs.readdir(outPath);
    expect(entries.length).toBe(0);
  });

  it('does not extract entries that traverse parent directories', async () => {
    const s = new StorageManager({ cacheDir, storeDir });
    const buildDir = path.join(tmpDir, 'build-trav');
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(path.join(buildDir, 'evil.txt'), 'x', 'utf8');
    const tarPath = path.join(tmpDir, 'trav.tgz');

    // Use a parent-traversing prefix to encode dangerous header paths
    await makeTarWithOptions(buildDir, { 'evil.txt': { content: 'x' } }, tarPath, {
      prefix: '../..',
      preservePaths: true,
    });

    await s.extractTarball(tarPath, '@user/sec', '0.0.3');
    const outPath = s.getPackagePath('@user/sec', '0.0.3');
    const entries = await fs.readdir(outPath);
    expect(entries.length).toBe(0);
  });

  it('allows filenames containing two dots in segment names', async () => {
    const s = new StorageManager({ cacheDir, storeDir });
    const buildDir = path.join(tmpDir, 'build-dots');
    await fs.mkdir(buildDir, { recursive: true });
    const weirdDir = path.join(buildDir, 'dir..name');
    await fs.mkdir(weirdDir, { recursive: true });
    await fs.writeFile(path.join(weirdDir, 'file.txt'), 'ok', 'utf8');
    const tarPath = path.join(tmpDir, 'dots.tgz');

    const tar = await import('tar');
    await tar.create({ gzip: true, cwd: buildDir, portable: true, file: tarPath }, [
      'dir..name/file.txt',
    ]);

    await s.extractTarball(tarPath, '@user/sec', '0.0.4');
    const outPath = s.getPackagePath('@user/sec', '0.0.4');
    const fileOut = path.join(outPath, 'dir..name', 'file.txt');
    const st = await fs.stat(fileOut);
    expect(st.isFile()).toBe(true);
  });
});
