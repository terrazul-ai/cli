import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { RegistryClient } from '../../src/core/registry-client';

import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

function startDummyRegistry(port: number): Promise<ChildProcessByStdio<null, Readable, Readable>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'tools/dummy-registry.ts'],
      {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let ready = false;
    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      if (s.includes('Dummy registry server running')) {
        ready = true;
        cleanup();
        resolve(child);
      }
    };
    const onErr = (chunk: Buffer) => {
      // If it fails to start quickly, reject
      const s = chunk.toString('utf8');
      if (!ready && /eaddrinuse|error/i.test(s)) {
        cleanup();
        reject(new Error(`Failed to start dummy registry: ${s}`));
      }
    };
    function cleanup() {
      child.stdout.off('data', onData);
      child.stderr.off('data', onErr);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onErr);
    // Fallback: if no log within 2s, assume ready
    setTimeout(() => {
      if (!ready) {
        cleanup();
        resolve(child);
      }
    }, 2000).unref();
  });
}

describe('integration/registry-client against dummy server', () => {
  const PORT = 9787; // low collision risk
  const BASE = `http://localhost:${PORT}`;
  let child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  beforeAll(async () => {
    child = await startDummyRegistry(PORT);
    // Small settle delay
    await delay(100);
  });

  afterAll(async () => {
    if (child) {
      child.kill('SIGINT');
      // give it a moment to exit
      await delay(100);
    }
  });

  it('fetches package info and tarball info', async () => {
    const client = new RegistryClient({ registryUrl: BASE });
    const info = await client.getPackageInfo('@terrazul/starter');
    expect(info.name).toBe('@terrazul/starter');
    expect(info.owner).toBe('terrazul');
    expect(info.latest).toBeTypeOf('string');
    expect(Array.isArray(info.versions)).toBe(true);

    const tarInfo = await client.getTarballInfo('@terrazul/starter', '1.0.0');
    expect(tarInfo.url).toMatch(new RegExp(`^${BASE}/cdn/`));
  });

  it('downloads tarball (bytes) from a simple HTTP server', async () => {
    // Spin up a tiny HTTP server that returns a known body
    const http = await import('node:http');
    const TEST_PORT = 9788;
    const body = Buffer.from('OK');
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(body);
    });
    await new Promise<void>((resolve) => srv.listen(TEST_PORT, resolve));

    const client = new RegistryClient({ registryUrl: BASE });
    const out = await client.downloadTarball(`http://localhost:${TEST_PORT}/file.tgz`);
    expect(out.equals(body)).toBe(true);

    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });
});
