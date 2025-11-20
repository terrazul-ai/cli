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
  let fakeHomeDir = '';
  let storeRoot = '';
  const alphaOutput = () => path.join(agentModulesRoot, '@demo', 'alpha', 'ALPHA.md');
  const betaOutput = () => path.join(agentModulesRoot, '@demo', 'beta', 'BETA.md');

  beforeAll(async () => {
    // Setup fake home directory
    fakeHomeDir = await mkdtemp('tz-tr-prof-home');
    storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');

    projectRoot = await mkdtemp('tz-tr-prof-proj');
    agentModulesRoot = path.join(projectRoot, 'agent_modules');

    await write(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/app"\nversion = "0.2.0"\n\n[profiles]\nfocus = ["@demo/beta"]\n`,
    );

    // Create store structure with templates
    const alphaStoreRoot = path.join(storeRoot, '@demo', 'alpha', '1.0.0');
    const betaStoreRoot = path.join(storeRoot, '@demo', 'beta', '1.0.0');

    await write(
      path.join(alphaStoreRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/alpha"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/ALPHA.md.hbs"\n`,
    );
    await write(path.join(alphaStoreRoot, 'templates', 'ALPHA.md.hbs'), 'Alpha payload');

    await write(
      path.join(betaStoreRoot, 'agents.toml'),
      `\n[package]\nname = "@demo/beta"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/BETA.md.hbs"\n`,
    );
    await write(path.join(betaStoreRoot, 'templates', 'BETA.md.hbs'), 'Beta payload');

    // Create empty directories in agent_modules
    const alphaRoot = path.join(agentModulesRoot, '@demo', 'alpha');
    const betaRoot = path.join(agentModulesRoot, '@demo', 'beta');
    await fs.mkdir(alphaRoot, { recursive: true });
    await fs.mkdir(betaRoot, { recursive: true });

    // Create lockfile
    const lockfile = `
version = 1

[packages."@demo/alpha"]
version = "1.0.0"
resolved = "http://localhost/alpha"
integrity = "sha256-test1"
dependencies = { }

[packages."@demo/beta"]
version = "1.0.0"
resolved = "http://localhost/beta"
integrity = "sha256-test2"
dependencies = { }

[metadata]
generated_at = "2025-01-01T00:00:00.000Z"
cli_version = "0.1.0"
`;
    await write(path.join(projectRoot, 'agents-lock.toml'), lockfile.trim());
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    if (fakeHomeDir) {
      await fs.rm(fakeHomeDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  beforeEach(async () => {
    await fs.rm(alphaOutput(), { force: true });
    await fs.rm(betaOutput(), { force: true });
  });

  it('renders only packages associated to the selected profile', async () => {
    const res = await planAndRender(projectRoot, agentModulesRoot, {
      profileName: 'focus',
      force: true,
      storeDir: storeRoot,
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
        storeDir: storeRoot,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_ARGUMENT } satisfies Partial<TerrazulError>);
  });
});
