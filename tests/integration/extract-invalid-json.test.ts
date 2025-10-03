import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

describe('tz extract with invalid JSON inputs', () => {
  it('gracefully handles invalid JSON in .claude/settings.json and mcp_servers.json', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const out = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'tz-ex-out-'));

    await fs.mkdir(path.join(proj.root, '.claude'), { recursive: true });
    await proj.addCodexAgents('# Present to enable extract');
    await fs.writeFile(path.join(proj.root, '.claude', 'settings.json'), '{ invalid json ', 'utf8');
    await fs.writeFile(path.join(proj.root, '.claude', 'mcp_servers.json'), '{ not: valid', 'utf8');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/ctx-invalid',
      '--pkg-version',
      '1.2.3',
    ]);

    // Verify files were created and are valid JSON (sanitized as empty objects)
    const settings = await fs.readFile(
      path.join(out, 'templates', 'claude', 'settings.json.hbs'),
      'utf8',
    );
    const mcp = await fs.readFile(
      path.join(out, 'templates', 'claude', 'mcp_servers.json.hbs'),
      'utf8',
    );
    expect(JSON.parse(settings)).toEqual({});
    expect(JSON.parse(mcp)).toEqual({});
  });
});
