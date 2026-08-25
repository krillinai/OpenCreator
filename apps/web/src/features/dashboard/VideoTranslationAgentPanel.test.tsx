import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreatorAgentTimelineResponse, CreatorJob } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import VideoTranslationAgentPanel from './VideoTranslationAgentPanel.js';

describe('VideoTranslationAgentPanel', () => {
  it('只展示标准对话和协作事件，不泄露内部工具上下文', async () => {
    const { container } = renderPanel({
      getAgentTimeline: vi.fn(async () => timeline())
    });

    expect(await screen.findByRole('heading', { name: '设置建议', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('先确认目标语言')).toBeInTheDocument();
    expect(screen.getByText('请检查当前设置')).toBeInTheDocument();
    expect(screen.getByText('更新了创作设置')).toBeInTheDocument();
    expect(screen.getByText('工作台')).toBeInTheDocument();
    expect(screen.queryByText(/OpenCreator Context Projection/)).not.toBeInTheDocument();
    expect(screen.queryByText(/internal prompt/)).not.toBeInTheDocument();
    expect(screen.queryByText('确认项目状态')).not.toBeInTheDocument();
    expect(screen.queryByText('执行记录')).not.toBeInTheDocument();
    expect(screen.queryByText('已经处理的工具确认')).not.toBeInTheDocument();
    expect(container.querySelector('.tool-agent-composer-icon-button')).toBeNull();
    expect(container.querySelectorAll('.tool-agent-composer-select')).toHaveLength(1);
    expect(container.querySelector('.tool-agent-composer-send')).not.toBeNull();
  });

  it('合并连续的工作台设置更新，并忽略纯界面状态', async () => {
    renderPanel({
      initialJob: job(),
      getAgentTimeline: vi.fn(async () => emptyTimeline())
    });

    expect(await screen.findByText('更新了创作设置')).toBeInTheDocument();
    expect(screen.getAllByText('更新了创作设置')).toHaveLength(1);
    expect(screen.getByText('目标语言、双语字幕、配音')).toBeInTheDocument();
    expect(screen.getByText('2 次修改')).toBeInTheDocument();
    expect(screen.queryByText('当前步骤')).not.toBeInTheDocument();
    expect(screen.queryByText('V4')).not.toBeInTheDocument();
  });

  it('区分工作台快捷操作与真实 Agent 对话', async () => {
    const directAction = vi.fn();
    const runAgentTurn = vi.fn(async () => ({ turn: {} }));
    renderPanel({
      runAgentTurn,
      getAgentTimeline: vi.fn(async () => emptyTimeline()),
      directAction
    });

    fireEvent.click(screen.getByRole('button', { name: '打开翻译设置' }));
    expect(directAction).toHaveBeenCalledTimes(1);
    expect(runAgentTurn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '让 Agent 检查设置' }));
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledWith(
      'job_1',
      expect.objectContaining({
        message: '检查设置',
        clientMessageId: expect.any(String),
        sandbox: 'workspace-write'
      })
    ));
  });

  it('在输入框切换完全访问，并把权限真实传给 Creator Agent', async () => {
    const runAgentTurn = vi.fn(async () => ({ turn: {} }));
    renderPanel({
      runAgentTurn,
      getAgentTimeline: vi.fn(async () => emptyTimeline())
    });

    fireEvent.click(screen.getByRole('button', { name: /选择访问权限 请求批准/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /完全访问权限/ }));
    expect(screen.getByRole('button', { name: /选择访问权限 完全访问权限/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '告诉 Agent 你的要求' }), {
      target: { value: '合成视频' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送给 Agent' }));

    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledWith(
      'job_1',
      expect.objectContaining({
        message: '合成视频',
        sandbox: 'danger-full-access'
      })
    ));
  });

  it('从真实 Creator Thread 状态恢复完全访问权限', async () => {
    const currentTimeline = timeline();
    currentTimeline.session!.sandbox = 'danger-full-access';
    renderPanel({
      getAgentTimeline: vi.fn(async () => currentTimeline)
    });

    expect(await screen.findByRole('button', {
      name: /选择访问权限 完全访问权限/
    })).toBeInTheDocument();
  });

  it('显示 Agent 对工作台的真实修改，并隐藏内部工具枚举', async () => {
    const currentJob = job();
    currentJob.activities.push({
      id: 'activity_render',
      jobId: currentJob.id,
      revision: 5,
      actor: 'agent',
      action: 'run-stage',
      summary: '启动阶段 render-horizontal',
      details: {},
      createdAt: '2026-08-21T00:00:06.000Z'
    });
    const currentTimeline = timeline();
    currentTimeline.turns.push(
      {
        ...currentTimeline.turns[0]!,
        id: 'turn_user_render',
        content: '合成视频',
        createdAt: '2026-08-21T00:00:04.000Z'
      },
      {
        ...currentTimeline.turns[1]!,
        id: 'turn_assistant_render',
        content: '视频已合成成功。\n\n- 当前 revision：`19`',
        createdAt: '2026-08-21T00:00:05.000Z',
        completedAt: '2026-08-21T00:00:07.000Z'
      }
    );
    currentTimeline.items.push(
      ...['context_1', 'context_2', 'context_3'].map((id, index) => ({
        ...currentTimeline.items[1]!,
        id,
        turnId: 'turn_assistant_render',
        runtimeItemId: id,
        sequence: index + 1
      })),
      {
        ...currentTimeline.items[1]!,
        id: 'codex_resources',
        turnId: 'turn_assistant_render',
        runtimeItemId: 'codex_resources',
        toolName: 'codex.list_mcp_resources',
        sequence: 4
      },
      ...['apply_1', 'apply_2'].map((id, index) => ({
        ...currentTimeline.items[1]!,
        id,
        turnId: 'turn_assistant_render',
        runtimeItemId: id,
        toolName: 'opencreator_tools.creator_apply_action',
        sequence: index + 5
      }))
    );

    const { container } = renderPanel({
      initialJob: currentJob,
      getAgentTimeline: vi.fn(async () => currentTimeline)
    });

    expect(await screen.findByText('开始生成横屏成片')).toBeInTheDocument();
    expect(container.querySelector('.video-translation-agent-activity[data-actor="agent"]')).not.toBeNull();
    expect(screen.queryByText('确认项目状态')).not.toBeInTheDocument();
    expect(screen.queryByText('执行记录')).not.toBeInTheDocument();
    expect(screen.queryByText('调用 Creator 工具')).not.toBeInTheDocument();
    expect(screen.queryByText(/revision 19/i)).not.toBeInTheDocument();
  });

  it('发送后立即清空输入框，并在请求完成前阻止重复提交', async () => {
    const pending = deferred<unknown>();
    const runAgentTurn = vi.fn(() => pending.promise);
    renderPanel({
      runAgentTurn,
      getAgentTimeline: vi.fn(async () => emptyTimeline())
    });

    const input = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(input, { target: { value: '查看下生成的字幕样式' } });
    fireEvent.click(screen.getByRole('button', { name: '发送给 Agent' }));

    expect(input).toHaveValue('');
    await waitFor(() => expect(runAgentTurn).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: '不要重复发送' } });
    const sendButton = screen.getByRole('button', { name: '发送给 Agent' });
    expect(sendButton).toBeDisabled();
    fireEvent.click(sendButton);
    expect(runAgentTurn).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve({ turn: {} }));
    await waitFor(() => expect(sendButton).not.toBeDisabled());
    expect(input).toHaveValue('不要重复发送');
  });

  it('发送失败时仅在输入框仍为空时恢复原消息', async () => {
    const runAgentTurn = vi.fn(async () => {
      throw new Error('Agent unavailable');
    });
    renderPanel({
      runAgentTurn,
      getAgentTimeline: vi.fn(async () => emptyTimeline())
    });

    const input = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    fireEvent.change(input, { target: { value: '查看字幕样式' } });
    fireEvent.click(screen.getByRole('button', { name: '发送给 Agent' }));

    expect(input).toHaveValue('');
    await waitFor(() => expect(input).toHaveValue('查看字幕样式'));
  });

  it('Codex 尚未输出内容时只显示一个真实工作指示器', async () => {
    const { container } = renderPanel({
      getAgentTimeline: vi.fn(async () => runningTimeline())
    });

    expect(await screen.findByText('请检查当前设置')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Agent 正在工作' })).toBeInTheDocument();
    expect(container.querySelectorAll('.video-translation-agent-working')).toHaveLength(1);
    expect(container.querySelector(
      '.video-translation-agent-message[data-source="agent"][data-role="assistant"]'
    )).toBeNull();
  });

  it('工具正在执行时不把工具状态伪装成 Codex 回复', async () => {
    const value = runningTimeline();
    value.items = [{
      ...timeline().items[1]!,
      turnId: value.turns[1]!.id,
      status: 'running'
    }];
    const { container } = renderPanel({ getAgentTimeline: vi.fn(async () => value) });

    expect(await screen.findByText('请检查当前设置')).toBeInTheDocument();
    expect(screen.queryByText('确认项目状态')).not.toBeInTheDocument();
    expect(screen.queryByText('执行记录')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Agent 正在工作' })).toBeInTheDocument();
    expect(container.querySelectorAll('.video-translation-agent-working')).toHaveLength(1);
    expect(container.querySelector(
      '.video-translation-agent-message[data-source="agent"][data-role="assistant"]'
    )).toBeNull();
  });

  it('优先展示 Codex 已流式输出的可见说明', async () => {
    const value = runningTimeline();
    value.items = [{
      ...timeline().items[0]!,
      turnId: value.turns[1]!.id,
      kind: 'assistant_message',
      role: 'assistant',
      status: 'running',
      text: '我先检查当前字幕和成片设置。',
      data: { phase: 'commentary' }
    }];

    renderPanel({ getAgentTimeline: vi.fn(async () => value) });

    expect(await screen.findByText('我先检查当前字幕和成片设置。')).toBeInTheDocument();
    expect(screen.getByText('Agent 回复')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Agent 正在工作' })).toBeInTheDocument();
  });

  it('等待审批时只展示真实审批请求，不生成固定回复', async () => {
    const value = runningTimeline();
    value.turns[1] = { ...value.turns[1]!, status: 'waiting_approval' };
    value.approvals = [{
      ...timeline().approvals[0]!,
      turnId: value.turns[1]!.id,
      status: 'pending',
      details: {
        _meta: {
          tool_params: {
            action: 'run-stage',
            input: { stageId: 'render-horizontal' }
          }
        }
      },
      resolvedAt: null
    }];
    const { container } = renderPanel({ getAgentTimeline: vi.fn(async () => value) });

    expect(await screen.findByRole('button', { name: '批准' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector(
      '.video-translation-agent-message[data-source="agent"][data-role="assistant"]'
    )).toBeNull();
  });

  it('把工作台操作和 Runtime 真实进度归并为一张 Stage 卡', async () => {
    const runningJob = job();
    runningJob.status = 'running';
    runningJob.revision = 6;
    runningJob.activities.push({
      id: 'activity_run',
      jobId: runningJob.id,
      revision: 5,
      actor: 'user',
      action: 'run-stage',
      summary: '启动阶段 subtitle',
      details: {},
      createdAt: '2026-08-21T00:00:04.000Z'
    });
    runningJob.stages.push({
      id: 'stage_subtitle',
      jobId: runningJob.id,
      stageId: 'subtitle',
      executor: 'krillinai',
      status: 'running',
      dispatchStatus: 'claimed',
      claimOwner: 'scheduler_1',
      claimExpiresAt: '2026-08-21T00:01:00.000Z',
      attempt: 1,
      idempotencyKey: 'subtitle_1',
      progress: {
        krillinStatus: 'running',
        krillinEventPayload: {
          phase: 'translating_subtitles',
          percent: 52,
          message: '正在翻译字幕'
        }
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-08-21T00:00:05.000Z',
      finishedAt: null
    });

    const getAgentTimeline = vi.fn(async () => emptyTimeline());
    renderPanel({
      initialJob: runningJob,
      getAgentTimeline
    });

    expect(screen.getByText(/工作台 · 字幕翻译/)).toBeInTheDocument();
    expect(screen.getByText('正在翻译字幕')).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '字幕翻译进度' })).toHaveAttribute('aria-valuenow', '52');
    expect(screen.queryByRole('status', { name: 'Agent 正在工作' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.video-translation-agent-spin')).toHaveLength(1);
    expect(screen.queryByText('开始生成字幕')).not.toBeInTheDocument();
    expect(screen.queryByText('我已从工作台开始视频字幕翻译。')).not.toBeInTheDocument();
    await waitFor(() => expect(getAgentTimeline).toHaveBeenCalledTimes(1));
  });

  it('任务失败后保留 Runtime 提供的最后进度', async () => {
    const failedJob = job();
    failedJob.status = 'failed';
    failedJob.stages.push({
      id: 'stage_subtitle_failed',
      jobId: failedJob.id,
      stageId: 'subtitle',
      executor: 'krillinai',
      status: 'failed',
      dispatchStatus: 'finished',
      claimOwner: null,
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'subtitle_failed_1',
      progress: {
        percent: 67,
        phase: 'translating_subtitles',
        krillinEventPayload: {
          percent: 67,
          phase: 'translating_subtitles',
          message: '正在翻译字幕'
        }
      },
      errorCode: 'translation_failed',
      errorMessage: '翻译服务返回错误',
      startedAt: '2026-08-21T00:00:05.000Z',
      finishedAt: '2026-08-21T00:00:20.000Z'
    });

    const getAgentTimeline = vi.fn(async () => emptyTimeline());
    renderPanel({
      initialJob: failedJob,
      getAgentTimeline
    });

    expect(screen.getByText('翻译服务返回错误')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '字幕翻译进度' })).toHaveAttribute(
      'aria-valuetext',
      '失败前进度 67%'
    );
    expect(document.querySelectorAll('.video-translation-agent-spin')).toHaveLength(0);
    await waitFor(() => expect(getAgentTimeline).toHaveBeenCalledTimes(1));
  });

  it('请求刚发送且 Timeline 尚未返回时立即显示唯一工作指示器', async () => {
    const pending = deferred<unknown>();
    const runAgentTurn = vi.fn(() => pending.promise);
    const { container } = renderPanel({
      runAgentTurn,
      getAgentTimeline: vi.fn(async () => emptyTimeline())
    });

    fireEvent.change(screen.getByRole('textbox', { name: '告诉 Agent 你的要求' }), {
      target: { value: '检查任务失败原因' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送给 Agent' }));

    expect(await screen.findByRole('status', { name: 'Agent 正在工作' })).toBeInTheDocument();
    expect(container.querySelectorAll('.video-translation-agent-working')).toHaveLength(1);

    await act(async () => pending.resolve({ turn: {} }));
  });

  it('按实际消息项展示同一 Codex Turn 的多段输出，不重复最终回答', async () => {
    const value = timeline();
    value.turns[1] = {
      ...value.turns[1]!,
      content: '成片已经完成。'
    };
    value.items = [
      {
        ...value.items[0]!,
        id: 'assistant_commentary',
        turnId: value.turns[1]!.id,
        kind: 'assistant_message',
        role: 'assistant',
        text: '我先确认字幕和成片参数。',
        status: 'completed',
        createdAt: '2026-08-21T00:00:03.000Z',
        updatedAt: '2026-08-21T00:00:03.500Z'
      },
      {
        ...value.items[0]!,
        id: 'assistant_final',
        turnId: value.turns[1]!.id,
        kind: 'assistant_message',
        role: 'assistant',
        text: '成片已经完成。',
        status: 'completed',
        createdAt: '2026-08-21T00:00:05.000Z',
        updatedAt: '2026-08-21T00:00:05.500Z'
      }
    ];

    const { container } = renderPanel({ getAgentTimeline: vi.fn(async () => value) });

    expect(await screen.findByText('我先确认字幕和成片参数。')).toBeInTheDocument();
    expect(screen.getByText('成片已经完成。')).toBeInTheDocument();
    expect(screen.getAllByText('成片已经完成。')).toHaveLength(1);
    expect(container.querySelectorAll(
      '.video-translation-agent-message[data-role="assistant"]'
    )).toHaveLength(2);
  });
});

function renderPanel(options: {
  initialJob?: CreatorJob;
  getAgentTimeline: ReturnType<typeof vi.fn>;
  runAgentTurn?: ReturnType<typeof vi.fn>;
  directAction?: ReturnType<typeof vi.fn>;
}) {
  const result = render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={options.initialJob ?? job()}
        service={{
          applyAction: vi.fn(),
          runAgentTurn: options.runAgentTurn ?? vi.fn(),
          getAgentTimeline: options.getAgentTimeline
        } as never}
      >
        <VideoTranslationAgentPanel
          stepLabel="翻译设置"
          contextSummary="中文到英文"
          quickActions={[
            {
              id: 'direct',
              label: '打开翻译设置',
              kind: 'action',
              onAction: options.directAction
            },
            {
              id: 'agent',
              label: '让 Agent 检查设置',
              kind: 'agent',
              prompt: '检查设置'
            }
          ]}
        />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
  return result;
}

function timeline(): CreatorAgentTimelineResponse {
  return {
    session: {
      id: 'session_1',
      jobId: 'job_1',
      threadId: 'thread_1',
      runtimeThreadId: 'runtime_thread_1',
      status: 'active' as const,
      hostGeneration: 1,
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:03.000Z',
      interruptedAt: null,
      closedAt: null
    },
    turns: [
      {
        id: 'turn_user',
        jobId: 'job_1',
        sessionId: 'session_1',
        role: 'user' as const,
        content: '请检查当前设置',
        status: 'completed' as const,
        audit: [],
        createdAt: '2026-08-21T00:00:01.000Z'
      },
      {
        id: 'turn_assistant',
        jobId: 'job_1',
        sessionId: 'session_1',
        role: 'assistant' as const,
        content: '### 设置建议\n\n- 先确认目标语言',
        status: 'completed' as const,
        audit: [],
        createdAt: '2026-08-21T00:00:03.000Z'
      }
    ],
    items: [
      {
        id: 'reasoning_1',
        jobId: 'job_1',
        sessionId: 'session_1',
        turnId: 'turn_assistant',
        runtimeItemId: 'runtime_reasoning_1',
        kind: 'reasoning' as const,
        status: 'completed' as const,
        text: 'OpenCreator Context Projection: internal prompt',
        data: { private: true },
        sequence: 1,
        createdAt: '2026-08-21T00:00:02.000Z',
        updatedAt: '2026-08-21T00:00:02.000Z'
      },
      {
        id: 'tool_1',
        jobId: 'job_1',
        sessionId: 'session_1',
        turnId: 'turn_assistant',
        runtimeItemId: 'runtime_tool_1',
        kind: 'tool_call' as const,
        status: 'completed' as const,
        toolName: 'opencreator_tools.creator_get_context',
        data: {},
        sequence: 2,
        createdAt: '2026-08-21T00:00:02.000Z',
        updatedAt: '2026-08-21T00:00:02.000Z'
      }
    ],
    approvals: [{
      id: 'approval_1',
      jobId: 'job_1',
      sessionId: 'session_1',
      turnId: 'turn_assistant',
      itemId: 'tool_1',
      runtimeRequestId: 'runtime_approval_1',
      processGeneration: 1,
      kind: 'tool_call' as const,
      status: 'approved' as const,
      title: '已经处理的工具确认',
      summary: '历史审批不应长期占据对话区',
      details: {},
      requestedAt: '2026-08-21T00:00:02.000Z',
      expiresAt: '2026-08-21T00:05:02.000Z',
      resolvedAt: '2026-08-21T00:00:03.000Z',
      resolutionReason: null
    }],
    lastEventSequence: 2
  };
}

function emptyTimeline(): CreatorAgentTimelineResponse {
  return {
    session: null,
    turns: [],
    items: [],
    approvals: [],
    lastEventSequence: 0
  };
}

function runningTimeline(): CreatorAgentTimelineResponse {
  const value = timeline();
  return {
    ...value,
    turns: [
      value.turns[0]!,
      {
        ...value.turns[1]!,
        content: '',
        status: 'running' as const
      }
    ],
    items: [],
    approvals: []
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function job(): CreatorJob {
  return {
    id: 'job_1',
    projectId: 'project_1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: 'draft',
    revision: 4,
    state: {},
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [
      {
        id: 'activity_1',
        jobId: 'job_1',
        revision: 1,
        actor: 'user',
        action: 'create-job',
        summary: '创建任务',
        details: {},
        createdAt: '2026-08-21T00:00:00.000Z'
      },
      {
        id: 'activity_2',
        jobId: 'job_1',
        revision: 2,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '工作台设置已同步',
        details: { objectId: 'targetLanguage,bilingual' },
        createdAt: '2026-08-21T00:00:01.000Z'
      },
      {
        id: 'activity_3',
        jobId: 'job_1',
        revision: 3,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '工作台设置已同步',
        details: { objectId: 'bilingual,dubbing' },
        createdAt: '2026-08-21T00:00:02.000Z'
      },
      {
        id: 'activity_4',
        jobId: 'job_1',
        revision: 4,
        actor: 'user',
        action: 'update-settings:draft',
        summary: '当前步骤',
        details: { objectId: 'workspacePhase,resultTab,currentStep' },
        createdAt: '2026-08-21T00:00:03.000Z'
      }
    ],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:03.000Z'
  };
}
