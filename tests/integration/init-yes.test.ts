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

describe('tz init -y', () => {
  let tmpRoot = '';
  let projectDir = '';
  beforeEach(async () => {
    await ensureBuilt();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-inity-'));
    projectDir = path.join(tmpRoot, 'demoapp');
    await fs.mkdir(projectDir);
  });
  afterEach(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('uses defaults from CWD and includes compatibility', async () => {
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    await run('node', [cli, 'init', '-y'] as string[], { cwd: projectDir });

    const agentsToml = await fs.readFile(path.join(projectDir, 'agents.toml'), 'utf8');
    expect(agentsToml).toMatch(/\[package]/);
    expect(agentsToml).toMatch(/name = "@local\/demoapp"/);
    expect(agentsToml).toMatch(/\[compatibility]/);
    expect(agentsToml).toMatch(/claude-code = ">=0.2.0"/);
  });
});
