import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { ensureBuilt, run } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('tz extract include claude local and user settings', () => {
  it('includes settings.local.json and user-scoped settings only with flags', async () => {
    const cli = await ensureBuilt();
    const proj = await mkdtemp('tz-extract-proj');
    const outA = await mkdtemp('tz-extract-out');
    const outB = await mkdtemp('tz-extract-out');
    const fakeHome = await mkdtemp('tz-extract-home');

    await fs.mkdir(path.join(proj, '.claude'), { recursive: true });
    await fs.writeFile(path.join(proj, '.claude', 'settings.json'), '{}', 'utf8');
    await fs.writeFile(
      path.join(proj, '.claude', 'settings.local.json'),
      '{"note":"local"}',
      'utf8',
    );
    // user settings with projects block
    const user = { projects: { [proj]: { env: { FOO: 'BAR' } } } };
    await fs.writeFile(path.join(fakeHome, '.claude.json'), JSON.stringify(user, null, 2), 'utf8');

    // Without flags: should not include local/user
    await run(
      'node',
      [
        cli,
        'extract',
        '--from',
        proj,
        '--out',
        outA,
        '--name',
        '@you/ctx',
        '--pkg-version',
        '1.0.0',
      ],
      { env: { HOME: fakeHome } },
    );
    await expect(
      fs.stat(path.join(outA, 'templates', 'claude', 'settings.local.json.hbs')),
    ).rejects.toBeTruthy();
    await expect(
      fs.stat(path.join(outA, 'templates', 'claude', 'user.settings.json.hbs')),
    ).rejects.toBeTruthy();

    // With flags: both should be present and sanitized
    await run(
      'node',
      [
        cli,
        'extract',
        '--from',
        proj,
        '--out',
        outB,
        '--name',
        '@you/ctx',
        '--pkg-version',
        '1.0.0',
        '--include-claude-local',
        '--include-claude-user',
      ],
      { env: { HOME: fakeHome } },
    );
    const local = await fs.readFile(
      path.join(outB, 'templates', 'claude', 'settings.local.json.hbs'),
      'utf8',
    );
    const userOut = await fs.readFile(
      path.join(outB, 'templates', 'claude', 'user.settings.json.hbs'),
      'utf8',
    );
    expect(local).toMatch(/{\s*"note"/);
    expect(userOut).toMatch(/env/);
    expect(userOut).toMatch(/{{ env\.FOO }}/);
  });
});
