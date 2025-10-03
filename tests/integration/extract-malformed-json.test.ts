import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract with malformed JSON inputs', () => {
  it('handles malformed .claude/settings.json gracefully', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    await proj.addClaudeReadme('# Hello Claude');
    await proj.setClaudeSettingsRaw('{malformed');
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
    const txt = await fs.readFile(
      path.join(out, 'templates', 'claude', 'settings.json.hbs'),
      'utf8',
    );
    const parsed = JSON.parse(txt);
    expect(parsed).toBeTypeOf('object');
  });

  it('handles malformed .claude/mcp_servers.json gracefully', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    await proj.addClaudeReadme('# Hello Claude');
    await proj.setClaudeMcpRaw('{not json');
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
    const txt = await fs.readFile(
      path.join(out, 'templates', 'claude', 'mcp_servers.json.hbs'),
      'utf8',
    );
    const parsed = JSON.parse(txt);
    expect(parsed).toBeTypeOf('object');
  });
});
