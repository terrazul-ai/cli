import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

describe('tz extract - root-level CLAUDE.md', () => {
  it('detects CLAUDE.md in project root and generates template + manifest export', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const out = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'tz-ex-root-'));
    const pr = proj.root;
    // Write root-level CLAUDE.md
    await fs.writeFile(path.join(pr, 'CLAUDE.md'), 'Root level Claude spec', 'utf8');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/claude-root',
      '--pkg-version',
      '1.0.0',
    ]);

    const manifestPath = path.join(out, 'agents.toml');
    const agentsToml = await fs.readFile(manifestPath, 'utf8');
    expect(agentsToml).toMatch(/\[exports\.claude]/);
    expect(agentsToml).toMatch(/template = "templates\/CLAUDE\.md\.hbs"/);
    const filePath = path.join(out, 'templates', 'CLAUDE.md.hbs');
    const st = await fs.stat(filePath);
    expect(st.isFile()).toBe(true);
  });
});
