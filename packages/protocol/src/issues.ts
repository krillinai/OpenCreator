import { safePublicErrorCode } from './errors.js';

export const issueSources = [
  'api',
  'network',
  'upload',
  'preflight',
  'stage',
  'provider',
  'agent',
  'output-validator',
  'client'
] as const;

export const issueCategories = [
  'configuration',
  'input',
  'permission',
  'network',
  'provider',
  'execution',
  'output-validation',
  'unknown'
] as const;

export const issueStatuses = ['open', 'resolving', 'resolved'] as const;
export const issueRetryResults = [
  'none',
  'succeeded',
  'failed',
  'canceled',
  'timeout',
  'interrupted',
  'unknown'
] as const;

export type IssueSource = typeof issueSources[number];
export type IssueCategory = typeof issueCategories[number];
export type IssueStatus = typeof issueStatuses[number];
export type IssueRetryResult = typeof issueRetryResults[number];

export const publicErrorKinds = [
  'timeout',
  'dns',
  'connection-refused',
  'connection-reset',
  'tls',
  'http-rejected',
  'rate-limited',
  'unauthorized',
  'invalid-response',
  'configuration',
  'validation',
  'not-found',
  'conflict',
  'unsupported',
  'storage',
  'unavailable',
  'unknown'
] as const;

export type PublicErrorFacts = {
  kind: typeof publicErrorKinds[number];
  provider?: string;
  upstreamCode?: string;
  httpStatus?: number;
};

export function isPublicErrorFacts(value: unknown): value is PublicErrorFacts {
  if (!isRecord(value) || !includes(publicErrorKinds, value.kind)) return false;
  return (value.provider === undefined || (typeof value.provider === 'string'
      && value.provider.length <= 80 && safePublicErrorCode(value.provider) !== undefined))
    && (value.upstreamCode === undefined || safePublicErrorCode(value.upstreamCode) !== undefined)
    && (value.httpStatus === undefined
      || (Number.isInteger(value.httpStatus) && Number(value.httpStatus) >= 100 && Number(value.httpStatus) <= 599));
}

export type IssueScope =
  | { kind: 'creator-job'; jobId: string }
  | { kind: 'page'; surface: string };

export type CreatorRepairAction =
  | {
      kind: 'retry-operation';
      operationId: string;
      requiresConfirmation: boolean;
      risk: 'normal' | 'paid' | 'overwrite';
    }
  | { kind: 'open-settings'; settingsRouteId: string }
  | { kind: 'select-input'; inputField: string }
  | { kind: 'focus-agent' };

export type OpenCreatorIssue = {
  id: string;
  diagnosticId: string;
  code: string;
  scope: IssueScope;
  source: IssueSource;
  category: IssueCategory;
  severity: 'warning' | 'error' | 'fatal';
  status: IssueStatus;
  operation?: string;
  stageId?: string;
  stageRunId?: string;
  scopeKey?: string;
  summaryKey: string;
  summaryParams: Record<string, string | number>;
  fallbackMessage: string;
  publicFacts?: PublicErrorFacts;
  technicalDetail?: string;
  retryable: boolean;
  repairActions: CreatorRepairAction[];
  fingerprint: string;
  occurrenceCount: number;
  occurredAt: string;
  lastOccurredAt: string;
  resolvedAt?: string;
};

export type CreatorIssueEventKind =
  | 'occurrence'
  | 'resolving'
  | 'resolved'
  | 'reopened'
  | 'attempt_succeeded'
  | 'attempt_failed'
  | 'attempt_canceled'
  | 'attempt_timeout'
  | 'attempt_interrupted'
  | 'attempt_unknown';

export type CreatorIssueEvent = {
  id: string;
  issueId: string;
  kind: CreatorIssueEventKind;
  retryResult: IssueRetryResult;
  createdAt: string;
};

export type CreatorIssueListResponse = {
  issues: OpenCreatorIssue[];
  events: CreatorIssueEvent[];
  nextCursor?: string;
};

export type CreatorClientIssueReportRequest = {
  clientIssueId: string;
  code: string;
  source: Extract<IssueSource, 'upload' | 'preflight' | 'agent' | 'client'>;
  operation?: string;
  stageId?: string;
  scopeKey?: string;
  fallbackMessage: string;
};

export type CreatorIssueStatsResponse = {
  jobId: string;
  from?: string;
  to?: string;
  rows: Array<{
    code: string;
    source: IssueSource;
    status: IssueStatus;
    retryResult: IssueRetryResult;
    count: number;
  }>;
};

export function isOpenCreatorIssue(value: unknown): value is OpenCreatorIssue {
  if (!isRecord(value)) return false;
  if (
    !isBoundedString(value.id, 1, 160)
    || !isBoundedString(value.diagnosticId, 1, 80)
    || !isBoundedString(value.code, 1, 160)
    || !isIssueScope(value.scope)
    || !includes(issueSources, value.source)
    || !includes(issueCategories, value.category)
    || !includes(['warning', 'error', 'fatal'] as const, value.severity)
    || !includes(issueStatuses, value.status)
    || !isOptionalBoundedString(value.operation, 160)
    || !isOptionalBoundedString(value.stageId, 160)
    || !isOptionalBoundedString(value.stageRunId, 160)
    || !isOptionalBoundedString(value.scopeKey, 200)
    || !isBoundedString(value.summaryKey, 1, 160)
    || !isSummaryParams(value.summaryParams)
    || !isBoundedString(value.fallbackMessage, 1, 1_000)
    || (value.publicFacts !== undefined && !isPublicErrorFacts(value.publicFacts))
    || !isOptionalBoundedString(value.technicalDetail, 2_000)
    || typeof value.retryable !== 'boolean'
    || !Array.isArray(value.repairActions)
    || value.repairActions.length > 8
    || !value.repairActions.every(isCreatorRepairAction)
    || !isBoundedString(value.fingerprint, 1, 160)
    || !Number.isInteger(value.occurrenceCount)
    || Number(value.occurrenceCount) < 1
    || !isIsoDate(value.occurredAt)
    || !isIsoDate(value.lastOccurredAt)
    || (value.resolvedAt !== undefined && !isIsoDate(value.resolvedAt))
  ) {
    return false;
  }
  return true;
}

export function isIssueRetryResult(value: unknown): value is IssueRetryResult {
  return includes(issueRetryResults, value);
}

function isIssueScope(value: unknown): value is IssueScope {
  if (!isRecord(value)) return false;
  if (value.kind === 'creator-job') return isBoundedString(value.jobId, 1, 160);
  if (value.kind === 'page') return isBoundedString(value.surface, 1, 160);
  return false;
}

function isCreatorRepairAction(value: unknown): value is CreatorRepairAction {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'retry-operation':
      return isRegisteredIdentifier(value.operationId)
        && typeof value.requiresConfirmation === 'boolean'
        && includes(['normal', 'paid', 'overwrite'] as const, value.risk);
    case 'open-settings':
      return isRegisteredIdentifier(value.settingsRouteId);
    case 'select-input':
      return isRegisteredIdentifier(value.inputField);
    case 'focus-agent':
      return true;
    default:
      return false;
  }
}

function isSummaryParams(value: unknown): value is Record<string, string | number> {
  if (!isRecord(value) || Object.keys(value).length > 12) return false;
  return Object.entries(value).every(([key, item]) => (
    isRegisteredIdentifier(key)
    && ((typeof item === 'string' && item.length <= 240) || (typeof item === 'number' && Number.isFinite(item)))
  ));
}

function isRegisteredIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 160
    && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value);
}

function isOptionalBoundedString(value: unknown, max: number): boolean;
function isOptionalBoundedString(value: unknown, min: number, max: number): boolean;
function isOptionalBoundedString(value: unknown, first: number, second?: number): boolean {
  if (value === undefined) return true;
  return second === undefined
    ? isBoundedString(value, 0, first)
    : isBoundedString(value, first, second);
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 40
    && !Number.isNaN(Date.parse(value));
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
