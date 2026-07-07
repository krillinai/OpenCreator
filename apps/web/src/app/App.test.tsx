import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEventEnvelope, AgentEventPayload, CodexStatusResponse, RunDiagnosticsResponse } from '@clawee/protocol';
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
    expect(screen.queryByText('Codex Runtime Workbench')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime 地址')).not.toBeInTheDocument();
    expect(screen.queryByText(/Token|API Key|连接 Runtime/)).not.toBeInTheDocument();
  });

  it('records a mock submit with fallback message and opens the change detail', async () => {
    const user = userEvent.setup();
    const prompt = '整理企业 Agent 工作台设计';

    render(<App fileService={createFileService()} />);

    await user.type(await screen.findByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText(prompt)).toBeInTheDocument();
    expect(screen.getByText('本地服务暂未就绪，已先记录本次任务。')).toBeInTheDocument();
    expect(screen.getByText('根据本次输入生成 mock 文件变更')).toBeInTheDocument();
    expect(screen.getByText('docs/atoms.md')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /审查 根据本次输入生成 mock 文件变更 docs\/atoms\.md/ }));

    expect(await screen.findByRole('heading', { name: '已编辑 docs/atoms.md' })).toBeInTheDocument();
    expect(screen.getByText('+903 -0')).toBeInTheDocument();
    expect(screen.getAllByText('docs/atoms.md').length).toBeGreaterThan(0);
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
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', status: 'running' }, { status: 202 });
      if (url.endsWith('/runs/run_1/diagnostics')) return jsonResponse(createRunDiagnosticsResponse(codexStatus));
      throw new Error(`Unexpected request ${url}`);
    };
    let sseFetchImpl: SubscribeRunEventsInput['fetchImpl'];
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      sseFetchImpl = input.fetchImpl;
      input.onEvent(createRuntimeEvent('status', { type: 'status', label: 'running' }, 1));
      input.onEvent(
        createRuntimeEvent(
          'assistant_message',
          {
            type: 'assistant_message',
            text: 'OK',
            format: 'plain_text',
            delivery: 'message'
          },
          2
        )
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 3));
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

    expect(await screen.findByText(prompt)).toBeInTheDocument();
    expect(await screen.findByText('queued')).toBeInTheDocument();
    expect((await screen.findAllByText('running')).length).toBeGreaterThan(0);
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(await screen.findByText('succeeded')).toBeInTheDocument();
    expect(JSON.parse(String(fetchCalls.find(call => call.url.endsWith('/runs'))?.init?.body))).toEqual({ prompt });
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
