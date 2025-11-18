import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const env = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

describe('integration: apply filter by package', () => {
  let tmpHome = '';
  let tmpProj = '';
  let cli = '';

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-home-'));
    tmpProj = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-proj-'));
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    // Use a dummy registry URL — publish not needed; we only operate on local agent_modules
    await fs.writeFile(
      path.join(cfgDir, 'config.json'),
      JSON.stringify(
        { registry: 'http://localhost:8787', cache: { ttl: 3600, maxSize: 500 }, telemetry: false },
        null,
        2,
      ),
    );
    cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    try {
      await fs.stat(cli);
    } catch {
      await run('node', ['build.config.mjs']);
    }

    // Create a minimal project manifest
    const manifest = `\n[package]\nname = "@demo/test"\nversion = "0.1.0"\n`;
    await fs.writeFile(path.join(tmpProj, 'agents.toml'), manifest, 'utf8');

    // Create packages in store with templates
    const storeRoot = path.join(tmpHome, '.terrazul', 'store');
    const pkg1Store = path.join(storeRoot, '@a', 'one', '1.0.0');
    const pkg2Store = path.join(storeRoot, '@b', 'two', '1.0.0');
    await fs.mkdir(path.join(pkg1Store, 'templates'), { recursive: true });
    await fs.mkdir(path.join(pkg2Store, 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(pkg1Store, 'agents.toml'),
      `\n[package]\nname = "@a/one"\nversion = "1.0.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(pkg2Store, 'agents.toml'),
      `\n[package]\nname = "@b/two"\nversion = "1.0.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(path.join(pkg1Store, 'templates', 'CLAUDE.md.hbs'), '# One', 'utf8');
    await fs.writeFile(path.join(pkg2Store, 'templates', 'CLAUDE.md.hbs'), '# Two', 'utf8');

    // Create empty directories in agent_modules
    const pkg1 = path.join(tmpProj, 'agent_modules', '@a', 'one');
    const pkg2 = path.join(tmpProj, 'agent_modules', '@b', 'two');
    await fs.mkdir(pkg1, { recursive: true });
    await fs.mkdir(pkg2, { recursive: true });

    // Create lockfile
    const lockfile = `
version = 1

[packages."@a/one"]
version = "1.0.0"
resolved = "http://localhost/one"
integrity = "sha256-test1"
dependencies = { }

[packages."@b/two"]
version = "1.0.0"
resolved = "http://localhost/two"
integrity = "sha256-test2"
dependencies = { }

[metadata]
generated_at = "2025-01-01T00:00:00.000Z"
cli_version = "0.1.0"
`;
    await fs.writeFile(path.join(tmpProj, 'agents-lock.toml'), lockfile.trim(), 'utf8');
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpProj, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      await fs.rm(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('applies only the selected package', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    // apply only @a/one
    await run('node', [cli, 'apply', '@a/one', '--no-cache'], { cwd: tmpProj, env });

    // Check that @a/one was rendered in agent_modules
    const oneFile = await fs.readFile(
      path.join(tmpProj, 'agent_modules', '@a', 'one', 'CLAUDE.md'),
      'utf8',
    );
    expect(oneFile).toContain('One');

    // Check that @b/two was NOT rendered (filtering works)
    const twoExists = await fs
      .stat(path.join(tmpProj, 'agent_modules', '@b', 'two', 'CLAUDE.md'))
      .catch(() => null);
    expect(twoExists).toBeNull();

    // Optional: If project root CLAUDE.md was created, verify it has @-mention to @a/one
    const rootClaudeExists = await fs.stat(path.join(tmpProj, 'CLAUDE.md')).catch(() => null);
    if (rootClaudeExists) {
      const rootClaude = await fs.readFile(path.join(tmpProj, 'CLAUDE.md'), 'utf8');
      expect(rootClaude).toContain('@agent_modules/@a/one/CLAUDE.md');
    }
  });
});
