import type { RuntimeErrorCode } from '@opencreator/protocol';

export class WorkspaceFileError extends Error {
  code: RuntimeErrorCode;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    options?: { statusCode?: number; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'WorkspaceFileError';
    this.code = code;
    this.statusCode = options?.statusCode ?? defaultStatusCode(code);
    this.details = options?.details;
  }
}

function defaultStatusCode(code: RuntimeErrorCode): number {
  switch (code) {
    case 'THREAD_NOT_FOUND':
    case 'WORKSPACE_NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return 404;
    case 'PATH_INVALID':
    case 'PATH_IGNORED':
    case 'VALIDATION_FAILED':
      return 400;
    case 'PATH_ESCAPE':
    case 'PERMISSION_DENIED':
      return 403;
    case 'FILE_CONFLICT':
      return 409;
    case 'FILE_TOO_LARGE':
    case 'UNSUPPORTED_FILE_TYPE':
    case 'FILE_NOT_EDITABLE':
    case 'REVEAL_UNAVAILABLE':
      return 422;
    case 'THREAD_ARCHIVED':
      return 409;
    default:
      return 500;
  }
}
