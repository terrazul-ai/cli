import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '../../../src/core/errors';
import { planAndRender } from '../../../src/core/template-renderer';

import type { TerrazulError } from '../../../src/core/errors';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, 'utf8');
}

describe('core/template-renderer profiles', () => {
  let projectRoot = '';
  let agentModulesRoot = '';
  const alphaOutput = () => path.join(projectRoot, 'ALPHA.md');
  const betaOutput = () => path.join(projectRoot, 'BETA.md');

  beforeAll(async () => {
    projectRoot = await mkdtemp('tz-tr-prof-proj');
    agentModulesRoot = path.join(projectRoot, 'agent_modules');

    await write(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/app"\nversion = "0.2.0"\n\n[profiles]\nfocus = ["@demo/beta"]\n`,
    );

    const alphaRoot = path.join(agentModulesRoot, '@demo', 'alpha');
    const betaRoot = path.join(agentModulesRoot, '@demo', 'beta');

    await write(
      path.join(alphaRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/alpha"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/ALPHA.md.hbs"\n`,
    );
    await write(path.join(alphaRoot, 'templates', 'ALPHA.md.hbs'), 'Alpha payload');

    await write(
      path.join(betaRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/beta"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/BETA.md.hbs"\n`,
    );
    await write(path.join(betaRoot, 'templates', 'BETA.md.hbs'), 'Beta payload');
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await fs.rm(alphaOutput(), { force: true });
    await fs.rm(betaOutput(), { force: true });
  });

  it('renders only packages associated to the selected profile', async () => {
    const res = await planAndRender(projectRoot, agentModulesRoot, {
      profileName: 'focus',
      force: true,
    });

    const alphaExists = await fs.stat(alphaOutput()).catch(() => null);
    const betaExists = await fs.readFile(betaOutput(), 'utf8');

    expect(alphaExists).toBeNull();
    expect(betaExists).toBe('Beta payload');
    expect(res.written).toContain(betaOutput());
  });

  it('throws when profile references packages that are not installed', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/app"\nversion = "0.2.0"\n\n[profiles]\nfocus = ["@demo/beta"]\nmissing = ["@demo/gamma"]\n`,
      'utf8',
    );

    await expect(
      planAndRender(projectRoot, agentModulesRoot, {
        profileName: 'missing',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT } satisfies Partial<TerrazulError>);
  });
});
