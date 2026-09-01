import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapCreatorAgentRuntime } from '../../src/creator/agent/bootstrap.js';
import { createCreatorAgentService } from '../../src/creator/agent/agent-service.js';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import type { AgentRuntimeAdapter } from '../../src/creator/agent/runtime-adapter.js';
import { parseClipCandidates } from '../../src/creator/clip/analyzer.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { parseDownloadProbe } from '../../src/creator/download/probe-parser.js';
import { CreatorExecutorError, type CreatorExecutor } from '../../src/creator/executor.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-runtime-advanced-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const agentRepository = createCreatorAgentRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const dispatcher = createCreatorCommandDispatcher({
    service,
    repository,
    receipts: agentRepository
  });
  return { db, repository, agentRepository, dispatcher, service, templates };
}

describe('creator runtime advanced contracts', () => {
  it('runs distinct shot scopes concurrently while keeping unscoped stages serial', async () => {
    const { db, repository, service, templates } = setup();
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const executor: CreatorExecutor = {
      id: 'image',
      async run({ stageRun, workdir }) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>(resolve => releases.push(resolve));
        active -= 1;
        const outputPath = join(workdir, 'generated.png');
        writeFileSync(outputPath, stageRun.scopeKey ?? 'unscoped');
        return {
          outputs: [{
            kind: 'generated_image',
            status: 'completed',
            path: outputPath
          }]
        };
      }
    };
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [executor],
      workRoot: join(tempDir, 'work'),
      maxConcurrency: 4
    });
    const scopedJob = service.createJob({
      projectId: 'p1',
      templateId: 'image-generation',
      state: { prompt: 'scoped' }
    });
    const scopedRuns = ['shot-01', 'shot-02'].map(scopeKey => repository.createStageRun({
      jobId: scopedJob.id,
      stageId: 'generate',
      executor: 'image',
      status: 'queued',
      scopeKey,
      inputFingerprint: scopeKey === 'shot-01' ? '1'.repeat(64) : '2'.repeat(64)
    }));
    const scopedExecution = scopedRuns.map(stage => runner.runStageRun(stage.id));
    await expect.poll(() => active).toBe(2);
    expect(peak).toBe(2);
    releases.splice(0).forEach(release => release());
    await Promise.all(scopedExecution);
    const scopedArtifacts = repository.getJob(scopedJob.id)!.artifacts;
    expect(scopedArtifacts).toHaveLength(2);
    for (const artifact of scopedArtifacts) {
      expect(artifact.scopeKey).toMatch(/^shot-0[12]$/);
      expect(artifact.inputFingerprint).toMatch(/^[12]{64}$/);
      expect(artifact.sha256).toBe(createHash('sha256')
        .update(artifact.scopeKey!)
        .digest('hex'));
    }

    active = 0;
    peak = 0;
    const unscopedJob = service.createJob({
      projectId: 'p1',
      templateId: 'image-generation',
      state: { prompt: 'unscoped' }
    });
    const unscopedRuns = [1, 2].map(() => repository.createStageRun({
      jobId: unscopedJob.id,
      stageId: 'generate',
      executor: 'image',
      status: 'queued'
    }));
    const unscopedExecution = unscopedRuns.map(stage => runner.runStageRun(stage.id));
    await expect.poll(() => active).toBe(1);
    expect(peak).toBe(1);
    releases.shift()?.();
    await expect.poll(() => active).toBe(1);
    expect(peak).toBe(1);
    releases.shift()?.();
    await Promise.all(unscopedExecution);

    await runner.close();
    db.close();
  });

  it('cancels queued and running stage runs without committing partial outputs', async () => {
    const { db, repository, dispatcher, service, templates } = setup();
    const queuedJob = service.createJob({
      projectId: 'p1',
      templateId: 'image-generation',
      state: { prompt: 'queued cancellation' }
    });
    const queuedStage = repository.createStageRun({
      jobId: queuedJob.id,
      stageId: 'generate',
      executor: 'image',
      status: 'queued',
      dispatchStatus: 'queued'
    });
    let executorStarted!: () => void;
    const started = new Promise<void>(resolve => {
      executorStarted = resolve;
    });
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'image',
        async run({ signal }) {
          executorStarted();
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return {
            outputs: [{
              kind: 'generated_image',
              status: 'completed' as const,
              path: join(tempDir, 'partial.png')
            }]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });

    expect(runner.cancel(queuedStage.id)).toMatchObject({ status: 'canceled' });
    expect(service.getJob(queuedJob.id)).toMatchObject({
      status: 'canceled',
      stages: [expect.objectContaining({ status: 'canceled', dispatchStatus: 'finished' })]
    });

    const runningJob = service.createJob({
      projectId: 'p1',
      templateId: 'image-generation',
      state: { prompt: 'running cancellation' }
    });
    const runningStageId = dispatcher.dispatch(runningJob.id, {
      action: 'run-stage',
      expectedRevision: runningJob.revision,
      idempotencyKey: 'run-image-for-cancel',
      input: { stageId: 'generate' }
    }, 'user').commandReceipt.stageRunId!;
    const execution = runner.runStageRun(runningStageId);
    await started;

    expect(runner.cancel(runningStageId)).toMatchObject({
      status: 'running',
      progress: { cancelRequested: true }
    });
    const canceled = await execution;
    expect(canceled).toMatchObject({
      status: 'canceled',
      errorCode: 'creator_stage_canceled'
    });
    expect(service.getJob(runningJob.id)).toMatchObject({
      status: 'canceled',
      artifacts: []
    });
    await runner.close();
    db.close();
  });

  it('does not start an executor when required inputs are missing and retry creates a new run', async () => {
    const { db, repository, service, templates } = setup();
    const run = vi.fn<CreatorExecutor['run']>().mockResolvedValue({ outputs: [] });
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{ id: 'clip', run }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({ projectId: 'p1', templateId: 'auto-clip' });
    const first = await runner.run(job.id, 'analyze');
    expect(first).toMatchObject({ status: 'failed', errorCode: 'creator_stage_input_missing' });
    expect(run).not.toHaveBeenCalled();
    const second = await runner.retry(first.id);
    expect(second.id).not.toBe(first.id);
    expect(service.getJob(job.id)?.stages).toHaveLength(2);
    await runner.close();
    db.close();
  });

  it('keeps a video download job in draft after the non-final probe stage', async () => {
    const { db, repository, service, templates } = setup();
    const probePath = join(tempDir, 'probe.json');
    writeFileSync(probePath, '{}');
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'download',
        async run() {
          return {
            outputs: [{
              kind: 'download_probe',
              status: 'completed' as const,
              path: probePath,
              metadata: {
                requestedUrl: 'https://www.youtube.com/watch?v=probe-only',
                options: []
              }
            }],
            progress: { phase: 'completed', percent: 100 }
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-download',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=probe-only'
      }
    });

    const stage = await runner.run(job.id, 'probe');
    const probed = service.getJob(job.id)!;

    expect(stage.status).toBe('succeeded');
    expect(probed.status).toBe('draft');
    expect(probed.state).not.toHaveProperty('latestResultVersion');
    expect(probed.artifacts).toEqual([
      expect.objectContaining({ kind: 'download_probe', status: 'completed' })
    ]);
    await runner.close();
    db.close();
  });

  it('keeps provider configuration failures actionable as needs_input jobs', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'krillinai',
        async run() {
          throw new CreatorExecutorError(
            'creator_transcription_config_missing',
            'OpenAI transcription API key is required'
          );
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=no-captions',
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn'
      }
    });

    const stage = await runner.run(job.id, 'subtitle');

    expect(stage).toMatchObject({
      status: 'failed',
      errorCode: 'creator_transcription_config_missing'
    });
    expect(service.getJob(job.id)).toMatchObject({
      status: 'needs_input',
      state: {
        needsInput: {
          code: 'creator_transcription_config_missing',
          deepLink: '#/settings?tab=ai-services&section=transcription'
        }
      }
    });
    await runner.close();
    db.close();
  });

  it('links missing image credentials to the image service settings', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'image',
        async run() {
          throw new CreatorExecutorError(
            'creator_image_config_missing',
            'OpenAI image API key is required'
          );
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'image-generation',
      state: { prompt: 'A bright creative studio' }
    });

    const stage = await runner.run(job.id, 'generate');

    expect(stage).toMatchObject({
      status: 'failed',
      errorCode: 'creator_image_config_missing'
    });
    expect(service.getJob(job.id)).toMatchObject({
      status: 'needs_input',
      state: {
        needsInput: {
          code: 'creator_image_config_missing',
          deepLink: '#/settings?tab=ai-services&section=image'
        }
      }
    });
    await runner.close();
    db.close();
  });

  it('keeps existing cover versions available after source re-analysis', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'cover-analysis',
        async run() {
          writeFileSync(join(tempDir, 'cover-brief.json'), '{}');
          writeFileSync(join(tempDir, 'source-keyframe.jpg'), 'jpeg');
          return {
            outputs: [
              {
                kind: 'cover_brief',
                status: 'completed' as const,
                path: join(tempDir, 'cover-brief.json'),
                metadata: { imagePrompt: 'Updated video summary' }
              },
              {
                kind: 'source_keyframe',
                status: 'completed' as const,
                path: join(tempDir, 'source-keyframe.jpg')
              }
            ]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'cover',
      state: {
        sourceType: 'youtube',
        sourceUrl: 'https://www.youtube.com/watch?v=cover-reanalysis',
        latestResultVersion: 1,
        resultVersion: 1,
        resultSnapshots: [{
          version: 1,
          createdAt: '2026-08-29T00:00:00.000Z',
          action: 'stage-succeeded',
          stageId: 'generate',
          description: '生成封面',
          artifactRefs: {},
          staleArtifactIds: [],
          state: {}
        }]
      }
    });
    const cover = repository.insertArtifact({
      jobId: job.id,
      kind: 'cover_image',
      status: 'completed',
      path: join(tempDir, 'cover-v1.png'),
      sourceArtifactIds: [],
      metadata: { resultVersion: 1 }
    });

    const completedStage = await runner.run(job.id, 'analyze-source');

    const completed = service.getJob(job.id)!;
    expect(completedStage.status).toBe('succeeded');
    expect(completed.artifacts.find(artifact => artifact.id === cover.id)?.status)
      .toBe('completed');
    expect(completed.state.latestResultVersion).toBe(1);
    expect(completed.state.resultVersion).toBe(1);
    expect(completed.state.resultSnapshots).toHaveLength(1);
    expect(completed.artifacts.filter(artifact => (
      artifact.kind === 'cover_brief' || artifact.kind === 'source_keyframe'
    ))).toEqual([
      expect.objectContaining({ kind: 'cover_brief', metadata: { imagePrompt: 'Updated video summary' } }),
      expect.objectContaining({ kind: 'source_keyframe', metadata: {} })
    ]);
    await runner.close();
    db.close();
  });

  it('creates project snapshots that reuse unchanged artifact files across child outputs', async () => {
    const { db, repository, service, templates } = setup();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'krillinai',
        async run({ stageRun }) {
          if (stageRun.stageId === 'subtitle') {
            writeFileSync(join(tempDir, 'subtitle-v1.srt'), '1\n00:00:00,000 --> 00:00:01,000\nTest\n');
            return {
              outputs: [{
                kind: 'target_subtitle',
                status: 'completed' as const,
                path: join(tempDir, 'subtitle-v1.srt'),
                metadata: { cues: [] }
              }]
            };
          }
          if (stageRun.stageId === 'render-horizontal') {
            writeFileSync(join(tempDir, 'horizontal-v1.mp4'), 'video');
            return {
              outputs: [{
                kind: 'horizontal_video',
                status: 'completed' as const,
                path: join(tempDir, 'horizontal-v1.mp4')
              }]
            };
          }
          writeFileSync(join(tempDir, 'voice-v1.wav'), 'audio');
          return {
            outputs: [{
              kind: 'dubbed_audio',
              status: 'completed' as const,
              path: join(tempDir, 'voice-v1.wav')
            }]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-translation',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=test',
        dubbing: true,
        composeVideo: true,
        videoFormat: 'horizontal',
        resultVersion: 1
      }
    });
    repository.insertArtifact({
      jobId: job.id,
      kind: 'source_video',
      status: 'completed',
      path: join(tempDir, 'source.mp4'),
      sourceArtifactIds: [],
      metadata: {}
    });

    await runner.run(job.id, 'subtitle');
    const afterSubtitle = service.getJob(job.id)!;
    service.applyAction(job.id, {
      action: 'run-stage',
      expectedRevision: afterSubtitle.revision,
      input: { stageId: 'tts' }
    });
    await runner.run(job.id, 'tts');

    const afterVoice = service.getJob(job.id)!;
    service.applyAction(job.id, {
      action: 'run-stage',
      expectedRevision: afterVoice.revision,
      input: { stageId: 'render-horizontal' }
    });
    await runner.run(job.id, 'render-horizontal');

    const afterVideo = service.getJob(job.id)!;
    service.applyAction(job.id, {
      action: 'run-stage',
      expectedRevision: afterVideo.revision,
      input: { stageId: 'subtitle' }
    });
    await runner.run(job.id, 'subtitle');

    const completed = service.getJob(job.id)!;
    const snapshots = completed.state.resultSnapshots as Array<{
      version: number;
      artifactRefs: Record<string, string[]>;
    }>;
    const subtitle = completed.artifacts.find(artifact => artifact.kind === 'target_subtitle')!;
    const voice = completed.artifacts.find(artifact => artifact.kind === 'dubbed_audio')!;
    const video = completed.artifacts.find(artifact => artifact.kind === 'horizontal_video')!;
    const latestSubtitle = completed.artifacts.filter(artifact => artifact.kind === 'target_subtitle').at(-1)!;
    expect(snapshots).toHaveLength(4);
    expect(snapshots[0]).toMatchObject({
      version: 1,
      artifactRefs: { target_subtitle: [subtitle.id] }
    });
    expect(snapshots[1]).toMatchObject({
      version: 2,
      artifactRefs: {
        target_subtitle: [subtitle.id],
        dubbed_audio: [voice.id]
      }
    });
    expect(snapshots[2]).toMatchObject({
      version: 3,
      artifactRefs: {
        target_subtitle: [subtitle.id],
        dubbed_audio: [voice.id],
        horizontal_video: [video.id]
      }
    });
    expect(snapshots[3]).toMatchObject({
      version: 4,
      artifactRefs: {
        target_subtitle: [latestSubtitle.id]
      }
    });
    expect((completed.state.resultSnapshots as Array<{ staleArtifactIds: string[] }>)[3]?.staleArtifactIds)
      .toEqual([]);
    expect(subtitle).toMatchObject({ version: 1, metadata: { resultVersion: 1 } });
    expect(voice).toMatchObject({ version: 1, metadata: { resultVersion: 2 } });
    expect(video).toMatchObject({ version: 1, metadata: { resultVersion: 3 } });
    expect(latestSubtitle).toMatchObject({ version: 2, metadata: { resultVersion: 4 } });
    expect(completed.state.resultVersion).toBe(4);
    await runner.close();
    db.close();
  });

  it('branches a render from the selected project version instead of the latest artifacts', async () => {
    const { db, repository, agentRepository, service, templates } = setup();
    let observedInputIds: string[] = [];
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'krillinai',
        async run({ inputArtifacts }) {
          observedInputIds = inputArtifacts.map(artifact => artifact.id);
          writeFileSync(join(tempDir, 'branched-horizontal.mp4'), 'video');
          return {
            outputs: [{
              kind: 'horizontal_video',
              status: 'completed' as const,
              path: join(tempDir, 'branched-horizontal.mp4')
            }]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=branch-v1',
        composeVideo: true,
        videoFormat: 'horizontal'
      }
    });
    const sourceV1 = repository.insertArtifact({
      jobId: job.id,
      kind: 'source_video',
      status: 'completed',
      path: join(tempDir, 'source-v1.mp4'),
      sourceArtifactIds: [],
      metadata: { resultVersion: 1 }
    });
    const subtitleV1 = repository.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'subtitle-v1.srt'),
      sourceArtifactIds: [sourceV1.id],
      metadata: { resultVersion: 1 }
    });
    const voiceV1 = repository.insertArtifact({
      jobId: job.id,
      kind: 'dubbed_audio',
      status: 'completed',
      path: join(tempDir, 'voice-v1.wav'),
      sourceArtifactIds: [subtitleV1.id],
      metadata: { resultVersion: 1 }
    });
    const dubbedVideoV1 = repository.insertArtifact({
      jobId: job.id,
      kind: 'dubbed_video',
      status: 'completed',
      path: join(tempDir, 'dubbed-v1.mp4'),
      sourceArtifactIds: [sourceV1.id, voiceV1.id],
      metadata: { resultVersion: 1 }
    });
    const sourceV2 = repository.insertArtifact({
      jobId: job.id,
      kind: 'source_video',
      status: 'completed',
      path: join(tempDir, 'source-v2.mp4'),
      sourceArtifactIds: [],
      metadata: { resultVersion: 2 }
    });
    const subtitleV2 = repository.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'subtitle-v2.srt'),
      sourceArtifactIds: [sourceV2.id],
      metadata: { resultVersion: 2 }
    });
    repository.updateJob({
      id: job.id,
      status: 'completed',
      revision: 0,
      state: {
        ...job.state,
        resultVersion: 2,
        latestResultVersion: 2,
        resultSnapshots: [
          {
            version: 1,
            createdAt: '2026-08-30T00:00:00.000Z',
            action: 'stage-succeeded',
            stageId: 'subtitle',
            description: '生成字幕',
            artifactRefs: {
              source_video: [sourceV1.id],
              target_subtitle: [subtitleV1.id],
              dubbed_audio: [voiceV1.id],
              dubbed_video: [dubbedVideoV1.id]
            },
            changedArtifactIds: [
              sourceV1.id,
              subtitleV1.id,
              voiceV1.id,
              dubbedVideoV1.id
            ],
            staleArtifactIds: [],
            state: {
              sourceType: 'url',
              sourceUrl: 'https://www.youtube.com/watch?v=branch-v1',
              composeVideo: false,
              videoFormat: 'horizontal'
            }
          },
          {
            version: 2,
            createdAt: '2026-08-30T00:01:00.000Z',
            action: 'stage-succeeded',
            stageId: 'subtitle',
            description: '生成字幕',
            artifactRefs: {
              source_video: [sourceV2.id],
              target_subtitle: [subtitleV2.id]
            },
            changedArtifactIds: [sourceV2.id, subtitleV2.id],
            staleArtifactIds: [],
            state: {
              sourceType: 'url',
              sourceUrl: 'https://www.youtube.com/watch?v=branch-v2',
              composeVideo: false,
              videoFormat: 'horizontal'
            }
          }
        ]
      }
    });
    const dispatcher = createCreatorCommandDispatcher({
      service,
      repository,
      receipts: agentRepository
    });
    const queued = dispatcher.dispatch(job.id, {
      action: 'run-stage',
      expectedRevision: 0,
      idempotencyKey: 'branch-render-from-v1',
      input: {
        stageId: 'render-horizontal',
        baseResultVersion: 1,
        inputResultVersion: 1
      }
    }, 'user');

    await runner.runStageRun(queued.commandReceipt.stageRunId!);

    expect(observedInputIds).toEqual([sourceV1.id, subtitleV1.id]);
    const completed = service.getJob(job.id)!;
    const snapshot = (completed.state.resultSnapshots as Array<{
      version: number;
      artifactRefs: Record<string, string[]>;
    }>).at(-1)!;
    expect(snapshot).toMatchObject({
      version: 3,
      artifactRefs: {
        source_video: [sourceV1.id],
        target_subtitle: [subtitleV1.id],
        horizontal_video: [expect.any(String)]
      }
    });
    expect(snapshot.artifactRefs.source_video).not.toContain(sourceV2.id);
    expect(snapshot.artifactRefs.target_subtitle).not.toContain(subtitleV2.id);
    expect(snapshot.artifactRefs).not.toHaveProperty('dubbed_audio');
    expect(snapshot.artifactRefs).not.toHaveProperty('dubbed_video');
    await runner.close();
    db.close();
  });

  it('does not reuse an old local source after the job switches to a URL', async () => {
    const { db, repository, service, templates } = setup();
    let observedInputs: string[] = [];
    const runner = createCreatorStageRunner({
      repository,
      templates,
      executors: [{
        id: 'krillinai',
        async run({ inputArtifacts }) {
          observedInputs = inputArtifacts.map(artifact => artifact.id);
          return {
            outputs: [{
              kind: 'target_subtitle',
              status: 'completed' as const,
              path: join(tempDir, 'url-subtitle.srt')
            }]
          };
        }
      }],
      workRoot: join(tempDir, 'work')
    });
    const job = service.createJob({
      projectId: 'p1',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=current-url',
        sourceArtifactId: null
      }
    });
    const oldLocalSource = repository.insertArtifact({
      jobId: job.id,
      kind: 'source_video',
      status: 'completed',
      path: join(tempDir, 'old-local-source.mp4'),
      sourceArtifactIds: [],
      metadata: { source: 'local-upload' }
    });

    await runner.run(job.id, 'subtitle');

    expect(observedInputs).not.toContain(oldLocalSource.id);
    await runner.close();
    db.close();
  });

  it('re-reads once after an agent revision conflict and then applies with actor=agent', async () => {
    const { db, agentRepository, dispatcher, service, templates } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'cover' });
    let calls = 0;
    const runtime: AgentRuntimeAdapter = {
      id: 'fake', available: true,
      async runTurn(input) {
        calls += 1;
        if (calls === 1) {
          service.applyAction(job.id, {
            actor: 'user', action: 'update-settings', expectedRevision: input.context.revision,
            input: { patch: { ratio: '1:1' } }
          });
        }
        return {
          content: '已调整封面提示词',
          action: {
            action: 'update-settings',
            expectedRevision: input.context.revision,
            input: { patch: { prompt: '清晰的人物主体' } }
          }
        };
      }
    };
    const agent = createCreatorAgentService({
      creator: service,
      dispatcher,
      repository: agentRepository,
      contextBuilder: createAgentContextBuilder({ templates }),
      runtime,
      threads: {
        createThread: () => ({ id: 'creator-thread' }) as never,
        getThread: () => ({ id: 'creator-thread' }) as never,
        updateThread: () => ({ id: 'creator-thread' }) as never
      }
    });
    const result = await agent.runTurn(job.id, { message: '调整提示词' });
    expect(calls).toBe(2);
    expect(result.turn.audit.map(item => item.result)).toEqual([
      'ok', 'creator_revision_conflict', 'ok', 'ok'
    ]);
    expect(result.action?.receipt.actor).toBe('agent');
    expect(result.action?.job.state).toMatchObject({ ratio: '1:1', prompt: '清晰的人物主体' });
    db.close();
  });

  it('stops after a second agent conflict and asks for user resolution', async () => {
    const { db, agentRepository, dispatcher, service, templates } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'cover' });
    const runtime: AgentRuntimeAdapter = {
      id: 'fake', available: true,
      async runTurn(input) {
        service.applyAction(job.id, {
          actor: 'user', action: 'update-settings', expectedRevision: input.context.revision,
          input: { patch: { prompt: `用户修改-${input.conflictAttempt}` } }
        });
        return {
          content: '状态持续变化，需要确认',
          action: {
            action: 'update-settings', expectedRevision: input.context.revision,
            input: { patch: { prompt: 'Agent 修改' } }
          }
        };
      }
    };
    const agent = createCreatorAgentService({
      creator: service,
      dispatcher,
      repository: agentRepository,
      contextBuilder: createAgentContextBuilder({ templates }),
      runtime,
      threads: {
        createThread: () => ({ id: 'creator-thread' }) as never,
        getThread: () => ({ id: 'creator-thread' }) as never,
        updateThread: () => ({ id: 'creator-thread' }) as never
      }
    });
    const result = await agent.runTurn(job.id, { message: '修改' });
    expect(result.turn.status).toBe('needs_user_resolution');
    expect(result.turn.audit.filter(item => item.result === 'creator_revision_conflict')).toHaveLength(2);
    expect(result.action).toBeUndefined();
    db.close();
  });

  it('installs and repairs the isolated opencreator runtime skill without touching the source home', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-bootstrap-'));
    const sourceHome = join(tempDir, 'source-home');
    const bundled = join(tempDir, 'bundled');
    const runtimeRoot = join(tempDir, 'runtime');
    mkdirSync(sourceHome, { recursive: true });
    mkdirSync(bundled, { recursive: true });
    writeFileSync(join(sourceHome, 'auth.json'), '{"token":"sentinel"}');
    writeFileSync(join(bundled, 'SKILL.md'), '# OpenCreator Runtime\n');
    writeFileSync(join(bundled, 'manifest.json'), '{"version":2}\n');
    const first = bootstrapCreatorAgentRuntime({ sourceCodexHome: sourceHome, runtimeRoot, bundledSkillDir: bundled });
    expect(first).toMatchObject({ available: true, guideVersion: 2 });
    writeFileSync(join(first.skillPath, 'SKILL.md'), 'damaged');
    writeFileSync(join(first.skillPath, '.opencreator-hash'), 'damaged');
    const repaired = bootstrapCreatorAgentRuntime({ sourceCodexHome: sourceHome, runtimeRoot, bundledSkillDir: bundled });
    expect(readFileSync(join(repaired.skillPath, 'SKILL.md'), 'utf8')).toBe('# OpenCreator Runtime\n');
    expect(readFileSync(join(sourceHome, 'auth.json'), 'utf8')).toBe('{"token":"sentinel"}');
  });

  it('normalizes probe formats and rejects invalid clip ranges before ffmpeg', () => {
    const probe = parseDownloadProbe({
      id: 'v1', title: 'Demo', webpage_url: 'https://www.bilibili.com/video/BV1',
      extractor_key: 'BiliBili', duration: 12,
      formats: [{ format_id: '1080', ext: 'mp4', width: 1920, height: 1080, filesize: 42, vcodec: 'h264', acodec: 'none' }]
    });
    expect(probe).toMatchObject({ platform: 'bilibili', formats: [{ id: '1080', hasVideo: true, hasAudio: false }] });
    expect(() => parseClipCandidates({ candidates: [{
      id: 'bad', start: 8, end: 13, reason: '越界',
      scores: { hook: 8, information: 8, emotion: 8, completeness: 8 }
    }] }, 12)).toThrow(/invalid_clip_range/);
  });

});
