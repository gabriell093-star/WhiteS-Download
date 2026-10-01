export const ERROR_CODES = [
  "INVALID_URL",
  "UNSUPPORTED_PROVIDER",
  "RESOLUTION_FAILED",
  "DESTINATION_NOT_FOUND",
  "RESOLUTION_TIMEOUT",
  "TOO_MANY_REDIRECTS",
  "PROVIDER_CHANGED",
  "SECURITY_BLOCKED",
  "RATE_LIMITED",
  "CONCURRENCY_LIMITED",
  "RESOLUTION_UNSUPPORTED"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export class ResolverError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ResolverError";
  }

  toJSON(): SerializedError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable
    };
  }
}

export function isResolverError(value: unknown): value is ResolverError {
  return value instanceof ResolverError;
}
