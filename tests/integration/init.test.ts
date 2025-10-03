import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const env = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = stdout;
      const errOut = stderr;
      if (err) {
        const message: string = errOut && errOut.length > 0 ? errOut : err.message;
        return reject(new Error(message));
      }
      resolve({ stdout: out, stderr: errOut });
    });
  });
}

async function ensureBuilt(): Promise<void> {
  try {
    await fs.stat(path.join(process.cwd(), 'dist', 'tz.mjs'));
  } catch {
    await run('node', ['build.config.mjs'] as string[]);
  }
}

describe('tz init', () => {
  let tmpDir = '';
  beforeEach(async () => {
    await ensureBuilt();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-init-'));
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates agents.toml and updates .gitignore', async () => {
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    await run(
      'node',
      [cli, 'init', '--name', '@test/demo', '--description', 'Demo package'] as string[],
      { cwd: tmpDir },
    );

    const agentsToml = await fs.readFile(path.join(tmpDir, 'agents.toml'), 'utf8');
    expect(agentsToml).toMatch(/\[package]/);
    expect(agentsToml).toMatch(/name = "@test\/demo"/);
    expect(agentsToml).toMatch(/version = "0.1.0"/);
    expect(agentsToml).toMatch(/license = "MIT"/);
    // compatibility section is conditional; do not assert it here

    const gi = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8').catch(() => '');
    expect(gi.includes('agent_modules/')).toBe(true);
  });
});
