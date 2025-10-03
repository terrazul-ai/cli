import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';
import { createTempProject } from '../helpers/project';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract filters .cursor/rules to .txt and .mdc', () => {
  it('includes .txt and .mdc, excludes others when rules is a directory', async () => {
    const cli = await ensureBuilt();
    const proj = await createTempProject();
    const out = await mkdtemp('tz-extract-out');

    // Ensure extract runs (cursor rules alone is sufficient, but add codex to be explicit)
    await proj.addCodexAgents('# enable');

    // Populate .cursor/rules with mixed extensions
    await proj.addCursorRulesFile('a.txt', 'ALPHA');
    await proj.addCursorRulesFile('b.mdc', 'BETA');
    await proj.addCursorRulesFile('c.md', 'CHARLIE_MD');
    await proj.addCursorRulesFile('d.png', 'PNG_BYTES');
    await proj.addCursorRulesFile('E', 'NO_EXT');
    await proj.addCursorRulesFile('F.TXT', 'FOXTROT');

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
    // Included
    expect(rules).toContain('ALPHA');
    expect(rules).toContain('BETA');
    expect(rules).toContain('FOXTROT');
    // Excluded
    expect(rules).not.toContain('CHARLIE_MD');
    expect(rules).not.toContain('PNG_BYTES');
    expect(rules).not.toContain('NO_EXT');
  });
});
