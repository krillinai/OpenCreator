import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import {
  CreatorCommandError,
  createCreatorCommandDispatcher
} from '../../src/creator/command-dispatcher.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator command dispatcher', () => {
  it('commits revision, activity, StageRun and receipt once', () => {
    const fixture = setup();
    const wake = vi.fn();
    const dispatcher = createCreatorCommandDispatcher({
      service: fixture.service,
      repository: fixture.repository,
      receipts: fixture.receipts,
      onQueuedStage: wake
    });
    const request = {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'run-subtitle-1',
      input: { stageId: 'subtitle' }
    };

    const first = dispatcher.dispatch(fixture.jobId, request, 'user');
    const replay = dispatcher.dispatch(fixture.jobId, request, 'user');
    const restored = fixture.service.getJob(fixture.jobId)!;

    expect(first.commandReceipt).toMatchObject({
      status: 'committed',
      committedRevision: 1,
      stageRunId: expect.any(String)
    });
    expect(replay.commandReceipt).toMatchObject({
      id: first.commandReceipt.id,
      status: 'replayed',
      committedRevision: 1
    });
    expect(restored.revision).toBe(1);
    expect(restored.activities.filter(item => item.action === 'run-stage')).toHaveLength(1);
    expect(restored.stages).toHaveLength(1);
    expect(restored.stages[0]).toMatchObject({
      status: 'queued',
      dispatchStatus: 'queued',
      idempotencyKey: 'run-subtitle-1:stage',
      attempt: 0
    });
    expect(wake).toHaveBeenCalledTimes(1);
    fixture.db.close();
  });

  it('rejects reuse of an idempotency key with a different payload', () => {
    const fixture = setup();
    const dispatcher = createCreatorCommandDispatcher({
      service: fixture.service,
      repository: fixture.repository,
      receipts: fixture.receipts
    });
    dispatcher.dispatch(fixture.jobId, {
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'settings-1',
      input: { patch: { targetLanguage: 'ja' } }
    }, 'user');

    expect(() => dispatcher.dispatch(fixture.jobId, {
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'settings-1',
      input: { patch: { targetLanguage: 'fr' } }
    }, 'user')).toThrowError(expect.objectContaining<Partial<CreatorCommandError>>({
      code: 'creator_idempotency_key_reused'
    }));
    expect(fixture.service.getJob(fixture.jobId)?.state.targetLanguage).toBe('ja');
    fixture.db.close();
  });

  it('persists a revision conflict receipt and replays the same failure', () => {
    const fixture = setup();
    const dispatcher = createCreatorCommandDispatcher({
      service: fixture.service,
      repository: fixture.repository,
      receipts: fixture.receipts
    });
    dispatcher.dispatch(fixture.jobId, {
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'settings-first',
      input: { patch: { targetLanguage: 'ja' } }
    }, 'user');
    const stale = {
      action: 'update-settings',
      expectedRevision: 0,
      idempotencyKey: 'settings-stale',
      input: { patch: { targetLanguage: 'fr' } }
    };

    expect(() => dispatcher.dispatch(fixture.jobId, stale, 'agent'))
      .toThrowError(expect.objectContaining({ code: 'creator_revision_conflict' }));
    expect(fixture.receipts.getReceiptByKey(fixture.jobId, 'settings-stale'))
      .toMatchObject({ status: 'rejected', errorCode: 'creator_revision_conflict' });
    expect(() => dispatcher.dispatch(fixture.jobId, stale, 'agent'))
      .toThrowError(expect.objectContaining({ code: 'creator_revision_conflict' }));
    fixture.db.close();
  });
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-command-'));
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const job = service.createJob({
    projectId: 'project-1',
    templateId: 'video-translation',
    state: { sourceUrl: 'https://www.youtube.com/watch?v=test' }
  });
  return {
    db,
    repository,
    service,
    receipts: createCreatorAgentRepository(db),
    jobId: job.id
  };
}
