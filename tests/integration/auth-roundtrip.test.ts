import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function run(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const mergedEnv: NodeJS.ProcessEnv = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { env: mergedEnv, encoding: 'utf8' }, (err, stdout, stderr) => {
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
    await run('node', ['build.config.mjs']);
  }
}

describe('auth roundtrip (integration)', () => {
  let tmpDir = '';

  beforeEach(async () => {
    await ensureBuilt();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-int-auth-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('login with --token then logout clears token', async () => {
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    const env = { ...process.env, HOME: tmpDir, USERPROFILE: tmpDir };

    await run(
      'node',
      [cli, 'auth', 'login', '--token', 'tz_pat_int_123', '--username', 'bob'] as string[],
      { env },
    );
    const cfgPath = path.join(tmpDir, '.terrazul', 'config.json');
    const data = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(data.token).toBe('tz_pat_int_123');
    expect(data.username).toBe('bob');

    await run('node', [cli, 'auth', 'logout'] as string[], { env });
    const data2 = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    expect(data2.token).toBeUndefined();
    expect(data2.username).toBeUndefined();
  });
});
