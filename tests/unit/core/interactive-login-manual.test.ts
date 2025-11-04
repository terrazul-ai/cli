import { PassThrough, Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runInteractiveLogin } from '../../../src/core/auth/interactive-login';
import { LoginStateManager } from '../../../src/core/auth/state-manager';

vi.mock('../../../src/utils/browser', () => ({
  launchBrowser: vi.fn(() =>
    Promise.resolve({
      success: false,
      command: 'mock',
      args: ['https://example.com'],
      suppressed: true,
    }),
  ),
  resolveBrowserLauncher: vi.fn(() => ({ command: 'mock', args: [] })),
}));

describe('core/auth/interactive-login manual flow', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    isVerbose: () => false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('accepts manual token input and ignores invalid attempts', async () => {
    const input = Readable.from(['not-a-token\n', 'tz_manual_ok\n']);
    const output = new PassThrough();
    const authService = {
      initiateCliLogin: vi.fn(() =>
        Promise.resolve({
          state: 'manual-state',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          browserUrl: 'https://login.example.com/cli/auth',
        }),
      ),
      completeCliLogin: vi.fn(({ token }: { state: string; token: string }) =>
        Promise.resolve({
          token,
          tokenId: 'tok_manual_1',
          createdAt: new Date('2024-12-15T10:30:00Z').toISOString(),
          expiresAt: new Date('2025-03-15T10:30:00Z').toISOString(),
          user: {
            id: 'user_manual',
            username: 'manual-user',
            email: 'manual@example.com',
          },
        }),
      ),
    };

    const stateManager = new LoginStateManager();
    const telemetry = { track: vi.fn() };
    const resultPromise = runInteractiveLogin({
      logger,
      authService: authService as unknown as Parameters<
        typeof runInteractiveLogin
      >[0]['authService'],
      stateManager,
      input,
      output,
      telemetry,
    });

    const result = await resultPromise;
    expect(result.token).toBe('tz_manual_ok');
    expect(result.via).toBe('manual');
    expect(result.user.username).toBe('manual-user');
    expect(authService.completeCliLogin).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
    expect(telemetry.track).toHaveBeenCalledWith('login_launch', expect.any(Object));
    expect(telemetry.track).toHaveBeenCalledWith('login_manual_prompt');
    expect(telemetry.track).toHaveBeenCalledWith('login_manual_invalid');
    expect(telemetry.track).toHaveBeenCalledWith('login_manual_success', { via: 'manual' });
  });
});
