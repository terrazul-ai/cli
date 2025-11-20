import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { planAndRender } from '../../../src/core/template-renderer';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function write(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data, 'utf8');
}

describe('core/template-renderer-dirs', () => {
  let projectRoot = '';
  let agentModules = '';
  let fakeHomeDir = '';
  let originalHome: string | undefined;

  beforeAll(async () => {
    originalHome = process.env.HOME;
    fakeHomeDir = await mkdtemp('tz-tr-dirs-home');
    process.env.HOME = fakeHomeDir;

    projectRoot = await mkdtemp('tz-tr-dirs-proj');
    agentModules = path.join(projectRoot, 'agent_modules');
    await fs.mkdir(agentModules, { recursive: true });

    await write(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@test/project"\nversion = "0.1.0"\n`,
    );

    // Create store structure with templates
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const pkgStoreRoot = path.join(storeRoot, '@test', 'dirs', '1.0.0');

    await write(
      path.join(pkgStoreRoot, 'agents.toml'),
      `
[package]
name = "@test/dirs"
version = "1.0.0"

[exports.claude]
template = "templates/CLAUDE.md.hbs"
commandsDir = "templates/claude/commands"
skillsDir = "templates/claude/skills"
`,
    );

    await write(path.join(pkgStoreRoot, 'templates', 'CLAUDE.md.hbs'), '# Claude');
    await write(
      path.join(pkgStoreRoot, 'templates', 'claude', 'commands', 'test-cmd.sh'),
      'echo "test"',
    );
    await write(
      path.join(pkgStoreRoot, 'templates', 'claude', 'skills', 'test-skill.ts'),
      'console.log("skill")',
    );

    // Create empty directory in agent_modules
    const pkgRoot = path.join(agentModules, '@test', 'dirs');
    await fs.mkdir(pkgRoot, { recursive: true });

    // Create lockfile
    const lockfile = `
version = 1

[packages."@test/dirs"]
version = "1.0.0"
resolved = "local"
integrity = "sha256-test"
dependencies = {}

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
    if (originalHome !== undefined) process.env.HOME = originalHome;
  });

  it('renders files from commandsDir and skillsDir', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const res = await planAndRender(projectRoot, agentModules, {
      packageName: '@test/dirs',
      noCache: true,
      storeDir: storeRoot,
    });

    const packageRoot = path.join(agentModules, '@test', 'dirs');
    const expected = [
      path.join(packageRoot, 'CLAUDE.md'),
      path.join(packageRoot, 'claude', 'commands', 'test-cmd.sh'),
      path.join(packageRoot, 'claude', 'skills', 'test-skill.ts'),
    ];

    for (const f of expected) {
      const st = await fs.stat(f).catch(() => null);
      expect(st?.isFile()).toBe(true);
    }

    expect(res.written.length).toBeGreaterThanOrEqual(3);
  });
});
