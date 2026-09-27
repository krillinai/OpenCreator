import type { ApiError, OpenCreatorIssue, PublicErrorFacts, RuntimeErrorCode } from '@opencreator/protocol';

export function apiError(
  code: RuntimeErrorCode,
  message: string,
  details?: Record<string, unknown>,
  issue?: OpenCreatorIssue,
  publicFacts?: PublicErrorFacts
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(issue !== undefined ? { issue } : {}),
      ...(publicFacts !== undefined ? { publicFacts } : {})
    }
  };
}
