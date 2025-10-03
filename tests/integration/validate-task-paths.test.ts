import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: 'utf8' },
      (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: err ? 1 : 0 });
      },
    );
  });
}

async function ensureBuilt(): Promise<void> {
  const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
  try {
    await readFile(cli, 'utf8');
  } catch {
    await new Promise<void>((resolve, reject) => {
      execFile('node', ['build.config.mjs'], (err) => (err ? reject(err) : resolve()));
    });
  }
}

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tz-validate-task-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('validate command (task path restrictions)', () => {
  it('flags absolute and escaping task paths', async () => {
    await ensureBuilt();
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
    const proj = await setupProject({
      'agents.toml': `
[package]
name = "@u/p"

[tasks]
abs = "/etc/hosts"
esc = "../outside/task.yaml"
`,
    });

    const r = await run('node', [cli, 'validate'], { cwd: proj });
    expect(r.code).toBe(1);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/Task path must be relative/);
    expect(out).toMatch(/Task path escapes package root/);
  });
});
