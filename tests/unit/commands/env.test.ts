import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerEnvCommand } from '../../../src/commands/env';
import { loadConfig } from '../../../src/utils/config';
import { createCLIContext } from '../../../src/utils/context';

import type { MockInstance } from 'vitest';

function setTempHome(tmp: string): void {
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
}

describe('commands/env', () => {
  const envBackup = { ...process.env };
  let tmpDir = '';
  let logSpy: MockInstance<Parameters<typeof console.log>, ReturnType<typeof console.log>>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tz-test-env-'));
    setTempHome(tmpDir);
    delete process.env.TERRAZUL_TOKEN;
    delete process.env.TERRAZUL_REGISTRY;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    process.env = { ...envBackup };
    vi.restoreAllMocks();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('switches to staging environment', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerEnvCommand(program, createCLIContext);
    await program.parseAsync(['env', 'use', 'staging'], { from: 'user' });

    const cfg = await loadConfig();
    expect(cfg.environment).toBe('staging');
    expect(cfg.registry).toBe('https://staging.api.terrazul.com');
    expect(cfg.environments.staging.registry).toBe('https://staging.api.terrazul.com');
    expect(cfg.environments.production.registry).toBe('https://api.terrazul.com');
    expect(logSpy).toHaveBeenCalled();
  });

  it('creates a custom environment when registry provided', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerEnvCommand(program, createCLIContext);
    await program.parseAsync(['env', 'use', 'local', '--registry', 'http://localhost:9090'], {
      from: 'user',
    });

    const cfg = await loadConfig();
    expect(cfg.environment).toBe('local');
    expect(cfg.registry).toBe('http://localhost:9090');
    expect(cfg.environments.local.registry).toBe('http://localhost:9090');
    expect(cfg.environments.production.registry).toBe('https://api.terrazul.com');
  });

  it('updates environment registry without switching via set', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerEnvCommand(program, createCLIContext);
    await program.parseAsync(['env', 'set', 'sandbox', 'https://sandbox.terrazul.com'], {
      from: 'user',
    });

    let cfg = await loadConfig();
    expect(cfg.environment).toBe('production');
    expect(cfg.environments.sandbox.registry).toBe('https://sandbox.terrazul.com');

    await program.parseAsync(['env', 'use', 'sandbox'], { from: 'user' });
    cfg = await loadConfig();
    expect(cfg.environment).toBe('sandbox');
    expect(cfg.registry).toBe('https://sandbox.terrazul.com');
  });
});
