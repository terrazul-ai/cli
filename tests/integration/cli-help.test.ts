import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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

describe('cli --help lists commands', () => {
  it('prints all command names', async () => {
    await ensureBuilt();
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    const { stdout } = await run('node', [cli, '--help'] as string[]);
    expect(stdout).toMatch(/init/);
    expect(stdout).toMatch(/install/);
    expect(stdout).toMatch(/update/);
    expect(stdout).toMatch(/publish/);
    expect(stdout).toMatch(/auth/);
    expect(stdout).toMatch(/run/);
    expect(stdout).toMatch(/yank/);
    expect(stdout).toMatch(/unyank/);
    expect(stdout).toMatch(/uninstall/);
    expect(stdout).toMatch(/extract/);
    expect(stdout).toMatch(/link/);
    expect(stdout).toMatch(/unlink/);
    expect(stdout).toMatch(/validate/);
    expect(stdout).toMatch(/login/);
    expect(stdout).toMatch(/logout/);
  });
});
