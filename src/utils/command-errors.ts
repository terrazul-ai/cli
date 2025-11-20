import { TerrazulError } from '../core/errors.js';

import type { Logger } from './logger.js';

/**
 * Unified error handler for command actions
 *
 * Handles TerrazulError instances with proper user messages and exit codes,
 * falls back to generic error handling for standard errors.
 *
 * @param error - The error to handle
 * @param logger - Logger instance for outputting error messages
 * @param defaultMessage - Optional custom default message for empty/unknown errors
 */
export function handleCommandError(
  error: unknown,
  logger: Logger,
  defaultMessage = 'An unexpected error occurred.',
): void {
  // Don't overwrite existing non-zero exit codes
  const shouldSetExitCode = !process.exitCode || process.exitCode === 0;

  if (error instanceof TerrazulError) {
    logger.error(error.toUserMessage());
    if (shouldSetExitCode) {
      process.exitCode = error.getExitCode();
    }
    return;
  }

  // Handle objects with exitCode property (custom error types)
  if (
    error &&
    typeof error === 'object' &&
    'exitCode' in error &&
    typeof error.exitCode === 'number'
  ) {
    const message =
      'message' in error && typeof error.message === 'string' && error.message.length > 0
        ? error.message
        : defaultMessage;

    logger.error(message);
    if (shouldSetExitCode) {
      process.exitCode = error.exitCode;
    }
    return;
  }

  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message && error.message.length > 0 ? error.message : defaultMessage;
    logger.error(message);
    if (shouldSetExitCode) {
      process.exitCode = 1;
    }
    return;
  }

  // Handle primitive errors (strings, numbers, etc.)
  if (error !== null && error !== undefined) {
    const message = String(error);
    logger.error(message);
    if (shouldSetExitCode) {
      process.exitCode = 1;
    }
    return;
  }

  // Handle null/undefined
  logger.error(defaultMessage);
  if (shouldSetExitCode) {
    process.exitCode = 1;
  }
}
