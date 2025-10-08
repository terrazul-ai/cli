import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, filesDigest, run, runReject } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract misc scenarios', () => {
  it('errors when nothing recognized', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');
    const fakeHome = await mkdtemp('tz-extract-home');
    const res = await runReject(
      'node',
      [
        cli,
        'extract',
        '--from',
        proj,
        '--out',
        out,
        '--name',
        '@you/ctx',
        '--pkg-version',
        '1.0.0',
      ],
      {
        env: {
          HOME: fakeHome,
          USERPROFILE: fakeHome,
        },
      },
    );
    expect(res.stderr + res.stdout).toMatch(/No recognized inputs/);
  });

  it('sanitizes Windows path in mcp_servers.json', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');
    await fs.mkdir(path.join(proj, '.claude'), { recursive: true });
    const mcp = { tool: { command: String.raw`C:\\Program Files\\tool.exe`, args: [] } };
    await fs.writeFile(
      path.join(proj, '.claude', 'mcp_servers.json'),
      JSON.stringify(mcp, null, 2),
      'utf8',
    );
    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    const outJson = await fs.readFile(
      path.join(out, 'templates', 'claude', 'mcp_servers.json.hbs'),
      'utf8',
    );
    expect(outJson).toMatch(/{{ replace_me }}/);
  });

  it('copies nested subagents preserving structure', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');
    await fs.mkdir(path.join(proj, '.claude', 'agents', 'team', 'review'), { recursive: true });
    await fs.writeFile(
      path.join(proj, '.claude', 'agents', 'team', 'review', 'qa.md'),
      'QA',
      'utf8',
    );
    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    await fs.stat(path.join(out, 'templates', 'claude', 'agents', 'team', 'review', 'qa.md.hbs'));
  });

  it('is deterministic: same inputs produce identical outputs', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const out1 = await mkdtemp('tz-extract-out');
    const out2 = await mkdtemp('tz-extract-out');
    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# A', 'utf8');
    await fs.mkdir(path.join(proj, '.github'), { recursive: true });
    await fs.writeFile(path.join(proj, '.github', 'copilot-instructions.md'), 'B', 'utf8');
    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out1,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    await run('node', [
      cli,
      'extract',
      '--from',
      proj,
      '--out',
      out2,
      '--name',
      '@you/ctx',
      '--pkg-version',
      '1.0.0',
    ]);
    const h1 = await filesDigest(out1);
    const h2 = await filesDigest(out2);
    expect(h1).toBe(h2);
  });
});
