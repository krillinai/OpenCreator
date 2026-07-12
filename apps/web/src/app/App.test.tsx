import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentEventEnvelope,
  AgentEventPayload,
  CodexMcpListResponse,
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
  CodexStatusResponse,
  RunDiagnosticsResponse,
  RunResponse,
  ScheduleResponse,
  ThreadResponse
} from '@clawee/protocol';
import { App } from './App.js';
import type { HostBridge } from '../host/bridge.js';
import type { SubscribeRunEventsInput } from '../runtime/sse.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';

vi.mock('react-virtuoso', async () => import('../test/react-virtuoso-mock.js'));

describe('App', () => {
  it('restores a primary page directly from its URL', async () => {
    window.location.hash = '#/search';

    render(<App />);

    expect(await screen.findByRole('heading', { name: '搜索会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toHaveAttribute('aria-current', 'page');
  });

  it('updates the copyable URL when navigating between primary pages', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: '插件' }));

    await waitFor(() => expect(window.location.hash).toBe('#/plugins'));
    expect(await screen.findByLabelText('Skill 功能目录')).toBeInTheDocument();
  });

  it('opens a workspace file directly from a copyable URL', async () => {
    window.location.hash = '#/files?path=docs%2Fatoms.md';

    render(<App fileService={createFileService()} />);

    expect(await screen.findByRole('button', { name: '关闭文件工作区' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/files?path=docs%2Fatoms.md');
  });

  it('closes mobile navigation after opening a view and when browser history goes back', async () => {
    const user = userEvent.setup();
    render(<App />);

    const navigation = await screen.findByLabelText('Clawee 导航');
    await user.click(screen.getByRole('button', { name: '打开导航' }));
    expect(navigation).toHaveAttribute('data-mobile-open', 'true');

    await user.click(screen.getByRole('button', { name: '插件' }));
    expect(navigation).toHaveAttribute('data-mobile-open', 'false');

    await user.click(screen.getByRole('button', { name: '打开导航' }));
    expect(navigation).toHaveAttribute('data-mobile-open', 'true');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await waitFor(() => expect(navigation).toHaveAttribute('data-mobile-open', 'false'));
  });

  it('adds a mobile history entry and consumes it when the drawer closes', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 920px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const pushState = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '打开导航' }));
    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ claweeMobileNavigation: true }),
      ''
    );

    await user.click(screen.getByRole('button', { name: '关闭导航' }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Clawee 导航')).toHaveAttribute('data-mobile-open', 'false');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  });

  it('renders Clawee desktop app shell without Codex product branding', async () => {
    render(<App fileService={createFileService()} />);

    expect(await screen.findByRole('button', { name: '新对话' })).toBeInTheDocument();
    expect(await screen.findByText('要在 content-design 中处理什么？')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-lightfall-background')).toBeInTheDocument();
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

  it('opens the schedules workspace and shows a schedule run detail without loading a thread', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/schedules')) {
        return jsonResponse({ schedules: [createScheduleResponse()] });
      }
      if (url.endsWith('/runs/run_schedule/diagnostics')) {
        return jsonResponse({
          ...createRunDiagnosticsResponse(createCodexStatusResponse()),
          runId: 'run_schedule'
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
    await user.click(screen.getByRole('button', { name: '已安排' }));

    expect(await screen.findByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Clawee：已安排' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看上次运行' }));

    expect(await screen.findByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    expect(screen.getByText('run_schedule')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeInTheDocument();
  });

  it('uses the selected thread run registry without loading runs for every thread', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const runRequests: string[] = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({ id: 'thread_a', title: '会话 A' }),
            createThreadResponse({ id: 'thread_b', title: '会话 B' })
          ]
        });
      }
      if (url.endsWith('/threads/thread_a/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_a', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_b/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_b', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_a/runs?limit=50')) {
        runRequests.push('thread_a');
        return jsonResponse({
          runs: [
            createRunResponse({
              id: 'run_a',
              threadId: 'thread_a',
              status: 'running'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_b/runs?limit=50')) {
        runRequests.push('thread_b');
        return jsonResponse({ runs: [] });
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
    expect(runRequests).toEqual([]);

    await user.click(await screen.findByRole('button', { name: /会话 A/ }));

    expect(await screen.findByRole('button', { name: '停止任务' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByLabelText('正在运行')).toBeInTheDocument();
    expect(runRequests).toEqual(['thread_a']);

    await user.click(await screen.findByRole('button', { name: /会话 B/ }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(runRequests).toEqual(['thread_a', 'thread_b']);
  });

  it('keeps a run subscribed in the background without leaking events into another conversation', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({ id: 'thread_a', title: '会话 A' }),
            createThreadResponse({ id: 'thread_b', title: '会话 B' })
          ]
        });
      }
      if (url.endsWith('/threads/thread_a/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_a', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_b/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_b', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_a/runs?limit=50')) return jsonResponse({ runs: [] });
      if (url.endsWith('/threads/thread_b/runs?limit=50')) return jsonResponse({ runs: [] });
      if (url.endsWith('/runs') && init?.method === 'POST') {
        return jsonResponse(
          createRunResponse({ id: 'run_a', threadId: 'thread_a', status: 'running' }),
          { status: 202 }
        );
      }
      if (url.endsWith('/runs/run_a/diagnostics')) {
        return jsonResponse({
          ...createRunDiagnosticsResponse(createCodexStatusResponse()),
          runId: 'run_a'
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    const subscriptions: SubscribeRunEventsInput[] = [];
    let activeSubscription: SubscribeRunEventsInput | undefined;
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      subscriptions.push(input);
      activeSubscription = input;
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '切换前的实时进度',
            format: 'plain_text',
            delivery: 'message'
          },
          1,
          'run_a'
        )
      );
      await new Promise<void>(resolve => {
        input.signal?.addEventListener('abort', () => resolve(), { once: true });
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
    await user.click(await screen.findByRole('button', { name: /会话 A/ }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    });

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '执行长任务');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(subscriptions).toHaveLength(1));
    expect(subscriptions[0]?.fromSeq).toBe(0);
    expect(await screen.findByRole('button', { name: '停止任务' })).toBeInTheDocument();
    expect(await screen.findByText('切换前的实时进度')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /会话 B/ }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    });
    expect(activeSubscription?.signal?.aborted).toBe(false);
    expect(screen.queryByText('切换前的实时进度')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /会话 A.*正在运行/ })).toBeInTheDocument();

    await act(async () => {
      activeSubscription?.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '后台完成后的内容',
            format: 'plain_text',
            delivery: 'message'
          },
          2,
          'run_a'
        )
      );
      activeSubscription?.onEvent(
        createRuntimeEvent(
          'done',
          { type: 'done', status: 'succeeded', terminationReason: 'completed' },
          3,
          'run_a'
        )
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /会话 A/ })).not.toHaveAccessibleName(/正在运行/);
    });
    expect(screen.queryByText('后台完成后的内容')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /会话 A/ }));

    expect(await findTimelineUserMessage('执行长任务')).toBeInTheDocument();
    expect(document.querySelectorAll('.timeline-user_message')).toHaveLength(1);
    expect(await screen.findByText('后台完成后的内容')).toBeInTheDocument();
    await user.click(screen.getByText('思考过程'));
    expect(screen.getAllByText('切换前的实时进度')).toHaveLength(1);
    expect(subscriptions).toHaveLength(1);
  });

  it('routes a late cancellation failure back to the run conversation after switching away', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const cancelResponse = createDeferred<Response>();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({ id: 'thread_a', title: '会话 A' }),
            createThreadResponse({ id: 'thread_b', title: '会话 B' })
          ]
        });
      }
      if (url.endsWith('/threads/thread_a/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_a', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_b/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_b', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_a/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({ id: 'run_a', threadId: 'thread_a', status: 'running' })]
        });
      }
      if (url.endsWith('/threads/thread_b/runs?limit=50')) return jsonResponse({ runs: [] });
      if (url.endsWith('/runs/run_a/cancel') && init?.method === 'POST') {
        return cancelResponse.promise;
      }
      if (url.endsWith('/runs/run_a')) {
        return jsonResponse(createRunResponse({ id: 'run_a', threadId: 'thread_a', status: 'running' }));
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async input => {
          await new Promise<void>(resolve => {
            input.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
        }}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /会话 A/ }));
    await user.click(await screen.findByRole('button', { name: '停止任务' }));
    await user.click(screen.getByRole('button', { name: /会话 B/ }));

    await act(async () => {
      cancelResponse.resolve(jsonResponse(
        { error: { code: 'CANCEL_FAILED', message: '停止任务失败' } },
        { status: 500 }
      ));
      await cancelResponse.promise;
    });

    expect(screen.queryByText('停止任务失败')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /会话 A/ }));
    expect(await screen.findByText('停止任务失败')).toBeInTheDocument();
  });

  it('ignores a late already-terminal cancellation response after the run has completed', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const cancelResponse = createDeferred<Response>();
    let subscription: SubscribeRunEventsInput | undefined;
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [createThreadResponse({ id: 'thread_a', title: '会话 A' })]
        });
      }
      if (url.endsWith('/threads/thread_a/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_a', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_a/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({ id: 'run_a', threadId: 'thread_a', status: 'running' })]
        });
      }
      if (url.endsWith('/runs/run_a/cancel') && init?.method === 'POST') {
        return cancelResponse.promise;
      }
      if (url.endsWith('/runs/run_a/diagnostics')) {
        return jsonResponse({
          ...createRunDiagnosticsResponse(createCodexStatusResponse()),
          runId: 'run_a'
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async input => {
          subscription = input;
          await new Promise<void>(resolve => {
            input.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
        }}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /会话 A/ }));
    await user.click(await screen.findByRole('button', { name: '停止任务' }));

    await act(async () => {
      subscription?.onEvent(
        createRuntimeEvent(
          'done',
          { type: 'done', status: 'succeeded', terminationReason: 'completed' },
          1,
          'run_a'
        )
      );
      await Promise.resolve();
    });

    await act(async () => {
      cancelResponse.resolve(jsonResponse(
        {
          error: {
            code: 'RUN_ALREADY_TERMINAL',
            message: 'Run is already terminal'
          }
        },
        { status: 409 }
      ));
      await cancelResponse.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: '停止任务' })).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/Run is already terminal|停止任务失败/)).not.toBeInTheDocument();
  });

  it('restores a running conversation after an unexpected SSE disconnect', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    let runCompleted = false;
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [createThreadResponse({ id: 'thread_restore', title: '断线恢复会话' })]
        });
      }
      if (url.endsWith('/threads/thread_restore/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_restore',
          codexThreadId: null,
          items: [
            {
              id: 'history_user_restore',
              type: 'user_message',
              text: '继续生成长内容',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'history_assistant_restore',
              type: 'assistant_message',
              text: '第一段内容',
              createdAt: new Date(0).toISOString()
            }
          ]
        });
      }
      if (url.endsWith('/threads/thread_restore/runs?limit=50')) {
        return jsonResponse({
          runs: runCompleted
            ? []
            : [{
                ...createRunResponse({
                  id: 'run_restore',
                  threadId: 'thread_restore',
                  status: 'running'
                }),
                lastEventSeq: 1
              }]
        });
      }
      if (url.endsWith('/runs/run_restore/diagnostics')) {
        return jsonResponse({
          ...createRunDiagnosticsResponse(createCodexStatusResponse()),
          runId: 'run_restore'
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const subscriptions: SubscribeRunEventsInput[] = [];
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      subscriptions.push(input);
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '第一段内容',
            format: 'plain_text',
            delivery: 'message'
          },
          1,
          'run_restore'
        )
      );
      if (subscriptions.length === 1) return;

      input.onEvent(
        createRuntimeEvent(
          'reasoning_summary',
          {
            type: 'reasoning_summary',
            text: '继续生成后续内容',
            format: 'plain_text',
            delivery: 'summary'
          },
          2,
          'run_restore'
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '第二段内容',
            format: 'plain_text',
            delivery: 'message'
          },
          3,
          'run_restore'
        )
      );
      input.onEvent(
        createRuntimeEvent(
          'done',
          { type: 'done', status: 'succeeded', terminationReason: 'completed' },
          4,
          'run_restore'
        )
      );
      runCompleted = true;
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
    await user.click(await screen.findByRole('button', { name: /断线恢复会话/ }));

    await waitFor(() => expect(subscriptions).toHaveLength(2), { timeout: 2_000 });
    expect(subscriptions[0]?.fromSeq).toBe(0);
    expect(subscriptions[1]?.fromSeq).toBe(1);
    expect(await screen.findByText('第二段内容')).toBeInTheDocument();
    await user.click(await screen.findByText('思考过程'));
    expect(await screen.findAllByText('第一段内容')).toHaveLength(1);
    expect(screen.queryByText('SSE connection closed unexpectedly')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '停止任务' })).not.toBeInTheDocument();
    });
  });

  it('keeps pending run starts isolated when switching threads', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const runResolvers = new Map<string, (response: Response) => void>();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({ id: 'thread_a', title: '会话 A' }),
            createThreadResponse({ id: 'thread_b', title: '会话 B' })
          ]
        });
      }
      if (url.endsWith('/threads/thread_a/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_a', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_b/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_b', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_a/runs?limit=50')) return jsonResponse({ runs: [] });
      if (url.endsWith('/threads/thread_b/runs?limit=50')) return jsonResponse({ runs: [] });
      if (url.endsWith('/runs') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { threadId: string };
        return new Promise<Response>(resolve => {
          runResolvers.set(body.threadId, resolve);
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
    await user.click(await screen.findByRole('button', { name: /会话 A/ }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    });
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '任务 A');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await user.click(await screen.findByRole('button', { name: /会话 B/ }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    });
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '任务 B');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByRole('button', { name: '停止任务' })).toBeInTheDocument();
    await act(async () => {
      runResolvers.get('thread_a')?.(
        jsonResponse(
          createRunResponse({ id: 'run_a', threadId: 'thread_a', status: 'running' }),
          { status: 202 }
        )
      );
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '停止任务' })).toBeInTheDocument();

    await act(async () => {
      runResolvers.get('thread_b')?.(
        jsonResponse(
          createRunResponse({ id: 'run_b', threadId: 'thread_b', status: 'running' }),
          { status: 202 }
        )
      );
      await Promise.resolve();
    });
  });

  it('loads runtime skills and MCP servers into the composer slash menu', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse({
          codexHome: '/Users/test/.codex',
          codexHomeMode: 'global',
          skillsPath: '/Users/test/.codex/skills',
          skillsWritable: true,
          requiresWriteConfirmation: true,
          diagnostics: [],
          skills: [
            {
              id: 'brainstorming',
              name: 'brainstorming',
              description: '需求梳理和方案发散',
              status: 'valid',
              diagnostics: [],
              codexHome: '/Users/test/.codex',
              codexHomeMode: 'global',
              skillsPath: '/Users/test/.codex/skills',
              skillPath: '/Users/test/.codex/skills/brainstorming',
              skillFilePath: '/Users/test/.codex/skills/brainstorming/SKILL.md'
            }
          ]
        });
      }
      if (url.endsWith('/codex/mcp')) {
        return jsonResponse({
          codexHome: '/Users/test/.codex',
          codexHomeMode: 'global',
          requiresWriteConfirmation: true,
          diagnostics: [],
          servers: [
            {
              name: 'github',
              transport: 'stdio',
              status: 'configured',
              command: 'node',
              args: ['server.js'],
              envKeys: ['GITHUB_TOKEN'],
              hasSecrets: true,
              codexHome: '/Users/test/.codex',
              codexHomeMode: 'global',
              diagnostics: []
            }
          ]
        });
      }
      if (url.endsWith('/codex/skill-market/install-records')) return jsonResponse({ records: [] });
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
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/');

    expect(await screen.findByRole('listbox', { name: '能力菜单' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /brainstorming/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /github/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /设置 Goal/ })).toBeInTheDocument();
  });

  it('connects the plugin market to real install state and creates draft conversations', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let installed = false;
    let skillRequests = 0;
    let recordRequests = 0;
    let createdThreadCount = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        skillRequests += 1;
        return jsonResponse(createSkillListResponse(installed ? [createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })] : []));
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        recordRequests += 1;
        return jsonResponse({ records: installed ? [createSkillMarketInstallRecord({ skillId: 'frontend-slides' })] : [] });
      }
      if (url.endsWith('/codex/skill-market/frontend-slides/install') && init?.method === 'POST') {
        installed = true;
        return jsonResponse({
          skill: createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' }),
          operation: {},
          record: createSkillMarketInstallRecord({ skillId: 'frontend-slides' })
        });
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        createdThreadCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse(
          {
            thread: createThreadResponse({
              id: `thread_skill_${createdThreadCount}`,
              title: String(body.title),
              cwd: String(body.cwd),
              canonicalCwd: String(body.cwd),
              workspaceMode: body.workspaceMode === 'external' ? 'external' : 'managed',
              profile: String(body.profile),
              sandbox: body.sandbox === 'danger-full-access' ? 'danger-full-access' : 'read-only'
            })
          },
          { status: 201 }
        );
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const threadCreateCalls = () =>
      fetchCalls.filter(call => call.url.endsWith('/threads') && call.init?.method === 'POST');

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await waitFor(() => expect(skillRequests).toBe(1));
    await waitFor(() => expect(recordRequests).toBe(1));

    await user.click(screen.getByRole('button', { name: '插件' }));
    expect(screen.queryByRole('heading', { name: 'Clawee：插件' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Skill 功能目录' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));

    const frontendCard = getSkillMarketCard('frontend-slides');
    expect(within(frontendCard).getByText('网页演示稿生成')).toBeInTheDocument();
    await user.click(within(frontendCard).getByRole('button', { name: '安装' }));

    await waitFor(() => expect(skillRequests).toBe(2));
    await waitFor(() => expect(recordRequests).toBe(2));
    expect(findPostCall(fetchCalls, '/codex/skill-market/frontend-slides/install')).toBeDefined();
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());

    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' }));

    await waitFor(() => expect(threadCreateCalls()).toHaveLength(1));
    const createThreadBody = JSON.parse(String(threadCreateCalls()[0]?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: '网页演示稿生成',
      cwd: '~/develop/content-design',
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'danger-full-access'
    });
    expect(createThreadBody).not.toHaveProperty('model');
    expect(createThreadBody).not.toHaveProperty('reasoning');
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
    expect(await screen.findByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();
    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await waitFor(() => {
      expect(textbox).toHaveValue('$frontend-slides ');
      expect(textbox).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(getSkillMarketCard('frontend-slides')).toBeInTheDocument());
    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' }));

    await waitFor(() => expect(threadCreateCalls()).toHaveLength(2));
    expect(JSON.parse(String(threadCreateCalls()[1]?.init?.body))).toMatchObject({
      title: '网页演示稿生成'
    });
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
  });

  it('keeps the full catalog and MCP capabilities when initial install records fail', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse(createSkillListResponse([
          createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })
        ]));
      }
      if (url.endsWith('/codex/mcp')) {
        return jsonResponse({
          codexHome: '/Users/test/.codex',
          codexHomeMode: 'global',
          requiresWriteConfirmation: true,
          diagnostics: [],
          servers: [
            {
              name: 'github',
              transport: 'stdio',
              status: 'configured',
              command: 'node',
              args: ['server.js'],
              envKeys: [],
              hasSecrets: false,
              codexHome: '/Users/test/.codex',
              codexHomeMode: 'global',
              diagnostics: []
            }
          ]
        });
      }
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({ error: { code: 'LOAD_FAILED', message: 'records failed' } }, { status: 500 });
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
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/');
    expect(await screen.findByRole('option', { name: /github/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));
    expect(screen.getByRole('alert')).toHaveTextContent('安装记录加载失败');
    const card = getSkillMarketCard('frontend-slides');
    expect(within(card).getByText('版本未知')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '使用' })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });

  it('keeps the full catalog but disables actions when initial skills scan fails', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse({ error: { code: 'LOAD_FAILED', message: 'skills failed' } }, { status: 500 });
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({
          records: [createSkillMarketInstallRecord({ skillId: 'frontend-slides', marketRevision: 0 })]
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
    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));
    expect(screen.getByRole('alert')).toHaveTextContent('Skill 状态加载失败');
    const action = within(getSkillMarketCard('frontend-slides')).getByRole('button', {
      name: '状态未知'
    });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription('Skill 安装状态未知');
  });

  it('keeps the plugin market open and shows an error when using a skill cannot create a thread', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse(createSkillListResponse([createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })]));
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({ records: [createSkillMarketInstallRecord({ skillId: 'frontend-slides' })] });
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        return jsonResponse(
          { error: { code: 'THREAD_CREATE_FAILED', message: '创建对话失败' } },
          { status: 500 }
        );
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
    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());

    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', {
      name: /打开 .*详情/
    }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '使用' }));

    expect(await screen.findAllByText('使用失败：创建对话失败')).toHaveLength(2);
    expect(within(dialog).getByText('使用失败：创建对话失败')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '使用' }));
    await waitFor(() => {
      expect(
        fetchCalls.filter(call => call.url.endsWith('/threads') && call.init?.method === 'POST')
      ).toHaveLength(2);
    });
    expect(screen.getByRole('region', { name: 'Skill 功能目录' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
  });

  it('ignores concurrent skill use requests while createThread is pending but allows the next use after it settles', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const threadCreates: Array<Deferred<Response>> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse(createSkillListResponse([createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })]));
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({ records: [createSkillMarketInstallRecord({ skillId: 'frontend-slides' })] });
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        const createThread = createDeferred<Response>();
        threadCreates.push(createThread);
        return createThread.promise;
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const threadCreateCalls = () =>
      fetchCalls.filter(call => call.url.endsWith('/threads') && call.init?.method === 'POST');

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());

    const firstUseButton = within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' });
    await user.click(firstUseButton);
    await user.click(firstUseButton);

    expect(threadCreateCalls()).toHaveLength(1);

    await act(async () => {
      threadCreates[0]!.resolve(jsonResponse({
        thread: createThreadResponse({
          id: 'thread_skill_1',
          title: '网页演示稿生成',
          cwd: '~/develop/content-design',
          canonicalCwd: '~/develop/content-design',
          sandbox: 'danger-full-access'
        })
      }, { status: 201 }));
      await threadCreates[0]!.promise;
    });
    expect(await screen.findByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());
    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' }));

    expect(threadCreateCalls()).toHaveLength(2);
    await act(async () => {
      threadCreates[1]!.resolve(jsonResponse({
        thread: createThreadResponse({
          id: 'thread_skill_2',
          title: '网页演示稿生成',
          cwd: '~/develop/content-design',
          canonicalCwd: '~/develop/content-design',
          sandbox: 'danger-full-access'
        })
      }, { status: 201 }));
      await threadCreates[1]!.promise;
    });
  });

  it('does not let a stale install refresh overwrite the next runtime state', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const nextHostBridge = createHostBridge();
    nextHostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60765', token: 'next-runtime-token' });
    let installed = false;
    let recordRequests = 0;
    let nextRecordRequests = 0;
    let staleRecords: Deferred<Response> | undefined;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:60765')) {
        if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
        if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse({ codexVersion: 'codex-cli next' }));
        if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
        if (url.endsWith('/codex/skills')) return jsonResponse(createSkillListResponse([]));
        if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
        if (url.endsWith('/codex/skill-market/install-records')) {
          nextRecordRequests += 1;
          return jsonResponse({ records: [] });
        }
        throw new Error(`Unexpected next runtime request ${url}`);
      }
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse(createSkillListResponse(installed ? [createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })] : []));
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        recordRequests += 1;
        if (recordRequests === 1) return jsonResponse({ records: [] });
        staleRecords = createDeferred<Response>();
        return staleRecords.promise;
      }
      if (url.endsWith('/codex/skill-market/frontend-slides/install') && init?.method === 'POST') {
        installed = true;
        return jsonResponse({
          skill: createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' }),
          operation: {},
          record: createSkillMarketInstallRecord({ skillId: 'frontend-slides' })
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const { rerender } = render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '安装' })).toBeEnabled());
    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '安装' }));
    await waitFor(() => expect(staleRecords).toBeDefined());

    rerender(
      <App
        fileService={createFileService()}
        hostBridge={nextHostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );
    await waitFor(() => expect(nextRecordRequests).toBe(1));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '安装' })).toBeEnabled());

    await act(async () => {
      staleRecords!.resolve(jsonResponse({
        records: [createSkillMarketInstallRecord({ skillId: 'frontend-slides' })]
      }));
      await staleRecords!.promise;
    });

    await waitFor(() => {
      expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '安装' })).toBeEnabled();
    });
    expect(within(getSkillMarketCard('frontend-slides')).queryByRole('button', { name: '使用' })).not.toBeInTheDocument();
  });

  it('refreshes real skills and install records after a successful skill update', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    let updated = false;
    let skillRequests = 0;
    let recordRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        skillRequests += 1;
        return jsonResponse(createSkillListResponse([createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })]));
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        recordRequests += 1;
        return jsonResponse({
          records: [
            createSkillMarketInstallRecord({
              skillId: 'frontend-slides',
              marketRevision: updated ? 1 : 0
            })
          ]
        });
      }
      if (url.endsWith('/codex/skill-market/frontend-slides/update') && init?.method === 'POST') {
        updated = true;
        return jsonResponse({
          skill: createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' }),
          operation: {},
          record: createSkillMarketInstallRecord({ skillId: 'frontend-slides' })
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
    await waitFor(() => expect(skillRequests).toBe(1));
    await waitFor(() => expect(recordRequests).toBe(1));
    await user.click(screen.getByRole('button', { name: '插件' }));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '更新' })).toBeEnabled());

    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '更新' }));

    await waitFor(() => expect(skillRequests).toBe(2));
    await waitFor(() => expect(recordRequests).toBe(2));
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());
  });

  it('applies refreshed skills and shows a warning when install record refresh fails', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    let installed = false;
    let recordRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        return jsonResponse(createSkillListResponse(installed
          ? [createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })]
          : []));
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        recordRequests += 1;
        if (recordRequests === 1) return jsonResponse({ records: [] });
        return jsonResponse({ error: { code: 'LOAD_FAILED', message: 'records failed' } }, { status: 500 });
      }
      if (url.endsWith('/codex/skill-market/frontend-slides/install') && init?.method === 'POST') {
        installed = true;
        return jsonResponse({
          skill: createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' }),
          operation: {},
          record: createSkillMarketInstallRecord({ skillId: 'frontend-slides' })
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
    await user.click(screen.getByRole('button', { name: '插件' }));
    await user.click(await within(getSkillMarketCard('frontend-slides')).findByRole('button', { name: '安装' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('安装记录刷新失败');
    expect(within(getSkillMarketCard('frontend-slides')).getByText('版本未知')).toBeInTheDocument();
    expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled();
    expect(screen.queryByText('安装失败，请重试')).not.toBeInTheDocument();
  });

  it('applies refreshed records and disables actions when update skills refresh fails', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    let updated = false;
    let skillRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) {
        skillRequests += 1;
        if (skillRequests === 1) {
          return jsonResponse(createSkillListResponse([
            createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' })
          ]));
        }
        return jsonResponse({ error: { code: 'LOAD_FAILED', message: 'skills failed' } }, { status: 500 });
      }
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({
          records: [
            createSkillMarketInstallRecord({
              skillId: 'frontend-slides',
              marketRevision: updated ? 1 : 0
            })
          ]
        });
      }
      if (url.endsWith('/codex/skill-market/frontend-slides/update') && init?.method === 'POST') {
        updated = true;
        return jsonResponse({
          skill: createSkillResponse({ id: 'frontend-slides', name: 'frontend-slides' }),
          operation: {},
          record: createSkillMarketInstallRecord({ skillId: 'frontend-slides' })
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
    await user.click(screen.getByRole('button', { name: '插件' }));
    await user.click(await within(getSkillMarketCard('frontend-slides')).findByRole('button', { name: '更新' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Skill 状态刷新失败');
    const action = within(getSkillMarketCard('frontend-slides')).getByRole('button', {
      name: '状态未知'
    });
    expect(action).toBeDisabled();
    expect(screen.queryByText('更新失败，请重试')).not.toBeInTheDocument();
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
    expect(screen.queryByTestId('conversation-lightfall-background')).not.toBeInTheDocument();
    expect(await screen.findByText('思考过程')).toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();

    await user.click(screen.getByText('思考过程'));

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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run run_1' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '导出脱敏诊断包' })).toBeInTheDocument();
    expect(screen.getByText('codex-cli test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置 账户' }));
    await user.click(await screen.findByRole('button', { name: '关于 Clawee' }));

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

    await user.click(screen.getByText('思考过程'));

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

  it('interrupts the active conversation run from the composer', async () => {
    const user = userEvent.setup();
    const prompt = '执行一个长任务';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let resolveRunRequest: ((response: Response) => void) | undefined;
    let resolveCancelRequest: ((response: Response) => void) | undefined;
    let resolveSubscription: (() => void) | undefined;
    let subscriptionInput: SubscribeRunEventsInput | undefined;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) {
        return new Promise<Response>((resolve) => {
          resolveRunRequest = resolve;
        });
      }
      if (url.endsWith('/runs/run_interrupt/cancel') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveCancelRequest = resolve;
        });
      }
      if (url.endsWith('/runs/run_interrupt/diagnostics')) {
        return jsonResponse(createRunDiagnosticsResponse(createCodexStatusResponse()));
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      subscriptionInput = input;
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'running' }, 1, 'run_interrupt'));
      return new Promise<void>((resolve) => {
        resolveSubscription = resolve;
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

    await user.click(await screen.findByRole('button', { name: '停止任务' }));

    expect(screen.getByRole('button', { name: '正在停止任务' })).toBeDisabled();
    expect(fetchCalls.some(call => call.url.endsWith('/runs/run_interrupt/cancel'))).toBe(false);

    await act(async () => {
      resolveRunRequest?.(
        jsonResponse({ id: 'run_interrupt', threadId: 'thread_from_api', status: 'running' }, { status: 202 })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchCalls.some(call =>
        call.url.endsWith('/runs/run_interrupt/cancel') && call.init?.method === 'POST'
      )).toBe(true);
    });

    await act(async () => {
      resolveCancelRequest?.(jsonResponse({ id: 'run_interrupt', canceled: true }, { status: 202 }));
      await Promise.resolve();
    });

    await waitFor(() => expect(subscriptionInput).toBeDefined());

    await act(async () => {
      subscriptionInput?.onEvent(
        createRuntimeEvent(
          'done',
          { type: 'done', status: 'canceled', terminationReason: 'user_canceled' },
          2,
          'run_interrupt'
        )
      );
      resolveSubscription?.();
      await Promise.resolve();
    });

    expect(await screen.findByText('运行已取消：用户已取消')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '停止任务' })).not.toBeInTheDocument();
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

    await user.click(screen.getByText('思考过程'));

    expect(screen.getByText('我会先确认当前目录，再读取必要文件。')).toBeInTheDocument();
    expect(screen.getByText('使用工具 command_execution')).toBeInTheDocument();
    expect(screen.getByText('pwd')).toBeInTheDocument();
    expect(screen.getByText('工具完成 command_execution')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
    expect(screen.getByText('当前目录是 /repo，检查已完成。')).toBeInTheDocument();
    expect(container.querySelectorAll('.timeline-assistant_message')).toHaveLength(1);
    expect(container.querySelector('.timeline-process details')).toHaveAttribute('open');
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
      if (url.endsWith('/threads/thread_playground/history?limit=50')) {
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

  it('does not show managed runtime workspaces as projects', async () => {
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
              id: 'thread_RwiAbzbZ8p',
              title: 'task9-readonly',
              cwd: '.runtime/workspaces/thread_RwiAbzbZ8p',
              canonicalCwd: '.runtime/workspaces/thread_RwiAbzbZ8p',
              workspaceMode: 'managed'
            }),
            createThreadResponse({
              id: 'thread_1Qm6X_K0eo',
              title: 'task9-write',
              cwd: '.runtime/workspaces/thread_1Qm6X_K0eo',
              canonicalCwd: '.runtime/workspaces/thread_1Qm6X_K0eo',
              workspaceMode: 'managed'
            }),
            createThreadResponse({
              id: 'thread_playground',
              title: 'Playground 历史会话',
              cwd: '/Users/test/develop/clawee/playground',
              canonicalCwd: '/Users/test/develop/clawee/playground',
              workspaceMode: 'external'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_playground/history?limit=50')) {
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
    expect(screen.queryByRole('button', { name: 'thread_RwiAbzbZ8p' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'thread_1Qm6X_K0eo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /task9-readonly/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /task9-write/ })).not.toBeInTheDocument();
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

  it('does not let an aborted subscription clear events queued by its replacement', async () => {
    const user = userEvent.setup();
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    let threadSequence = 0;
    let runSequence = 0;
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        threadSequence += 1;
        return jsonResponse({
          thread: createThreadResponse({ id: `thread_${threadSequence}`, title: `任务 ${threadSequence}` })
        }, { status: 201 });
      }
      if (url.endsWith('/runs')) {
        runSequence += 1;
        return jsonResponse({
          id: `run_${runSequence}`,
          threadId: `thread_${runSequence}`,
          status: 'running'
        }, { status: 202 });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    let resolveFirstSubscription!: () => void;
    let resolveSecondSubscription!: () => void;
    let subscriptionSequence = 0;
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      subscriptionSequence += 1;
      if (subscriptionSequence === 1) {
        await new Promise<void>(resolve => {
          resolveFirstSubscription = resolve;
        });
        return;
      }

      input.onEvent({
        ...createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: '新任务仍然可以实时显示',
            format: 'plain_text',
            delivery: 'message'
          },
          1
        ),
        runId: 'run_2'
      });
      await new Promise<void>(resolve => {
        resolveSecondSubscription = resolve;
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

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '旧任务');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(subscriptionSequence).toBe(1));

    await user.click(screen.getByRole('button', { name: 'bili' }));
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '新任务');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(subscriptionSequence).toBe(2));

    await act(async () => {
      resolveFirstSubscription();
      await Promise.resolve();
    });
    await act(async () => {
      for (const callback of animationFrames.splice(0)) callback(performance.now());
    });

    expect(await screen.findByText('新任务仍然可以实时显示')).toBeInTheDocument();

    await act(async () => {
      resolveSecondSubscription();
    });
  });

  it('restores the last selected project and conversation after remount', async () => {
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
              id: 'thread_content_history',
              title: 'content-design 历史',
              codexThreadId: 'codex-content-history',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            }),
            createThreadResponse({
              id: 'thread_bili_history',
              title: 'bili 历史',
              codexThreadId: 'codex-bili-history',
              cwd: '/Users/test/develop/clawee/bili',
              canonicalCwd: '/Users/test/develop/clawee/bili'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_bili_history/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_bili_history',
          codexThreadId: 'codex-bili-history',
          items: [
            {
              id: 'bili_history_user_1',
              type: 'user_message',
              text: '刷新后仍然打开这条对话',
              createdAt: new Date(0).toISOString()
            }
          ]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const appProps = {
      fileService: createFileService(),
      hostBridge,
      runtimeFetch,
      subscribeRunEvents: async () => undefined
    };

    const firstRender = render(<App {...appProps} />);

    expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'bili' }));
    await user.click(await screen.findByRole('button', { name: /bili 历史/ }));
    expect(await findTimelineUserMessage('刷新后仍然打开这条对话')).toBeInTheDocument();

    firstRender.unmount();
    render(<App {...appProps} />);

    expect(await findTimelineUserMessage('刷新后仍然打开这条对话')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bili' })).toHaveAttribute('data-current-project', 'true');
  });

  it('restores a selected historical conversation that is outside the initial thread page', async () => {
    window.localStorage.setItem('clawee.navigation.v2', JSON.stringify({
      currentProjectId: 'bili',
      selectedThreadId: 'thread_older_history'
    }));
    const hostBridge = createHostBridge();
    const requestedUrls: string[] = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_recent',
              title: '最近会话',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_older_history')) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_older_history',
            title: '分页外的历史会话',
            codexThreadId: 'codex-older-history',
            cwd: '/Users/test/develop/clawee/bili',
            canonicalCwd: '/Users/test/develop/clawee/bili'
          })
        });
      }
      if (url.endsWith('/threads/thread_older_history/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_older_history',
          codexThreadId: 'codex-older-history',
          items: [
            {
              id: 'older_history_user_1',
              type: 'user_message',
              text: '这条历史会话不在首批 50 条中',
              createdAt: new Date(0).toISOString()
            }
          ]
        });
      }
      if (url.endsWith('/threads/thread_older_history/runs?limit=50')) {
        return jsonResponse({ runs: [] });
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

    expect(await findTimelineUserMessage('这条历史会话不在首批 50 条中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /分页外的历史会话/ })).toBeInTheDocument();
    expect(requestedUrls.some(url => url.endsWith('/threads/thread_older_history'))).toBe(true);
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
      if (url.endsWith('/threads/thread_codex_history/history?limit=50')) {
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

    await user.click(screen.getByText('思考过程'));

    expect(screen.getByText('先读取 skill 说明。')).toBeInTheDocument();
    expect(screen.getByText('这个 skill 用于分析选品资料。')).toBeInTheDocument();
  });

  it('loads the latest history page first and prepends an older cursor page without duplicates', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_paged_history',
              title: '分页历史会话',
              codexThreadId: 'codex-paged-history',
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_paged_history/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_paged_history',
          codexThreadId: 'codex-paged-history',
          items: [
            {
              id: 'history_boundary',
              type: 'user_message',
              text: '分页边界消息',
              createdAt: new Date(1).toISOString()
            },
            {
              id: 'history_latest',
              type: 'assistant_message',
              text: '最新一页内容',
              createdAt: new Date(2).toISOString()
            }
          ],
          hasMore: true,
          nextCursor: 'cursor_older'
        });
      }
      if (url.endsWith('/threads/thread_paged_history/history?limit=50&before=cursor_older')) {
        return jsonResponse({
          threadId: 'thread_paged_history',
          codexThreadId: 'codex-paged-history',
          items: [
            {
              id: 'history_oldest',
              type: 'user_message',
              text: '更早的一页内容',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'history_boundary',
              type: 'user_message',
              text: '分页边界消息',
              createdAt: new Date(1).toISOString()
            }
          ],
          hasMore: false
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
    await user.click(await screen.findByRole('button', { name: /分页历史会话/ }));

    expect(await screen.findByText('最新一页内容')).toBeInTheDocument();
    expect(requestedUrls.filter(url => (
      url.includes('/threads/thread_paged_history/history')
    ))).toEqual([
      'http://127.0.0.1:60764/threads/thread_paged_history/history?limit=50'
    ]);

    await user.click(screen.getByRole('button', { name: '加载更早记录' }));

    expect(await findTimelineUserMessage('更早的一页内容')).toBeInTheDocument();
    expect(document.querySelectorAll('.timeline-user_message')).toHaveLength(2);
    expect(screen.getAllByText('分页边界消息')).toHaveLength(1);
    expect(requestedUrls.filter(url => (
      url.includes('/threads/thread_paged_history/history')
    ))).toEqual([
      'http://127.0.0.1:60764/threads/thread_paged_history/history?limit=50',
      'http://127.0.0.1:60764/threads/thread_paged_history/history?limit=50&before=cursor_older'
    ]);
  });

  it('keeps an expanded synthetic history run open after prepending an older page', async () => {
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
              id: 'thread_synthetic_history',
              title: '无 Turn ID 的分页会话',
              codexThreadId: 'codex-synthetic-history',
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_synthetic_history/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_synthetic_history',
          codexThreadId: 'codex-synthetic-history',
          items: [
            {
              id: 'current_user',
              type: 'user_message',
              text: '当前任务',
              createdAt: new Date(4).toISOString()
            },
            {
              id: 'current_reasoning',
              type: 'reasoning_summary',
              text: '当前任务的处理过程',
              createdAt: new Date(5).toISOString()
            },
            {
              id: 'current_assistant',
              type: 'assistant_message',
              text: '当前任务已完成',
              createdAt: new Date(6).toISOString()
            },
            {
              id: 'current_done',
              type: 'done',
              status: 'succeeded',
              createdAt: new Date(7).toISOString()
            }
          ],
          hasMore: true,
          nextCursor: 'cursor_synthetic_older'
        });
      }
      if (url.endsWith('/threads/thread_synthetic_history/history?limit=50&before=cursor_synthetic_older')) {
        return jsonResponse({
          threadId: 'thread_synthetic_history',
          codexThreadId: 'codex-synthetic-history',
          items: [
            {
              id: 'older_user',
              type: 'user_message',
              text: '更早的任务',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'older_reasoning',
              type: 'reasoning_summary',
              text: '更早任务的处理过程',
              createdAt: new Date(1).toISOString()
            },
            {
              id: 'older_assistant',
              type: 'assistant_message',
              text: '更早任务已完成',
              createdAt: new Date(2).toISOString()
            },
            {
              id: 'older_done',
              type: 'done',
              status: 'succeeded',
              createdAt: new Date(3).toISOString()
            },
            {
              id: 'current_user',
              type: 'user_message',
              text: '当前任务',
              createdAt: new Date(4).toISOString()
            }
          ],
          hasMore: false
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
    await user.click(await screen.findByRole('button', { name: /无 Turn ID 的分页会话/ }));
    await user.click(await screen.findByText('思考过程'));

    expect(screen.getByText('当前任务的处理过程')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '加载更早记录' }));

    expect(await findTimelineUserMessage('更早的任务')).toBeInTheDocument();
    expect(screen.getByText('当前任务的处理过程')).toBeInTheDocument();
  });

  it('loads selected conversation history even when the listed thread has no codexThreadId yet', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    let historyRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_stale_codex_id',
              title: '刚生成的内容',
              codexThreadId: null,
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_stale_codex_id/history?limit=50')) {
        historyRequests += 1;
        return jsonResponse({
          threadId: 'thread_stale_codex_id',
          codexThreadId: 'codex-now-available',
          items: [
            {
              id: 'stale_history_user_1',
              type: 'user_message',
              text: '帮我生成视频脚本',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'stale_history_assistant_1',
              type: 'assistant_message',
              text: '这是生成好的视频脚本。',
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
    await user.click(await screen.findByRole('button', { name: /刚生成的内容/ }));

    expect(await findTimelineUserMessage('帮我生成视频脚本')).toBeInTheDocument();
    expect(screen.getByText('这是生成好的视频脚本。')).toBeInTheDocument();
    expect(historyRequests).toBe(1);
  });

  it('opens a search result outside the initial thread page with a target history window', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const requestedUrls: string[] = [];
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
      }
      if (url.includes('/search/conversations?')) {
        return jsonResponse({
          results: [
            {
              threadId: 'thread_search_target',
              codexThreadId: 'codex-search-target',
              title: '搜索命中的会话',
              cwd: '/Users/test/develop/content-design',
              itemId: 'search-target-item',
              itemType: 'user_message',
              createdAt: '2026-07-12T12:00:00.000Z',
              snippet: [
                { text: '目标位于 ', highlighted: false },
                { text: 'App.tsx', highlighted: true }
              ]
            }
          ],
          hasMore: false
        });
      }
      if (url.endsWith('/threads/thread_search_target')) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_search_target',
            title: '搜索命中的会话',
            codexThreadId: 'codex-search-target'
          })
        });
      }
      if (url.endsWith(
        '/threads/thread_search_target/history?limit=50&targetItemId=search-target-item'
      )) {
        return jsonResponse({
          threadId: 'thread_search_target',
          codexThreadId: 'codex-search-target',
          targetItemId: 'search-target-item',
          items: [
            {
              id: 'search-before-item',
              type: 'assistant_message',
              text: '目标之前的回复',
              createdAt: '2026-07-12T11:59:59.000Z'
            },
            {
              id: 'search-target-item',
              type: 'user_message',
              text: '目标位于 App.tsx',
              createdAt: '2026-07-12T12:00:00.000Z'
            },
            {
              id: 'search-after-item',
              type: 'assistant_message',
              text: '目标之后的回复',
              createdAt: '2026-07-12T12:00:01.000Z'
            }
          ],
          hasMore: true,
          nextCursor: 'search-older-cursor'
        });
      }
      if (url.endsWith('/threads/thread_search_target/runs?limit=50')) {
        return jsonResponse({ runs: [] });
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
    await user.click(screen.getByRole('button', { name: '搜索' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索会话' }), 'App.tsx');
    const result = await screen.findByTestId('search-result-search-target-item');
    await user.click(within(result).getByRole('button'));

    expect(await findTimelineUserMessage('目标位于 App.tsx')).toBeInTheDocument();
    expect(document.querySelector('[data-search-target="true"]')).toHaveTextContent('目标位于 App.tsx');
    expect(requestedUrls).toEqual(expect.arrayContaining([
      expect.stringContaining(
        '/threads/thread_search_target/history?limit=50&targetItemId=search-target-item'
      )
    ]));
    expect(requestedUrls.some(url => (
      url.includes('/threads/thread_search_target/history?limit=50&before=')
    ))).toBe(false);
  });

  it('keeps the visible transcript when selecting the currently open conversation again', async () => {
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
              id: 'thread_current_history',
              title: '当前打开的历史',
              codexThreadId: 'codex-current-history',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_current_history/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_current_history',
          codexThreadId: 'codex-current-history',
          items: [
            {
              id: 'current_history_user_1',
              type: 'user_message',
              text: '保持当前内容',
              createdAt: new Date(0).toISOString()
            },
            {
              id: 'current_history_assistant_1',
              type: 'assistant_message',
              text: '当前内容仍然可见。',
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
    const conversationButton = await screen.findByRole('button', { name: /当前打开的历史/ });
    await user.click(conversationButton);

    expect(await findTimelineUserMessage('保持当前内容')).toBeInTheDocument();
    expect(screen.getByText('当前内容仍然可见。')).toBeInTheDocument();

    await user.click(conversationButton);

    expect(await findTimelineUserMessage('保持当前内容')).toBeInTheDocument();
    expect(screen.getByText('当前内容仍然可见。')).toBeInTheDocument();
    expect(screen.queryByText('要在 content-design 中处理什么？')).not.toBeInTheDocument();
  });

  it('replaces the previous transcript with a loading state while switching conversations', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    let resolveNextHistory: ((response: Response) => void) | undefined;
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_content_history',
              title: 'content-design 历史',
              codexThreadId: 'codex-content-history',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            }),
            createThreadResponse({
              id: 'thread_bili_history',
              title: 'bili 历史',
              codexThreadId: 'codex-bili-history',
              cwd: '/Users/test/develop/clawee/bili',
              canonicalCwd: '/Users/test/develop/clawee/bili'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_content_history/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_content_history',
          codexThreadId: 'codex-content-history',
          items: [
            {
              id: 'content_history_user_1',
              type: 'user_message',
              text: '上一条会话内容保持可见',
              createdAt: new Date(0).toISOString()
            }
          ]
        });
      }
      if (url.endsWith('/threads/thread_bili_history/history?limit=50')) {
        return new Promise<Response>((resolve) => {
          resolveNextHistory = resolve;
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
    await user.click(await screen.findByRole('button', { name: /content-design 历史/ }));
    expect(await findTimelineUserMessage('上一条会话内容保持可见')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'bili' }));
    await user.click(await screen.findByRole('button', { name: /bili 历史/ }));

    expect(screen.queryByRole('heading', { name: 'bili' })).not.toBeInTheDocument();
    expect(screen.queryByText('上一条会话内容保持可见')).not.toBeInTheDocument();
    expect(document.querySelector('.timeline-user_message')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在加载会话历史' })).toBeInTheDocument();

    resolveNextHistory?.(jsonResponse({
      threadId: 'thread_bili_history',
      codexThreadId: 'codex-bili-history',
      items: [
        {
          id: 'bili_history_user_1',
          type: 'user_message',
          text: '新的会话加载完成',
          createdAt: new Date(0).toISOString()
        }
      ]
    }));

    expect(await findTimelineUserMessage('新的会话加载完成')).toBeInTheDocument();
  });

  it('从会话头部点击文件会在会话旁打开真实文件工作区', async () => {
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
      if (url.endsWith('/threads/thread_files/history?limit=50')) {
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

    expect(screen.getByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '真实文件会话' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toBeInTheDocument();
    expect(screen.queryByText('打开文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回对话' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无预览内容')).not.toBeInTheDocument();
  });

  it('点击聊天回复中的生成文件链接会直接打开对应文件', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const absoluteChangedPath = '/Users/test/develop/clawee/clawee-agent/docs/generated.md';
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
              id: 'thread_files',
              title: '真实文件会话',
              codexThreadId: 'codex-thread-files',
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_files/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_files',
          codexThreadId: 'codex-thread-files',
          items: [
            {
              id: 'history_assistant_1',
              type: 'assistant_message',
              text: `已生成文件：\n\n\`\`\`text\n${absoluteChangedPath} (311 字节)\n\`\`\``,
              format: 'plain_text',
              delivery: 'message',
              createdAt: new Date(0).toISOString()
            }
          ]
        });
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
            },
            {
              path: 'docs/generated.md',
              name: 'generated.md',
              depth: 1,
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
        const path = new URL(url).searchParams.get('path');
        if (path !== 'docs/generated.md') throw new Error(`Expected generated.md meta request, got ${path}`);
        return jsonResponse({
          path: 'docs/generated.md',
          name: 'generated.md',
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
        const path = new URL(url).searchParams.get('path');
        if (path !== 'docs/generated.md') throw new Error(`Expected generated.md content request, got ${path}`);
        return jsonResponse({
          meta: {
            path: 'docs/generated.md',
            name: 'generated.md',
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
          content: '# Generated',
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
    await user.click(await screen.findByRole('link', { name: absoluteChangedPath }));

    expect(screen.getByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'docs/generated.md 编辑器' })).toHaveTextContent('# Generated');
    expect(screen.queryByText('已编辑 docs/atoms.md')).not.toBeInTheDocument();
    expect(
      fetchCalls.some(call => call.url.includes('/workspace/files/meta?') && call.url.includes('path=docs%2Fgenerated.md'))
    ).toBe(true);
  });

  it('会话和文件工作区之间的分隔条可以拖动调整宽度', async () => {
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
      if (url.endsWith('/threads/thread_files/history?limit=50')) {
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
    await screen.findByRole('textbox', { name: 'README.md 编辑器' });

    const layout = screen.getByLabelText('会话和文件工作区');
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON: () => undefined
    });

    const separator = screen.getByRole('separator', { name: '调整会话和文件区域宽度' });
    fireEvent.mouseDown(separator, { clientX: 420 });
    fireEvent.mouseMove(window, { clientX: 520 });
    fireEvent.mouseUp(window);

    expect(layout).toHaveStyle({ '--conversation-pane-width': '520px' });
  });

  it('已有只读会话切换为完全访问后会更新 thread 并允许编辑文件', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let threadSandbox: ThreadResponse['sandbox'] = 'read-only';
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files',
              title: '只读文件会话',
              sandbox: threadSandbox,
              cwd: '/Users/test/develop/clawee/clawee-agent',
              canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
            })
          ]
        });
      }
      if (url.endsWith('/threads/thread_files/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_files', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_files') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { sandbox: ThreadResponse['sandbox'] };
        threadSandbox = body.sandbox;
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_files',
            title: '只读文件会话',
            sandbox: threadSandbox,
            cwd: '/Users/test/develop/clawee/clawee-agent',
            canonicalCwd: '/Users/test/develop/clawee/clawee-agent'
          })
        });
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
                readonly: threadSandbox === 'read-only'
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
          readonly: threadSandbox === 'read-only'
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
            readonly: threadSandbox === 'read-only'
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
    await user.click(await screen.findByRole('button', { name: /只读文件会话/ }));
    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(await screen.findByText('当前会话为只读模式，不能保存文件')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toHaveAttribute('aria-readonly', 'true');

    await user.click(screen.getByRole('button', { name: '选择访问权限 只读访问' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));

    await waitFor(() => {
      expect(findPatchCall(fetchCalls, '/threads/thread_files')).toBeDefined();
    });
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toHaveAttribute('aria-readonly', 'false');
    expect(screen.queryByText('当前会话为只读模式，不能保存文件')).not.toBeInTheDocument();
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
      if (url.endsWith('/threads/thread_files/history?limit=50')) {
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
    expect(screen.getByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '真实文件会话' })).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toBeInTheDocument();
    expect(screen.queryByText('打开文件')).not.toBeInTheDocument();
  });

  it('focuses the most recent runtime project when there is no saved navigation', async () => {
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
            }),
            createThreadResponse({
              id: 'thread_codex_content_design',
              title: 'content-design 旧历史',
              codexThreadId: 'codex-history-content-design',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design',
              updatedAt: new Date(0).toISOString()
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
    expect(await screen.findByRole('button', { name: 'clawee-agent' })).toHaveAttribute('data-current-project', 'true');
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
      if (url.endsWith('/codex/profiles')) {
        return jsonResponse({
          codexHome: '/Users/test/.codex',
          codexHomeMode: 'isolated',
          writable: true,
          baseConfigValid: true,
          profiles: [
            {
              name: 'review',
              status: 'valid',
              config: { model_reasoning_effort: 'high' },
              diagnostics: [],
              source: 'review.config.toml',
              codexHomeMode: 'isolated'
            }
          ],
          diagnostics: []
        });
      }
      if (url.endsWith('/threads')) {
        return jsonResponse(
          {
            thread: createThreadResponse({
              id: 'thread_configured_from_chat',
              title: prompt,
              profile: 'review',
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

    await user.click(await screen.findByRole('button', { name: '选择 Profile default' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'review' }));
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
      profile: 'review',
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
      if (url.endsWith('/threads/thread_existing/history?limit=50')) {
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

  it('can turn off the empty-state dynamic background from settings', async () => {
    const user = userEvent.setup();

    render(<App fileService={createFileService()} />);

    expect(await screen.findByTestId('conversation-lightfall-background')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: '设置 账户' }));
    await user.click(screen.getByRole('switch', { name: '动态背景' }));
    await user.click(screen.getByRole('button', { name: '返回应用' }));

    expect(await screen.findByRole('heading', { name: '新对话' })).toBeInTheDocument();
    expect(document.querySelector('.conversation-page')).toHaveAttribute('data-dynamic-background', 'off');
    expect(screen.queryByTestId('conversation-lightfall-background')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('clawee.preferences.dynamicBackground')).toBe('false');
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

function createSkillListResponse(skills: CodexSkillResponse[] = []): CodexSkillListResponse {
  return {
    codexHome: '/Users/test/.codex',
    codexHomeMode: 'global',
    skillsPath: '/Users/test/.codex/skills',
    skillsWritable: true,
    requiresWriteConfirmation: true,
    skills,
    diagnostics: []
  };
}

function createSkillResponse(overrides: Partial<CodexSkillResponse> = {}): CodexSkillResponse {
  const id = overrides.id ?? 'frontend-slides';
  return {
    id,
    name: id,
    description: `${id} description`,
    status: 'valid',
    diagnostics: [],
    codexHome: '/Users/test/.codex',
    codexHomeMode: 'global',
    skillsPath: '/Users/test/.codex/skills',
    skillPath: `/Users/test/.codex/skills/${id}`,
    skillFilePath: `/Users/test/.codex/skills/${id}/SKILL.md`,
    ...overrides
  };
}

function createMcpListResponse(): CodexMcpListResponse {
  return {
    codexHome: '/Users/test/.codex',
    codexHomeMode: 'global',
    requiresWriteConfirmation: true,
    servers: [],
    diagnostics: []
  };
}

function createSkillMarketInstallRecord(
  overrides: Partial<CodexSkillMarketInstallRecordResponse> = {}
): CodexSkillMarketInstallRecordResponse {
  return {
    skillId: 'frontend-slides',
    repository: 'zarazhangrui/frontend-slides',
    skillPath: '/Users/test/.codex/skills/frontend-slides',
    commit: 'abc123',
    marketRevision: 1,
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

function getSkillMarketCard(skillId: string): HTMLElement {
  const card = document.querySelector(`[data-testid="skill-market-card"][data-skill-id="${skillId}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`Expected skill market card: ${skillId}`);
  return card;
}

function createCodexStatusResponse(overrides: Partial<CodexStatusResponse> = {}): CodexStatusResponse {
  return {
    codexBin: 'codex',
    codexVersion: 'codex-cli test',
    codexHome: '/Users/test/.codex',
    codexHomeMode: 'global',
    codexHomeSource: 'default',
    codexHomeWritable: true,
    capabilities: {},
    diagnostics: [],
    ...overrides
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

function createRunResponse(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    id: 'run_1',
    threadId: 'thread_from_api',
    status: 'running',
    ...overrides
  };
}

function createScheduleResponse(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'schedule-1',
    name: '每日总结',
    cron: '0 18 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结今天的项目进展',
    profile: 'default',
    cwd: '/Users/test/develop/content-design',
    canonicalCwd: '/Users/test/develop/content-design',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'skip',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-13T10:00:00.000Z',
    lastRunAt: '2026-07-12T10:00:00.000Z',
    lastRunId: 'run_schedule',
    lastStatus: 'succeeded',
    pendingTrigger: false,
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    ...overrides
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

function findPatchCall(calls: Array<{ url: string; init?: RequestInit }>, path: string) {
  return calls.find(call => call.url.endsWith(path) && call.init?.method === 'PATCH');
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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
  seq: number,
  runId = 'run_1'
): AgentEventEnvelope {
  return {
    id: `event_${seq}`,
    runId,
    seq,
    ts: new Date(0).toISOString(),
    type,
    payload,
    normalizerVersion: 1
  } as AgentEventEnvelope;
}
