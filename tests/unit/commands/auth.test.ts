import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { registerAuthCommand } from '../../../src/commands/auth';
import { loadConfig, getConfigPath } from '../../../src/utils/config';
import { createCLIContext } from '../../../src/utils/context';

import type { MockInstance } from 'vitest';

function setTempHome(tmp: string): void {
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp; // windows
}

describe('commands/auth (unit)', () => {
  let tmpDir = '';
  let homeSpy: MockInstance<[], string> | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-test-auth-'));
    setTempHome(tmpDir);
    delete process.env.TERRAZUL_TOKEN;
    homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    homeSpy?.mockRestore();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('login with --token saves token and username; logout clears', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerAuthCommand(program, createCLIContext);
    await program.parseAsync(
      ['auth', 'login', '--token', 'tz_pat_unit_123', '--username', 'alice'],
      {
        from: 'user',
      },
    );

    const cfg = await loadConfig();
    expect(cfg.token).toBe('tz_pat_unit_123');
    expect(cfg.username).toBe('alice');
    expect(cfg.environments.production.token).toBe('tz_pat_unit_123');
    expect(cfg.environments.production.username).toBe('alice');
    const exists = await fs.stat(getConfigPath());
    expect(exists.isFile()).toBe(true);

    await program.parseAsync(['auth', 'logout'], { from: 'user' });
    const cfg2 = await loadConfig();
    expect(cfg2.token).toBeUndefined();
    expect(cfg2.username).toBeUndefined();
    expect(cfg2.environments.production.token).toBeUndefined();
    expect(cfg2.environments.production.username).toBeUndefined();
  });
});
