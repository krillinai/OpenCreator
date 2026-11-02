import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCreatorResultSnapshots } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { CreatorExecutorError, type CreatorExecutor } from '../../src/creator/executor.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

function setup(executor: CreatorExecutor, templateVersion = 2) {
  const directory = mkdtempSync(join(tmpdir(), 'creator-video-preview-'));
  const db = openRuntimeDatabase(join(directory, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const dispatcher = createCreatorCommandDispatcher({ service, repository, receipts: createCreatorAgentRepository(db) });
  const runner = createCreatorStageRunner({ repository, templates, executors: [executor], workRoot: join(directory, 'jobs') });
  const initial = service.createJob({ projectId: 'preview-project', templateId: 'video-translation', templateVersion });
  const subtitles = [1, 2].map(version => {
    const path = join(directory, `subtitle-${version}.srt`);
    writeFileSync(path, `1\n00:00:00,000 --> 00:00:01,000\n字幕 ${version}\n`);
    return repository.insertArtifact({ jobId: initial.id, kind: 'target_subtitle', path, status: 'completed', sourceArtifactIds: [], metadata: { resultVersion: version } });
  });
  repository.updateJob({ id: initial.id, status: 'completed', revision: 2, state: {
    ...initial.state, sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf?p=2',
    resultVersion: 2, latestResultVersion: 2,
    resultSnapshots: subtitles.map((artifact, index) => ({
      version: index + 1, createdAt: initial.createdAt, action: 'stage-succeeded', stageId: 'subtitle',
      description: `Subtitles ${index + 1}`, artifactRefs: { target_subtitle: [artifact.id] },
      changedArtifactIds: [artifact.id], staleArtifactIds: [],
      state: { ...initial.state, sourceUrl: `https://www.bilibili.com/video/BV18E421w7bf?p=${index === 0 ? 3 : 2}` }
    }))
  } });
  let requestSequence = 0;
  function start() {
    const job = service.getJob(initial.id)!;
    return dispatcher.dispatch(job.id, { action: 'run-stage', expectedRevision: job.revision, idempotencyKey: `preview-${++requestSequence}`,
      input: { stageId: 'prepare-source-video', inputResultVersion: 1 }
    }, 'user').commandReceipt.stageRunId!;
  }
  return { repository, service, runner, dispatcher, start, jobId: initial.id,
    recoverRepository() { return createCreatorRepository(db); },
    async close() { await runner.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  };
}

describe('video translation preview preparation', () => {
  it.each([1, 2])('previews a draft URL without creating a result or changing job status (template v%s)', async templateVersion => {
    const url = 'https://www.douyin.com/video/7490000000000000001';
    const context = setup({ id: 'download', async run(stage) {
      expect(stage.stageRun.progress.previewSourceUrl).toBe(url);
      const path = join(stage.workdir, 'preview.mp4');
      writeFileSync(path, 'preview');
      return { outputs: [{ kind: 'source_video', path, status: 'completed', sourceArtifactIds: [], metadata: { sourceUrl: url, previewOnly: true } }] };
    } }, templateVersion);
    try {
      const draft = context.service.createJob({ projectId: 'preview-project', templateId: 'video-translation', templateVersion,
        state: { sourceType: 'url', sourceUrl: url } });
      const started = context.dispatcher.dispatch(draft.id, { action: 'run-stage', expectedRevision: draft.revision, idempotencyKey: 'draft-preview',
        input: { stageId: 'preview-source-video' } }, 'user');
      expect(() => context.dispatcher.dispatch(draft.id, { action: 'run-stage', expectedRevision: started.job.revision, idempotencyKey: 'duplicate-preview',
        input: { stageId: 'preview-source-video' } }, 'user')).toThrow();
      expect(() => context.dispatcher.dispatch(draft.id, { action: 'run-stage', expectedRevision: started.job.revision, idempotencyKey: 'translation-during-preview',
        input: { stageId: 'subtitle' } }, 'user')).toThrow();
      expect((await context.runner.runStageRun(started.commandReceipt.stageRunId!)).status).toBe('succeeded');
      const after = context.service.getJob(draft.id)!;
      expect(after.status).toBe('draft');
      expect(after.state.resultVersion).toBeUndefined();
      expect(readCreatorResultSnapshots(after.state.resultSnapshots)).toEqual([]);
      expect(after.artifacts).toHaveLength(1);
      expect(after.artifacts[0]!.metadata.resultVersion).toBeUndefined();
    } finally { await context.close(); }
  });

  it('keeps stage progress monotonic when the phase changes', async () => {
    const context = setup({ id: 'download', async run({ reportProgress, workdir }) {
      reportProgress({ phase: 'preparing_source', percent: 20, message: '正在准备视频来源' });
      reportProgress({ phase: 'reading_platform_captions', percent: 5, message: '正在获取平台字幕' });
      reportProgress({ phase: 'merging_media', percent: null, message: '正在合并视频和音频' });
      const path = join(workdir, 'preview.mp4');
      writeFileSync(path, 'preview');
      return { outputs: [{ kind: 'source_video', path, status: 'completed', sourceArtifactIds: [] }] };
    } });
    try {
      const result = await context.runner.runStageRun(context.start());
      expect(result.progress).toMatchObject({
        phase: 'merging_media',
        message: '正在合并视频和音频',
        percent: 20
      });
    } finally { await context.close(); }
  });

  it('preserves draft status on preview failure and rejects unsupported sources', async () => {
    const context = setup({ id: 'download', async run() { throw new CreatorExecutorError('network_unavailable', 'Preview download failed'); } });
    try {
      const draft = context.service.createJob({ projectId: 'preview-project', templateId: 'video-translation', templateVersion: 2,
        state: { sourceType: 'url', sourceUrl: 'https://v.douyin.com/example/' } });
      const started = context.dispatcher.dispatch(draft.id, { action: 'run-stage', expectedRevision: draft.revision, idempotencyKey: 'failure-preview',
        input: { stageId: 'preview-source-video' } }, 'user');
      expect((await context.runner.runStageRun(started.commandReceipt.stageRunId!)).status).toBe('failed');
      expect(context.service.getJob(draft.id)!.status).toBe('draft');
      const invalid = context.service.createJob({ projectId: 'preview-project', templateId: 'video-translation', templateVersion: 2,
        state: { sourceType: 'url', sourceUrl: 'https://example.com/video' } });
      expect(() => context.dispatcher.dispatch(invalid.id, { action: 'run-stage', expectedRevision: invalid.revision, idempotencyKey: 'invalid-preview',
        input: { stageId: 'preview-source-video' } }, 'user')).toThrow();
      expect(context.service.getJob(invalid.id)!.revision).toBe(invalid.revision);
    } finally { await context.close(); }
  });

  it.each([1, 2])('attaches video to the selected result without creating versions or changing subtitles (template v%s)', async templateVersion => {
    const context = setup({ id: 'download', async run(stage) {
      expect(stage.stageRun.progress.inputResultVersion).toBe(1);
      const path = join(stage.workdir, 'preview.mp4');
      writeFileSync(path, 'preview-video');
      return { outputs: [{ kind: 'source_video', path, status: 'completed', sourceArtifactIds: [] }] };
    } }, templateVersion);
    try {
      const before = context.service.getJob(context.jobId)!;
      const stageId = context.start();
      expect(context.service.getJob(context.jobId)!.status).toBe('completed');
      expect((await context.runner.runStageRun(stageId)).status).toBe('succeeded');
      const after = context.service.getJob(context.jobId)!;
      const snapshots = readCreatorResultSnapshots(after.state.resultSnapshots);
      const video = after.artifacts.find(artifact => artifact.kind === 'source_video')!;
      expect(after.status).toBe('completed');
      expect(after.state).toMatchObject({ resultVersion: 2, latestResultVersion: 2, sourceUrl: before.state.sourceUrl });
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]).toEqual({ ...readCreatorResultSnapshots(before.state.resultSnapshots)[0],
        artifactRefs: { target_subtitle: [before.artifacts[0]!.id], source_video: [video.id] }
      });
      expect(snapshots[1]).toEqual(readCreatorResultSnapshots(before.state.resultSnapshots)[1]);
      expect(after.artifacts.filter(artifact => artifact.kind === 'target_subtitle')).toEqual(before.artifacts);
      expect(video.metadata.resultVersion).toBe(1);
      expect(after.stages.at(-1)!.progress.resultVersion).toBe(1);
    } finally { await context.close(); }
  });

  it('keeps successful translation results intact when preview download fails and can retry', async () => {
    let attempts = 0;
    const context = setup({ id: 'download', async run({ workdir }) {
      if (++attempts === 1) throw new CreatorExecutorError('network_unavailable', 'Download failed');
      const path = join(workdir, 'preview.mp4');
      writeFileSync(path, 'preview');
      return { outputs: [{ kind: 'source_video', path, status: 'completed', sourceArtifactIds: [] }] };
    } });
    try {
      const before = context.service.getJob(context.jobId)!;
      expect((await context.runner.runStageRun(context.start())).status).toBe('failed');
      const failed = context.service.getJob(context.jobId)!;
      expect(failed.status).toBe('completed');
      expect(failed.state.resultSnapshots).toEqual(before.state.resultSnapshots);
      expect(failed.state.needsInput).toBeUndefined();
      expect(failed.artifacts).toEqual(before.artifacts);
      expect((await context.runner.runStageRun(context.start())).status).toBe('succeeded');
      expect(context.service.getJob(context.jobId)!.state.latestResultVersion).toBe(2);
    } finally { await context.close(); }
  });

  it.each(['queued', 'running'])('preserves translation on %s cancellation', async status => {
    const context = setup({ id: 'download', async run({ signal }) {
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      return { outputs: [] };
    } });
    try {
      const before = context.service.getJob(context.jobId)!;
      const stageId = context.start();
      let execution: ReturnType<typeof context.runner.runStageRun> | undefined;
      if (status === 'running') {
        execution = context.runner.runStageRun(stageId);
        await expect.poll(() => context.repository.getStageRun(stageId)!.status).toBe('running');
      }
      context.runner.cancelJob(context.jobId);
      if (execution) await execution;
      const after = context.service.getJob(context.jobId)!;
      expect(after.stages.at(-1)!.status).toBe('canceled');
      expect(after.status).toBe('completed');
      expect(after.state.resultSnapshots).toEqual(before.state.resultSnapshots);
      expect(after.artifacts).toEqual(before.artifacts);
    } finally { await context.close(); }
  });

  it('requires a real input version and rejects concurrent preparations', async () => {
    const context = setup({ id: 'download', async run() { return { outputs: [] }; } });
    try {
      for (const inputResultVersion of [undefined, 99]) {
        const job = context.service.getJob(context.jobId)!;
        expect(() => context.dispatcher.dispatch(job.id, { action: 'run-stage', expectedRevision: job.revision, idempotencyKey: `invalid-${inputResultVersion}`,
          input: { stageId: 'prepare-source-video', ...(inputResultVersion === undefined ? {} : { inputResultVersion }) }
        }, 'user')).toThrow();
      }
      context.start();
      expect(() => context.start()).toThrow();
    } finally { await context.close(); }
  });

  it('keeps completed results after interrupted preparation and retains the input version for resume', async () => {
    const context = setup({ id: 'download', async run() { return { outputs: [] }; } });
    try {
      const before = context.service.getJob(context.jobId)!;
      context.start();
      const recovered = context.recoverRepository().getJob(context.jobId)!;
      expect(recovered.status).toBe('completed');
      expect(recovered.stages.at(-1)).toMatchObject({ status: 'interrupted', progress: { inputResultVersion: 1 } });
      expect(recovered.state.resultSnapshots).toEqual(before.state.resultSnapshots);
      expect(recovered.artifacts).toEqual(before.artifacts);
      expect(context.start()).toBeTypeOf('string');
    } finally { await context.close(); }
  });
});
