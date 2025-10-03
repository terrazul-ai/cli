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

describe('integration: publish invalid', () => {
  let tmpHome = '';
  let tmpPkg = '';
  let cli = '';

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-home-'));
    tmpPkg = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-pkg-'));
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    // token present but invalid package layout
    await fs.writeFile(
      path.join(cfgDir, 'config.json'),
      JSON.stringify(
        {
          registry: 'http://localhost:8787',
          cache: { ttl: 3600, maxSize: 500 },
          telemetry: false,
          token: 'tz_token_test',
        },
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
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpPkg, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      await fs.rm(tmpHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('fails when a referenced template is missing', async () => {
    await fs.writeFile(
      path.join(tmpPkg, 'agents.toml'),
      `\n[package]\nname = "@e2e/pub-invalid"\nversion = "0.1.0"\n\n[exports.claude]\ntemplate = "templates/MISSING.hbs"\n`,
      'utf8',
    );
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await expect(run('node', [cli, 'publish', '--dry-run'], { cwd: tmpPkg, env })).rejects.toThrow(
      /manifest validation failed|missing template/i,
    );
  });
});
