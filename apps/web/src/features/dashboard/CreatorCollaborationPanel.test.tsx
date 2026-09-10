import type { CreatorJob } from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorCollaborationPanel from './CreatorCollaborationPanel.js';
import {
  coverPanelAdapter,
  videoDownloadPanelAdapter
} from './creator-panel-adapters.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('CreatorCollaborationPanel', () => {
  it('语义化并合并封面动态，同时显示标准 Stage 进度', () => {
    const job = coverJob();
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={coverPanelAdapter}
            stepLabel="正在生成封面"
            contextSummary="16:9 · 2 个方案"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('更新了封面设置')).toHaveLength(1);
    expect(screen.getByText('封面描述、封面比例')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/currentStep|workspacePhase/)).not.toBeInTheDocument();
    expect(screen.queryByText('启动阶段 generate')).not.toBeInTheDocument();
    expect(screen.queryByText('选择了项目封面')).not.toBeInTheDocument();

    expect(screen.getByText(/工作台 · 生成封面方案/)).toBeInTheDocument();
    expect(screen.getByText('正在生成封面方案，已完成 1/2')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '生成封面方案进度' }))
      .toHaveAttribute('aria-valuenow', '50');
    expect(container.querySelectorAll('.creator-collaboration-stage')).toHaveLength(1);
  });

  it('语义化视频下载阶段，并把各规格进度留给工作台列表展示', () => {
    const job = downloadJob();
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={videoDownloadPanelAdapter}
            stepLabel="下载到项目"
            contextSummary="YouTube · 1080p"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('视频链接、下载规格')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/currentStep|resultTab/)).not.toBeInTheDocument();
    expect(videoDownloadPanelAdapter.normalizeActivity(
      job.activities.at(-1)!,
      (zh: string) => zh
    )).toEqual({
      label: '开始下载到项目',
      fields: []
    });
    expect(screen.queryByText('启动阶段 download')).not.toBeInTheDocument();
    expect(screen.getByText(/工作台 · 下载到项目/)).toBeInTheDocument();
    expect(screen.getByText('下载媒体文件')).toBeInTheDocument();
    expect(screen.queryByText('42%')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: '下载到项目进度' }))
      .not.toBeInTheDocument();
    expect(videoDownloadPanelAdapter.phaseLabel(
      'normalizing_media',
      (zh: string) => zh
    )).toBe('转换为本机兼容格式');
  });

  it('视频下载准备阶段只显示状态文案，具体进度留在规格列表', () => {
    const current = downloadJob();
    current.stages[0] = {
      ...current.stages[0]!,
      progress: {
        ...current.stages[0]!.progress,
        phase: 'preparing_download',
        percent: 2
      }
    };
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={current}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={videoDownloadPanelAdapter}
            stepLabel="下载到项目"
            contextSummary="YouTube · 1080p"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('准备下载规格')).toBeInTheDocument();
    expect(screen.queryByText('2%')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: '下载到项目进度' }))
      .not.toBeInTheDocument();
  });

  it('完成阶段不误报结果已同步到工作台', () => {
    const current = downloadJob();
    current.stages[0] = {
      ...current.stages[0]!,
      status: 'succeeded',
      dispatchStatus: 'finished',
      progress: { phase: 'completed', percent: 100 },
      finishedAt: '2026-08-30T08:00:06.000Z'
    };
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={current}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <CreatorCollaborationPanel
            adapter={videoDownloadPanelAdapter}
            stepLabel="下载到项目"
            contextSummary="YouTube · 1080p"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByText('已完成，结果已同步到工作台')).not.toBeInTheDocument();
  });

  it('视频解析阶段显示不确定进度而不是固定 20%', () => {
    const current = downloadJob();
    current.state.currentStage = 'probe';
    current.stages[0] = {
      ...current.stages[0]!,
      id: 'probe_stage',
      stageId: 'probe',
      progress: {
        phase: 'probing_source',
        percent: 20,
        message: 'Reading video information and available formats'
      }
    };
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={current}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={videoDownloadPanelAdapter}
            stepLabel="解析视频信息"
            contextSummary="YouTube · 正在解析"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('读取视频信息与可用规格')).toBeInTheDocument();
    expect(screen.queryByText('20%')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '解析视频信息进度' }))
      .not.toHaveAttribute('aria-valuenow');
  });

  it('同一下载阶段有运行和排队实例时优先显示运行实例', () => {
    const current = downloadJob();
    current.stages.push({
      ...current.stages[0]!,
      id: 'download_stage_queued',
      status: 'queued',
      dispatchStatus: 'queued',
      claimOwner: null,
      attempt: 0,
      progress: {
        ...current.stages[0]!.progress,
        optionId: 'video-360-2',
        phase: 'preparing_download',
        percent: 0
      },
      startedAt: null
    });
    const onCancelTask = vi.fn();
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={current}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={videoDownloadPanelAdapter}
            stepLabel="下载到项目"
            contextSummary="YouTube · 2 个下载规格"
            onCancelTask={onCancelTask}
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('下载媒体文件')).toBeInTheDocument();
    expect(screen.queryByText('42%')).not.toBeInTheDocument();
    expect(screen.queryByText('等待执行')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终止下载到项目' }))
      .toBeInTheDocument();
    expect(container.querySelectorAll('.creator-collaboration-stage')).toHaveLength(1);
  });

  it('将视频下载网络故障显示为可操作提示', () => {
    const current = downloadJob();
    current.status = 'failed';
    current.stages[0] = {
      ...current.stages[0]!,
      status: 'failed',
      errorCode: 'network_unavailable',
      errorMessage: 'Unable to connect to the video platform.',
      finishedAt: '2026-08-30T08:00:06.000Z'
    };
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={current}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={videoDownloadPanelAdapter}
            stepLabel="解析视频信息"
            contextSummary="YouTube"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('无法连接视频平台，请检查网络或代理设置后重试'))
      .toBeInTheDocument();
  });
});

function coverJob(): CreatorJob {
  const createdAt = '2026-08-30T08:00:00.000Z';
  return {
    id: 'cover_job',
    projectId: 'project_1',
    templateId: 'cover',
    templateVersion: 2,
    status: 'running',
    revision: 5,
    state: {
      sourceType: 'prompt',
      prompt: '电影感人物封面',
      ratio: '16:9',
      candidateCount: 2,
      quality: 'medium',
      currentStage: 'generate'
    },
    agentThreadId: null,
    stages: [{
      id: 'cover_stage',
      jobId: 'cover_job',
      stageId: 'generate',
      executor: 'image',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'cover-generate-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'generating_candidates',
        percent: 50,
        completed: 1,
        failed: 0,
        total: 2
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-30T08:00:05.000Z',
      finishedAt: null
    }],
    providerRequests: [],
    artifacts: [],
    activities: [
      {
        id: 'activity_ui_1',
        jobId: 'cover_job',
        revision: 1,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'currentStep,workspacePhase' },
        createdAt: '2026-08-30T08:00:01.000Z'
      },
      {
        id: 'activity_prompt',
        jobId: 'cover_job',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'prompt' },
        createdAt: '2026-08-30T08:00:02.000Z'
      },
      {
        id: 'activity_ratio',
        jobId: 'cover_job',
        revision: 3,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'ratio' },
        createdAt: '2026-08-30T08:00:03.000Z'
      },
      {
        id: 'activity_run',
        jobId: 'cover_job',
        revision: 4,
        actor: 'user',
        action: 'run-stage',
        summary: '启动阶段 generate',
        details: { stageId: 'generate' },
        createdAt: '2026-08-30T08:00:04.000Z'
      },
      {
        id: 'activity_legacy_select',
        jobId: 'cover_job',
        revision: 5,
        actor: 'user',
        action: 'select-cover',
        summary: '选择项目封面',
        details: { artifactId: 'legacy_cover' },
        createdAt: '2026-08-30T08:00:05.000Z'
      }
    ],
    createdAt,
    updatedAt: '2026-08-30T08:00:06.000Z'
  };
}

function downloadJob(): CreatorJob {
  const createdAt = '2026-08-30T08:00:00.000Z';
  return {
    id: 'download_job',
    projectId: 'project_1',
    templateId: 'video-download',
    templateVersion: 2,
    status: 'running',
    revision: 4,
    state: {
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      mediaType: 'video',
      selectedOptionId: 'video-1080-1',
      currentStage: 'download'
    },
    agentThreadId: null,
    stages: [{
      id: 'download_stage',
      jobId: 'download_job',
      stageId: 'download',
      executor: 'download',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'download-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'downloading',
        percent: 42,
        message: 'Downloading video'
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-30T08:00:04.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      {
        id: 'activity_ui',
        jobId: 'download_job',
        revision: 1,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'currentStep,resultTab' },
        createdAt: '2026-08-30T08:00:01.000Z'
      },
      {
        id: 'activity_url',
        jobId: 'download_job',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'sourceUrl' },
        createdAt: '2026-08-30T08:00:02.000Z'
      },
      {
        id: 'activity_option',
        jobId: 'download_job',
        revision: 3,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'selectedOptionId' },
        createdAt: '2026-08-30T08:00:03.000Z'
      },
      {
        id: 'activity_run',
        jobId: 'download_job',
        revision: 4,
        actor: 'user',
        action: 'run-stage',
        summary: '启动阶段 download',
        details: { stageId: 'download' },
        createdAt: '2026-08-30T08:00:04.000Z'
      }
    ],
    createdAt,
    updatedAt: '2026-08-30T08:00:05.000Z'
  };
}
