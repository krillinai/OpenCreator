import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  CreatorServicesConfigResponse
} from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import VideoGenerationWorkspace from './VideoGenerationWorkspace.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('VideoGenerationWorkspace', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => `blob:video-${blob.size}`)
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('opens an existing project on the latest generated video version', async () => {
    const versionOne = videoArtifact(1);
    const versionTwo = videoArtifact(2);
    const job = creatorJob({
      status: 'completed',
      artifacts: [versionOne, versionTwo],
      state: {
        prompt: '当前编辑中的视频描述',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 1,
        furthestStep: 2,
        currentStage: 'generate',
        resultVersion: 2,
        latestResultVersion: 2,
        resultSnapshots: [
          resultSnapshot(1, versionOne),
          resultSnapshot(2, versionTwo)
        ]
      }
    });
    const openArtifact = vi.fn(async () => new Response(
      new Blob(['video'], { type: 'video/mp4' })
    ));

    renderWorkspace(job, { openArtifact });

    expect(await screen.findByRole('heading', { name: '生成结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, versionTwo.id));
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, versionOne.id));
  });

  it('does not expose a failed generation as a completed result version', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'veo',
        size: '720x1280',
        duration: 8,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        progress: {
          phase: 'provider_failed',
          percent: null
        },
        errorCode: 'creator_video_generation_failed',
        errorMessage: 'The provider rejected the prompt',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job);

    expect(screen.getByRole('heading', { name: '生成视频' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /项目 V/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始生成' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The provider rejected the prompt');
  });

  it('shows an actionable message when the selected model is not enabled', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_model_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        progress: {
          phase: 'submitting',
          percent: 8
        },
        errorCode: 'creator_video_model_unavailable',
        errorMessage: 'Your account has not activated the model doubao-seedance-2-5',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job, {
      openArtifact: vi.fn(async () => new Response(
        new Blob(['reference'], { type: 'image/png' })
      ))
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      '当前账号未开通 Seedance 2.5，请切换模型版本或前往方舟控制台开通'
    );
  });

  it('offers to continue an existing upstream task after a refresh failure', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '让猫开始打字',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_refresh_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        progress: {
          phase: 'generating',
          percent: null,
          videoGenerationResultId: 'video_result_1234'
        },
        errorCode: 'creator_video_upstream_error',
        errorMessage: 'The video generation status could not be refreshed',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job);

    expect(screen.getByRole('button', { name: '继续任务' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始生成' })).not.toBeInTheDocument();
  });

  it('shows that Seedance reference-image generation follows the image ratio', async () => {
    const reference = videoArtifact(1);
    reference.id = 'reference_image_1';
    reference.kind = 'reference_image';
    reference.path = '/tmp/reference.png';
    reference.metadata = {
      fileName: 'reference.png',
      mimeType: 'image/png',
      size: 1024
    };
    const job = creatorJob({
      artifacts: [reference],
      state: {
        prompt: '让猫开始打字',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: reference.id,
        currentStep: 1,
        furthestStep: 1,
        currentStage: null
      }
    });

    const openArtifact = vi.fn(async () => new Response(
      new Blob(['reference'], { type: 'image/png' })
    ));
    renderWorkspace(job, { openArtifact });

    const format = screen.getByRole('combobox', { name: '画幅' });
    expect(format).toBeDisabled();
    expect(format).toHaveTextContent('跟随参考图');
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, reference.id));
  });

  it('uses distinct English labels for video format and output format', () => {
    const job = creatorJob({
      state: {
        prompt: 'A cinematic city reveal',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: null
      }
    });

    renderWorkspace(job, { language: 'en-US' });

    expect(screen.getByText('Format')).toBeInTheDocument();
    expect(screen.getByText('Output format')).toBeInTheDocument();
  });

  it('uses the configured default model for a task and allows a task-level override', async () => {
    const job = creatorJob({
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 1,
        furthestStep: 1,
        currentStage: null
      }
    });
    const getConfig = vi.fn(async (): Promise<CreatorServicesConfigResponse> => ({
      config: {
        ...createVideoConfig(),
        video: {
          ...createVideoConfig().video,
          provider: 'seedance',
          seedance: {
            ...createVideoConfig().video.seedance,
            model: 'doubao-seedance-2-0-260128'
          }
        }
      },
      configuredCredentials: []
    }));

    renderWorkspace(job, {
      creatorServicesService: { getConfig } as never
    });

    const model = await screen.findByRole('combobox', { name: '模型版本' });
    await waitFor(() => expect(model).toHaveValue('doubao-seedance-2-0-260128'));
    fireEvent.change(model, { target: { value: 'doubao-seedance-2-5-260628' } });
    expect(model).toHaveValue('doubao-seedance-2-5-260628');
  });
});

function renderWorkspace(
  initialJob: CreatorJob,
  overrides: {
    openArtifact?: (jobId: string, artifactId: string) => Promise<Response>;
    creatorServicesService?: { getConfig(): Promise<CreatorServicesConfigResponse> };
    language?: 'zh-CN' | 'en-US';
  } = {}
) {
  return render(
    <LanguageProvider initialPreference={overrides.language ?? 'zh-CN'}>
      <CreatorSessionProvider
        initialJob={initialJob}
        service={{
          applyAction: vi.fn(),
          openArtifact: overrides.openArtifact ?? vi.fn(),
          runAgentTurn: vi.fn()
        } as never}
      >
        <VideoGenerationWorkspace
          creatorServicesService={overrides.creatorServicesService as never}
          onBack={vi.fn()}
        />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function createVideoConfig() {
  return {
    proxy: '',
    llm: {
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      jsonMode: false,
      source: 'codex' as const
    },
    transcription: {
      provider: 'openai' as const,
      enableGpuAcceleration: false,
      openai: { baseUrl: '', apiKey: '', model: 'whisper-1' },
      fasterWhisper: { model: 'medium' as const },
      whisperKit: { model: 'large-v2' as const },
      whisperCpp: { model: 'tiny' as const },
      aliyun: {
        oss: { accessKeyId: '', accessKeySecret: '', bucket: '' },
        speech: { accessKeyId: '', accessKeySecret: '', appKey: '' }
      }
    },
    tts: {
      provider: 'openai' as const,
      openai: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      minimax: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      aliyun: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' }
    },
    image: {
      provider: 'openai' as const,
      openai: { baseUrl: '', apiKey: '', model: '' },
      jimeng: { baseUrl: '', apiKey: '', model: '' },
      kling: { baseUrl: '', accessKey: '', secretKey: '', model: '' },
      gemini: { baseUrl: '', apiKey: '', model: '' }
    },
    video: {
      provider: 'seedance' as const,
      seedance: { baseUrl: '', apiKey: '', model: 'doubao-seedance-2-5-260628' },
      kling: { baseUrl: '', accessKey: '', secretKey: '', model: 'kling-v2-1-master' },
      veo: { baseUrl: '', apiKey: '', model: 'veo-3.1-generate-preview' }
    }
  };
}

function creatorJob(patch: Partial<CreatorJob>): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'creator_video_workspace',
    projectId: 'project_1',
    templateId: 'video-generation',
    templateVersion: 1,
    status: 'draft',
    revision: 1,
    presetOrigin: null,
    state: {
      prompt: '',
      provider: 'seedance',
      size: '1280x720',
      duration: 5,
      referenceImageArtifactId: null,
      currentStep: 0,
      furthestStep: 0,
      currentStage: null
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

function videoArtifact(version: number): CreatorArtifact {
  return {
    id: `generated_video_v${version}`,
    jobId: 'creator_video_workspace',
    kind: 'generated_video',
    version,
    status: 'completed',
    path: `/tmp/generated-video-v${version}.mp4`,
    sourceArtifactIds: [],
    metadata: {
      provider: version === 1 ? 'seedance' : 'veo',
      model: version === 1 ? 'seedance-model' : 'veo-model',
      videoSize: version === 1 ? '1280x720' : '720x1280',
      requestedDuration: version === 1 ? 5 : 8,
      duration: version === 1 ? 5 : 8,
      fileName: `OpenCreator-video-V${version}.mp4`,
      mimeType: 'video/mp4',
      bytes: version * 1024,
      resultVersion: version
    },
    createdAt: `2026-09-07T08:0${version}:00.000Z`
  };
}

function resultSnapshot(
  version: number,
  artifact: CreatorArtifact
): CreatorJson {
  return {
    version,
    createdAt: artifact.createdAt,
    action: 'stage-succeeded',
    stageId: 'generate',
    description: version === 1 ? '初次生成' : `第 ${version} 次生成`,
    artifactRefs: { generated_video: [artifact.id] },
    changedArtifactIds: [artifact.id],
    staleArtifactIds: [],
    state: {
      prompt: version === 1 ? '海岸公路' : '雨夜城市',
      provider: version === 1 ? 'seedance' : 'veo',
      size: version === 1 ? '1280x720' : '720x1280',
      duration: version === 1 ? 5 : 8,
      referenceImageArtifactId: null
    }
  };
}
