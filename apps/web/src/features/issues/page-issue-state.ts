import { publicErrorKindForCode, safePublicErrorCode, type OpenCreatorIssue } from '@opencreator/protocol';
import { useCallback, useMemo, useState } from 'react';
import { ApiClientError } from '../../runtime/errors.js';
import {
  clearPageIssuesForSurface,
  dismissPageIssue,
  publishPageIssue,
  resolvePageIssue
} from './page-issue-hub.js';

export type PageIssueState = {
  issues: OpenCreatorIssue[];
  captureOperationFailure(
    operationId: string,
    cause: unknown,
    fallbackMessage?: string,
    options?: { retryable?: boolean; risk?: 'normal' | 'paid' | 'overwrite' }
  ): OpenCreatorIssue;
  resolveOperation(operationId: string): void;
  dismissIssue(issueId: string): void;
  clearIssues(): void;
};

export function usePageIssueState(surface: string): PageIssueState {
  const [byOperation, setByOperation] = useState<Record<string, OpenCreatorIssue>>({});

  const captureOperationFailure = useCallback((
    operationId: string,
    cause: unknown,
    fallbackMessage = '操作未完成，请重试。',
    options: { retryable?: boolean; risk?: 'normal' | 'paid' | 'overwrite' } = {}
  ) => {
    const normalized = normalizePageIssue(surface, operationId, cause, fallbackMessage);
    const issue = options.retryable === true ? {
      ...normalized,
      retryable: true,
      repairActions: [{
        kind: 'retry-operation' as const,
        operationId,
        requiresConfirmation: options.risk !== undefined && options.risk !== 'normal',
        risk: options.risk ?? 'normal'
      }]
    } : normalized;
    publishPageIssue(issue);
    setByOperation(current => ({
      ...current,
      [operationId]: mergeOccurrence(current[operationId], issue)
    }));
    return issue;
  }, [surface]);

  const resolveOperation = useCallback((operationId: string) => {
    resolvePageIssue(surface, operationId);
    setByOperation(current => {
      if (!(operationId in current)) return current;
      const next = { ...current };
      delete next[operationId];
      return next;
    });
  }, [surface]);

  const dismissIssue = useCallback((issueId: string) => {
    dismissPageIssue(issueId);
    setByOperation(current => Object.fromEntries(
      Object.entries(current).filter(([, issue]) => issue.id !== issueId)
    ));
  }, []);

  const clearIssues = useCallback(() => {
    clearPageIssuesForSurface(surface);
    setByOperation({});
  }, [surface]);
  const issues = useMemo(
    () => Object.values(byOperation).sort((left, right) => right.lastOccurredAt.localeCompare(left.lastOccurredAt)),
    [byOperation]
  );

  return { issues, captureOperationFailure, resolveOperation, dismissIssue, clearIssues };
}

export function normalizePageIssue(
  surface: string,
  operationId: string,
  cause: unknown,
  fallbackMessage: string
): OpenCreatorIssue {
  if (cause instanceof ApiClientError && cause.issue !== undefined) {
    const issue = cause.issue;
    if (issue.scope.kind === 'creator-job') return issue;
    const templateMismatch = /^Unknown creator template: ([a-z][a-z0-9-]{0,79})@(\d{1,3})$/.exec(cause.message);
    if (templateMismatch !== null) {
      const fingerprint = stableKey(`${surface}:${operationId}:creator_template_version_mismatch`);
      return {
        ...issue,
        diagnosticId: `OC-${fingerprint.slice(-8).toUpperCase()}`,
        code: 'creator_template_version_mismatch',
        scope: { kind: 'page', surface },
        operation: operationId,
        category: 'configuration',
        summaryKey: 'issue.configuration',
        fallbackMessage: `当前页面请求的 ${templateMismatch[1]} 模板版本 ${templateMismatch[2]} 不受本地服务支持，因此任务尚未创建。`,
        fingerprint
      };
    }
    return {
      ...issue,
      scope: { kind: 'page', surface },
      operation: operationId,
      fallbackMessage: issue.fallbackMessage === '操作未完成，请稍后重试。'
        ? fallbackMessage
        : issue.fallbackMessage || fallbackMessage
    };
  }

  const now = new Date().toISOString();
  const code = readCode(cause);
  const kind = publicErrorKindForCode(code);
  const network = kind === 'dns' || kind === 'connection-refused'
    || kind === 'connection-reset' || kind === 'timeout';
  const key = stableKey(`${surface}:${operationId}:${code}`);
  return {
    id: `page:${createId()}`,
    diagnosticId: `OC-${key.slice(-8).toUpperCase()}`,
    code,
    scope: { kind: 'page', surface },
    source: network ? 'network' : 'client',
    category: network ? 'network' : 'execution',
    severity: 'error',
    status: 'open',
    operation: operationId,
    summaryKey: 'issue.execution',
    summaryParams: {},
    fallbackMessage,
    ...(cause instanceof ApiClientError && cause.publicFacts !== undefined
      ? { publicFacts: cause.publicFacts }
      : kind === undefined ? {} : { publicFacts: { kind } }),
    retryable: false,
    repairActions: [],
    fingerprint: key,
    occurrenceCount: 1,
    occurredAt: now,
    lastOccurredAt: now
  };
}

function mergeOccurrence(previous: OpenCreatorIssue | undefined, next: OpenCreatorIssue): OpenCreatorIssue {
  if (previous === undefined || previous.fingerprint !== next.fingerprint) return next;
  return {
    ...next,
    id: previous.id,
    diagnosticId: previous.diagnosticId,
    occurredAt: previous.occurredAt,
    occurrenceCount: previous.occurrenceCount + 1
  };
}

function readCode(cause: unknown): string {
  if (cause instanceof ApiClientError) return safePublicErrorCode(cause.code) ?? 'CLIENT_OPERATION_FAILED';
  if (cause !== null && typeof cause === 'object' && 'code' in cause) {
    const code = (cause as { code?: unknown }).code;
    const safeCode = safePublicErrorCode(code);
    if (safeCode !== undefined) return safeCode;
  }
  return 'CLIENT_OPERATION_FAILED';
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stableKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
