import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { collectPackageFiles, createTarball } from '../../../src/core/publisher';

async function mkd(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(root: string, rel: string, data: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, data, 'utf8');
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('core/publisher determinism', () => {
  let root = '';
  beforeAll(async () => {
    root = await mkd('tz-pub-det');
    await write(
      root,
      'agents.toml',
      `\n[package]\nname = "@det/demo"\nversion = "0.1.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
    );
    await write(root, 'README.md', '# Read');
    await write(root, 'templates/CLAUDE.md.hbs', '# Text');
  });
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('produces identical tarball bytes across runs', async () => {
    const files = await collectPackageFiles(root);
    const a = await createTarball(root, files);
    const b = await createTarball(root, files);
    expect(sha256(a)).toEqual(sha256(b));
  });
});
