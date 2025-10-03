import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract when --out is an existing file', () => {
  it('fails instead of trampling existing file path', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const temp = await mkdtemp('tz-extract-out');
    const outFile = path.join(temp, 'out-as-file.txt');

    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# enable', 'utf8');
    await fs.writeFile(outFile, 'not a dir', 'utf8');

    await expect(
      run('node', [
        cli,
        'extract',
        '--from',
        proj,
        '--out',
        outFile,
        '--name',
        '@you/ctx',
        '--pkg-version',
        '1.0.0',
      ]),
    ).rejects.toThrow(/Output path exists and is a file/);
  });
});
