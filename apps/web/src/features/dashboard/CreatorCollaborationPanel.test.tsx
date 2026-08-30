import type { CreatorJob } from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorCollaborationPanel from './CreatorCollaborationPanel.js';
import { coverPanelAdapter } from './creator-panel-adapters.js';
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
