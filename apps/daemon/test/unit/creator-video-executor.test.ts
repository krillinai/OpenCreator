import type {
  CreatorArtifact,
  CreatorJob,
  CreatorStageRun,
  VideoGenerationResult
} from '@opencreator/protocol';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';
import { createVideoExecutor } from '../../src/creator/video/executor.js';
import {
  VideoGenerationError,
  type VideoGenerationService
} from '../../src/video-generation/service.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator video executor', () => {
  it('creates a generated_video artifact and keeps unknown provider progress indeterminate', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-executor-'));
    const referencePath = join(tempDir, 'reference.png');
    await writeFile(referencePath, 'reference-image');
    const queued = videoResult({ status: 'queued', progress: 0, progressKnown: false });
    const completed = videoResult({
      status: 'completed',
      progress: 100,
      progressKnown: true,
      fileName: 'OpenCreator-video-result.mp4',
      size: 12
    });
    const service = videoService({
      create: vi.fn(async () => queued),
      refresh: vi.fn(async (_id, options) => {
        options?.onDownloadStart?.();
        return completed;
      })
    });
    const executor = createVideoExecutor({
      service,
      pollIntervalMs: 250,
      sleep: vi.fn(async () => undefined),
      probeVideo: vi.fn(async () => ({
        duration: 8,
        width: 720,
        height: 1280,
        hasVideo: true,
        hasAudio: false
      }))
    });
    const reference = artifact('reference_image', referencePath, {
      mimeType: 'image/png',
      fileName: 'reference.png'
    });
    const stage = stageInput({
      provider: 'veo',
      model: 'veo-3.1-generate-preview',
      size: '720x1280',
      duration: 8
    }, [reference]);

    const result = await executor.run(stage);

    expect(service.create).toHaveBeenCalledWith(
      {
        prompt: 'A cinematic city reveal',
        provider: 'veo',
        model: 'veo-3.1-generate-preview',
        size: '720x1280',
        duration: 8,
        referenceImage: {
          mime: 'image/png',
          data: Buffer.from('reference-image').toString('base64')
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(service.refresh).toHaveBeenCalledWith(
      queued.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(result.outputs[0]).toMatchObject({
      kind: 'generated_video',
      status: 'completed',
      metadata: {
        provider: 'veo',
        model: 'video-model',
        videoSize: '720x1280',
        requestedDuration: 8,
        duration: 8,
        width: 720,
        height: 1280,
        hasAudio: false,
        generationMode: 'image-to-video',
        referenceArtifactId: reference.id,
        videoGenerationResultId: queued.id
      }
    });
    const queuedProgress = vi.mocked(stage.reportProgress).mock.calls
      .map(call => call[0])
      .find(progress => progress.phase === 'queued');
    expect(queuedProgress).toMatchObject({
      phase: 'queued',
      videoGenerationResultId: queued.id,
      percent: null
    });
    expect(stage.reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      percent: 90
    }));
  });

  it('resumes the original upstream job instead of submitting another generation', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-resume-'));
    const inProgress = videoResult({
      status: 'in_progress',
      progress: 0,
      progressKnown: false
    });
    const completed = videoResult({
      status: 'completed',
      progress: 100,
      progressKnown: true,
      fileName: 'OpenCreator-video-result.mp4',
      size: 12
    });
    const service = videoService({
      create: vi.fn(async () => {
        throw new Error('must not submit another task');
      }),
      get: vi.fn(async () => inProgress),
      refresh: vi.fn(async () => completed)
    });
    const executor = createVideoExecutor({
      service,
      sleep: vi.fn(async () => undefined),
      probeVideo: vi.fn(async () => ({
        duration: 5,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true
      }))
    });
    const stage = stageInput({}, []);
    const interrupted = stageRun('video_stage_original', {
      videoGenerationResultId: inProgress.id
    });
    stage.stageRun = stageRun('video_stage_resumed', {
      resumedFromStageRunId: interrupted.id
    });
    stage.job.stages = [interrupted, stage.stageRun];

    await executor.run(stage);

    expect(service.create).not.toHaveBeenCalled();
    expect(service.get).toHaveBeenCalledWith(inProgress.id);
    expect(service.refresh).toHaveBeenCalledWith(
      inProgress.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(stage.reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      resumedUpstreamTask: true,
      videoGenerationResultId: inProgress.id
    }));
  });

  it('reuses a failed stage upstream job after a status refresh error', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-recover-failed-'));
    const inProgress = videoResult({
      status: 'in_progress',
      progress: 0,
      progressKnown: false
    });
    const completed = videoResult({
      status: 'completed',
      progress: 100,
      progressKnown: true,
      fileName: 'OpenCreator-video-result.mp4',
      size: 12
    });
    const service = videoService({
      create: vi.fn(async () => {
        throw new Error('must not submit another task');
      }),
      get: vi.fn(async () => inProgress),
      refresh: vi.fn(async () => completed)
    });
    const executor = createVideoExecutor({
      service,
      sleep: vi.fn(async () => undefined),
      probeVideo: vi.fn(async () => ({
        duration: 5,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true
      }))
    });
    const stage = stageInput({}, []);
    const failed = stageRun('video_stage_failed_refresh', {
      videoGenerationResultId: inProgress.id
    });
    failed.status = 'failed';
    failed.dispatchStatus = 'finished';
    failed.errorCode = 'creator_video_upstream_error';
    failed.errorMessage = 'The video generation status could not be refreshed';
    failed.finishedAt = '2026-09-07T00:01:00.000Z';
    stage.job.stages = [failed, stage.stageRun];

    await executor.run(stage);

    expect(service.create).not.toHaveBeenCalled();
    expect(service.get).toHaveBeenCalledWith(inProgress.id);
  });

  it('retries a transient provider status error without failing the stage', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-refresh-retry-'));
    const queued = videoResult({ status: 'queued', progress: 0, progressKnown: false });
    const completed = videoResult({
      status: 'completed',
      progress: 100,
      progressKnown: true,
      fileName: 'OpenCreator-video-result.mp4',
      size: 12
    });
    const refresh = vi.fn()
      .mockRejectedValueOnce(new VideoGenerationError(
        'VIDEO_GENERATION_UPSTREAM_ERROR',
        'The video generation status could not be refreshed',
        502
      ))
      .mockResolvedValueOnce(completed);
    const service = videoService({
      create: vi.fn(async () => queued),
      refresh
    });
    const executor = createVideoExecutor({
      service,
      sleep: vi.fn(async () => undefined),
      probeVideo: vi.fn(async () => ({
        duration: 5,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true
      }))
    });
    const stage = stageInput({}, []);

    await executor.run(stage);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(stage.reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'generating',
      refreshRetry: 1,
      videoGenerationResultId: queued.id
    }));
  });

  it('maps missing provider configuration to Creator needs-input handling', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-config-'));
    const service = videoService({
      create: vi.fn(async () => {
        throw new VideoGenerationError(
          'VIDEO_GENERATION_CONFIG_REQUIRED',
          'Configure veo video generation credentials',
          409
        );
      })
    });
    const executor = createVideoExecutor({
      service,
      probeVideo: vi.fn()
    });

    await expect(executor.run(stageInput({ provider: 'veo', duration: 8 }, [])))
      .rejects.toMatchObject({
        code: 'creator_video_config_missing'
      });
  });

  it('maps an unavailable provider model to an actionable Creator error', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-model-'));
    const service = videoService({
      create: vi.fn(async () => {
        throw new VideoGenerationError(
          'VIDEO_GENERATION_UPSTREAM_ERROR',
          'Your account has not activated the model doubao-seedance-2-5',
          502
        );
      })
    });
    const executor = createVideoExecutor({
      service,
      probeVideo: vi.fn()
    });

    await expect(executor.run(stageInput({
      provider: 'seedance',
      model: 'doubao-seedance-2-5-260628'
    }, []))).rejects.toMatchObject({
      code: 'creator_video_model_unavailable'
    });
  });
});

function videoService(
  overrides: Partial<VideoGenerationService>
): VideoGenerationService {
  return {
    create: vi.fn(async () => videoResult()),
    get: vi.fn(async () => videoResult()),
    refresh: vi.fn(async () => videoResult({ status: 'completed', progress: 100 })),
    read: vi.fn(async () => ({
      result: videoResult({ status: 'completed', progress: 100 }),
      content: Buffer.from('video')
    })),
    copyTo: vi.fn(async (_id, destination) => {
      await writeFile(destination, 'video-content');
      return videoResult({ status: 'completed', progress: 100 });
    }),
    ...overrides
  };
}

function videoResult(
  patch: Partial<VideoGenerationResult> = {}
): VideoGenerationResult {
  return {
    id: 'video_result_1234',
    prompt: 'A cinematic city reveal',
    provider: 'veo',
    model: 'video-model',
    videoSize: '720x1280',
    duration: 8,
    status: 'queued',
    progress: 0,
    progressKnown: false,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:01:00.000Z',
    ...patch
  };
}

function stageInput(
  state: Record<string, string | number>,
  inputArtifacts: CreatorArtifact[]
): CreatorExecutorInput {
  const createdAt = '2026-09-07T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'video_job',
    projectId: 'project_1',
    templateId: 'video-generation',
    templateVersion: 1,
    status: 'running',
    revision: 1,
    presetOrigin: null,
    state: {
      prompt: 'A cinematic city reveal',
      provider: 'seedance',
      size: '1280x720',
      duration: 5,
      referenceImageArtifactId: inputArtifacts[0]?.id ?? null,
      currentStage: 'generate',
      ...state
    },
    agentThreadId: null,
    stages: [],
    artifacts: inputArtifacts,
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
  const currentStage = stageRun('video_stage', {});
  job.stages = [currentStage];
  return {
    stageRun: currentStage,
    job,
    inputArtifacts,
    workdir: tempDir,
    signal: new AbortController().signal,
    reportProgress: vi.fn()
  };
}

function stageRun(
  id: string,
  progress: CreatorStageRun['progress']
): CreatorStageRun {
  return {
    id,
    jobId: 'video_job',
    stageId: 'generate',
    executor: 'video',
    status: 'running',
    dispatchStatus: 'claimed',
    claimOwner: 'test',
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: null,
    progress,
    errorCode: null,
    errorMessage: null,
    startedAt: '2026-09-07T00:00:00.000Z',
    finishedAt: null
  };
}

function artifact(
  kind: string,
  path: string,
  metadata: CreatorArtifact['metadata']
): CreatorArtifact {
  return {
    id: `artifact_${kind}`,
    jobId: 'video_job',
    kind,
    version: 1,
    status: 'completed',
    path,
    sourceArtifactIds: [],
    metadata,
    createdAt: '2026-09-07T00:00:00.000Z'
  };
}
