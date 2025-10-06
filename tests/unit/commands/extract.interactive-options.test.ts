import path from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { buildInteractiveBaseOptions } from '../../../src/commands/extract';

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

function createMockContext(): CLIContext {
  return {
    logger: createLogger(),
    config: {
      load: vi.fn().mockResolvedValue({ environments: {}, environment: 'default' }),
      save: vi.fn(),
      update: vi.fn(),
      path: vi.fn(),
      getToken: vi.fn(),
    },
    registry: {} as never,
    storage: {} as never,
    resolver: { resolve: vi.fn() },
  } as unknown as CLIContext;
}

describe('buildInteractiveBaseOptions', () => {
  it('uses 1.0.0 as the default package version', async () => {
    const ctx = createMockContext();
    const options = await buildInteractiveBaseOptions({ from: '/tmp/project' }, ctx);

    expect(options.version).toBe('1.0.0');
  });

  it('preserves an explicit pkgVersion argument', async () => {
    const ctx = createMockContext();
    const options = await buildInteractiveBaseOptions(
      {
        from: '/tmp/project',
        pkgVersion: '3.2.1',
      },
      ctx,
    );

    expect(options.version).toBe('3.2.1');
  });

  it('derives defaults relative to the provided project root', async () => {
    const ctx = createMockContext();
    const options = await buildInteractiveBaseOptions({ from: '/tmp/project' }, ctx);

    expect(options.from).toBe(path.resolve('/tmp/project'));
    expect(options.out).toBe(path.join(path.resolve('/tmp/project'), 'my-first-package'));
  });
});
