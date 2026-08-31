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

  it('snapshots each video download option and permits different queued formats', () => {
    const fixture = setupDownload();
    const dispatcher = createCreatorCommandDispatcher({
      service: fixture.service,
      repository: fixture.repository,
      receipts: fixture.receipts
    });

    const first = dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'download-1080',
      input: {
        stageId: 'download',
        optionId: 'video-1080-1',
        mediaType: 'video',
        sourceUrl: 'https://www.youtube.com/watch?v=multi-download'
      }
    }, 'user');
    const advanced = fixture.service.getJob(fixture.jobId)!;
    fixture.repository.updateJob({
      id: advanced.id,
      status: 'running',
      revision: advanced.revision + 1,
      state: advanced.state
    });
    const second = dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: first.job.revision,
      idempotencyKey: 'download-720',
      input: {
        stageId: 'download',
        optionId: 'video-720-2',
        mediaType: 'video',
        sourceUrl: 'https://www.youtube.com/watch?v=multi-download'
      }
    }, 'user');

    expect(first.job.stages).toHaveLength(1);
    expect(first.job.stages[0]?.progress).toMatchObject({
      optionId: 'video-1080-1',
      mediaType: 'video',
      sourceUrl: 'https://www.youtube.com/watch?v=multi-download',
      probeArtifactId: 'creator_artifact_1'
    });
    expect(second.job.stages).toHaveLength(2);
    expect(second.job.stages.map(stage => stage.progress.optionId)).toEqual([
      'video-1080-1',
      'video-720-2'
    ]);
    expect(() => dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: second.job.revision,
      idempotencyKey: 'download-1080-duplicate',
      input: {
        stageId: 'download',
        optionId: 'video-1080-1',
        mediaType: 'video',
        sourceUrl: 'https://www.youtube.com/watch?v=multi-download'
      }
    }, 'user')).toThrowError(expect.objectContaining({
      code: 'creator_action_invalid',
      message: 'This download option is already queued or running'
    }));
    expect(fixture.service.getJob(fixture.jobId)?.revision).toBe(3);
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

function setupDownload() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-command-download-'));
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  let artifactSequence = 0;
  const repository = createCreatorRepository(db, {
    idFactory(prefix) {
      if (prefix === 'creator_artifact') {
        artifactSequence += 1;
        return `creator_artifact_${artifactSequence}`;
      }
      return `${prefix}_${Math.random().toString(36).slice(2)}`;
    }
  });
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const sourceUrl = 'https://www.youtube.com/watch?v=multi-download';
  const job = service.createJob({
    projectId: 'project-1',
    templateId: 'video-download',
    state: { sourceUrl }
  });
  repository.insertArtifact({
    jobId: job.id,
    kind: 'download_probe',
    status: 'completed',
    path: join(tempDir, 'probe.json'),
    sourceArtifactIds: [],
    metadata: {
      id: 'multi-download',
      title: 'Multi Download',
      requestedUrl: sourceUrl,
      url: sourceUrl,
      platform: 'youtube',
      formats: [],
      options: [{
        id: 'video-1080-1',
        mediaType: 'video',
        container: 'mp4'
      }, {
        id: 'video-720-2',
        mediaType: 'video',
        container: 'mp4'
      }]
    }
  });
  return {
    db,
    repository,
    service,
    receipts: createCreatorAgentRepository(db),
    jobId: job.id
  };
}
