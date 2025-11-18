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

describe('tz run version checking', () => {
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
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-run-version-home-'));
    tmpProj = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-run-version-proj-'));
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

  it('upgrades package when requested version differs from installed version', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, TZ_SKIP_SPAWN: 'true' };
    await run('node', [cli, 'init', '--name', '@e2e/run-version-upgrade'], { cwd: tmpProj, env });

    // Install v1.0.0 first (use exact version to force 1.0.0)
    const manifest = `
[package]
name = "@e2e/run-version-upgrade"
version = "0.1.0"

[dependencies]
"@terrazul/starter" = "1.0.0"
`;
    await fs.writeFile(path.join(tmpProj, 'agents.toml'), manifest, 'utf8');
    await run('node', [cli, 'install'], { cwd: tmpProj, env });

    // Verify v1.0.0 is installed
    const lockBefore = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lockBefore).toContain('"@terrazul/starter"');
    expect(lockBefore).toContain('version = "1.0.0"');

    // Run with v1.1.0 spec - should upgrade
    await run('node', [cli, 'run', '@terrazul/starter@^1.1.0'], { cwd: tmpProj, env });

    // Verify lockfile was updated to v1.1.0
    const lockAfter = await fs.readFile(path.join(tmpProj, 'agents-lock.toml'), 'utf8');
    expect(lockAfter).toContain('"@terrazul/starter"');
    expect(lockAfter).toContain('version = "1.1.0"');

    // Verify manifest was updated
    const manifestAfter = await fs.readFile(path.join(tmpProj, 'agents.toml'), 'utf8');
    expect(manifestAfter).toContain('"@terrazul/starter" = "^1.1.0"');
  });

  it('does not reinstall when requested version matches installed version', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, TZ_SKIP_SPAWN: 'true' };
    await run('node', [cli, 'init', '--name', '@e2e/run-version-match'], { cwd: tmpProj, env });

    // Install v1.1.0
    const manifest = `
[package]
name = "@e2e/run-version-match"
version = "0.1.0"

[dependencies]
"@terrazul/starter" = "^1.1.0"
`;
    await fs.writeFile(path.join(tmpProj, 'agents.toml'), manifest, 'utf8');
    await run('node', [cli, 'install'], { cwd: tmpProj, env });

    // Get lockfile mtime
    const lockPath = path.join(tmpProj, 'agents-lock.toml');
    const statBefore = await fs.stat(lockPath);
    const mtimeBefore = statBefore.mtimeMs;

    // Wait to ensure different mtime if file is rewritten
    await delay(100);

    // Run with same version range - should skip reinstall
    await run('node', [cli, 'run', '@terrazul/starter@^1.1.0'], { cwd: tmpProj, env });

    // Verify lockfile was not modified (mtime unchanged)
    const statAfter = await fs.stat(lockPath);
    const mtimeAfter = statAfter.mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);

    // Verify lockfile still has v1.1.0
    const lock = await fs.readFile(lockPath, 'utf8');
    expect(lock).toContain('version = "1.1.0"');
  });

  it('handles repeated runs without creating duplicate manifest entries', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, TZ_SKIP_SPAWN: 'true' };
    await run('node', [cli, 'init', '--name', '@e2e/run-no-duplicates'], { cwd: tmpProj, env });

    // Run package spec multiple times
    await run('node', [cli, 'run', '@terrazul/starter@^1.1.0'], { cwd: tmpProj, env });
    await run('node', [cli, 'run', '@terrazul/starter@^1.1.0'], { cwd: tmpProj, env });
    await run('node', [cli, 'run', '@terrazul/starter@^1.1.0'], { cwd: tmpProj, env });

    // Verify manifest is still valid and contains only one entry
    const manifest = await fs.readFile(path.join(tmpProj, 'agents.toml'), 'utf8');

    // Parse manifest to ensure it's valid TOML
    const TOML = await import('@iarna/toml');
    const parsed = TOML.parse(manifest);
    expect(parsed).toBeDefined();

    // Verify only one dependency entry
    expect(parsed.dependencies).toBeDefined();
    const deps = parsed.dependencies as Record<string, string>;
    expect(deps['@terrazul/starter']).toBe('^1.1.0');

    // Count occurrences in raw manifest - should appear exactly once in dependencies section
    const depMatches = manifest.match(/"@terrazul\/starter"\s*=\s*"\^1\.1\.0"/g);
    expect(depMatches).toHaveLength(1);
  });

  it('updates manifest when running with different version', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, TZ_SKIP_SPAWN: 'true' };
    await run('node', [cli, 'init', '--name', '@e2e/run-version-change'], { cwd: tmpProj, env });

    // First run with v1.0.0 (exact version)
    await run('node', [cli, 'run', '@terrazul/starter@1.0.0'], { cwd: tmpProj, env });

    // Verify manifest has v1.0.0
    const manifestV1 = await fs.readFile(path.join(tmpProj, 'agents.toml'), 'utf8');
    expect(manifestV1).toContain('"@terrazul/starter" = "1.0.0"');

    // Run with v1.1.0
    await run('node', [cli, 'run', '@terrazul/starter@^1.1.0'], { cwd: tmpProj, env });

    // Verify manifest was updated to v1.1.0 (not duplicate)
    const manifestV2 = await fs.readFile(path.join(tmpProj, 'agents.toml'), 'utf8');
    expect(manifestV2).toContain('"@terrazul/starter" = "^1.1.0"');
    expect(manifestV2).not.toContain('= "1.0.0"');

    // Verify manifest is still valid TOML
    const TOML = await import('@iarna/toml');
    const parsed = TOML.parse(manifestV2);
    const deps = parsed.dependencies as Record<string, string>;
    expect(deps['@terrazul/starter']).toBe('^1.1.0');
  });
});
