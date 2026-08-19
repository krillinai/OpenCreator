import type { ReasoningEffort, SandboxMode, ScheduleConcurrencyPolicy } from '@opencreator/protocol';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { expandHome } from '../platform/paths.js';
import { redactText } from '../security/redaction.js';
import { computeNextRunAt, getDefaultTimezone, isValidTimezone, validateCronExpression } from './cron.js';
import type { ProfileValidator } from './types.js';

export type ScheduleValidationErrorCode =
  | 'VALIDATION_FAILED'
  | 'SCHEDULE_INVALID'
  | 'CODEX_PROFILE_NOT_FOUND'
  | 'CODEX_PROFILE_INVALID'
  | 'CODEX_CONFIG_INVALID';

export type ScheduleValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ScheduleValidationErrorCode; message: string };

export type NormalizedCreateScheduleInput = {
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  prompt: string;
  promptHash: string;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: 'skip';
  nextRunAt: string | null;
};

export type NormalizedUpdateScheduleInput = Partial<
  Omit<NormalizedCreateScheduleInput, 'model' | 'reasoning' | 'timeoutMs' | 'nextRunAt'>
> & {
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  timeoutMs?: number | null;
  nextRunAt?: string | null;
};

export type ParseScheduleOptions = {
  now: string;
  defaultCwd: string;
  homeDir?: string;
  profileValidator: ProfileValidator;
};

const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
const REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
const CONCURRENCY_POLICIES = ['skip', 'queue'] as const;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 86_400_000;

export function parseCreateScheduleRequest(
  body: unknown,
  options: ParseScheduleOptions
): ScheduleValidationResult<NormalizedCreateScheduleInput> {
  if (!isPlainObject(body)) return { ok: false, code: 'VALIDATION_FAILED', message: 'body must be an object' };
  const base = parseCommonFields(body, options, true);
  if (!base.ok) return base;
  const cron = requireString(body.cron, 'cron');
  if (!cron.ok) return cron;
  const prompt = requireString(body.prompt, 'prompt');
  if (!prompt.ok) return prompt;
  if (body.timezone !== undefined && typeof body.timezone !== 'string') {
    return { ok: false, code: 'SCHEDULE_INVALID', message: 'timezone must be a valid IANA timezone' };
  }
  const timezone = body.timezone ?? getDefaultTimezone();
  const cronResult = validateCronAndTimezone(cron.value, timezone, options.now);
  if (!cronResult.ok) return cronResult;
  const promptMetadata = buildPromptMetadata(prompt.value);

  return {
    ok: true,
    value: {
      ...base.value,
      cron: cron.value,
      timezone,
      prompt: prompt.value,
      ...promptMetadata,
      nextRunAt: base.value.enabled === false ? null : cronResult.value.nextRunAt
    }
  };
}

export function parseUpdateScheduleRequest(
  body: unknown,
  options: ParseScheduleOptions
): ScheduleValidationResult<NormalizedUpdateScheduleInput> {
  if (!isPlainObject(body)) return { ok: false, code: 'VALIDATION_FAILED', message: 'body must be an object' };
  const base = parseCommonFields(body, options, false);
  if (!base.ok) return base;
  const value: NormalizedUpdateScheduleInput = { ...base.value };

  if (body.cron !== undefined) {
    const cron = requireString(body.cron, 'cron');
    if (!cron.ok) return cron;
    value.cron = cron.value;
  }
  if (body.timezone !== undefined) {
    const timezone = requireString(body.timezone, 'timezone');
    if (!timezone.ok) return timezone;
    value.timezone = timezone.value;
  }
  if (body.prompt !== undefined) {
    const prompt = requireString(body.prompt, 'prompt');
    if (!prompt.ok) return prompt;
    value.prompt = prompt.value;
    Object.assign(value, buildPromptMetadata(prompt.value));
  }
  if (value.cron !== undefined) {
    const cronResult = validateCronExpression(value.cron);
    if (!cronResult.ok) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: `cron is invalid: ${cronResult.message}` };
    }
  }
  if (value.timezone !== undefined && !isValidTimezone(value.timezone)) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: 'timezone must be a valid IANA timezone' };
  }
  return { ok: true, value };
}

function parseCommonFields(
  body: Record<string, unknown>,
  options: ParseScheduleOptions,
  applyDefaults: true
): ScheduleValidationResult<
  Omit<
    NormalizedCreateScheduleInput,
    'cron' | 'timezone' | 'prompt' | 'promptHash' | 'promptPreviewRedacted' | 'nextRunAt'
  >
>;
function parseCommonFields(
  body: Record<string, unknown>,
  options: ParseScheduleOptions,
  applyDefaults: false
): ScheduleValidationResult<NormalizedUpdateScheduleInput>;
function parseCommonFields(
  body: Record<string, unknown>,
  options: ParseScheduleOptions,
  applyDefaults: boolean
): ScheduleValidationResult<NormalizedUpdateScheduleInput> {
  const value: NormalizedUpdateScheduleInput = {};

  if (applyDefaults || body.name !== undefined) {
    const name = requireString(body.name, 'name');
    if (!name.ok) return name;
    if (name.value.length > 120) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: 'name must be at most 120 characters' };
    }
    value.name = name.value;
  }

  if (applyDefaults || body.enabled !== undefined) {
    value.enabled = body.enabled === undefined ? true : body.enabled === true;
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'enabled must be a boolean' };
    }
  }

  if (applyDefaults || body.profile !== undefined) {
    const profile = body.profile === undefined ? 'default' : body.profile;
    if (typeof profile !== 'string' || profile.length === 0) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'profile must be a non-empty string' };
    }
    const profileResult = options.profileValidator.validateProfileForRun(profile);
    if (!profileResult.ok) {
      return {
        ok: false,
        code: profileResult.code as ScheduleValidationErrorCode,
        message: profileResult.message
      };
    }
    value.profile = profile;
  }

  if (applyDefaults || body.cwd !== undefined) {
    const cwd = body.cwd === undefined ? options.defaultCwd : body.cwd;
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'cwd must be a non-empty string' };
    }
    const normalizedCwd = expandHome(cwd, options.homeDir ?? homedir());
    try {
      value.cwd = normalizedCwd;
      value.canonicalCwd = realpathSync(normalizedCwd);
    } catch (error) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: `cwd must exist: ${formatError(error)}` };
    }
  }

  if (body.model !== undefined) {
    if (body.model !== null && typeof body.model !== 'string') {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'model must be a string or null' };
    }
    value.model = body.model;
  } else if (applyDefaults) {
    value.model = null;
  }

  if (body.reasoning !== undefined) {
    if (body.reasoning !== null && !isOneOf(body.reasoning, REASONING_EFFORTS)) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'reasoning must be a valid reasoning effort or null' };
    }
    value.reasoning = body.reasoning;
  } else if (applyDefaults) {
    value.reasoning = null;
  }

  if (applyDefaults || body.sandbox !== undefined) {
    const sandbox = body.sandbox === undefined ? 'workspace-write' : body.sandbox;
    if (!isOneOf(sandbox, SANDBOX_MODES)) {
      return { ok: false, code: 'VALIDATION_FAILED', message: 'sandbox must be a valid sandbox mode' };
    }
    value.sandbox = sandbox;
  }

  if (body.timeoutMs !== undefined) {
    const timeoutMs = body.timeoutMs;
    if (
      timeoutMs !== null
      && (typeof timeoutMs !== 'number'
        || !Number.isInteger(timeoutMs)
        || timeoutMs < MIN_TIMEOUT_MS
        || timeoutMs > MAX_TIMEOUT_MS)
    ) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: 'timeoutMs must be between 1000 and 86400000' };
    }
    value.timeoutMs = timeoutMs;
  } else if (applyDefaults) {
    value.timeoutMs = null;
  }

  if (applyDefaults || body.concurrencyPolicy !== undefined) {
    const policy = body.concurrencyPolicy === undefined ? 'queue' : body.concurrencyPolicy;
    if (!isOneOf(policy, CONCURRENCY_POLICIES)) {
      return { ok: false, code: 'SCHEDULE_INVALID', message: 'concurrencyPolicy must be skip or queue' };
    }
    value.concurrencyPolicy = policy;
  }

  if (body.misfirePolicy !== undefined && body.misfirePolicy !== 'skip') {
    return {
      ok: false,
      code: 'SCHEDULE_INVALID',
      message: 'run_once misfire is disabled for desktop-safe scheduler'
    };
  }
  if (applyDefaults || body.misfirePolicy !== undefined) {
    value.misfirePolicy = 'skip';
  }

  return { ok: true, value };
}

function validateCronAndTimezone(
  cron: string,
  timezone: string,
  now: string
): ScheduleValidationResult<{ nextRunAt: string }> {
  if (!isValidTimezone(timezone)) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: 'timezone must be a valid IANA timezone' };
  }
  const cronResult = validateCronExpression(cron);
  if (!cronResult.ok) {
    return { ok: false, code: 'SCHEDULE_INVALID', message: `cron is invalid: ${cronResult.message}` };
  }
  return { ok: true, value: { nextRunAt: computeNextRunAt({ cron, timezone, from: now }) } };
}

function buildPromptMetadata(prompt: string): { promptHash: string; promptPreviewRedacted: string } {
  return {
    promptHash: createHash('sha256').update(prompt).digest('hex'),
    promptPreviewRedacted: redactText(prompt).slice(0, 240)
  };
}

function requireString(value: unknown, field: string): ScheduleValidationResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, code: 'VALIDATION_FAILED', message: `${field} must be a non-empty string` };
  }
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && options.includes(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
