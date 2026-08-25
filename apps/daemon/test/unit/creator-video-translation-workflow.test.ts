import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createVideoTranslationWorkflow } from '../../src/creator/templates/video-translation-actions.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('video translation workflow', () => {
  it('queues the selected stages in order through the command dispatcher', () => {
    const fixture = setup({ dubbing: true, composeVideo: true, videoFormat: 'all' });
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn() as never }
    });
    const first = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'start-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    succeedAndContinue(fixture, workflow, first);
    const tts = latestStage(fixture);
    expect(tts).toMatchObject({
      stageId: 'tts',
      progress: { workflow: true, workflowParentStageRunId: first }
    });

    succeedAndContinue(fixture, workflow, tts.id);
    const horizontal = latestStage(fixture);
    expect(horizontal.stageId).toBe('render-horizontal');

    succeedAndContinue(fixture, workflow, horizontal.id);
    const vertical = latestStage(fixture);
    expect(vertical.stageId).toBe('render-vertical');

    succeedAndContinue(fixture, workflow, vertical.id);
    workflow.handleStageChanged(fixture.repository.getStageRun(horizontal.id)!);
    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
      'subtitle',
      'tts',
      'render-horizontal',
      'render-vertical'
    ]);
    expect(fixture.service.getJob(fixture.jobId)?.activities.map(activity => activity.actor)).toEqual([
      'user',
      'user',
      'system',
      'system',
      'system'
    ]);
    fixture.db.close();
  });

  it('recovers a committed stage that crashed before its next stage was queued', () => {
    const fixture = setup({ dubbing: false, composeVideo: true, videoFormat: 'horizontal' });
    const first = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'start-recoverable-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;
    fixture.repository.updateStageRun({ id: first, status: 'succeeded' });
    const recovered = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn() as never }
    });

    recovered.recover();
    recovered.recover();

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
      'subtitle',
      'render-horizontal'
    ]);
    fixture.db.close();
  });

  it('preserves workflow progress while the executor reports progress and queues the next stage', async () => {
    const fixture = setup({ dubbing: false, composeVideo: true, videoFormat: 'horizontal' });
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn() as never }
    });
    const runner = createCreatorStageRunner({
      repository: fixture.repository,
      templates: fixture.service.templates,
      executors: [{
        id: 'krillinai',
        async run(stage) {
          stage.reportProgress({ executorStep: 'working' });
          return {
            outputs: [
              { kind: 'source_video', status: 'completed' as const, path: null },
              { kind: 'source_subtitle', status: 'completed' as const, path: null },
              { kind: 'target_subtitle', status: 'completed' as const, path: null },
              { kind: 'bilingual_subtitle', status: 'completed' as const, path: null }
            ],
            progress: { executorStep: 'done' }
          };
        }
      }],
      workRoot: join(tempDir, 'work'),
      onStageSucceeded(stage) {
        workflow.handleStageChanged(stage);
      }
    });
    const first = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'start-real-runner-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    const completed = await runner.runStageRun(first);

    expect(completed.progress).toMatchObject({ workflow: true, executorStep: 'done' });
    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
      'subtitle',
      'render-horizontal'
    ]);
    await runner.close();
    fixture.db.close();
  });
});

function setup(state: Record<string, unknown>) {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-video-translation-workflow-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const job = service.createJob({
    projectId: 'project-workflow',
    templateId: 'video-translation',
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=workflow',
      ...state
    }
  });
  const dispatcher = createCreatorCommandDispatcher({
    service,
    repository,
    receipts: createCreatorAgentRepository(db)
  });
  return { db, repository, service, dispatcher, jobId: job.id };
}

function succeedAndContinue(
  fixture: ReturnType<typeof setup>,
  workflow: ReturnType<typeof createVideoTranslationWorkflow>,
  stageRunId: string
): void {
  fixture.repository.updateStageRun({ id: stageRunId, status: 'succeeded' });
  workflow.handleStageChanged(fixture.repository.getStageRun(stageRunId)!);
}

function latestStage(fixture: ReturnType<typeof setup>) {
  return fixture.service.getJob(fixture.jobId)!.stages.at(-1)!;
}
