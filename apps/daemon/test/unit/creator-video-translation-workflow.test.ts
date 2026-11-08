import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
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
  it.each(['horizontal', 'vertical'])('passes original subtitles from the saved result into %s composition', async videoFormat => {
    const fixture = setup({ bilingual: true, composeVideo: true, videoFormat });
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service, dispatcher: fixture.dispatcher,
      configStore: { read: async () => createDefaultCreatorServicesConfig() }
    });
    const run = vi.fn(async (stage: { stageRun: { stageId: string } }) => ({
      outputs: stage.stageRun.stageId === 'subtitle'
        ? ['source_subtitle', 'target_subtitle', 'bilingual_subtitle'].map(kind => ({ kind, status: 'completed' as const, path: null }))
        : [{ kind: `${videoFormat}_video`, status: 'completed' as const, path: null }]
    }));
    const runner = createCreatorStageRunner({
      repository: fixture.repository, templates: fixture.service.templates,
      executors: [{ id: 'krillinai', run }], workRoot: join(tempDir, 'work'),
      onStageSucceeded(stage) { void workflow.handleStageChanged(stage); }
    });
    try {
      const first = fixture.dispatcher.dispatch(fixture.jobId, {
        action: 'run-stage', expectedRevision: 0, idempotencyKey: 'bilingual-composition-inputs',
        input: { stageId: 'subtitle', workflow: true }
      }, 'user').commandReceipt.stageRunId!;
      await runner.runStageRun(first);
      await vi.waitFor(() => expect(latestStage(fixture).stageId).toBe(`render-${videoFormat}`));
      const rendered = await runner.runStageRun(latestStage(fixture).id);
      expect(rendered.status).toBe('succeeded');
      expect(run).toHaveBeenLastCalledWith(expect.objectContaining({
        inputArtifacts: expect.arrayContaining([
          expect.objectContaining({ kind: 'source_subtitle' }),
          expect.objectContaining({ kind: 'target_subtitle' }),
          expect.objectContaining({ kind: 'bilingual_subtitle' })
        ])
      }));
    } finally {
      await runner.close();
      fixture.db.close();
    }
  });

  it.each([
    { suffix: '', error: 'creator_source_part_required' },
    { suffix: '?p=0', error: 'creator_source_invalid_part' },
    { suffix: '?p=4', error: 'creator_source_invalid_part' },
    { suffix: '?p=3', error: undefined }
  ])('validates Bilibili selection before starting: $suffix', async ({ suffix, error }) => {
    const fixture = setup({ sourceUrl: `https://www.bilibili.com/video/BV18E421w7bf${suffix}` });
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'codex';
    const get = vi.fn(async () => ({ platform: 'bilibili' as const, title: 'Course',
      parts: [1, 2, 3].map(index => ({ index, title: `Lesson ${index}` })) }));
    const workflow = createVideoTranslationWorkflow({ creator: fixture.service, dispatcher: fixture.dispatcher,
      configStore: { read: async () => config }, videoMetadataService: { get } });
    try {
      const validated = workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle');
      if (error) await expect(validated).rejects.toMatchObject({ code: error });
      else {
        await expect(validated).resolves.toBeUndefined();
        expect(get).toHaveBeenCalledWith('https://www.bilibili.com/video/BV18E421w7bf?p=3');
      }
      expect(fixture.service.getJob(fixture.jobId)!.stages).toHaveLength(0);
    } finally { fixture.db.close(); }
  });

  it('does not download a Bilibili collection when part lookup fails', async () => {
    const fixture = setup({ sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf' });
    const workflow = createVideoTranslationWorkflow({ creator: fixture.service, dispatcher: fixture.dispatcher,
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      videoMetadataService: { get: async () => { throw new Error('network unavailable'); } } });
    try {
      await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
        .rejects.toMatchObject({ code: 'creator_source_metadata_unavailable', message: expect.stringContaining('Download and translation have not started') });
      expect(fixture.service.getJob(fixture.jobId)!.stages).toHaveLength(0);
    } finally { fixture.db.close(); }
  });

  it('accepts Codex runtime translation without a creator API key', async () => {
    const fixture = setup({});
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'codex';
    config.llm.apiKey = '';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });

    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
      .resolves.toBeUndefined();
    fixture.db.close();
  });

  it('still requires complete credentials for a custom translation model', async () => {
    const fixture = setup({});
    const config = createDefaultCreatorServicesConfig();
    config.llm.source = 'custom';
    config.llm.apiKey = '';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });

    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
      .rejects.toMatchObject({ code: 'creator_llm_config_missing' });
    fixture.db.close();
  });

  it.each(['subtitle', 'tts'])('uses task configuration instead of incomplete global defaults for %s', async stageId => {
    const fixture = setup({ dubbing: true });
    const global = createDefaultCreatorServicesConfig();
    global.llm.source = 'custom';
    global.llm.model = '';
    const selected = structuredClone(global);
    selected.llm = { ...selected.llm, baseUrl: 'http://127.0.0.1/v1', model: 'deepseek-v4-pro', apiKey: 'local-token' };
    selected.tts.openai.apiKey = 'local-token';
    const read = vi.fn(async () => global);
    const readConfigForJob = vi.fn(async () => selected);
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service, dispatcher: fixture.dispatcher,
      configStore: { read }, readConfigForJob
    });
    try {
      await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, stageId)).resolves.toBeUndefined();
      expect(readConfigForJob).toHaveBeenCalledWith(fixture.jobId);
      expect(read).not.toHaveBeenCalled();
      expect(fixture.service.getJob(fixture.jobId)!.stages).toHaveLength(0);
    } finally { fixture.db.close(); }
  });

  it.each([
    'https://www.youtube.com/watch?v=xVWS7yHdzCU',
    'https://youtu.be/tAkC-ZdaqWs?si=6LcL-jgzdBaZ1IFD',
    'https://x.com/creator/status/123',
    'https://www.tiktok.com/@creator/video/123',
    'https://www.instagram.com/reel/abc123/',
    '分享视频 https://v.douyin.com/abc123/ 复制打开抖音',
    'https://www.douyin.com/jingxuan?modal_id=123',
    'https://www.douyin.com/jingxuan/search/qianjidong?aid=2052a92f-0793-47c1-b739-c0af829b6103&modal_id=7693859410975690010&type=general',
    'https://www.facebook.com/watch/?v=123',
    'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D',
    'https://www.pinterest.com/pin/123/'
  ])('accepts the supported public video URL form: %s', async sourceUrl => {
    const fixture = setup({ sourceUrl });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });

    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
      .resolves.toBeUndefined();
    fixture.db.close();
  });

  it.each(['https://www.instagram.com/creator/', 'https://www.pinterest.com/creator/',
    'https://notxiaohongshu.com/explore/6a9149f3000000001f01d20a'])('rejects unsupported translation sources: %s', async sourceUrl => {
    const fixture = setup({ sourceUrl });
    const workflow = createVideoTranslationWorkflow({ creator: fixture.service, dispatcher: fixture.dispatcher,
      configStore: { read: async () => createDefaultCreatorServicesConfig() } });
    try {
      await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
        .rejects.toMatchObject({ code: 'unsupported_source' });
    } finally { fixture.db.close(); }
  });

  it('queues the selected stages in order through the command dispatcher', async () => {
    const fixture = setup({ dubbing: true, composeVideo: true, videoFormat: 'all' });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    config.tts.openai.apiKey = 'tts-key';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });
    const first = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'start-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    await succeedAndContinue(fixture, workflow, first);
    const tts = latestStage(fixture);
    expect(tts).toMatchObject({
      stageId: 'tts',
      progress: { workflow: true, workflowParentStageRunId: first }
    });

    await succeedAndContinue(fixture, workflow, tts.id);
    const horizontal = latestStage(fixture);
    expect(horizontal.stageId).toBe('render-horizontal');

    await succeedAndContinue(fixture, workflow, horizontal.id);
    const vertical = latestStage(fixture);
    expect(vertical.stageId).toBe('render-vertical');

    await succeedAndContinue(fixture, workflow, vertical.id);
    await workflow.handleStageChanged(fixture.repository.getStageRun(horizontal.id)!);
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

  it('stops after dubbing when subtitle burning is disabled', async () => {
    const fixture = setup({ dubbing: true, composeVideo: false });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    config.tts.openai.apiKey = 'tts-key';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service, dispatcher: fixture.dispatcher,
      configStore: { read: async () => config }
    });
    try {
      const first = fixture.dispatcher.dispatch(fixture.jobId, {
        action: 'run-stage', expectedRevision: 0, idempotencyKey: 'dub-without-burn',
        input: { stageId: 'subtitle', workflow: true }
      }, 'user').commandReceipt.stageRunId!;
      await succeedAndContinue(fixture, workflow, first);
      const tts = latestStage(fixture);
      expect(tts.stageId).toBe('tts');
      await succeedAndContinue(fixture, workflow, tts.id);
      expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual(['subtitle', 'tts']);
    } finally { fixture.db.close(); }
  });

  it('recovers a committed stage that crashed before its next stage was queued', async () => {
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

    await recovered.recover();
    await recovered.recover();

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
      'subtitle',
      'render-horizontal'
    ]);
    fixture.db.close();
  });

  it('does not replay older workflow stages after a later workflow has completed', async () => {
    const fixture = setup({ dubbing: false, composeVideo: true, videoFormat: 'vertical' });
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn() as never }
    });
    const oldSubtitle = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'historical-subtitle-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;
    fixture.repository.updateStageRun({ id: oldSubtitle, status: 'succeeded' });
    await new Promise(resolve => setTimeout(resolve, 2));
    const current = fixture.service.getJob(fixture.jobId)!;
    const latestVertical = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: current.revision,
      idempotencyKey: 'completed-vertical-workflow',
      input: { stageId: 'render-vertical', workflow: true }
    }, 'user').commandReceipt.stageRunId!;
    fixture.repository.updateStageRun({ id: latestVertical, status: 'succeeded' });

    await workflow.recover();

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
      'subtitle',
      'render-vertical'
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
        void workflow.handleStageChanged(stage);
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
    await vi.waitFor(() => {
      expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
        'subtitle',
        'render-horizontal'
      ]);
    });
    await runner.close();
    fixture.db.close();
  });

  it('keeps all stages from one workflow in the same project version', async () => {
    const fixture = setup({
      dubbing: true,
      composeVideo: true,
      videoFormat: 'all'
    });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    config.tts.openai.apiKey = 'tts-key';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });
    const runner = createCreatorStageRunner({
      repository: fixture.repository,
      templates: fixture.service.templates,
      executors: [{
        id: 'krillinai',
        async run({ stageRun }) {
          if (stageRun.stageId === 'subtitle') {
            writeFileSync(join(tempDir, 'source.mp4'), 'fixture-video');
            writeFileSync(join(tempDir, 'target.srt'), 'fixture-target-subtitle');
            writeFileSync(join(tempDir, 'vertical.srt'), 'fixture-vertical-subtitle');
            return {
              outputs: [
                { kind: 'source_video', status: 'completed' as const, path: join(tempDir, 'source.mp4') },
                { kind: 'target_subtitle', status: 'completed' as const, path: join(tempDir, 'target.srt') },
                { kind: 'vertical_subtitle', status: 'completed' as const, path: join(tempDir, 'vertical.srt') }
              ]
            };
          }
          if (stageRun.stageId === 'tts') {
            writeFileSync(join(tempDir, 'voice.wav'), 'fixture-audio');
            return {
              outputs: [{
                kind: 'dubbed_audio',
                status: 'completed' as const,
                path: join(tempDir, 'voice.wav')
              }]
            };
          }
          writeFileSync(join(tempDir, `${stageRun.stageId}.mp4`), 'fixture-video');
          return {
            outputs: [{
              kind: stageRun.stageId === 'render-horizontal'
                ? 'horizontal_video'
                : 'vertical_video',
              status: 'completed' as const,
              path: join(tempDir, `${stageRun.stageId}.mp4`)
            }]
          };
        }
      }],
      workRoot: join(tempDir, 'work'),
      onStageSucceeded(stage) {
        void workflow.handleStageChanged(stage);
      }
    });
    const first = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'single-project-version-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    await runner.runStageRun(first);
    await vi.waitFor(() => expect(latestStage(fixture).stageId).toBe('tts'));
    await runner.runStageRun(latestStage(fixture).id);
    await vi.waitFor(() => expect(latestStage(fixture).stageId).toBe('render-horizontal'));
    await runner.runStageRun(latestStage(fixture).id);
    await vi.waitFor(() => expect(latestStage(fixture).stageId).toBe('render-vertical'));
    await runner.runStageRun(latestStage(fixture).id);

    const completed = fixture.service.getJob(fixture.jobId)!;
    expect(completed.state.resultVersion).toBe(1);
    expect(completed.state.resultSnapshots).toHaveLength(1);
    expect(completed.state.resultSnapshots).toMatchObject([{
      version: 1,
      artifactRefs: {
        source_video: [expect.any(String)],
        target_subtitle: [expect.any(String)],
        vertical_subtitle: [expect.any(String)],
        dubbed_audio: [expect.any(String)],
        horizontal_video: [expect.any(String)],
        vertical_video: [expect.any(String)]
      }
    }]);
    expect(completed.artifacts.every(artifact => artifact.metadata.resultVersion === 1)).toBe(true);
    await runner.close();
    fixture.db.close();
  });

  it('validates credentials for the provider saved in the job snapshot', async () => {
    const fixture = setup({
      dubbing: true,
      ttsProvider: 'aliyun',
      ttsModel: 'qwen3-tts-flash',
      voiceCode: 'Cherry'
    });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    config.tts.provider = 'openai';
    config.tts.openai.apiKey = 'openai-key';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });

    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
      .resolves.toBeUndefined();
    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'tts'))
      .rejects.toMatchObject({ code: 'creator_tts_config_missing' });
    expect(fixture.service.getJob(fixture.jobId)?.state.needsInput).toMatchObject({
      code: 'creator_tts_config_missing',
      deepLink: '#/settings?tab=ai-services&section=tts'
    });
    fixture.db.close();
  });

  it('does not read or validate TTS configuration when dubbing is disabled', async () => {
    const fixture = setup({ dubbing: false });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    const read = vi.fn(async () => config);
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read }
    });

    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'subtitle'))
      .resolves.toBeUndefined();
    await expect(workflow.validateStage(fixture.service.getJob(fixture.jobId)!, 'tts'))
      .resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    fixture.db.close();
  });

  it('continues from completed subtitles after TTS configuration is saved', async () => {
    const fixture = setup({
      dubbing: true,
      composeVideo: true,
      videoFormat: 'horizontal'
    });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-key';
    const workflow = createVideoTranslationWorkflow({
      creator: fixture.service,
      dispatcher: fixture.dispatcher,
      configStore: { read: vi.fn(async () => config) }
    });
    const subtitle = fixture.dispatcher.dispatch(fixture.jobId, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'start-waiting-workflow',
      input: { stageId: 'subtitle', workflow: true }
    }, 'user').commandReceipt.stageRunId!;

    fixture.repository.updateStageRun({ id: subtitle, status: 'succeeded' });
    await workflow.handleStageChanged(fixture.repository.getStageRun(subtitle)!);
    expect(fixture.service.getJob(fixture.jobId)).toMatchObject({
      status: 'needs_input',
      state: {
        needsInput: { code: 'creator_tts_config_missing' }
      }
    });

    config.tts.openai.apiKey = 'tts-key';
    await workflow.resumeConfiguredJobs();

    expect(fixture.service.getJob(fixture.jobId)?.stages.map(stage => stage.stageId)).toEqual([
      'subtitle',
      'tts'
    ]);
    expect(fixture.service.getJob(fixture.jobId)?.state).not.toHaveProperty('needsInput');
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

async function succeedAndContinue(
  fixture: ReturnType<typeof setup>,
  workflow: ReturnType<typeof createVideoTranslationWorkflow>,
  stageRunId: string
): Promise<void> {
  fixture.repository.updateStageRun({ id: stageRunId, status: 'succeeded' });
  await workflow.handleStageChanged(fixture.repository.getStageRun(stageRunId)!);
}

function latestStage(fixture: ReturnType<typeof setup>) {
  return fixture.service.getJob(fixture.jobId)!.stages.at(-1)!;
}
