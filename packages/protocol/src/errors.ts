import type { OpenCreatorIssue, PublicErrorFacts } from './issues.js';

export type RuntimeErrorCode =
  | 'GATEWAY_AUTH_REQUIRED'
  | 'GATEWAY_ACCOUNT_DISABLED'
  | 'GATEWAY_CREDITS_INSUFFICIENT'
  | 'GATEWAY_REQUEST_CONFLICT'
  | 'GATEWAY_SERVICES_NOT_READY'
  | 'GATEWAY_UNAVAILABLE'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'RUN_NOT_FOUND'
  | 'RUN_ALREADY_TERMINAL'
  | 'THREAD_NOT_FOUND'
  | 'THREAD_ARCHIVED'
  | 'THREAD_HAS_ACTIVE_RUN'
  | 'THREAD_ALREADY_ASSIGNED'
  | 'THREAD_CODEX_ID_CONFLICT'
  | 'THREAD_MANAGED_BY_SCHEDULE'
  | 'THREAD_CONFIG_IMMUTABLE'
  | 'THREAD_CONCURRENCY_CONFLICT'
  | 'THREAD_HISTORY_CURSOR_INVALID'
  | 'THREAD_HISTORY_CURSOR_EXPIRED'
  | 'THREAD_HISTORY_CURSOR_MISMATCH'
  | 'THREAD_HISTORY_TARGET_NOT_FOUND'
  | 'SEARCH_CURSOR_INVALID'
  | 'RESUME_TARGET_NOT_FOUND'
  | 'RESUME_CAPABILITY_UNVERIFIED'
  | 'RESUME_FAILED'
  | 'CODEX_THREAD_ID_MISSING'
  | 'THREAD_RUN_ORPHANED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_NAME_INVALID'
  | 'PROJECT_DIRECTORY_CONFLICT'
  | 'PROJECT_DIRECTORY_UNAVAILABLE'
  | 'PROJECT_ARCHIVED'
  | 'PROJECT_HAS_ACTIVE_RUN'
  | 'WORKSPACE_BUSY'
  | 'WORKSPACE_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'PATH_INVALID'
  | 'PATH_ESCAPE'
  | 'PATH_IGNORED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_NOT_EDITABLE'
  | 'FILE_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'REVEAL_UNAVAILABLE'
  | 'CODEX_NOT_FOUND'
  | 'CODEX_AUTH_REQUIRED'
  | 'CODEX_MODEL_LIST_FAILED'
  | 'CODEX_HOME_READ_ONLY'
  | 'CODEX_PROFILE_NOT_FOUND'
  | 'CODEX_PROFILE_EXISTS'
  | 'CODEX_PROFILE_IN_USE'
  | 'CODEX_PROFILE_INVALID'
  | 'CODEX_CONFIG_WRITE_FAILED'
  | 'CODEX_CONFIG_LOCKED'
  | 'CODEX_CONFIG_INVALID'
  | 'CODEX_SKILL_NOT_FOUND'
  | 'CODEX_SKILL_EXISTS'
  | 'CODEX_SKILL_INVALID'
  | 'CODEX_SKILL_WRITE_FAILED'
  | 'CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED'
  | 'CODEX_SKILL_MARKET_ENTRY_NOT_FOUND'
  | 'CODEX_SKILL_MARKET_INSTALL_FAILED'
  | 'CODEX_INCOMPATIBLE'
  | 'CODEX_UNVERIFIED_WRITE_BLOCKED'
  | 'CODEX_EXEC_TIMEOUT'
  | 'CODEX_EXEC_INACTIVITY_TIMEOUT'
  | 'CODEX_EXEC_SPAWN_TIMEOUT'
  | 'SPAWN_FAILED'
  | 'CODEX_STREAM_ERROR'
  | 'MCP_COMMAND_FAILED'
  | 'MCP_SERVER_NOT_FOUND'
  | 'MCP_SERVER_EXISTS'
  | 'MCP_SERVER_INVALID'
  | 'MCP_WRITE_CONFIRMATION_REQUIRED'
  | 'SCHEDULE_INVALID'
  | 'SCHEDULE_NOT_FOUND'
  | 'SCHEDULE_HAS_ACTIVE_RUN'
  | 'SCHEDULE_THREAD_MISSING'
  | 'SCHEDULE_THREAD_ARCHIVED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_TYPE_UNSUPPORTED'
  | 'ATTACHMENT_TYPE_MISMATCH'
  | 'ATTACHMENT_ACCESS_DENIED'
  | 'ATTACHMENT_STORAGE_FAILED'
  | 'CODEX_IMAGE_INPUT_UNSUPPORTED'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_NOT_PENDING'
  | 'APPROVAL_RUNTIME_UNAVAILABLE'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED'
  | 'SUMMARY_NOT_FOUND'
  | 'SUMMARY_SOURCE_EMPTY'
  | 'CLEANUP_FAILED'
  | 'CREATOR_SERVICES_CONFIG_FILE_UNAVAILABLE'
  | 'SMART_DUBBING_CONFIG_REQUIRED'
  | 'SMART_DUBBING_PROVIDER_UNSUPPORTED'
  | 'SMART_DUBBING_UPSTREAM_ERROR'
  | 'SMART_DUBBING_RESULT_NOT_FOUND'
  | 'SMART_DUBBING_STORAGE_FAILED'
  | 'IMAGE_GENERATION_CONFIG_REQUIRED'
  | 'IMAGE_GENERATION_UPSTREAM_ERROR'
  | 'IMAGE_GENERATION_RESULT_NOT_FOUND'
  | 'IMAGE_GENERATION_STORAGE_FAILED'
  | 'VIDEO_GENERATION_CONFIG_REQUIRED'
  | 'VIDEO_GENERATION_UPSTREAM_ERROR'
  | 'VIDEO_GENERATION_RESULT_NOT_FOUND'
  | 'VIDEO_GENERATION_NOT_READY'
  | 'VIDEO_GENERATION_STORAGE_FAILED'
  | 'VIDEO_METADATA_UNAVAILABLE'
  | 'creator_source_part_required'
  | 'creator_source_invalid_part'
  | 'creator_source_metadata_unavailable'
  | 'creator_job_not_found'
  | 'creator_job_has_active_run'
  | 'creator_job_not_running'
  | 'creator_job_not_resumable'
  | 'creator_job_control_unavailable'
  | 'creator_revision_conflict'
  | 'creator_action_not_allowed'
  | 'creator_action_invalid'
  | 'creator_action_input_invalid'
  | 'creator_artifact_not_found'
  | 'creator_artifact_import_forbidden'
  | 'creator_artifact_import_unsupported'
  | 'creator_artifact_import_invalid'
  | 'creator_stage_not_found'
  | 'creator_agent_unavailable'
  | 'creator_agent_not_running'
  | 'creator_agent_steer_unavailable'
  | 'creator_conflict_requires_user'
  | 'creator_llm_config_missing'
  | 'creator_transcription_config_missing'
  | 'creator_tts_config_missing'
  | 'creator_tts_runtime_unavailable'
  | 'creator_tts_upstream_error'
  | 'creator_dependency_prepare_failed'
  | 'creator_yt_dlp_update_unavailable'
  | 'creator_components_unavailable'
  | 'creator_component_download_unavailable'
  | 'creator_yt_dlp_update_check_failed'
  | 'creator_yt_dlp_update_download_failed'
  | 'creator_yt_dlp_update_verification_failed'
  | 'creator_yt_dlp_update_storage_failed'
  | 'yt_dlp_update_recommended'
  | 'dependency_not_packaged'
  | 'unsupported_source'
  | 'unsupported_capability'
  | 'codex_runtime_missing'
  | 'codex_runtime_hash_mismatch'
  | 'codex_runtime_version_mismatch'
  | 'codex_runtime_protocol_incompatible'
  | 'codex_host_busy'
  | 'codex_host_crashed'
  | 'creator_approval_expired'
  | 'creator_approval_not_found'
  | 'creator_idempotency_key_reused'
  | 'creator_preset_not_found'
  | 'creator_preset_incompatible'
  | 'creator_preset_invalid'
  | 'creator_preset_requirement_missing'
  | 'creator_subtitle_style_unsupported'
  | 'creator_data_corrupt'
  | 'krillin_auth_failed'
  | 'krillin_path_invalid'
  | 'krillin_config_missing'
  | 'krillin_capability_unavailable'
  | 'INTERNAL_ERROR';

export function publicErrorKindForCode(code: string): PublicErrorFacts['kind'] | undefined {
  const normalized = code.toUpperCase();
  if (normalized === 'AUDIO_NO_SPEECH') return 'validation';
  if (normalized === 'AUDIO_TRANSCRIPTION_INVALID_RESPONSE') return 'invalid-response';
  if (normalized === 'AUDIO_TRANSCRIPTION_TIMESTAMPS_MISSING') return 'unsupported';
  if (normalized === 'AUDIO_TRANSCRIPTION_API_FAILED') return 'provider-failed';
  if (normalized === 'GATEWAY_AUTH_REQUIRED') return 'unauthorized';
  if (normalized === 'GATEWAY_ACCOUNT_DISABLED' || normalized === 'GATEWAY_CREDITS_INSUFFICIENT') return 'http-rejected';
  if (normalized === 'GATEWAY_SERVICES_NOT_READY') return 'configuration';
  if (normalized === 'GATEWAY_UNAVAILABLE') return 'unavailable';
  if (normalized === 'ENOTFOUND' || normalized === 'EAI_AGAIN') return 'dns';
  if (normalized === 'ECONNREFUSED') return 'connection-refused';
  if (normalized === 'ECONNRESET' || normalized === 'EPIPE') return 'connection-reset';
  if (normalized === 'ETIMEDOUT' || normalized.startsWith('UND_ERR_') && normalized.endsWith('_TIMEOUT')) return 'timeout';
  if (normalized === 'ERR_FS_FILE_TOO_LARGE' || normalized === 'EFBIG') return 'storage';
  if (/(?:^|_)CONFIG(?:_[A-Z]+)*_(?:REQUIRED|MISSING|INVALID|UNAVAILABLE)$/.test(normalized)) return 'configuration';
  if (normalized === 'UNAUTHORIZED' || /(?:^|_)(?:AUTH_FAILED|PERMISSION_DENIED|ACCESS_DENIED)$/.test(normalized)) return 'unauthorized';
  if (/(?:^|_)VALIDATION_FAILED$/.test(normalized) || /(?:^|_)(?:INPUT_)?INVALID$/.test(normalized)) return 'validation';
  if (/_NOT_FOUND$/.test(normalized)) return 'not-found';
  if (/_CONFLICT$|_ALREADY_[A-Z_]+$|_IN_USE$|_BUSY$|_ARCHIVED$/.test(normalized)) return 'conflict';
  if (/(?:^|_)UNSUPPORTED$|^UNSUPPORTED_|_INCOMPATIBLE$|_CAPABILITY_UNAVAILABLE$/.test(normalized)) return 'unsupported';
  if (/_STORAGE_FAILED$|_WRITE_FAILED$|_FILE_UNAVAILABLE$/.test(normalized)) return 'storage';
  return undefined;
}

export function safePublicErrorCode(value: unknown): string | undefined {
  return typeof value === 'string'
    && /^[a-zA-Z0-9._:/-]{1,160}$/.test(value)
    && !/^sk[-_]/i.test(value)
    && !value.split(/[._:/-]/).some(part => part.length >= 32
      && !/^[A-Z][a-z]+(?:[A-Z][a-z]+){2,}$/.test(part))
    ? value
    : undefined;
}

export function publicErrorCodeFromFailure(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && error !== null && typeof error === 'object'; depth += 1) {
    if (seen.has(error)) break;
    seen.add(error);
    const code = safePublicErrorCode((error as { code?: unknown }).code);
    if (code !== undefined) return code;
    error = (error as { cause?: unknown }).cause;
  }
  return undefined;
}

export function publicErrorMessageFromFailure(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  for (let depth = 0; depth < 4 && error !== null && typeof error === 'object'; depth += 1) {
    if (seen.has(error)) break;
    seen.add(error);
    const message = safePublicErrorMessage((error as { message?: unknown }).message);
    if (message !== undefined && !messages.includes(message)) messages.unshift(message);
    error = (error as { cause?: unknown }).cause;
  }
  return safePublicErrorMessage(messages.join('；'));
}

export function safePublicRequestId(value: unknown): string | undefined {
  return typeof value === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)
    && !/^(?:sk[-_]|AIza|AKIA|ASIA|gh[pousr]_|github_pat_|eyJ)/i.test(value)
    ? value
    : undefined;
}

export function safePublicErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4_000) return undefined;
  const sanitized = value
    .replace(/\b(?:authorization|api[-_ ]?key|(?:access[-_ ]?|refresh[-_ ]?)?token|secret|password)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|(?:Bearer|Basic)\s+[^\s,;]+|[^\s,;]+)/gi, '[redacted]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(?:sk[-_]|AIza|AKIA|ASIA|gh[pousr]_|github_pat_|eyJ)[a-zA-Z0-9._-]+/gi, '[redacted]')
    .replace(/data:[^\s,]+,[a-zA-Z0-9+/=]+/gi, '[redacted]')
    .replace(/\b(?:https?|file):\/\/[^\s<>"']+/gi, '[redacted]')
    .replace(/[a-zA-Z]:\\Users\\[^\s"']+|\/(?:Users|home)\/[^\s"']+/g, '[redacted]')
    .replace(/^\s*at\s+[^\n]+$/gm, '')
    .replace(/\b[a-zA-Z0-9+/=_-]{32,}\b/g, part => safePublicErrorCode(part) === undefined ? '[redacted]' : part)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return sanitized.replace(/\[redacted\]/g, '').replace(/[^\p{L}\p{N}]/gu, '').length > 0
    ? sanitized
    : undefined;
}

export type ApiError = {
  error: {
    code: RuntimeErrorCode;
    message: string;
    details?: Record<string, unknown>;
    publicFacts?: PublicErrorFacts;
    issue?: OpenCreatorIssue;
  };
};
