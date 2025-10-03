import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

export function runReject(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string; error: Error }> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, error: err || new Error(stderr || 'failed') });
    });
  });
}

export async function ensureBuilt(): Promise<string> {
  const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
  try {
    await fs.stat(cli);
  } catch {
    await run('node', ['build.config.mjs']);
  }
  return cli;
}

export async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string, rel = ''): Promise<void> {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const r = path.posix.join(rel || '', e.name);
      if (e.isDirectory()) await walk(abs, r);
      else out.push(r);
    }
  }
  try {
    await walk(dir);
  } catch {
    // ignore if dir missing
  }
  return out.sort();
}

export async function filesDigest(dir: string): Promise<string> {
  const crypto = await import('node:crypto');
  const files = await listFilesRecursive(dir);
  const hash = crypto.createHash('sha256');
  for (const f of files) {
    const buf = await fs.readFile(path.join(dir, f));
    hash.update(f);
    hash.update(buf);
  }
  return hash.digest('hex');
}
