import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function trySymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, 'dir');
    return true;
  } catch (error: unknown) {
    const msg = String((error as { message?: string } | undefined)?.message || error);
    if (/(eperm|einval|operation not permitted|a required privilege is not held)/i.test(msg))
      return false;
    throw error;
  }
}

describe('tz extract rejects symlinked --out path', () => {
  it('fails fast when --out is a symlink (no deletion, no writes)', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const temp = await mkdtemp('tz-extract-out');
    const realOut = path.join(temp, 'real-out');
    const outLink = path.join(temp, 'out-link');

    await fs.mkdir(realOut, { recursive: true });
    const canLink = await trySymlink(realOut, outLink);
    if (!canLink) return; // environment cannot make symlinks; skip

    // Minimal input to allow extraction
    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# codex', 'utf8');

    // Attempt extract with symlinked out
    await expect(
      run('node', [
        cli,
        'extract',
        '--from',
        proj,
        '--out',
        outLink,
        '--name',
        '@you/ctx',
        '--pkg-version',
        '1.0.0',
        '--force',
      ]),
    ).rejects.toThrow(/Output path is a symlink/);

    // Sanity: target directory should remain empty (no accidental deletion or writes)
    const entries = await fs.readdir(realOut);
    expect(entries.length).toBe(0);
  });
});
