import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentEventEnvelope,
  AgentEventPayload,
  CodexModelListResponse,
  CodexMcpListResponse,
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
  CodexStatusResponse,
  CreatorJson,
  CreatorJob,
  CreateScheduleRequest,
  EnterpriseKnowledgeBaseResponse,
  EnterpriseKnowledgeDocumentResponse,
  EnterpriseSessionResponse,
  EnterpriseSharedFileResponse,
  EnterpriseSharedSpaceResponse,
  EnterpriseSkillListResponse,
  EnterpriseSkillResponse,
  ProjectResponse,
  RunDiagnosticsResponse,
  RunResponse,
  ScheduleResponse,
  TaskItem,
  ThreadResponse
} from '@opencreator/protocol';
import {
  App as ProductionApp,
  type AppProps
} from './App.js';
import {
  buildComposerConnectors,
  buildComposerSlashCommands,
  formatRelativeTime
} from './AppController.js';
import { PROJECTS_STORAGE_KEY } from '../features/projects/project-model.js';
import type { OpenCreatorProject } from '../features/projects/project-model.js';
import type { HostBridge } from '../host/bridge.js';
import type { SubscribeRunEventsInput } from '../runtime/sse.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import {
  readCachedModelCatalog,
  readRecentModelConfig,
  writeCachedModelCatalog,
  writeRecentModelConfig
} from '../services/model-service-2026-08-05.js';

vi.mock('react-virtuoso', async () => import('../test/react-virtuoso-mock.js'));
vi.mock('@opencreator/skill-market', async importOriginal => {
  const actual = await importOriginal<typeof import('@opencreator/skill-market')>();
  return {
    ...actual,
    skillMarketCatalog: actual.skillMarketCandidateCatalog
  };
});

let testRuntimeProjects: ProjectResponse[] | undefined;
let testCreatorJobs: CreatorJob[] = [];
let testCreatorJobsByCreationKey = new Map<string, string>();

function App(props: AppProps = {}) {
  return <ProductionApp projectNavigationMode="tree" {...props} />;
}

describe('App', () => {
  it('maps valid skills and configured MCP servers into Composer commands', () => {
    expect(buildComposerSlashCommands(createSkillListResponse([
      createSkillResponse({ id: 'brainstorming', name: 'Brainstorming' })
    ]), {
      codexHome: '/tmp/codex',
      codexHomeMode: 'global',
      requiresWriteConfirmation: false,
      servers: [{
        name: 'github',
        enabled: true,
        transport: 'stdio',
        status: 'configured',
        envKeys: [],
        hasSecrets: false,
        codexHome: '/tmp/codex',
        codexHomeMode: 'global',
        diagnostics: []
      }],
      diagnostics: []
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'skill', insertText: '$brainstorming ' }),
      expect.objectContaining({ category: 'mcp', insertText: '使用 MCP：github ' })
    ]));
  });

  it('maps the enterprise MCP catalog into the Composer connector directory', () => {
    expect(buildComposerConnectors({
      agentId: 'opencreator_agent',
      tokenStatus: 'ready',
      refreshedAt: new Date(0).toISOString(),
      upstreams: [{
        upstreamId: 'crm-main',
        name: '客户关系管理',
        domain: 'sales',
        endpoint: 'https://enterprise.example/mcp/servers/crm-main',
        upstreamTransport: 'streamable_http',
        namespace: 'crm',
        status: 'active',
        installed: true,
        enabled: true,
        tools: [{
          toolId: 'customer-search',
          upstreamName: 'customer.search',
          name: 'customer.search',
          exposedName: 'crm.customer.search',
          title: '查询客户',
          description: '按条件查询客户资料',
          riskLevel: 'low',
          confirmRequired: false,
          status: 'active',
          authorized: true,
          authorizationExpiresAt: null
        }]
      }]
    })).toEqual([{
      id: 'enterprise:crm-main',
      label: '客户关系管理',
      description: 'sales · 1/1 项工具已授权',
      status: 'enabled',
      insertText: '使用连接器：客户关系管理 '
    }]);
  });

  it('treats timezone-less Runtime timestamps as UTC before formatting relative time', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(
      Date.parse('2026-07-21T07:00:30.000Z')
    );

    expect(formatRelativeTime('2026-07-21 07:00:00')).toBe('刚刚');

    now.mockRestore();
  });

  it('restores a primary page directly from its URL', async () => {
    window.location.hash = '#/search';

    render(<App />);

    expect(await screen.findByRole('searchbox', { name: '搜索会话' })).toHaveAttribute(
      'placeholder',
      '搜索会话内容'
    );
    expect(screen.getByRole('button', { name: '搜索' })).toHaveAttribute('aria-current', 'page');
  });

  it('restores activity list and detail views from browser history routes', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/activity?range=7d';
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Agent动态' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agent动态' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '今天' }));
    await waitFor(() => expect(window.location.hash).toBe('#/activity?range=today'));
    expect(screen.getByTestId('total-tokens')).toHaveTextContent('184,200');

    window.history.replaceState(null, '', '#/plugins');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(await screen.findByRole('region', { name: '技能目录' })).toBeInTheDocument();

    window.history.replaceState(null, '', '#/activity/agent/collector-beijing/agent-customer?range=30d');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(await screen.findByRole('heading', { name: '客户洞察' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agent动态' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '近 30 天' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores the dashboard directly from its URL', async () => {
    window.location.hash = '#/dashboard';
    render(<App />);

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('数据看板')).not.toBeInTheDocument();
  });

  it('opens a creator workbench after the app has already rendered', async () => {
    render(<App />);

    await waitFor(() => {
      expect(document.querySelector('.conversation-page')).toBeInTheDocument();
    });

    window.history.pushState(null, '', '#/workbench?tool=video-translation');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await waitFor(() => {
      expect(document.querySelector('.creator-workspace-page')).toBeInTheDocument();
    });
    expect(document.querySelector('.conversation-page')).not.toBeInTheDocument();

    window.history.pushState(null, '', '#/');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await waitFor(() => {
      expect(document.querySelector('.conversation-page')).toBeInTheDocument();
    });
    expect(document.querySelector('.creator-workspace-page')).not.toBeInTheDocument();
  });

  it('opens a new cover workspace without creating a job until the first edit', async () => {
    window.location.hash = '#/workbench?tool=cover-generator';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    let createRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === '/creator/jobs' && init?.method === 'POST') {
        createRequests += 1;
        await new Promise(resolve => window.setTimeout(resolve, 20));
      }
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.includes('/threads?')) return jsonResponse({ threads: [] });
      throw new Error(`Unexpected request ${url}`);
    };

    render(
      <StrictMode>
        <App
          fileService={createFileService()}
          hostBridge={hostBridge}
          runtimeFetch={runtimeFetch}
          subscribeRunEvents={async () => undefined}
        />
      </StrictMode>
    );

    expect(await screen.findByRole('heading', { name: '封面生成' })).toBeInTheDocument();
    await new Promise(resolve => window.setTimeout(resolve, 50));
    expect(window.location.hash).toBe('#/workbench?tool=cover-generator');
    expect(createRequests).toBe(0);
    expect(testCreatorJobs).toHaveLength(0);

    fireEvent.change(screen.getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '为新视频生成一张蓝色科技感封面' }
    });
    await waitFor(() => {
      expect(window.location.hash).toBe(
        '#/workbench?tool=cover-generator&jobId=creator-job-1'
      );
    });
    expect(createRequests).toBe(1);
    expect(testCreatorJobs).toHaveLength(1);
  });

  it('recovers the same creator job when creation succeeds but its response is lost', async () => {
    window.location.hash = '#/workbench?tool=cover-generator';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const creationKeys: string[] = [];
    let rejectFirstResponse: ((reason: Error) => void) | undefined;
    const firstResponse = new Promise<Response>((_resolve, reject) => {
      rejectFirstResponse = reject;
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname === '/creator/jobs' && init?.method === 'POST') {
        const body = readRequestBody(init);
        creationKeys.push(String(body.creationKey));
        const response = handleDefaultProjectApiRequest(url, init);
        if (creationKeys.length === 1) return firstResponse;
        return response!;
      }
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.includes('/threads?')) return jsonResponse({ threads: [] });
      throw new Error(`Unexpected request ${url}`);
    };

    const firstRender = render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );
    expect(await screen.findByRole('heading', { name: '封面生成' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '第一次编辑后连接中断' }
    });
    await waitFor(() => expect(testCreatorJobs).toHaveLength(1));
    firstRender.unmount();

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByRole('heading', { name: '封面生成' })).toBeInTheDocument();
    rejectFirstResponse?.(new TypeError('connection closed after commit'));
    fireEvent.change(screen.getByRole('textbox', { name: '封面提示词' }), {
      target: { value: '恢复同一个创建请求' }
    });
    await waitFor(() => expect(creationKeys.length).toBeGreaterThanOrEqual(3));
    expect(new Set(creationKeys).size).toBe(1);
    expect(testCreatorJobs).toHaveLength(1);
    expect(window.location.hash).toBe(
      '#/workbench?tool=cover-generator&jobId=creator-job-1'
    );
  });

  it('restores the project library directly from its URL', async () => {
    window.location.hash = '#/projects';
    render(<App projectNavigationMode="library" />);

    expect(await screen.findByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的项目' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByLabelText('项目和对话')).not.toBeInTheDocument();
  });

  it('opens connectors inside the plugin center and returns to the default Skills tab', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/plugins?tab=connections';
    render(<App />);

    expect(await screen.findByRole('tab', { name: '连接器' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '插件中心' }))
      .toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: '连接器' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '正在等待本地 Runtime' }))
      .toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '技能' }));

    await waitFor(() => expect(window.location.hash).toBe('#/plugins'));
    expect(screen.getByRole('tab', { name: '技能' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: '技能目录' })).toBeInTheDocument();
  });

  it('restores my assets and switches between knowledge and materials', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/assets';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: '知识库' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '我的资产' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '知识库' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: '素材中心' }));
    await waitFor(() => expect(window.location.hash).toBe('#/assets?tab=materials'));
    expect(screen.getByRole('tab', { name: '素材中心' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { level: 1, name: '素材中心' })).toBeInTheDocument();
    window.history.replaceState(null, '', '#/plugins');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(await screen.findByRole('region', { name: '技能目录' })).toBeInTheDocument();
    window.history.replaceState(null, '', '#/knowledge');
    act(() => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(await screen.findByRole('heading', { level: 1, name: '知识库' })).toBeInTheDocument();
  });

  it('keeps knowledge inside asset management without a conversation entry', async () => {
    window.location.hash = '#/knowledge';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = createKnowledgeRuntimeFetch((url) => {
      if (url.endsWith('/enterprise/knowledge-bases')) {
        return jsonResponse(createKnowledgeBaseListResponse());
      }
      return undefined;
    });

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '知识库' }))
        .toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '对话知识库' }))
      .not.toBeInTheDocument();
    expect(window.location.hash).toBe('#/knowledge');
  });

  it('loads authorized knowledge documents and refreshes both lists after upload', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/knowledge';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let knowledgeBaseRequests = 0;
    let documentRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
      }
      if (url.endsWith('/enterprise/session')) {
        return jsonResponse(createEnterpriseSessionResponse());
      }
      if (url.endsWith('/enterprise/knowledge-bases')) {
        knowledgeBaseRequests += 1;
        return jsonResponse(createKnowledgeBaseListResponse([
          createKnowledgeBaseResponse()
        ]));
      }
      if (
        url.includes('/enterprise/knowledge-bases/kb-product/documents?')
        && init?.method === 'POST'
      ) {
        return jsonResponse({
          document: createKnowledgeDocumentResponse({
            documentId: 'doc-upload',
            name: '发布流程.md',
            mimeType: 'text/markdown',
            status: 'processing'
          })
        }, { status: 201 });
      }
      if (url.endsWith('/enterprise/knowledge-bases/kb-product/documents')) {
        documentRequests += 1;
        return jsonResponse(createKnowledgeDocumentListResponse(
          documentRequests === 1
            ? [createKnowledgeDocumentResponse()]
            : [
                createKnowledgeDocumentResponse(),
                createKnowledgeDocumentResponse({
                  documentId: 'doc-upload',
                  name: '发布流程.md',
                  mimeType: 'text/markdown',
                  status: 'processing'
                })
              ]
        ));
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

    expect(await screen.findByRole('heading', { name: '产品资料' }))
      .toBeInTheDocument();
    expect(await screen.findByText('产品手册.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /产品资料/ }));
    expect(screen.getByText('产品手册.pdf')).toBeInTheDocument();

    const file = new File(['# 发布流程'], '发布流程.md', {
      type: 'text/markdown'
    });
    await user.upload(screen.getByLabelText('选择知识库文档'), file);

    expect(await screen.findByText('发布流程.md 已提交处理，请关注文档状态'))
      .toBeInTheDocument();
    expect(await screen.findByText('发布流程.md')).toBeInTheDocument();
    await waitFor(() => {
      expect(knowledgeBaseRequests).toBe(2);
      expect(documentRequests).toBeGreaterThanOrEqual(2);
    });
    const uploadCalls = fetchCalls.filter(call => (
      call.url.includes('/enterprise/knowledge-bases/kb-product/documents?')
      && call.init?.method === 'POST'
    ));
    expect(uploadCalls).toHaveLength(1);
    expect(new Headers(uploadCalls[0]?.init?.headers).get('Content-Type'))
      .toBe('application/vnd.opencreator.knowledge-document');
    expect(uploadCalls[0]?.init?.body).toBe(file);
  });

  it('keeps the knowledge page available when a remote request returns 401', async () => {
    window.location.hash = '#/knowledge';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = createKnowledgeRuntimeFetch((url) => {
      if (url.endsWith('/enterprise/knowledge-bases')) {
        return jsonResponse({
          error: {
            code: 'ENTERPRISE_SESSION_EXPIRED',
            message: 'Enterprise session expired'
          }
        }, { status: 401 });
      }
      return undefined;
    });

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/登录企业账户/)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: '知识库' }))
        .toBeInTheDocument();
    });
  });

  it('refreshes permissions and disables upload after a 403', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/knowledge';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    let knowledgeBaseRequests = 0;
    const runtimeFetch = createKnowledgeRuntimeFetch((url, init) => {
      if (url.endsWith('/enterprise/knowledge-bases')) {
        knowledgeBaseRequests += 1;
        return jsonResponse(createKnowledgeBaseListResponse([
          createKnowledgeBaseResponse({
            permissions: {
              read: true,
              upload: knowledgeBaseRequests === 1,
              search: false
            }
          })
        ]));
      }
      if (
        url.includes('/enterprise/knowledge-bases/kb-product/documents?')
        && init?.method === 'POST'
      ) {
        return jsonResponse({
          error: {
            code: 'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN',
            message: 'Enterprise document upload is forbidden'
          }
        }, { status: 403 });
      }
      if (url.endsWith('/enterprise/knowledge-bases/kb-product/documents')) {
        return jsonResponse(createKnowledgeDocumentListResponse());
      }
      return undefined;
    });

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    await user.upload(
      await screen.findByLabelText('选择知识库文档'),
      new File(['manual'], 'manual.pdf', { type: 'application/pdf' })
    );

    expect(await screen.findByRole('alert'))
      .toHaveTextContent('当前账户已没有该知识库的上传权限');
    await waitFor(() => {
      expect(knowledgeBaseRequests).toBe(2);
      expect(screen.queryByRole('button', { name: '上传文档' }))
        .not.toBeInTheDocument();
    });
  });

  it('refreshes the authorized list when a selected knowledge base returns 404', async () => {
    window.location.hash = '#/knowledge';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    let knowledgeBaseRequests = 0;
    const runtimeFetch = createKnowledgeRuntimeFetch((url) => {
      if (url.endsWith('/enterprise/knowledge-bases')) {
        knowledgeBaseRequests += 1;
        return jsonResponse(createKnowledgeBaseListResponse(
          knowledgeBaseRequests === 1 ? [createKnowledgeBaseResponse()] : []
        ));
      }
      if (url.endsWith('/enterprise/knowledge-bases/kb-product/documents')) {
        return jsonResponse({
          error: {
            code: 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND',
            message: 'Enterprise knowledge base was not found'
          }
        }, { status: 404 });
      }
      return undefined;
    });

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('还没有资料集合')).toBeInTheDocument();
      expect(knowledgeBaseRequests).toBe(2);
      expect(screen.queryByText('产品资料')).not.toBeInTheDocument();
    });
  });

  it('loads shared drive data from Runtime and saves into the current project with explicit overwrite', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/assets?tab=materials';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const project = readTestRuntimeProjects()[0]!;
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let downloadRequests = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) {
        return jsonResponse(createCodexStatusResponse());
      }
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
      }
      if (url.endsWith('/enterprise/session')) {
        return jsonResponse(createEnterpriseSessionResponse());
      }
      if (url.endsWith('/enterprise/shared-spaces?limit=100')) {
        return jsonResponse(createSharedSpaceListResponse([
          createSharedSpaceResponse()
        ]));
      }
      if (url.endsWith('/enterprise/shared-files?limit=100')) {
        return jsonResponse(createSharedFileListResponse([
          createSharedFileResponse()
        ]));
      }
      if (
        url.endsWith('/enterprise/shared-files/file-design/download')
        && init?.method === 'POST'
      ) {
        downloadRequests += 1;
        if (downloadRequests === 1) {
          return jsonResponse({
            error: {
              code: 'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS',
              message: 'The project already contains this file',
              details: { relativePath: 'docs/design.md' }
            }
          }, { status: 409 });
        }
        return jsonResponse({
          fileId: 'file-design',
          projectId: project.id,
          relativePath: 'docs/design.md',
          sizeBytes: 13,
          sha256: 'a'.repeat(64),
          revision: 3,
          overwritten: true
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

    expect(await screen.findByText('design.md')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '素材中心' })).toBeInTheDocument();
    expect(screen.getByText(`保存到 ${project.name}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '上传文件' }))
      .not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: '保存 design.md 到当前项目' })
    );
    await user.click(
      await screen.findByRole('button', { name: '覆盖保存 design.md' })
    );

    expect(await screen.findByText(
      `docs/design.md 已覆盖保存到项目“${project.name}”`
    )).toBeInTheDocument();
    const downloadCalls = fetchCalls.filter(call => (
      call.url.endsWith('/enterprise/shared-files/file-design/download')
      && call.init?.method === 'POST'
    ));
    expect(downloadCalls).toHaveLength(2);
    expect(downloadCalls.map(call => JSON.parse(String(call.init?.body))))
      .toEqual([
        { projectId: project.id },
        { projectId: project.id, overwrite: true }
      ]);
  });

  it('updates the copyable URL when navigating between primary pages', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: '插件中心' }));

    await waitFor(() => expect(window.location.hash).toBe('#/plugins'));
    expect(await screen.findByRole('region', { name: '技能目录' })).toBeInTheDocument();
  });

  it('keeps the account route available without exposing a guest login entry', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/account';
    render(<App fileService={createFileService()} />);

    const navigation = await screen.findByLabelText('OpenCreator 导航');
    expect(await screen.findByRole('heading', { name: '登录 OpenCreator' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/account');
    expect(within(navigation).queryByRole('button', { name: '登录' }))
      .not.toBeInTheDocument();

    await user.click(within(document.querySelector<HTMLElement>('.consumer-account-page')!)
      .getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('heading', { name: '林夏' })).toBeInTheDocument();
    expect(screen.getByText('linxia@opencreator.local')).toBeInTheDocument();
    expect(within(navigation).getByRole('button', { name: '林夏' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置' }));

    expect(await screen.findByRole('heading', { name: '常规' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/settings');
  });

  it('opens the global task center and jumps from a task to its run detail', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/tasks';
    const hostBridge = createHostBridge();
    const task: TaskItem = {
      id: 'run_task',
      runId: 'run_task',
      threadId: 'thread_task',
      title: '后台整理任务',
      status: 'succeeded',
      runStatus: 'succeeded',
      cwd: '/workspace/tasks',
      profile: 'default',
      createdBy: 'api',
      submissionMode: 'enqueue',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt: '2026-07-12T10:01:00.000Z',
      startedAt: '2026-07-12T10:00:10.000Z',
      endedAt: '2026-07-12T10:01:00.000Z'
    };
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [createThreadResponse({ id: 'thread_task', title: '后台整理任务' })]
        });
      }
      if (url.includes('/tasks?')) return jsonResponse({ tasks: [task], hasMore: false });
      if (url.endsWith('/threads/thread_task/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_task', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_task/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({ id: 'run_task', threadId: 'thread_task', status: 'succeeded' })]
        });
      }
      if (url.endsWith('/runs/run_task/diagnostics')) {
        return jsonResponse({
          ...createRunDiagnosticsResponse(createCodexStatusResponse()),
          runId: 'run_task'
        });
      }
      if (url.endsWith('/runs/run_task')) {
        return jsonResponse(createRunResponse({
          id: 'run_task',
          threadId: 'thread_task',
          status: 'succeeded'
        }));
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

    expect(await screen.findByRole('heading', { name: '任务中心' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/tasks');

    await user.click(await within(screen.getByRole('list')).findByRole('button', { name: /后台整理任务/ }));

    expect(await screen.findByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    expect(screen.getByText('run_task')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/thread/thread_task');
  });

  it('restores a pending approval card from the task entry and targets it in the thread', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/tasks';
    const hostBridge = createHostBridge();
    const approval = {
      id: 'approval_task',
      runId: 'run_approval_task',
      threadId: 'thread_approval_task',
      turnId: 'turn_approval_task',
      itemId: 'item_approval_task',
      requestId: 'request_approval_task',
      kind: 'file_change' as const,
      status: 'pending' as const,
      risk: 'medium' as const,
      title: '允许写入文件',
      summary: '需要允许写入 docs/daily',
      details: { grantRoot: '/workspace/docs/daily' },
      requestedAt: '2026-07-14T10:00:00.000Z',
      expiresAt: '2026-07-14T10:10:00.000Z'
    };
    const task: TaskItem = {
      id: 'run_approval_task',
      runId: 'run_approval_task',
      threadId: 'thread_approval_task',
      title: '每日总结',
      status: 'waiting_approval',
      runStatus: 'running',
      cwd: '/workspace',
      profile: 'default',
      createdBy: 'schedule',
      submissionMode: 'enqueue',
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedAt: '2026-07-14T10:01:00.000Z',
      pendingApproval: approval
    };
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [createThreadResponse({
            id: 'thread_approval_task',
            title: '每日总结',
            purpose: 'schedule_task',
            scheduleId: 'schedule_approval_task'
          })]
        });
      }
      if (url.includes('/tasks?')) return jsonResponse({ tasks: [task], hasMore: false });
      if (url.endsWith('/threads/thread_approval_task/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_approval_task',
          codexThreadId: null,
          items: []
        });
      }
      if (url.endsWith('/threads/thread_approval_task/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({
            id: 'run_approval_task',
            threadId: 'thread_approval_task',
            status: 'running'
          })]
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    const firstRender = render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByRole('heading', { name: '任务中心' })).toBeInTheDocument();
    await user.click(await within(await screen.findByRole('list')).findByRole('button', {
      name: /每日总结/
    }));

    const approvalRegion = await screen.findByRole('region', {
      name: '允许写入文件'
    });
    expect(document.querySelector('[data-search-target="true"]'))
      .toContainElement(approvalRegion);
    expect(screen.queryByRole('heading', { name: '运行详情' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/thread/thread_approval_task?runId=run_approval_task&approvalId=approval_task'
    );
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

    const navigation = await screen.findByLabelText('OpenCreator 导航');
    await user.click(screen.getByRole('button', { name: '打开导航' }));
    expect(navigation).toHaveAttribute('data-mobile-open', 'true');

    await user.click(screen.getByRole('button', { name: '插件中心' }));
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
      expect.objectContaining({ opencreatorMobileNavigation: true }),
      ''
    );

    await user.click(screen.getByRole('button', { name: '关闭导航' }));

    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('OpenCreator 导航')).toHaveAttribute('data-mobile-open', 'false');
  });

  it('replaces the temporary mobile drawer entry when navigating from the drawer', async () => {
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
    const back = vi.spyOn(window.history, 'back');

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '打开导航' }));
    await user.click(screen.getByRole('button', { name: '插件中心' }));

    await waitFor(() => expect(window.location.hash).toBe('#/plugins'));
    expect(back).not.toHaveBeenCalled();
    expect(window.history.state?.opencreatorMobileNavigation).not.toBe(true);
    expect(screen.getByLabelText('OpenCreator 导航')).toHaveAttribute('data-mobile-open', 'false');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    testRuntimeProjects = undefined;
    testCreatorJobs = [];
    testCreatorJobsByCreationKey = new Map();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  });

  it('renders the OpenCreator desktop app shell without Codex product branding', async () => {
    render(<App fileService={createFileService()} />);

    expect(await screen.findByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作台' })).toBeInTheDocument();
    expect(await screen.findByText('需要帮你做点什么')).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: /^(上午|下午|晚上)好，创作者$/
    })).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-lightfall-background')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 完全访问权限' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
    expect(screen.queryByText('跟随全局模型')).not.toBeInTheDocument();
    expect(screen.queryByText('跟随全局配置')).not.toBeInTheDocument();
    expect(screen.queryByText('5.5 超高')).not.toBeInTheDocument();
    expect(screen.queryByText('本地模式')).not.toBeInTheDocument();
    expect(screen.queryByText('open-opencreator')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex Runtime Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Runtime 地址')).not.toBeInTheDocument();
    expect(screen.queryByText(/Token|API Key|连接 Runtime/)).not.toBeInTheDocument();
  });

  it('opens a Home Skill interaction without submitting its prompt hint', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.includes('/threads?')) return jsonResponse({ threads: [] });
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

    await user.click(await screen.findByRole('button', {
      name: '使用多语言视频翻译模板'
    }));

    expect(await screen.findByRole('heading', { name: '视频翻译配音' })).toBeInTheDocument();
    expect(screen.queryByLabelText('OpenCreator 导航')).not.toBeInTheDocument();
    const agentInput = screen.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    expect(agentInput).toHaveAttribute('placeholder', '上传视频，或者输入有效的视频链接');
    expect(agentInput).toHaveValue('');
    await user.click(screen.getByRole('button', { name: '返回工作台' }));
    expect(await screen.findByLabelText('OpenCreator 导航')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/workbench'));
  });

  it('keeps a non-workspace Home Skill inactive until the user writes a prompt', async () => {
    const user = userEvent.setup();
    render(<App fileService={createFileService()} />);

    await user.click(await screen.findByRole('button', { name: '使用数字人口播模板' }));

    const composer = screen.getByRole('textbox', { name: '输入任务' });
    expect(composer).toHaveValue('');
    expect(screen.getByRole('heading', { name: '创作模板' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('adds a title bar safe area only when the host exposes the capability', async () => {
    const hostBridge = createHostBridge();
    hostBridge.windowChrome = {
      integratedTitleBar: true,
      titleBarHeight: 38,
      trafficLightInset: 76
    };

    render(<App fileService={createFileService()} hostBridge={hostBridge} />);

    await screen.findByRole('button', { name: '工作台' });
    const shell = document.querySelector<HTMLElement>('.app-drop-shell');
    expect(shell).toHaveAttribute('data-integrated-title-bar', 'true');
    expect(shell?.style.getPropertyValue('--opencreator-titlebar-height')).toBe('38px');
    expect(shell?.style.getPropertyValue('--opencreator-traffic-light-inset')).toBe('76px');
    expect(document.querySelector('.desktop-titlebar-drag-region')).toBeInTheDocument();
    expect(document.querySelector('.opencreator-main-titlebar')).not.toBeInTheDocument();
  });

  it('moves a desktop conversation title into the integrated titlebar without duplicating it', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.windowChrome = {
      integratedTitleBar: true,
      titleBarHeight: 38,
      trafficLightInset: 76
    };
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const thread = createThreadResponse({
      id: 'thread-integrated-title',
      title: 'hello'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [thread] });
      }
      if (url.endsWith(`/threads/${thread.id}/history?limit=50`)) {
        return jsonResponse({ threadId: thread.id, codexThreadId: null, items: [] });
      }
      if (url.endsWith(`/threads/${thread.id}/runs?limit=50`)) {
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /hello/ }));

    const mainTitlebar = document.querySelector<HTMLElement>('.opencreator-main-titlebar');
    expect(mainTitlebar).toBeInTheDocument();
    expect(within(mainTitlebar!).getByRole('heading', { name: 'hello' })).toBeInTheDocument();
    expect(document.querySelector('.conversation-page > .conversation-header')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'hello' })).toHaveLength(1);

    await user.click(within(mainTitlebar!).getByRole('button', { name: '文件' }));

    expect(await screen.findByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(within(mainTitlebar!).getByRole('button', { name: '文件' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('waits for restored conversation history before showing the empty conversation layout', async () => {
    const user = userEvent.setup();
    const [project] = persistProjects('/Users/test/develop/clean');
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: project.id,
      selectedThreadId: 'thread-restored-loading'
    }));
    const history = createDeferred<Response>();
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.windowChrome = {
      integratedTitleBar: true,
      titleBarHeight: 38,
      trafficLightInset: 76
    };
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const thread = createThreadResponse({
      id: 'thread-restored-loading',
      title: 'hello',
      projectId: project.id,
      cwd: project.cwd,
      canonicalCwd: project.cwd
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [thread] });
      }
      if (url.endsWith(`/threads/${thread.id}/history?limit=50`)) {
        return history.promise;
      }
      if (url.endsWith(`/threads/${thread.id}/runs?limit=50`)) {
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

    expect(await screen.findByRole('status', { name: '正在加载会话历史' }))
      .toBeInTheDocument();
    expect(document.querySelector('.conversation-page')).not.toHaveClass('is-empty');
    expect(screen.queryByText('需要帮你做点什么')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '创作模板' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择项目/ })).not.toBeInTheDocument();

    history.resolve(jsonResponse({
      threadId: thread.id,
      codexThreadId: null,
      items: []
    }));

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: '正在加载会话历史' }))
        .not.toBeInTheDocument();
    });
    expect(document.querySelector('.conversation-page')).toHaveClass('is-empty');
    expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '创作模板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择项目/ })).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /^视频翻译/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '工作台' }));
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^视频翻译/ }));
    expect(screen.getByRole('heading', { name: '视频翻译配音' })).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: '视频链接' }),
      'https://www.youtube.com/watch?v=test'
    );
    await user.click(screen.getByRole('button', { name: '继续' }));
    await user.click(screen.getByRole('button', { name: '继续' }));
    await user.click(within(
      screen.getByRole('region', { name: '视频翻译操作区' })
    ).getByRole('button', { name: '开始翻译' }));
    expect(screen.getByRole('heading', { name: '视频翻译项目' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '成片' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '字幕' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('textbox', { name: '输入任务' })).not.toBeInTheDocument();
  });

  it('uploads a selected local video before starting the translation stage', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('opencreator.preferences.language', 'en-US');
    window.location.hash = '#/workbench?tool=video-translation';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const workflowRequests: string[] = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const parsedUrl = new URL(url);
      if (/^\/creator\/jobs\/[^/]+\/source-video$/.test(parsedUrl.pathname)) {
        workflowRequests.push('upload-source');
      }
      if (/^\/creator\/jobs\/[^/]+\/actions$/.test(parsedUrl.pathname)) {
        const body = readRequestBody(init ?? {});
        if (body.action === 'run-stage') workflowRequests.push('run-stage');
      }
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.includes('/threads?')) return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('heading', { name: 'Translate & Dub Video' }))
      .toBeInTheDocument();
    const file = new File(['local-video'], 'local.webm', {
      type: 'video/webm',
      lastModified: 123
    });
    await user.upload(screen.getByLabelText('Upload a local video'), file);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(within(
      screen.getByRole('region', { name: 'Video translation workspace' })
    ).getByRole('button', { name: 'Start translation' }));

    await waitFor(() => expect(workflowRequests).toEqual(['upload-source', 'run-stage']));
  });

  it('keeps a browser conversation title inside the conversation page', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const thread = createThreadResponse({
      id: 'thread-browser-title',
      title: '浏览器会话标题'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [thread] });
      }
      if (url.endsWith(`/threads/${thread.id}/history?limit=50`)) {
        return jsonResponse({ threadId: thread.id, codexThreadId: null, items: [] });
      }
      if (url.endsWith(`/threads/${thread.id}/runs?limit=50`)) {
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /浏览器会话标题/ }));

    const conversationPage = document.querySelector<HTMLElement>('.conversation-page');
    expect(conversationPage).toBeInTheDocument();
    expect(within(conversationPage!).getByRole('heading', {
      name: '浏览器会话标题'
    })).toBeInTheDocument();
    expect(conversationPage?.querySelector(':scope > .conversation-header')).toBeInTheDocument();
    expect(document.querySelector('.opencreator-main-titlebar')).not.toBeInTheDocument();
  });

  it('keeps the guest greeting independent from remote account data', async () => {
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
      }
      if (url.endsWith('/enterprise/session')) {
        return jsonResponse(createEnterpriseSessionResponse({
          account: {
            subjectId: 'acct-lin',
            email: 'lin@example.com',
            name: '林晓'
          }
        }));
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

    expect(await screen.findByRole('heading', {
      name: /^(上午|下午|晚上)好，创作者$/
    })).toBeInTheDocument();
  });

  it('does not allow chat submission before the local runtime is connected', async () => {
    const user = userEvent.setup();
    const prompt = '整理企业 Agent Dashboard 设计';

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

  it('opens a previous schedule run in its task thread without opening diagnostics', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread-schedule-1',
              title: '每日总结',
              purpose: 'schedule_task',
              scheduleId: 'schedule-1'
            })
          ]
        });
      }
      if (url.endsWith('/schedules')) {
        return jsonResponse({ schedules: [createScheduleResponse()] });
      }
      if (url.endsWith('/tasks?status=all&limit=50')) {
        return jsonResponse({ tasks: [], hasMore: false });
      }
      if (url.endsWith('/threads/thread-schedule-1/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread-schedule-1',
          codexThreadId: null,
          items: [{
            id: 'history-schedule-trigger',
            type: 'schedule_trigger',
            prompt: '生成每日项目摘要',
            triggeredAt: '2026-07-14T14:05:00.000Z',
            createdAt: '2026-07-14T14:05:00.000Z',
            runId: 'run_schedule'
          }]
        });
      }
      if (url.endsWith('/threads/thread-schedule-1/runs?limit=50')) {
        return jsonResponse({ runs: [] });
      }
      throw new Error(`Unexpected request ${url}`);
    };

    const firstRender = render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={async () => undefined}
      />
    );

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '定时任务' }));

    expect(await screen.findByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'OpenCreator：已安排' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看上次运行' }));

    expect(await screen.findByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/thread/thread-schedule-1?runId=run_schedule');
    expect(screen.queryByRole('heading', { name: '运行详情' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeInTheDocument();
    expect(screen.getByText('定时执行')).toBeInTheDocument();
    expect(screen.getByText('生成每日项目摘要')).toBeInTheDocument();
  });

  it('shows task management only inside a bound schedule thread', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.windowChrome = {
      integratedTitleBar: true,
      titleBarHeight: 38,
      trafficLightInset: 76
    };
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread-normal',
              title: '普通会话'
            }),
            createThreadResponse({
              id: 'thread-schedule-1',
              title: '每日总结',
              purpose: 'schedule_task',
              scheduleId: 'schedule-1'
            })
          ]
        });
      }
      if (url.endsWith('/schedules')) {
        return jsonResponse({ schedules: [createScheduleResponse()] });
      }
      if (url.endsWith('/tasks?status=all&limit=50')) {
        return jsonResponse({ tasks: [], hasMore: false });
      }
      if (url.endsWith('/threads/thread-schedule-1/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread-schedule-1',
          codexThreadId: null,
          items: []
        });
      }
      if (url.endsWith('/threads/thread-schedule-1/runs?limit=50')) {
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(screen.queryByLabelText('任务管理')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /^每日总结/ }));

    expect(await screen.findByLabelText('任务管理')).toBeInTheDocument();
    expect(document.querySelector('.opencreator-main-titlebar')).toHaveTextContent('每日总结');
    expect(document.querySelector('.conversation-task-strip--standalone'))
      .toContainElement(screen.getByLabelText('任务管理'));
    expect(document.querySelector('.conversation-page > .conversation-header')).not.toBeInTheDocument();
    expect(screen.queryByText('需要帮你做点什么')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即运行任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暂停任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑任务' })).toBeInTheDocument();
  });

  it.each([
    {
      label: 'starts',
      response: {
        run: { id: 'run-now', threadId: 'thread-schedule-1', status: 'running' as const },
        schedule: createScheduleResponse({
          lastRunId: 'run-now',
          lastStatus: 'running'
        }),
        skipped: false,
        queued: false
      },
      expectedMessage: undefined
    },
    {
      label: 'queues',
      response: {
        run: null,
        schedule: createScheduleResponse({ pendingTrigger: true }),
        skipped: false,
        queued: true
      },
      expectedMessage: '本次运行已排队，会在当前任务结束后执行'
    },
    {
      label: 'skips',
      response: {
        run: null,
        schedule: createScheduleResponse(),
        skipped: true,
        queued: false
      },
      expectedMessage: '已有任务在运行，本次已跳过'
    }
  ])('$label a schedule from its task thread', async ({ response, expectedMessage }) => {
    const user = userEvent.setup();
    const runNow = createDeferred<Response>();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread-schedule-1',
              title: '每日总结',
              purpose: 'schedule_task',
              scheduleId: 'schedule-1'
            })
          ]
        });
      }
      if (url.endsWith('/schedules')) {
        return jsonResponse({ schedules: [createScheduleResponse()] });
      }
      if (url.endsWith('/tasks?status=all&limit=50')) {
        return jsonResponse({ tasks: [], hasMore: false });
      }
      if (url.endsWith('/schedules/schedule-1/run-now') && init?.method === 'POST') {
        return runNow.promise;
      }
      if (url.endsWith('/threads/thread-schedule-1/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread-schedule-1',
          codexThreadId: null,
          items: []
        });
      }
      if (url.endsWith('/threads/thread-schedule-1/runs?limit=50')) {
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

    await user.click(await screen.findByRole('button', { name: '定时任务' }));
    await user.click(await screen.findByRole('button', { name: '立即运行每日总结' }));

    expect(window.location.hash).toBe('#/thread/thread-schedule-1');
    runNow.resolve(jsonResponse(response));

    expect(await screen.findByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    if (expectedMessage !== undefined) {
      expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    }
  });

  it('opens schedule creation directly in the manual editor', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/schedules')) return jsonResponse({ schedules: [] });
      if (url.endsWith('/threads') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const cwd = body.workspaceMode === 'managed'
          ? '/runtime/workspaces/thread_schedule_builder'
          : String(body.cwd);
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_schedule_builder',
            title: String(body.title),
            cwd,
            canonicalCwd: cwd,
            workspaceMode: body.workspaceMode === 'managed' ? 'managed' : 'external',
            profile: String(body.profile),
            sandbox: body.sandbox === 'danger-full-access'
              ? 'danger-full-access'
              : 'workspace-write',
            purpose: body.purpose === 'schedule_draft'
              ? 'schedule_draft'
              : 'conversation'
          })
        }, { status: 201 });
      }
      if (
        url.endsWith('/threads/thread_schedule_builder/archive')
        && init?.method === 'POST'
      ) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_schedule_builder',
            title: '任务草稿',
            cwd: '/runtime/workspaces/thread_schedule_builder',
            canonicalCwd: '/runtime/workspaces/thread_schedule_builder',
            workspaceMode: 'managed',
            sandbox: 'workspace-write',
            purpose: 'schedule_draft',
            status: 'archived'
          })
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '定时任务' }));
    expect(await screen.findByRole('heading', { name: '定时任务' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^创建$/ }));
    expect(screen.getByRole('dialog', { name: '创建定时任务' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('使用 OpenCreator 创建')).not.toBeInTheDocument();
    expect(findPostCall(fetchCalls, '/threads')).toBeUndefined();
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
  });

  it('does not start an Agent run when opening schedule creation', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let scheduleListCalls = 0;
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/schedules') && init?.method !== 'POST') {
        scheduleListCalls += 1;
        return jsonResponse({ schedules: [] });
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const cwd = body.workspaceMode === 'managed'
          ? '/runtime/workspaces/thread_schedule_builder'
          : String(body.cwd);
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_schedule_builder',
            title: String(body.title),
            cwd,
            canonicalCwd: cwd,
            workspaceMode: body.workspaceMode === 'managed' ? 'managed' : 'external',
            profile: String(body.profile),
            sandbox: body.sandbox === 'danger-full-access' ? 'danger-full-access' : 'workspace-write',
            purpose: 'schedule_draft'
          })
        }, { status: 201 });
      }
      if (url.endsWith('/runs') && init?.method === 'POST') {
        return jsonResponse(createRunResponse({
          id: 'run_schedule_draft',
          threadId: 'thread_schedule_builder',
          status: 'running'
        }), { status: 202 });
      }
      if (url.endsWith('/threads/thread_schedule_builder/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({
            id: 'run_schedule_draft',
            threadId: 'thread_schedule_builder',
            status: 'succeeded'
          })]
        });
      }
      if (url.endsWith('/threads/thread_schedule_builder')) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_schedule_builder',
            title: '任务草稿',
            purpose: 'schedule_draft'
          })
        });
      }
      if (url.endsWith('/runs/run_schedule_draft/diagnostics')) {
        return jsonResponse(createRunDiagnosticsResponse(createCodexStatusResponse()));
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent(
        'assistant_message',
        {
          type: 'assistant_message',
          text: '你希望每天几点执行这项任务？',
          format: 'plain_text',
          delivery: 'message'
        },
        1,
        'run_schedule_draft'
      ));
      input.onEvent(createRuntimeEvent(
        'done',
        { type: 'done', status: 'succeeded', terminationReason: 'completed' },
        2,
        'run_schedule_draft'
      ));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '定时任务' }));
    await user.click(await screen.findByRole('button', { name: /^创建$/ }));
    expect(screen.getByRole('dialog', { name: '创建定时任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('定时任务标题')).toBeInTheDocument();
    expect(screen.getByLabelText('任务内容')).toBeInTheDocument();
    expect(findPostCall(fetchCalls, '/threads')).toBeUndefined();
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
    expect(findPostCall(fetchCalls, '/schedules')).toBeUndefined();
    expect(scheduleListCalls).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText('任务管理')).not.toBeInTheDocument();
  });

  it('keeps the current project selected while editing a new schedule', async () => {
    const user = userEvent.setup();
    const [customerProject] = persistProjects('/Users/test/project/customer-agent');
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: customerProject.id
    }));
    const hostBridge = createHostBridge();
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread-customer',
              title: '客户项目会话',
              cwd: '/Users/test/project/customer-agent',
              canonicalCwd: '/Users/test/project/customer-agent',
              sandbox: 'workspace-write'
            })
          ]
        });
      }
      if (url.endsWith('/schedules')) return jsonResponse({ schedules: [] });
      if (url.endsWith('/threads') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const cwd = body.workspaceMode === 'managed'
          ? '/runtime/workspaces/thread-schedule-draft'
          : String(body.cwd);
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread-schedule-draft',
            title: String(body.title),
            cwd,
            canonicalCwd: cwd,
            workspaceMode: body.workspaceMode === 'managed' ? 'managed' : 'external',
            profile: String(body.profile),
            sandbox: body.sandbox === 'danger-full-access'
              ? 'danger-full-access'
              : 'workspace-write',
            purpose: 'schedule_draft'
          })
        }, { status: 201 });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'customer-agent' }))
        .toHaveAttribute('data-current-project', 'true');
    });
    await user.click(screen.getByRole('button', { name: '定时任务' }));
    await user.click(await screen.findByRole('button', { name: /^创建$/ }));
    expect(screen.getByRole('dialog', { name: '创建定时任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'customer-agent' }))
      .toHaveAttribute('data-current-project', 'true');
    expect(screen.getByRole('heading', { name: '请选择访问权限' })).toBeInTheDocument();
    expect(findPostCall(fetchCalls, '/threads')).toBeUndefined();
    expect(within(screen.getByLabelText('customer-agent 对话')).queryByText('任务草稿'))
      .not.toBeInTheDocument();
  });

  it('does not reconcile schedule drafts when the manual editor opens', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    let scheduleListCalls = 0;
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const schedule = createScheduleResponse({
      id: 'schedule-manuscript',
      threadId: 'thread_schedule_builder',
      name: '每日文稿'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/schedules') && init?.method !== 'POST') {
        scheduleListCalls += 1;
        return jsonResponse({
          schedules: scheduleListCalls === 1 ? [] : [schedule]
        });
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_schedule_builder',
            title: '任务草稿',
            purpose: 'schedule_draft'
          })
        }, { status: 201 });
      }
      if (url.endsWith('/runs') && init?.method === 'POST') {
        return jsonResponse(createRunResponse({
          id: 'run_schedule_create',
          threadId: 'thread_schedule_builder',
          status: 'running'
        }), { status: 202 });
      }
      if (url.endsWith('/threads/thread_schedule_builder/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({
            id: 'run_schedule_create',
            threadId: 'thread_schedule_builder',
            status: 'succeeded'
          })]
        });
      }
      if (url.endsWith('/threads/thread_schedule_builder')) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_schedule_builder',
            title: '每日文稿',
            purpose: 'schedule_task',
            scheduleId: 'schedule-manuscript'
          })
        });
      }
      if (url.endsWith('/runs/run_schedule_create/diagnostics')) {
        return jsonResponse(createRunDiagnosticsResponse(createCodexStatusResponse()));
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent(
        'done',
        { type: 'done', status: 'succeeded', terminationReason: 'completed' },
        1,
        'run_schedule_create'
      ));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '定时任务' }));
    await user.click(await screen.findByRole('button', { name: /^创建$/ }));
    expect(screen.getByRole('dialog', { name: '创建定时任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '每日文稿' })).toBeInTheDocument();
    expect(screen.queryByLabelText('任务管理')).not.toBeInTheDocument();
    expect(scheduleListCalls).toBeGreaterThanOrEqual(2);
  });

  it('uses the selected thread run registry without loading runs for every thread', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const runRequests: string[] = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(runRequests).toEqual([]);

    await user.click(await screen.findByRole('button', { name: /会话 A/ }));

    expect(await screen.findByRole('button', { name: '停止任务' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '排队发送' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('正在运行')).toBeInTheDocument();
    expect(runRequests).toEqual(['thread_a']);

    await user.click(await screen.findByRole('button', { name: /会话 B/ }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(runRequests).toEqual(['thread_a', 'thread_b']);
  });

  it('steers a selected queued task and removes another without waiting for SSE', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const queuedRuns = new Map<string, ReturnType<typeof createRunResponse>>();
    const steeredRunIds: string[] = [];
    const canceledRunIds: string[] = [];
    let nextQueuedRun = 1;
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [createThreadResponse({ id: 'thread_queue', title: '队列会话' })]
        });
      }
      if (url.endsWith('/threads/thread_queue/history?limit=50')) {
        return jsonResponse({ threadId: 'thread_queue', codexThreadId: null, items: [] });
      }
      if (url.endsWith('/threads/thread_queue/runs?limit=50')) {
        return jsonResponse({
          runs: [
            createRunResponse({ id: 'run_active', threadId: 'thread_queue', status: 'running' }),
            ...queuedRuns.values()
          ]
        });
      }
      if (url.endsWith('/runs') && init?.method === 'POST') {
        const id = `run_queued_${nextQueuedRun++}`;
        const run = createRunResponse({
          id,
          threadId: 'thread_queue',
          status: 'queued',
          submissionMode: 'enqueue',
          queuePosition: queuedRuns.size + 1
        });
        queuedRuns.set(id, run);
        return jsonResponse(run, { status: 202 });
      }
      const steerMatch = url.match(/\/runs\/(run_queued_\d+)\/steer$/);
      if (steerMatch !== null && init?.method === 'POST') {
        steeredRunIds.push(steerMatch[1]!);
        return jsonResponse({ id: steerMatch[1], steered: true }, { status: 202 });
      }
      const cancelMatch = url.match(/\/runs\/(run_queued_\d+)\/cancel$/);
      if (cancelMatch !== null && init?.method === 'POST') {
        const id = cancelMatch[1]!;
        canceledRunIds.push(id);
        queuedRuns.set(id, createRunResponse({
          id,
          threadId: 'thread_queue',
          status: 'canceled'
        }));
        return jsonResponse({ id, canceled: true }, { status: 202 });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /队列会话/ }));

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '优先处理这一条');
    await user.click(screen.getByRole('button', { name: '排队发送' }));
    await user.click(await screen.findByRole('button', {
      name: '优先执行等待任务 优先处理这一条'
    }));
    await waitFor(() => expect(steeredRunIds).toEqual(['run_queued_1']));

    await user.type(textbox, '移除这一条');
    await user.click(screen.getByRole('button', { name: '排队发送' }));
    await user.click(await screen.findByRole('button', {
      name: '移除等待任务 移除这一条'
    }));

    await waitFor(() => {
      expect(screen.queryByText('移除这一条')).not.toBeInTheDocument();
    });
    expect(canceledRunIds).toEqual(['run_queued_2']);
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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
    await user.click(screen.getByText(/^(?:已完成|已处理 .+)$/));
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /断线恢复会话/ }));

    await waitFor(() => expect(subscriptions).toHaveLength(2), { timeout: 2_000 });
    expect(subscriptions[0]?.fromSeq).toBe(0);
    expect(subscriptions[1]?.fromSeq).toBe(1);
    expect(await screen.findByText('第二段内容')).toBeInTheDocument();
    await user.click(await screen.findByText(/^(?:已完成|已处理 .+)$/));
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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

  it('loads runtime skills into the composer slash menu', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/');

    expect(await screen.findByRole('listbox', { name: '能力菜单' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /brainstorming/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /github/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /设置 Goal/ })).not.toBeInTheDocument();
  });

  it('loads plugin data without requesting MCP or Profiles on a direct plugin refresh', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/plugins?source=public';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchUrls: string[] = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchUrls.push(url);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/codex/skills')) return jsonResponse(createSkillListResponse());
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/profiles')) {
        return jsonResponse({
          codexHome: '/Users/test/.codex',
          codexHomeMode: 'global',
          writable: true,
          baseConfigValid: true,
          profiles: [],
          diagnostics: []
        });
      }
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({ records: [] });
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

    expect(await screen.findByRole('region', { name: '技能目录' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('正在加载技能目录')).not.toBeInTheDocument();
    });
    expect(fetchUrls.some(url => url.endsWith('/codex/skills'))).toBe(true);
    expect(fetchUrls.some(url => url.endsWith('/codex/skill-market/install-records'))).toBe(true);
    expect(fetchUrls.some(url => url.endsWith('/codex/mcp'))).toBe(false);
    expect(fetchUrls.some(url => url.endsWith('/codex/profiles'))).toBe(false);

    await user.click(screen.getByRole('button', { name: '首页' }));
    await waitFor(() => {
      expect(fetchUrls.some(url => url.endsWith('/codex/mcp'))).toBe(true);
      expect(fetchUrls.some(url => url.endsWith('/codex/profiles'))).toBe(true);
    });
  });

  it.each(['browser', 'desktop'] as const)(
    '%s host shows the personal workspace without an authentication gate',
    async (hostKind) => {
      const hostBridge: HostBridge = { ...createHostBridge(), kind: hostKind };

      render(
        <ProductionApp
          fileService={createFileService()}
          hostBridge={hostBridge}
          subscribeRunEvents={async () => undefined}
        />
      );

      expect(await screen.findByLabelText('OpenCreator 导航')).toBeInTheDocument();
      expect(screen.queryByText('登录即可享受云端协作')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
      expect(screen.queryByText(/登录企业账户/)).not.toBeInTheDocument();
    }
  );

  it.skip.each([
    {
      kind: 'install' as const,
      actionLabel: '安装',
      initialSkill: createEnterpriseSkillResponse({
        status: 'not_installed',
        integrity: 'not_applicable',
        actions: ['install']
      })
    },
    {
      kind: 'update' as const,
      actionLabel: '更新',
      initialSkill: createEnterpriseSkillResponse({
        status: 'update_available',
        integrity: 'verified',
        installedVersion: '1.0.0',
        version: '1.1.0',
        actions: ['update', 'use']
      })
    }
  ])(
    'posts enterprise $kind without a body and refreshes the list once',
    async ({ kind, actionLabel, initialSkill }) => {
      const user = userEvent.setup();
      window.location.hash = '#/plugins?source=enterprise';
      const hostBridge = createHostBridge();
      hostBridge.readConnectionConfig = async () => ({
        baseUrl: 'http://127.0.0.1:60764',
        token: 'runtime-token'
      });
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      let skillRequests = 0;
      let localSkillRequests = 0;
      const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const projectApiResponse = handleDefaultProjectApiRequest(url, init);
        if (projectApiResponse !== undefined) return projectApiResponse;
        fetchCalls.push({ url, init });
        if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
        if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
        if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
        if (url.endsWith('/enterprise/session')) {
          return jsonResponse(createEnterpriseSessionResponse());
        }
        if (url.endsWith('/enterprise/skills')) {
          skillRequests += 1;
          return jsonResponse(createEnterpriseSkillListResponse(
            skillRequests === 1
              ? [initialSkill]
              : [createEnterpriseSkillResponse({
                  status: 'installed',
                  integrity: 'verified',
                  installedVersion: '1.1.0',
                  version: '1.1.0',
                  actions: ['use']
                })]
          ));
        }
        if (url.endsWith('/enterprise/skills/enterprise-skill')) {
          return jsonResponse({
            ...initialSkill,
            changelog: '测试更新说明'
          });
        }
        if (url.endsWith('/codex/skills')) {
          localSkillRequests += 1;
          return jsonResponse(createSkillListResponse([
            createSkillResponse({
              id: 'enterprise-name',
              name: 'enterprise-name'
            })
          ]));
        }
        if (
          url.endsWith(`/enterprise/skills/enterprise-skill/${kind}`)
          && init?.method === 'POST'
        ) {
          return jsonResponse({
            skill: createEnterpriseSkillResponse({
              status: 'installed',
              integrity: 'verified',
              installedVersion: '1.1.0',
              version: '1.1.0',
              actions: ['use']
            }),
            localSkill: createSkillResponse({
              id: 'enterprise-name',
              name: 'enterprise-name'
            }),
            operation: {}
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

      const skill = await screen.findByTestId('enterprise-skill-enterprise-skill');
      if (kind === 'update') {
        await user.click(within(skill).getByRole('button', {
          name: '查看 enterprise-name 详情'
        }));
        const detail = await screen.findByRole('dialog', {
          name: 'enterprise-name 详情'
        });
        await user.click(within(detail).getByRole('button', { name: actionLabel }));
      } else {
        await user.click(within(skill).getByRole('button', { name: actionLabel }));
      }

      await waitFor(() => expect(skillRequests).toBe(2));
      await waitFor(() => expect(localSkillRequests).toBe(1));
      const mutationCalls = fetchCalls.filter(call => (
        call.url.endsWith(`/enterprise/skills/enterprise-skill/${kind}`)
        && call.init?.method === 'POST'
      ));
      expect(mutationCalls).toHaveLength(1);
      expect(mutationCalls[0]?.init?.body).toBeUndefined();
      expect(new Headers(mutationCalls[0]?.init?.headers).has('Content-Type')).toBe(false);
      expect(skillRequests).toBe(2);
      expect(localSkillRequests).toBe(1);
      expect(within(screen.getByTestId('enterprise-skill-enterprise-skill'))
        .getByRole('button', { name: '使用' })).toBeEnabled();
    }
  );

  it.skip('turns enterprise unauthorized into signed-out without affecting public market', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/plugins?source=enterprise';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/enterprise/session')) {
        return jsonResponse(createEnterpriseSessionResponse());
      }
      if (url.endsWith('/enterprise/skills')) {
        return jsonResponse({
          error: {
            code: 'ENTERPRISE_SESSION_EXPIRED',
            message: 'Enterprise session expired'
          }
        }, { status: 401 });
      }
      if (url.endsWith('/codex/skills')) return jsonResponse(createSkillListResponse());
      if (url.endsWith('/codex/skill-market/install-records')) {
        return jsonResponse({ records: [] });
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

    await waitFor(() => {
      expect(screen.getByTestId('enterprise-skill-brand-compliance')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: '登录企业账户' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Skill市场' }));

    expect(await screen.findByRole('region', { name: '技能目录' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));
    expect(window.location.hash).toBe('#/plugins?source=public');
  });

  it.skip('uses an enterprise skill through the project dialog and composer draft path', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/plugins?source=enterprise';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/enterprise/session')) {
        return jsonResponse(createEnterpriseSessionResponse());
      }
      if (url.endsWith('/enterprise/skills')) {
        return jsonResponse(createEnterpriseSkillListResponse([
          createEnterpriseSkillResponse({
            status: 'installed',
            integrity: 'verified',
            installedVersion: '1.0.0',
            actions: ['use']
          })
        ]));
      }
      if (url.endsWith('/threads') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const project = readTestRuntimeProjects().find(item => item.id === body.projectId);
        if (project === undefined) throw new Error(`Unknown test project ${String(body.projectId)}`);
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_enterprise_skill',
            title: String(body.title),
            projectId: project.id,
            cwd: project.cwd,
            canonicalCwd: project.canonicalCwd ?? project.cwd,
            workspaceMode: 'external',
            profile: String(body.profile),
            sandbox: body.sandbox === 'danger-full-access'
              ? 'danger-full-access'
              : 'workspace-write'
          })
        }, { status: 201 });
      }
      if (url.endsWith('/threads/thread_enterprise_skill/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_enterprise_skill',
          codexThreadId: null,
          items: []
        });
      }
      if (url.endsWith('/threads/thread_enterprise_skill/runs?limit=50')) {
        return jsonResponse({ runs: [] });
      }
      if (url.endsWith('/codex/skills')) return jsonResponse(createSkillListResponse());
      if (url.endsWith('/codex/mcp')) return jsonResponse(createMcpListResponse());
      if (url.endsWith('/codex/profiles')) {
        return jsonResponse({
          codexHome: '/Users/test/.codex',
          codexHomeMode: 'global',
          writable: true,
          baseConfigValid: true,
          profiles: [],
          diagnostics: []
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

    const skill = await screen.findByTestId('enterprise-skill-enterprise-skill');
    await user.click(within(skill).getByRole('button', { name: '使用' }));
    const projectDialog = screen.getByRole('dialog', { name: '选择使用项目' });
    await user.click(within(projectDialog).getByRole('button', {
      name: '在 content-design'
    }));

    const createThreadCall = await waitFor(() => {
      const call = findPostCall(fetchCalls, '/threads');
      expect(call).toBeDefined();
      return call!;
    });
    expect(JSON.parse(String(createThreadCall.init?.body))).toMatchObject({
      title: 'enterprise-name',
      projectId: readTestRuntimeProjects()[0]!.id
    });
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
    expect(await screen.findByRole('heading', { name: 'enterprise-name' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/thread/thread_enterprise_skill');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' }))
        .toHaveValue('$enterprise-name ');
      expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveFocus();
    });
  });

  it('connects the plugin market to real install state and creates draft conversations', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'opencreator.preferences.defaultPermission',
      'danger-full-access'
    );
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let installed = false;
    let skillRequests = 0;
    let recordRequests = 0;
    let createdThreadCount = 0;
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
        const project = readTestRuntimeProjects().find(item => item.id === body.projectId);
        if (project === undefined) throw new Error(`Unknown test project ${String(body.projectId)}`);
        return jsonResponse(
          {
            thread: createThreadResponse({
              id: `thread_skill_${createdThreadCount}`,
              title: String(body.title),
              projectId: project.id,
              cwd: project.cwd,
              canonicalCwd: project.canonicalCwd ?? project.cwd,
              workspaceMode: 'external',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await waitFor(() => expect(skillRequests).toBe(1));

    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await waitFor(() => expect(recordRequests).toBe(1));
    expect(screen.queryByRole('heading', { name: 'OpenCreator：插件' })).not.toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '技能目录' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));
    await showSkillMarketCard(user, 'frontend-slides');

    const frontendCard = getSkillMarketCard('frontend-slides');
    expect(within(frontendCard).getByText('网页演示稿生成')).toBeInTheDocument();
    await user.click(within(frontendCard).getByRole('button', { name: '安装' }));

    await waitFor(() => expect(skillRequests).toBe(2));
    await waitFor(() => expect(recordRequests).toBe(2));
    expect(findPostCall(fetchCalls, '/codex/skill-market/frontend-slides/install')).toBeDefined();
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());

    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' }));
    const projectDialog = screen.getByRole('dialog', { name: '选择使用项目' });
    expect(within(projectDialog).getByRole('radio', { name: /content-design/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await user.click(within(projectDialog).getByRole('button', { name: '在 content-design' }));

    await waitFor(() => expect(threadCreateCalls()).toHaveLength(1));
    const createThreadBody = JSON.parse(String(threadCreateCalls()[0]?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: '网页演示稿生成',
      projectId: readTestRuntimeProjects()[0]!.id,
      profile: 'default',
      sandbox: 'danger-full-access'
    });
    expect(createThreadBody).not.toHaveProperty('cwd');
    expect(createThreadBody).not.toHaveProperty('workspaceMode');
    expect(createThreadBody).not.toHaveProperty('model');
    expect(createThreadBody).not.toHaveProperty('reasoning');
    expect(findPostCall(fetchCalls, '/runs')).toBeUndefined();
    expect(await screen.findByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('已选择技能 frontend-slides')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await waitFor(() => expect(getSkillMarketCard('frontend-slides')).toBeInTheDocument());
    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' }));
    await user.click(screen.getByRole('button', { name: '在 content-design' }));

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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/');
    expect(await screen.findByRole('option', { name: /frontend-slides/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /github/ })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));
    await showSkillMarketCard(user, 'frontend-slides');
    expect(screen.getByRole('alert')).toHaveTextContent('安装记录加载失败');
    const card = getSkillMarketCard('frontend-slides');
    expect(within(card).queryByText('版本未知')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '使用' })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });

  it('keeps the full catalog but disables actions when initial skills scan fails', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await waitFor(() => expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12));
    await showSkillMarketCard(user, 'frontend-slides');
    expect(screen.getByRole('alert')).toHaveTextContent('技能状态加载失败');
    const action = within(getSkillMarketCard('frontend-slides')).getByRole('button', {
      name: '状态未知'
    });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription('技能安装状态未知');
  });

  it('keeps the plugin market open and shows an error when using a skill cannot create a thread', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());

    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', {
      name: /打开 .*详情/
    }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '使用' }));
    await user.click(screen.getByRole('button', { name: '在 content-design' }));

    expect(await screen.findAllByText('使用失败：创建对话失败')).toHaveLength(1);
    await user.click(
      within(getSkillMarketCard('frontend-slides')).getByRole('button', {
        name: /打开 .*详情/
      })
    );
    const retryDialog = screen.getByRole('dialog');
    expect(within(retryDialog).getByText('使用失败：创建对话失败')).toBeInTheDocument();
    await user.click(within(retryDialog).getByRole('button', { name: '使用' }));
    await user.click(screen.getByRole('button', { name: '在 content-design' }));
    await waitFor(() => {
      expect(
        fetchCalls.filter(call => call.url.endsWith('/threads') && call.init?.method === 'POST')
      ).toHaveLength(2);
    });
    expect(screen.getByRole('region', { name: '技能目录' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '网页演示稿生成' })).not.toBeInTheDocument();
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());

    const firstUseButton = within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' });
    await user.click(firstUseButton);
    await user.click(screen.getByRole('button', { name: '在 content-design' }));
    await user.click(firstUseButton);
    await user.click(screen.getByRole('button', { name: '在 content-design' }));

    expect(threadCreateCalls()).toHaveLength(1);

    await act(async () => {
      threadCreates[0]!.resolve(jsonResponse({
        thread: createThreadResponse({
          id: 'thread_skill_1',
          title: '网页演示稿生成',
          cwd: '~',
          canonicalCwd: '~',
          sandbox: 'danger-full-access'
        })
      }, { status: 201 }));
      await threadCreates[0]!.promise;
    });
    expect(await screen.findByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await waitFor(() => expect(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' })).toBeEnabled());
    await user.click(within(getSkillMarketCard('frontend-slides')).getByRole('button', { name: '使用' }));
    await user.click(screen.getByRole('button', { name: '在 content-design' }));

    expect(threadCreateCalls()).toHaveLength(2);
    await act(async () => {
      threadCreates[1]!.resolve(jsonResponse({
        thread: createThreadResponse({
          id: 'thread_skill_2',
          title: '网页演示稿生成',
          cwd: '~',
          canonicalCwd: '~',
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await waitFor(() => expect(skillRequests).toBe(1));
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await waitFor(() => expect(recordRequests).toBe(1));
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await user.click(await within(getSkillMarketCard('frontend-slides')).findByRole('button', { name: '安装' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('安装记录刷新失败');
    expect(within(getSkillMarketCard('frontend-slides')).queryByText('版本未知')).not.toBeInTheDocument();
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '插件中心' }));
    await showSkillMarketCard(user, 'frontend-slides');
    await user.click(await within(getSkillMarketCard('frontend-slides')).findByRole('button', { name: '更新' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('技能状态刷新失败');
    const action = within(getSkillMarketCard('frontend-slides')).getByRole('button', {
      name: '状态未知'
    });
    expect(action).toBeDisabled();
    expect(screen.queryByText('更新失败，请重试')).not.toBeInTheDocument();
  });

  it('starts a real runtime run, records SSE events without redundant process detail, and shows Codex info in settings', async () => {
    const user = userEvent.setup();
    const prompt = 'Reply with OK only.';
    const codexStatus = createCodexStatusResponse();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(screen.queryByText('codex-cli test')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-lightfall-background')).not.toBeInTheDocument();
    expect(await screen.findByText(/^(?:已完成|已处理 .+)$/)).toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();

    await user.click(screen.getByText(/^(?:已完成|已处理 .+)$/));

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

    expect(screen.queryByRole('button', { name: /查看运行详情/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/当前动态/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.click(await screen.findByRole('button', { name: '关于 OpenCreator' }));

    expect(await screen.findByText('高级信息')).toBeInTheDocument();
    expect(screen.getAllByText('codex-cli test').length).toBeGreaterThan(0);
  });

  it('resolves a runtime approval in place through the daemon API', async () => {
    const user = userEvent.setup();
    const prompt = '清理构建目录';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let releaseSse!: () => void;
    const approval = {
      id: 'approval_1',
      runId: 'run_approval',
      threadId: 'thread_from_api',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'rpc_1',
      kind: 'command_execution' as const,
      status: 'pending' as const,
      risk: 'high' as const,
      title: '允许执行命令',
      summary: '删除构建目录',
      details: { command: 'rm -rf build', cwd: '/workspace' },
      requestedAt: '2026-07-12T10:00:00.000Z',
      expiresAt: '2026-07-12T10:10:00.000Z'
    };
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        return jsonResponse({
          thread: createThreadResponse({ id: 'thread_from_api', title: prompt })
        }, { status: 201 });
      }
      if (url.endsWith('/runs')) {
        return jsonResponse({
          id: 'run_approval',
          threadId: 'thread_from_api',
          status: 'running'
        }, { status: 202 });
      }
      if (
        url.endsWith('/approvals/approval_1/approve')
        && init?.method === 'POST'
      ) {
        return jsonResponse({
          approval: {
            ...approval,
            status: 'approved',
            resolvedAt: '2026-07-12T10:01:00.000Z'
          },
          changed: true
        });
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent(
        'approval',
        { type: 'approval', approval },
        1,
        'run_approval'
      ));
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('允许 OpenCreator 执行这条命令？')).toBeInTheDocument();
    expect(document.querySelector('.composer-approval-overlay')).toBeInTheDocument();
    await user.click(screen.getByText('查看操作详情'));
    expect(screen.getByText('rm -rf build')).toBeInTheDocument();
    const timelineScroller = screen.getByTestId('virtuoso-scroller');
    const composerWrap = document.querySelector<HTMLElement>('.composer-wrap');
    const composerInput = screen.getByRole('textbox', { name: '输入任务' });
    if (composerWrap === null) throw new Error('Expected composer wrapper');

    fireEvent.wheel(composerWrap, { deltaY: 160 });
    expect(timelineScroller.scrollTop).toBe(160);

    Object.defineProperties(composerInput, {
      clientHeight: { configurable: true, value: 76 },
      scrollHeight: { configurable: true, value: 240 },
      scrollTop: { configurable: true, value: 0, writable: true }
    });
    composerInput.style.overflowY = 'auto';
    fireEvent.wheel(composerInput, { deltaY: 80 });
    expect(timelineScroller.scrollTop).toBe(160);

    await user.click(screen.getByRole('button', { name: '允许一次' }));

    await waitFor(() => {
      expect(screen.queryByText('rm -rf build')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '允许一次' })).not.toBeInTheDocument();
    });
    expect(fetchCalls.some(call => (
      call.url.endsWith('/approvals/approval_1/approve')
      && call.init?.method === 'POST'
    ))).toBe(true);

    await act(async () => {
      releaseSse();
    });
  });

  it('keeps the process button when a completed runtime turn has no process agent messages', async () => {
    const user = userEvent.setup();
    const prompt = '只回复 OK';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
    expect(screen.getByText(/^(?:已完成|已处理 .+)$/)).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();

    await user.click(screen.getByText(/^(?:已完成|已处理 .+)$/));

    expect(screen.queryByText('运行详情')).not.toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('finalizing')).not.toBeInTheDocument();
  });

  it('shows a thinking indicator while the runtime has started but has not emitted assistant text yet', async () => {
    const user = userEvent.setup();
    const prompt = '你都会做什么';
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) return jsonResponse({ thread: createThreadResponse({ title: prompt }) }, { status: 201 });
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_from_api', status: 'running' }, { status: 202 });
      throw new Error(`Unexpected request ${url}`);
    };
    let resolveRunningEvent!: () => void;
    const runningEventReceived = new Promise<void>(resolve => {
      resolveRunningEvent = resolve;
    });
    let releaseSse!: () => void;
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent({
        ...createRuntimeEvent('status', { type: 'status', label: 'running' }, 1),
        ts: new Date().toISOString()
      });
      resolveRunningEvent();
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    await runningEventReceived;
    expect(animationFrames.length).toBeGreaterThan(0);
    await act(async () => {
      for (const callback of animationFrames.splice(0)) callback(performance.now());
    });
    expect(screen.getByText('正在思考')).toBeInTheDocument();
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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

  it('renders Codex process agent messages as folded process text and only the final agent message as OpenCreator reply', async () => {
    const user = userEvent.setup();
    const prompt = '检查当前目录并总结';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText(/^(?:已完成|已处理 .+)$/)).toBeInTheDocument();

    await user.click(screen.getByText(/^(?:已完成|已处理 .+)$/));

    expect(screen.getByText('我会先确认当前目录，再读取必要文件。')).toBeInTheDocument();
    expect(screen.queryByText('正在查看项目内容')).not.toBeInTheDocument();
    expect(screen.queryByText('pwd')).not.toBeInTheDocument();
    expect(screen.getByText('已读取文件')).toBeInTheDocument();
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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '整理本周项目进展 4天' }));
    expect(await screen.findByRole('heading', { name: '整理本周项目进展' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('周报已整理。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '首页' }));

    expect(screen.queryByRole('heading', { name: '新对话' })).not.toBeInTheDocument();
    expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择项目 / })).not.toBeInTheDocument();
    expect(screen.queryByText(prompt)).not.toBeInTheDocument();
    expect(screen.queryByText('周报已整理。')).not.toBeInTheDocument();
  });

  it.each(['browser', 'desktop'] as const)(
    'creates and selects the Runtime default project on the first %s launch',
    async kind => {
      testRuntimeProjects = [];
      const hostBridge = createHostBridge();
      hostBridge.kind = kind;
      hostBridge.readConnectionConfig = async () => ({
        baseUrl: 'http://127.0.0.1:60764',
        token: 'runtime-token'
      });
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        fetchCalls.push({ url, init });
        const projectApiResponse = handleDefaultProjectApiRequest(url, init);
        if (projectApiResponse !== undefined) return projectApiResponse;
        if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
        if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
        if (url.endsWith('/threads?status=active&limit=50')) {
          return jsonResponse({ threads: [] });
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

      expect(await screen.findByRole('button', { name: '默认项目' }))
        .toHaveAttribute('data-current-project', 'true');
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
      expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
      expect(findPostCalls(fetchCalls, '/projects/default')).toHaveLength(1);

      firstRender.unmount();
      render(<App {...appProps} />);

      expect(await screen.findByRole('button', { name: '默认项目' }))
        .toHaveAttribute('data-current-project', 'true');
      expect(findPostCalls(fetchCalls, '/projects/default')).toHaveLength(1);
    }
  );

  it('creates a conversation in the Runtime default project without sending cwd', async () => {
    const user = userEvent.setup();
    const prompt = 'hi';
    testRuntimeProjects = [];
    window.localStorage.setItem(
      'opencreator.preferences.defaultPermission',
      'danger-full-access'
    );
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.selectProjectDirectory = vi.fn(async () => '/Users/test/develop/content-design');
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        const body = readRequestBody(init!);
        const project = readTestRuntimeProjects().find(item => item.id === body.projectId);
        if (project === undefined) throw new Error(`Unknown test project ${String(body.projectId)}`);
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_project_bound',
            title: prompt,
            projectId: project.id,
            cwd: project.cwd,
            canonicalCwd: project.canonicalCwd ?? project.cwd,
            sandbox: 'danger-full-access'
          })
        }, { status: 201 });
      }
      if (url.endsWith('/runs')) return jsonResponse({ id: 'run_1', threadId: 'thread_project_bound', status: 'running' }, { status: 202 });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '默认项目' }))
      .toHaveAttribute('data-current-project', 'true');
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: prompt,
      projectId: readTestRuntimeProjects()[0]!.id,
      sandbox: 'danger-full-access'
    });
    expect(createThreadBody).not.toHaveProperty('cwd');
    expect(createThreadBody).not.toHaveProperty('workspaceMode');
  });

  it('does not infer projects from historical conversation directories', async () => {
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_playground',
              title: 'Playground 历史会话',
              cwd: '/Users/test/develop/opencreator/playground',
              canonicalCwd: '/Users/test/develop/opencreator/playground',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Playground 历史会话/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'playground' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'content-design' })).toBeInTheDocument();
  });

  it.each(['browser', 'desktop'] as const)(
    'archives the selected conversation consistently in the %s host',
    async (hostKind) => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const hostBridge = createHostBridge();
      hostBridge.kind = hostKind;
      hostBridge.readConnectionConfig = async () => ({
        baseUrl: 'http://127.0.0.1:60764',
        token: 'runtime-token'
      });
      const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
      const thread = createThreadResponse({
        id: `thread_archive_${hostKind}`,
        title: `${hostKind} 归档会话`
      });
      const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const projectApiResponse = handleDefaultProjectApiRequest(url, init);
        if (projectApiResponse !== undefined) return projectApiResponse;
        fetchCalls.push({ url, init });
        if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
        if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
        if (url.endsWith('/threads?status=active&limit=50')) {
          return jsonResponse({ threads: [thread] });
        }
        if (url.endsWith(`/threads/${thread.id}/history?limit=50`)) {
          return jsonResponse({ threadId: thread.id, codexThreadId: null, items: [] });
        }
        if (url.endsWith(`/threads/${thread.id}/runs?limit=50`)) {
          return jsonResponse({ runs: [] });
        }
        if (url.endsWith(`/threads/${thread.id}/archive`) && init?.method === 'POST') {
          return jsonResponse({
            thread: {
              ...thread,
              status: 'archived',
              archivedAt: new Date(0).toISOString()
            }
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

      expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
      await user.click(await screen.findByRole('button', {
        name: new RegExp(`^${hostKind} 归档会话 `)
      }));
      await waitFor(() => expect(window.location.hash).toBe(`#/thread/${thread.id}`));
      const conversation = screen.getByRole('group', {
        name: `${hostKind} 归档会话`
      });
      await user.click(within(conversation).getByRole('button', { name: '归档' }));
      const archiveDialog = screen.getByRole('alertdialog', { name: '归档对话' });
      await user.click(within(archiveDialog).getByRole('button', { name: '归档' }));

      await waitFor(() => {
        expect(screen.queryByRole('button', {
          name: new RegExp(`^${hostKind} 归档会话 `)
        })).not.toBeInTheDocument();
      });
      expect(window.location.hash).toBe('#/');
      expect(findPostCall(fetchCalls, `/threads/${thread.id}/archive`)).toBeDefined();
      expect(screen.getByRole('textbox', { name: '输入任务' })).toBeEnabled();
    }
  );

  it('adds and archives a local project directory through the desktop host', async () => {
    const user = userEvent.setup();
    const legacyProjects = JSON.stringify([
      createLegacyPersistedProject('/Users/test/Documents/legacy-project')
    ]);
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, legacyProjects);
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.selectProjectDirectory = vi.fn(async () => '/Users/test/Documents/官网资料');
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'legacy-project' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '管理项目' }));
    await user.click(screen.getByRole('button', { name: '使用现有文件夹' }));
    expect(hostBridge.selectProjectDirectory).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(fetchCalls.map(call => [call.url, call.init?.method])).toContainEqual([
        'http://127.0.0.1:60764/projects',
        'POST'
      ]);
    });
    expect(readTestRuntimeProjects().some(project => project.name === '官网资料')).toBe(true);
    expect(await screen.findByRole('button', { name: '官网资料' })).toBeInTheDocument();
    expect(findPostCall(fetchCalls, '/projects')).toBeDefined();
    expect(window.localStorage.getItem(PROJECTS_STORAGE_KEY)).toBe(legacyProjects);

    await user.click(screen.getByRole('button', { name: '项目操作 官网资料' }));
    await user.click(screen.getByRole('menuitem', { name: '移除项目 官网资料' }));
    await user.click(screen.getByRole('button', { name: '移除项目' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '官网资料' })).not.toBeInTheDocument();
    });
    expect(fetchCalls.some(call => (
      call.url.includes('/projects/')
      && call.url.endsWith('/archive')
      && call.init?.method === 'POST'
    ))).toBe(true);
    expect(window.localStorage.getItem(PROJECTS_STORAGE_KEY)).toBe(legacyProjects);
  });

  it('creates a managed project by name through the browser host', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '创建项目' }));

    expect(await screen.findByRole('dialog', { name: '创建项目' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '文件夹名称' }), 'browser-project');
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('button', { name: 'browser-project' })).toBeInTheDocument();
    const createCall = findPostCall(fetchCalls, '/projects/managed');
    expect(createCall).toBeDefined();
    expect(readRequestBody(createCall!.init!)).toEqual({ name: 'browser-project' });
  });

  it('adds a project by dropping a folder into the desktop workspace', async () => {
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.resolveDroppedFilePath = vi.fn(
      () => '/Users/test/Documents/dropped-project'
    );
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    const dropRoot = document.querySelector<HTMLElement>('[data-project-drop-root="true"]');
    if (dropRoot === null) throw new Error('Expected project drop root');
    const folder = new File([], 'dropped-project');
    const dataTransfer = createDirectoryDataTransfer(folder);

    fireEvent.dragEnter(dropRoot, { dataTransfer });
    expect(screen.getByText('松开以添加项目文件夹')).toBeInTheDocument();

    fireEvent.drop(dropRoot, { dataTransfer });

    expect(hostBridge.resolveDroppedFilePath).toHaveBeenCalledWith(folder);
    expect(await screen.findByRole('button', { name: 'dropped-project' })).toBeInTheDocument();
    expect(findPostCall(fetchCalls, '/projects')).toBeDefined();
    expect(screen.queryByText('松开以添加项目文件夹')).not.toBeInTheDocument();
  });

  it('opens only one project directory picker while the previous request is pending', async () => {
    const user = userEvent.setup();
    let resolveDirectory: ((path: string | null) => void) | undefined;
    const directorySelection = new Promise<string | null>((resolve) => {
      resolveDirectory = resolve;
    });
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.selectProjectDirectory = vi.fn(() => directorySelection);
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '管理项目' }));
    await user.click(screen.getByRole('button', { name: '使用现有文件夹' }));
    await user.click(screen.getByRole('button', { name: '使用现有文件夹' }));

    expect(hostBridge.selectProjectDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDirectory?.(null);
      await directorySelection;
    });
  });

  it('creates a blank project and adds an existing folder outside the composer', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.kind = 'desktop';
    hostBridge.selectProjectDirectory = vi.fn(
      async () => '/Users/test/Documents/existing-project'
    );
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '创建项目' }));
    await user.type(screen.getByRole('textbox', { name: '文件夹名称' }), 'blank-project');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(fetchCalls.map(call => [call.url, call.init?.method])).toContainEqual([
        'http://127.0.0.1:60764/projects/managed',
        'POST'
      ]);
    });
    expect(readRequestBody(findPostCall(fetchCalls, '/projects/managed')!.init!))
      .toEqual({ name: 'blank-project' });
    expect(await screen.findByRole('button', { name: 'blank-project' }))
      .toHaveAttribute('data-current-project', 'true');

    await user.click(screen.getByRole('button', { name: '管理项目' }));
    await user.click(screen.getByRole('button', { name: '使用现有文件夹' }));

    expect(hostBridge.selectProjectDirectory).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'existing-project' }))
      .toHaveAttribute('data-current-project', 'true');
  });

  it('does not show managed runtime workspaces as projects', async () => {
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
              cwd: '/Users/test/develop/opencreator/playground',
              canonicalCwd: '/Users/test/develop/opencreator/playground',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Playground 历史会话/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'thread_RwiAbzbZ8p' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'thread_1Qm6X_K0eo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /task9-readonly/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /task9-write/ })).not.toBeInTheDocument();
  });

  it('clears the current conversation surface when switching projects', async () => {
    const user = userEvent.setup();
    const prompt = '生成一份项目周报';
    const projects = persistProjects(
      '/workspace/primary',
      '/workspace/secondary'
    );
    const primaryProject = projects[0];
    const secondaryProject = projects[1]!;
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: primaryProject.id
    }));
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_secondary_history',
              title: 'secondary 历史',
              projectId: secondaryProject.id,
              cwd: '/workspace/secondary',
              canonicalCwd: '/workspace/secondary'
            })
          ]
        });
      }
      if (url.endsWith('/threads')) {
        const body = readRequestBody(init!);
        const project = readTestRuntimeProjects().find(item => item.id === body.projectId);
        if (project === undefined) throw new Error(`Unknown test project ${String(body.projectId)}`);
        return jsonResponse({
          thread: createThreadResponse({
            title: prompt,
            projectId: project.id,
            cwd: project.cwd,
            canonicalCwd: project.canonicalCwd ?? project.cwd
          })
        }, { status: 201 });
      }
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await findTimelineUserMessage(prompt)).toBeInTheDocument();
    expect(await screen.findByText('周报已整理。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '在 secondary 中新建会话' }));

    expect(screen.queryByRole('heading', { name: '新对话' })).not.toBeInTheDocument();
    expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('.timeline-user_message')).some(
      message => message.textContent?.includes(prompt)
    )).toBe(false);
    expect(screen.queryByText('周报已整理。')).not.toBeInTheDocument();
  });

  it('does not let an aborted subscription clear events queued by its replacement', async () => {
    const user = userEvent.setup();
    const projects = persistProjects(
      '/workspace/primary',
      '/workspace/secondary'
    );
    const primaryProject = projects[0];
    const secondaryProject = projects[1]!;
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: primaryProject.id
    }));
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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_secondary_history',
              title: 'secondary 历史',
              projectId: secondaryProject.id,
              cwd: '/workspace/secondary',
              canonicalCwd: '/workspace/secondary'
            })
          ]
        });
      }
      if (url.endsWith('/threads')) {
        threadSequence += 1;
        const body = readRequestBody(init!);
        const project = readTestRuntimeProjects().find(item => item.id === body.projectId);
        if (project === undefined) throw new Error(`Unknown test project ${String(body.projectId)}`);
        return jsonResponse({
          thread: createThreadResponse({
            id: `thread_${threadSequence}`,
            title: `任务 ${threadSequence}`,
            projectId: project.id,
            cwd: project.cwd,
            canonicalCwd: project.canonicalCwd ?? project.cwd
          })
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '旧任务');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(subscriptionSequence).toBe(1));

    await user.click(screen.getByRole('button', { name: '在 secondary 中新建会话' }));
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
    const projects = persistProjects(
      '/Users/test/develop/content-design',
      '/Users/test/develop/opencreator/bili'
    );
    const contentProject = projects[0];
    const biliProject = projects[1]!;
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_content_history',
              title: 'content-design 历史',
              projectId: contentProject.id,
              codexThreadId: 'codex-content-history',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            }),
            createThreadResponse({
              id: 'thread_bili_history',
              title: 'bili 历史',
              projectId: biliProject.id,
              codexThreadId: 'codex-bili-history',
              cwd: '/Users/test/develop/opencreator/bili',
              canonicalCwd: '/Users/test/develop/opencreator/bili'
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'bili' }));
    await user.click(await screen.findByRole('button', { name: /bili 历史/ }));
    expect(await findTimelineUserMessage('刷新后仍然打开这条对话')).toBeInTheDocument();

    firstRender.unmount();
    render(<App {...appProps} />);

    expect(await findTimelineUserMessage('刷新后仍然打开这条对话')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bili' })).toHaveAttribute('data-current-project', 'true');
  });

  it('restores a selected historical conversation that is outside the initial thread page', async () => {
    const [biliProject] = persistProjects('/Users/test/develop/opencreator/bili');
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: biliProject.id,
      selectedThreadId: 'thread_older_history'
    }));
    const hostBridge = createHostBridge();
    const requestedUrls: string[] = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
            cwd: '/Users/test/develop/opencreator/bili',
            canonicalCwd: '/Users/test/develop/opencreator/bili'
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
    expect(screen.getByRole('heading', { name: '分页外的历史会话' })).toBeInTheDocument();
    expect(requestedUrls.some(url => url.endsWith('/threads/thread_older_history'))).toBe(true);
  });

  it('loads conversation history from runtime threads instead of mock conversations', async () => {
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /真实 Codex 历史会话/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整理本周项目进展 4天' })).not.toBeInTheDocument();
  });

  it('loads task summaries without preloading task history or listing task threads as conversations', async () => {
    const [contentProject] = persistProjects('/Users/test/develop/content-design');
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: contentProject.id
    }));
    const requestedUrls: string[] = [];
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      requestedUrls.push(url);
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread-conversation',
              title: '普通会话',
              purpose: 'conversation',
              updatedAt: '2026-08-03T00:00:00.000Z'
            }),
            createThreadResponse({
              id: 'thread-draft',
              title: '任务草稿',
              purpose: 'schedule_draft',
              updatedAt: '2026-08-05T00:00:00.000Z'
            }),
            createThreadResponse({
              id: 'thread-task',
              title: '任务线程旧标题',
              purpose: 'schedule_task',
              scheduleId: 'schedule-1',
              updatedAt: '2026-08-01T00:00:00.000Z'
            })
          ]
        });
      }
      if (url.endsWith('/schedules')) {
        return jsonResponse({
          schedules: [
            createScheduleResponse({
              id: 'schedule-1',
              threadId: 'thread-task',
              name: '每日总结',
              updatedAt: '2026-08-04T00:00:00.000Z'
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

    const conversationList = await screen.findByLabelText('content-design 对话');
    const taskList = await screen.findByLabelText('任务会话');
    expect(within(conversationList).getByRole('button', { name: /普通会话/ }))
      .toBeInTheDocument();
    expect(within(taskList).getByRole('button', { name: /任务草稿.*草稿/ }))
      .toHaveClass('sidebar-task-row');
    expect(within(conversationList).queryByText('任务草稿'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /任务线程旧标题/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(requestedUrls.some(url => url.endsWith('/schedules'))).toBe(true);
    });
    expect(within(taskList).getByRole('button', { name: /^每日总结/ }))
      .toBeInTheDocument();
    expect(
      Array.from(taskList.querySelectorAll('.sidebar-task-copy strong'))
        .map(element => element.textContent)
    ).toEqual(['任务草稿', '每日总结']);
    expect(requestedUrls.some(url => url.includes('/history'))).toBe(false);
  });

  it('opens a sidebar task by clearing the previous timeline and showing task history loading', async () => {
    const user = userEvent.setup();
    const taskHistory = createDeferred<Response>();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread-conversation',
              title: '普通会话',
              purpose: 'conversation'
            }),
            createThreadResponse({
              id: 'thread-task',
              title: '任务线程',
              purpose: 'schedule_task',
              scheduleId: 'schedule-1'
            })
          ]
        });
      }
      if (url.endsWith('/schedules')) {
        return jsonResponse({
          schedules: [
            createScheduleResponse({
              id: 'schedule-1',
              threadId: 'thread-task',
              name: '每日总结'
            })
          ]
        });
      }
      if (url.endsWith('/tasks?status=all&limit=50')) {
        return jsonResponse({ tasks: [], hasMore: false });
      }
      if (url.endsWith('/threads/thread-conversation/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread-conversation',
          codexThreadId: null,
          items: [
            {
              id: 'history-conversation',
              type: 'assistant_message',
              text: '旧会话内容',
              createdAt: '2026-07-14T00:00:00.000Z'
            }
          ]
        });
      }
      if (url.endsWith('/threads/thread-conversation/runs?limit=50')) {
        return jsonResponse({ runs: [] });
      }
      if (url.endsWith('/threads/thread-task/history?limit=50')) {
        return taskHistory.promise;
      }
      if (url.endsWith('/threads/thread-task/runs?limit=50')) {
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

    const conversationList = await screen.findByLabelText('content-design 对话');
    const taskList = await screen.findByLabelText('任务会话');
    await user.click(within(conversationList).getByRole('button', { name: /普通会话/ }));
    expect(await screen.findByText('旧会话内容')).toBeInTheDocument();

    await user.click(await within(taskList).findByRole('button', { name: /^每日总结/ }));

    expect(screen.queryByText('旧会话内容')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '正在加载会话历史' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/thread/thread-task');

    taskHistory.resolve(jsonResponse({
      threadId: 'thread-task',
      codexThreadId: null,
      items: []
    }));
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: '正在加载会话历史' })).not.toBeInTheDocument();
    });
  });

  it('loads the selected Codex history transcript into the conversation surface', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /真实 Codex 历史会话/ }));

    expect(await findTimelineUserMessage('分析这个 skill 是干什么的')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /选择项目 / })).not.toBeInTheDocument();
    expect(await screen.findByText(/^(?:已完成|已处理 .+)$/)).toBeInTheDocument();

    await user.click(screen.getByText(/^(?:已完成|已处理 .+)$/));

    expect(screen.getByText('先读取 skill 说明。')).toBeInTheDocument();
    expect(screen.getByText('这个 skill 用于分析选品资料。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑消息' }));

    expect(screen.getByRole('textbox', { name: '输入任务' }))
      .toHaveValue('分析这个 skill 是干什么的');
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveFocus();
    });
  });

  it('loads the latest history page first and prepends an older cursor page without duplicates', async () => {
    const user = userEvent.setup();
    const requestedUrls: string[] = [];
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_synthetic_history',
              title: '无 Turn ID 的分页会话',
              codexThreadId: 'codex-synthetic-history',
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /无 Turn ID 的分页会话/ }));
    await user.click(await screen.findByText(/^(?:已完成|已处理 .+)$/));

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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /刚生成的内容/ }));

    expect(await findTimelineUserMessage('帮我生成视频脚本')).toBeInTheDocument();
    expect(screen.getByText('这是生成好的视频脚本。')).toBeInTheDocument();
    expect(historyRequests).toBe(1);
  });

  it('opens a search result outside the recent page and loads the latest history page', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const requestedUrls: string[] = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
              itemType: 'title',
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
      if (url.endsWith('/threads/thread_search_target/history?limit=50')) {
        return jsonResponse({
          threadId: 'thread_search_target',
          codexThreadId: 'codex-search-target',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '搜索' }));
    await user.type(await screen.findByRole('searchbox', { name: '搜索会话' }), 'App.tsx');
    const result = await screen.findByTestId('search-result-title');
    await user.click(within(result).getByRole('button'));

    expect(await findTimelineUserMessage('目标位于 App.tsx')).toBeInTheDocument();
    expect(document.querySelector('[data-search-target="true"]')).toBeNull();
    expect(requestedUrls).toEqual(expect.arrayContaining([
      expect.stringContaining(
        '/threads/thread_search_target/history?limit=50'
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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    const conversationButton = await screen.findByRole('button', { name: /当前打开的历史/ });
    await user.click(conversationButton);

    expect(await findTimelineUserMessage('保持当前内容')).toBeInTheDocument();
    expect(screen.getByText('当前内容仍然可见。')).toBeInTheDocument();

    await user.click(conversationButton);

    expect(await findTimelineUserMessage('保持当前内容')).toBeInTheDocument();
    expect(screen.getByText('当前内容仍然可见。')).toBeInTheDocument();
    expect(screen.queryByText('需要帮你做点什么')).not.toBeInTheDocument();
  });

  it('replaces the previous transcript with a loading state while switching conversations', async () => {
    const user = userEvent.setup();
    const projects = persistProjects(
      '/Users/test/develop/content-design',
      '/Users/test/develop/opencreator/bili'
    );
    const contentProject = projects[0];
    const biliProject = projects[1]!;
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: contentProject.id
    }));
    const hostBridge = createHostBridge();
    let resolveNextHistory: ((response: Response) => void) | undefined;
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_content_history',
              title: 'content-design 历史',
              projectId: contentProject.id,
              codexThreadId: 'codex-content-history',
              cwd: '/Users/test/develop/content-design',
              canonicalCwd: '/Users/test/develop/content-design'
            }),
            createThreadResponse({
              id: 'thread_bili_history',
              title: 'bili 历史',
              projectId: biliProject.id,
              codexThreadId: 'codex-bili-history',
              cwd: '/Users/test/develop/opencreator/bili',
              canonicalCwd: '/Users/test/develop/opencreator/bili'
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
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
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files',
              title: '真实文件会话',
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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
          rootName: 'opencreator-agent',
          rootPathLabel: '/Users/test/develop/opencreator/opencreator-agent',
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

    await user.click(await screen.findByRole('button', { name: /真实文件会话/ }));
    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(await screen.findByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: '真实文件会话' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.queryByText('打开文件')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回对话' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无预览内容')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(screen.queryByLabelText('会话和文件工作区')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('点击聊天回复中的成果卡片会直接打开对应文件', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const absoluteChangedPath = '/private/runtime/workspaces/opencreator-agent/xiaodoujia-apple-aso-audit.html';
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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
          rootName: 'opencreator-agent',
          rootPathLabel: '/Users/test/develop/opencreator/opencreator-agent',
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
              path: 'xiaodoujia-apple-aso-audit.html',
              name: 'xiaodoujia-apple-aso-audit.html',
              depth: 0,
              type: 'file',
              meta: {
                kind: 'html',
                mime: 'text/html',
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
        if (path !== 'xiaodoujia-apple-aso-audit.html') throw new Error(`Expected HTML meta request, got ${path}`);
        return jsonResponse({
          path: 'xiaodoujia-apple-aso-audit.html',
          name: 'xiaodoujia-apple-aso-audit.html',
          type: 'file',
          kind: 'html',
          mime: 'text/html',
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
        if (path !== 'xiaodoujia-apple-aso-audit.html') throw new Error(`Expected HTML content request, got ${path}`);
        return jsonResponse({
          meta: {
            path: 'xiaodoujia-apple-aso-audit.html',
            name: 'xiaodoujia-apple-aso-audit.html',
            type: 'file',
            kind: 'html',
            mime: 'text/html',
            size: 1,
            mtimeMs: 1,
            versionToken: 'v1',
            previewable: true,
            editable: true,
            readonly: false
          },
          content: '<h1>Generated</h1>',
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

    await user.click(await screen.findByRole('button', { name: /真实文件会话/ }));
    await user.click(await screen.findByRole('button', { name: `打开成果 ${absoluteChangedPath}` }));

    expect(await screen.findByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(await screen.findByTitle('xiaodoujia-apple-aso-audit.html HTML 预览')).toBeInTheDocument();
    expect(screen.queryByText('选择一个文件')).not.toBeInTheDocument();
    expect(screen.queryByText('已编辑 docs/atoms.md')).not.toBeInTheDocument();
    expect(
      fetchCalls.some(call => (
        call.url.includes('/workspace/files/meta?')
        && call.url.includes('path=xiaodoujia-apple-aso-audit.html')
      ))
    ).toBe(true);
  });

  it('会话和文件工作区之间的分隔条可以拖动调整宽度', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 954px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files',
              title: '真实文件会话',
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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
          rootName: 'opencreator-agent',
          rootPathLabel: '/Users/test/develop/opencreator/opencreator-agent',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    const navigation = screen.getByLabelText('OpenCreator 导航');
    expect(navigation).toHaveAttribute('data-collapsed', 'false');
    await user.click(await screen.findByRole('button', { name: /真实文件会话/ }));
    await user.click(screen.getByRole('button', { name: '文件' }));
    await screen.findByRole('heading', { name: 'Workspace' });
    expect(navigation).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: '侧栏已自动收起' })).toBeInTheDocument();

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
    fireEvent.mouseDown(separator, { button: 0, clientX: 420 });
    expect(document.querySelector('.pane-resize-shield')).not.toBeNull();
    fireEvent.mouseMove(window, { clientX: 520 });
    fireEvent.mouseUp(window);
    expect(document.querySelector('.pane-resize-shield')).toBeNull();

    expect(layout).toHaveStyle({ '--conversation-pane-width': '520px' });

    fireEvent.mouseDown(separator, { button: 0, clientX: 520 });
    fireEvent.mouseMove(window, { clientX: 1190 });
    fireEvent.mouseUp(window);

    expect(layout).toHaveStyle({ '--conversation-pane-width': '914px' });

    await user.click(screen.getByRole('button', { name: '关闭文件工作区' }));
    expect(navigation).toHaveAttribute('data-collapsed', 'false');
  });

  it.each(['browser', 'desktop'] as const)(
    '%s host 下文件区打开时跟随有文件的会话，并在切换到空会话后关闭',
    async (hostKind) => {
    const user = userEvent.setup();
    const hostBridge: HostBridge = { ...createHostBridge(), kind: hostKind };
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files_a',
              title: '文件会话 A',
              cwd: '/workspace/a',
              canonicalCwd: '/workspace/a'
            }),
            createThreadResponse({
              id: 'thread_files_b',
              title: '文件会话 B',
              cwd: '/workspace/b',
              canonicalCwd: '/workspace/b'
            }),
            createThreadResponse({
              id: 'thread_files_empty',
              title: '空文件会话',
              cwd: '/workspace/empty',
              canonicalCwd: '/workspace/empty'
            })
          ]
        });
      }
      if (/\/threads\/thread_files_(?:a|b|empty)\/history\?limit=50$/.test(url)) {
        const threadId = url.match(/thread_files_(?:a|b|empty)/)?.[0] ?? '';
        return jsonResponse({ threadId, codexThreadId: null, items: [] });
      }
      if (url.includes('/workspace/files/directory?')) {
        const requestUrl = new URL(url);
        const threadId = requestUrl.searchParams.get('threadId') ?? '';
        const fileName = threadId === 'thread_files_a'
          ? 'A.md'
          : threadId === 'thread_files_b'
            ? 'B.md'
            : undefined;
        return jsonResponse({
          threadId,
          rootName: threadId,
          rootPathLabel: `/workspace/${threadId}`,
          path: '',
          ...(fileName === undefined ? {} : { suggestedOpenPath: fileName }),
          truncated: false,
          warnings: [],
          nodes: fileName === undefined ? [] : [{
            path: fileName,
            name: fileName,
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
          }]
        });
      }
      if (url.includes('/workspace/files/meta?')) {
        const requestUrl = new URL(url);
        const path = requestUrl.searchParams.get('path') ?? '';
        return jsonResponse({
          path,
          name: path,
          type: 'file',
          kind: 'markdown',
          mime: 'text/markdown',
          size: 1,
          mtimeMs: 1,
          versionToken: `v-${path}`,
          previewable: true,
          editable: true,
          readonly: false
        });
      }
      if (url.includes('/workspace/files/content?')) {
        const requestUrl = new URL(url);
        const path = requestUrl.searchParams.get('path') ?? '';
        return jsonResponse({
          meta: {
            path,
            name: path,
            type: 'file',
            kind: 'markdown',
            mime: 'text/markdown',
            size: 1,
            mtimeMs: 1,
            versionToken: `v-${path}`,
            previewable: true,
            editable: true,
            readonly: false
          },
          content: `# ${path}`,
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /文件会话 A/ }));
    await user.click(screen.getByRole('button', { name: '文件' }));
    expect(await screen.findByRole('heading', { name: 'A.md' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /文件会话 B/ }));
    expect(screen.getByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'B.md' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /空文件会话/ }));
    await waitFor(() => {
      expect(screen.queryByLabelText('会话和文件工作区')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /文件会话 A/ }));
    expect(screen.queryByLabelText('会话和文件工作区')).not.toBeInTheDocument();
    }
  );

  it('已有只读会话切换为完全访问后会更新 thread 并允许编辑文件', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let threadSandbox: ThreadResponse['sandbox'] = 'read-only';
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
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
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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
            cwd: '/Users/test/develop/opencreator/opencreator-agent',
            canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
          })
        });
      }
      if (url.includes('/workspace/files/directory?')) {
        return jsonResponse({
          threadId: 'thread_files',
          rootName: 'opencreator-agent',
          rootPathLabel: '/Users/test/develop/opencreator/opencreator-agent',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /只读文件会话/ }));
    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(await screen.findByText('当前会话为只读模式，不能保存文件')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toHaveAttribute('aria-readonly', 'true');

    await user.click(screen.getByRole('button', { name: '选择访问权限 请求批准' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));
    await user.click(screen.getByRole('button', { name: '开启' }));

    await waitFor(() => {
      expect(findPatchCall(fetchCalls, '/threads/thread_files')).toBeDefined();
    });
    expect(screen.queryByText('当前会话为只读模式，不能保存文件')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toHaveAttribute('aria-readonly', 'false');
  });

  it('不显示无用途的详情按钮，点击文件进入真实文件工作区', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_files',
              title: '真实文件会话',
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent'
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
          rootName: 'opencreator-agent',
          rootPathLabel: '/Users/test/develop/opencreator/opencreator-agent',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /真实文件会话/ }));

    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'README.md' })).not.toBeInTheDocument();
    expect(screen.queryByText('已编辑 docs/atoms.md')).not.toBeInTheDocument();
    expect(screen.queryByText('+903 -0')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无预览内容')).not.toBeInTheDocument();
    expect(screen.queryByText('打开文件')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '文件' }));
    expect(screen.getByLabelText('会话和文件工作区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '真实文件会话' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.queryByText('打开文件')).not.toBeInTheDocument();
  });

  it('loads migrated projects from Runtime and never renders local home', async () => {
    const contentProject = createLegacyPersistedProject('/Users/test/develop/content-design');
    const legacyProjects = JSON.stringify([
      {
        ...createLegacyPersistedProject('~'),
        id: 'local-home',
        name: '本机目录'
      },
      contentProject
    ]);
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, legacyProjects);
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_codex_opencreator_agent',
              title: '真实 Codex 当前项目历史',
              projectId: contentProject.id,
              codexThreadId: 'codex-history-opencreator-agent',
              cwd: '/Users/test/develop/opencreator/opencreator-agent',
              canonicalCwd: '/Users/test/develop/opencreator/opencreator-agent',
              updatedAt: new Date().toISOString()
            }),
            createThreadResponse({
              id: 'thread_codex_content_design',
              title: 'content-design 旧历史',
              projectId: contentProject.id,
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'content-design' })).toHaveAttribute('data-current-project', 'true');
    expect(screen.queryByRole('button', { name: '本机目录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'opencreator-agent' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /真实 Codex 当前项目历史/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /content-design 旧历史/ })).toBeInTheDocument();
    expect(window.localStorage.getItem(PROJECTS_STORAGE_KEY)).toBe(legacyProjects);
  });

  it('shows the cached model catalog immediately and replaces it after refresh', async () => {
    const cachedCatalog = createCodexModelListResponse();
    cachedCatalog.models[0]!.displayName = 'Cached GPT';
    const liveCatalog = createCodexModelListResponse();
    liveCatalog.models[0]!.displayName = 'Live GPT';
    writeCachedModelCatalog(cachedCatalog, '2026-08-05T08:00:00.000Z');
    const modelResponse = createDeferred<Response>();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) return modelResponse.promise;
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(screen.getByRole('button', { name: '选择模型 Cached GPT' }))
      .toBeInTheDocument();
    expect(await screen.findByRole('status', { name: '本地运行内核正常' }))
      .toBeInTheDocument();

    modelResponse.resolve(jsonResponse(liveCatalog));

    expect(await screen.findByRole('button', { name: '选择模型 Live GPT' }))
      .toBeInTheDocument();
    expect(readCachedModelCatalog()?.models[0]?.displayName).toBe('Live GPT');
  });

  it('keeps cached models when the Runtime refresh fails', async () => {
    const user = userEvent.setup();
    const cachedCatalog = createCodexModelListResponse();
    cachedCatalog.models[0]!.displayName = 'Cached GPT';
    writeCachedModelCatalog(cachedCatalog, '2026-08-05T08:00:00.000Z');
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) throw new Error('model catalog unavailable');
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' }))
      .toBeInTheDocument();
    const modelButton = await screen.findByRole('button', {
      name: '选择模型 Cached GPT'
    });
    await user.click(modelButton);

    expect(await screen.findByText('模型目录刷新失败，当前使用本地缓存'))
      .toBeInTheDocument();
    expect(screen.queryByText('暂无可用模型')).not.toBeInTheDocument();
  });

  it('shows a clear model error when refresh fails without a cache', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) throw new Error('model catalog unavailable');
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' }))
      .toBeInTheDocument();
    await user.click(await screen.findByRole('button', {
      name: '选择模型 默认模型'
    }));

    expect(await screen.findByText('无法加载模型列表')).toBeInTheDocument();
    expect(screen.queryByText('暂无可用模型')).not.toBeInTheDocument();
  });

  it('restores the recent model config for a new conversation', async () => {
    const user = userEvent.setup();
    writeRecentModelConfig({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) return jsonResponse(createCodexModelListResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' }))
      .toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '选择模型 GPT-5.5' }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择模型 GPT-5.5' }));
    expect(screen.getByRole('menuitemradio', { name: /^超高 / }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('prefers explicit project model config over the recent selection', async () => {
    const user = userEvent.setup();
    writeRecentModelConfig({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });
    testRuntimeProjects = [
      createTestProject('/Users/test/develop/content-design', {
        model: 'gpt-5.6-sol',
        reasoning: 'medium'
      })
    ];
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) return jsonResponse(createCodexModelListResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [] });
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

    expect(await screen.findByRole('button', { name: '选择模型 GPT-5.6 Sol' }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择模型 GPT-5.6 Sol' }));
    expect(screen.getByRole('menuitemradio', { name: /^中 / }))
      .toHaveAttribute('aria-checked', 'true');
  });

  it('creates a runtime thread before starting the first run in a new conversation', async () => {
    const user = userEvent.setup();
    const prompt = '跟进今天客户沟通';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [] });
      if (url.endsWith('/threads')) {
        return jsonResponse({
          thread: createThreadResponse({
            id: 'thread_created_from_chat',
            title: prompt,
            cwd: '~',
            canonicalCwd: '~'
          })
        }, { status: 201 });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('已跟进。')).toBeInTheDocument();
    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: prompt,
      projectId: readTestRuntimeProjects()[0]!.id
    });
    expect(createThreadBody).not.toHaveProperty('cwd');
    expect(createThreadBody).not.toHaveProperty('workspaceMode');
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
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) return jsonResponse(createCodexModelListResponse());
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
              cwd: '~',
              canonicalCwd: '~',
              profile: 'default',
              sandbox: 'danger-full-access',
              model: 'gpt-5.5',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '选择访问权限 请求批准' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));
    await user.click(screen.getByRole('button', { name: '开启' }));
    await user.click(await screen.findByRole('button', {
      name: '选择模型 GPT-5.6 Sol'
    }));
    await user.click(screen.getByRole('menuitemradio', { name: /GPT-5.5/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /^超高 / }));
    expect(readRecentModelConfig()).toEqual({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });
    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, prompt);
    await waitFor(() => expect(textbox).toHaveValue(prompt));
    await user.click(screen.getByRole('button', { name: '发送' }));

    await findTimelineUserMessage(prompt);
    const createThreadBody = JSON.parse(String(findPostCall(fetchCalls, '/threads')?.init?.body)) as Record<string, unknown>;
    expect(createThreadBody).toMatchObject({
      title: prompt,
      profile: 'default',
      sandbox: 'danger-full-access',
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });
    expect(JSON.parse(String(findPostCall(fetchCalls, '/runs')?.init?.body))).toEqual({
      threadId: 'thread_configured_from_chat',
      prompt,
      resumeMode: 'auto',
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });
  });

  it('does not override immutable thread config when sending in an existing conversation', async () => {
    const user = userEvent.setup();
    const prompt = '继续处理这个会话';
    writeRecentModelConfig({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/codex/models')) return jsonResponse(createCodexModelListResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_existing',
              title: '已有会话',
              sandbox: 'read-only',
              model: 'gpt-5.6-sol',
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /已有会话/ }));
    await user.click(await screen.findByRole('button', {
      name: '选择模型 GPT-5.6 Sol'
    }));
    await user.click(screen.getByRole('menuitemradio', { name: /GPT-5.5/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /^超高 / }));
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

    await user.click(await screen.findByRole('button', { name: '设置' }));

    expect(await screen.findByRole('heading', { name: '常规' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回应用' }));

    expect(screen.queryByRole('heading', { name: '新对话' })).not.toBeInTheDocument();
    expect(await screen.findByText('需要帮你做点什么')).toBeInTheDocument();
  });

  it('uses a solid conversation background without a dynamic background setting', async () => {
    const user = userEvent.setup();

    render(<App fileService={createFileService()} />);

    expect(screen.queryByRole('heading', { name: '新对话' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('conversation-lightfall-background')).not.toBeInTheDocument();
    expect(document.querySelector('.conversation-page')).not.toHaveAttribute('data-background-mode');
    expect(document.querySelector('.conversation-page')).not.toHaveAttribute('data-dynamic-background');

    await user.click(await screen.findByRole('button', { name: '设置' }));
    expect(screen.queryByRole('switch', { name: '动态背景' })).not.toBeInTheDocument();
  });

  it('applies and persists the selected color mode', async () => {
    const user = userEvent.setup();

    render(<App fileService={createFileService()} />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    await user.click(await screen.findByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('button', { name: '浅色' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('opencreator.preferences.colorMode')).toBe('light');
  });

  it('applies and persists the selected accent color', async () => {
    const user = userEvent.setup();

    render(<App fileService={createFileService()} />);
    expect(document.documentElement).toHaveAttribute('data-accent', 'neutral');

    await user.click(await screen.findByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('radio', { name: '紫色' }));

    expect(document.documentElement).toHaveAttribute('data-accent', 'purple');
    expect(window.localStorage.getItem('opencreator.preferences.accentColor')).toBe('purple');
  });

  it('applies and persists a custom accent color', async () => {
    const user = userEvent.setup();

    render(<App fileService={createFileService()} />);
    await user.click(await screen.findByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('radio', { name: '自定义' }));

    const input = screen.getByRole('textbox', { name: '自定义重点色色值' });
    await user.clear(input);
    await user.type(input, '#12abef');

    expect(document.documentElement).toHaveAttribute('data-accent', 'custom');
    expect(document.documentElement).toHaveStyle({
      '--custom-accent-value': '#12abef'
    });
    expect(document.documentElement.style.getPropertyValue('--custom-on-accent')).not.toBe('');
    expect(screen.getByRole('radio', { name: '自定义' })).toHaveStyle({
      '--settings-accent-swatch': '#12abef'
    });
    expect(window.localStorage.getItem('opencreator.preferences.accentColor')).toBe('custom');
    expect(window.localStorage.getItem('opencreator.preferences.customAccentColor')).toBe('#12abef');
  });

  it('persists the global default permission across refreshes and projects', async () => {
    const user = userEvent.setup();
    const projects = persistProjects(
      '/workspace/primary',
      '/workspace/secondary'
    );
    const primaryProject = projects[0];
    const secondaryProject = projects[1]!;
    window.localStorage.setItem('opencreator.navigation.v3', JSON.stringify({
      currentProjectId: primaryProject.id
    }));
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({
          threads: [
            createThreadResponse({
              id: 'thread_secondary_history',
              title: 'secondary 历史',
              projectId: secondaryProject.id,
              cwd: '/workspace/secondary',
              canonicalCwd: '/workspace/secondary'
            })
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'secondary' }));
    expect(screen.getByRole('button', { name: '选择访问权限 完全访问权限' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.selectOptions(
      await screen.findByRole('combobox', { name: '默认权限' }),
      'workspace-write'
    );

    expect(window.localStorage.getItem('opencreator.preferences.defaultPermission'))
      .toBe('workspace-write');

    await user.click(screen.getByRole('button', { name: '返回应用' }));
    expect(await screen.findByRole('button', { name: 'secondary' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' })).toBeInTheDocument();

    firstRender.unmount();
    render(<App {...appProps} />);

    expect(await screen.findByRole('button', { name: 'secondary' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(await screen.findByRole('combobox', { name: '默认权限' }))
      .toHaveValue('workspace-write');
  });

  it('syncs a global permission to ordinary conversations without changing scheduled threads', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/settings';
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const ordinaryThread = createThreadResponse({
      id: 'thread-ordinary',
      title: '普通只读会话',
      sandbox: 'read-only'
    });
    const scheduleDraftThread = createThreadResponse({
      id: 'thread-schedule-draft',
      title: '任务草稿',
      purpose: 'schedule_draft',
      workspaceMode: 'managed',
      sandbox: 'danger-full-access'
    });
    const scheduleTaskThread = createThreadResponse({
      id: 'thread-schedule-task',
      title: '定时任务',
      purpose: 'schedule_task',
      scheduleId: 'schedule-1',
      sandbox: 'workspace-write'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&purpose=conversation&limit=50')) {
        return jsonResponse({ threads: [ordinaryThread] });
      }
      if (url.endsWith('/threads?status=active&purpose=schedule_task&limit=100')) {
        return jsonResponse({ threads: [scheduleTaskThread] });
      }
      if (url.endsWith('/schedules')) return jsonResponse({ schedules: [] });
      if (url.endsWith('/tasks?status=all&limit=50')) {
        return jsonResponse({ tasks: [], hasMore: false });
      }
      if (url.endsWith('/threads/thread-ordinary') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { sandbox: ThreadResponse['sandbox'] };
        return jsonResponse({
          thread: {
            ...ordinaryThread,
            sandbox: body.sandbox
          }
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

    expect(await screen.findByRole('heading', { name: '常规' })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchCalls.some(call => call.url.includes('purpose=conversation'))).toBe(true);
    });

    await user.selectOptions(
      screen.getByRole('combobox', { name: '默认权限' }),
      'danger-full-access'
    );
    await user.click(await screen.findByRole('button', { name: '开启' }));

    await waitFor(() => {
      expect(findPatchCall(fetchCalls, '/threads/thread-ordinary')).toBeDefined();
    });
    expect(JSON.parse(String(findPatchCall(fetchCalls, '/threads/thread-ordinary')?.init?.body)))
      .toEqual({ sandbox: 'danger-full-access' });
    expect(findPatchCall(fetchCalls, '/threads/thread-schedule-draft')).toBeUndefined();
    expect(findPatchCall(fetchCalls, '/threads/thread-schedule-task')).toBeUndefined();
    expect(window.localStorage.getItem('opencreator.preferences.defaultPermission'))
      .toBe('danger-full-access');
  });

  it('disables permission changes while the selected thread has an active run', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const thread = createThreadResponse({
      id: 'thread_running_permission',
      title: '运行中的权限会话',
      sandbox: 'workspace-write'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [thread] });
      }
      if (url.endsWith('/threads/thread_running_permission/history?limit=50')) {
        return jsonResponse({
          threadId: thread.id,
          codexThreadId: null,
          items: []
        });
      }
      if (url.endsWith('/threads/thread_running_permission/runs?limit=50')) {
        return jsonResponse({
          runs: [createRunResponse({
            id: 'run_running_permission',
            threadId: thread.id,
            status: 'running'
          })]
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /运行中的权限会话/ }));

    const permissionButton = await screen.findByRole('button', {
      name: '选择访问权限 请求批准'
    });
    await waitFor(() => expect(permissionButton).toBeDisabled());
    expect(permissionButton).toHaveAttribute('title', '当前任务结束后可修改访问权限');
    expect(findPatchCall(fetchCalls, '/threads/thread_running_permission')).toBeUndefined();
  });

  it('keeps request approval selected when the runtime rejects a permission update', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const thread = createThreadResponse({
      id: 'thread_permission_race',
      title: '权限切换竞争',
      sandbox: 'workspace-write'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) {
        return jsonResponse({ threads: [thread] });
      }
      if (url.endsWith('/threads/thread_permission_race/history?limit=50')) {
        return jsonResponse({
          threadId: thread.id,
          codexThreadId: null,
          items: []
        });
      }
      if (url.endsWith('/threads/thread_permission_race/runs?limit=50')) {
        return jsonResponse({ runs: [] });
      }
      if (url.endsWith('/threads/thread_permission_race') && init?.method === 'PATCH') {
        return jsonResponse({
          error: {
            code: 'THREAD_HAS_ACTIVE_RUN',
            message: 'Thread has active run'
          }
        }, { status: 409 });
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

    expect(await screen.findByRole('status', { name: '本地运行内核正常' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /权限切换竞争/ }));
    await user.click(await screen.findByRole('button', {
      name: '选择访问权限 请求批准'
    }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问权限/ }));
    await user.click(screen.getByRole('button', { name: '开启' }));

    expect(await screen.findByText('任务运行期间不能修改访问权限，请等待当前任务结束'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' }))
      .toBeInTheDocument();
    expect(findPatchCall(fetchCalls, '/threads/thread_permission_race')).toBeDefined();
  });

  it('connects memory management, summary creation, suggestions, and run context end to end', async () => {
    const user = userEvent.setup();
    const hostBridge = createHostBridge();
    const thread = createThreadResponse({ id: 'thread_memory', title: '记忆功能会话' });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    hostBridge.readConnectionConfig = async () => ({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    const runtimeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const projectApiResponse = handleDefaultProjectApiRequest(url, init);
      if (projectApiResponse !== undefined) return projectApiResponse;
      fetchCalls.push({ url, init });
      if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
      if (url.endsWith('/codex/status')) return jsonResponse(createCodexStatusResponse());
      if (url.endsWith('/threads?status=active&limit=50')) return jsonResponse({ threads: [thread] });
      if (url.endsWith('/threads/thread_memory/history?limit=50')) {
        return jsonResponse({
          threadId: thread.id,
          codexThreadId: null,
          items: [{
            id: 'item_1',
            type: 'user_message',
            text: '继续开发',
            createdAt: '2026-07-12T00:00:00.000Z'
          }]
        });
      }
      if (url.endsWith('/threads/thread_memory/runs?limit=50')) return jsonResponse({ runs: [] });
      if (url.includes('/memories?')) {
        return jsonResponse({
          memories: [{
            id: 'mem_1',
            content: '提交前运行全部测试',
            scope: 'project',
            scopeKey: thread.canonicalCwd,
            source: 'user',
            enabled: true,
            sensitive: false,
            userConfirmedAt: '2026-07-12T00:00:00.000Z',
            createdAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:00:00.000Z'
          }]
        });
      }
      if (url.endsWith('/summaries?limit=100')) {
        return jsonResponse({
          summaries: [{
            id: 'summary_1',
            threadId: thread.id,
            content: '用户：继续开发',
            coveredFromCursor: 'item_1',
            coveredToCursor: 'item_1',
            itemCount: 1,
            version: 1,
            createdAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:00:00.000Z'
          }]
        });
      }
      if (url.endsWith('/threads/thread_memory/summaries') && init?.method === 'POST') {
        return jsonResponse({
          summary: {
            id: 'summary_2',
            threadId: thread.id,
            content: '用户：继续开发',
            coveredFromCursor: 'item_1',
            coveredToCursor: 'item_1',
            itemCount: 1,
            version: 2,
            createdAt: '2026-07-12T00:01:00.000Z',
            updatedAt: '2026-07-12T00:01:00.000Z'
          }
        }, { status: 201 });
      }
      if (url.endsWith('/runs') && init?.method === 'POST') {
        return jsonResponse(createRunResponse({
          id: 'run_memory',
          threadId: thread.id,
          status: 'running'
        }), { status: 202 });
      }
      if (url.endsWith('/runs/run_memory/diagnostics')) {
        return jsonResponse({
          ...createRunDiagnosticsResponse(createCodexStatusResponse()),
          runId: 'run_memory'
        });
      }
      if (url.endsWith('/runs/run_memory/context')) {
        return jsonResponse({
          runId: 'run_memory',
          items: [{
            kind: 'memory',
            sourceId: 'mem_1',
            content: '提交前运行全部测试',
            order: 0,
            scope: 'project',
            scopeKey: thread.canonicalCwd
          }, {
            kind: 'summary',
            sourceId: 'summary_1',
            content: '用户：继续开发',
            order: 1,
            summaryVersion: 1
          }]
        });
      }
      if (url.endsWith('/runs/run_memory')) {
        return jsonResponse(createRunResponse({
          id: 'run_memory',
          threadId: thread.id,
          status: 'succeeded'
        }));
      }
      throw new Error(`Unexpected request ${url}`);
    };
    const subscribeRunEvents = async (input: SubscribeRunEventsInput) => {
      input.onEvent(createRuntimeEvent(
        'done',
        { type: 'done', status: 'succeeded', terminationReason: 'completed' },
        1
      ));
    };

    render(
      <App
        fileService={createFileService()}
        hostBridge={hostBridge}
        runtimeFetch={runtimeFetch}
        subscribeRunEvents={subscribeRunEvents}
      />
    );

    await user.click(await screen.findByRole('button', { name: /记忆功能会话/ }));
    expect(screen.queryByRole('button', { name: /生成摘要|查看摘要/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.click(await screen.findByRole('button', { name: '记忆' }));
    expect(await screen.findByText('提交前运行全部测试')).toBeInTheDocument();
    expect(screen.getByText('版本 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回应用' }));
    const prompt = '以后默认运行全量测试';
    await user.type(await screen.findByRole('textbox', { name: '输入任务' }), prompt);
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('region', { name: '记忆建议' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '忽略记忆建议' }));
    expect(fetchCalls.some(call => (
      call.url.endsWith('/memories') && call.init?.method === 'POST'
    ))).toBe(false);

    expect(screen.queryByRole('button', { name: /查看运行详情/ })).not.toBeInTheDocument();
    expect(JSON.parse(String(findPostCall(fetchCalls, '/runs')?.init?.body))).toEqual({
      threadId: thread.id,
      prompt,
      resumeMode: 'auto'
    });
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
    source: 'runtime'
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

function createDirectoryDataTransfer(folder: File): DataTransfer {
  return {
    dropEffect: 'none',
    effectAllowed: 'all',
    files: [folder],
    items: [{
      kind: 'file',
      type: '',
      getAsFile: () => folder,
      getAsString: () => undefined,
      webkitGetAsEntry: () => ({
        filesystem: {},
        fullPath: `/${folder.name}`,
        isDirectory: true,
        isFile: false,
        name: folder.name,
        getParent: () => undefined
      })
    }],
    types: ['Files'],
    clearData: () => undefined,
    getData: () => '',
    setData: () => undefined,
    setDragImage: () => undefined
  } as unknown as DataTransfer;
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers }
  });
}

function handleDefaultProjectApiRequest(
  url: string,
  init?: RequestInit
): Response | undefined {
  const creatorResponse = handleDefaultCreatorApiRequest(url, init);
  if (creatorResponse !== undefined) return creatorResponse;
  if (url.endsWith('/projects/migrations/local-storage-v1')) {
    const projects = readTestRuntimeProjects();
    return jsonResponse({
      status: 'applied',
      projectIdMap: Object.fromEntries(projects.map(project => [project.id, project.id])),
      assignedThreadIds: [],
      unassignedThreadIds: []
    });
  }
  if (url.includes('/threads?') && url.includes('assignment=unassigned')) {
    return jsonResponse({ threads: [] });
  }
  if (url.endsWith('/projects?status=active')) {
    return jsonResponse({
      projects: readTestRuntimeProjects().filter(project => project.status === 'active')
    });
  }
  if (url.endsWith('/projects?status=all')) {
    return jsonResponse({ projects: readTestRuntimeProjects() });
  }
  if (url.endsWith('/projects/default') && init?.method === 'POST') {
    const existing = readTestRuntimeProjects().find(
      project => project.cwd === '/Users/test/Documents/OpenCreator/Default Project'
    );
    if (existing !== undefined) return jsonResponse({ project: existing });
    const project = createTestProject(
      '/Users/test/Documents/OpenCreator/Default Project',
      { name: '默认项目' }
    );
    testRuntimeProjects = [project, ...readTestRuntimeProjects()];
    return jsonResponse({ project });
  }
  if (url.endsWith('/projects/managed') && init?.method === 'POST') {
    const body = readRequestBody(init);
    const name = typeof body.name === 'string' ? body.name.trim() : 'project';
    const project = createTestProject(`/Users/test/Documents/OpenCreator/${name}`, { name });
    testRuntimeProjects = [
      project,
      ...readTestRuntimeProjects().filter(item => item.id !== project.id)
    ];
    return jsonResponse({ project }, { status: 201 });
  }
  if (url.endsWith('/projects') && init?.method === 'POST') {
    const body = readRequestBody(init);
    const cwd = typeof body.cwd === 'string' ? body.cwd : '/workspace/project';
    const project = createTestProject(
      cwd,
      typeof body.name === 'string' ? { name: body.name } : {}
    );
    testRuntimeProjects = [
      project,
      ...readTestRuntimeProjects().filter(item => item.id !== project.id)
    ];
    return jsonResponse({ project }, { status: 201 });
  }

  const projectMutation = url.match(/\/projects\/([^/]+)\/(archive|restore|replace-directory)$/);
  if (projectMutation !== null && init?.method === 'POST') {
    const projectId = decodeURIComponent(projectMutation[1]!);
    const existing = readTestRuntimeProjects().find(project => project.id === projectId);
    if (existing === undefined) return jsonResponse({}, { status: 404 });
    const body = readRequestBody(init);
    const project = projectMutation[2] === 'archive'
      ? {
          ...existing,
          status: 'archived' as const,
          archivedAt: new Date(0).toISOString()
        }
      : projectMutation[2] === 'restore'
        ? {
            ...existing,
            status: 'active' as const,
            archivedAt: null
          }
        : {
            ...existing,
            cwd: typeof body.cwd === 'string' ? body.cwd : existing.cwd,
            canonicalCwd: typeof body.cwd === 'string' ? body.cwd : existing.canonicalCwd,
            directoryState: 'available' as const
          };
    testRuntimeProjects = readTestRuntimeProjects().map(item => (
      item.id === projectId ? project : item
    ));
    return jsonResponse({ project });
  }

  const projectUpdate = url.match(/\/projects\/([^/]+)$/);
  if (projectUpdate !== null && init?.method === 'PATCH') {
    const projectId = decodeURIComponent(projectUpdate[1]!);
    const body = readRequestBody(init);
    const existing = readTestRuntimeProjects().find(project => project.id === projectId);
    if (existing === undefined) return jsonResponse({}, { status: 404 });
    const project = { ...existing, ...body } as ProjectResponse;
    testRuntimeProjects = readTestRuntimeProjects().map(item => (
      item.id === projectId ? project : item
    ));
    return jsonResponse({ project });
  }
  return undefined;
}

function handleDefaultCreatorApiRequest(
  url: string,
  init?: RequestInit
): Response | undefined {
  const method = init?.method ?? 'GET';
  const parsedUrl = new URL(url);
  if (parsedUrl.pathname === '/creator/jobs' && method === 'GET') {
    const projectId = parsedUrl.searchParams.get('projectId');
    return jsonResponse({
      jobs: testCreatorJobs.filter(job => projectId === null || job.projectId === projectId)
    });
  }
  if (parsedUrl.pathname === '/creator/jobs' && method === 'POST') {
    const body = readRequestBody(init ?? {});
    const creationKey = typeof body.creationKey === 'string' ? body.creationKey : undefined;
    const existingJobId = creationKey === undefined
      ? undefined
      : testCreatorJobsByCreationKey.get(creationKey);
    const existingJob = existingJobId === undefined
      ? undefined
      : testCreatorJobs.find(job => job.id === existingJobId);
    if (existingJob !== undefined) return jsonResponse({ job: existingJob }, { status: 201 });
    const now = new Date(0).toISOString();
    const job: CreatorJob = {
      id: `creator-job-${testCreatorJobs.length + 1}`,
      projectId: typeof body.projectId === 'string' ? body.projectId : 'project-test',
      templateId: typeof body.templateId === 'string' ? body.templateId : 'video-translation',
      templateVersion: typeof body.templateVersion === 'number' ? body.templateVersion : 1,
      status: 'draft',
      revision: 0,
      state: body.state !== null && typeof body.state === 'object' && !Array.isArray(body.state)
        ? body.state as Record<string, CreatorJson>
        : {
            sourceType: 'url',
            sourceUrl: '',
            sourceLanguage: 'zh_cn',
            targetLanguage: 'en',
            preferPlatformCaptions: true,
            bilingual: true,
            subtitlePosition: 'top',
            dubbing: false,
            voiceCode: '',
            composeVideo: false,
            videoFormat: 'horizontal',
            currentStage: null
          },
      agentThreadId: null,
      stages: [],
      artifacts: [],
      activities: [],
      createdAt: now,
      updatedAt: now
    };
    testCreatorJobs.push(job);
    if (creationKey !== undefined) testCreatorJobsByCreationKey.set(creationKey, job.id);
    return jsonResponse({ job }, { status: 201 });
  }

  const jobRoute = parsedUrl.pathname.match(/^\/creator\/jobs\/([^/]+)$/);
  if (jobRoute !== null && method === 'GET') {
    const job = testCreatorJobs.find(candidate => candidate.id === decodeURIComponent(jobRoute[1]!));
    return job === undefined ? jsonResponse({}, { status: 404 }) : jsonResponse({ job });
  }
  const historyRoute = parsedUrl.pathname.match(/^\/creator\/jobs\/([^/]+)\/agent-history$/);
  if (historyRoute !== null && method === 'GET') return jsonResponse({ turns: [] });
  const eventsRoute = parsedUrl.pathname.match(/^\/creator\/jobs\/([^/]+)\/events$/);
  if (eventsRoute !== null && method === 'GET') {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  const sourceUploadRoute = parsedUrl.pathname.match(/^\/creator\/jobs\/([^/]+)\/source-video$/);
  if (sourceUploadRoute !== null && method === 'POST') {
    const jobIndex = testCreatorJobs.findIndex(
      candidate => candidate.id === decodeURIComponent(sourceUploadRoute[1]!)
    );
    if (jobIndex < 0) return jsonResponse({}, { status: 404 });
    const previous = testCreatorJobs[jobIndex]!;
    const revision = previous.revision + 1;
    const now = new Date(revision * 1000).toISOString();
    const fileName = parsedUrl.searchParams.get('fileName') ?? 'local-video';
    const mimeType = parsedUrl.searchParams.get('mime') ?? 'application/octet-stream';
    const file = init?.body instanceof File ? init.body : undefined;
    const artifact = {
      id: `source-artifact-${revision}`,
      jobId: previous.id,
      kind: 'source_video' as const,
      version: 1,
      status: 'completed' as const,
      path: `/tmp/${fileName}`,
      sourceArtifactIds: [],
      metadata: {
        fileName,
        mimeType,
        size: file?.size ?? 0,
        lastModified: file?.lastModified ?? null,
        sha256: 'test-source-sha256',
        source: 'local-upload'
      },
      createdAt: now
    };
    const job: CreatorJob = {
      ...previous,
      revision,
      state: {
        ...previous.state,
        sourceType: 'file',
        sourceUrl: '',
        sourceFileName: fileName,
        sourceFileSize: file?.size ?? 0,
        sourceFileLastModified: file?.lastModified ?? null,
        sourceFileSha256: 'test-source-sha256'
      },
      artifacts: [...previous.artifacts, artifact],
      updatedAt: now
    };
    testCreatorJobs[jobIndex] = job;
    return jsonResponse({ job, artifact, deduplicated: false }, { status: 201 });
  }
  const actionRoute = parsedUrl.pathname.match(/^\/creator\/jobs\/([^/]+)\/actions$/);
  if (actionRoute !== null && method === 'POST') {
    const jobIndex = testCreatorJobs.findIndex(
      candidate => candidate.id === decodeURIComponent(actionRoute[1]!)
    );
    if (jobIndex < 0) return jsonResponse({}, { status: 404 });
    const body = readRequestBody(init ?? {});
    const previous = testCreatorJobs[jobIndex]!;
    const input = isPlainTestRecord(body.input) ? body.input : {};
    const patch = (isPlainTestRecord(input.patch) ? input.patch : {}) as Record<string, CreatorJson>;
    const revision = previous.revision + 1;
    const now = new Date(revision * 1000).toISOString();
    const runStage = body.action === 'run-stage';
    const job: CreatorJob = {
      ...previous,
      status: runStage ? 'completed' : previous.status,
      revision,
      state: { ...previous.state, ...patch },
      artifacts: runStage
        ? [{
            id: `artifact-${revision}`,
            jobId: previous.id,
            kind: 'target_subtitle',
            version: 1,
            status: 'completed',
            path: '/tmp/translated.srt',
            sourceArtifactIds: [],
            metadata: {
              cues: [
                { id: 1, start: '00:00:00,000', end: '00:00:03,200', text: 'Welcome to OpenCreator.' }
              ],
              settingsSnapshot: { ...previous.state, ...patch }
            },
            createdAt: now
          }]
        : previous.artifacts,
      activities: [
        ...previous.activities,
        {
          id: `activity-${revision}`,
          jobId: previous.id,
          revision,
          actor: body.actor === 'agent' ? 'agent' : 'user',
          action: typeof body.action === 'string' ? body.action : 'update-settings',
          summary: runStage ? '字幕生成完成' : '创作设置已更新',
          details: {},
          createdAt: now
        }
      ],
      updatedAt: now
    };
    testCreatorJobs[jobIndex] = job;
    return jsonResponse({
      job,
      receipt: {
        actor: body.actor === 'agent' ? 'agent' : 'user',
        action: typeof body.action === 'string' ? body.action : 'update-settings',
        summary: runStage ? '字幕生成完成' : '创作设置已更新',
        affectedArtifacts: runStage ? [`artifact-${revision}`] : [],
        newRevision: revision,
        createdAt: now
      }
    });
  }
  return undefined;
}

function isPlainTestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTestRuntimeProjects(): ProjectResponse[] {
  if (testRuntimeProjects !== undefined) return testRuntimeProjects;
  const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
  if (raw !== null) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (Array.isArray(value)) {
        testRuntimeProjects = value
          .filter((item): item is OpenCreatorProject => (
            typeof item === 'object'
            && item !== null
            && !Array.isArray(item)
            && typeof (item as { id?: unknown }).id === 'string'
            && (item as { id: string }).id !== 'local-home'
            && typeof (item as { cwd?: unknown }).cwd === 'string'
          ))
          .map(project => createTestProject(project.cwd, {
            id: project.id,
            name: project.name,
            sandbox: project.sandbox,
            profile: project.profile,
            model: project.model,
            reasoning: project.reasoning
          }));
        return testRuntimeProjects;
      }
    } catch {
      testRuntimeProjects = [];
      return testRuntimeProjects;
    }
  }
  testRuntimeProjects = [
    createTestProject('/Users/test/develop/content-design', {
      name: 'content-design'
    })
  ];
  return testRuntimeProjects;
}

function createTestProject(
  cwd: string,
  overrides: Partial<ProjectResponse> = {}
): ProjectResponse {
  const legacy = createLegacyPersistedProject(cwd);
  return {
    id: legacy.id,
    name: legacy.name,
    cwd: legacy.cwd,
    canonicalCwd: legacy.cwd,
    directoryState: 'available',
    profile: legacy.profile,
    model: legacy.model,
    reasoning: legacy.reasoning,
    sandbox: legacy.sandbox,
    status: 'active',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    archivedAt: null,
    ...overrides
  };
}

function readRequestBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') return {};
  return JSON.parse(init.body) as Record<string, unknown>;
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

function createEnterpriseSessionResponse(
  overrides: Partial<EnterpriseSessionResponse> = {}
): EnterpriseSessionResponse {
  return {
    status: 'signed_in',
    account: {
      subjectId: 'acct-member',
      email: 'member@example.com',
      name: 'Member'
    },
    transportSecurity: 'secure_https',
    ...overrides
  };
}

function createEnterpriseSkillListResponse(
  skills: EnterpriseSkillResponse[] = []
): EnterpriseSkillListResponse {
  return {
    skills,
    refreshedAt: new Date(0).toISOString()
  };
}

function createEnterpriseSkillResponse(
  overrides: Partial<EnterpriseSkillResponse> = {}
): EnterpriseSkillResponse {
  return {
    skillId: 'enterprise-skill',
    name: 'enterprise-name',
    description: 'Enterprise skill description',
    version: '1.0.0',
    status: 'not_installed',
    integrity: 'not_applicable',
    actions: ['install'],
    ...overrides
  };
}

function createKnowledgeBaseListResponse(
  knowledgeBases: EnterpriseKnowledgeBaseResponse[] = []
) {
  return {
    knowledgeBases,
    meta: { nextCursor: '', hasNext: false },
    refreshedAt: '2026-08-05T08:00:00.000Z'
  };
}

function createKnowledgeBaseResponse(
  overrides: Partial<EnterpriseKnowledgeBaseResponse> = {}
): EnterpriseKnowledgeBaseResponse {
  return {
    knowledgeBaseId: 'kb-product',
    name: '产品资料',
    description: '产品手册与发布流程',
    status: 'active',
    documentCount: 1,
    permissions: {
      read: true,
      upload: true,
      search: false
    },
    ...overrides
  };
}

function createKnowledgeDocumentListResponse(
  documents: EnterpriseKnowledgeDocumentResponse[] = []
) {
  return {
    documents,
    meta: { nextCursor: '', hasNext: false },
    refreshedAt: '2026-08-05T08:00:00.000Z'
  };
}

function createKnowledgeDocumentResponse(
  overrides: Partial<EnterpriseKnowledgeDocumentResponse> = {}
): EnterpriseKnowledgeDocumentResponse {
  return {
    documentId: 'doc-product',
    knowledgeBaseId: 'kb-product',
    name: '产品手册.pdf',
    sizeBytes: 1536,
    mimeType: 'application/pdf',
    status: 'ready',
    errorMessage: '',
    uploadedBy: 'member@example.com',
    createdAt: '2026-08-05T08:00:00.000Z',
    updatedAt: '2026-08-05T08:01:00.000Z',
    ...overrides
  };
}

function createSharedSpaceListResponse(
  spaces: EnterpriseSharedSpaceResponse[] = []
) {
  return {
    spaces,
    meta: {
      nextCursor: '',
      hasNext: false,
      maxFileSizeBytes: 1073741824
    },
    refreshedAt: '2026-08-06T08:00:00.000Z'
  };
}

function createSharedSpaceResponse(
  overrides: Partial<EnterpriseSharedSpaceResponse> = {}
): EnterpriseSharedSpaceResponse {
  return {
    spaceId: 'space-design',
    name: '设计资料',
    description: '团队设计文件',
    updatedAt: '2026-08-06T07:30:00Z',
    permissions: { read: true, write: false },
    ...overrides
  };
}

function createSharedFileListResponse(
  files: EnterpriseSharedFileResponse[] = []
) {
  return {
    files,
    meta: { nextCursor: '', hasNext: false },
    refreshedAt: '2026-08-06T08:00:00.000Z'
  };
}

function createSharedFileResponse(
  overrides: Partial<EnterpriseSharedFileResponse> = {}
): EnterpriseSharedFileResponse {
  return {
    fileId: 'file-design',
    spaceId: 'space-design',
    spaceName: '设计资料',
    logicalPath: 'docs/design.md',
    fileName: 'design.md',
    sizeBytes: 13,
    sha256: 'a'.repeat(64),
    contentType: 'text/markdown',
    revision: 3,
    updatedByUserId: 'usr_1',
    updatedByAgentId: 'agent_1',
    updatedAt: '2026-08-06T08:00:00Z',
    ...overrides
  };
}

function createKnowledgeRuntimeFetch(
  handleKnowledgeRequest: (
    url: string,
    init?: RequestInit
  ) => Response | undefined
) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const projectApiResponse = handleDefaultProjectApiRequest(url, init);
    if (projectApiResponse !== undefined) return projectApiResponse;
    if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
    if (url.endsWith('/codex/status')) {
      return jsonResponse(createCodexStatusResponse());
    }
    if (url.endsWith('/threads?status=active&limit=50')) {
      return jsonResponse({ threads: [] });
    }
    if (url.endsWith('/enterprise/session')) {
      return jsonResponse(createEnterpriseSessionResponse());
    }
    const response = handleKnowledgeRequest(url, init);
    if (response !== undefined) return response;
    throw new Error(`Unexpected request ${url}`);
  };
}

function getSkillMarketCard(skillId: string): HTMLElement {
  const card = document.querySelector(`[data-testid="skill-market-card"][data-skill-id="${skillId}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`Expected skill market card: ${skillId}`);
  return card;
}

async function showSkillMarketCard(
  user: ReturnType<typeof userEvent.setup>,
  skillId: string
): Promise<HTMLElement> {
  const search = screen.getByRole('searchbox', { name: '搜索技能' });
  await user.clear(search);
  await user.type(search, skillId);
  return waitFor(() => getSkillMarketCard(skillId));
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

function createCodexModelListResponse(): CodexModelListResponse {
  return {
    models: [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        description: 'Latest model',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Deep' },
          { reasoningEffort: 'xhigh', description: 'Deepest' }
        ],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text', 'image'],
        isDefault: true
      },
      {
        id: 'gpt-5.5',
        model: 'gpt-5.5',
        displayName: 'GPT-5.5',
        description: 'Previous model',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast' },
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'high', description: 'Deep' },
          { reasoningEffort: 'xhigh', description: 'Deepest' }
        ],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text', 'image'],
        isDefault: false
      }
    ]
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
    threadId: 'thread-schedule-1',
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
  const defaultProjectId = readTestRuntimeProjects().find(project => project.status === 'active')?.id ?? null;
  const thread: ThreadResponse = {
    id: 'thread_from_api',
    title: 'Thread from API',
    projectId: defaultProjectId,
    origin: 'opencreator_created',
    codexThreadId: null,
    cwd: '/Users/test/develop/content-design',
    canonicalCwd: '/Users/test/develop/content-design',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'read-only',
    status: 'active',
    purpose: 'conversation',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    archivedAt: null,
    ...overrides
  };
  if (overrides.projectId === undefined) {
    thread.projectId = thread.purpose === 'conversation'
      ? defaultProjectId
      : null;
  }
  return thread;
}

function persistProjects(cwd: string, ...additionalCwds: string[]): [OpenCreatorProject, ...OpenCreatorProject[]] {
  const projects: [OpenCreatorProject, ...OpenCreatorProject[]] = [
    createLegacyPersistedProject(cwd),
    ...additionalCwds.map(createLegacyPersistedProject)
  ];
  window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  return projects;
}

function createLegacyPersistedProject(cwd: string): OpenCreatorProject {
  const normalizedCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const name = normalizedCwd.split('/').filter(Boolean).at(-1) ?? 'project';
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalizedCwd.length; index += 1) {
    hash ^= normalizedCwd.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    id: `project-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')}-${(hash >>> 0).toString(36)}`,
    name,
    cwd: normalizedCwd,
    sandbox: 'follow-global',
    profile: 'default',
    model: null,
    reasoning: null
  };
}

function findPostCall(calls: Array<{ url: string; init?: RequestInit }>, path: string) {
  return calls.find(call => call.url.endsWith(path) && call.init?.method === 'POST');
}

function findPostCalls(calls: Array<{ url: string; init?: RequestInit }>, path: string) {
  return calls.filter(call => call.url.endsWith(path) && call.init?.method === 'POST');
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
