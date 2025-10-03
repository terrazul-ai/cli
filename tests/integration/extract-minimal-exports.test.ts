import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('minimal exports (single tool present)', () => {
  it('only cursor rules present -> exports only cursor', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    await proj.addCursorRulesFile('r.txt', 'RULE');
    const out = await mkdtemp('tz-extract-out');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/only-cursor',
      '--pkg-version',
      '0.0.1',
    ]);
    const toml = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    expect(toml).toMatch(/\[exports\.cursor]/);
    expect(toml).not.toMatch(/\[exports\.codex]/);
    expect(toml).not.toMatch(/\[exports\.claude]/);
    expect(toml).not.toMatch(/\[exports\.copilot]/);
  });

  it('only copilot present -> exports only copilot', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    await proj.addCopilot('good rules');
    const out = await mkdtemp('tz-extract-out');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/only-copilot',
      '--pkg-version',
      '0.0.1',
    ]);
    const toml = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    expect(toml).toMatch(/\[exports\.copilot]/);
    expect(toml).not.toMatch(/\[exports\.codex]/);
    expect(toml).not.toMatch(/\[exports\.claude]/);
    expect(toml).not.toMatch(/\[exports\.cursor]/);
  });
});
