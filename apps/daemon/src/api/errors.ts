import type { ApiError, RuntimeErrorCode } from '@clawee/protocol';

export function apiError(
  code: RuntimeErrorCode,
  message: string,
  details?: Record<string, unknown>
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {})
    }
  };
}
