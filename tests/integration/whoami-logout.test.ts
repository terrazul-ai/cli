import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerLogoutCommand } from '../../src/commands/logout';
import { registerWhoamiCommand } from '../../src/commands/whoami';
import { createCLIContext } from '../../src/utils/context';

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

describe('integration: whoami/logout', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl = '';
  let tmpHome = '';
  let homeSpy: ReturnType<typeof vi.spyOn> | undefined;
  let introspectResponse: {
    token: string;
    tokenId: string;
    createdAt: string;
    expiresAt: string;
    user: { id: number; username: string; email?: string };
  };
  let shouldFailDelete = false;
  const introspectCalls: string[] = [];
  const deleteCalls: string[] = [];

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = createServer((req, res) => {
      // Handle whoami endpoint: GET /auth/v1/me
      if (req.method === 'GET' && req.url === '/auth/v1/me') {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          introspectCalls.push(token);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(introspectResponse.user));
        return;
      }

      // Handle logout: GET /auth/v1/tokens to get current token details
      if (req.method === 'GET' && req.url === '/auth/v1/tokens') {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          introspectCalls.push(token);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: introspectResponse.tokenId,
              name: 'CLI Token',
              created_at: introspectResponse.createdAt,
              expires_at: introspectResponse.expiresAt,
              last_used_at: new Date().toISOString(),
            },
          ]),
        );
        return;
      }

      if (req.method === 'DELETE' && req.url?.startsWith('/auth/v1/tokens/')) {
        deleteCalls.push(req.url);
        if (shouldFailDelete) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'SERVER_ERROR', message: 'fail' }));
        } else {
          res.writeHead(204);
          res.end();
        }
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
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-auth-commands-'));
    const cfgDir = path.join(tmpHome, '.terrazul');
    await fs.mkdir(cfgDir, { recursive: true });
    await fs.writeFile(
      path.join(cfgDir, 'config.json'),
      JSON.stringify(
        {
          registry: baseUrl,
          cache: { ttl: 3600, maxSize: 500 },
          telemetry: false,
          token: 'tz_cli_local',
          tokenId: 'tok_cli_123',
          tokenExpiresAt: new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString(),
          tokenCreatedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
          username: 'stored-user',
          user: {
            id: 30_003,
            username: 'stored-user',
            email: 'stored@example.com',
          },
          environment: 'production',
          environments: {
            production: {
              registry: baseUrl,
              token: 'tz_cli_local',
              tokenId: 'tok_cli_123',
              tokenExpiresAt: new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString(),
              tokenCreatedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
              user: {
                id: 30_003,
                username: 'stored-user',
                email: 'stored@example.com',
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    introspectCalls.length = 0;
    deleteCalls.length = 0;
    shouldFailDelete = false;
  });

  afterEach(async () => {
    homeSpy?.mockRestore();
    delete process.env.TERRAZUL_TOKEN;
    try {
      await fs.rm(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('whoami prints user info and warns on expiring token', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerWhoamiCommand(program, createCLIContext);
    const expiresIn3Days = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    introspectResponse = {
      token: 'tz_cli_local',
      tokenId: 'tok_cli_123',
      createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
      expiresAt: expiresIn3Days,
      user: {
        id: 10_001,
        username: 'cli-user',
        email: 'cli-user@example.com',
      },
    };

    // Update config file with near-expiry token
    const cfgPath = path.join(tmpHome, '.terrazul', 'config.json');
    const config = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    config.tokenExpiresAt = expiresIn3Days;
    // Also update the environment-specific token expiration
    if (config.environments && config.environments.production) {
      config.environments.production.tokenExpiresAt = expiresIn3Days;
    }
    await fs.writeFile(cfgPath, JSON.stringify(config, null, 2), 'utf8');

    // Verify the config was updated
    const verifyConfig = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    if (!verifyConfig.tokenExpiresAt || !verifyConfig.tokenCreatedAt) {
      console.error('Config after update:', verifyConfig);
      throw new Error('Config missing expiry fields');
    }

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Ensure home directory mock is active
    if (os.homedir() !== tmpHome) {
      console.error('homedir mock not working!', { expected: tmpHome, actual: os.homedir() });
      throw new Error('homedir mock failed');
    }

    await program.parseAsync(['whoami'], { from: 'user' });

    expect(introspectCalls).toContain('tz_cli_local');
    const logOutput = consoleLog.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logOutput).toMatch(/@cli-user/);
    expect(logOutput).toMatch(/token expires/i);
    const warnOutput = consoleWarn.mock.calls.map((args) => args.join(' ')).join('\n');
    // Temporary debug
    if (!/expiring/i.test(warnOutput)) {
      console.error('WARN OUTPUT:', warnOutput);
      console.error('WARN CALLS:', consoleWarn.mock.calls);
      console.error('LOG OUTPUT:', logOutput);
    }
    expect(warnOutput).toMatch(/expiring/i);

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  it('whoami prefers TERRAZUL_TOKEN and surfaces message', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerWhoamiCommand(program, createCLIContext);
    introspectResponse = {
      token: 'tz_env_token',
      tokenId: 'tok_env_123',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      user: {
        id: 20_002,
        username: 'env-user',
      },
    };
    process.env.TERRAZUL_TOKEN = 'tz_env_token';

    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await program.parseAsync(['whoami'], { from: 'user' });

    expect(introspectCalls).toContain('tz_env_token');
    const logOutput = consoleLog.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logOutput).toMatch(/Using TERRAZUL_TOKEN environment variable/);
    expect(logOutput).toMatch(/env-user/);
    expect(consoleWarn).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
  });

  it('logout revokes token and clears config even if API fails', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerLogoutCommand(program, createCLIContext);
    introspectResponse = {
      token: 'tz_cli_local',
      tokenId: 'tok_cli_123',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString(),
      user: {
        id: 10_001,
        username: 'cli-user',
      },
    };
    shouldFailDelete = true;

    await program.parseAsync(['logout'], { from: 'user' });

    // Should NOT call GET /auth/v1/tokens since tokenId is stored
    expect(introspectCalls).toHaveLength(0);
    // Should call DELETE with stored tokenId
    expect(deleteCalls.some((url) => url.includes('tok_cli_123'))).toBe(true);

    const cfgPath = path.join(tmpHome, '.terrazul', 'config.json');
    const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as Record<string, unknown>;
    expect(cfg.token).toBeUndefined();
    expect(cfg.user).toBeUndefined();
  });
});
