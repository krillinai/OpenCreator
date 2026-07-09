import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentEventEnvelope,
  AgentEventPayload,
  CodexStatusResponse,
  RunDiagnosticsResponse,
  ThreadResponse
} from '@clawee/protocol';
import { App } from './App.js';
import type { HostBridge } from '../host/bridge.js';
import type { SubscribeRunEventsInput } from '../runtime/sse.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders Clawee desktop app shell without Codex product branding', async () => {
    render(<App fileService={createFileService()} />);

    expect(await screen.findByRole('button', { name: '新对话' })).toBeInTheDocument();
    expect(await screen.findByText('要在 content-design 中处理什么？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 完全访问' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
    expect(screen.queryByText('跟随全局模型')).not.toBeInTheDocument();
    expect(screen.queryByText('跟随全局配置')).not.toBeInTheDocument();
    expect(screen.queryByText('5.5 超高')).not.toBeInTheDocument();
    expect(screen.queryByText('本地模式')).not.toBeInTheDocument();
    expect(screen.queryByText('open-clawee')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex Runtime Workbench')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime 地址')).not.toBeInTheDocument();
    expect(screen.queryByText(/Token|API Key|连接 Runtime/)).not.toBeInTheDocument();
  });

  it('does not allow chat submission before the local runtime is connected', async () => {
    const user = userEvent.setup();
    const prompt = '整理企业 Agent 工作台设计';

    render(<App fileService={createFileService()} />);

    const textbox = await screen.findByRole('textbox', { name: '输入任务' });
    expect(textbox).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.getByPlaceholderText('正在连接本地运行内核')).toBeInTheDocument();

    await user.keyboard(prompt);

    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
    expect(screen.queryByText(/收到。我会先围绕/)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock 文件变更/)).not.toBeInTheDocument();
  });

  it('starts a real runtime run, records SSE events, opens run detail, and shows Codex info in settings', async () => {
    const user = userEvent.setup();
    const prompt = 'Reply with OK only.';
    const codexStatus = createCodexStatusResponse();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(codexStatus);
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_from_api', status: 'running' }, { status: 202 });
      if (url.endsWith('/runs/run_1/diagnostics')) return jsonResponse(createRunDiagnosticsResponse(codexStatus));
      throw new Error(`Unexpected request ${url}`);
    };
    let sseFetchImpl: SubscribeRunEventsInput['fetchImpl'];
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      sseFetchImpl = input.fetchImpl;
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'running' }, 1));
      input.onEvent(
        createRuntimeEvent(
          'unknown_event',
          {
            type: 'unknown_event',
            rawEventId: 'raw_ignored',
            codexType: 'item.completed'
          },
          2
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'reasoning_summary',
          {
            type: 'reasoning_summary',
            text: '我会先确认输入要求。\n\n然后返回指定文本。',
            format: 'plain_text',
            delivery: 'summary'
          },
          3
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: 'OK',
            format: 'plain_text',
            delivery: 'message'
          },
          4
        )
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 5));
    };

    render(
      <StrictMode>
        <App
          fileService={createFileService()}
          hostBridge={hostBridge}
          runtimeFetch={runtimeFetch}
          subscribeRunEvents={subscribeRunEvents}
        />
      </StrictMode>
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    expect(screen.queryByText('codex-cli test')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
    expect(await screen.findByText('我会先确认输入要求。')).toBeInTheDocument();
    expect(await screen.findByText('然后返回指定文本。')).toBeInTheDocument();
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(screen.queryByText('完成')).not.toBeInTheDocument();
    expect(screen.queryByText('unknown_event')).not.toBeInTheDocument();
    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({ title: prompt });
    expect(createThreadBody).not.toHaveProperty('model');
    expect(createThreadBody).not.toHaveProperty('reasoning');
    expect(JSON.parse(String(findPostCall(fetchCalls, '/runs')?.init?.body))).toEqual({
      threadId: 'thread_from_api',
      prompt,
      resumeMode: 'auto'
    });
    expect(sseFetchImpl).toBe(runtimeFetch);

    const runDetailButton = screen.getAllByRole('button', { name: '查看运行详情 run_1' })[0];
    if (runDetailButton === undefined) throw new Error('Expected a run detail button');
    await user.click(runDetailButton);

    expect(await screen.findByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/"runId": "run_1"/)).toBeInTheDocument());
    expect(screen.queryByText('codex-cli test')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置 账户' }));
    await user.click(screen.getByRole('button', { name: '关于 Clawee' }));

    expect(await screen.findByText('高级信息')).toBeInTheDocument();
    expect(screen.getAllByText('codex-cli test').length).toBeGreaterThan(0);
  });

  it('keeps the process button when a completed runtime turn has no process agent messages', async () => {
    const user = userEvent.setup();
    const prompt = '只回复 OK';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_from_api', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'queued' }, 1));
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'running' }, 2));
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: 'OK',
            format: 'plain_text',
            delivery: 'message'
          },
          3
        )
      );
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'finalizing' }, 4));
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 5));
    };

    const { container } = render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.getByText('运行详情')).toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('finalizing')).not.toBeInTheDocument();
  });

  it('shows a thinking indicator while the runtime has started but has not emitted assistant text yet', async () => {
    const user = userEvent.setup();
    const prompt = '你都会做什么';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_from_api', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    let releaseSse!: () => void;
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'running' }, 1));
      await new Promise<void>(resolve => {
        releaseSse = resolve;
      });
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();

    await act(async () => {
      releaseSse();
    });
  });

  it('renders Codex process agent messages as folded process text and only the final agent message as Clawee reply', async () => {
    const user = userEvent.setup();
    const prompt = '检查当前目录并总结';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_from_api', status: 'running' }, { status: 202 });
      if (url.endsWith('/runs/run_1/diagnostics')) return jsonResponse(createRunDiagnosticsResponse(createCodexStatusResponse()));
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'running' }, 1));
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '我会先确认当前目录，再读取必要文件。',
            format: 'plain_text',
            delivery: 'message'
          },
          2
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'tool_use',
          {
            type: 'tool_use',
            toolCallId: 'call_1',
            name: 'command_execution',
            input: { command: 'pwd' }
          },
          3
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'tool_result',
          {
            type: 'tool_result',
            toolCallId: 'call_1',
            output: '/repo',
            exitCode: 0,
            isError: false
          },
          4
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '当前目录是 /repo，检查已完成。',
            format: 'plain_text',
            delivery: 'message'
          },
          5
        )
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 6));
    };

    const { container } = render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    expect(screen.getByText('我会先确认当前目录，再读取必要文件。')).toBeInTheDocument();
    expect(screen.getByText('使用工具 command_execution')).toBeInTheDocument();
    expect(screen.getByText('工具完成 command_execution')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
    expect(screen.getByText('当前目录是 /repo，检查已完成。')).toBeInTheDocument();
    expect(container.querySelectorAll('.timeline-assistant_message')).toHaveLength(1);
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
  });

  it('starts a clean new conversation from the sidebar action', async () => {
    const user = userEvent.setup();
    const prompt = '生成一份项目周报';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_history_1',
              title: '整理本周项目进展',
              updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
            })
          ]
        });
      }
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_history_1', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '周报已整理。',
            format: 'plain_text',
            delivery: 'message'
          },
          1
        )
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 2));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '整理本周项目进展 4天' }));
    expect(await screen.findByRole('heading', { name: '整理本周项目进展' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('周报已整理。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新对话' }));

    expect(await screen.findByRole('heading', { name: '新对话' })).toBeInTheDocument();
    expect(screen.getByText('要在 content-design 中处理什么？')).toBeInTheDocument();
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
    expect(screen.queryByText('周报已整理。')).not.toBeInTheDocument();
  });

  it('creates Playground threads with the Playground cwd so they survive refresh grouping', async () => {
    const user = userEvent.setup();
    const prompt = 'hi';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_playground',
            title: prompt,
            cwd: '/Users/test/develop/clawee/playground',
            canonicalCwd: '/Users/test/develop/clawee/playground'
          })
        }, { status: 201 });
      }
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_playground', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 1));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Playground' }));
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: prompt,
      cwd: '~/develop/clawee/playground',
      workspaceMode: 'external'
    });
  });

  it('shows refreshed Playground conversations under Playground', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_playground',
              title: 'Playground 历史会话',
              cwd: '/Users/test/develop/clawee/playground',
              canonicalCwd: '/Users/test/develop/clawee/playground',
              updatedAt: new Date('2026-07-09T02:00:00.000Z').toISOString()
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_playground/history')) {
        return jsonResponse({ threadId: 'thread_playground', codexThreadId: null, items: [] });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    expect(await screen.findByRole('button', { name: /Playground 历史会话/ })).toBeInTheDocument();
  });

  it('clears the current conversation surface when switching projects', async () => {
    const user = userEvent.setup();
    const prompt = '生成一份项目周报';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_from_api', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '周报已整理。',
            format: 'plain_text',
            delivery: 'message'
          },
          1
        )
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 2));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('周报已整理。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'bili' }));

    expect(await screen.findByRole('heading', { name: '新对话' })).toBeInTheDocument();
    expect(screen.getByText('要在 bili 中处理什么？')).toBeInTheDocument();
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
    expect(screen.queryByText('周报已整理。')).not.toBeInTheDocument();
  });

  it('loads conversation history from runtime threads instead of mock conversations', async () => {
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_codex_history',
              title: '真实 Codex 历史会话',
              codexThreadId: 'codex-history-1',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            })
          ]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /真实 Codex 历史会话/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整理本周项目进展 4天' })).not.toBeInTheDocument();
  });

  it('loads the selected Codex history transcript into the conversation surface', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_codex_history',
              title: '真实 Codex 历史会话',
              codexThreadId: 'codex-history-1',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_codex_history/history')) {
        return jsonResponse({
          threadId: 'thread_codex_history',
          codexThreadId: 'codex-history-1',
          items: [
            {
              id: 'history_user_1',
              type: 'user_message',
              text: '分析这个 skill 是干什么的',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'history_reasoning_1',
              type: 'reasoning_summary',
              text: '先读取 skill 说明。',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'history_assistant_1',
              type: 'assistant_message',
              text: '这个 skill 用于分析选品资料。',
              createdAt: new Date(0).toISOString()
            }
          ]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /真实 Codex 历史会话/ }));

    expect(await findTimelineUserMessage('分析这个 skill 是干什么的')).toBeInTheDocument();
    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    expect(screen.getByText('先读取 skill 说明。')).toBeInTheDocument();
    expect(screen.getByText('这个 skill 用于分析选品资料。')).toBeInTheDocument();
  });

  it('从会话头部点击文件会进入真实文件工作区', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files',
              title: '真实文件会话',
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_files/history')) {
        return jsonResponse({ threadId: 'thread_files', codexThreadId: null, items: [] });
      }
      if (url.includes('/workspace/files/directory?')) {
        return jsonResponse({
          threadId: 'thread_files',
          rootName: 'clawee-agent',
          rootPathLabel: '/Users/test/develop/clawee/clawee-agent',
          path: '',
          suggestedOpenPath: 'README.md',
          truncated: false,
          warnings: [],
          nodes: [
            {
              path: 'README.md',
              name: 'README.md',
              depth: 0,
              type: 'file',
              meta: {
                kind: 'markdown',
                mime: 'text/markdown',
                size: 1,
                mtimeMs: 1,
                previewable: true,
                editable: true,
                readonly: false
              }
            }
          ]
        });
      }
      if (url.includes('/workspace/files/meta?')) {
        return jsonResponse({
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          kind: 'markdown',
          mime: 'text/markdown',
          size: 1,
          mtimeMs: 1,
          versionToken: 'v1',
          previewable: true,
          editable: true,
          readonly: false
        });
      }
      if (url.includes('/workspace/files/content?')) {
        return jsonResponse({
          meta: {
            path: 'README.md',
            name: 'README.md',
            type: 'file',
            kind: 'markdown',
            mime: 'text/markdown',
            size: 1,
            mtimeMs: 1,
            versionToken: 'v1',
            previewable: true,
            editable: true,
            readonly: false
          },
          content: '# Workspace',
          encoding: 'utf8'
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /真实文件会话/ }));
    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(await screen.findByText('打开文件')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toBeInTheDocument();
    expect(screen.queryByText('暂无预览内容')).not.toBeInTheDocument();
  });

  it('点击详情不会打开旧 mock 详情，点击文件才进入真实文件工作区', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files',
              title: '真实文件会话',
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_files/history')) {
        return jsonResponse({ threadId: 'thread_files', codexThreadId: null, items: [] });
      }
      if (url.includes('/workspace/files/directory?')) {
        return jsonResponse({
          threadId: 'thread_files',
          rootName: 'clawee-agent',
          rootPathLabel: '/Users/test/develop/clawee/clawee-agent',
          path: '',
          suggestedOpenPath: 'README.md',
          truncated: false,
          warnings: [],
          nodes: [
            {
              path: 'README.md',
              name: 'README.md',
              depth: 0,
              type: 'file',
              meta: {
                kind: 'markdown',
                mime: 'text/markdown',
                size: 1,
                mtimeMs: 1,
                previewable: true,
                editable: true,
                readonly: false
              }
            }
          ]
        });
      }
      if (url.includes('/workspace/files/meta?')) {
        return jsonResponse({
          path: 'README.md',
          name: 'README.md',
          type: 'file',
          kind: 'markdown',
          mime: 'text/markdown',
          size: 1,
          mtimeMs: 1,
          versionToken: 'v1',
          previewable: true,
          editable: true,
          readonly: false
        });
      }
      if (url.includes('/workspace/files/content?')) {
        return jsonResponse({
          meta: {
            path: 'README.md',
            name: 'README.md',
            type: 'file',
            kind: 'markdown',
            mime: 'text/markdown',
            size: 1,
            mtimeMs: 1,
            versionToken: 'v1',
            previewable: true,
            editable: true,
            readonly: false
          },
          content: '# Workspace',
          encoding: 'utf8'
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /真实文件会话/ }));

    await user.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.queryByRole('heading', { name: 'README.md' })).not.toBeInTheDocument();
    expect(screen.queryByText('已编辑 docs/atoms.md')).not.toBeInTheDocument();
    expect(screen.queryByText('+903 -0')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无预览内容')).not.toBeInTheDocument();
    expect(screen.queryByText('打开文件')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '文件' }));
    expect(await screen.findByText('打开文件')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toBeInTheDocument();
  });

  it('focuses the most recent runtime project when the default project has no history', async () => {
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_codex_clawee_agent',
              title: '真实 Codex 当前项目历史',
              codexThreadId: 'codex-history-clawee-agent',
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent',
              updatedAt: new Date().toISOString()
            })
          ]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'clawee-agent' })).toHaveAttribute('aria-current', 'true');
    expect(await screen.findByRole('button', { name: /真实 Codex 当前项目历史/ })).toBeInTheDocument();
  });

  it('creates a runtime thread before starting the first run in a new conversation', async () => {
    const user = userEvent.setup();
    const prompt = '跟进今天客户沟通';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        return jsonResponse({ thread: createThreadResponse({ id: 'thread_created_from_chat', title: prompt }) }, { status: 201 });
      }
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_created_from_chat', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '已跟进。',
            format: 'plain_text',
            delivery: 'message'
          },
          1
        )
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 2));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('已跟进。')).toBeInTheDocument();
    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: prompt,
      workspaceMode: 'external'
    });
    expect(createThreadBody).not.toHaveProperty('model');
    expect(createThreadBody).not.toHaveProperty('reasoning');
    expect(JSON.parse(String(findPostCall(fetchCalls, '/runs')?.init?.body))).toEqual({
      threadId: 'thread_created_from_chat',
      prompt,
      resumeMode: 'auto'
    });
    expect(await screen.findByRole('button', { name: /跟进今天客户沟通/ })).toBeInTheDocument();
  });

  it('applies selected composer runtime config when creating a new thread', async () => {
    const user = userEvent.setup();
    const prompt = '用高强度推理生成方案';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        return jsonResponse(
          {
            thread: createThreadResponse({
              id: 'thread_configured_from_chat',
              title: prompt,
              sandbox: 'danger-full-access',
              reasoning: 'xhigh'
            })
          },
          { status: 201 }
        );
      }
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_configured_from_chat', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '选择访问权限 完全访问' }));
    await user.click(screen.getByRole('menuitemradio', { name: /工作区读写/ }));
    await user.click(screen.getByRole('button', { name: '选择访问权限 工作区读写' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));
    await user.click(screen.getByRole('button', { name: '选择模型 默认模型' }));
    await user.click(screen.getByRole('menuitemradio', { name: /默认模型 超高/ }));
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    await findTimelineUserMessage(prompt);
    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: prompt,
      sandbox: 'danger-full-access',
      reasoning: 'xhigh'
    });
    expect(createThreadBody).not.toHaveProperty('model');
    expect(JSON.parse(String(findPostCall(fetchCalls, '/runs')?.init?.body))).toEqual({
      threadId: 'thread_configured_from_chat',
      prompt,
      resumeMode: 'auto',
      reasoning: 'xhigh'
    });
  });

  it('does not override immutable thread config when sending in an existing conversation', async () => {
    const user = userEvent.setup();
    const prompt = '继续处理这个会话';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_existing',
              title: '已有会话',
              sandbox: 'read-only',
              reasoning: null
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_existing/history')) {
        return jsonResponse({ threadId: 'thread_existing', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_existing', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /已有会话/ }));
    await user.click(screen.getByRole('button', { name: '选择模型 默认模型' }));
    await user.click(screen.getByRole('menuitemradio', { name: /默认模型 超高/ }));
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    await findTimelineUserMessage(prompt);
    expect(findPostCall(fetchCalls, '/threads')).toBeUndefined();
    expect(JSON.parse(String(findPostCall(fetchCalls, '/runs')?.init?.body))).toEqual({
      threadId: 'thread_existing',
      prompt,
      resumeMode: 'auto'
    });
  });

  it('opens settings and returns to the app', async () => {
    const user = userEvent.setup();

    render(<App fileService={createFileService()} />);

    await user.click(await screen.findByRole('button', { name: '设置 账户' }));

    expect(await screen.findByRole('heading', { name: '常规' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回应用' }));

    expect(await screen.findByRole('heading', { name: '新对话' })).toBeInTheDocument();
    expect(await screen.findByText('要在 content-design 中处理什么？')).toBeInTheDocument();
  });
});

function createFileService(path = 'docs/atoms.md', content = '# Atoms') {
  const treeNodes: FileTreeNode[] = [{ type: 'file', name: path.split('/').at(-1) ?? path, path, depth: 0 }];

  return {
    async listTree() {
      return treeNodes;
    },
    async openFile(openPath: string) {
      return createWorkspaceFile(openPath, content);
    },
    async saveFile(savePath: string, nextContent: string) {
      return createWorkspaceFile(savePath, nextContent);
    }
  };
}

function createWorkspaceFile(path: string, content: string): WorkspaceFile {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    language: 'markdown',
    content,
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  };
}

function createHostBridge(): HostBridge {
  return {
    kind: 'browser',
    async readConnectionConfig() {
      return null;
    },
    async openExternal() {
      return;
    },
    async revealPath() {
      return { ok: false, code: 'UNSUPPORTED', message: 'unsupported in test' };
    },
    async notify() {
      return;
    }
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
}

function createCodexStatusResponse(): CodexStatusResponse {
  return {
    codexBin: 'codex',
    codexVersion: 'codex-cli test',
    codexHome: '/Users/test/.codex',
    codexHomeMode: 'global',
    codexHomeSource: 'default',
    codexHomeWritable: true,
    capabilities: {},
    diagnostics: []
  };
}

function createRunDiagnosticsResponse(codexStatus: CodexStatusResponse): RunDiagnosticsResponse {
  return {
    runId: 'run_1',
    files: [],
    codexStatusSnapshot: codexStatus,
    warnings: []
  };
}

function createThreadResponse(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread_from_api',
    title: 'Thread from API',
    codexThreadId: null,
    cwd: '/Users/test/develop/content-design',
    canonicalCwd: '/Users/test/develop/content-design',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'read-only',
    status: 'active',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    archivedAt: null,
    ...overrides
  };
}

function findPostCall(calls: Array<{ url: string; init?: RequestInit }>, path: string) {
  return calls.find(call => call.url.endsWith(path) && call.init?.method === 'POST');
}

async function findTimelineUserMessage(text: string) {
  return waitFor(() => {
    const messages = Array.from(document.querySelectorAll('.timeline-user_message'));
    const match = messages.find(message => message.textContent?.includes(text));
    if (match === undefined) throw new Error(`Expected timeline user message: ${text}`);
    return match;
  });
}

function createRuntimeEvent<Type extends AgentEventEnvelope['type']>(
  type: Type,
  payload: Extract<AgentEventPayload, { type: Type }>,
  seq: number
): AgentEventEnvelope {
  return {
    id: `event_${seq}`,
    runId: 'run_1',
    seq,
    ts: new Date(0).toISOString(),
    type,
    payload,
    normalizerVersion: 1
  } as AgentEventEnvelope;
}
