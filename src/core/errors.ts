/**
 * Error taxonomy for Terrazul CLI
 * Provides structured error handling with specific error codes
 */

export const ErrorCode = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  VERSION_YANKED: 'VERSION_YANKED',
  INVALID_PACKAGE: 'INVALID_PACKAGE',
  INTEGRITY_MISMATCH: 'INTEGRITY_MISMATCH',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_EXISTS: 'FILE_EXISTS',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  RESOLUTION_FAILED: 'RESOLUTION_FAILED',
  NO_CANDIDATES: 'NO_CANDIDATES',
  CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY',
  STORAGE_ERROR: 'STORAGE_ERROR',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  TOOL_OUTPUT_PARSE_ERROR: 'TOOL_OUTPUT_PARSE_ERROR',
  SECURITY_VIOLATION: 'SECURITY_VIOLATION',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Custom error class for Terrazul CLI
 */
export class TerrazulError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'TerrazulError';
    this.code = code;
    this.details = details;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TerrazulError);
    }
  }

  /**
   * Create a user-friendly error message
   */
  toUserMessage(): string {
    const messages: Record<ErrorCode, string> = {
      [ErrorCode.NETWORK_ERROR]: '❌ Network error. Please check your internet connection.',
      [ErrorCode.TIMEOUT_ERROR]: '⏱️  Request timed out. Please try again.',
      [ErrorCode.AUTH_REQUIRED]: '🔒 Authentication required. Run `tz login` first.',
      [ErrorCode.TOKEN_EXPIRED]: '🔄 Your session has expired. Please login again.',
      [ErrorCode.TOKEN_INVALID]: '❌ Invalid authentication token.',
      [ErrorCode.PACKAGE_NOT_FOUND]: '📦 Package not found in registry.',
      [ErrorCode.VERSION_NOT_FOUND]: '🔍 Specified version not found.',
      [ErrorCode.VERSION_CONFLICT]: '⚠️  Version conflict detected.',
      [ErrorCode.VERSION_YANKED]: '🚫 This version has been yanked and is unavailable.',
      [ErrorCode.INVALID_PACKAGE]: '❌ Invalid package structure or manifest.',
      [ErrorCode.INTEGRITY_MISMATCH]: '🔐 Package integrity check failed.',
      [ErrorCode.PERMISSION_DENIED]: '🚫 Permission denied.',
      [ErrorCode.FILE_NOT_FOUND]: '📄 File not found.',
      [ErrorCode.FILE_EXISTS]: '📁 File already exists.',
      [ErrorCode.CONFIG_INVALID]: '⚙️  Invalid configuration.',
      [ErrorCode.CONFIG_NOT_FOUND]: '⚙️  Configuration file not found.',
      [ErrorCode.RESOLUTION_FAILED]: '🔧 Failed to resolve dependencies.',
      [ErrorCode.NO_CANDIDATES]: '❌ No valid package versions found.',
      [ErrorCode.CIRCULAR_DEPENDENCY]: '🔄 Circular dependency detected.',
      [ErrorCode.STORAGE_ERROR]: '💾 Storage operation failed.',
      [ErrorCode.EXTRACTION_FAILED]: '📦 Failed to extract package.',
      [ErrorCode.INVALID_ARGUMENT]: '❌ Invalid argument provided.',
      [ErrorCode.OPERATION_CANCELLED]: '🛑 Operation cancelled.',
      [ErrorCode.UNKNOWN_ERROR]: '❓ An unknown error occurred.',
      [ErrorCode.TOOL_NOT_FOUND]: '🔧 Required external tool not found on PATH.',
      [ErrorCode.TOOL_EXECUTION_FAILED]: '❌ External tool failed to execute.',
      [ErrorCode.TOOL_OUTPUT_PARSE_ERROR]: '📄 Failed to parse tool output.',
      [ErrorCode.SECURITY_VIOLATION]: '🚫 Security violation prevented unsafe path or operation.',
    };

    const baseMessage = messages[this.code] || this.message;

    // Add details if present
    if (this.message && this.message !== baseMessage) {
      return `${baseMessage}\n   ${this.message}`;
    }

    return baseMessage;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    const retryableCodes = new Set<ErrorCode>([
      ErrorCode.NETWORK_ERROR,
      ErrorCode.TIMEOUT_ERROR,
      ErrorCode.TOKEN_EXPIRED,
    ]);

    return retryableCodes.has(this.code);
  }

  /**
   * Get exit code for CLI
   */
  getExitCode(): number {
    const exitCodes: Partial<Record<ErrorCode, number>> = {
      [ErrorCode.NETWORK_ERROR]: 2,
      [ErrorCode.AUTH_REQUIRED]: 3,
      [ErrorCode.PACKAGE_NOT_FOUND]: 4,
      [ErrorCode.VERSION_CONFLICT]: 5,
      [ErrorCode.PERMISSION_DENIED]: 6,
      [ErrorCode.CONFIG_INVALID]: 7,
      [ErrorCode.RESOLUTION_FAILED]: 8,
      [ErrorCode.INTEGRITY_MISMATCH]: 9,
    };

    return exitCodes[this.code] || 1;
  }
}

/**
 * Helper to check if an error is a TerrazulError
 */
export function isTerrazulError(error: unknown): error is TerrazulError {
  return error instanceof TerrazulError;
}

/**
 * Wrap unknown errors as TerrazulError
 */
export function wrapError(
  error: unknown,
  defaultCode: ErrorCode = ErrorCode.UNKNOWN_ERROR,
): TerrazulError {
  if (isTerrazulError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new TerrazulError(defaultCode, error.message, { originalError: error });
  }

  return new TerrazulError(defaultCode, String(error));
}
