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

describe('core/template-renderer', () => {
  let projectRoot = '';
  let agentModules = '';
  let pkgRoot = '';
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let fakeHomeDir = '';

  beforeAll(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    fakeHomeDir = await mkdtemp('tz-tr-home');
    process.env.HOME = fakeHomeDir;
    process.env.USERPROFILE = fakeHomeDir;

    projectRoot = await mkdtemp('tz-tr-proj');
    agentModules = path.join(projectRoot, 'agent_modules');
    await fs.mkdir(agentModules, { recursive: true });
    // minimal agents.toml in project to provide project name/version context
    await write(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@test/project"\nversion = "0.1.0"\n`,
    );

    // Create store structure with templates
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const pkgStoreRoot = path.join(storeRoot, '@test', 'demo', '1.2.3');
    await write(
      path.join(pkgStoreRoot, 'agents.toml'),
      `\n[package]\nname = "@test/demo"\nversion = "1.2.3"\n\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\nsettingsLocal = "templates/claude/settings.local.json.hbs"\nsubagentsDir = "templates/claude/agents"\n\n[exports.copilot]\ntemplate = "templates/COPILOT.md.hbs"\n\n[exports.cursor]\ntemplate = "templates/cursor.rules.mdc.hbs"\n`,
    );
    await write(
      path.join(pkgStoreRoot, 'templates', 'AGENTS.md.hbs'),
      '# Codex for {{project.name}}',
    );
    await write(path.join(pkgStoreRoot, 'templates', 'CLAUDE.md.hbs'), '# Claude {{pkg.name}}');
    await write(
      path.join(pkgStoreRoot, 'templates', 'claude', 'settings.local.json.hbs'),
      '{ "pkg": "{{pkg.name}}", "when": "{{now}}" }',
    );
    await write(
      path.join(pkgStoreRoot, 'templates', 'claude', 'agents', 'reviewer.md.hbs'),
      'agent for {{project.version}}',
    );
    await write(path.join(pkgStoreRoot, 'templates', 'COPILOT.md.hbs'), 'copilot: {{pkg.version}}');
    await write(path.join(pkgStoreRoot, 'templates', 'cursor.rules.mdc.hbs'), 'rule: {{env.USER}}');

    // Create empty directory in agent_modules (will contain rendered files when isolated=true)
    pkgRoot = path.join(agentModules, '@test', 'demo');
    await fs.mkdir(pkgRoot, { recursive: true });

    // Create lockfile
    const lockfile = `
version = 1

[packages."@test/demo"]
version = "1.2.3"
resolved = "http://localhost/demo"
integrity = "sha256-test"
dependencies = { }

[metadata]
generated_at = "2025-01-01T00:00:00.000Z"
cli_version = "0.1.0"
`;
    const lockfilePath = path.join(projectRoot, 'agents-lock.toml');
    await write(lockfilePath, lockfile.trim());

    // Ensure lockfile is fully written to disk (prevents CI race conditions)
    const fd = await fs.open(lockfilePath, 'r');
    await fd.sync();
    await fd.close();

    // Verify test setup completed successfully
    const requiredPaths = [
      pkgStoreRoot,
      path.join(pkgStoreRoot, 'agents.toml'),
      path.join(pkgStoreRoot, 'templates', 'AGENTS.md.hbs'),
      path.join(pkgStoreRoot, 'templates', 'CLAUDE.md.hbs'),
      lockfilePath,
      path.join(agentModules, '@test', 'demo'),
    ];
    for (const p of requiredPaths) {
      const exists = await fs.stat(p).catch(() => null);
      if (!exists) {
        throw new Error(`Test setup failed: required path does not exist: ${p}`);
      }
    }
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    if (fakeHomeDir) {
      await fs.rm(fakeHomeDir, { recursive: true, force: true }).catch(() => {});
    }
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  });

  it('renders templates to expected destinations', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const res = await planAndRender(projectRoot, agentModules, {
      packageName: '@test/demo',
      noCache: true,
      storeDir: storeRoot,
    });
    // With isolated rendering (now default), all files render to agent_modules/@test/demo/
    const packageRoot = path.join(agentModules, '@test', 'demo');
    const expected = [
      path.join(packageRoot, 'CLAUDE.md'),
      path.join(packageRoot, 'AGENTS.md'),
      path.join(packageRoot, 'claude', 'settings.local.json'),
      path.join(packageRoot, 'claude', 'agents', 'reviewer.md'),
      path.join(packageRoot, 'cursor.rules.mdc'),
      path.join(packageRoot, 'COPILOT.md'), // Template is COPILOT.md.hbs, so output is COPILOT.md
    ];
    for (const f of expected) {
      const st = await fs.stat(f).catch(() => null);
      if (!st || !st.isFile()) {
        // Enhanced error reporting for CI debugging
        const diagnostics = [
          `\nFile does not exist: ${f}`,
          `Written files (${res.written.length}): ${res.written.join(', ')}`,
          `Skipped files (${res.skipped.length}): ${res.skipped.map((s) => `${s.dest} (${s.code})`).join(', ')}`,
        ];
        throw new Error(diagnostics.join('\n'));
      }
      expect(st && st.isFile()).toBe(true);
    }
    expect(res.written.length).toBeGreaterThanOrEqual(5);
  });

  it('skips existing files unless forced', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const before = await planAndRender(projectRoot, agentModules, {
      packageName: '@test/demo',
      force: false,
      storeDir: storeRoot,
    });
    expect(before.skipped.length).toBeGreaterThan(0);
    expect(before.backedUp.length).toBe(0);
    const after = await planAndRender(projectRoot, agentModules, {
      packageName: '@test/demo',
      force: true,
      storeDir: storeRoot,
    });
    expect(after.written.length).toBeGreaterThan(0);
    expect(after.backedUp.length).toBeGreaterThan(0);
  });
});
