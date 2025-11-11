import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { LoginStateManager } from '../../../src/core/auth/state-manager';

describe('core/auth/state-manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('stores state and validates before expiry', () => {
    const manager = new LoginStateManager({ now: () => new Date(1_700_000_000_000) });
    const expiresAt = new Date(1_700_000_000_000 + 2 * 60 * 1000);
    manager.establish({ state: 'state-123', expiresAt });
    expect(manager.snapshot()?.state).toBe('state-123');
    expect(manager.snapshot()?.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect(manager.validate('state-123')).toBe(true);
  });

  it('rejects mismatched state values', () => {
    const manager = new LoginStateManager({ now: () => new Date(1_700_000_000_000) });
    manager.establish({
      state: 'state-expected',
      expiresAt: new Date(1_700_000_000_000 + 5 * 60 * 1000),
    });
    expect(manager.validate('state-wrong')).toBe(false);
  });

  it('expires after timeout and triggers onTimeout callback', () => {
    const onTimeout = vi.fn();
    const manager = new LoginStateManager({
      now: () => new Date(1_700_000_000_000),
      onTimeout,
    });
    manager.establish({
      state: 'state-expiring',
      expiresAt: new Date(1_700_000_000_000 + 10 * 60 * 1000),
    });
    // Advance time by 5 minutes to trigger timeout clamp
    vi.advanceTimersByTime(5 * 60 * 1000 + 50);
    expect(manager.validate('state-expiring')).toBe(false);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('clear cancels timeout timer', () => {
    const onTimeout = vi.fn();
    const manager = new LoginStateManager({
      now: () => new Date(1_700_000_000_000),
      onTimeout,
      timeoutMs: 1000,
    });
    manager.establish({
      state: 'state-clear',
      expiresAt: new Date(1_700_000_000_000 + 10 * 60 * 1000),
    });
    manager.clear();
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(manager.snapshot()).toBeUndefined();
  });
});
