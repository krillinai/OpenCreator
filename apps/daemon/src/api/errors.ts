import type { ApiError, RuntimeErrorCode } from '@opencreator/protocol';

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
