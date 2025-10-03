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

describe('integration: apply with profiles', () => {
  let tmpHome = '';
  let tmpProj = '';
  let cli = '';

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-home-'));
    tmpProj = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-proj-'));

    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
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

    const manifest = `\n[package]\nname = "@demo/app"\nversion = "0.1.0"\n\n[profiles]\nfocus = ["@a/one"]\n`;
    await fs.writeFile(path.join(tmpProj, 'agents.toml'), manifest, 'utf8');

    const pkg1 = path.join(tmpProj, 'agent_modules', '@a', 'one');
    await fs.mkdir(path.join(pkg1, 'templates', 'claude'), { recursive: true });
    await fs.writeFile(
      path.join(pkg1, 'agents.toml'),
      `\n[package]\nname = "@a/one"\nversion = "1.0.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(path.join(pkg1, 'templates', 'CLAUDE.md.hbs'), '# Profile One', 'utf8');

    const pkg2 = path.join(tmpProj, 'agent_modules', '@b', 'two');
    await fs.mkdir(path.join(pkg2, 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(pkg2, 'agents.toml'),
      `\n[package]\nname = "@b/two"\nversion = "1.0.0"\n\n[exports.codex]\ntemplate = "templates/AGENTS.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(path.join(pkg2, 'templates', 'AGENTS.md.hbs'), '# Profile Two', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(tmpProj, { recursive: true, force: true });
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('applies only packages included in the selected profile', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'apply', '--profile', 'focus', '--force'], { cwd: tmpProj, env });

    const claude = await fs.readFile(path.join(tmpProj, 'CLAUDE.md'), 'utf8');
    expect(claude.trim()).toBe('# Profile One');
    const agentsExists = await fs.stat(path.join(tmpProj, 'AGENTS.md')).catch(() => null);
    expect(agentsExists).toBeNull();
  });

  it('fails when the profile references missing packages', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await fs.writeFile(
      path.join(tmpProj, 'agents.toml'),
      `\n[package]\nname = "@demo/app"\nversion = "0.1.0"\n\n[profiles]\nmissing = ["@not/installed"]\n`,
      'utf8',
    );

    await expect(
      run('node', [cli, 'apply', '--profile', 'missing'], { cwd: tmpProj, env }),
    ).rejects.toThrow();
  });
});
