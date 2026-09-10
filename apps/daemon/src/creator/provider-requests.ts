import { createHash } from 'node:crypto';
import type {
  CreatorJson,
  CreatorProviderRequest,
  CreatorProviderRequestStatus
} from '@opencreator/protocol';
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
  constructor(private readonly repository: CreatorRepository) {}

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
    return this.transition(
      id,
      ['submitting', 'waiting_remote'],
      'succeeded',
      { resultArtifactId: resultArtifactId ?? null }
    );
  }

  markFailed(id: string): CreatorProviderRequest {
    return this.transition(id, ['submitting', 'waiting_remote'], 'failed');
  }

  markUnknownRemoteAcceptance(id: string): CreatorProviderRequest {
    return this.transition(
      id,
      ['submitting', 'waiting_remote'],
      'unknown_remote_acceptance'
    );
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
      return this.transition(
        id,
        ['submitting', 'waiting_remote', 'unknown_remote_acceptance'],
        'succeeded',
        {
          ...(result.remoteTaskId === undefined ? {} : { remoteTaskId: result.remoteTaskId }),
          resultArtifactId: result.resultArtifactId ?? null
        }
      );
    }
    return this.transition(
      id,
      ['submitting', 'waiting_remote', 'unknown_remote_acceptance'],
      'failed',
      result.remoteTaskId === undefined ? {} : { remoteTaskId: result.remoteTaskId }
    );
  }

  confirmResubmit(id: string): CreatorProviderRequest {
    return this.repository.transaction(() => {
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
  }

  cancelScope(id: string): CreatorProviderRequest {
    return this.transition(id, ['unknown_remote_acceptance'], 'canceled');
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
    return this.transition(
      current.id,
      ['registered', 'submitting', 'waiting_remote'],
      'unknown_remote_acceptance'
    );
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
