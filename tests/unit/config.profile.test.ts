import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { readUserConfigFrom } from '../../src/utils/config';

describe('config: profile.tools + files', () => {
  it('parses profile tools and merges default files', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tz-cfg-'));
    const file = path.join(dir, 'config.json');
    await writeFile(
      file,
      JSON.stringify({
        profile: {
          tools: [
            { type: 'codex', command: 'codex', args: ['exec'] },
            { type: 'cursor' },
            { type: 'copilot' },
          ],
        },
        context: { files: { claude: 'C.md' } },
      }),
      'utf8',
    );
    const cfg = await readUserConfigFrom(file);
    expect(cfg.profile?.tools?.[0]?.type).toBe('codex');
    // @ts-expect-error runtime assertion for defaults merge
    expect(cfg.context.files.claude).toBe('C.md');
    // @ts-expect-error runtime assertion for defaults merge
    expect(cfg.context.files.cursor).toBe('.cursor/rules.mdc');
    // @ts-expect-error runtime assertion for defaults merge
    expect(cfg.context.files.codex).toBe('AGENTS.md');
    // @ts-expect-error runtime assertion for defaults merge
    expect(cfg.context.files.copilot).toBe('.github/copilot-instructions.md');
  });
});
