import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorServiceError, createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createStickmanVideoWorkflow } from '../../src/creator/templates/stickman-video-actions.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-recovery-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const ledger = new CreatorProviderRequestLedger(repository);
  const service = createCreatorService({
    repository,
    templates,
    providerRequestLedger: ledger
  });
  const dispatcher = createCreatorCommandDispatcher({
    service,
    repository,
    receipts: createCreatorAgentRepository(db)
  });
  const workflow = createStickmanVideoWorkflow({
    creator: service,
    dispatcher,
    repository,
    providerLedger: ledger
  });
  return { db, repository, service, dispatcher, ledger, workflow, templates };
}

describe('stickman video recovery', () => {
  it('recovers interrupted scopes without duplicating unknown provider billing', async () => {
    const { db, repository, service, ledger, workflow } = setup();
    const converged = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const fingerprint = 'a'.repeat(64);
    const completedStage = repository.createStageRun({
      jobId: converged.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'interrupted',
      scopeKey: 'shot-01',
      inputFingerprint: fingerprint
    });
    const artifact = repository.insertArtifact({
      jobId: converged.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey: 'shot-01',
      inputFingerprint: fingerprint,
      sourceArtifactIds: [],
      metadata: {}
    });

    const unknown = service.createJob({ projectId: 'p2', templateId: 'stickman-video' });
    const unknownStage = repository.createStageRun({
      jobId: unknown.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'interrupted',
      scopeKey: 'shot-02',
      inputFingerprint: 'b'.repeat(64)
    });
    const request = ledger.registerBeforeSubmit({
      jobId: unknown.id,
      provider: 'openai',
      stageRunId: unknownStage.id,
      scopeKey: 'shot-02',
      requestKey: 'unknown-request',
      request: { prompt: 'test' }
    });
    ledger.markSubmitting(request.id);

    await workflow.recover();

    expect(repository.getStageRun(completedStage.id)).toMatchObject({
      status: 'succeeded',
      progress: { recoveredArtifactId: artifact.id }
    });
    expect(repository.getProviderRequest(request.id)?.status).toBe('unknown_remote_acceptance');
    expect(service.getJob(unknown.id)).toMatchObject({
      status: 'needs_input',
      state: { needsInput: { code: 'creator_provider_resolution_required' } }
    });
    expect(service.getJob(unknown.id)!.stages).toHaveLength(1);
    db.close();
  });

  it('resumes an interrupted scope only when no remote side effect exists', async () => {
    const { db, repository, service, workflow } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const interrupted = repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'interrupted',
      scopeKey: 'shot-01',
      inputFingerprint: 'c'.repeat(64)
    });

    await workflow.recover();

    expect(service.getJob(job.id)!.stages).toContainEqual(expect.objectContaining({
      stageId: 'images',
      scopeKey: 'shot-01',
      inputFingerprint: 'c'.repeat(64),
      status: 'queued',
      progress: expect.objectContaining({ resumedFromStageRunId: interrupted.id })
    }));
    db.close();
  });

  it('cancels every active scope and preserves completed artifacts', () => {
    const { db, repository, service, templates } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: 'shot-01',
      inputFingerprint: 'd'.repeat(64)
    });
    repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: 'shot-02',
      inputFingerprint: 'e'.repeat(64)
    });
    const completed = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey: 'shot-00',
      inputFingerprint: 'f'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [],
      workRoot: join(tempDir, 'jobs')
    });

    expect(runner.cancelJob(job.id)).toHaveLength(2);
    expect(service.getJob(job.id)!.stages.map(stage => stage.status)).toEqual([
      'canceled',
      'canceled'
    ]);
    expect(service.getJob(job.id)!.artifacts.find(item => item.id === completed.id)?.status)
      .toBe('completed');
    db.close();
  });

  it('rejects stale agent revisions and agent duplicate-billing confirmation', () => {
    const { db, repository, service, ledger } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const stage = repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'interrupted',
      scopeKey: 'shot-01',
      inputFingerprint: '1'.repeat(64)
    });
    const request = ledger.registerBeforeSubmit({
      jobId: job.id,
      provider: 'openai',
      stageRunId: stage.id,
      scopeKey: 'shot-01',
      requestKey: 'agent-guard',
      request: { prompt: 'test' }
    });
    ledger.markSubmitting(request.id);
    ledger.markUnknownRemoteAcceptance(request.id);
    const updated = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: job.revision,
      input: { patch: { style: 'new' }, activityMode: 'semantic', objectId: 'style' }
    }).job;

    expect(() => service.applyAction(job.id, {
      actor: 'agent',
      action: 'update-settings',
      expectedRevision: job.revision,
      input: { patch: { style: 'stale' }, activityMode: 'semantic', objectId: 'style' }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_revision_conflict',
      latestRevision: updated.revision
    }));
    expect(() => service.applyAction(job.id, {
      actor: 'agent',
      action: 'resolve-provider-request',
      expectedRevision: updated.revision,
      input: {
        ledgerId: request.id,
        revision: updated.revision,
        decision: 'confirm-resubmit',
        acceptDuplicateBilling: true
      }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_provider_confirmation_required'
    }));
    db.close();
  });
});
