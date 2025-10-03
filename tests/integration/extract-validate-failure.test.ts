import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run, runReject } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('validate failure on missing template', () => {
  it('fails when referenced template is missing', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    await proj.addCodexAgents('# Codex Only');
    const out = await mkdtemp('tz-extract-out');

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
    // Remove codex template file to break validation
    await fs.rm(path.join(out, 'templates', 'AGENTS.md.hbs'));

    const res = await runReject('node', [cli, 'validate'], { cwd: out });
    expect(res.stderr + res.stdout).toMatch(/Missing template/);
  });
});
