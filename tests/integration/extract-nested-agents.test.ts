import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, it } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

describe('tz extract with nested .claude/agents structure', () => {
  it('recursively copies nested agents and preserves relative structure', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const out = await fs.mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'tz-ex-out-'));

    await fs.mkdir(path.join(proj.root, '.claude', 'agents', 'team', 'review'), {
      recursive: true,
    });
    await fs.writeFile(path.join(proj.root, '.claude', 'agents', 'index.md'), '# root', 'utf8');
    await fs.writeFile(
      path.join(proj.root, '.claude', 'agents', 'team', 'index.md'),
      '# team',
      'utf8',
    );
    await fs.writeFile(
      path.join(proj.root, '.claude', 'agents', 'team', 'review', 'senior.md'),
      '# senior',
      'utf8',
    );
    await proj.addCodexAgents('# enable');

    await run('node', [
      cli,
      'extract',
      '--from',
      proj.root,
      '--out',
      out,
      '--name',
      '@you/nested',
      '--pkg-version',
      '0.0.1',
    ]);

    // Expect mirror structure under templates/claude/agents + .hbs suffixes
    const files = [
      ['templates', 'claude', 'agents', 'index.md.hbs'],
      ['templates', 'claude', 'agents', 'team', 'index.md.hbs'],
      ['templates', 'claude', 'agents', 'team', 'review', 'senior.md.hbs'],
    ];
    for (const parts of files) {
      await fs.stat(path.join(out, ...parts));
    }
  });
});
