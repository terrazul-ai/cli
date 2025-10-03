import { execFile, spawn } from 'node:child_process';
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
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
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
  const dir = await mkdtemp(path.join(tmpdir(), 'tz-validate-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

describe('validate command (integration)', () => {
  it('fails with missing referenced files and succeeds after they are created', async () => {
    await ensureBuilt();
    const cli = path.join(process.cwd(), 'dist', 'tz.mjs');

    const proj = await setupProject({
      'agents.toml': `
[package]
name = "@u/p"

[tasks]
"ctx.generate" = "tasks/ctx.generate.yaml"

[exports]
  [exports.codex]
  template = "templates/AGENTS.md.hbs"
`,
    });

    // Expect failure due to missing files
    const r1 = await run('node', [cli, 'validate'], { cwd: proj });
    expect(r1.code).not.toBe(0);
    expect(r1.stdout + r1.stderr).toMatch(/Missing task file|Missing template/);

    // Create the missing files
    const taskFile = path.join(proj, 'tasks/ctx.generate.yaml');
    const tplFile = path.join(proj, 'templates/AGENTS.md.hbs');
    await mkdir(path.dirname(taskFile), { recursive: true });
    await mkdir(path.dirname(tplFile), { recursive: true });
    await writeFile(taskFile, 'pipeline: []\n', 'utf8');
    await writeFile(tplFile, '# AGENTS\n', 'utf8');

    const r2 = await run('node', [cli, 'validate'], { cwd: proj });
    expect(r2.code).toBe(0);
    expect(r2.stdout + r2.stderr).toMatch(/Manifest is valid/);
  });
});
