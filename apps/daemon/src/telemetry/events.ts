import { randomUUID } from 'node:crypto';
import type { CreatorJob, CreatorStageRun, OpenCreatorIssue } from '@opencreator/protocol';

export const creatorTelemetryOutcomes = [
  'succeeded',
  'partial_success',
  'failed',
  'needs_input',
  'canceled',
  'interrupted',
  'unknown'
] as const;

export type CreatorTelemetryOutcome = typeof creatorTelemetryOutcomes[number];
export type CreatorTelemetryAuthState = 'signed_in' | 'signed_out' | 'unknown';
export type CreatorTelemetryRechargeState = 'recharged' | 'not_recharged' | 'pending' | 'unknown';

export type CreatorTelemetryAccountSnapshot = {
  authState: CreatorTelemetryAuthState;
  rechargeState: CreatorTelemetryRechargeState;
  accountStateObservedAt: string;
};

export type CreatorTelemetryFailure = {
  stage?: string;
  executor?: string;
  category?: string;
  error_code?: string;
  http_status?: number;
  provider?: string;
  upstream_code?: string;
  retryable?: boolean;
  retry_count?: number;
  progress_percent?: number;
  expected_count?: number;
  succeeded_count?: number;
  failed_count?: number;
  artifact_delivered?: boolean;
  user_message?: string;
};

export type CreatorTelemetryEvent = {
  event_id: string;
  event_type: 'task_started' | 'task_finished';
  occurred_at: string;
  task_id: string;
  attempt_id: string;
  feature: string;
  outcome?: CreatorTelemetryOutcome;
  auth_state: CreatorTelemetryAuthState;
  recharge_state: CreatorTelemetryRechargeState;
  account_state_observed_at: string;
  app_version?: string;
  operating_system?: string;
  architecture?: string;
  duration_ms?: number;
  failure?: CreatorTelemetryFailure;
};

export function createCreatorTelemetryEvent(input: {
  eventType: CreatorTelemetryEvent['event_type'];
  occurredAt: string;
  job: CreatorJob;
  stage: CreatorStageRun;
  feature: string;
  outcome?: CreatorTelemetryOutcome;
  account: CreatorTelemetryAccountSnapshot;
  issue?: OpenCreatorIssue;
  idFactory?(): string;
}): CreatorTelemetryEvent {
  const event: CreatorTelemetryEvent = {
    event_id: input.idFactory?.() ?? randomUUID(),
    event_type: input.eventType,
    occurred_at: input.occurredAt,
    task_id: input.job.id,
    attempt_id: input.stage.id,
    feature: input.feature,
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    auth_state: input.account.authState,
    recharge_state: input.account.rechargeState,
    account_state_observed_at: input.account.accountStateObservedAt
  };
  if (input.eventType === 'task_finished') {
    const durationMs = stageDurationMs(input.stage);
    if (durationMs !== undefined) event.duration_ms = durationMs;
    if (input.outcome !== 'succeeded') {
      event.failure = creatorTelemetryFailure(
        input.stage,
        input.outcome ?? 'unknown',
        input.job.artifacts?.some(artifact => artifact.status === 'completed') ?? false,
        input.issue
      );
    }
  }
  return sanitizeCreatorTelemetryEvent(event);
}

export function sanitizeCreatorTelemetryEvent(event: CreatorTelemetryEvent): CreatorTelemetryEvent {
  const sanitized: CreatorTelemetryEvent = {
    event_id: event.event_id,
    event_type: event.event_type,
    occurred_at: event.occurred_at,
    task_id: event.task_id,
    attempt_id: event.attempt_id,
    feature: event.feature,
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
    auth_state: event.auth_state,
    recharge_state: event.recharge_state,
    account_state_observed_at: event.account_state_observed_at,
    ...(safeText(event.app_version, 128) === undefined ? {} : { app_version: safeText(event.app_version, 128) }),
    ...(safeText(event.operating_system, 64) === undefined ? {} : { operating_system: safeText(event.operating_system, 64) }),
    ...(safeText(event.architecture, 64) === undefined ? {} : { architecture: safeText(event.architecture, 64) }),
    ...(safeNonNegativeInteger(event.duration_ms) === undefined ? {} : { duration_ms: safeNonNegativeInteger(event.duration_ms) })
  };
  if (event.failure !== undefined) sanitized.failure = sanitizeCreatorTelemetryFailure(event.failure);
  return sanitized;
}

export function sanitizeCreatorTelemetryFailure(failure: CreatorTelemetryFailure): CreatorTelemetryFailure {
  return {
    ...(safeIdentifier(failure.stage) === undefined ? {} : { stage: safeIdentifier(failure.stage) }),
    ...(safeIdentifier(failure.executor) === undefined ? {} : { executor: safeIdentifier(failure.executor) }),
    ...(safeIdentifier(failure.category) === undefined ? {} : { category: safeIdentifier(failure.category) }),
    ...(safeIdentifier(failure.error_code) === undefined ? {} : { error_code: safeIdentifier(failure.error_code) }),
    ...(safeHttpStatus(failure.http_status) === undefined ? {} : { http_status: safeHttpStatus(failure.http_status) }),
    ...(safeIdentifier(failure.provider) === undefined ? {} : { provider: safeIdentifier(failure.provider) }),
    ...(safeIdentifier(failure.upstream_code) === undefined ? {} : { upstream_code: safeIdentifier(failure.upstream_code) }),
    ...(typeof failure.retryable === 'boolean' ? { retryable: failure.retryable } : {}),
    ...(safeNonNegativeInteger(failure.retry_count) === undefined ? {} : { retry_count: safeNonNegativeInteger(failure.retry_count) }),
    ...(safePercent(failure.progress_percent) === undefined ? {} : { progress_percent: safePercent(failure.progress_percent) }),
    ...(safeNonNegativeInteger(failure.expected_count) === undefined ? {} : { expected_count: safeNonNegativeInteger(failure.expected_count) }),
    ...(safeNonNegativeInteger(failure.succeeded_count) === undefined ? {} : { succeeded_count: safeNonNegativeInteger(failure.succeeded_count) }),
    ...(safeNonNegativeInteger(failure.failed_count) === undefined ? {} : { failed_count: safeNonNegativeInteger(failure.failed_count) }),
    ...(typeof failure.artifact_delivered === 'boolean' ? { artifact_delivered: failure.artifact_delivered } : {}),
    ...(safeUserMessage(failure.user_message) === undefined ? {} : { user_message: safeUserMessage(failure.user_message) })
  };
}

function creatorTelemetryFailure(
  stage: CreatorStageRun,
  outcome: CreatorTelemetryOutcome,
  artifactDelivered: boolean,
  issue?: OpenCreatorIssue
): CreatorTelemetryFailure {
  return {
    stage: stage.stageId,
    executor: stage.executor,
    category: issue?.category ?? 'execution',
    error_code: stage.errorCode ?? issue?.code ?? 'creator_stage_outcome_unknown',
    http_status: issue?.publicFacts?.httpStatus,
    provider: issue?.publicFacts?.provider,
    upstream_code: issue?.publicFacts?.upstreamCode,
    retryable: issue?.retryable ?? false,
    retry_count: Math.max(0, stage.attempt - 1),
    progress_percent: numericProgress(stage.progress.percent),
    expected_count: numericProgress(stage.progress.total),
    succeeded_count: numericProgress(stage.progress.completed),
    failed_count: numericProgress(stage.progress.failed),
    artifact_delivered: artifactDelivered,
    user_message: safeOutcomeMessage(outcome)
  };
}

function safeOutcomeMessage(outcome: CreatorTelemetryOutcome): string {
  switch (outcome) {
    case 'needs_input': return 'Creator stage needs input.';
    case 'canceled': return 'Creator stage was canceled.';
    case 'interrupted': return 'Creator stage was interrupted.';
    case 'unknown': return 'Creator stage outcome is unknown.';
    case 'partial_success': return 'Creator stage partially succeeded.';
    default: return 'Creator stage failed.';
  }
}

function stageDurationMs(stage: CreatorStageRun): number | undefined {
  if (stage.startedAt === null || stage.finishedAt === null) return undefined;
  const duration = Date.parse(stage.finishedAt) - Date.parse(stage.startedAt);
  return safeNonNegativeInteger(duration);
}

function numericProgress(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
    ? value
    : undefined;
}

function safeText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.slice(0, maximum)
    : undefined;
}

function safeUserMessage(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 500)
    : undefined;
}

function safeHttpStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function safePercent(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
