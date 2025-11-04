import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveConfig, getConfigPath, loadConfig } from '../../../src/utils/config';

describe('utils/config permission enforcement', () => {
  if (process.platform === 'win32') {
    it.skip('permission adjustments are not enforced on Windows', () => {
      expect(true).toBe(true);
    });
    return;
  }

  let tmpDir = '';
  let homeSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-config-perms-'));
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    homeSpy?.mockRestore();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup issues
    }
  });

  it('fixes directory and file permissions and logs warning', async () => {
    const logger = {
      info: () => {},
      warn: vi.fn(),
      error: () => {},
      debug: () => {},
      isVerbose: () => false,
    };
    const cfgPath = getConfigPath();
    const cfgDir = path.dirname(cfgPath);
    await fs.mkdir(cfgDir, { recursive: true, mode: 0o755 });
    await saveConfig(
      {
        registry: 'http://localhost:9999',
        cache: { ttl: 1, maxSize: 1 },
        telemetry: false,
        environment: 'production',
        environments: {
          production: {
            registry: 'http://localhost:9999',
          },
        },
        profile: {},
        context: {},
      },
      { logger },
    );
    const cfg = await loadConfig();
    expect(cfg.registry).toBe('http://localhost:9999');
    const dirStat = await fs.stat(cfgDir);
    const fileStat = await fs.stat(cfgPath);
    expect(dirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws when permission correction fails', async () => {
    const logger = {
      info: () => {},
      warn: vi.fn(),
      error: () => {},
      debug: () => {},
      isVerbose: () => false,
    };
    const cfgPath = getConfigPath();
    const cfgDir = path.dirname(cfgPath);
    await fs.mkdir(cfgDir, { recursive: true, mode: 0o755 });
    const chmodSpy = vi
      .spyOn(fs, 'chmod')
      .mockRejectedValueOnce(new Error('chmod failed'))
      .mockRejectedValueOnce(new Error('chmod failed'));

    await expect(
      saveConfig(
        {
          registry: 'http://localhost:9999',
          cache: { ttl: 1, maxSize: 1 },
          telemetry: false,
          environment: 'production',
          environments: {
            production: {
              registry: 'http://localhost:9999',
            },
          },
          profile: {},
          context: {},
        },
        { logger },
      ),
    ).rejects.toThrowError(/Failed to secure/);

    chmodSpy.mockRestore();
  });
});
