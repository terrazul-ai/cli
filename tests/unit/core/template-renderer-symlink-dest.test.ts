import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { planAndRender } from '../../../src/core/template-renderer';

async function mkd(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function setupCodexPackage(project: string): Promise<{
  agentModulesRoot: string;
  pkgRoot: string;
  dest: string;
}> {
  const agentModulesRoot = path.join(project, 'agent_modules');
  const pkgRoot = path.join(agentModulesRoot, 'pkg');
  await fs.mkdir(path.join(pkgRoot, 'templates'), { recursive: true });
  await fs.writeFile(
    path.join(pkgRoot, 'agents.toml'),
    `\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n`,
    'utf8',
  );
  await fs.writeFile(path.join(pkgRoot, 'templates', 'AGENTS.md.hbs'), '# Rendered codex', 'utf8');
  return {
    agentModulesRoot,
    pkgRoot,
    dest: path.join(project, 'AGENTS.md'),
  };
}

describe('template-renderer symlink destination safety', () => {
  it('replaces destination symlink when target remains inside project root', async () => {
    const project = await mkd('tz-proj-internal');
    const { agentModulesRoot, dest } = await setupCodexPackage(project);

    // Ensure an initial render so the file exists before we turn it into a symlink.
    await planAndRender(project, agentModulesRoot, { force: true });

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
    const { agentModulesRoot, dest } = await setupCodexPackage(project);

    await planAndRender(project, agentModulesRoot, { force: true });

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

    // Build a minimal installed package under agent_modules
    const am = path.join(project, 'agent_modules', 'pkg');
    await fs.mkdir(path.join(am, 'templates', 'claude'), { recursive: true });
    await fs.writeFile(
      path.join(am, 'templates', 'claude', 'settings.json.hbs'),
      '{"ok": true}',
      'utf8',
    );
    await fs.writeFile(
      path.join(am, 'agents.toml'),
      '[exports.claude]\nsettings = "templates/claude/settings.json.hbs"\n',
      'utf8',
    );

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
    });

    // Should skip due to symlinked ancestor outside project
    const targetDest = path.join(project, '.claude', 'settings.json');
    const skipEntry = res.skipped.find((s) => s.dest === targetDest);
    expect(skipEntry?.code).toBe('symlink-ancestor-outside');
    expect(res.backedUp.length).toBe(0);
    // Ensure no file was written under symlink target
    await expect(
      fs
        .stat(path.join(outside, 'settings.json'))
        .then(() => true)
        .catch(() => false),
    ).resolves.toBe(false);
  });
});
