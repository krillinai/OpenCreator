import { render, screen, waitFor } from '@testing-library/react';
import { act, StrictMode } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentEventEnvelope, AgentEventPayload, CodexStatusResponse, RunDiagnosticsResponse } from '@clawee/protocol';
import { App } from './App.js';
import type { HostBridge } from '../host/bridge.js';
import type { SubscribeRunEventsInput } from '../runtime/sse.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });

  return { promise, resolve, reject };
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('records a submitted prompt in the timeline with a mock change card for the current file', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const prompt = '整理企业 Agent 工作台设计';
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, '# Workbench');
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    await screen.findByRole('textbox', { name: `${filePath} 编辑器` });

    const promptInput = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(promptInput, prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(screen.getByText('当前未连接 Runtime，已在 mock workspace 中记录本次任务。')).toBeInTheDocument();
    expect(screen.getByText('根据本次输入生成 mock 文件变更')).toBeInTheDocument();
    expect(screen.getByText(`${filePath} +1 -0`)).toBeInTheDocument();
  });

  it('connects to a real runtime config and records run events from SSE', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const prompt = 'Reply with OK only.';
    const codexStatus = createCodexStatusResponse();
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];
    const hostBridge = createHostBridge();
    const connectionRead = createDeferred<null>();
    hostBridge.readConnectionConfig = () => connectionRead.promise;
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
        createRuntimeEvent('assistant_message', {
          type: 'assistant_message',
          text: 'OK',
          format: 'plain_text',
          delivery: 'message'
        }, 2)
      );
      input.onEvent(createRuntimeEvent('done', { type: 'done', status: 'succeeded', terminationReason: 'completed' }, 3));
    };
    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, '# Workbench');
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(
      <StrictMode>
        <App
          fileService={fileService}
          hostBridge={hostBridge}
          runtimeFetch={runtimeFetch}
          subscribeRunEvents={subscribeRunEvents}
        />
      </StrictMode>
    );

    await user.type(screen.getByRole('textbox', { name: 'Runtime 地址' }), 'http://127.0.0.1:60764');
    await user.type(screen.getByLabelText('Runtime Token'), 'runtime-token');
    connectionRead.resolve(null);
    await user.click(screen.getByRole('button', { name: '连接 Runtime' }));

    expect(await screen.findByText('已连接 codex-cli test')).toBeInTheDocument();
    expect(hostBridge.savedConnection).toEqual({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });

    await screen.findByRole('textbox', { name: `${filePath} 编辑器` });
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText(prompt)).toBeInTheDocument();
    expect(await screen.findByText('queued')).toBeInTheDocument();
    expect((await screen.findAllByText('running')).length).toBeGreaterThan(0);
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(await screen.findByText('succeeded')).toBeInTheDocument();
    expect(JSON.parse(String(fetchCalls.find(call => call.url.endsWith('/runs'))?.init?.body))).toEqual({ prompt });
    expect(sseFetchImpl).toBe(runtimeFetch);

    const runDetailButtons = screen.getAllByRole('button', { name: '查看 Run 详情' });
    const runDetailButton = runDetailButtons[0];
    if (runDetailButton === undefined) throw new Error('Expected a run detail button');
    await user.click(runDetailButton);

    expect(await screen.findByText('Run run_1')).toBeInTheDocument();
    expect(await screen.findByText('codex-cli test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePath} 编辑器` })).toBeInTheDocument();
  });

  it('uses the browser fetch binding when no runtime fetch is injected', async () => {
    const user = userEvent.setup();
    const codexStatus = createCodexStatusResponse();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const hostBridge = createHostBridge();
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', (async function fetchMock(this: typeof globalThis, input: RequestInfo | URL) {
      if (this !== globalThis) throw new Error('fetch was called without its global binding');
      const url = String(input);
      fetchCalls.push(url);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(codexStatus);
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch);
    const fileService = {
      async listTree() {
        return [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }] satisfies FileTreeNode[];
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, '# Workbench');
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} hostBridge={hostBridge} subscribeRunEvents={async () => undefined} />);

    await user.type(screen.getByRole('textbox', { name: 'Runtime 地址' }), 'http://127.0.0.1:60764');
    await user.type(screen.getByLabelText('Runtime Token'), 'runtime-token');
    await user.click(screen.getByRole('button', { name: '连接 Runtime' }));

    expect(await screen.findByText('已连接 codex-cli test')).toBeInTheDocument();
    expect(fetchCalls).toEqual(['http://127.0.0.1:60764/healthz', 'http://127.0.0.1:60764/codex/status']);
  });

  it('does not activate a stale saved runtime config after the user starts editing', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const hostBridge = createHostBridge();
    const connectionRead = createDeferred<{ baseUrl: string; token: string }>();
    hostBridge.readConnectionConfig = () => connectionRead.promise;
    const fetchUrls: string[] = [];
    const runtimeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url.startsWith('http://old-runtime.test')) {
        throw new Error(`stale config should not be activated: ${url}`);
      }
      if (url === 'http://new-runtime.test/healthz') return jsonResponse({ ok: true });
      if (url === 'http://new-runtime.test/codex/status') return jsonResponse(createCodexStatusResponse());
      throw new Error(`Unexpected request ${url}`);
    };
    const fileService = {
      async listTree() {
        return [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }] satisfies FileTreeNode[];
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, '# Workbench');
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(
      <App
        fileService={fileService}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch as typeof fetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    await user.type(screen.getByRole('textbox', { name: 'Runtime 地址' }), 'http://new-runtime.test');
    await user.type(screen.getByLabelText('Runtime Token'), 'new-token');

    await act(async () => {
      connectionRead.resolve({ baseUrl: 'http://old-runtime.test', token: 'old-token' });
      await connectionRead.promise;
    });

    expect(screen.getByRole('textbox', { name: 'Runtime 地址' })).toHaveValue('http://new-runtime.test');
    expect(screen.getByLabelText('Runtime Token')).toHaveValue('new-token');

    await user.click(screen.getByRole('button', { name: '连接 Runtime' }));

    expect(await screen.findByText('已连接 codex-cli test')).toBeInTheDocument();
    expect(hostBridge.savedConnection).toEqual({ baseUrl: 'http://new-runtime.test', token: 'new-token' });
    expect(fetchUrls).toEqual(['http://new-runtime.test/healthz', 'http://new-runtime.test/codex/status']);
  });

  it('preserves edits made during a pending save when switching away and back', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench';
    const contentB = '# Notes';
    const savedSnapshotContentA = '# Workbench\nfirst edit';
    const continuedEditContentA = '# Workbench\nfirst edit\nsecond edit';
    const saveDeferred = createDeferred<WorkspaceFile>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, path === filePathA ? initialContentA : contentB);
      },
      saveFile() {
        return saveDeferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });
    expect(editorA).toHaveValue(initialContentA);

    await user.clear(editorA);
    await user.type(editorA, savedSnapshotContentA);
    await user.click(screen.getByRole('button', { name: '保存到本地草稿' }));

    await user.clear(editorA);
    await user.type(editorA, continuedEditContentA);

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));
    const returnedEditorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });

    await act(async () => {
      saveDeferred.resolve(createWorkspaceFile(filePathA, savedSnapshotContentA));
      await saveDeferred.promise;
    });

    await waitFor(() => {
      expect(returnedEditorA).toHaveValue(continuedEditContentA);
      expect(screen.getByText('未保存')).toBeInTheDocument();
    });
  });

  it('does not start a second save for the same file while one is pending', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const initialContent = '# Workbench';
    const firstEditContent = '# Workbench\nfirst edit';
    const latestContent = '# Workbench\nfirst edit\nsecond edit';
    const firstSave = createDeferred<WorkspaceFile>();
    const secondSave = createDeferred<WorkspaceFile>();
    const saveDeferreds = [firstSave, secondSave];
    const saveCalls: Array<{ path: string; content: string }> = [];
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, initialContent);
      },
      saveFile(path: string, content: string) {
        saveCalls.push({ path, content });
        const deferred = saveDeferreds[saveCalls.length - 1];
        if (deferred === undefined) throw new Error(`Unexpected save call ${saveCalls.length}`);
        return deferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editor = await screen.findByRole('textbox', { name: `${filePath} 编辑器` });
    const saveButton = screen.getByRole('button', { name: '保存到本地草稿' });

    await user.clear(editor);
    await user.type(editor, firstEditContent);
    await user.click(saveButton);
    expect(saveCalls).toEqual([{ path: filePath, content: firstEditContent }]);

    await user.clear(editor);
    await user.type(editor, latestContent);
    await user.click(saveButton);
    expect(saveCalls).toHaveLength(1);

    await act(async () => {
      firstSave.resolve(createWorkspaceFile(filePath, firstEditContent));
      await firstSave.promise;
    });

    await waitFor(() => {
      expect(editor).toHaveValue(latestContent);
      expect(screen.getByText('未保存')).toBeInTheDocument();
    });

    await user.click(saveButton);
    expect(saveCalls).toEqual([
      { path: filePath, content: firstEditContent },
      { path: filePath, content: latestContent }
    ]);
  });

  it('keeps the draft and clears pending state when saving fails', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const initialContent = '# Workbench';
    const draftContent = '# Workbench\nunsaved edit';
    const saveDeferred = createDeferred<WorkspaceFile>();
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, initialContent);
      },
      saveFile() {
        return saveDeferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editor = await screen.findByRole('textbox', { name: `${filePath} 编辑器` });
    const saveButton = screen.getByRole('button', { name: '保存到本地草稿' });

    await user.clear(editor);
    await user.type(editor, draftContent);
    await user.click(saveButton);
    expect(saveButton).toBeDisabled();

    await act(async () => {
      saveDeferred.reject(new Error('disk unavailable'));
      await saveDeferred.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(editor).toHaveValue(draftContent);
      expect(saveButton).not.toBeDisabled();
      expect(screen.getByText('保存到本地草稿失败')).toBeInTheDocument();
      expect(screen.getByText('未保存')).toBeInTheDocument();
    });
  });

  it('shows a file loading failure when openFile rejects', async () => {
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile() {
        throw new Error('missing file');
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    expect(await screen.findByText('无法加载文件')).toBeInTheDocument();
    expect(screen.queryByText('正在加载文件...')).not.toBeInTheDocument();
  });

  it('surfaces reload failures while preserving an existing file draft', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench';
    const draftContentA = '# Workbench\nunsaved edit';
    const contentB = '# Notes';
    const openCallsByPath = new Map<string, number>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        openCallsByPath.set(path, (openCallsByPath.get(path) ?? 0) + 1);
        if (path === filePathA && openCallsByPath.get(path) === 2) {
          throw new Error('file unavailable');
        }
        return createWorkspaceFile(path, path === filePathA ? initialContentA : contentB);
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    const editorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });
    expect(editorA).toHaveValue(initialContentA);

    await user.clear(editorA);
    await user.type(editorA, draftContentA);
    expect(editorA).toHaveValue(draftContentA);

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(draftContentA);
      expect(screen.getByText('无法加载文件')).toBeInTheDocument();
    });
  });

  it('refreshes a clean draft when a file reload returns newer content', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench v1';
    const reloadedContentA = '# Workbench v2';
    const contentB = '# Notes';
    const openCallsByPath = new Map<string, number>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        openCallsByPath.set(path, (openCallsByPath.get(path) ?? 0) + 1);
        if (path === filePathA) {
          return createWorkspaceFile(path, openCallsByPath.get(path) === 1 ? initialContentA : reloadedContentA);
        }
        return createWorkspaceFile(path, contentB);
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    expect(await screen.findByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(initialContentA);
    expect(screen.getByText('已保存到本地草稿')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(reloadedContentA);
      expect(screen.getByText('已保存到本地草稿')).toBeInTheDocument();
      expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    });
  });

  it('ignores stale reloads that resolve after saving newer content', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench v1';
    const savedContentA = '# Workbench v2';
    const contentB = '# Notes';
    const saveDeferred = createDeferred<WorkspaceFile>();
    const staleReloadDeferred = createDeferred<WorkspaceFile>();
    const openCallsByPath = new Map<string, number>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      openFile(path: string) {
        openCallsByPath.set(path, (openCallsByPath.get(path) ?? 0) + 1);
        if (path === filePathA && openCallsByPath.get(path) === 2) {
          return staleReloadDeferred.promise;
        }
        return Promise.resolve(createWorkspaceFile(path, path === filePathA ? initialContentA : contentB));
      },
      saveFile() {
        return saveDeferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });
    expect(editorA).toHaveValue(initialContentA);

    await user.clear(editorA);
    await user.type(editorA, savedContentA);
    await user.click(screen.getByRole('button', { name: '保存到本地草稿' }));

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));
    expect(screen.getByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(savedContentA);

    await act(async () => {
      saveDeferred.resolve(createWorkspaceFile(filePathA, savedContentA));
      await saveDeferred.promise;
    });

    await act(async () => {
      staleReloadDeferred.resolve(createWorkspaceFile(filePathA, initialContentA));
      await staleReloadDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(savedContentA);
      expect(screen.getByText('已保存到本地草稿')).toBeInTheDocument();
      expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    });
  });

  it('shows the editor when loading the project tree fails', async () => {
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const content = '# Workbench';

    const fileService = {
      async listTree() {
        throw new Error('tree unavailable');
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, content);
      },
      async saveFile(path: string, nextContent: string) {
        return createWorkspaceFile(path, nextContent);
      }
    };

    render(<App fileService={fileService} />);

    expect(await screen.findByText('无法加载项目文件')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: `${filePath} 编辑器` })).toHaveValue(content);
  });
});

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

function createHostBridge(): HostBridge & { savedConnection?: { baseUrl: string; token: string } } {
  return {
    kind: 'browser',
    savedConnection: undefined,
    async readConnectionConfig() {
      return null;
    },
    async writeConnectionConfig(config) {
      this.savedConnection = config;
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
