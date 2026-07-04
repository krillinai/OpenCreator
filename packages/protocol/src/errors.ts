export type RuntimeErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'RUN_NOT_FOUND'
  | 'THREAD_NOT_FOUND'
  | 'RESUME_TARGET_NOT_FOUND'
  | 'RESUME_FAILED'
  | 'WORKSPACE_BUSY'
  | 'CODEX_NOT_FOUND'
  | 'CODEX_AUTH_REQUIRED'
  | 'CODEX_CONFIG_INVALID'
  | 'CODEX_INCOMPATIBLE'
  | 'CODEX_UNVERIFIED_WRITE_BLOCKED'
  | 'SPAWN_FAILED'
  | 'CODEX_STREAM_ERROR'
  | 'MCP_COMMAND_FAILED'
  | 'SCHEDULE_INVALID'
  | 'INTERNAL_ERROR';

export type ApiError = {
  error: {
    code: RuntimeErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};
