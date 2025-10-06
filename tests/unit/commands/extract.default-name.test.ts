import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { buildInteractiveBaseOptions } from '../../../src/commands/extract';
import { normalizeConfig } from '../../../src/utils/config';

import type { CLIContext } from '../../../src/utils/context';
import type { Logger } from '../../../src/utils/logger';

function createLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    isVerbose: () => false,
  };
}

describe('commands/extract default package name', () => {
  it('prefers the username from the active config profile when available', async () => {
    const cfg = normalizeConfig({});
    cfg.username = 'CoolOwner';
    cfg.environments[cfg.environment].username = 'CoolOwner';

    const load = vi.fn().mockResolvedValue(cfg);
    const ctx = {
      logger: createLogger(),
      config: {
        load,
        save: vi.fn(),
        update: vi.fn(),
        path: vi.fn(),
        getToken: vi.fn(),
      },
      registry: {} as never,
      storage: {} as never,
      resolver: { resolve: vi.fn() },
    } as unknown as CLIContext;

    const options = await buildInteractiveBaseOptions(
      { from: path.join('/tmp', 'Sample Project') },
      ctx,
    );

    expect(options.name).toBe('@coolowner/sample-project');
    expect(load).toHaveBeenCalledOnce();
  });

  it('falls back to @local scope when username cannot be loaded', async () => {
    const load = vi.fn().mockRejectedValue(new Error('boom'));
    const ctx = {
      logger: createLogger(),
      config: {
        load,
        save: vi.fn(),
        update: vi.fn(),
        path: vi.fn(),
        getToken: vi.fn(),
      },
      registry: {} as never,
      storage: {} as never,
      resolver: { resolve: vi.fn() },
    } as unknown as CLIContext;

    const options = await buildInteractiveBaseOptions(
      { from: path.join('/tmp', 'Another Project') },
      ctx,
    );

    expect(options.name).toBe('@local/another-project');
    expect(load).toHaveBeenCalledOnce();
  });

  it('keeps user provided name and skips config lookup', async () => {
    const load = vi.fn();
    const ctx = {
      logger: createLogger(),
      config: {
        load,
        save: vi.fn(),
        update: vi.fn(),
        path: vi.fn(),
        getToken: vi.fn(),
      },
      registry: {} as never,
      storage: {} as never,
      resolver: { resolve: vi.fn() },
    } as unknown as CLIContext;

    const options = await buildInteractiveBaseOptions(
      { from: '/tmp/demo', name: '@custom/pkg' },
      ctx,
    );

    expect(options.name).toBe('@custom/pkg');
    expect(load).not.toHaveBeenCalled();
  });
});
