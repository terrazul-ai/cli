import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TerrazulError, ErrorCode } from '../../../src/core/errors.js';
import { handleCommandError } from '../../../src/utils/command-errors.js';

import type { Logger } from '../../../src/utils/logger.js';

describe('command-errors', () => {
  let mockLogger: Logger;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  describe('handleCommandError', () => {
    it('should handle TerrazulError with user message and exit code', () => {
      const error = new TerrazulError(ErrorCode.PACKAGE_NOT_FOUND, 'Something went wrong', {
        packageName: '@test/pkg',
      });

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith(error.toUserMessage());
      // Should use the error's exit code (4 for PACKAGE_NOT_FOUND)
      expect(process.exitCode).toBe(4);
    });

    it('should handle standard Error with message', () => {
      const error = new Error('Standard error message');

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('Standard error message');
      expect(process.exitCode).toBe(1);
    });

    it('should handle Error with empty message', () => {
      const error = Object.assign(new Error('placeholder'), { message: '' });

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('An unexpected error occurred.');
      expect(process.exitCode).toBe(1);
    });

    it('should handle non-Error objects', () => {
      const error = 'string error';

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('string error');
      expect(process.exitCode).toBe(1);
    });

    it('should handle null error', () => {
      handleCommandError(null, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('An unexpected error occurred.');
      expect(process.exitCode).toBe(1);
    });

    it('should handle undefined error', () => {
      handleCommandError(undefined, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('An unexpected error occurred.');
      expect(process.exitCode).toBe(1);
    });

    it('should handle custom error with exitCode property', () => {
      const error = {
        message: 'Custom error with exit code',
        exitCode: 42,
      };

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('Custom error with exit code');
      expect(process.exitCode).toBe(42);
    });

    it('should use custom default message when provided', () => {
      const error = Object.assign(new Error('placeholder'), { message: '' });

      handleCommandError(error, mockLogger, 'Custom fallback message');

      expect(mockLogger.error).toHaveBeenCalledWith('Custom fallback message');
      expect(process.exitCode).toBe(1);
    });

    it('should prioritize error message over custom default', () => {
      const error = new Error('Actual error');

      handleCommandError(error, mockLogger, 'This should not be used');

      expect(mockLogger.error).toHaveBeenCalledWith('Actual error');
      expect(process.exitCode).toBe(1);
    });

    it('should handle objects with toString method', () => {
      const error = {
        toString() {
          return 'Custom toString result';
        },
      };

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('Custom toString result');
      expect(process.exitCode).toBe(1);
    });

    it('should not overwrite existing non-zero exit code', () => {
      process.exitCode = 5;
      const error = new Error('Some error');

      handleCommandError(error, mockLogger);

      expect(mockLogger.error).toHaveBeenCalledWith('Some error');
      expect(process.exitCode).toBe(5); // Should not change
    });
  });
});
