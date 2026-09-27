import type {
  CreatorIssueStatsResponse,
  CreatorRepairAction,
  IssueCategory,
  IssueRetryResult,
  IssueSource,
  OpenCreatorIssue,
  PublicErrorFacts
} from '@opencreator/protocol';
import { safePublicErrorCode } from '@opencreator/protocol';
import { createHash } from 'node:crypto';
import type { CreatorRepository } from './repository.js';

export type CreatorIssueCaptureInput = {
  jobId: string;
  code: string;
  source: IssueSource;
  category?: IssueCategory;
  severity?: OpenCreatorIssue['severity'];
  operation?: string;
  stageId?: string;
  stageRunId?: string;
  scopeKey?: string;
  summaryKey?: string;
  summaryParams?: Record<string, string | number>;
  fallbackMessage?: string;
  publicFacts?: PublicErrorFacts;
  technicalDetail?: string;
  retryable?: boolean;
  repairActions?: CreatorRepairAction[];
};

export type NormalizedCreatorIssueInput = Omit<OpenCreatorIssue,
  'id' | 'diagnosticId' | 'occurrenceCount' | 'occurredAt' | 'lastOccurredAt' | 'resolvedAt'
> & { scope: { kind: 'creator-job'; jobId: string } };

export type CreatorIssueAssociationKind = 'stage-run' | 'provider-request' | 'command-receipt' | 'endpoint';

export type CreatorIssueService = {
  capture(input: CreatorIssueCaptureInput): OpenCreatorIssue;
  get(jobId: string, issueId: string): OpenCreatorIssue | undefined;
  beginResolution(input: {
    jobId: string;
    issueId: string;
    resolutionAttemptId: string;
    associationKind: CreatorIssueAssociationKind;
    associationId: string;
    stageRunId?: string;
  }): OpenCreatorIssue;
  finishResolution(input: {
    jobId: string;
    issueId: string;
    resolutionAttemptId: string;
    result: Exclude<IssueRetryResult, 'none'>;
    publicFacts?: PublicErrorFacts;
    technicalDetail?: string;
  }): OpenCreatorIssue;
  stats(jobId: string, range: { from: string; to: string }): CreatorIssueStatsResponse['rows'];
  list(jobId: string): OpenCreatorIssue[];
  listEvents(jobId: string, input?: { cursor?: string; limit?: number }): ReturnType<CreatorRepository['listIssueEvents']>;
};

export function createCreatorIssueService(
  repository: CreatorRepository,
  options: { onChanged?(issue: OpenCreatorIssue): void } = {}
): CreatorIssueService {
  const changed = (issue: OpenCreatorIssue) => {
    options.onChanged?.(issue);
    return issue;
  };
  return {
    capture(input) {
      return changed(repository.captureIssue(normalizeCreatorIssue(input)));
    },
    get(jobId, issueId) {
      return repository.getIssue(jobId, issueId);
    },
    beginResolution(input) {
      return changed(repository.beginIssueResolution(input));
    },
    finishResolution(input) {
      return changed(repository.finishIssueResolution({
        ...input,
        ...(input.publicFacts === undefined ? {} : { publicFacts: sanitizePublicFacts(input.publicFacts) }),
        ...(input.technicalDetail === undefined ? {} : {
          technicalDetail: sanitizeIssueDetail(input.technicalDetail)
        })
      }));
    },
    stats(jobId, range) {
      return repository.aggregateIssueStats(jobId, range);
    },
    list(jobId) {
      return repository.listIssues(jobId);
    },
    listEvents(jobId, input) {
      return repository.listIssueEvents(jobId, input);
    }
  };
}

export function normalizeCreatorIssue(input: CreatorIssueCaptureInput): NormalizedCreatorIssueInput {
  const code = sanitizeIdentifier(input.code, 'creator_unknown_error');
  const operation = optionalIdentifier(input.operation);
  const stageId = optionalIdentifier(input.stageId);
  const scopeKey = optionalIdentifier(input.scopeKey, 200);
  const category = input.category ?? categoryForSource(input.source);
  const fallbackMessage = sanitizeDisplayText(
    input.fallbackMessage ?? fallbackForCategory(category),
    500
  );
  const technicalDetail = input.technicalDetail === undefined
    ? undefined
    : sanitizeDisplayText(input.technicalDetail, 1_000);
  const publicFacts = input.publicFacts === undefined ? undefined : sanitizePublicFacts(input.publicFacts);
  const repairActions = sanitizeRepairActions(input.repairActions ?? []);
  const retryable = input.retryable === true
    && repairActions.some(action => action.kind === 'retry-operation');
  const fingerprint = creatorIssueFingerprint({
    jobId: input.jobId,
    code,
    source: input.source,
    operation,
    stageId,
    scopeKey
  });

  return {
    code,
    scope: { kind: 'creator-job', jobId: input.jobId },
    source: input.source,
    category,
    severity: input.severity ?? 'error',
    status: 'open',
    ...(operation === undefined ? {} : { operation }),
    ...(stageId === undefined ? {} : { stageId }),
    ...(input.stageRunId === undefined ? {} : { stageRunId: sanitizeIdentifier(input.stageRunId, 'unknown') }),
    ...(scopeKey === undefined ? {} : { scopeKey }),
    summaryKey: sanitizeIdentifier(input.summaryKey ?? `issue.${category}`, 'issue.unknown'),
    summaryParams: sanitizeSummaryParams(input.summaryParams ?? {}),
    fallbackMessage,
    ...(publicFacts === undefined ? {} : { publicFacts }),
    ...(technicalDetail === undefined ? {} : { technicalDetail }),
    retryable,
    repairActions,
    fingerprint
  };
}

export function creatorIssueFingerprint(input: {
  jobId: string;
  code: string;
  source: IssueSource;
  operation?: string;
  stageId?: string;
  scopeKey?: string;
}): string {
  return createHash('sha256').update(JSON.stringify([
    input.jobId,
    input.source,
    input.code,
    input.operation ?? null,
    input.stageId ?? null,
    input.scopeKey ?? null
  ])).digest('hex');
}

export function sanitizeIssueDetail(value: string, max = 1_000): string {
  return sanitizeDisplayText(value, max);
}

function sanitizePublicFacts(input: PublicErrorFacts): PublicErrorFacts {
  const provider = input.provider === undefined ? undefined : sanitizeIdentifier(input.provider, 'unknown', 80);
  const upstreamCode = input.upstreamCode === undefined ? undefined : sanitizeIdentifier(input.upstreamCode, 'unknown');
  return {
    kind: input.kind,
    ...(provider !== undefined && safePublicErrorCode(provider) !== undefined ? { provider } : {}),
    ...(upstreamCode !== undefined && safePublicErrorCode(upstreamCode) !== undefined ? { upstreamCode } : {}),
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus })
  };
}

function sanitizeDisplayText(value: string, max: number): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
    .replace(/(?:authorization|api[-_ ]?key|access[-_ ]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, '[user-home]')
    .replace(/\/(?:Users|home)\/[^/\s]+/g, '[user-home]')
    .replace(/(?:\n|^)\s*at\s+[^\n]+/g, '')
    .replace(/\{[\s\S]{1,2000}\}/g, '[details removed]')
    .trim()
    .slice(0, max) || 'Operation failed.';
}

function sanitizeSummaryParams(input: Record<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(input).slice(0, 12).flatMap(([key, value]) => {
    const safeKey = optionalIdentifier(key);
    if (safeKey === undefined) return [];
    return [[safeKey, typeof value === 'number' ? value : sanitizeDisplayText(value, 160)]];
  }));
}

function sanitizeRepairActions(actions: CreatorRepairAction[]): CreatorRepairAction[] {
  const sanitized: CreatorRepairAction[] = [];
  for (const action of actions.slice(0, 8)) {
    if (action.kind === 'retry-operation') {
      const operationId = optionalIdentifier(action.operationId);
      if (operationId !== undefined) sanitized.push({ ...action, operationId });
      continue;
    }
    if (action.kind === 'open-settings') {
      const settingsRouteId = optionalIdentifier(action.settingsRouteId);
      if (settingsRouteId !== undefined) sanitized.push({ ...action, settingsRouteId });
      continue;
    }
    if (action.kind === 'select-input') {
      const inputField = optionalIdentifier(action.inputField);
      if (inputField !== undefined) sanitized.push({ ...action, inputField });
      continue;
    }
    sanitized.push({ kind: 'focus-agent' });
  }
  return sanitized;
}

function categoryForSource(source: IssueSource): IssueCategory {
  if (source === 'network') return 'network';
  if (source === 'provider') return 'provider';
  if (source === 'output-validator') return 'output-validation';
  if (source === 'preflight') return 'configuration';
  return 'execution';
}

function fallbackForCategory(category: IssueCategory): string {
  if (category === 'configuration') return '配置不完整，请检查相关设置。';
  if (category === 'permission') return '当前操作没有所需权限。';
  if (category === 'network') return '连接失败，请检查网络或服务状态。';
  if (category === 'output-validation') return '输出未通过检查，请修正后重试。';
  return '操作未完成，请重试。';
}

function sanitizeIdentifier(value: string, fallback: string, max = 160): string {
  return optionalIdentifier(value, max) ?? fallback;
}

function optionalIdentifier(value: string | undefined, max = 160): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._:/-]+/g, '-').slice(0, max);
  return sanitized.length > 0 ? sanitized : undefined;
}
