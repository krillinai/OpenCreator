import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CreatorProviderRequestError,
  CreatorProviderRequestLedger,
  type CreatorProviderCapabilities
} from '../../src/creator/provider-requests.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorServiceError, createCreatorService } from '../../src/creator/service.js';
import {
  createCreatorTemplateRegistry,
  createDefaultCreatorTemplateRegistry,
  createStickmanVideoTemplate
} from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup(path = join(tempDir, 'runtime.sqlite')) {
  const db = openRuntimeDatabase(path);
  const repository = createCreatorRepository(db);
  const job = repository.createJob({
    projectId: 'project_1',
    templateId: 'image-generation',
    templateVersion: 1,
    status: 'running',
    state: {}
  });
  const stage = repository.createStageRun({
    jobId: job.id,
    stageId: 'generate',
    executor: 'image',
    status: 'running',
    scopeKey: 'shot-01',
    inputFingerprint: 'a'.repeat(64)
  });
  return { db, repository, job, stage, ledger: new CreatorProviderRequestLedger(repository) };
}

describe('creator provider request ledger', () => {
  it('closes the matching unknown-receipt issue only after all requests in its scope are recovered', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-stream-recovery-'));
    const { db, repository, job, stage } = setup();
    const issues = createCreatorIssueService(repository);
    const ledger = new CreatorProviderRequestLedger(repository, issues);
    try {
      const requests = ['first', 'second'].map(requestKey => {
        const request = ledger.registerBeforeSubmit({ jobId: job.id, stageRunId: stage.id, scopeKey: stage.scopeKey,
          provider: 'opencreator-gateway-chat/completions', requestKey, request: { prompt: requestKey } });
        ledger.markSubmitting(request.id); ledger.markWaitingRemote(request.id, 'remote-' + requestKey);
        return ledger.markUnknownRemoteAcceptance(request.id);
      });
      const failedIssue = issues.capture({ jobId: job.id, stageRunId: stage.id, stageId: stage.stageId,
        scopeKey: stage.scopeKey ?? undefined, source: 'provider', code: 'creator_provider_request_failed',
        publicFacts: { kind: 'unknown', provider: requests[0]!.provider } });
      const lookup = { lookupByRequestKey: false, lookup: async () => ({ status: 'succeeded' as const }) };
      await ledger.recover(requests[0]!.id, lookup);
      expect(issues.list(job.id)).toHaveLength(2);
      expect(issues.list(job.id).every(issue => issue.status === 'open')).toBe(true);
      await ledger.recover(requests[1]!.id, lookup);
      expect(issues.list(job.id).find(issue => issue.code === 'creator_provider_resolution_required')!.status).toBe('resolved');
      expect(issues.get(job.id, failedIssue.id)!.status).toBe('open');
      expect(repository.listProviderRequests(job.id).every(request => request.status === 'succeeded')).toBe(true);
    } finally { db.close(); }
  });
  it('blocks fresh image runs and retries until a previous paid request is explicitly resolved', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-image-recovery-'));
    const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
    const repository = createCreatorRepository(db);
    const service = createCreatorService({ repository, templates: createDefaultCreatorTemplateRegistry() });
    const job = service.createJob({ projectId: 'project', templateId: 'image-generation', state: { prompt: 'test' } });
    const stage = repository.createStageRun({ jobId: job.id, stageId: 'generate', executor: 'image', status: 'failed' });
    const ledger = new CreatorProviderRequestLedger(repository);
    const request = ledger.registerBeforeSubmit({ jobId: job.id, stageRunId: stage.id, provider: 'opencreator-gateway-image', requestKey: 'paid-image', request: { prompt: 'test' } });
    ledger.markSubmitting(request.id); ledger.markUnknownRemoteAcceptance(request.id);
    try {
      for (const action of ['run-stage', 'retry-stage']) {
        expect(() => service.applyAction(job.id, { actor: 'user', action, expectedRevision: job.revision, input: { stageId: 'generate' } })).toThrowError(expect.objectContaining({ code: 'creator_provider_resolution_required' }));
      }
      const resolved = service.applyAction(job.id, { actor: 'user', action: 'resolve-provider-request', expectedRevision: job.revision, input: { ledgerId: request.id, decision: 'cancel-scope' } });
      expect(repository.getProviderRequest(request.id)?.status).toBe('canceled');
      expect(() => service.applyAction(job.id, { actor: 'user', action: 'retry-stage', expectedRevision: resolved.job.revision, input: { stageId: 'generate' } })).not.toThrow();
    } finally { db.close(); }
  });
  it('preserves the service source of an existing job after an account switch and database reopen', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-service-binding-'));
    const path = join(tempDir, 'runtime.sqlite');
    let current = { source: 'gateway' as const, accountId: 'a', bindingVersion: 'a:1', models: { image: 'original-image' }, capabilities: { image: ['image_count'] } };
    const db = openRuntimeDatabase(path);
    const repository = createCreatorRepository(db, { serviceBinding: () => current });
    const job = repository.createJob({ projectId: 'project', templateId: 'image-generation', templateVersion: 1, status: 'draft', state: {} });
    current = { ...current, accountId: 'b', bindingVersion: 'b:1' };
    expect(repository.getServiceBinding(job.id)).toMatchObject({ accountId: 'a', bindingVersion: 'a:1' });
    db.close();
    const reopened = openRuntimeDatabase(path);
    expect(createCreatorRepository(reopened).getServiceBinding(job.id)).toMatchObject({ accountId: 'a', models: { image: 'original-image' } });
    reopened.close();
  });
  it('persists the original gateway account and logical identity for recovery', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-gateway-ledger-'));
    const { db, job, stage, repository, ledger } = setup();
    const gateway = { accountId:'account-a', bindingVersion:'account-a:1', logicalId:'stable-stage-image' };
    const original = ledger.registerBeforeSubmit({jobId:job.id,provider:'opencreator-gateway',stageRunId:stage.id,requestKey:gateway.logicalId,request:{prompt:'draw'},gateway});
    ledger.markSubmitting(original.id); ledger.markWaitingRemote(original.id,'gateway-original-request');
    expect(repository.getProviderRequest(original.id)).toMatchObject({gateway,remoteTaskId:'gateway-original-request'});
    expect(JSON.stringify(repository.getProviderRequest(original.id))).not.toMatch(/modelKey|apiKey|accessToken/);
    db.close();
  });
  it('keeps unknown paid acceptance non-retryable and resolves the same issue after explicit resubmit', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const { db, job, stage, repository } = setup();
    const issues = createCreatorIssueService(repository);
    const ledger = new CreatorProviderRequestLedger(repository, issues);
    const first = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: stage.id,
      scopeKey: stage.scopeKey,
      requestKey: `${job.id}:images:shot-01`,
      request: { prompt: 'draw' },
      billingSideEffect: true
    });
    ledger.markSubmitting(first.id);
    ledger.markUnknownRemoteAcceptance(first.id);

    const uncertain = issues.list(job.id)[0]!;
    expect(uncertain).toMatchObject({
      source: 'provider',
      code: 'creator_provider_resolution_required',
      status: 'open',
      retryable: false,
      repairActions: [{ kind: 'focus-agent' }]
    });

    const resubmitted = ledger.confirmResubmit(first.id);
    expect(issues.get(job.id, uncertain.id)?.status).toBe('resolving');
    ledger.markSubmitting(resubmitted.id);
    ledger.markSucceeded(resubmitted.id);
    expect(issues.get(job.id, uncertain.id)).toMatchObject({
      id: uncertain.id,
      status: 'resolved'
    });
    db.close();
  });

  it('blocks automatic resubmit after provider acceptance is uncertain', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const path = join(tempDir, 'runtime.sqlite');
    const first = setup(path);
    let submitCount = 0;
    const registered = first.ledger.registerBeforeSubmit({
      jobId: first.job.id,
      provider: 'openai-image',
      stageRunId: first.stage.id,
      scopeKey: 'shot-01',
      requestKey: `${first.job.id}:images:shot-01`,
      request: { prompt: 'draw', apiKey: 'must-not-be-persisted' }
    });
    first.ledger.markSubmitting(registered.id);
    submitCount += 1;
    first.ledger.markUnknownRemoteAcceptance(registered.id);
    expect(JSON.stringify(first.repository.getJob(first.job.id))).not.toContain('must-not-be-persisted');
    first.db.close();

    const secondDb = openRuntimeDatabase(path);
    const secondRepository = createCreatorRepository(secondDb);
    const lookup = vi.fn<CreatorProviderCapabilities['lookup']>();
    const recovered = await new CreatorProviderRequestLedger(secondRepository).recover(
      registered.id,
      { lookupByRequestKey: false, lookup }
    );

    expect(recovered.status).toBe('unknown_remote_acceptance');
    expect(lookup).not.toHaveBeenCalled();
    expect(submitCount).toBe(1);

    const retryStage = secondRepository.createStageRun({
      jobId: first.job.id,
      stageId: 'generate',
      executor: 'image',
      status: 'running',
      scopeKey: 'shot-01',
      inputFingerprint: 'a'.repeat(64)
    });
    expect(() => new CreatorProviderRequestLedger(secondRepository).registerBeforeSubmit({
      jobId: first.job.id,
      provider: 'openai-image',
      stageRunId: retryStage.id,
      scopeKey: 'shot-01',
      requestKey: `${first.job.id}:images:shot-01`,
      request: { prompt: 'draw', apiKey: 'must-not-be-persisted' }
    })).toThrowError(expect.objectContaining<Partial<CreatorProviderRequestError>>({
      code: 'creator_provider_resolution_required'
    }));
    secondDb.close();
  });

  it('creates a new generation only after the unknown request is abandoned', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const { db, job, stage, ledger, repository } = setup();
    const first = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: stage.id,
      scopeKey: stage.scopeKey,
      requestKey: `${job.id}:images:shot-01`,
      request: { prompt: 'draw' }
    });
    ledger.markSubmitting(first.id);
    ledger.markUnknownRemoteAcceptance(first.id);

    const second = ledger.confirmResubmit(first.id);
    repository.updateStageRun({
      id: stage.id,
      status: 'failed',
      errorCode: 'creator_provider_resolution_required',
      errorMessage: 'Provider request acceptance requires resolution'
    });

    expect(repository.getProviderRequest(first.id)?.status).toBe('abandoned_unknown');
    expect(second).toMatchObject({
      generation: 2,
      resubmissionOf: first.id,
      status: 'registered',
      requestHash: first.requestHash
    });
    const retryStage = repository.createStageRun({
      jobId: job.id,
      stageId: 'generate',
      executor: 'image',
      status: 'running',
      scopeKey: 'shot-01',
      inputFingerprint: 'a'.repeat(64)
    });
    const reused = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: retryStage.id,
      scopeKey: 'shot-01',
      requestKey: `${job.id}:images:shot-01`,
      request: { prompt: 'draw' }
    });
    expect(reused.id).toBe(second.id);
    expect(repository.listProviderRequests(job.id)).toHaveLength(2);
    db.close();
  });

  it('creates the next generation when a terminal request is retried by a new stage run', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const { db, job, stage, ledger, repository } = setup();
    const requestKey = `${job.id}:images:shot-01`;
    const first = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: stage.id,
      scopeKey: 'shot-01',
      requestKey,
      request: { prompt: 'draw' }
    });
    ledger.markSubmitting(first.id);
    ledger.markFailed(first.id);
    repository.updateStageRun({
      id: stage.id,
      status: 'failed',
      errorCode: 'creator_stage_failed',
      errorMessage: 'Provider request failed'
    });
    const retryStage = repository.createStageRun({
      jobId: job.id,
      stageId: 'generate',
      executor: 'image',
      status: 'running',
      scopeKey: 'shot-01',
      inputFingerprint: 'a'.repeat(64)
    });

    const retry = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: retryStage.id,
      scopeKey: 'shot-01',
      requestKey,
      request: { prompt: 'draw' }
    });

    expect(retry).toMatchObject({
      generation: 2,
      resubmissionOf: first.id,
      status: 'registered',
      stageRunId: retryStage.id
    });
    db.close();
  });

  it('rejects reuse of a request key for a different payload', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const { db, job, stage, ledger, repository } = setup();
    const requestKey = `${job.id}:images:shot-01`;
    const first = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: stage.id,
      scopeKey: 'shot-01',
      requestKey,
      request: { prompt: 'draw' }
    });
    ledger.markSubmitting(first.id);
    ledger.markFailed(first.id);
    repository.updateStageRun({
      id: stage.id,
      status: 'failed',
      errorCode: 'creator_stage_failed',
      errorMessage: 'Provider request failed'
    });
    const retryStage = repository.createStageRun({
      jobId: job.id,
      stageId: 'generate',
      executor: 'image',
      status: 'running',
      scopeKey: 'shot-01',
      inputFingerprint: 'a'.repeat(64)
    });

    expect(() => ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: retryStage.id,
      scopeKey: 'shot-01',
      requestKey,
      request: { prompt: 'changed payload' }
    })).toThrowError(expect.objectContaining<Partial<CreatorProviderRequestError>>({
      code: 'creator_provider_request_key_conflict'
    }));
    expect(repository.listProviderRequests(job.id)).toHaveLength(1);
    db.close();
  });

  it('queries and cancels an unknown scope without creating a paid request', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const { db, job, stage, ledger, repository } = setup();
    const artifact = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey: 'shot-02',
      inputFingerprint: 'b'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const queryRequest = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: stage.id,
      scopeKey: 'shot-01',
      requestKey: `${job.id}:images:shot-01`,
      request: { prompt: 'draw' }
    });
    ledger.markSubmitting(queryRequest.id);
    ledger.markUnknownRemoteAcceptance(queryRequest.id);
    const lookup = vi.fn<CreatorProviderCapabilities['lookup']>().mockResolvedValue({
      status: 'waiting_remote',
      remoteTaskId: 'remote-1'
    });

    const queried = await ledger.recover(queryRequest.id, {
      lookupByRequestKey: true,
      lookup
    });
    expect(queried).toMatchObject({ status: 'waiting_remote', remoteTaskId: 'remote-1' });
    expect(lookup).toHaveBeenCalledTimes(1);

    const cancelStage = repository.createStageRun({
      jobId: job.id,
      stageId: 'generate',
      executor: 'image',
      status: 'running',
      scopeKey: 'shot-03',
      inputFingerprint: 'c'.repeat(64)
    });
    const cancelRequest = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: cancelStage.id,
      scopeKey: 'shot-03',
      requestKey: `${job.id}:images:shot-03`,
      request: { prompt: 'draw' }
    });
    ledger.markSubmitting(cancelRequest.id);
    ledger.markUnknownRemoteAcceptance(cancelRequest.id);
    expect(ledger.cancelScope(cancelRequest.id).status).toBe('canceled');
    expect(repository.getJob(job.id)?.artifacts.find(item => item.id === artifact.id)?.status)
      .toBe('completed');
    db.close();
  });

  it('allows only a user-confirmed resubmit and blocks ordinary retry', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-provider-ledger-'));
    const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
    const repository = createCreatorRepository(db);
    const base = createStickmanVideoTemplate();
    const record = z.record(z.string(), z.unknown()) as never;
    const service = createCreatorService({
      repository,
      templates: createCreatorTemplateRegistry([{
        ...base,
        actions: [
          ...base.actions.filter(action => (
            action.id !== 'retry-stage' && action.id !== 'resolve-provider-request'
          )),
          { id: 'retry-stage', inputSchema: record, allowedStages: ['script'] },
          { id: 'resolve-provider-request', inputSchema: record, allowedStages: ['script'] }
        ]
      }])
    });
    const job = service.createJob({ projectId: 'project_1', templateId: 'stickman-video' });
    const stage = repository.createStageRun({
      jobId: job.id,
      stageId: 'script',
      executor: 'stickman',
      status: 'running',
      scopeKey: 'shot-01',
      inputFingerprint: 'a'.repeat(64)
    });
    const ledger = new CreatorProviderRequestLedger(repository);
    const request = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai-image',
      stageRunId: stage.id,
      scopeKey: stage.scopeKey,
      requestKey: `${job.id}:script:shot-01`,
      request: { prompt: 'draw' }
    });
    ledger.markSubmitting(request.id);
    ledger.markUnknownRemoteAcceptance(request.id);

    expect(() => service.applyAction(job.id, {
      actor: 'agent',
      action: 'resolve-provider-request',
      expectedRevision: 0,
      input: {
        ledgerId: request.id,
        decision: 'confirm-resubmit',
        acceptDuplicateBilling: true,
        revision: 0
      }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_provider_confirmation_required'
    }));
    expect(() => service.applyAction(job.id, {
      actor: 'user',
      action: 'resolve-provider-request',
      expectedRevision: 0,
      input: { ledgerId: request.id, decision: 'confirm-resubmit', revision: 0 }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_provider_confirmation_required'
    }));
    expect(() => service.applyAction(job.id, {
      actor: 'user',
      action: 'retry-stage',
      expectedRevision: 0,
      input: { stageId: 'script', scopeKey: 'shot-01' }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_provider_resolution_required'
    }));

    expect(() => service.applyAction(job.id, {
      actor: 'user',
      action: 'resolve-provider-request',
      expectedRevision: 0,
      input: {
        ledgerId: request.id,
        decision: 'confirm-resubmit',
        acceptDuplicateBilling: true,
        revision: 0,
        apiKey: 'must-not-be-audited'
      }
    })).not.toThrow();
    const resolved = service.getJob(job.id)!;
    expect(resolved.providerRequests).toMatchObject([
      { id: request.id, status: 'abandoned_unknown', generation: 1 },
      { status: 'registered', generation: 2, resubmissionOf: request.id }
    ]);
    expect(JSON.stringify(resolved.activities.at(-1))).not.toContain('must-not-be-audited');
    db.close();
  });
});
