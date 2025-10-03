import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

describe('tz extract with .cursor/rules as a file', () => {
  it('reads a single file and writes a template', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const out = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'tz-ex-out-'));

    await proj.addCodexAgents('# enable');
    // Create rules as a file
    await fs.mkdir(path.join(proj.root, '.cursor'), { recursive: true });
    await fs.writeFile(path.join(proj.root, '.cursor', 'rules'), 'alpha\nbeta', 'utf8');

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

    const rules = await fs.readFile(path.join(out, 'templates', 'cursor.rules.hbs'), 'utf8');
    expect(rules).toContain('alpha');
    expect(rules).toContain('beta');
  });
});
