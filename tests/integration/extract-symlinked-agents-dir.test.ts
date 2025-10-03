import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { run } from '../helpers/cli';

async function mkdtemp(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

async function trySymlink(
  target: string,
  linkPath: string,
  type: 'file' | 'dir' = 'dir',
): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (error: unknown) {
    const msg = String((error as { message?: string } | undefined)?.message || error);
    if (/(eperm|einval|operation not permitted|a required privilege is not held)/i.test(msg))
      return false;
    throw error;
  }
}

describe('tz extract skips when .claude/agents is a symlink', () => {
  it('ignores symlinked agents directory and does not include subagentsDir export', async () => {
    // Force a fresh build so dist reflects current sources
    await run('node', ['build.config.mjs']);
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    const proj = await mkdtemp('tz-extract-proj');
    const out = await mkdtemp('tz-extract-out');

    // Minimal required input so extract runs
    await fs.writeFile(path.join(proj, 'AGENTS.md'), '# codex', 'utf8');

    // Create a real dir with agents content elsewhere inside project
    const realAgents = path.join(proj, 'real-agents');
    await fs.mkdir(realAgents, { recursive: true });
    await fs.writeFile(path.join(realAgents, 'a.md'), '# A', 'utf8');

    // Create .claude and symlink .claude/agents -> real-agents
    const claudeDir = path.join(proj, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    const linkPath = path.join(claudeDir, 'agents');
    const canLink = await trySymlink(
      path.relative(claudeDir, realAgents) || realAgents,
      linkPath,
      'dir',
    );

    if (!canLink) {
      // Environment cannot create dir symlinks; skip assertion
      return;
    }

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

    // There should be no copied subagent templates when dir is symlinked
    await expect(
      fs.stat(path.join(out, 'templates', 'claude', 'agents', 'a.md.hbs')),
    ).rejects.toBeTruthy();

    // And manifest should not include subagentsDir
    const toml = await fs.readFile(path.join(out, 'agents.toml'), 'utf8');
    expect(toml).not.toMatch(/subagentsDir/);
  });
});
