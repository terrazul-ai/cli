import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run, runReject } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract output dir safety', () => {
  it('errors when --out is non-empty', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# Hello', 'utf8');
    await fs.writeFile(path.join(out, 'keep.txt'), 'exists', 'utf8');

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
    await expect(fs.readFile(path.join(out, 'agents.toml'), 'utf8')).rejects.toBeTruthy();
  });

  it('succeeds when --out exists and empty', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# Hello', 'utf8');
    // make out empty dir by ensuring subdir deleted
    const { stdout } = await run('node', [
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
    expect(stdout).toMatch(/Extracted/);
    const agents = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    expect(agents).toMatch(/@you\/ctx/);
  });
});
