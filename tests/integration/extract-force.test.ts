import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run, runReject } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract --force', () => {
  it('overwrites non-empty output directory safely', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    // Prepare project
    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# Enable', 'utf8');

    // Make out non-empty with junk
    await fs.writeFile(path.join(out, 'keep.txt'), 'junk', 'utf8');

    // Without --force → error
    const res = await runReject('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    expect(res.stderr + res.stdout).toMatch(/Output directory not empty/);

    // With --force → succeeds and cleans previous files
    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
      '--force',
    ]);

    // Old file should be gone
    await expect(fs.stat(path.join(out, 'keep.txt'))).rejects.toBeTruthy();
    // New manifest should exist
    const manifest = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    expect(manifest).toMatch(/@you\/ctx/);
  });
});
