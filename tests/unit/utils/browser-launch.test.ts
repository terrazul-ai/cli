import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { launchBrowser, resolveBrowserLauncher } from '../../../src/utils/browser';

vi.mock('node:child_process', () => {
  const spawn = vi.fn(() => ({
    pid: 123,
    unref: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    stdout: null,
    stderr: null,
    stdin: null,
    kill: vi.fn(),
  }));
  return { spawn };
});

const childProcess = await import('node:child_process');

describe('utils/browser', () => {
  const spawnMock = vi.mocked(childProcess.spawn);
  let platformSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockClear();
  });

  afterEach(() => {
    platformSpy?.mockRestore();
  });

  it('selects open on macOS', () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const launcher = resolveBrowserLauncher();
    expect(launcher.command).toBe('open');
    expect(launcher.args).toEqual([]);
  });

  it('selects xdg-open on linux', () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const launcher = resolveBrowserLauncher();
    expect(launcher.command).toBe('xdg-open');
  });

  it('selects start via cmd.exe on windows', () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const launcher = resolveBrowserLauncher();
    expect(launcher.command).toBe('cmd.exe');
    expect(launcher.args).toEqual(['/c', 'start', '']);
  });

  it('launchBrowser invokes spawn and returns success', async () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    spawnMock.mockReturnValueOnce({
      pid: 456,
      unref: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      stdout: null,
      stderr: null,
      stdin: null,
      kill: vi.fn(),
    } as unknown as ReturnType<typeof spawnMock>);

    const result = await launchBrowser('https://example.com', {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        isVerbose: () => false,
      },
    });
    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith('xdg-open', ['https://example.com'], {
      detached: true,
      stdio: 'ignore',
    });
  });

  it('launchBrowser returns failure when spawn throws', async () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    spawnMock.mockImplementationOnce(() => {
      throw new Error('spawn-failed');
    });

    const warn = vi.fn();
    const result = await launchBrowser('https://example.com', {
      logger: {
        info: vi.fn(),
        warn,
        error: vi.fn(),
        debug: vi.fn(),
        isVerbose: () => false,
      },
    });
    expect(result.success).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to open browser automatically'),
    );
  });
});
