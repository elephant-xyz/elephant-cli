/**
 * Custom error classes for better type safety and error handling
 */

/**
 * Error thrown when an API request fails
 */
export class ApiError extends Error {
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    statusCode?: number,
    isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends Error {
  public readonly isRetryable: boolean;

  constructor(message: string, isRetryable: boolean = true) {
    super(message);
    this.name = 'NetworkError';
    this.isRetryable = isRetryable;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NetworkError);
    }
  }
}

/**
 * Error thrown when transaction submission fails
 */
export class TransactionError extends Error {
  public readonly transactionHash?: string;
  public readonly reason?: string;

  constructor(message: string, transactionHash?: string, reason?: string) {
    super(message);
    this.name = 'TransactionError';
    this.transactionHash = transactionHash;
    this.reason = reason;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransactionError);
    }
  }
}
