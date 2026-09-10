import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  createDefaultCreatorServicesConfig,
  type CreatorArtifact,
  type CreatorJob,
  type CreatorStageRun
} from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import StickmanVideoWorkspace from './StickmanVideoWorkspace.js';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:stickman-artifact')
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
});

describe('StickmanVideoWorkspace', () => {
  it('supports text input with fixed characters, a style selector, and a scrollable tool stack', async () => {
    const initialJob = job({
      state: {
        sourceType: 'text',
        sourceText: '用火柴人解释为什么要做最小充分验证',
        characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
        styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 }
      }
    });
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: initialJob,
      receipt: {
        actor: 'user',
        action: request.action,
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: initialJob.revision,
        createdAt: initialJob.updatedAt
      }
    }));
    const { container } = renderWorkspace(initialJob, new Map(), applyAction, configuredTtsService());

    expect(screen.getByRole('textbox', { name: '文本内容' })).toHaveValue('用火柴人解释为什么要做最小充分验证');
    expect(screen.queryByLabelText('角色描述')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('combobox', { name: '视觉风格' }))
      .toHaveValue('stickman.style.minimal-ink@1'));
    expect(screen.getByRole('combobox', { name: '目标时长' })).toHaveValue('30');
    expect(await screen.findByRole('combobox', { name: '配音音色' })).toBeInTheDocument();
    expect(within(screen.getByRole('radiogroup', { name: '角色预设' })).getAllByRole('radio')).toHaveLength(10);
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    expect(container.querySelector('.creator-tool-stack.stickman-tool-stack')).not.toBeNull();
    expect(screen.getByRole('button', { name: '开始生成' })).toHaveClass('video-translation-primary-action');

    const steps = screen.getByRole('navigation', { name: '火柴人视频制作步骤' });
    expect(steps).toHaveClass('video-translation-steps', 'stickman-steps');
    expect(within(steps).getByRole('button', { name: /来源与角色/ })).toHaveAttribute('aria-current', 'step');
    expect(within(steps).getByRole('button', { name: /脚本审核/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      initialJob.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'ingest-text' }
      })
    ));
  });

  it('supports duration presets and a bounded custom duration', () => {
    renderWorkspace(job());

    const duration = screen.getByRole('combobox', { name: '目标时长' });
    fireEvent.change(duration, { target: { value: '300' } });
    expect(duration).toHaveValue('300');
    expect(screen.queryByRole('spinbutton', { name: '自定义时长（秒）' })).not.toBeInTheDocument();

    fireEvent.change(duration, { target: { value: 'custom' } });
    const custom = screen.getByRole('spinbutton', { name: '自定义时长（秒）' });
    expect(custom).toHaveValue(90);
    fireEvent.change(custom, { target: { value: '125' } });
    expect(custom).toHaveValue(125);
  });

  it('inherits the shared TTS configuration and persists the selected voice fields', async () => {
    const initialJob = job();
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: initialJob,
      receipt: {
        actor: 'user',
        action: request.action,
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: initialJob.revision,
        createdAt: initialJob.updatedAt
      }
    }));
    const config = createDefaultCreatorServicesConfig();
    const creatorServicesService = {
      getConfig: vi.fn(async () => ({ config, configuredCredentials: ['tts.openai.apiKey'] })),
      getTtsVoices: vi.fn(async () => ({
        provider: 'openai' as const,
        model: config.tts.openai.model,
        voices: [
          { id: 'marin', name: 'Marin', provider: 'openai' as const, kind: 'builtin' as const },
          { id: 'nova', name: 'Nova', provider: 'openai' as const, kind: 'builtin' as const }
        ]
      })),
      previewTtsVoice: vi.fn()
    };
    renderWorkspace(initialJob, new Map(), applyAction, creatorServicesService as never);

    const voice = await screen.findByRole('combobox', { name: '配音音色' });
    await waitFor(() => expect(voice).toHaveValue('marin'));
    fireEvent.change(voice, { target: { value: 'nova' } });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));

    await waitFor(() => {
      const persisted = Object.assign({}, ...applyAction.mock.calls.flatMap(([, request]) => {
        if (request.action !== 'update-settings') return [];
        const input = request.input as { patch?: Record<string, unknown> };
        return input.patch === undefined ? [] : [input.patch];
      }));
      expect(persisted).toMatchObject({
        ttsProvider: 'openai',
        ttsModel: config.tts.openai.model,
        voiceCode: 'nova',
        voiceName: 'Nova'
      });
    });
  });

  it('prompts for TTS configuration instead of showing a default voice without credentials', async () => {
    const config = createDefaultCreatorServicesConfig();
    const creatorServicesService = {
      getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })),
      getTtsVoices: vi.fn(),
      previewTtsVoice: vi.fn()
    };

    renderWorkspace(job(), new Map(), undefined, creatorServicesService as never);

    expect(await screen.findByText('尚未配置配音服务')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '配音音色' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往配音服务配置' }))
      .toHaveAttribute('href', '#/settings?tab=ai-services&section=tts');
    expect(screen.getByRole('button', { name: '开始生成' })).toBeDisabled();
    expect(creatorServicesService.getTtsVoices).not.toHaveBeenCalled();
  });

  it('passes a YouTube URL directly to the KrillinAI transcript stage', async () => {
    const initialJob = job();
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: initialJob,
      receipt: {
        actor: 'user',
        action: request.action,
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: initialJob.revision,
        createdAt: initialJob.updatedAt
      }
    }));
    renderWorkspace(initialJob, new Map(), applyAction, configuredTtsService());

    expect(screen.getByRole('textbox', { name: 'YouTube 链接' })).toBeInTheDocument();
    await screen.findByRole('combobox', { name: '配音音色' });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      initialJob.id,
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'source-transcript' }
      })
    ));
  });

  it('does not show ready results before persisted artifacts arrive', () => {
    renderWorkspace(job({ status: 'running', stages: [stage('source-transcript', 'running')] }));

    expect(document.querySelectorAll('.creator-collaboration-panel')).toHaveLength(1);
    expect(screen.queryByText('固定五项交付')).not.toBeInTheDocument();
    expect(screen.queryByText('项目 V1')).not.toBeInTheDocument();
    expect(screen.getAllByText('执行中').length).toBeGreaterThan(0);
  });

  it('moves to a stable script editor skeleton while the script is being generated', () => {
    const { container } = renderWorkspace(job({
      status: 'running',
      stages: [stage('script', 'running')],
      state: { currentStage: 'script' }
    }));

    const steps = screen.getByRole('navigation', { name: '火柴人视频制作步骤' });
    expect(within(steps).getByRole('button', { name: /脚本审核/ })).toHaveAttribute('aria-current', 'step');
    expect(container.querySelector('.stickman-script-placeholder')).toHaveAttribute('data-state', 'loading');
    expect(container.querySelector('.stickman-script-skeleton-editor')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.stickman-script-skeleton-row')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveTextContent('正在生成');
    expect(screen.getByRole('button', { name: '上一步' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    expect(screen.queryByText('脚本正在生成或等待执行')).not.toBeInTheDocument();
  });

  it('shows a local retry action when script generation fails', async () => {
    const failedStage = {
      ...stage('script', 'failed'),
      errorCode: 'creator_stage_failed',
      errorMessage: '脚本服务暂时不可用'
    };
    const failedJob = job({
      status: 'failed',
      stages: [failedStage],
      state: { currentStage: 'script' }
    });
    const applyAction = vi.fn(async () => ({
      job: failedJob,
      receipt: {
        actor: 'user' as const,
        action: 'retry-stage',
        summary: 'retry-stage',
        affectedArtifacts: [],
        newRevision: failedJob.revision,
        createdAt: failedJob.updatedAt
      }
    }));
    const { container } = renderWorkspace(failedJob, new Map(), applyAction);

    const error = container.querySelector('.stickman-script-placeholder-error');
    expect(error).not.toBeNull();
    expect(within(error as HTMLElement).getByText('脚本服务暂时不可用')).toBeInTheDocument();
    fireEvent.click(within(error as HTMLElement).getByRole('button', { name: '重新生成' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      failedJob.id,
      expect.objectContaining({ action: 'retry-stage', input: { stageId: 'script' } })
    ));
  });

  it('shows regeneration progress and prevents advancing with the previous script', async () => {
    const persisted = scriptReviewJob();
    const runningJob: CreatorJob = {
      ...persisted.job,
      status: 'running',
      revision: persisted.job.revision + 1,
      stages: [
        {
          ...stage('ingest-text', 'succeeded'),
          progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
        },
        {
          ...stage('source-brief', 'succeeded'),
          progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
        },
        {
          ...stage('content-plan', 'succeeded'),
          progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
        },
        {
          ...stage('script', 'running'),
          progress: {
            phase: 'writing',
            percent: 15,
            completed: 0,
            failed: 0,
            total: 1
          }
        }
      ],
      state: { ...persisted.job.state, currentStage: 'script', needsInput: null }
    };
    const applyAction = vi.fn(async () => ({
      job: runningJob,
      receipt: {
        actor: 'user' as const,
        action: 'run-stage',
        summary: 'run-stage',
        affectedArtifacts: [],
        newRevision: runningJob.revision,
        createdAt: runningJob.updatedAt
      }
    }));
    renderWorkspace(persisted.job, persisted.contents, applyAction, configuredTtsService());

    await screen.findByRole('textbox', { name: '第 1 段旁白' });
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));

    expect(await screen.findByRole('button', { name: '重新生成中...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: '生成脚本进度' }))
      .toHaveAttribute('aria-valuenow', '79');
    expect(document.querySelectorAll('.creator-collaboration-stage')).toHaveLength(1);
    expect(screen.getByText('生成创作内容')).toBeInTheDocument();
    expect(screen.queryByText(/镜头完成/)).not.toBeInTheDocument();
  });

  it('opens script review automatically when a regenerated script requests approval', async () => {
    const persisted = scriptReviewJob();
    const regeneratedArtifact = { ...artifact('script-regenerated', 'script_manifest'), version: 2 };
    const regeneratedValue: ScriptManifestFixture = {
      ...persisted.value,
      title: '重新生成的脚本',
      segments: [{
        ...persisted.value.segments[0]!,
        narration: '重新生成后忠实解释核心概念'
      }]
    };
    const regeneratedJob: CreatorJob = {
      ...persisted.job,
      revision: persisted.job.revision + 1,
      artifacts: [{ ...persisted.artifact, status: 'stale' }, regeneratedArtifact],
      state: {
        ...persisted.job.state,
        currentStage: 'script',
        needsInput: {
          code: 'creator_review_required',
          kind: 'approve-script',
          message: '请审核脚本后继续',
          artifactId: regeneratedArtifact.id
        }
      }
    };
    const applyAction = vi.fn(async () => ({
      job: regeneratedJob,
      receipt: {
        actor: 'user' as const,
        action: 'run-stage',
        summary: 'run-stage',
        affectedArtifacts: [],
        newRevision: regeneratedJob.revision,
        createdAt: regeneratedJob.updatedAt
      }
    }));
    const contents = new Map(persisted.contents);
    contents.set(regeneratedArtifact.id, regeneratedValue);
    renderWorkspace(persisted.job, contents, applyAction, configuredTtsService());

    await screen.findByRole('textbox', { name: '第 1 段旁白' });
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));

    await waitFor(() => expect(screen.getByRole('textbox', { name: '脚本标题' }))
      .toHaveValue('重新生成的脚本'));
    expect(screen.getByRole('textbox', { name: '第 1 段旁白' }))
      .toHaveValue('重新生成后忠实解释核心概念');
    expect(within(screen.getByRole('navigation', { name: '火柴人视频制作步骤' }))
      .getByRole('button', { name: /脚本审核/ })).toHaveAttribute('aria-current', 'step');
  });

  it('asks to regenerate an outdated script instead of rendering empty descriptions', async () => {
    const persisted = scriptReviewJob();
    const legacyValue = {
      ...persisted.value,
      contract: 'stickman-shot-script-v1',
      segments: persisted.value.segments.map(segment => ({
        ...segment,
        visualIntent: '旧画面意图',
        imagePrompt: '旧生图描述',
        timingReview: 'short'
      }))
    };
    renderWorkspace(
      persisted.job,
      new Map<string, unknown>([[persisted.artifact.id, legacyValue]])
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '当前脚本结构已更新，请返回来源与角色重新生成'
    );
    expect(screen.queryByRole('textbox', { name: '第 1 段画面描述' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  it('renders a full-width inline script editor and keeps draft changes when going back', async () => {
    const persisted = scriptReviewJob();
    const { container } = renderWorkspace(persisted.job, persisted.contents);

    const title = await screen.findByRole('textbox', { name: '脚本标题' });
    const narration = screen.getByRole('textbox', { name: '第 1 段旁白' });
    expect(title).toHaveValue('测试脚本');
    expect(narration).toHaveValue('解释核心概念');
    expect(screen.queryByRole('textbox', { name: '第 1 段画面描述' })).not.toBeInTheDocument();
    expect(container.querySelector('.stickman-step-scroll')).toHaveAttribute('data-step', '1');
    expect(container.querySelector('.stickman-script-row .stickman-script-fields')).not.toBeNull();
    expect(container.querySelector('.stickman-script-panel > .stickman-script-editor')).not.toBeNull();
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑脚本' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '审核通过' })).not.toBeInTheDocument();

    const scriptScroll = container.querySelector<HTMLElement>('.stickman-step-scroll');
    expect(scriptScroll).not.toBeNull();
    scriptScroll!.scrollTop = 240;
    fireEvent.change(narration, { target: { value: '直接修改后的旁白' } });
    expect(screen.getByText('有未保存修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    const sourceScroll = container.querySelector<HTMLElement>('.stickman-step-scroll');
    expect(sourceScroll).not.toBe(scriptScroll);
    expect(sourceScroll?.scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('textbox', { name: '第 1 段旁白' })).toHaveValue('直接修改后的旁白');
  });

  it('saves an edited script before advancing with the new artifact and revision', async () => {
    const persisted = scriptReviewJob();
    const editedArtifact = { ...artifact('script-edited', 'script_manifest'), version: 2 };
    const editedValue = {
      ...persisted.value,
      segments: [{ ...persisted.value.segments[0]!, narration: '修改后继续下一步' }]
    };
    const editedJob: CreatorJob = {
      ...persisted.job,
      revision: 8,
      artifacts: [
        { ...persisted.artifact, status: 'stale' },
        editedArtifact
      ],
      state: {
        ...persisted.job.state,
        needsInput: {
          code: 'creator_review_required',
          kind: 'approve-script',
          artifactId: editedArtifact.id
        }
      }
    };
    const approvedJob: CreatorJob = {
      ...editedJob,
      revision: 9,
      status: 'running',
      state: {
        ...editedJob.state,
        currentStage: 'narration',
        workflowTarget: 'audio_ready',
        approvedScriptArtifactId: editedArtifact.id,
        needsInput: null
      }
    };
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: request.action === 'edit-script' ? editedJob : approvedJob,
      receipt: {
        actor: 'user' as const,
        action: String(request.action),
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: request.action === 'edit-script' ? 8 : 9,
        createdAt: persisted.job.updatedAt
      }
    }));
    const contents = new Map(persisted.contents);
    contents.set(editedArtifact.id, editedValue);
    renderWorkspace(persisted.job, contents, applyAction);

    const narration = await screen.findByRole('textbox', { name: '第 1 段旁白' });
    fireEvent.change(narration, { target: { value: '修改后继续下一步' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1));
    expect(applyAction.mock.calls[0]?.[1]).toMatchObject({
      action: 'edit-script',
      expectedRevision: 7,
      input: { artifactId: persisted.artifact.id }
    });
    const savedContent = JSON.parse(String((applyAction.mock.calls[0]?.[1].input as Record<string, unknown>).content));
    expect(savedContent.segments[0].narration).toBe('修改后继续下一步');
    expect(screen.getByText(/请检查修改后的最终脚本/)).toBeInTheDocument();
  });

  it('advances with the current script without creating a redundant edit', async () => {
    const persisted = scriptReviewJob();
    const applyAction = vi.fn(async (_jobId?: string, _request?: Record<string, unknown>) => ({
      job: {
        ...persisted.job,
        revision: 8,
        status: 'running' as const,
        state: {
          ...persisted.job.state,
          currentStage: 'narration',
          workflowTarget: 'audio_ready',
          approvedScriptArtifactId: persisted.artifact.id,
          needsInput: null
        }
      },
      receipt: {
        actor: 'user' as const,
        action: 'approve-script',
        summary: 'approve-script',
        affectedArtifacts: [],
        newRevision: 8,
        createdAt: persisted.job.updatedAt
      }
    }));
    renderWorkspace(persisted.job, persisted.contents, applyAction);

    await screen.findByRole('textbox', { name: '脚本标题' });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1));
    expect(applyAction.mock.calls[0]?.[1]).toMatchObject({
      action: 'approve-script',
      expectedRevision: 7,
      input: { artifactId: persisted.artifact.id, revision: 7 }
    });
    expect(screen.getByRole('heading', { name: '配音与节奏' })).toBeInTheDocument();
  });

  it('shows playable narration timing and only starts visuals after the next action', async () => {
    const persisted = audioReadyJob();
    const continuedJob: CreatorJob = {
      ...persisted.job,
      revision: persisted.job.revision + 1,
      state: {
        ...persisted.job.state,
        workflowTarget: 'visuals_ready',
        currentStage: 'storyboard'
      }
    };
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: continuedJob,
      receipt: {
        actor: 'user' as const,
        action: String(request.action),
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: continuedJob.revision,
        createdAt: continuedJob.updatedAt
      }
    }));
    const { container } = renderWorkspace(persisted.job, persisted.contents, applyAction);

    expect(await screen.findByRole('heading', { name: '配音与节奏' })).toBeInTheDocument();
    expect(screen.getByText('1 段旁白 · 实际 5s · 目标 5s')).toBeInTheDocument();
    expect(container.querySelector('.stickman-audio-control audio'))
      .toHaveAttribute('src', 'blob:stickman-artifact');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'continue-after-audio',
        input: { artifactId: 'audio-timing', revision: persisted.job.revision }
      })
    ));
    expect(within(screen.getByRole('navigation', { name: '火柴人视频制作步骤' }))
      .getByRole('button', { name: /分镜与画面/ })).toHaveAttribute('aria-current', 'step');
    const placeholder = container.querySelector('.stickman-storyboard-placeholder');
    expect(placeholder).not.toBeNull();
    expect(within(placeholder as HTMLElement).getByText('正在规划 1 个镜头的画面描述'))
      .toBeInTheDocument();
    expect(within(placeholder as HTMLElement).getAllByText('解释核心概念')).toHaveLength(1);
    expect(placeholder?.querySelectorAll('.stickman-storyboard-loading-row')).toHaveLength(1);
    expect(placeholder?.querySelectorAll('.stickman-storyboard-placeholder-image')).toHaveLength(1);
    expect(placeholder?.querySelectorAll('.stickman-storyboard-description-skeleton')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '上一步' })).toBeVisible();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  it('retries only audio timing after a measurement failure without discarding narration', async () => {
    const persisted = audioReadyJob();
    const failedTiming = stage('audio-timing', 'failed');
    const failedJob: CreatorJob = {
      ...persisted.job,
      status: 'failed',
      stages: [
        ...persisted.job.stages.filter(item => item.stageId !== 'audio-timing'),
        failedTiming
      ],
      artifacts: persisted.job.artifacts.filter(artifact => artifact.kind !== 'audio_timing'),
      state: {
        ...persisted.job.state,
        workflowTarget: 'audio_ready',
        currentStage: 'audio-timing'
      }
    };
    const contents = new Map(persisted.contents);
    contents.delete('audio-timing');
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: failedJob,
      receipt: {
        actor: 'user' as const,
        action: String(request.action),
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: failedJob.revision,
        createdAt: failedJob.updatedAt
      }
    }));
    renderWorkspace(failedJob, contents, applyAction);

    expect(await screen.findByRole('heading', { name: '配音与节奏' })).toBeInTheDocument();
    expect(screen.getByText('解释核心概念')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新测量时长' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      failedJob.id,
      expect.objectContaining({
        action: 'retry-stage',
        input: { stageId: 'audio-timing' }
      })
    ));
  });

  it('renders storyboard and result versions from persisted artifact content after mount', async () => {
    const persisted = completedJob();
    const { container } = renderWorkspace(persisted.job, persisted.contents);

    const steps = screen.getByRole('navigation', { name: '火柴人视频制作步骤' });
    expect(within(steps).getByRole('button', { name: /来源与角色/ }).closest('li')).toHaveAttribute('data-completed', 'true');
    expect(within(steps).getByRole('button', { name: /成片交付/ })).toHaveAttribute('aria-current', 'step');

    fireEvent.click(screen.getByRole('button', { name: /分镜与画面/ }));
    expect(await screen.findByText('白底黑线火柴人讲解核心概念')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /成片交付/ }));
    expect(await screen.findByRole('heading', { name: '成片交付' })).toBeInTheDocument();
    expect(screen.getByText('项目 V1')).toBeInTheDocument();
    const delivery = container.querySelector('.stickman-delivery-content');
    expect(delivery).not.toBeNull();
    expect(within(delivery as HTMLElement).getByText('火柴人动画')).toBeInTheDocument();
    expect(within(delivery as HTMLElement).getByText('旁白字幕')).toBeInTheDocument();
    expect(screen.queryByLabelText('任务摘要')).not.toBeInTheDocument();
    expect(container.querySelector('.stickman-delivery-step > footer')).not.toBeNull();
    expect(screen.getByRole('button', { name: '上一步' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument();
  });

  it('scrolls only storyboard content and keeps back and next actions visible', async () => {
    const persisted = completedJob({ withSnapshot: false });
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: persisted.job,
      receipt: {
        actor: 'user' as const,
        action: String(request.action),
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: persisted.job.revision,
        createdAt: persisted.job.updatedAt
      }
    }));
    const { container } = renderWorkspace(persisted.job, persisted.contents, applyAction);

    expect(await screen.findByText('白底黑线火柴人讲解核心概念')).toBeInTheDocument();
    expect(container.querySelector('.stickman-step-scroll')).toHaveAttribute('data-step', '3');
    expect(container.querySelector('.stickman-storyboard-review > .stickman-storyboard-editor')).not.toBeNull();
    expect(container.querySelector('.stickman-storyboard-step > .stickman-storyboard-step-actions')).not.toBeNull();
    expect(screen.getByRole('button', { name: '上一步' })).toBeVisible();
    expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    expect(screen.queryByText('审核分镜并生成画面')).not.toBeInTheDocument();
    expect(screen.queryByText('确认画面并继续成片')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('heading', { name: '动画合成' })).toBeInTheDocument();
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'continue-after-visuals',
        input: { artifactId: 'validation', revision: persisted.job.revision }
      })
    ));
  });

  it('continues all missing visuals with one action and keeps waiting shots passive', async () => {
    const persisted = partialStoryboardJob('idle');
    let releaseAction!: () => void;
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => {
      await new Promise<void>(resolve => {
        releaseAction = resolve;
      });
      return {
        job: persisted.job,
        receipt: {
          actor: 'user' as const,
          action: String(request.action),
          summary: String(request.action),
          affectedArtifacts: [],
          newRevision: persisted.job.revision,
          createdAt: persisted.job.updatedAt
        }
      };
    });
    renderWorkspace(persisted.job, persisted.contents, applyAction);

    const batch = await screen.findByRole('button', { name: '继续生成剩余 2 个' });
    const waitingRow = screen.getByRole('textbox', { name: '第 3 个镜头画面描述' })
      .closest('.stickman-storyboard-row') as HTMLElement;
    expect(within(waitingRow).getByText('等待生成')).toBeInTheDocument();
    expect(within(waitingRow).queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument();

    fireEvent.click(batch);

    expect(screen.getByRole('button', { name: '正在准备续跑...' })).toBeDisabled();
    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1));
    expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'generate-missing-shots',
        expectedRevision: persisted.job.revision,
        input: { revision: persisted.job.revision }
      })
    );
    await act(async () => releaseAction());
  });

  it('summarizes failed and active visual generation in the fixed action bar', async () => {
    const failed = partialStoryboardJob('failed');
    const rendered = renderWorkspace(failed.job, failed.contents);

    expect(await screen.findByRole('button', { name: '重试失败并继续（1 个失败）' })).toBeEnabled();
    const failedRow = screen.getByRole('textbox', { name: '第 2 个镜头画面描述' })
      .closest('.stickman-storyboard-row') as HTMLElement;
    expect(within(failedRow).getByRole('button', { name: '单独重试' })).toBeEnabled();

    rendered.unmount();
    const running = partialStoryboardJob('running');
    renderWorkspace(running.job, running.contents);

    expect(await screen.findByRole('button', { name: '正在生成 1/3' })).toBeDisabled();
  });

  it('shows distinct actions while visual validation is failed, running, and completed', async () => {
    const persisted = completedJob({ withSnapshot: false });
    const withoutValidation = persisted.job.artifacts.filter(artifact => (
      artifact.kind !== 'visual_validation'
    ));
    const failedJob: CreatorJob = {
      ...persisted.job,
      status: 'failed',
      artifacts: withoutValidation,
      stages: persisted.job.stages.map(current => current.stageId === 'visual-validation'
        ? {
            ...current,
            status: 'failed',
            errorCode: 'creator_shot_image_ambiguous',
            errorMessage: 'Shot shot-03 requires exactly one current image'
          }
        : current)
    };
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: { ...failedJob, status: 'running' as const, revision: failedJob.revision + 1 },
      receipt: {
        actor: 'user' as const,
        action: String(request.action),
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: failedJob.revision + 1,
        createdAt: failedJob.updatedAt
      }
    }));
    const failed = renderWorkspace(failedJob, persisted.contents, applyAction);

    fireEvent.click(await screen.findByRole('button', { name: '重新检查画面' }));
    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1));
    expect(applyAction).toHaveBeenCalledWith(
      failedJob.id,
      expect.objectContaining({ action: 'generate-missing-shots' })
    );

    failed.unmount();
    const runningJob: CreatorJob = {
      ...failedJob,
      status: 'running',
      stages: failedJob.stages.map(current => current.stageId === 'visual-validation'
        ? { ...current, status: 'running', errorCode: null, errorMessage: null }
        : current)
    };
    const running = renderWorkspace(runningJob, persisted.contents);
    expect(await screen.findByRole('button', { name: '正在检查画面...' })).toBeDisabled();

    running.unmount();
    renderWorkspace(persisted.job, persisted.contents);
    await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled());
  });

  it('restores an in-progress render to the animation step without opening delivery', async () => {
    const persisted = completedJob({ withSnapshot: false });
    const renderingJob: CreatorJob = {
      ...persisted.job,
      stages: [
        ...persisted.job.stages,
        stage('timeline', 'succeeded'),
        stage('render-clean', 'running')
      ],
      state: {
        ...persisted.job.state,
        workflowTarget: 'delivery_ready',
        currentStage: 'render-clean'
      }
    };
    const { container } = renderWorkspace(renderingJob, persisted.contents);

    expect(await screen.findByRole('heading', { name: '动画合成' })).toBeInTheDocument();
    expect(container.querySelector('.stickman-step-scroll')).toHaveAttribute('data-step', '4');
    expect(container.querySelector('.stickman-composition-content')).not.toBeNull();
    expect(container.querySelector('.stickman-composition-step > footer')).not.toBeNull();
    expect(container.querySelector('.stickman-composition-step video')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看成片' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '成片交付' })).not.toBeInTheDocument();
  });

  it('opens the single delivery result when composition produces a snapshot', async () => {
    const rendering = completedJob({ withSnapshot: false });
    const completed = completedJob();
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: completed.job,
      receipt: {
        actor: 'user' as const,
        action: String(request.action),
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: completed.job.revision,
        createdAt: completed.job.updatedAt
      }
    }));
    const { container } = renderWorkspace(rendering.job, rendering.contents, applyAction);

    expect(await screen.findByText('白底黑线火柴人讲解核心概念')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    expect(await screen.findByRole('heading', { name: '成片交付' })).toBeInTheDocument();
    expect(container.querySelector('.stickman-delivery-preview video')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(await screen.findByRole('heading', { name: '动画合成' })).toBeInTheDocument();
    expect(container.querySelector('.stickman-composition-step video')).toBeNull();
    expect(screen.queryByRole('heading', { name: '成片交付' })).not.toBeInTheDocument();
  });

  it('edits visual descriptions and motion directly in each storyboard row', async () => {
    const persisted = completedJob({ withSnapshot: false });
    const applyAction = vi.fn(async (_jobId: string, request: Record<string, unknown>) => ({
      job: { ...persisted.job, revision: persisted.job.revision + 1 },
      receipt: {
        actor: 'user',
        action: request.action,
        summary: String(request.action),
        affectedArtifacts: [],
        newRevision: persisted.job.revision + 1,
        createdAt: persisted.job.updatedAt
      }
    }));
    renderWorkspace(persisted.job, persisted.contents, applyAction);

    const description = await screen.findByRole('textbox', { name: '第 1 个镜头画面描述' });
    expect(description).toHaveValue('白底黑线火柴人讲解核心概念');
    expect(screen.getByText('旁白（来自脚本）')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '第 1 个镜头运动' })).toHaveValue('push-in');
    expect(screen.queryByRole('dialog', { name: '编辑镜头' })).not.toBeInTheDocument();

    fireEvent.change(description, {
      target: { value: '新的镜头提示词' }
    });
    expect(screen.getByRole('button', { name: '重新生成' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'edit-shot',
        expectedRevision: persisted.job.revision,
        input: expect.objectContaining({
          scopeKey: 'shot-01',
          revision: persisted.job.revision,
          patch: expect.objectContaining({ visualDescription: '新的镜头提示词' })
        })
      })
    ));
  });

  it('shows immediate feedback and then runtime progress while regenerating one shot', async () => {
    const persisted = completedJob({ withSnapshot: false });
    const runningStage: CreatorStageRun = {
      ...stage('images', 'running', 'shot-01'),
      id: 'images-shot-01-retry',
      progress: { phase: 'submitting', percent: 42, completed: 0, failed: 0, total: 1 }
    };
    const runningJob: CreatorJob = {
      ...persisted.job,
      revision: persisted.job.revision + 1,
      status: 'running',
      stages: [...persisted.job.stages, runningStage],
      artifacts: persisted.job.artifacts.map(artifact => artifact.kind === 'shot_image'
        ? { ...artifact, status: 'stale' as const }
        : artifact)
    };
    const response = {
      job: runningJob,
      receipt: {
        actor: 'user' as const,
        action: 'regenerate-shot',
        summary: 'regenerate-shot',
        affectedArtifacts: [],
        newRevision: runningJob.revision,
        createdAt: runningJob.updatedAt
      }
    };
    let releaseAction!: () => void;
    const applyAction = vi.fn(async () => {
      await new Promise<void>(resolve => {
        releaseAction = resolve;
      });
      return response;
    });
    const { container } = renderWorkspace(persisted.job, persisted.contents, applyAction);

    const description = await screen.findByRole('textbox', { name: '第 1 个镜头画面描述' });
    const row = description.closest('.stickman-storyboard-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: '重新生成' }));

    expect(within(row).queryByRole('button', { name: '重新生成中...' })).not.toBeInTheDocument();
    expect(within(row).getByRole('status')).toHaveTextContent('请求已提交，等待生成');
    expect(container.querySelector('.stickman-storyboard-image .creator-collaboration-spin')).not.toBeNull();

    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1));
    await act(async () => releaseAction());
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(
      persisted.job.id,
      expect.objectContaining({
        action: 'regenerate-shot',
        input: expect.objectContaining({
          scopeKey: 'shot-01',
          inputFingerprint: 'a'.repeat(64)
        })
      })
    ));
    await waitFor(() => expect(within(row).getByRole('status'))
      .toHaveTextContent('正在生成画面 · 42%'));
    expect(within(row).queryByRole('button', { name: '重新生成中...' })).not.toBeInTheDocument();
  });
});

function renderWorkspace(
  initialJob: CreatorJob,
  contents = new Map<string, unknown>(),
  applyAction = vi.fn(async (_jobId: string, _request: Record<string, unknown>) => ({
    job: initialJob,
    receipt: {
      actor: 'user' as const,
      action: 'noop',
      summary: 'noop',
      affectedArtifacts: [],
      newRevision: initialJob.revision,
      createdAt: initialJob.updatedAt
    }
  })),
  creatorServicesService: ComponentProps<typeof StickmanVideoWorkspace>['creatorServicesService'] = null
) {
  return render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={initialJob}
        service={{
          applyAction,
          runAgentTurn: vi.fn(),
          openArtifact: vi.fn(async (_jobId: string, artifactId: string) => {
            const value = contents.get(artifactId);
            return value === undefined
              ? new Response(new Blob(['media'], { type: 'application/octet-stream' }))
              : new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
          })
        } as never}
      >
        <StickmanVideoWorkspace
          creatorServicesService={creatorServicesService}
          creatorService={{
            listVisualAssets: vi.fn(async () => ({ assets: visualAssetCatalog() })),
            openVisualAssetPreview: vi.fn()
          } as never}
          onBack={vi.fn()}
        />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function configuredTtsService() {
  const config = createDefaultCreatorServicesConfig();
  return {
    getConfig: vi.fn(async () => ({
      config,
      configuredCredentials: ['tts.openai.apiKey', 'image.openai.apiKey']
    })),
    getTtsVoices: vi.fn(async () => ({
      provider: 'openai' as const,
      model: config.tts.openai.model,
      voices: [{
        id: config.tts.openai.defaultVoiceId,
        name: 'Marin',
        provider: 'openai' as const,
        kind: 'builtin' as const
      }]
    })),
    previewTtsVoice: vi.fn()
  } as never;
}

function job(input: {
  status?: CreatorJob['status'];
  stages?: CreatorStageRun[];
  artifacts?: CreatorArtifact[];
  state?: CreatorJob['state'];
} = {}): CreatorJob {
  return {
    id: 'stickman-job-1',
    projectId: 'project-1',
    templateId: 'stickman-video',
    templateVersion: 2,
    status: input.status ?? 'draft',
    revision: 7,
    state: {
      sourceType: 'url',
      sourceUrl: 'https://www.youtube.com/watch?v=test',
      sourceText: '',
      characterAsset: { assetId: 'stickman.character.default', revision: 1 },
      styleAsset: { assetId: 'stickman.style.paper-pencil', revision: 1 },
      ratio: '16:9',
      targetDurationSeconds: 30,
      targetLanguage: 'zh-CN',
      currentStage: null,
      ...(input.state ?? {})
    },
    agentThreadId: null,
    stages: input.stages ?? [],
    artifacts: input.artifacts ?? [],
    providerRequests: [],
    activities: [],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:07.000Z'
  };
}

function visualAssetCatalog() {
  const characters = [
    ['default', '默认角色', 'Default'],
    ['tech-guy', '科技男', 'Tech Guy'],
    ['long-hair', '长发角色', 'Long Hair'],
    ['short-hair', '短发角色', 'Short Hair'],
    ['student', '学生角色', 'Student'],
    ['manager', '经理', 'Manager'],
    ['hiphop', '潮流角色', 'Street Style'],
    ['elder', '长者', 'Elder'],
    ['chef', '厨师', 'Chef'],
    ['fitness', '健身角色', 'Fitness']
  ].map(([id, zhCN, en]) => ({
    id: `stickman.character.${id}`,
    revision: 1,
    templateId: 'stickman-video',
    kind: 'character' as const,
    source: 'builtin' as const,
    status: 'ready' as const,
    name: { zhCN: zhCN!, en: en! },
    description: { zhCN: zhCN!, en: en! },
    previewUrl: null,
    referenceCount: 1,
    recommended: id === 'default',
    tags: []
  }));
  const styles = [
    ['minimal-ink', '极简黑白线稿', 'Minimal black-and-white line art', 'none'],
    ['paper-pencil', '纸面铅笔手绘', 'Pencil sketch on paper', 'paper'],
    ['comic-storyboard', '漫画分镜线稿', 'Comic storyboard line art', 'screentone'],
    ['whiteboard-marker', '白板讲解线稿', 'Whiteboard explainer line art', 'marker']
  ].map(([id, zhCN, en, texture]) => ({
    id: `stickman.style.${id}`,
    revision: 1,
    templateId: 'stickman-video',
    kind: 'style' as const,
    source: 'builtin' as const,
    status: 'ready' as const,
    name: { zhCN: zhCN!, en: en! },
    description: { zhCN: `${zhCN}说明`, en: `${en} description` },
    previewUrl: null,
    referenceCount: 0,
    recommended: id === 'paper-pencil',
    tags: [],
    styleAttributes: {
      medium: { zhCN: '手绘线条', en: 'Hand-drawn lines' },
      palette: { zhCN: '黑白灰', en: 'Monochrome' },
      sceneDensity: { zhCN: '适中', en: 'Medium' },
      swatch: {
        background: '#ffffff',
        foreground: '#171717',
        accent: '#a3a3a3',
        texture: texture as 'none' | 'paper' | 'screentone' | 'marker'
      }
    }
  }));
  return [...characters, ...styles];
}

function stage(stageId: string, status: CreatorStageRun['status'], scopeKey: string | null = null): CreatorStageRun {
  return {
    id: `${stageId}-${scopeKey ?? 'global'}`,
    jobId: 'stickman-job-1',
    stageId,
    executor: stageId === 'images' ? 'stickman-image' : 'download',
    status,
    dispatchStatus: status === 'queued' || status === 'running' ? 'claimed' : 'finished',
    claimOwner: status === 'running' ? 'scheduler' : null,
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: `${stageId}-key`,
    scopeKey,
    inputFingerprint: scopeKey === null ? null : 'a'.repeat(64),
    progress: {},
    errorCode: null,
    errorMessage: null,
    startedAt: '2026-08-31T00:00:01.000Z',
    finishedAt: status === 'succeeded' ? '2026-08-31T00:00:02.000Z' : null
  };
}

function artifact(id: string, kind: string, scopeKey: string | null = null): CreatorArtifact {
  return {
    id,
    jobId: 'stickman-job-1',
    kind,
    version: 1,
    status: 'completed',
    path: `/tmp/${id}`,
    scopeKey,
    inputFingerprint: scopeKey === null ? null : 'a'.repeat(64),
    sha256: id.padEnd(64, '0').slice(0, 64),
    sourceArtifactIds: [],
    metadata: { fileName: `${kind}.${kind.includes('video') ? 'mp4' : kind.includes('subtitle') ? 'srt' : 'json'}` },
    createdAt: '2026-08-31T00:00:03.000Z'
  };
}

function scriptReviewJob() {
  const script = artifact('script', 'script_manifest');
  const value: ScriptManifestFixture = {
    contract: 'stickman-narration-script-v2',
    reviewStatus: 'needs_review',
    contentLocked: false,
    title: '测试脚本',
    language: 'zh-CN',
    targetDurationSeconds: 5,
    narrationBudget: { unit: 'characters', unitsPerMinute: 240, minUnits: 1, maxUnits: 100 },
    segmentCount: 1,
    totalNarrationUnits: 6,
    estimatedTotalDurationSeconds: 1.5,
    segments: [{
      id: 'segment-01',
      order: 1,
      narration: '解释核心概念',
      claimIds: ['claim-001'],
      sourceSpanIds: ['source-001'],
      narrationUnits: 6,
      estimatedDurationSeconds: 1.5
    }]
  };
  return {
    artifact: script,
    value,
    job: job({
      status: 'needs_input',
      artifacts: [script],
      state: {
        currentStage: 'script',
        needsInput: {
          code: 'creator_review_required',
          kind: 'approve-script',
          message: '请审核脚本后继续',
          artifactId: script.id
        }
      }
    }),
    contents: new Map<string, unknown>([[script.id, value]])
  };
}

type ScriptManifestFixture = {
  contract: 'stickman-narration-script-v2';
  reviewStatus: 'needs_review' | 'approved';
  contentLocked: boolean;
  title: string;
  language: string;
  targetDurationSeconds: number;
  narrationBudget: {
    unit: 'characters' | 'words';
    unitsPerMinute: number;
    minUnits: number;
    maxUnits: number;
  };
  segmentCount: number;
  totalNarrationUnits: number;
  estimatedTotalDurationSeconds: number;
  segments: Array<{
    id: string;
    order: number;
    narration: string;
    claimIds: string[];
    sourceSpanIds: string[];
    narrationUnits: number;
    estimatedDurationSeconds: number;
  }>;
};

function audioReadyJob() {
  const persisted = scriptReviewJob();
  const narration = artifact('narration-01', 'narration_audio', 'segment-01');
  const timing = artifact('audio-timing', 'audio_timing');
  return {
    job: job({
      status: 'running',
      stages: [stage('narration', 'succeeded', 'segment-01'), stage('audio-timing', 'succeeded')],
      artifacts: [persisted.artifact, narration, timing],
      state: {
        ...persisted.job.state,
        approvedScriptArtifactId: persisted.artifact.id,
        workflowTarget: 'audio_ready',
        currentStage: 'audio-timing',
        needsInput: null,
        voiceName: 'Marin'
      }
    }),
    contents: new Map<string, unknown>([
      ...persisted.contents,
      [timing.id, {
        scriptArtifactId: persisted.artifact.id,
        timingSource: 'ffprobe_cumulative_tts_duration',
        segments: [{
          segmentId: 'segment-01',
          startSeconds: 0,
          endSeconds: 5,
          durationSeconds: 5,
          audioArtifactId: narration.id,
          audioSha256: 'a'.repeat(64)
        }],
        totalDurationSeconds: 5
      }]
    ])
  };
}

function completedJob(options: { withSnapshot?: boolean } = {}) {
  const script = artifact('script', 'script_manifest');
  const narration = artifact('narration-01', 'narration_audio', 'segment-01');
  const timing = artifact('audio-timing', 'audio_timing');
  const shots = artifact('shots', 'shot_spec');
  const shotImage = artifact('shot-image', 'shot_image', 'shot-01');
  const validation = artifact('validation', 'visual_validation');
  const deliveries = [
    artifact('clean', 'clean_video'),
    artifact('narration-srt', 'narration_subtitle'),
    artifact('manifest', 'delivery_manifest')
  ];
  const withSnapshot = options.withSnapshot ?? true;
  const state: CreatorJob['state'] = {
    approvedScriptArtifactId: script.id,
    workflowTarget: withSnapshot ? 'delivery_ready' : 'visuals_ready',
    currentStage: withSnapshot ? 'package-validation' : 'visual-validation',
    needsInput: null,
    ...(withSnapshot ? {
      resultSnapshots: [{
        version: 1,
        createdAt: '2026-08-31T00:00:06.000Z',
        action: 'stage-succeeded',
        stageId: 'package-validation',
        description: '完成火柴人视频与旁白字幕交付',
        artifactRefs: Object.fromEntries(deliveries.map(item => [item.kind, [item.id]])),
        changedArtifactIds: deliveries.map(item => item.id),
        staleArtifactIds: [],
        state: {}
      }]
    } : {})
  };
  return {
    job: job({
      status: withSnapshot ? 'completed' : 'running',
      stages: [
        stage('narration', 'succeeded', 'segment-01'),
        stage('audio-timing', 'succeeded'),
        stage('images', 'succeeded', 'shot-01'),
        stage('visual-validation', 'succeeded'),
        ...(withSnapshot ? [stage('package-validation', 'succeeded')] : [])
      ],
      artifacts: [script, narration, timing, shots, shotImage, validation, ...deliveries],
      state
    }),
    contents: new Map<string, unknown>([
      [script.id, {
        contract: 'stickman-narration-script-v2',
        reviewStatus: 'approved',
        contentLocked: true,
        title: '测试脚本',
        language: 'zh-CN',
        targetDurationSeconds: 5,
        narrationBudget: { unit: 'characters', unitsPerMinute: 240, minUnits: 1, maxUnits: 100 },
        segmentCount: 1,
        totalNarrationUnits: 6,
        estimatedTotalDurationSeconds: 1.5,
        segments: [{ id: 'segment-01', order: 1, narration: '解释核心概念', claimIds: ['claim-001'], sourceSpanIds: ['source-001'], narrationUnits: 6, estimatedDurationSeconds: 1.5 }]
      }],
      [timing.id, {
        scriptArtifactId: script.id,
        timingSource: 'ffprobe_cumulative_tts_duration',
        segments: [{ segmentId: 'segment-01', startSeconds: 0, endSeconds: 5, durationSeconds: 5, audioArtifactId: narration.id, audioSha256: 'a'.repeat(64) }],
        totalDurationSeconds: 5
      }],
      [shots.id, {
        scriptArtifactId: script.id,
        audioTimingArtifactId: timing.id,
        timingSource: 'ffprobe_cumulative_tts_duration',
        shots: [{
          id: 'shot-01',
          sourceSegmentId: 'segment-01',
          semanticAnchor: '解释核心概念的关系',
          visualDescription: '白底黑线火柴人讲解核心概念',
          compositionAndAction: '人物站在画面中央讲解核心概念',
          keyObjects: ['白板'],
          continuityReason: '',
          motion: 'push-in',
          motionReason: '聚焦人物正在解释的核心关系',
          startSeconds: 0,
          endSeconds: 5,
          durationSeconds: 5
        }]
      }]
    ])
  };
}

function partialStoryboardJob(status: 'idle' | 'failed' | 'running') {
  const persisted = completedJob({ withSnapshot: false });
  const shotsArtifact = persisted.job.artifacts.find(artifact => artifact.kind === 'shot_spec')!;
  const baseShotSpec = persisted.contents.get(shotsArtifact.id) as {
    shots: Array<{
      id: string;
      visualDescription: string;
      continuityReason: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  const shots = [
    baseShotSpec.shots[0]!,
    {
      ...baseShotSpec.shots[0]!,
      id: 'shot-02',
      visualDescription: '第二个镜头的画面描述',
      continuityReason: '延续上一幅画面'
    },
    {
      ...baseShotSpec.shots[0]!,
      id: 'shot-03',
      visualDescription: '第三个镜头的画面描述',
      continuityReason: '延续上一幅画面'
    }
  ];
  const imageStages = [stage('images', 'succeeded', 'shot-01')];
  if (status !== 'idle') {
    imageStages.push({
      ...stage('images', status, 'shot-02'),
      id: `images-shot-02-${status}`,
      progress: status === 'running'
        ? { phase: 'generating', percent: 42, completed: 0, failed: 0, total: 1 }
        : {},
      errorCode: status === 'failed' ? 'creator_stage_failed' : null,
      errorMessage: status === 'failed' ? 'Image generation failed' : null
    });
  }
  const contents = new Map(persisted.contents);
  contents.set(shotsArtifact.id, { ...baseShotSpec, shots });
  return {
    job: {
      ...persisted.job,
      status: status === 'failed' ? 'needs_input' as const : 'running' as const,
      stages: [
        ...persisted.job.stages.filter(stage => (
          stage.stageId !== 'images' && stage.stageId !== 'visual-validation'
        )),
        ...imageStages
      ],
      artifacts: persisted.job.artifacts.filter(artifact => artifact.kind !== 'visual_validation'),
      state: {
        ...persisted.job.state,
        currentStage: 'images',
        workflowTarget: 'visuals_ready',
        ...(status === 'failed'
          ? { needsInput: { code: 'creator_stage_failed', scopeKey: 'shot-02' } }
          : { needsInput: null })
      }
    },
    contents
  };
}
