import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { URLSearchParams } from 'node:url';

import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLoginCommand } from '../../src/commands/login';
import { createCLIContext } from '../../src/utils/context';

import type { UserConfig } from '../../src/types/config';

vi.mock('../../src/utils/browser', () => {
  return {
    launchBrowser: vi.fn(() =>
      Promise.resolve({ success: true, command: 'mock', args: ['https://example.com'] }),
    ),
    resolveBrowserLauncher: vi.fn(() => ({ command: 'mock', args: [] })),
  };
});

const { launchBrowser } = await import('../../src/utils/browser');

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('no-address')));
      }
    });
    srv.on('error', reject);
  });
}

describe('integration: login interactive foundation', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl = '';
  let tmpHome = '';
  let homeSpy: ReturnType<typeof vi.spyOn> | undefined;
  const launchBrowserMock = vi.mocked(launchBrowser);
  const stateValue = 'state-test-123';
  const issuedToken = 'tz_cli_test';
  const tokenCreatedAt = new Date('2024-12-15T10:30:00Z').toISOString();
  const tokenExpiresAt = new Date('2025-03-15T10:30:00Z').toISOString();
  let completionCalls = 0;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/auth/v1/cli/initiate') {
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        const body = {
          state: stateValue,
          expiresAt,
          browserUrl: 'https://login.example.com/cli/auth',
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }

      if (req.method === 'POST' && req.url === '/auth/v1/cli/complete') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          completionCalls += 1;
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          expect(parsed.state).toBe(stateValue);
          expect(parsed.token).toBe(issuedToken);
          const body = {
            token: issuedToken,
            tokenId: 'tok_cli_test_123',
            createdAt: tokenCreatedAt,
            expiresAt: tokenExpiresAt,
            user: {
              id: 'user_cli_001',
              username: 'cli-user',
              email: 'cli-user@example.com',
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        });
        return;
      }

      res.writeHead(404);
      res.end('not-found');
    });
    await new Promise<void>((resolve) => server.listen(port, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-login-home-'));
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    await fs.writeFile(
      path.join(cfgDir, 'config.json'),
      JSON.stringify(
        {
          registry: baseUrl,
          cache: { ttl: 3600, maxSize: 500 },
          telemetry: false,
        },
        null,
        2,
      ),
      'utf8',
    );
    if (process.platform !== 'win32') {
      await fs.chmod(cfgDir, 0o755);
    }
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    launchBrowserMock.mockClear();
    completionCalls = 0;
  });

  afterEach(async () => {
    homeSpy?.mockRestore();
    try {
      await fs.rm(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('stores token metadata after callback and fixes permissions', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerLoginCommand(program, createCLIContext);

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const parsePromise = program.parseAsync(['login'], { from: 'user' });

    await vi.waitFor(() => {
      expect(launchBrowserMock).toHaveBeenCalledTimes(1);
    }, 5000);

    const url = launchBrowserMock.mock.calls[0]?.[0];
    expect(url).toBeTruthy();
    const params = new URLSearchParams(url?.split('?')[1] ?? '');
    const portParam = params.get('port');
    const stateParam = params.get('state');
    expect(stateParam).toBe(stateValue);
    expect(portParam).toBeTruthy();

    const callbackRes = await fetch(
      `http://127.0.0.1:${portParam}?token=${issuedToken}&state=${stateParam}`,
    );
    const html = await callbackRes.text();
    expect(html).toMatch(/authentication successful/i);

    await parsePromise;

    expect(completionCalls).toBe(1);

    const cfgPath = path.join(tmpHome, '.terrazul', 'config.json');
    const contents = await fs.readFile(cfgPath, 'utf8');
    const cfg = JSON.parse(contents) as UserConfig;
    expect(cfg.token).toBe(issuedToken);
    expect(cfg.user).toEqual({
      id: 'user_cli_001',
      username: 'cli-user',
      email: 'cli-user@example.com',
    });
    expect(cfg.tokenCreatedAt).toBe(tokenCreatedAt);
    expect(cfg.tokenExpiresAt).toBe(tokenExpiresAt);
    const expectedExpirySeconds = Math.floor(Date.parse(tokenExpiresAt) / 1000);
    expect(cfg.tokenExpiry).toBe(expectedExpirySeconds);
    expect(cfg.environments.production.token).toBe(issuedToken);
    expect(cfg.environments.production.username).toBe('cli-user');
    expect(cfg.environments.production.tokenExpiry).toBe(expectedExpirySeconds);

    if (process.platform !== 'win32') {
      const dirStat = await fs.stat(path.join(tmpHome, '.terrazul'));
      const fileStat = await fs.stat(cfgPath);
      expect(dirStat.mode & 0o777).toBe(0o700);
      expect(fileStat.mode & 0o777).toBe(0o600);
    }

    consoleLog.mockRestore();
    const warnings = consoleWarn.mock.calls.map((args) => args.join(' '));
    if (process.platform !== 'win32') {
      expect(warnings.some((msg) => msg.includes('Fixed insecure permissions'))).toBe(true);
    }
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
