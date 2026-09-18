import type { CreatorJob } from '@opencreator/protocol';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorCollaborationPanel from './CreatorCollaborationPanel.js';
import {
  shortVideoScriptPanelAdapter,
  coverPanelAdapter,
  smartDubbingPanelAdapter,
  wechatArticlePanelAdapter,
  xiaohongshuPostPanelAdapter,
  videoDownloadPanelAdapter,
  videoGenerationPanelAdapter
} from './creator-panel-adapters.js';
import { CreatorSessionProvider, useCreatorSession } from './creator-session-store.js';

function PreflightHarness(props: { stageId: string }) {
  const session = useCreatorSession();
  useEffect(() => {
    void session.runPreflight(props.stageId).catch(() => undefined);
  }, [props.stageId, session]);
  return null;
}

describe('Short video script panel', () => {
  it('语义化并合并短视频脚本设置动态，同时显示标准 Stage 状态和真实进度', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={shortVideoScriptJob()}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={shortVideoScriptPanelAdapter}
            stepLabel="正在生成脚本"
            contextSummary="Bilibili · 60 秒"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('主题或素材、发布平台或场景、目标时长')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/currentStep/)).not.toBeInTheDocument();
    expect(screen.getByText(/系统 · 生成短视频脚本/)).toBeInTheDocument();
    expect(screen.getByText('生成脚本内容')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '生成短视频脚本进度' }))
      .toHaveAttribute('aria-valuenow', '20');
  });
});

describe('CreatorCollaborationPanel', () => {
  it('Browser/Desktop 使用同一份 preflight 结果，且不渲染 Desktop-only 修复入口', async () => {
    const preflight = {
      templateId: 'cover',
      templateVersion: 2,
      stageId: 'generate',
      executionMode: 'remote' as const,
      canStart: false,
      ready: [],
      warning: [],
      blocked: [{
        id: 'image-provider',
        title: '图像服务配置不完整',
        message: '请配置图像服务。',
        executionMode: 'remote' as const,
        repair: {
          label: '打开 AI 服务设置',
          deepLink: '#/settings?tab=ai-services&section=image'
        }
      }],
      checkedAt: '2026-09-18T00:00:00.000Z'
    };
    const service = {
      applyAction: vi.fn(),
      runAgentTurn: vi.fn(),
      preflight: vi.fn(async () => preflight)
    };
    const results: string[] = [];

    for (let platform = 0; platform < 2; platform += 1) {
      const view = render(
        <LanguageProvider initialPreference="zh-CN">
          <CreatorSessionProvider initialJob={coverJob()} service={service as never}>
            <PreflightHarness stageId="generate" />
            <CreatorCollaborationPanel
              adapter={coverPanelAdapter}
              stepLabel="正在生成封面"
              contextSummary="2 个方案"
            />
          </CreatorSessionProvider>
        </LanguageProvider>
      );
      await waitFor(() => expect(screen.getByText('请配置图像服务。')).toBeInTheDocument());
      results.push(screen.getByRole('region', { name: '启动前体检' }).textContent ?? '');
      expect(screen.queryByText(/Desktop-only|原生/)).not.toBeInTheDocument();
      view.unmount();
    }

    expect(results[0]).toBe(results[1]);
    expect(service.preflight).toHaveBeenCalledWith('cover_job', 'generate');
  });

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
    expect(screen.getByText('内容与补充要求、封面比例')).toBeInTheDocument();
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

  it('将 YouTube 封面阶段进度归一化为工作流总进度', () => {
    const current = coverJob();
    current.state.sourceType = 'youtube';
    current.state.sourceUrl = 'https://www.youtube.com/watch?v=cover-test';
    current.state.currentStage = 'analyze-source';
    current.stages[0] = {
      ...current.stages[0]!,
      id: 'cover_analysis_stage',
      stageId: 'analyze-source',
      executor: 'cover-analysis',
      progress: {
        workflow: true,
        phase: 'analyzing_source',
        percent: 45
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
            adapter={coverPanelAdapter}
            stepLabel="正在分析 YouTube 视频内容"
            contextSummary="正在处理 16%"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('16%')).toBeInTheDocument();
    expect(screen.queryByText('45%')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '分析视频内容进度' }))
      .toHaveAttribute('aria-valuenow', '16');
  });

  it('只为当前封面阶段显示工作流进度，已完成分析显示为紧凑步骤', () => {
    const current = coverJob();
    current.state.sourceType = 'youtube';
    current.state.sourceUrl = 'https://www.youtube.com/watch?v=cover-test';
    current.state.currentStage = 'generate';
    const analysis = {
      ...current.stages[0]!,
      id: 'cover_analysis_succeeded',
      stageId: 'analyze-source',
      executor: 'cover-analysis',
      status: 'succeeded' as const,
      dispatchStatus: 'finished' as const,
      claimOwner: null,
      progress: {
        workflow: true,
        phase: 'completed',
        percent: 100
      },
      startedAt: '2026-08-30T08:00:04.000Z',
      finishedAt: '2026-08-30T08:00:10.000Z'
    };
    current.stages = [
      analysis,
      {
        ...current.stages[0]!,
        id: 'cover_generate_running',
        progress: {
          workflow: true,
          workflowParentStageRunId: analysis.id,
          phase: 'generating_candidates',
          percent: 11,
          completed: 0,
          failed: 0,
          total: 2
        },
        startedAt: '2026-08-30T08:00:11.000Z'
      }
    ];
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
            adapter={coverPanelAdapter}
            stepLabel="正在生成封面方案"
            contextSummary="YouTube · 2 个方案"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('视频内容分析完成')).toBeInTheDocument();
    expect(screen.queryByText('35%')).not.toBeInTheDocument();
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.getByRole('progressbar', { name: '生成封面方案进度' }))
      .toHaveAttribute('aria-valuenow', '42');
    expect(container.querySelector('[data-status="succeeded"]'))
      .toHaveAttribute('data-compact', 'true');
  });

  it('同一阶段已有更新的成功记录时不再显示历史运行记录', () => {
    const current = coverJob();
    current.status = 'completed';
    current.state.currentStage = 'generate';
    current.stages.push({
      ...current.stages[0]!,
      id: 'cover_stage_succeeded',
      status: 'succeeded',
      dispatchStatus: 'finished',
      claimOwner: null,
      progress: {
        phase: 'completed',
        percent: 100,
        completed: 2,
        failed: 0,
        total: 2
      },
      startedAt: '2026-08-30T08:00:07.000Z',
      finishedAt: '2026-08-30T08:00:12.000Z'
    });
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
            adapter={coverPanelAdapter}
            stepLabel="查看封面方案"
            contextSummary="16:9 · 2 个方案"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('封面方案已生成')).toBeInTheDocument();
    expect(screen.queryByText('正在生成封面方案，已完成 1/2')).not.toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.creator-collaboration-stage')).toHaveLength(1);
    expect(container.querySelector('.creator-collaboration-stage'))
      .toHaveAttribute('data-status', 'succeeded');
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

  it('视频生成没有可靠百分比时显示同一阶段的不确定进度', () => {
    const current = videoGenerationJob();
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
            adapter={videoGenerationPanelAdapter}
            stepLabel="生成视频"
            contextSummary="Veo · 9:16 · 8 秒"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('视频描述、视频时长')).toBeInTheDocument();
    expect(screen.getByText('视频生成中')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '生成视频进度' }))
      .not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByText(/upstreamId|videoGenerationResultId/)).not.toBeInTheDocument();
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

  it('语义化智能配音动态并显示真实 TTS 阶段进度', () => {
    const onCancelTask = vi.fn();
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={smartDubbingJob()}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={smartDubbingPanelAdapter}
            stepLabel="正在生成配音"
            contextSummary="Nova · 温暖 · 1.05x"
            onCancelTask={onCancelTask}
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('配音文案、音色、表达风格')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/currentStep|furthestStep/)).not.toBeInTheDocument();
    expect(screen.queryByText('启动阶段 tts')).not.toBeInTheDocument();
    expect(screen.getByText(/系统 · 生成配音/)).toBeInTheDocument();
    expect(screen.getByText('生成配音音频')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '生成配音进度' }))
      .toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByRole('button', { name: '终止生成配音' })).toBeInTheDocument();
    expect(container.querySelectorAll('.creator-collaboration-stage')).toHaveLength(1);
  });

  it('语义化并合并小红书设置动态，同时显示真实生成进度', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={xiaohongshuPostJob()}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorCollaborationPanel
            adapter={xiaohongshuPostPanelAdapter}
            stepLabel="正在生成帖子"
            contextSummary="教程干货 · 精简"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('主题或素材、内容类型')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/currentStep/)).not.toBeInTheDocument();
    expect(screen.getByText(/系统 · 生成小红书帖子/)).toBeInTheDocument();
    expect(screen.getByText('生成帖子内容')).toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '生成小红书帖子进度' }))
      .toHaveAttribute('aria-valuenow', '20');
  });

  it('语义化公众号写作动态，过滤界面状态并显示标准阶段进度', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={wechatArticleJob()}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <CreatorCollaborationPanel
            adapter={wechatArticlePanelAdapter}
            stepLabel="正在生成选题"
            contextSummary="2 个内容灵感"
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getAllByText('完善了写作要求')).toHaveLength(1);
    expect(screen.getByText('写作要求、文章模板')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText(/currentStep|furthestStep/)).not.toBeInTheDocument();
    expect(screen.getByText('上传了内容灵感')).toBeInTheDocument();
    expect(screen.getByText('生成候选选题')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '生成候选选题进度' }))
      .toHaveAttribute('aria-valuenow', '55');
  });

  it('为公众号内容灵感解析阶段提供稳定文案和真实进度', () => {
    const localize = (zh: string) => zh;
    const stage = {
      stageId: 'sources',
      progress: { phase: 'reading_video', percent: 30, completed: 0, failed: 0, total: 1 }
    } as never;

    expect(wechatArticlePanelAdapter.stageLabel('sources', localize)).toBe('解析内容灵感');
    expect(wechatArticlePanelAdapter.phaseLabel('reading_video', localize)).toBe('读取视频内容');
    expect(wechatArticlePanelAdapter.readStageProgress(stage)).toEqual(expect.objectContaining({ percent: 30 }));
    expect(wechatArticlePanelAdapter.succeededProgressText?.(stage, localize)).toBe('内容灵感已解析');

    const imageStage = {
      stageId: 'images',
      progress: { phase: 'generating_article_images', percent: 68, completed: 3, failed: 0, total: 5 }
    } as never;
    expect(wechatArticlePanelAdapter.stageLabel('images', localize)).toBe('生成文章配图');
    expect(wechatArticlePanelAdapter.phaseLabel('generating_article_images', localize)).toBe('生成文章配图');
    expect(wechatArticlePanelAdapter.readStageProgress(imageStage)).toEqual(expect.objectContaining({
      percent: 68,
      completed: 3,
      total: 5
    }));
    expect(wechatArticlePanelAdapter.succeededProgressText?.(imageStage, localize)).toBe('文章配图已生成');

    expect(wechatArticlePanelAdapter.normalizeActivity({
      id: 'outline-update',
      jobId: 'wechat-job',
      revision: 1,
      actor: 'user',
      action: 'update-settings:draft',
      summary: '更新创作设置',
      details: { objectId: 'outline' },
      createdAt: '2026-09-07T09:00:00.000Z'
    }, localize)).toEqual({ label: '生成了文章大纲', fields: [] });
    expect(wechatArticlePanelAdapter.normalizeActivity({
      id: 'image-update',
      jobId: 'wechat-job',
      revision: 2,
      actor: 'user',
      action: 'update-settings:draft',
      summary: '更新创作设置',
      details: { objectId: 'articleImageStyleId,articleImageCount' },
      createdAt: '2026-09-07T09:00:01.000Z'
    }, localize)).toEqual({
      label: '调整了文章配图',
      fields: ['生图风格', '配图数量']
    });
  });
});

function wechatArticleJob(): CreatorJob {
  const jobId = 'wechat_article_job';
  return {
    id: jobId,
    projectId: 'project_1',
    templateId: 'wechat-article',
    templateVersion: 1,
    status: 'running',
    revision: 5,
    state: { currentStage: 'topics' },
    agentThreadId: null,
    stages: [{
      id: 'wechat_topics_stage',
      jobId,
      stageId: 'topics',
      executor: 'wechat-article',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'wechat-topics-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: { phase: 'generating_topics', percent: 55, completed: 2, failed: 0, total: 2 },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-07T09:00:05.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      { id: 'ui', jobId, revision: 1, actor: 'user', action: 'update-settings:draft', summary: '更新创作设置', details: { objectId: 'currentStep,furthestStep' }, createdAt: '2026-09-07T09:00:01.000Z' },
      { id: 'brief', jobId, revision: 2, actor: 'user', action: 'update-settings:draft', summary: '更新创作设置', details: { objectId: 'writingPrompt' }, createdAt: '2026-09-07T09:00:02.000Z' },
      { id: 'template', jobId, revision: 3, actor: 'user', action: 'update-settings:draft', summary: '更新创作设置', details: { objectId: 'presetId' }, createdAt: '2026-09-07T09:00:03.000Z' },
      { id: 'upload', jobId, revision: 4, actor: 'user', action: 'register-source-document', summary: '上传写作来源', details: { objectId: 'source.pdf' }, createdAt: '2026-09-07T09:00:04.000Z' },
      { id: 'run', jobId, revision: 5, actor: 'user', action: 'run-stage', summary: '启动阶段 topics', details: { stageId: 'topics' }, createdAt: '2026-09-07T09:00:05.000Z' }
    ],
    createdAt: '2026-09-07T09:00:00.000Z',
    updatedAt: '2026-09-07T09:00:05.000Z'
  };
}

function shortVideoScriptJob(): CreatorJob {
  const createdAt = '2026-09-08T09:00:00.000Z';
  return {
    id: 'short_video_script_job',
    projectId: 'project_1',
    templateId: 'short-video-script',
    templateVersion: 1,
    status: 'running',
    revision: 4,
    state: {
      topic: '第一次参与开源项目',
      audience: '准备贡献代码的开发者',
      platform: 'bilibili',
      targetDurationSeconds: 60,
      tone: 'professional',
      extraRequirements: '',
      currentStage: 'generate'
    },
    agentThreadId: null,
    stages: [{
      id: 'short_video_script_stage',
      jobId: 'short_video_script_job',
      stageId: 'generate',
      executor: 'short-video-script',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'short-video-script-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'generating_script',
        percent: 20,
        completed: 0,
        failed: 0,
        total: 1
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-08T09:00:03.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      {
        id: 'activity_script_1',
        jobId: 'short_video_script_job',
        revision: 1,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'topic,platform,targetDurationSeconds' },
        createdAt: '2026-09-08T09:00:01.000Z'
      },
      {
        id: 'activity_script_2',
        jobId: 'short_video_script_job',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'topic,platform,targetDurationSeconds' },
        createdAt: '2026-09-08T09:00:02.000Z'
      },
      {
        id: 'activity_script_ui',
        jobId: 'short_video_script_job',
        revision: 3,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'currentStep' },
        createdAt: '2026-09-08T09:00:02.500Z'
      }
    ],
    createdAt,
    updatedAt: '2026-09-08T09:00:03.000Z'
  };
}

function xiaohongshuPostJob(): CreatorJob {
  const createdAt = '2026-09-08T08:00:00.000Z';
  return {
    id: 'xiaohongshu_job',
    projectId: 'project_1',
    templateId: 'xiaohongshu-post',
    templateVersion: 1,
    status: 'running',
    revision: 4,
    state: {
      topic: '第一次参与开源项目',
      audience: '准备参与开源项目的程序员',
      style: 'tutorial',
      length: 'short',
      extraRequirements: '',
      currentStage: 'generate'
    },
    agentThreadId: null,
    stages: [{
      id: 'xiaohongshu_stage',
      jobId: 'xiaohongshu_job',
      stageId: 'generate',
      executor: 'xiaohongshu-post',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'xiaohongshu-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'generating_post',
        percent: 20,
        completed: 0,
        failed: 0,
        total: 1
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-08T08:00:03.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      {
        id: 'activity_topic_1',
        jobId: 'xiaohongshu_job',
        revision: 1,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'topic,style' },
        createdAt: '2026-09-08T08:00:01.000Z'
      },
      {
        id: 'activity_topic_2',
        jobId: 'xiaohongshu_job',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'topic,style' },
        createdAt: '2026-09-08T08:00:02.000Z'
      },
      {
        id: 'activity_ui',
        jobId: 'xiaohongshu_job',
        revision: 3,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'currentStep' },
        createdAt: '2026-09-08T08:00:02.500Z'
      }
    ],
    createdAt,
    updatedAt: '2026-09-08T08:00:03.000Z'
  };
}

function smartDubbingJob(): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'smart_dubbing_job',
    projectId: 'project_1',
    templateId: 'smart-dubbing',
    templateVersion: 1,
    status: 'running',
    revision: 4,
    state: {
      text: '这是一段智能配音文案。',
      ttsProvider: 'openai',
      ttsModel: 'gpt-4o-mini-tts',
      voiceCode: 'nova',
      voiceName: 'Nova',
      style: 'warm',
      speed: 1.05,
      format: 'mp3',
      currentStage: 'tts'
    },
    agentThreadId: null,
    stages: [{
      id: 'smart_dubbing_stage',
      jobId: 'smart_dubbing_job',
      stageId: 'tts',
      executor: 'smart-dubbing',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'smart-dubbing-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'generating_voice',
        percent: 20,
        completed: 0,
        failed: 0,
        total: 1
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-07T08:00:03.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      {
        id: 'activity_ui',
        jobId: 'smart_dubbing_job',
        revision: 1,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'currentStep,furthestStep' },
        createdAt: '2026-09-07T08:00:01.000Z'
      },
      {
        id: 'activity_text',
        jobId: 'smart_dubbing_job',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'text' },
        createdAt: '2026-09-07T08:00:02.000Z'
      },
      {
        id: 'activity_voice',
        jobId: 'smart_dubbing_job',
        revision: 3,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'voiceCode,style' },
        createdAt: '2026-09-07T08:00:03.000Z'
      },
      {
        id: 'activity_run',
        jobId: 'smart_dubbing_job',
        revision: 4,
        actor: 'user',
        action: 'run-stage',
        summary: '启动阶段 tts',
        details: { stageId: 'tts' },
        createdAt: '2026-09-07T08:00:04.000Z'
      }
    ],
    createdAt,
    updatedAt: '2026-09-07T08:00:04.000Z'
  };
}

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
    artifacts: [],
    providerRequests: [],
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

function videoGenerationJob(): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'video_generation_job',
    projectId: 'project_1',
    templateId: 'video-generation',
    templateVersion: 1,
    status: 'running',
    revision: 3,
    state: {
      prompt: '雨夜中的赛博朋克街道',
      provider: 'veo',
      size: '720x1280',
      duration: 8,
      referenceImageArtifactId: null,
      currentStage: 'generate'
    },
    agentThreadId: null,
    stages: [{
      id: 'video_generation_stage',
      jobId: 'video_generation_job',
      stageId: 'generate',
      executor: 'video',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'video-generation-1',
      scopeKey: null,
      inputFingerprint: null,
      progress: {
        phase: 'generating',
        message: 'The video provider is generating the video',
        videoGenerationResultId: 'video_result_1'
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-07T08:00:03.000Z',
      finishedAt: null
    }],
    artifacts: [],
    providerRequests: [],
    activities: [
      {
        id: 'video_generation_ui',
        jobId: 'video_generation_job',
        revision: 1,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'currentStep,furthestStep' },
        createdAt: '2026-09-07T08:00:01.000Z'
      },
      {
        id: 'video_generation_settings',
        jobId: 'video_generation_job',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '更新创作设置',
        details: { objectId: 'prompt,duration' },
        createdAt: '2026-09-07T08:00:02.000Z'
      },
      {
        id: 'video_generation_run',
        jobId: 'video_generation_job',
        revision: 3,
        actor: 'user',
        action: 'run-stage',
        summary: '启动阶段 generate',
        details: { stageId: 'generate' },
        createdAt: '2026-09-07T08:00:03.000Z'
      }
    ],
    createdAt,
    updatedAt: '2026-09-07T08:00:04.000Z'
  };
}
