import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  getConfigPath,
  loadConfig,
  saveConfig,
  updateConfig,
  getEffectiveToken,
} from '../../../src/utils/config';

import type { MockInstance } from 'vitest';

function setTempHome(tmp: string): void {
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp; // windows
}

describe('utils/config', () => {
  const envBackup = { ...process.env };
  let tmpDir = '';
  let homeSpy: MockInstance<[], string> | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-test-'));
    setTempHome(tmpDir);
    delete process.env.TERRAZUL_TOKEN;
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    process.env = { ...envBackup };
    homeSpy?.mockRestore();
    // Cleanup temp dir best-effort
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns defaults when config missing', async () => {
    const cfg = await loadConfig();
    expect(cfg.registry).toBeTypeOf('string');
    expect(cfg.cache.ttl).toBe(3600);
    expect(cfg.cache.maxSize).toBe(500);
    expect(cfg.telemetry).toBe(false);
    expect(cfg.environment).toBe('production');
    expect(cfg.environments.production.registry).toBe('https://api.terrazul.com');
    expect(cfg.environments.staging.registry).toBe('https://staging.api.terrazul.com');
  });

  it('read/write roundtrip and 0600 perms (Unix)', async () => {
    const cfg = await loadConfig();
    cfg.registry = 'http://localhost:8787';
    cfg.username = 'tester';
    await saveConfig(cfg);

    const cfg2 = await loadConfig();
    expect(cfg2.registry).toBe('http://localhost:8787');
    expect(cfg2.username).toBe('tester');
    expect(cfg2.environments.production.registry).toBe('http://localhost:8787');

    if (process.platform !== 'win32') {
      const st = await fs.stat(getConfigPath());
      const mode = st.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it('migrates legacy config into environment map', async () => {
    const cfgPath = getConfigPath();
    await fs.mkdir(path.dirname(cfgPath), { recursive: true });
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ registry: 'http://localhost:4000', token: 'tz_pat_legacy' }),
      'utf8',
    );

    const cfg = await loadConfig();
    expect(cfg.registry).toBe('http://localhost:4000');
    expect(cfg.environments.production.registry).toBe('http://localhost:4000');
    expect(cfg.environments.production.token).toBe('tz_pat_legacy');
  });

  it('updateConfig merges and persists', async () => {
    await updateConfig({ username: 'alice' });
    const cfg = await loadConfig();
    expect(cfg.username).toBe('alice');
  });

  it('TERRAZUL_TOKEN provides read-only override', async () => {
    const cfg = await loadConfig();
    cfg.environments.production.token = 'tz_pat_saved_abc';
    await saveConfig(cfg);

    process.env.TERRAZUL_TOKEN = 'tz_pat_env_123';
    const effective = getEffectiveToken(cfg);
    expect(effective).toBe('tz_pat_env_123');
  });

  it('prefers environment token when override absent', async () => {
    const cfg = await loadConfig();
    cfg.environments.production.token = 'tz_pat_prod';
    cfg.environments.staging.token = 'tz_pat_stage';
    cfg.environment = 'staging';
    await saveConfig(cfg);

    const reloaded = await loadConfig();
    const token = getEffectiveToken(reloaded);
    expect(token).toBe('tz_pat_stage');
  });
});
