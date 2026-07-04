import type { ApiError, RuntimeErrorCode } from '@clawee/protocol';

export function apiError(code: RuntimeErrorCode, message: string): ApiError {
  return { error: { code, message } };
}
