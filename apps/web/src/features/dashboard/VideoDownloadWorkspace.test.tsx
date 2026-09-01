import type {
  CreatorActionRequest,
  CreatorActionResponse,
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  CreatorStageRun,
  CreatorYtDlpStatus
} from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import VideoDownloadWorkspace from './VideoDownloadWorkspace.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';

describe('VideoDownloadWorkspace', () => {
  it('submits a real probe stage and does not announce success before an artifact exists', async () => {
    let current = job();
    const applyAction = vi.fn(async (
      _jobId: string,
      request: CreatorActionRequest
    ): Promise<CreatorActionResponse> => {
      current = {
        ...current,
        revision: current.revision + 1,
        status: request.action === 'run-stage' ? 'running' : current.status,
        state: request.action === 'update-settings'
          ? {
              ...current.state,
              ...(request.input.patch as Record<string, CreatorJson>)
            }
          : current.state
      };
      return {
        job: current,
        receipt: {
          actor: 'user',
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: current.revision,
          createdAt: current.updatedAt
        }
      };
    });
    renderWorkspace(current, { applyAction });

    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://www.youtube.com/watch?v=demo' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'probe' }
      })
    ));
    expect(screen.getByText('解析任务已提交，真实规格返回后会自动显示')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '下载规格' })).not.toBeInTheDocument();
    expect(screen.queryByText('链接解析完成，请选择下载规格')).not.toBeInTheDocument();
  });

  it('marks downloaded formats complete and only offers saving project files locally', async () => {
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [
        probeArtifact(),
        videoArtifact()
      ]
    });
    renderWorkspace(current, {
      applyAction: vi.fn()
    });

    expect(await screen.findByRole('tab', { name: '视频信息' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '视频信息' }));
    expect(screen.getByText('Creator Download')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '下载规格' }));
    expect(screen.getAllByText('1080p')).toHaveLength(2);
    expect(screen.getByText('MP4 · 1920 x 1080 · 30 FPS · 84 MB')).toBeInTheDocument();
    expect(screen.getByLabelText('已完成 1080p')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载 1080p' }))
      .not.toBeInTheDocument();
    expect(screen.queryByText('OpenCreator 视频示例')).not.toBeInTheDocument();
    expect(screen.queryByText(/Vimeo/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '项目文件' }));
    expect(screen.getByText('Creator Download.mp4')).toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: '保存到本机 Creator Download.mp4'
    })).toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: '发送到视频翻译 Creator Download.mp4'
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: '发送到自动剪辑 Creator Download.mp4'
    })).not.toBeInTheDocument();
  });

  it('keeps other formats downloadable and lists progress by queued option', async () => {
    let current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact()],
      stages: [downloadStage('stage_1080', 'video-1080-1', 'running', 42)]
    });
    const jobId = current.id;
    const applyAction = vi.fn(async (
      _jobId: string,
      request: CreatorActionRequest
    ): Promise<CreatorActionResponse> => {
      const revision = current.revision + 1;
      current = {
        ...current,
        revision,
        status: request.action === 'run-stage' ? 'running' : current.status,
        state: request.action === 'update-settings'
          ? {
              ...current.state,
              ...(request.input.patch as Record<string, CreatorJson>)
            }
          : current.state,
        stages: request.action === 'run-stage'
          ? [
              ...current.stages,
              downloadStage(
                `stage_${revision}`,
                String(request.input.optionId),
                'queued',
                0
              )
            ]
          : current.stages
      };
      return {
        job: current,
        receipt: {
          actor: 'user',
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: revision,
          createdAt: current.updatedAt
        }
      };
    });
    renderWorkspace(current, { applyAction });

    const runningButton = await screen.findByRole('button', { name: '下载 1080p' });
    const availableButton = screen.getByRole('button', { name: '下载 720p' });
    expect(runningButton).toBeDisabled();
    expect(runningButton).toHaveTextContent('下载中');
    expect(availableButton).toBeEnabled();

    fireEvent.click(availableButton);

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        action: 'run-stage',
        input: expect.objectContaining({
          stageId: 'download',
          optionId: 'video-720-2',
          mediaType: 'video'
        })
      })
    ));
    expect(await screen.findByText('Creator Download · 1080p')).toBeInTheDocument();
    expect(screen.getByText('Creator Download · 720p')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
  });

  it('shows download preparation as indeterminate instead of a fixed percent', async () => {
    const current = job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact()],
      stages: [
        downloadStage(
          'stage_preparing',
          'video-1080-1',
          'running',
          2,
          'preparing_download'
        )
      ]
    });
    renderWorkspace(current, { applyAction: vi.fn() });

    fireEvent.click(await screen.findByRole('tab', { name: '项目文件' }));

    expect(screen.getByText('准备中')).toBeInTheDocument();
    expect(screen.queryByText('2%')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '正在准备下载' }))
      .not.toHaveAttribute('aria-valuenow');
  });

  it('rejects domains that only mimic a supported video host suffix', () => {
    const applyAction = vi.fn();
    renderWorkspace(job(), { applyAction });

    fireEvent.change(screen.getByRole('textbox', { name: '待下载视频链接' }), {
      target: { value: 'https://notyoutube.com/watch?v=demo' }
    });
    fireEvent.click(screen.getByRole('button', { name: '解析链接' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '请输入有效的 YouTube 或 Bilibili 公公开视频链接'
    );
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('does not unlock formats from an older probe after a newer URL was analyzed', () => {
    const older = probeArtifact();
    const newer = {
      ...probeArtifact(),
      id: 'probe_artifact_newer',
      metadata: {
        ...probeArtifact().metadata,
        id: 'demo-newer',
        requestedUrl: 'https://www.youtube.com/watch?v=newer',
        url: 'https://www.youtube.com/watch?v=newer'
      },
      createdAt: '2026-08-30T00:00:02.000Z'
    };
    renderWorkspace(job({
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [older, newer]
    }), {
      applyAction: vi.fn()
    });

    expect(screen.queryByRole('tab', { name: '下载规格' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '待下载视频链接' }))
      .toHaveValue('https://www.youtube.com/watch?v=demo');
  });

  it('shows an actionable message for a failed network probe', () => {
    const createdAt = '2026-08-30T00:00:00.000Z';
    renderWorkspace(job({
      status: 'failed',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      },
      stages: [{
        id: 'probe_stage',
        jobId: 'download_job',
        stageId: 'probe',
        executor: 'download',
        status: 'failed',
        dispatchStatus: 'claimed',
        claimOwner: 'test',
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'probing_source',
          percent: 20
        },
        errorCode: 'network_unavailable',
        errorMessage: 'Unable to connect to the video platform.',
        startedAt: createdAt,
        finishedAt: createdAt
      }]
    }), {
      applyAction: vi.fn()
    });

    expect(screen.getAllByText('无法连接视频平台，请检查网络或代理设置后重试'))
      .toHaveLength(2);
  });

  it('keeps routine yt-dlp version management out of the download workspace', () => {
    renderWorkspace(job(), {
      applyAction: vi.fn(),
      runtimeDependencies: {
        ytDlpStatus: ytDlpStatus({
          latestVersion: '2026.08.31.120000',
          updateAvailable: true
        })
      }
    });

    expect(screen.queryByText('yt-dlp nightly 有可用更新')).not.toBeInTheDocument();
    expect(screen.queryByText('yt-dlp 2026.08.29.232711')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查 yt-dlp 更新' }))
      .not.toBeInTheDocument();
  });

  it('updates yt-dlp and retries the failed download with the original stage input', async () => {
    const failedStage = {
      ...downloadStage('stage_failed', 'video-720-2', 'failed', 37),
      errorCode: 'yt_dlp_update_recommended',
      errorMessage: 'The video platform extractor may be outdated',
      finishedAt: '2026-08-30T00:00:03.000Z'
    } satisfies CreatorStageRun;
    const current = job({
      status: 'failed',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      artifacts: [probeArtifact()],
      stages: [failedStage]
    });
    const applyAction = vi.fn(async (
      _jobId: string,
      request: CreatorActionRequest
    ): Promise<CreatorActionResponse> => ({
      job: current,
      receipt: {
        actor: 'user',
        action: request.action,
        summary: request.action,
        affectedArtifacts: [],
        newRevision: current.revision,
        createdAt: current.updatedAt
      }
    }));
    const updateYtDlp = vi.fn(async () => ytDlpStatus({
      source: 'managed',
      currentVersion: '2026.08.31.120000',
      latestVersion: '2026.08.31.120000',
      installedAt: '2026-08-31T00:00:00.000Z'
    }));
    const onOpenRuntimeComponents = vi.fn();
    renderWorkspace(current, {
      applyAction,
      runtimeDependencies: {
        ytDlpStatus: ytDlpStatus(),
        updateYtDlp
      },
      onOpenRuntimeComponents
    });

    expect(await screen.findByRole('button', { name: '前往本机组件' }))
      .toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '更新并重试' }));

    await waitFor(() => expect(updateYtDlp).toHaveBeenCalledOnce());
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      current.id,
      expect.objectContaining({
        action: 'run-stage',
        input: {
          stageId: 'download',
          optionId: 'video-720-2',
          mediaType: 'video',
          sourceUrl: 'https://www.youtube.com/watch?v=demo'
        }
      })
    ));
    expect(screen.getByText(
      'yt-dlp 已更新到 2026.08.31.120000，任务已重新提交'
    )).toBeInTheDocument();
  });
});

function renderWorkspace(
  initialJob: CreatorJob,
  input: {
    applyAction: ReturnType<typeof vi.fn>;
    runtimeDependencies?: Partial<RuntimeDependenciesController>;
    onOpenRuntimeComponents?: () => void;
  }
) {
  const runtimeDependencies = input.runtimeDependencies === undefined
    ? undefined
    : {
        phase: 'idle',
        checkYtDlpUpdate: vi.fn(async () => ytDlpStatus()),
        updateYtDlp: vi.fn(async () => ytDlpStatus()),
        ...input.runtimeDependencies
      } as RuntimeDependenciesController;
  return render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={initialJob}
        service={{
          applyAction: input.applyAction,
          runAgentTurn: vi.fn()
        } as never}
      >
        <VideoDownloadWorkspace
          onBack={vi.fn()}
          runtimeDependencies={runtimeDependencies}
          onOpenRuntimeComponents={input.onOpenRuntimeComponents}
        />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function ytDlpStatus(
  patch: Partial<CreatorYtDlpStatus> = {}
): CreatorYtDlpStatus {
  return {
    channel: 'nightly',
    source: 'bundled',
    currentVersion: '2026.08.29.232711',
    bundledVersion: '2026.08.29.232711',
    latestVersion: null,
    updateAvailable: false,
    checkDue: false,
    lastCheckedAt: null,
    lastCheckAttemptAt: null,
    installedAt: null,
    ...patch
  };
}

function job(patch: Partial<CreatorJob> = {}): CreatorJob {
  const createdAt = '2026-08-30T00:00:00.000Z';
  return {
    id: 'download_job',
    projectId: 'project_1',
    templateId: 'video-download',
    templateVersion: 2,
    status: 'draft',
    revision: 0,
    state: {},
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    providerRequests: [],
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

function probeArtifact(): CreatorArtifact {
  return {
    id: 'probe_artifact',
    jobId: 'download_job',
    kind: 'download_probe',
    version: 1,
    status: 'completed',
    path: '/tmp/probe.json',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      id: 'demo',
      title: 'Creator Download',
      requestedUrl: 'https://www.youtube.com/watch?v=demo',
      url: 'https://www.youtube.com/watch?v=demo',
      platform: 'youtube',
      uploader: 'OpenCreator',
      thumbnailUrl: 'https://i.ytimg.com/vi/demo/hqdefault.jpg',
      duration: 120,
      width: 1920,
      height: 1080,
      formats: [],
      options: [{
        id: 'video-1080-1',
        mediaType: 'video',
        container: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        estimatedBytes: 88_080_384,
        videoFormatId: '399',
        audioFormatId: '140'
      }, {
        id: 'video-720-2',
        mediaType: 'video',
        container: 'mp4',
        width: 1280,
        height: 720,
        fps: 30,
        estimatedBytes: 52_428_800,
        videoFormatId: '398',
        audioFormatId: '140'
      }, {
        id: 'audio-mp3-192',
        mediaType: 'audio',
        container: 'mp3',
        bitrateKbps: 192,
        estimatedBytes: 2_880_000,
        audioFormatId: '140',
        transcode: 'mp3'
      }]
    },
    createdAt: '2026-08-30T00:00:01.000Z'
  };
}

function downloadStage(
  id: string,
  optionId: string,
  status: CreatorStageRun['status'],
  percent: number,
  phase = status === 'running' ? 'downloading' : 'preparing_download'
): CreatorStageRun {
  const createdAt = '2026-08-30T00:00:02.000Z';
  return {
    id,
    jobId: 'download_job',
    stageId: 'download',
    executor: 'download',
    status,
    dispatchStatus: status === 'queued' ? 'queued' : 'claimed',
    claimOwner: status === 'queued' ? null : 'test',
    claimExpiresAt: null,
    attempt: status === 'queued' ? 0 : 1,
    idempotencyKey: null,
    scopeKey: null,
    inputFingerprint: null,
    progress: {
      optionId,
      mediaType: 'video',
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      probeArtifactId: 'probe_artifact',
      phase,
      percent
    },
    errorCode: null,
    errorMessage: null,
    startedAt: status === 'queued' ? null : createdAt,
    finishedAt: null
  };
}

function videoArtifact(): CreatorArtifact {
  return {
    id: 'video_artifact',
    jobId: 'download_job',
    kind: 'source_video',
    version: 1,
    status: 'completed',
    path: '/tmp/Creator Download.mp4',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: ['probe_artifact'],
    metadata: {
      fileName: 'Creator Download.mp4',
      mimeType: 'video/mp4',
      size: 88_080_384,
      width: 1920,
      height: 1080,
      hasVideo: true,
      hasAudio: true,
      optionId: 'video-1080-1',
      mediaType: 'video',
      requestedUrl: 'https://www.youtube.com/watch?v=demo'
    },
    createdAt: '2026-08-30T00:00:02.000Z'
  };
}
