import type { CreatorJob } from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorCollaborationPanel from './CreatorCollaborationPanel.js';
import { creatorPanelAdapterFor, transcriptionPanelAdapter } from './creator-panel-adapters.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('video transcription collaboration panel', () => {
  it('filters UI state, merges setting activities, and shows real stage progress', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider initialJob={transcriptionJob()} service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}>
          <CreatorCollaborationPanel
            adapter={transcriptionPanelAdapter}
            stepLabel="正在转录"
            contextSummary="English · SRT / TXT"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(creatorPanelAdapterFor('transcription')).toBe(transcriptionPanelAdapter);
    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('视频链接、源语言')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/sourceArtifactId|currentStage/)).not.toBeInTheDocument();
    expect(screen.getByText(/工作台 · 视频转录/)).toBeInTheDocument();
    expect(screen.getByText('正在转录，已完成 2/5 段')).toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '视频转录进度' })).toHaveAttribute('aria-valuenow', '42');
  });
});

function transcriptionJob(): CreatorJob {
  const jobId = 'transcription_job';
  return {
    id: jobId,
    projectId: 'project_1',
    templateId: 'transcription',
    templateVersion: 1,
    status: 'running',
    revision: 4,
    state: { sourceLanguage: 'en' },
    agentThreadId: null,
    stages: [{
      id: 'transcription_stage',
      jobId,
      stageId: 'transcription',
      executor: 'krillinai',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'transcription-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: { phase: 'processing_audio', percent: 42, completed: 2, failed: 0, total: 5 },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-11-05T09:00:04.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      { id: 'ui', jobId, revision: 1, actor: 'user', action: 'update-settings:draft', summary: '更新创作设置', details: { objectId: 'sourceArtifactId,currentStage' }, createdAt: '2026-11-05T09:00:01.000Z' },
      { id: 'url', jobId, revision: 2, actor: 'user', action: 'update-settings:draft', summary: '更新创作设置', details: { objectId: 'sourceUrl' }, createdAt: '2026-11-05T09:00:02.000Z' },
      { id: 'language', jobId, revision: 3, actor: 'user', action: 'update-settings:draft', summary: '更新创作设置', details: { objectId: 'sourceLanguage' }, createdAt: '2026-11-05T09:00:03.000Z' },
      { id: 'run', jobId, revision: 4, actor: 'user', action: 'run-stage', summary: '启动转录', details: { stageId: 'transcription' }, createdAt: '2026-11-05T09:00:04.000Z' }
    ],
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T09:00:04.000Z'
  };
}
