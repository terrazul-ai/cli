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

describe('core/template-renderer - isolated rendering', () => {
  let projectRoot = '';
  let agentModules = '';
  let pkg1Root = '';
  let pkg2Root = '';
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let fakeHomeDir = '';

  beforeAll(async () => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    fakeHomeDir = await mkdtemp('tz-tr-isolated-home');
    process.env.HOME = fakeHomeDir;
    process.env.USERPROFILE = fakeHomeDir;

    projectRoot = await mkdtemp('tz-tr-isolated');
    agentModules = path.join(projectRoot, 'agent_modules');
    await fs.mkdir(agentModules, { recursive: true });

    // Create store directory for package sources
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');

    // Project manifest
    await write(
      path.join(projectRoot, 'agents.toml'),
      `\n[package]\nname = "@test/project"\nversion = "0.1.0"\n`,
    );

    // Package 1: @test/pkg1 - Create in store with same directory structure
    const pkg1StoreRoot = path.join(storeRoot, '@test', 'pkg1', '1.0.0');
    await write(
      path.join(pkg1StoreRoot, 'agents.toml'),
      `\n[package]\nname = "@test/pkg1"\nversion = "1.0.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
    );
    await write(path.join(pkg1StoreRoot, 'templates', 'CLAUDE.md.hbs'), '# Package 1 Context');

    // Create empty directory in agent_modules for pkg1 (will contain rendered files)
    pkg1Root = path.join(agentModules, '@test', 'pkg1');
    await fs.mkdir(pkg1Root, { recursive: true });

    // Package 2: @test/pkg2 - Create in store with same directory structure
    const pkg2StoreRoot = path.join(storeRoot, '@test', 'pkg2', '2.0.0');
    await write(
      path.join(pkg2StoreRoot, 'agents.toml'),
      `\n[package]\nname = "@test/pkg2"\nversion = "2.0.0"\n\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n`,
    );
    await write(path.join(pkg2StoreRoot, 'templates', 'AGENTS.md.hbs'), '# Package 2 Context');

    // Create empty directory in agent_modules for pkg2 (will contain rendered files)
    pkg2Root = path.join(agentModules, '@test', 'pkg2');
    await fs.mkdir(pkg2Root, { recursive: true });

    // Create lockfile with package entries
    const lockfile = `
version = 1

[packages."@test/pkg1"]
version = "1.0.0"
resolved = "http://localhost/pkg1"
integrity = "sha256-test1"
dependencies = { }

[packages."@test/pkg2"]
version = "2.0.0"
resolved = "http://localhost/pkg2"
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
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  });

  it('renders templates to isolated package directories when isolated=true', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    await planAndRender(projectRoot, agentModules, {
      isolated: true,
      noCache: true,
      storeDir: storeRoot,
    });

    // Expect files directly in agent_modules/@test/pkg1/ and agent_modules/@test/pkg2/
    const pkg1Rendered = path.join(pkg1Root, 'CLAUDE.md');
    const pkg2Rendered = path.join(pkg2Root, 'AGENTS.md');

    const st1 = await fs.stat(pkg1Rendered).catch(() => null);
    const st2 = await fs.stat(pkg2Rendered).catch(() => null);

    expect(st1 && st1.isFile()).toBe(true);
    expect(st2 && st2.isFile()).toBe(true);

    // Check content
    const content1 = await fs.readFile(pkg1Rendered, 'utf8');
    const content2 = await fs.readFile(pkg2Rendered, 'utf8');

    expect(content1).toContain('Package 1 Context');
    expect(content2).toContain('Package 2 Context');
  });

  it('tracks packageFiles map when isolated=true', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const res = await planAndRender(projectRoot, agentModules, {
      isolated: true,
      noCache: true,
      force: true,
      storeDir: storeRoot,
    });

    expect(res.packageFiles).toBeDefined();
    expect(res.packageFiles?.size).toBe(2);
    expect(res.packageFiles?.has('@test/pkg1')).toBe(true);
    expect(res.packageFiles?.has('@test/pkg2')).toBe(true);

    const pkg1Files = res.packageFiles?.get('@test/pkg1') ?? [];
    const pkg2Files = res.packageFiles?.get('@test/pkg2') ?? [];

    expect(pkg1Files.length).toBeGreaterThan(0);
    expect(pkg2Files.length).toBeGreaterThan(0);

    // Files should be directly under package directory
    for (const file of pkg1Files) {
      expect(file).toContain(path.join('agent_modules', '@test', 'pkg1'));
      expect(file).not.toContain('rendered'); // No rendered subdirectory
    }
    for (const file of pkg2Files) {
      expect(file).toContain(path.join('agent_modules', '@test', 'pkg2'));
      expect(file).not.toContain('rendered'); // No rendered subdirectory
    }
  });

  it('does NOT render to project root when isolated=true', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    await planAndRender(projectRoot, agentModules, {
      isolated: true,
      noCache: true,
      force: true,
      storeDir: storeRoot,
    });

    // These should NOT exist in project root
    const rootClaude = path.join(projectRoot, 'CLAUDE.md');
    const rootAgents = path.join(projectRoot, 'AGENTS.md');

    const st1 = await fs.stat(rootClaude).catch(() => null);
    const st2 = await fs.stat(rootAgents).catch(() => null);

    expect(st1).toBeNull();
    expect(st2).toBeNull();
  });

  it('renders to project root when isolated=false (default behavior)', async () => {
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const res = await planAndRender(projectRoot, agentModules, {
      isolated: false,
      noCache: true,
      storeDir: storeRoot,
    });

    // Should render to project root
    const rootClaude = path.join(projectRoot, 'CLAUDE.md');
    const rootAgents = path.join(projectRoot, 'AGENTS.md');

    const st1 = await fs.stat(rootClaude).catch(() => null);
    const st2 = await fs.stat(rootAgents).catch(() => null);

    expect(st1 && st1.isFile()).toBe(true);
    expect(st2 && st2.isFile()).toBe(true);

    // packageFiles should still be tracked
    expect(res.packageFiles).toBeDefined();
  });
});
