import { createHash } from 'node:crypto';
import type {
  CreatorJson,
  CreatorProviderRequest,
  CreatorProviderRequestStatus
} from '@opencreator/protocol';
import { isPublicErrorFacts } from '@opencreator/protocol';
import { sanitizeIssueDetail, type CreatorIssueService } from './issues.js';
import { publicFactsFromFailure } from './public-error-facts.js';
import type { CreatorRepository } from './repository.js';

export type CreatorProviderLookupResult =
  | { status: 'waiting_remote'; remoteTaskId: string }
  | { status: 'succeeded'; remoteTaskId?: string; resultArtifactId?: string | null }
  | { status: 'failed'; remoteTaskId?: string }
  | { status: 'not_found' };

export type CreatorProviderCapabilities = {
  lookupByRequestKey: boolean;
  lookup(input: {
    provider: string;
    requestKey: string;
    remoteTaskId: string | null;
  }): Promise<CreatorProviderLookupResult>;
};

export class CreatorProviderRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CreatorProviderRequestError';
  }
}

export class CreatorProviderRequestLedger {
  constructor(
    private readonly repository: CreatorRepository,
    private readonly issueService?: CreatorIssueService
  ) {}

  registerBeforeSubmit(input: {
    jobId: string;
    provider: string;
    stageRunId: string;
    scopeKey?: string | null;
    requestKey: string;
    request: Record<string, CreatorJson>;
    billingSideEffect?: boolean;
  }): CreatorProviderRequest {
    const requestHash = hashRequest(input.request);
    return this.repository.transaction(() => {
      const latest = this.repository.getLatestProviderRequest(input.provider, input.requestKey);
      if (latest === undefined) {
        return this.repository.createProviderRequest({
          jobId: input.jobId,
          provider: input.provider,
          stageRunId: input.stageRunId,
          scopeKey: input.scopeKey ?? null,
          requestKey: input.requestKey,
          requestHash,
          billingSideEffect: input.billingSideEffect ?? true,
          status: 'registered'
        });
      }
      if (latest.jobId !== input.jobId || latest.requestHash !== requestHash) {
        throw new CreatorProviderRequestError(
          'creator_provider_request_key_conflict',
          'Provider request key is already associated with a different request payload'
        );
      }
      if (latest.status === 'registered') return latest;
      if (isPendingRemote(latest.status)) {
        throw new CreatorProviderRequestError(
          'creator_provider_resolution_required',
          'Provider request acceptance must be resolved before this request can be submitted again'
        );
      }
      if (latest.stageRunId === input.stageRunId) {
        throw new CreatorProviderRequestError(
          'creator_provider_request_already_finalized',
          'Provider request was already finalized for the current stage run'
        );
      }
      return this.repository.createProviderRequest({
        jobId: input.jobId,
        provider: input.provider,
        stageRunId: input.stageRunId,
        scopeKey: input.scopeKey ?? null,
        requestKey: input.requestKey,
        requestHash,
        billingSideEffect: input.billingSideEffect ?? true,
        status: 'registered',
        generation: latest.generation + 1,
        resubmissionOf: latest.id
      });
    });
  }

  markSubmitting(id: string): CreatorProviderRequest {
    return this.transition(id, ['registered'], 'submitting');
  }

  markWaitingRemote(id: string, remoteTaskId: string): CreatorProviderRequest {
    if (remoteTaskId.trim().length === 0) {
      throw new CreatorProviderRequestError(
        'creator_provider_remote_id_invalid',
        'Provider remote task id must not be empty'
      );
    }
    return this.transition(
      id,
      ['submitting', 'unknown_remote_acceptance', 'waiting_remote'],
      'waiting_remote',
      { remoteTaskId }
    );
  }

  markSucceeded(id: string, resultArtifactId?: string | null): CreatorProviderRequest {
    const request = this.transition(
      id,
      ['submitting', 'waiting_remote'],
      'succeeded',
      { resultArtifactId: resultArtifactId ?? null }
    );
    this.finishProviderIssue(request, 'succeeded');
    return request;
  }

  markFailed(id: string, error?: unknown): CreatorProviderRequest {
    const request = this.transition(id, ['submitting', 'waiting_remote'], 'failed');
    if (!this.finishProviderIssue(request, 'failed', error)) this.captureProviderIssue(request, false, error);
    return request;
  }

  markUnknownRemoteAcceptance(id: string): CreatorProviderRequest {
    const request = this.transition(
      id,
      ['submitting', 'waiting_remote'],
      'unknown_remote_acceptance'
    );
    if (!this.finishProviderIssue(request, 'unknown')) this.captureProviderIssue(request, true);
    return request;
  }

  async recover(
    id: string,
    capabilities: CreatorProviderCapabilities
  ): Promise<CreatorProviderRequest> {
    const current = this.require(id);
    if (isTerminal(current.status)) return current;
    const canLookup = current.remoteTaskId !== null || capabilities.lookupByRequestKey;
    if (!canLookup) return this.toUnknown(current);

    const result = await capabilities.lookup({
      provider: current.provider,
      requestKey: current.requestKey,
      remoteTaskId: current.remoteTaskId
    });
    if (result.status === 'not_found') return this.toUnknown(current);
    if (result.status === 'waiting_remote') {
      return this.transition(
        id,
        ['submitting', 'waiting_remote', 'unknown_remote_acceptance'],
        'waiting_remote',
        { remoteTaskId: result.remoteTaskId }
      );
    }
    if (result.status === 'succeeded') {
      const request = this.transition(
        id,
        ['submitting', 'waiting_remote', 'unknown_remote_acceptance'],
        'succeeded',
        {
          ...(result.remoteTaskId === undefined ? {} : { remoteTaskId: result.remoteTaskId }),
          resultArtifactId: result.resultArtifactId ?? null
        }
      );
      this.finishProviderIssue(request, 'succeeded');
      return request;
    }
    const request = this.transition(
      id,
      ['submitting', 'waiting_remote', 'unknown_remote_acceptance'],
      'failed',
      result.remoteTaskId === undefined ? {} : { remoteTaskId: result.remoteTaskId }
    );
    if (!this.finishProviderIssue(request, 'failed')) this.captureProviderIssue(request, false);
    return request;
  }

  confirmResubmit(id: string): CreatorProviderRequest {
    const next = this.repository.transaction(() => {
      const current = this.transition(
        id,
        ['unknown_remote_acceptance'],
        'abandoned_unknown'
      );
      return this.repository.createProviderRequest({
        jobId: current.jobId,
        provider: current.provider,
        stageRunId: current.stageRunId,
        scopeKey: current.scopeKey,
        requestKey: current.requestKey,
        requestHash: current.requestHash,
        billingSideEffect: current.billingSideEffect,
        status: 'registered',
        generation: current.generation + 1,
        resubmissionOf: current.id
      });
    });
    this.beginProviderIssue(next);
    return next;
  }

  cancelScope(id: string): CreatorProviderRequest {
    const request = this.transition(id, ['unknown_remote_acceptance'], 'canceled');
    const openIssue = this.findProviderIssue(request, 'open');
    if (openIssue !== undefined) {
      const resolutionAttemptId = `cancel:${request.id}`;
      this.issueService?.beginResolution({
        jobId: request.jobId,
        issueId: openIssue.id,
        resolutionAttemptId,
        associationKind: 'provider-request',
        associationId: request.id,
        stageRunId: request.stageRunId
      });
      this.issueService?.finishResolution({
        jobId: request.jobId,
        issueId: openIssue.id,
        resolutionAttemptId,
        result: 'succeeded'
      });
    } else {
      this.finishProviderIssue(request, 'canceled');
    }
    return request;
  }

  unresolvedForStage(input: {
    jobId: string;
    stageId: string;
    scopeKey?: string | null;
  }): CreatorProviderRequest[] {
    const stageIds = new Set(this.repository.listStageRuns(input.jobId)
      .filter(stage => (
        stage.stageId === input.stageId
        && stage.scopeKey === (input.scopeKey ?? null)
      ))
      .map(stage => stage.id));
    return this.repository.listProviderRequests(input.jobId).filter(request => (
      stageIds.has(request.stageRunId)
      && request.status === 'unknown_remote_acceptance'
    ));
  }

  private toUnknown(current: CreatorProviderRequest): CreatorProviderRequest {
    if (current.status === 'unknown_remote_acceptance') return current;
    const request = this.transition(
      current.id,
      ['registered', 'submitting', 'waiting_remote'],
      'unknown_remote_acceptance'
    );
    if (!this.finishProviderIssue(request, 'unknown')) this.captureProviderIssue(request, true);
    return request;
  }

  private captureProviderIssue(
    request: CreatorProviderRequest,
    unknownRemoteAcceptance: boolean,
    error?: unknown
  ): void {
    const stage = this.repository.getStageRun(request.stageRunId);
    this.issueService?.capture({
      jobId: request.jobId,
      code: unknownRemoteAcceptance
        ? 'creator_provider_resolution_required'
        : 'creator_provider_request_failed',
      source: 'provider',
      category: 'provider',
      operation: 'creator.retry-stage',
      stageId: stage?.stageId,
      stageRunId: request.stageRunId,
      scopeKey: request.scopeKey ?? undefined,
      fallbackMessage: unknownRemoteAcceptance
        ? '外部服务是否已接收请求尚不明确，请先查询状态或确认后再继续。'
        : '外部服务调用失败，可以重试或询问 Agent。',
      publicFacts: factsForProvider(error, request.provider),
      ...(error instanceof Error ? { technicalDetail: sanitizeIssueDetail(error.message) } : {}),
      retryable: !unknownRemoteAcceptance,
      repairActions: [
        ...(!unknownRemoteAcceptance
          ? [{
              kind: 'retry-operation' as const,
              operationId: 'creator.retry-stage',
              requiresConfirmation: false,
              risk: 'normal' as const
            }]
          : []),
        { kind: 'focus-agent' as const }
      ]
    });
  }

  private beginProviderIssue(request: CreatorProviderRequest): void {
    const issue = this.findProviderIssue(request, 'open');
    if (issue === undefined) return;
    this.issueService?.beginResolution({
      jobId: request.jobId,
      issueId: issue.id,
      resolutionAttemptId: request.id,
      associationKind: 'provider-request',
      associationId: request.id,
      stageRunId: request.stageRunId
    });
  }

  private finishProviderIssue(
    request: CreatorProviderRequest,
    result: 'succeeded' | 'failed' | 'canceled' | 'unknown',
    error?: unknown
  ): boolean {
    const issue = this.findProviderIssue(request, 'resolving');
    if (issue === undefined) return false;
    this.issueService?.finishResolution({
      jobId: request.jobId,
      issueId: issue.id,
      resolutionAttemptId: request.id,
      result,
      ...(result === 'failed' && error !== undefined ? {
        publicFacts: factsForProvider(error, request.provider),
        ...(error instanceof Error ? { technicalDetail: sanitizeIssueDetail(error.message) } : {})
      } : {})
    });
    return true;
  }

  private findProviderIssue(
    request: CreatorProviderRequest,
    status: 'open' | 'resolving'
  ) {
    const stageId = this.repository.getStageRun(request.stageRunId)?.stageId;
    return this.issueService?.list(request.jobId).find(issue => (
      issue.source === 'provider'
      && issue.status === status
      && issue.scopeKey === (request.scopeKey ?? undefined)
      && (stageId === undefined || issue.stageId === stageId)
    ));
  }

  private transition(
    id: string,
    allowed: CreatorProviderRequestStatus[],
    status: CreatorProviderRequestStatus,
    patch: { remoteTaskId?: string | null; resultArtifactId?: string | null } = {}
  ): CreatorProviderRequest {
    const current = this.require(id);
    if (!allowed.includes(current.status)) {
      throw new CreatorProviderRequestError(
        'creator_provider_transition_invalid',
        `Provider request cannot transition from ${current.status} to ${status}`
      );
    }
    return this.repository.updateProviderRequest({ id, status, ...patch });
  }

  private require(id: string): CreatorProviderRequest {
    const request = this.repository.getProviderRequest(id);
    if (request === undefined) {
      throw new CreatorProviderRequestError(
        'creator_provider_request_not_found',
        'Creator provider request was not found'
      );
    }
    return request;
  }
}

function factsForProvider(error: unknown, provider: string) {
  const provided = typeof error === 'object' && error !== null
    ? (error as { publicFacts?: unknown }).publicFacts
    : undefined;
  return isPublicErrorFacts(provided)
    ? { ...provided, provider }
    : publicFactsFromFailure(error, provider);
}

function hashRequest(value: Record<string, CreatorJson>): string {
  return createHash('sha256').update(JSON.stringify(sortValue(value))).digest('hex');
}

function sortValue(value: CreatorJson): CreatorJson {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}

function isTerminal(status: CreatorProviderRequestStatus): boolean {
  return ['succeeded', 'failed', 'abandoned_unknown', 'canceled'].includes(status);
}

function isPendingRemote(status: CreatorProviderRequestStatus): boolean {
  return ['submitting', 'waiting_remote', 'unknown_remote_acceptance'].includes(status);
}
