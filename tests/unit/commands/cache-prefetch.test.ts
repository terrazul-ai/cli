import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/runtime/sea-fetcher', () => ({
  prefetchSeaTargets: vi.fn(() => ({ 'darwin-arm64': '/tmp/darwin' })),
  listSupportedTargets: vi.fn(() => ['darwin-arm64', 'linux-x64', 'win32-x64']),
}));

const seaFetcher = await import('../../../src/runtime/sea-fetcher');
const prefetchSeaTargetsMock = vi.mocked(seaFetcher.prefetchSeaTargets);

import { registerCacheCommand } from '../../../src/commands/cache';
import { createCLIContext } from '../../../src/utils/context';

describe('commands/cache prefetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    prefetchSeaTargetsMock.mockClear();
  });

  it('invokes prefetch for all targets when no filter provided', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerCacheCommand(program, createCLIContext);

    await program.parseAsync(['cache', 'prefetch'], { from: 'user' });

    expect(prefetchSeaTargetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cliVersion: expect.any(String),
        targets: undefined,
      }),
    );
  });

  it('supports overriding targets via --targets', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerCacheCommand(program, createCLIContext);

    await program.parseAsync(['cache', 'prefetch', '--targets', 'linux-x64,win32-x64'], {
      from: 'user',
    });

    expect(prefetchSeaTargetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ['linux-x64', 'win32-x64'],
      }),
    );
  });

  it('forwards --cli-version to the fetcher', async () => {
    const program = new Command();
    program.option('-v, --verbose');
    registerCacheCommand(program, createCLIContext);

    await program.parseAsync(['cache', 'prefetch', '--cli-version', '9.9.9'], { from: 'user' });

    expect(prefetchSeaTargetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cliVersion: '9.9.9',
      }),
    );
  });
});
