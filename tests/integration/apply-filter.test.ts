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

    // Scaffold two installed packages locally
    const pkg1 = path.join(tmpProj, 'agent_modules', '@a', 'one');
    const pkg2 = path.join(tmpProj, 'agent_modules', '@b', 'two');
    await fs.mkdir(path.join(pkg1, 'templates', 'claude'), { recursive: true });
    await fs.mkdir(path.join(pkg2, 'templates', 'claude'), { recursive: true });
    await fs.writeFile(
      path.join(pkg1, 'agents.toml'),
      `\n[package]\nname = "@a/one"\nversion = "1.0.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(pkg2, 'agents.toml'),
      `\n[package]\nname = "@b/two"\nversion = "1.0.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(path.join(pkg1, 'templates', 'CLAUDE.md.hbs'), '# One', 'utf8');
    await fs.writeFile(path.join(pkg2, 'templates', 'CLAUDE.md.hbs'), '# Two', 'utf8');
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
    await run('node', [cli, 'apply', '@a/one'], { cwd: tmpProj, env });
    const one = await fs.readFile(path.join(tmpProj, 'CLAUDE.md'), 'utf8');
    expect(one).toContain('One');
    const twoExists = await fs.stat(path.join(tmpProj, '.claude', 'CLAUDE.md')).catch(() => null);
    expect(twoExists).toBeNull();
  });
});
