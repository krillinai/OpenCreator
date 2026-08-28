import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorJob, CreatorJson, CreatorStageRun } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import VideoTranslationWorkspace from './VideoTranslationWorkspace.js';

describe('VideoTranslationWorkspace task controls', () => {
  it('confirms cancellation and resumes from the canceled stage', async () => {
    const runningStage = stage({
      id: 'stage_subtitle_1',
      status: 'running',
      dispatchStatus: 'claimed',
      progress: {
        workflow: true,
        percent: 4,
        krillinEventPayload: {
          phase: 'translating_subtitles',
          percent: 4,
          message: '正在翻译字幕'
        }
      }
    });
    const runningJob = job({
      status: 'running',
      revision: 2,
      stages: [runningStage]
    });
    const canceledStage: CreatorStageRun = {
      ...runningStage,
      status: 'canceled',
      dispatchStatus: 'finished',
      progress: { ...runningStage.progress, cancelRequested: true },
      errorCode: 'creator_stage_canceled',
      errorMessage: 'Creator stage was canceled',
      finishedAt: '2026-08-28T06:00:10.000Z'
    };
    const canceledJob = job({
      status: 'canceled',
      revision: 3,
      stages: [canceledStage]
    });
    const resumedStage = stage({
      id: 'stage_subtitle_2',
      status: 'queued',
      dispatchStatus: 'queued',
      progress: {
        workflow: true,
        resumedFromStageRunId: canceledStage.id
      }
    });
    const resumedJob = job({
      status: 'running',
      revision: 4,
      stages: [canceledStage, resumedStage]
    });
    let currentJob = runningJob;
    const applyAction = vi.fn(async (_jobId: string, request: {
      action: string;
      input: { patch?: Record<string, CreatorJson> };
    }) => {
      currentJob = {
        ...currentJob,
        revision: currentJob.revision + 1,
        state: {
          ...currentJob.state,
          ...(request.input.patch ?? {})
        }
      };
      return {
        job: currentJob,
        receipt: {
          actor: 'user' as const,
          action: request.action,
          summary: request.action,
          affectedArtifacts: [],
          newRevision: currentJob.revision,
          createdAt: currentJob.updatedAt
        }
      };
    });
    const cancelJob = vi.fn(async () => {
      currentJob = canceledJob;
      return {
        job: currentJob,
        stage: canceledStage,
        control: 'canceled' as const
      };
    });
    const resumeJob = vi.fn(async () => {
      currentJob = {
        ...resumedJob,
        revision: currentJob.revision + 1
      };
      return {
        job: currentJob,
        stage: resumedStage,
        control: 'resumed' as const
      };
    });

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={runningJob}
          service={{
            applyAction,
            cancelJob,
            resumeJob,
            runAgentTurn: vi.fn()
          } as never}
        >
          <VideoTranslationWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const workspace = screen.getByRole('region', { name: '视频翻译操作区' });
    expect(await within(workspace).findByRole('button', { name: '终止任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终止字幕翻译' })).toBeInTheDocument();
    expect(within(workspace).queryByRole('button', { name: '开始翻译' })).not.toBeInTheDocument();

    fireEvent.click(within(workspace).getByRole('button', { name: '终止任务' }));
    const dialog = screen.getByRole('dialog', { name: '终止翻译任务？' });
    expect(dialog).toHaveTextContent('当前正在执行“字幕翻译”，进度 4%');
    expect(dialog).toHaveTextContent('当前 4% 的阶段内进度不会保留');
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '终止任务' }));

    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('job_control'));
    const resumeButton = await within(workspace).findByRole('button', { name: '继续任务' });
    await waitFor(() => expect(resumeButton).toBeEnabled());
    expect(screen.getByRole('button', { name: '继续字幕翻译' })).toBeInTheDocument();
    expect(screen.getByText('已终止，可继续')).toBeInTheDocument();

    fireEvent.click(resumeButton);
    await waitFor(() => expect(resumeJob).toHaveBeenCalledWith('job_control'));
    expect(await within(workspace).findByRole('button', { name: '终止任务' })).toBeInTheDocument();
    expect(within(workspace).queryByRole('button', { name: '开始翻译' })).not.toBeInTheDocument();
  });
});

function job(input: {
  status: CreatorJob['status'];
  revision: number;
  stages: CreatorStageRun[];
}): CreatorJob {
  return {
    id: 'job_control',
    projectId: 'project_1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: input.status,
    revision: input.revision,
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=job-control',
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      bilingual: true,
      subtitlePosition: 'top',
      preferPlatformCaptions: true,
      subtitleFont: 'system',
      subtitleSize: 'medium',
      subtitleColor: '#FFFFFF',
      dubbing: false,
      voiceCode: '',
      composeVideo: false,
      videoFormat: 'horizontal',
      verticalTitle: '',
      verticalSubtitle: '',
      currentStep: 3,
      furthestStep: 3,
      workspacePhase: 'configure'
    },
    agentThreadId: null,
    stages: input.stages,
    artifacts: [],
    activities: [],
    createdAt: '2026-08-28T06:00:00.000Z',
    updatedAt: '2026-08-28T06:00:00.000Z'
  };
}

function stage(input: {
  id: string;
  status: CreatorStageRun['status'];
  dispatchStatus: CreatorStageRun['dispatchStatus'];
  progress: CreatorStageRun['progress'];
}): CreatorStageRun {
  return {
    id: input.id,
    jobId: 'job_control',
    stageId: 'subtitle',
    executor: 'krillinai',
    status: input.status,
    dispatchStatus: input.dispatchStatus,
    claimOwner: input.dispatchStatus === 'claimed' ? 'scheduler_1' : null,
    claimExpiresAt: input.dispatchStatus === 'claimed'
      ? '2026-08-28T06:01:00.000Z'
      : null,
    attempt: input.status === 'queued' ? 0 : 1,
    idempotencyKey: input.id,
    progress: input.progress,
    errorCode: null,
    errorMessage: null,
    startedAt: input.status === 'queued' ? null : '2026-08-28T06:00:01.000Z',
    finishedAt: null
  };
}
