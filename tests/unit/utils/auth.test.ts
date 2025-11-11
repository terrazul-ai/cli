import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { login, logout } from '../../../src/utils/auth';
import { loadConfig, updateConfig, getConfigPath } from '../../../src/utils/config';

import type { MockInstance } from 'vitest';

function setTempHome(tmp: string): void {
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
}

describe('utils/auth', () => {
  const envBackup = { ...process.env };
  let tmpDir = '';
  let homeSpy: MockInstance<[], string> | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-auth-'));
    setTempHome(tmpDir);
    delete process.env.TERRAZUL_TOKEN;
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    process.env = { ...envBackup };
    homeSpy?.mockRestore();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('stores tokens per environment, preserving other entries', async () => {
    await login({ token: 'tz_pat_prod', username: 'prod-user' });
    let cfg = await loadConfig();
    expect(cfg.environment).toBe('production');
    expect(cfg.environments.production.token).toBe('tz_pat_prod');
    expect(cfg.environments.production.username).toBe('prod-user');

    await updateConfig({ environment: 'staging' });
    await login({ token: 'tz_pat_stage', username: 'stage-user' });
    cfg = await loadConfig();
    expect(cfg.environment).toBe('staging');
    expect(cfg.environments.production.token).toBe('tz_pat_prod');
    expect(cfg.environments.production.username).toBe('prod-user');
    expect(cfg.environments.staging.token).toBe('tz_pat_stage');
    expect(cfg.environments.staging.username).toBe('stage-user');

    await logout();
    cfg = await loadConfig();
    expect(cfg.environment).toBe('staging');
    expect(cfg.environments.staging.token).toBeUndefined();
    expect(cfg.environments.staging.username).toBeUndefined();
    expect(cfg.environments.production.token).toBe('tz_pat_prod');
    expect(cfg.environments.production.username).toBe('prod-user');

    if (process.platform !== 'win32') {
      const st = await fs.stat(getConfigPath());
      const mode = st.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('clears stale tokenId when manual login overwrites web-flow token', async () => {
    // Simulate a web login that stores tokenId
    await updateConfig({
      token: 'tz_web_token_123',
      tokenId: 'tok_web_xyz',
      tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
      username: 'webuser',
      environments: {
        production: {
          registry: 'https://api.terrazul.com',
          token: 'tz_web_token_123',
          tokenId: 'tok_web_xyz',
          tokenExpiry: Math.floor(Date.now() / 1000) + 3600,
          username: 'webuser',
        },
      },
    });

    let cfg = await loadConfig();
    expect(cfg.tokenId).toBe('tok_web_xyz');
    expect(cfg.environments.production.tokenId).toBe('tok_web_xyz');

    // Now do a manual login with --token
    await login({ token: 'tz_pat_manual', username: 'manualuser' });

    cfg = await loadConfig();
    expect(cfg.token).toBe('tz_pat_manual');
    expect(cfg.username).toBe('manualuser');
    // tokenId should be cleared
    expect(cfg.tokenId).toBeUndefined();
    expect(cfg.environments.production.tokenId).toBeUndefined();
    // Old token metadata should also be cleared
    expect(cfg.tokenExpiry).toBeUndefined();
    expect(cfg.tokenCreatedAt).toBeUndefined();
    expect(cfg.tokenExpiresAt).toBeUndefined();
  });
});
