import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract with no recognized inputs', () => {
  it('fails with a clear error when project has nothing to extract', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-empty-proj');
    const out = await mkdtemp('tz-extract-empty-out');

    await expect(
      run('node', [
        cli,
        'extract',
        '--from',
        proj,
        '--out',
        out,
        '--name',
        '@you/empty',
        '--pkg-version',
        '0.0.1',
      ]),
    ).rejects.toThrow(/No recognized inputs/);

    // Ensure nothing was written
    await expect(fs.readFile(path.join(out, 'agents.toml'), 'utf8')).rejects.toBeTruthy();
  });
});
