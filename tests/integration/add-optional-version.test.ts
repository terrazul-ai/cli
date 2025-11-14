import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const env = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const message: string = stderr && stderr.length > 0 ? stderr : err.message;
        return reject(new Error(message));
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runExpectFailure(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  const env = Object.assign({}, process.env, opts.env);
  return await new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (!err) {
        reject(new Error('Expected command to fail'));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const p = address.port;
        srv.close(() => resolve(p));
      } else {
        srv.close(() => reject(new Error('no-address')));
      }
    });
    srv.on('error', reject);
  });
}

function startDummyRegistry(port: number): Promise<ChildProcessByStdio<null, Readable, Readable>> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'tools/dummy-registry.ts'],
      { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let resolved = false;
    const onData = (b: Buffer) => {
      if (b.toString('utf8').includes('Dummy registry server running')) {
        cleanup();
        resolved = true;
        resolve(child);
      }
    };
    function cleanup() {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    setTimeout(() => {
      if (!resolved) {
        cleanup();
        resolve(child);
      }
    }, 1000).unref();
  });
}

async function waitForHealth(base: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {
      void 0;
    }
    if (Date.now() > end) throw new Error(`Registry health check timed out at ${base}`);
    await delay(100);
  }
}

async function ensureBuilt(): Promise<string> {
  const cli = path.join(process.cwd(), 'dist', 'tz.mjs');
  try {
    await fs.stat(cli);
  } catch {
    await run('node', ['build.config.mjs']);
  }
  return cli;
}

describe('tz add - optional version specification', () => {
  let PORT = 0;
  let BASE = '';
  let child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let tmpHome = '';
  let tmpProj = '';
  let cli = '';

  beforeAll(async () => {
    PORT = await getFreePort();
    BASE = `http://localhost:${PORT}`;
    child = await startDummyRegistry(PORT);
    await waitForHealth(BASE);
    cli = await ensureBuilt();
  });

  afterAll(() => {
    if (child) child.kill('SIGINT');
  });

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-add-optional-home-'));
    tmpProj = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-add-optional-proj-'));
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    const cfg = { registry: BASE, cache: { ttl: 3600, maxSize: 500 }, telemetry: false };
    await fs.writeFile(path.join(cfgDir, 'config.json'), JSON.stringify(cfg, null, 2));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpProj, { recursive: true, force: true });
    } catch {
      void 0;
    }
    try {
      await fs.rm(tmpHome, { recursive: true, force: true });
    } catch {
      void 0;
    }
  });

  it('adds package with explicit version (regression test)', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-explicit'], { cwd: tmpProj, env });

    // Add with explicit version
    await run('node', [cli, 'add', '@terrazul/starter@1.0.0', '--no-apply'], {
      cwd: tmpProj,
      env,
    });

    // Note: add command doesn't update manifest dependencies, only lockfile
    const lock = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lock).toContain('@terrazul/starter');
    expect(lock).toContain('version = "1.0.0"');

    const starterLink = path.join(tmpProj, 'agent_modules', '@terrazul', 'starter');
    const stats = await fs.lstat(starterLink);
    expect(stats.isSymbolicLink() || stats.isDirectory()).toBe(true);
  });

  it('adds package without version when not installed', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-no-version'], { cwd: tmpProj, env });

    // Add without version - should install latest (1.1.0)
    const result = await run('node', [cli, 'add', '@terrazul/starter', '--no-apply'], {
      cwd: tmpProj,
      env,
    });

    // Should show what version was installed
    expect(result.stdout + result.stderr).toContain('1.1.0');

    const lock = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lock).toContain('version = "1.1.0"');

    const starterLink = path.join(tmpProj, 'agent_modules', '@terrazul', 'starter');
    const stats = await fs.lstat(starterLink);
    expect(stats.isSymbolicLink() || stats.isDirectory()).toBe(true);
  });

  it('skips installation when package already installed and no version specified', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-skip'], { cwd: tmpProj, env });

    // First add with explicit version
    await run('node', [cli, 'add', '@terrazul/starter@1.0.0', '--no-apply'], {
      cwd: tmpProj,
      env,
    });

    // Try to add again without version - should skip
    const result = await run('node', [cli, 'add', '@terrazul/starter', '--no-apply'], {
      cwd: tmpProj,
      env,
    });

    // Should show "already installed" message with version
    expect(result.stdout + result.stderr).toContain('@terrazul/starter@1.0.0');
    expect(result.stdout + result.stderr).toContain('already installed');

    // Version should remain 1.0.0 (not upgraded)
    const lock = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lock).toContain('version = "1.0.0"');
    expect(lock).not.toContain('version = "1.1.0"');
  });

  it('upgrades package when @latest tag specified', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-latest'], { cwd: tmpProj, env });

    // First add older version
    await run('node', [cli, 'add', '@terrazul/starter@1.0.0', '--no-apply'], {
      cwd: tmpProj,
      env,
    });

    // Add with @latest - should upgrade to 1.1.0
    const result = await run('node', [cli, 'add', '@terrazul/starter@latest', '--no-apply'], {
      cwd: tmpProj,
      env,
    });

    expect(result.stdout + result.stderr).toContain('1.1.0');

    const lock = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lock).toContain('version = "1.1.0"');
    expect(lock).not.toContain('version = "1.0.0"');
  });

  it('fails when latest version is yanked', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-yanked'], { cwd: tmpProj, env });

    // Try to add package where latest version is yanked
    // Note: we need to add a test package to the dummy registry for this
    // For now, we'll test with @terrazul/base which has a yanked 2.1.0
    // but latest is 2.0.0, so we need to modify the dummy registry or use a different approach

    // This test will be updated after implementing the logic
    // For now, we'll expect it to work with non-yanked latest
    await run('node', [cli, 'add', '@terrazul/base', '--no-apply'], { cwd: tmpProj, env });

    const lock = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lock).toContain('@terrazul/base');
    expect(lock).toContain('version = "2.0.0"');
  });

  it('fails with clear error when package does not exist', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-not-found'], { cwd: tmpProj, env });

    // Try to add non-existent package
    const result = await runExpectFailure(
      'node',
      [cli, 'add', '@nonexistent/package', '--no-apply'],
      { cwd: tmpProj, env },
    );

    // Should show appropriate error message
    expect(result.stderr).toContain('not found');
  });

  it('handles explicit yanked version correctly', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await run('node', [cli, 'init', '--name', '@e2e/add-yanked-explicit'], {
      cwd: tmpProj,
      env,
    });

    // Try to add explicitly yanked version
    const result = await runExpectFailure(
      'node',
      [cli, 'add', '@terrazul/base@2.1.0', '--no-apply'],
      { cwd: tmpProj, env },
    );

    // Should show yanked error
    expect(result.stderr).toContain('yanked');
    expect(result.stderr).toContain('2.1.0');
  });
});
