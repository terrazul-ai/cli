import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

describe('tz extract ignores non-MD files in .claude/agents', () => {
  it('does not copy non-markdown files from agents dir', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const out = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'tz-ex-out-'));

    await fs.mkdir(path.join(proj.root, '.claude', 'agents'), { recursive: true });
    await fs.writeFile(path.join(proj.root, '.claude', 'agents', 'reviewer.md'), '# md', 'utf8');
    await fs.writeFile(path.join(proj.root, '.claude', 'agents', 'ignore.txt'), 'text', 'utf8');
    await fs.writeFile(path.join(proj.root, '.claude', 'agents', 'bin'), 'not md', 'utf8');
    await proj.addCodexAgents('# enable');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);

    // Should include the .md and not include .txt or no-ext files
    await fs.stat(path.join(out, 'templates', 'claude', 'agents', 'reviewer.md.hbs'));
    await expect(
      fs.stat(path.join(out, 'templates', 'claude', 'agents', 'ignore.txt.hbs')),
    ).rejects.toBeTruthy();
    await expect(
      fs.stat(path.join(out, 'templates', 'claude', 'agents', 'bin.hbs')),
    ).rejects.toBeTruthy();
  });
});
