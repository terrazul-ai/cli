import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract --dry-run', () => {
  it('prints summary and writes nothing', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# Hello', 'utf8');

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
      '--dry-run',
    ]);
    expect(stdout).toMatch(/projectRoot/);
    expect(stdout).toMatch(/detected/);
    expect(stdout).toMatch(/outputs/);

    // No manifest should be written in dry run
    await expect(fs.readFile(path.join(out, 'agents.toml'), 'utf8')).rejects.toBeTruthy();
  });
});
