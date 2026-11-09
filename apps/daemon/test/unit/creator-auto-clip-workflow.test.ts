import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createAutoClipWorkflow } from '../../src/creator/templates/auto-clip-actions.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('auto clip workflow', () => {
  it('queues one KrillinAI clip stage for the latest template', () => {
    const fixture = setup('url', 3);
    const stageId = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage', expectedRevision: 0, idempotencyKey: 'auto-clip-v3',
      input: { stageId: 'clip' }
    }, 'user').commandReceipt.stageRunId!;
    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual(['clip']);
    fixture.repository.updateStageRun({ id: stageId, status: 'succeeded' });
    fixture.db.close();
  });
  it('queues URL preparation, transcription, analysis, and rendering in order', async () => {
    const fixture = setup('url');
    const probe = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'auto-clip-url',
      input: { stageId: 'probe', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    const download = await succeedAndContinue(fixture, probe);
    expect(download).toMatchObject({
      stageId: 'download',
      progress: { workflow: true, workflowParentStageRunId: probe }
    });
    const subtitle = await succeedAndContinue(fixture, download.id);
    expect(subtitle.stageId).toBe('subtitle');
    const analyze = await succeedAndContinue(fixture, subtitle.id);
    expect(analyze.stageId).toBe('analyze');
    const render = await succeedAndContinue(fixture, analyze.id);
    expect(render).toMatchObject({
      stageId: 'render',
      progress: { workflow: true, workflowParentStageRunId: analyze.id }
    });
    await succeedAndContinue(fixture, render.id);

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId))
      .toEqual(['probe', 'download', 'subtitle', 'analyze', 'render']);
    fixture.db.close();
  });

  it('starts imported and uploaded videos at transcription', async () => {
    const fixture = setup('file');
    const subtitle = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'auto-clip-file',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    const analyze = await succeedAndContinue(fixture, subtitle);

    expect(analyze).toMatchObject({
      stageId: 'analyze',
      progress: { workflow: true, workflowParentStageRunId: subtitle }
    });
    const render = await succeedAndContinue(fixture, analyze.id);
    expect(render).toMatchObject({
      stageId: 'render',
      progress: { workflow: true, workflowParentStageRunId: analyze.id }
    });
    fixture.db.close();
  });

  it('renders after a directly requested analysis without requiring a selection', async () => {
    const fixture = setup('file');
    const analyze = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'auto-clip-direct-analysis',
      input: { stageId: 'analyze' }
    }, 'user').commandReceipt.stageRunId!;

    const render = await succeedAndContinue(fixture, analyze);

    expect(render).toMatchObject({
      stageId: 'render',
      progress: { workflow: true, workflowParentStageRunId: analyze }
    });
    fixture.db.close();
  });

  it('recovers a completed workflow stage without queuing duplicates', async () => {
    const fixture = setup('url');
    const probe = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'auto-clip-recover',
      input: { stageId: 'probe', workflow: true }
    }, 'user').commandReceipt.stageRunId!;
    fixture.repository.updateStageRun({ id: probe, status: 'succeeded' });

    await fixture.workflow.recover();
    await fixture.workflow.recover();

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId))
      .toEqual(['probe', 'download']);
    fixture.db.close();
  });
});

function setup(sourceType: 'url' | 'file', templateVersion = 2) {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-auto-clip-workflow-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const job = service.createJob({
    projectId: 'project-auto-clip',
    templateId: 'auto-clip',
    templateVersion,
    state: {
      sourceType,
      sourceUrl: sourceType === 'url' ? 'https://www.youtube.com/watch?v=auto-clip' : ''
    }
  });
  const dispatcher = createCreatorCommandDispatcher({
    service,
    repository,
    receipts: createCreatorAgentRepository(db)
  });
  const workflow = createAutoClipWorkflow({ creator: service, dispatcher });
  return { db, repository, service, dispatcher, workflow, jobId: job.id };
}

async function succeedAndContinue(
  fixture: ReturnType<typeof setup>,
  stageRunId: string
) {
  fixture.repository.updateStageRun({ id: stageRunId, status: 'succeeded' });
  await fixture.workflow.handleStageChanged(fixture.repository.getStageRun(stageRunId)!);
  return fixture.service.getJob(fixture.jobId)!.stages.at(-1)!;
}
