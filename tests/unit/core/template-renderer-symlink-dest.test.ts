import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { planAndRender } from '../../../src/core/template-renderer';

async function mkd(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function setupCodexPackage(
  project: string,
  storeRoot: string,
): Promise<{
  agentModulesRoot: string;
  pkgRoot: string;
  dest: string;
}> {
  const agentModulesRoot = path.join(project, 'agent_modules');
  const pkgRoot = path.join(agentModulesRoot, 'pkg');
  await fs.mkdir(pkgRoot, { recursive: true });

  // Create store structure with templates
  const pkgStoreRoot = path.join(storeRoot, 'pkg', '1.0.0');
  await fs.mkdir(path.join(pkgStoreRoot, 'templates'), { recursive: true });
  await fs.writeFile(
    path.join(pkgStoreRoot, 'agents.toml'),
    `\n[package]\nname = "@test/pkg"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(pkgStoreRoot, 'templates', 'AGENTS.md.hbs'),
    '# Rendered codex',
    'utf8',
  );

  // Create lockfile
  const lockfile = `
version = 1

[packages.pkg]
version = "1.0.0"
resolved = "http://localhost/pkg"
integrity = "sha256-test"
dependencies = { }

[metadata]
generated_at = "2025-01-01T00:00:00.000Z"
cli_version = "0.1.0"
`;
  await fs.writeFile(path.join(project, 'agents-lock.toml'), lockfile.trim(), 'utf8');

  return {
    agentModulesRoot,
    pkgRoot,
    dest: path.join(agentModulesRoot, 'pkg', 'AGENTS.md'),
  };
}

describe('template-renderer symlink destination safety', () => {
  it('replaces destination symlink when target remains inside project root', async () => {
    const project = await mkd('tz-proj-internal');
    const fakeHomeDir = await mkd('tz-home');
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const { agentModulesRoot, dest } = await setupCodexPackage(project, storeRoot);

    // Ensure an initial render so the file exists before we turn it into a symlink.
    await planAndRender(project, agentModulesRoot, { force: true, storeDir: storeRoot });

    const docsDir = path.join(project, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    const docsFile = path.join(docsDir, 'AGENTS.md');
    await fs.writeFile(docsFile, 'original-docs', 'utf8');
    await fs.rm(dest, { force: true });

    try {
      await fs.symlink(docsFile, dest);
    } catch (error) {
      const msg = String((error as { message?: string } | undefined)?.message || error);
      if (/(eperm|einval|operation not permitted|privilege)/i.test(msg)) {
        return; // symlink creation not allowed on this platform
      }
      throw error;
    }

    const res = await planAndRender(project, agentModulesRoot, {
      force: true,
      dryRun: false,
      storeDir: storeRoot,
    });

    expect(res.skipped.find((s) => s.dest === dest)).toBeUndefined();
    expect(res.backedUp.length).toBeGreaterThan(0);
    const backupPath = path.join(project, res.backedUp[0]);
    const backupContents = await fs.readFile(backupPath, 'utf8');
    expect(backupContents).toBe('original-docs');
    const stat = await fs.lstat(dest);
    expect(stat.isSymbolicLink()).toBe(false);
    const contents = await fs.readFile(dest, 'utf8');
    expect(contents).toContain('# Rendered codex');
    // Ensure original target file untouched
    const targetContents = await fs.readFile(docsFile, 'utf8');
    expect(targetContents).toBe('original-docs');
  });

  it('skips overwriting when destination symlink escapes project root', async () => {
    const project = await mkd('tz-proj-outside');
    const outside = await mkd('tz-outside');
    const fakeHomeDir = await mkd('tz-home2');
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');
    const { agentModulesRoot, dest } = await setupCodexPackage(project, storeRoot);

    await planAndRender(project, agentModulesRoot, { force: true, storeDir: storeRoot });

    const outsideFile = path.join(outside, 'AGENTS.md');
    await fs.writeFile(outsideFile, 'outside', 'utf8');
    await fs.rm(dest, { force: true });

    try {
      await fs.symlink(outsideFile, dest);
    } catch (error) {
      const msg = String((error as { message?: string } | undefined)?.message || error);
      if (/(eperm|einval|operation not permitted|privilege)/i.test(msg)) {
        return;
      }
      throw error;
    }

    const res = await planAndRender(project, agentModulesRoot, {
      force: true,
      dryRun: false,
      storeDir: storeRoot,
    });

    const skip = res.skipped.find((s) => s.dest === dest);
    expect(skip?.code).toBe('dest-symlink-outside');
    expect(res.backedUp.length).toBe(0);
    const outsideData = await fs.readFile(outsideFile, 'utf8');
    expect(outsideData).toBe('outside');
    const destStat = await fs.lstat(dest);
    expect(destStat.isSymbolicLink()).toBe(true);
  });

  it('skips writing when destination directory is a symlink outside project', async () => {
    const project = await mkd('tz-proj');
    const outside = await mkd('tz-out');
    const fakeHomeDir = await mkd('tz-home3');
    const storeRoot = path.join(fakeHomeDir, '.terrazul', 'store');

    // Build a minimal installed package in store
    const pkgStoreRoot = path.join(storeRoot, 'pkg', '1.0.0');
    await fs.mkdir(path.join(pkgStoreRoot, 'templates', 'claude'), { recursive: true });
    await fs.writeFile(
      path.join(pkgStoreRoot, 'templates', 'claude', 'settings.json.hbs'),
      '{"ok": true}',
      'utf8',
    );
    await fs.writeFile(
      path.join(pkgStoreRoot, 'agents.toml'),
      '[package]\nname = "@test/pkg"\nversion = "1.0.0"\n\n[exports.claude]\nsettings = "templates/claude/settings.json.hbs"\n',
      'utf8',
    );

    // Create empty agent_modules directory
    const am = path.join(project, 'agent_modules', 'pkg');
    await fs.mkdir(am, { recursive: true });

    // Create lockfile
    const lockfile = `
version = 1

[packages.pkg]
version = "1.0.0"
resolved = "http://localhost/pkg"
integrity = "sha256-test"
dependencies = { }

[metadata]
generated_at = "2025-01-01T00:00:00.000Z"
cli_version = "0.1.0"
`;
    await fs.writeFile(path.join(project, 'agents-lock.toml'), lockfile.trim(), 'utf8');

    // Make .claude a symlink pointing outside project
    const claudePath = path.join(project, '.claude');
    try {
      await fs.symlink(outside, claudePath, 'dir');
    } catch (error) {
      const msg = String((error as { message?: string } | undefined)?.message || error);
      if (/(eperm|einval|operation not permitted|privilege)/i.test(msg)) {
        return; // cannot create symlink on this platform; skip test
      }
      throw error;
    }

    const res = await planAndRender(project, path.join(project, 'agent_modules'), {
      force: true,
      dryRun: false,
      storeDir: storeRoot,
    });

    // With isolated rendering, file should render to agent_modules/pkg/claude/settings.json
    // The .claude symlink doesn't affect rendering anymore
    const targetDest = path.join(am, 'claude', 'settings.json');
    const written = res.written.includes(targetDest);
    expect(written).toBe(true);
    expect(res.backedUp.length).toBe(0);
    // Ensure file was written to agent_modules, NOT under the .claude symlink
    await expect(
      fs
        .stat(path.join(outside, 'settings.json'))
        .then(() => true)
        .catch(() => false),
    ).resolves.toBe(false);
  });
});
