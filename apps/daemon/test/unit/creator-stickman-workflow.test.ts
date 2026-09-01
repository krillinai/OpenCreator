import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import type { CreatorExecutor } from '../../src/creator/executor.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { CreatorServiceError, createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanContentExecutor } from '../../src/creator/stickman/content-executor.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createStickmanVideoWorkflow } from '../../src/creator/templates/stickman-video-actions.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-workflow-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const receipts = createCreatorAgentRepository(db);
  const dispatcher = createCreatorCommandDispatcher({ service, repository, receipts });
  const download: CreatorExecutor = {
    id: 'download',
    async run({ workdir }) {
      const path = join(workdir, 'source.mp4');
      writeFileSync(path, 'video');
      return { outputs: [{ kind: 'source_video', status: 'completed', path }] };
    }
  };
  const krillin: CreatorExecutor = {
    id: 'krillinai',
    async run({ stageRun, workdir }) {
      if (stageRun.stageId !== 'source-transcript') return { outputs: [] };
      const path = join(workdir, 'source.srt');
      writeFileSync(path, '1\n00:00:00,000 --> 00:00:01,000\n测试来源\n');
      return { outputs: [{ kind: 'source_subtitle', status: 'completed', path }] };
    }
  };
  const content = createStickmanContentExecutor({
    configStore: { read: async () => createDefaultCreatorServicesConfig() },
    async completeJson({ stageId }) {
      if (stageId === 'source-brief') return { title: '测试', summary: '来源摘要', keyPoints: ['要点一'] };
      if (stageId === 'content-plan') return { title: '测试', audience: '开发者', objective: '解释问题', outline: ['开场', '结论'] };
      if (stageId === 'script') return {
        title: '测试脚本',
        language: 'zh-CN',
        segments: [{
          id: 'segment-01',
          narration: '第一段旁白',
          durationSeconds: 5,
          sourceKeyPoint: '要点一'
        }]
      };
      if (stageId === 'storyboard') return {
        shots: [{
          id: 'shot-01',
          sourceSegmentId: 'segment-01',
          narration: '第一段旁白',
          imagePrompt: '白底黑线火柴人讲解',
          motion: 'push-in',
          durationSeconds: 5
        }]
      };
      return { title: '标题', description: '简介', tags: ['火柴人'] };
    }
  });
  const runner = createCreatorStageRunner({
    repository,
    templates,
    executors: [download, krillin, content],
    workRoot: join(tempDir, 'jobs')
  });
  const workflow = createStickmanVideoWorkflow({ creator: service, dispatcher });
  return { db, repository, service, dispatcher, runner, workflow };
}

describe('stickman video workflow', () => {
  it('stops at script and storyboard review gates and rejects stale approvals', async () => {
    const { db, service, dispatcher, runner, workflow } = setup();
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'stickman-video',
      state: { sourceType: 'url', sourceUrl: 'https://youtu.be/test' }
    });
    let queued = dispatcher.dispatch(job.id, {
      action: 'run-stage',
      expectedRevision: job.revision,
      idempotencyKey: 'stickman-start',
      input: { stageId: 'acquire-source' }
    }, 'user').commandReceipt.stageRunId!;

    for (const expectedStage of ['acquire-source', 'source-transcript', 'source-brief', 'content-plan', 'script']) {
      const completed = await runner.runStageRun(queued);
      expect(completed.stageId).toBe(expectedStage);
      await workflow.handleStageChanged(completed);
      if (expectedStage !== 'script') {
        queued = service.getJob(job.id)!.stages.find(stage => stage.status === 'queued')!.id;
      }
    }

    const scriptGate = service.getJob(job.id)!;
    const script = scriptGate.artifacts.find(artifact => artifact.kind === 'script_manifest')!;
    expect(scriptGate).toMatchObject({
      status: 'needs_input',
      state: { needsInput: { kind: 'approve-script', artifactId: script.id } }
    });
    expect(scriptGate.state).not.toHaveProperty('segments');
    expect(() => service.applyAction(job.id, {
      actor: 'user',
      action: 'approve-script',
      expectedRevision: scriptGate.revision - 1,
      input: { artifactId: script.id, revision: scriptGate.revision - 1 }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_revision_conflict'
    }));
    expect(() => service.applyAction(job.id, {
      actor: 'user',
      action: 'approve-script',
      expectedRevision: scriptGate.revision,
      input: { artifactId: 'old-script', revision: scriptGate.revision }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_stale_approval'
    }));

    const approvedScript = dispatcher.dispatch(job.id, {
      action: 'approve-script',
      expectedRevision: scriptGate.revision,
      idempotencyKey: 'approve-script',
      input: { artifactId: script.id, revision: scriptGate.revision }
    }, 'user');
    await workflow.handleAction(approvedScript.job, 'approve-script');
    queued = service.getJob(job.id)!.stages.find(stage => stage.status === 'queued')!.id;
    const storyboardStage = await runner.runStageRun(queued);
    await workflow.handleStageChanged(storyboardStage);

    const storyboardGate = service.getJob(job.id)!;
    const shotSpec = storyboardGate.artifacts.find(artifact => artifact.kind === 'shot_spec')!;
    expect(storyboardGate).toMatchObject({
      status: 'needs_input',
      state: { needsInput: { kind: 'approve-storyboard', artifactId: shotSpec.id } }
    });
    expect(storyboardGate.state).not.toHaveProperty('shots');
    expect(JSON.parse(readFileSync(shotSpec.path!, 'utf8'))).toMatchObject({
      shots: [{ id: 'shot-01', sourceSegmentId: 'segment-01' }]
    });
    await runner.close();
    db.close();
  });

  it('reconciles the next content stage exactly once', async () => {
    const { db, repository, service, workflow, runner } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const source = repository.insertArtifact({
      jobId: job.id,
      kind: 'source_video',
      status: 'completed',
      path: null,
      sourceArtifactIds: [],
      metadata: {}
    });
    repository.updateJob({
      id: job.id,
      status: 'running',
      revision: job.revision,
      state: { ...job.state, sourceArtifactId: source.id }
    });

    await workflow.reconcile(service.getJob(job.id)!);
    await workflow.reconcile(service.getJob(job.id)!);

    expect(service.getJob(job.id)!.stages.filter(stage => stage.stageId === 'source-transcript'))
      .toHaveLength(1);
    await runner.close();
    db.close();
  });

  it('persists edited script and shot specs without copying bodies into job state', async () => {
    const { db, repository, service, runner } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const scriptPath = join(tempDir, 'script.json');
    writeFileSync(scriptPath, JSON.stringify({
      title: '旧脚本',
      language: 'zh-CN',
      segments: [{
        id: 'segment-01',
        narration: '旧旁白',
        durationSeconds: 5,
        sourceKeyPoint: '旧要点'
      }]
    }));
    const script = repository.insertArtifact({
      jobId: job.id,
      kind: 'script_manifest',
      status: 'completed',
      path: scriptPath,
      sourceArtifactIds: [],
      metadata: {}
    });
    const editedScriptValue = {
      title: '新脚本',
      language: 'zh-CN',
      segments: [{
        id: 'segment-01',
        narration: '新旁白',
        durationSeconds: 6,
        sourceKeyPoint: '新要点'
      }]
    };
    const edited = service.applyAction(job.id, {
      actor: 'user',
      action: 'edit-script',
      expectedRevision: 0,
      input: { artifactId: script.id, content: JSON.stringify(editedScriptValue) }
    });
    const editedScript = edited.job.artifacts.filter(item => item.kind === 'script_manifest').at(-1)!;
    expect(edited.job.state).not.toHaveProperty('segments');
    expect(JSON.parse(readFileSync(editedScript.path!, 'utf8'))).toEqual(editedScriptValue);
    expect(edited.job.artifacts.find(item => item.id === script.id)?.status).toBe('stale');

    const shotPath = join(tempDir, 'shots.json');
    writeFileSync(shotPath, JSON.stringify({
      scriptArtifactId: editedScript.id,
      shots: [{
        id: 'shot-01',
        sourceSegmentId: 'segment-01',
        narration: '新旁白',
        imagePrompt: '旧提示词',
        motion: 'static',
        durationSeconds: 6
      }]
    }));
    const shotSpec = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotPath,
      sourceArtifactIds: [editedScript.id],
      metadata: {}
    });
    const editedShot = service.applyAction(job.id, {
      actor: 'user',
      action: 'edit-shot',
      expectedRevision: edited.job.revision,
      input: {
        artifactId: shotSpec.id,
        scopeKey: 'shot-01',
        patch: { imagePrompt: '新提示词', motion: 'push-in' },
        revision: edited.job.revision
      }
    });
    const latestShot = editedShot.job.artifacts.filter(item => item.kind === 'shot_spec').at(-1)!;
    expect(JSON.parse(readFileSync(latestShot.path!, 'utf8'))).toMatchObject({
      shots: [{ id: 'shot-01', imagePrompt: '新提示词', motion: 'push-in' }]
    });
    expect(editedShot.job.state).not.toHaveProperty('shots');
    await runner.close();
    db.close();
  });
});
