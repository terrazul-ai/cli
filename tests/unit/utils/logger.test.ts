import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLogger } from '../../../src/utils/logger';

describe('utils/logger', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  afterEach(() => {
    // spies restored by Vitest automatically
  });

  it('gates debug by verbose flag', () => {
    const l1 = createLogger({ verbose: false });
    l1.debug('hidden');
    expect(logSpy).not.toHaveBeenCalled();

    const l2 = createLogger({ verbose: true });
    l2.debug('visible');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('prints other levels regardless of verbose', () => {
    const l = createLogger({ verbose: false });
    l.info('info');
    l.warn('warn');
    l.error('error');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
