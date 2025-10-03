import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const env = Object.assign({}, process.env, opts.env);
    execFile(cmd, args, { cwd: opts.cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      const out = stdout;
      const errOut = stderr;
      if (err) return reject(new Error(errOut || err.message));
      resolve({ stdout: out, stderr: errOut });
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
    const onData = (b: Buffer) => {
      if (b.toString('utf8').includes('Dummy registry server running')) {
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    setTimeout(() => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      resolve(child);
    }, 1000).unref();
  });
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

async function waitForHealth(base: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* ignore */
    }
    if (Date.now() > end) throw new Error('health timeout');
    await delay(100);
  }
}

describe('integration: publish auth required', () => {
  let PORT = 0;
  let BASE = '';
  let child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let tmpHome = '';
  let tmpPkg = '';
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
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-home-'));
    tmpPkg = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-pkg-'));
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    // No token in config
    await fs.writeFile(
      path.join(cfgDir, 'config.json'),
      JSON.stringify(
        { registry: BASE, cache: { ttl: 3600, maxSize: 500 }, telemetry: false },
        null,
        2,
      ),
    );
    // Minimal package
    await fs.mkdir(path.join(tmpPkg, 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(tmpPkg, 'agents.toml'),
      `\n[package]\nname = "@e2e/pub-auth"\nversion = "0.1.0"\n\n[exports.claude]\ntemplate = "templates/CLAUDE.md.hbs"\n`,
      'utf8',
    );
    await fs.writeFile(path.join(tmpPkg, 'templates', 'CLAUDE.md.hbs'), '# Hello', 'utf8');
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

  it('fails without token', async () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    await expect(run('node', [cli, 'publish'], { cwd: tmpPkg, env })).rejects.toThrow(
      /authentication required|publish failed/i,
    );
  });
});
