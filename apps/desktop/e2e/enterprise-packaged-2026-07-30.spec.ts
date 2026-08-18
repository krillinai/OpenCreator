import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  join,
  resolve
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@iarna/toml';
import {
  expect,
  test,
  type Page
} from '@playwright/test';
import { packagedExecutable } from './package-artifact.js';
import {
  closePackagedApp,
  launchPackagedApp,
  relaunchPackagedApp,
  type PackagedApp
} from './packaged-app.js';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const rootDir = resolve(desktopDir, '../..');
const fakeCodexScript = join(e2eDir, 'fixtures', 'fake-codex.mjs');
const enterpriseEmail = 'packaged-e2e@example.com';
const enterprisePassword = 'packaged-e2e-password';
const enterpriseAccountId = 'acct_packaged_e2e';
const enterpriseSkillName = 'enterprise-review';
const enterpriseKnowledgeBaseId = 'kb_packaged_e2e';
const enterpriseKeyringService = 'com.clawee.enterprise.e2e';
const enterpriseMcpKeyringService = 'com.clawee.enterprise.mcp.e2e';
const agentIdPattern =
  /^clawee_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test.describe.configure({ mode: 'serial' });

test.skip('legacy enterprise packaged workflow', async () => {
  const runId = randomUUID();
  const root = mkdtempSync(join(tmpdir(), 'clawee-enterprise-packaged-'));
  const codexHome = join(root, 'codex-home');
  const stateDir = join(root, 'fake-codex-state');
  const userData = join(root, 'user-data');
  const homeDir = join(root, 'home');
  const binDir = join(root, 'bin');
  const server = new FakeEnterpriseServer();
  let app: PackagedApp | undefined;
  let cleanupError: unknown;

  const codexBin = writeCodexShim(binDir);
  writeDesktopSettings(userData, codexBin);
  const origin = await server.start();
  writeEnterpriseClientConfig(homeDir, origin);

  try {
    app = await launchPackagedApp({
      executablePath: packagedExecutable(desktopDir),
      args: [
        `--user-data-dir=${userData}`,
        '--disable-gpu',
        `--clawee-enterprise-e2e=${runId}`,
        `--clawee-enterprise-e2e-config=${
          join(homeDir, '.clawee', 'config.toml')
        }`
      ],
      env: {
        ...withoutElectronRunAsNode(process.env),
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
        SHELL: process.platform === 'win32' ? process.env.ComSpec : '/bin/false',
        CLAWEE_DEFAULT_PROJECT_ROOT: join(root, 'Documents'),
        CODEX_HOME: codexHome,
        CLAWEE_E2E_FAKE_CODEX_STATE_DIR: stateDir,
        CLAWEE_E2E_FAKE_CODEX_MODE: 'success',
        CLAWEE_ENTERPRISE_E2E_RUN_ID: runId
      },
      timeoutMs: 45_000
    });

    await waitForWorkspace(app.page);
    await expect.poll(
      () => readEnterpriseSession(app!.page)
    ).toMatchObject({ status: 'signed_out' });
    expect(app.page.url()).toContain('clawee-app://app/');

    await app.page.evaluate(() => {
      window.location.hash = '#/account';
    });
    await expect(app.page.getByRole('heading', {
      name: '欢迎使用 Clawee'
    })).toBeVisible();
    await app.page.getByLabel('邮箱').fill(enterpriseEmail);
    await app.page.getByLabel('密码').fill(enterprisePassword);
    await app.page.getByRole('checkbox').check();
    await app.page.locator('.enterprise-email-submit').click();

    await expect(app.page.getByRole('button', {
      name: 'Packaged E2E',
      exact: true
    })).toBeVisible();
    await expect.poll(
      () => readEnterpriseSession(app!.page)
    ).toMatchObject({
      status: 'signed_in',
      collector: {
        status: 'installed'
      },
      account: {
        subjectId: enterpriseAccountId,
        email: enterpriseEmail,
        name: 'Packaged E2E'
      }
    });
    const persistedAgentId = readPersistedAgentId(homeDir);
    expect(persistedAgentId).toMatch(agentIdPattern);
    expect(server.agentIdentity()).toBe(persistedAgentId);

    const previous = app;
    await closePackagedApp(previous);
    app = await relaunchPackagedApp(previous, 45_000);
    await waitForWorkspace(app.page);

    await expect.poll(
      () => readEnterpriseSession(app!.page)
    ).toMatchObject({
      status: 'signed_in',
      collector: {
        status: 'installed'
      },
      account: {
        subjectId: enterpriseAccountId,
        email: enterpriseEmail,
        name: 'Packaged E2E'
      }
    });
    expect(readPersistedAgentId(homeDir)).toBe(persistedAgentId);
    expect(server.agentIdentity()).toBe(persistedAgentId);
    await expect(app.page.getByRole('button', {
      name: 'Packaged E2E',
      exact: true
    })).toBeVisible();

    await app.page.getByRole('button', { name: '添加上下文' }).click();
    await app.page.getByRole('menuitem', { name: '连接器' }).click();
    await expect(app.page.getByRole('menuitem', {
      name: /客户关系管理.*可安装/
    })).toBeVisible();
    await expect(app.page.getByRole('searchbox', {
      name: '搜索连接器'
    })).toBeVisible();
    await app.page.keyboard.press('Escape');
    await app.page.keyboard.press('Escape');

    await app.page.getByRole('button', {
      name: '连接器',
      exact: true
    }).click();
    await expect(app.page.getByRole('heading', {
      name: '连接器'
    })).toBeVisible();
    const mcpCard = app.page.locator(
      '[data-testid="mcp-card"][data-connection-key="enterprise:crm-main"]'
    );
    await expect(mcpCard.getByRole('heading', {
      name: '客户关系管理'
    })).toBeVisible();
    await expect(mcpCard.getByText('sales', { exact: true })).toBeVisible();
    await expect(mcpCard.getByText('按条件查询客户资料', { exact: true })).toBeVisible();
    await expect(mcpCard.getByText('服务正常')).toHaveCount(0);
    await mcpCard.getByRole('button', { name: '安装' }).click();
    const installedMcpCard = app.page.locator(
      '[data-testid="mcp-card"][data-connection-key^="native:enterprise_crm-main_"]'
    );
    const mcpSwitch = installedMcpCard.getByRole('switch', {
      name: '客户关系管理 MCP'
    });
    await expect(mcpSwitch).toHaveAttribute('aria-checked', 'false');
    await mcpSwitch.click();
    await expect(mcpSwitch).toHaveAttribute('aria-checked', 'true');
    const localMcpState = await app.page.evaluate(async () => {
      const response = await fetch('/.clawee/runtime/enterprise/mcp');
      return await response.json() as Record<string, unknown>;
    });
    expect(localMcpState).toMatchObject({
      tokenStatus: 'ready',
      upstreams: [{
        upstreamId: 'crm-main',
        installed: true,
        enabled: true
      }]
    });
    expect(JSON.stringify(localMcpState)).not.toMatch(/packaged-e2e-mcp-/);
    const persistedMcp = readPersistedMcpByEndpoint(
      codexHome,
      `${origin}/mcp/servers/crm-main`
    );
    expect(persistedMcp).toMatchObject({
      enabled: true,
      bearer_token_env_var: 'CLAWEE_ENTERPRISE_MCP_TOKEN'
    });
    expect(JSON.stringify(persistedMcp)).not.toMatch(/packaged-e2e-mcp-/);

    const mcpEnabled = app;
    await closePackagedApp(mcpEnabled);
    app = await relaunchPackagedApp(mcpEnabled, 45_000);
    await waitForWorkspace(app.page);
    await app.page.getByRole('button', {
      name: '连接器',
      exact: true
    }).click();
    const persistedMcpCard = app.page.locator(
      '[data-testid="mcp-card"][data-connection-key^="native:enterprise_crm-main_"]'
    );
    await expect(persistedMcpCard.getByRole('switch', {
      name: '客户关系管理 MCP'
    })).toHaveAttribute('aria-checked', 'true');

    await app.page.getByRole('button', { name: '新建任务' }).click();
    const enabledMcpIcon = app.page.getByRole('button', {
      name: '打开连接器列表，客户关系管理 MCP'
    });
    await expect(enabledMcpIcon).toBeVisible();
    await enabledMcpIcon.click();
    await expect(app.page.getByRole('switch', {
      name: '客户关系管理 MCP'
    })).toHaveAttribute('aria-checked', 'true');
    await expect(app.page.getByRole('button', {
      name: '选择更多连接器'
    })).toBeVisible();
    await app.page.keyboard.press('Escape');

    await app.page.getByRole('button', {
      name: '我的资产',
      exact: true
    }).click();
    await expect(app.page.getByRole('tab', {
      name: '知识库',
      selected: true
    })).toBeVisible();
    await expect(app.page.getByRole('heading', {
      name: '企业制度'
    })).toBeVisible();
    await expect(app.page.getByText('员工手册.pdf')).toBeVisible();
    await app.page.getByLabel('选择知识库文档').setInputFiles({
      name: '发布流程.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 发布流程')
    });
    await expect(app.page.getByText(
      '发布流程.md 已提交处理，请关注文档状态'
    )).toBeVisible();
    await expect(app.page.getByText('发布流程.md', { exact: true })).toBeVisible();

    await app.page.getByRole('button', {
      name: '插件中心',
      exact: true
    }).click();
    await expect(app.page.getByRole('tab', {
      name: '企业Skills',
      selected: true
    })).toBeVisible();
    const skillRow = app.page.getByTestId('enterprise-skill-skill_enterprise_review');
    await expect(skillRow).toBeVisible();
    await expect(skillRow).toHaveAttribute('data-status', 'not_installed');
    await skillRow.getByRole('button', { name: '安装', exact: true }).click();
    await expect(skillRow).toHaveAttribute('data-status', 'installed', {
      timeout: 30_000
    });

    const installedSkillPath = join(
      codexHome,
      'skills',
      enterpriseSkillName,
      'SKILL.md'
    );
    expect(existsSync(installedSkillPath)).toBe(true);
    expect(readFileSync(installedSkillPath, 'utf8')).toContain(
      `name: ${enterpriseSkillName}`
    );

    await skillRow.getByRole('button', { name: '使用', exact: true }).click();
    const useDialog = app.page.getByRole('dialog', { name: '选择使用项目' });
    await expect(useDialog).toBeVisible();
    await useDialog.getByRole('button', {
      name: '在 默认项目 中使用'
    }).click();
    await expect(app.page.getByLabel(
      `已选择 Skill ${enterpriseSkillName}`
    )).toBeVisible();
    await expect(app.page.getByRole('textbox', { name: '输入任务' }))
      .toHaveValue('');
    await expect.poll(() => app!.page.evaluate(() => window.location.hash))
      .toMatch(/^#\/thread\//);

    await app.page.getByRole('button', {
      name: 'Packaged E2E',
      exact: true
    }).click();
    await app.page.getByRole('button', { name: '退出登录' }).click();
    await expect.poll(
      () => readEnterpriseSession(app!.page)
    ).toMatchObject({ status: 'signed_out' });

    const loggedOut = app;
    await closePackagedApp(loggedOut);
    app = await relaunchPackagedApp(loggedOut, 45_000);
    await waitForWorkspace(app.page);
    await expect.poll(
      () => readEnterpriseSession(app!.page)
    ).toMatchObject({ status: 'signed_out' });

    const requests = server.requestLog();
    const login = requests.find(request => (
      request.method === 'POST'
      && request.path === '/api/v1/auth/login'
    ));
    expect(login).toMatchObject({
      bodyKeys: ['agent_id', 'client_id', 'email', 'password'],
      agentId: persistedAgentId,
      clientId: 'clawee-agent',
      cookiePresent: false
    });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/auth/me',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/app/skills',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/app/agents/token/reveal',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/app/agents/mcp-catalog',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/app/skills/detail',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/app/skills/package',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/app/knowledge-bases',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/app/knowledge-bases/documents',
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/app/knowledge-bases/documents',
        bodyKeys: ['knowledge_base_id', 'file'],
        authorizationPresent: true
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/api/v1/auth/logout',
        authorizationPresent: true
      })
    ]));
  } finally {
    if (app !== undefined) {
      await app.page.evaluate(async () => {
        await fetch('/.clawee/runtime/enterprise/logout', {
          method: 'POST'
        }).catch(() => undefined);
      }).catch(() => undefined);
      await closePackagedApp(app).catch(error => {
        cleanupError ??= error;
      });
    }
    await deleteE2ECredential(runId, enterpriseKeyringService).catch(() => {
      console.error(
        `企业 E2E Keyring 最佳努力清理失败：runId=${runId} `
        + `service=${enterpriseKeyringService} account=clawee-agent:${runId}`
      );
    });
    await deleteE2ECredential(runId, enterpriseMcpKeyringService).catch(() => {
      console.error(
        `企业 MCP E2E Keyring 最佳努力清理失败：runId=${runId} `
        + `service=${enterpriseMcpKeyringService} account=clawee-agent-mcp:${runId}`
      );
    });
    await server.close().catch(error => {
      cleanupError ??= error;
    });
    if (process.env.CLAWEE_E2E_KEEP_TEMP !== '1') {
      rmSync(root, { force: true, recursive: true });
    }
    if (cleanupError !== undefined) {
      console.error(
        `企业 E2E 清理失败：runId=${runId} `
        + `service=${enterpriseKeyringService} account=clawee-agent:${runId}`
      );
      throw cleanupError;
    }
  }
});

type EnterpriseRequestRecord = {
  method: string;
  path: string;
  bodyKeys: string[];
  agentId?: string;
  clientId?: string;
  authorizationPresent: boolean;
  cookiePresent: boolean;
};

class FakeEnterpriseServer {
  private server: Server | undefined;
  private readonly requests: EnterpriseRequestRecord[] = [];
  private readonly token = `packaged-e2e-${randomUUID()}`;
  private readonly mcpToken = `packaged-e2e-mcp-${randomUUID()}`;
  private agentId: string | undefined;
  private uploadedKnowledgeDocument = false;
  private readonly packageBytes = createZip([{
    name: 'SKILL.md',
    data: [
      '---',
      `name: ${enterpriseSkillName}`,
      'description: Review code with the enterprise workflow.',
      '---',
      '',
      '# Enterprise Review',
      '',
      'Review the requested code and report actionable findings.',
      ''
    ].join('\n')
  }]);
  private readonly packageSha256 = createHash('sha256')
    .update(this.packageBytes)
    .digest('hex');

  async start(): Promise<string> {
    if (this.server !== undefined) throw new Error('Fake enterprise server started twice');
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch(() => {
        sendJson(response, 500, {
          error: { code: 'fake_server_failed' }
        });
      });
    });
    await new Promise<void>((resolveStart, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolveStart());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Fake enterprise server did not expose a TCP address');
    }
    return `http://127.0.0.1:${address.port}`;
  }

  requestLog(): EnterpriseRequestRecord[] {
    return this.requests.map(request => ({
      ...request,
      bodyKeys: [...request.bodyKeys]
    }));
  }

  agentIdentity(): string | undefined {
    return this.agentId;
  }

  async close(): Promise<void> {
    const current = this.server;
    this.server = undefined;
    if (current === undefined) return;
    current.closeIdleConnections();
    current.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => {
      current.close(error => {
        if (error) reject(error);
        else resolveClose();
      });
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const requestBody = await readRequestBody(request);
    const body = requestBody.json;
    const bodyKeys = isRecord(body)
      ? Object.keys(body).sort()
      : requestBody.multipartFieldNames;
    this.requests.push({
      method: request.method ?? 'GET',
      path: url.pathname,
      bodyKeys,
      ...(isRecord(body) && typeof body.agent_id === 'string'
        ? { agentId: body.agent_id }
        : {}),
      ...(isRecord(body) && typeof body.client_id === 'string'
        ? { clientId: body.client_id }
        : {}),
      authorizationPresent:
        typeof request.headers.authorization === 'string',
      cookiePresent: request.headers.cookie !== undefined
    });

    if (
      url.pathname !== '/api/v1/auth/login'
      && request.headers.authorization !== `Bearer ${this.token}`
    ) {
      sendJson(response, 401, { error: { code: 'unauthorized' } });
      return;
    }

    if (
      request.method === 'POST'
      && url.pathname === '/api/v1/auth/login'
    ) {
      if (
        !isRecord(body)
        || body.email !== enterpriseEmail
        || body.password !== enterprisePassword
        || body.client_id !== 'clawee-agent'
        || typeof body.agent_id !== 'string'
        || !agentIdPattern.test(body.agent_id)
      ) {
        sendJson(response, 401, { error: { code: 'unauthorized' } });
        return;
      }
      this.agentId = body.agent_id;
      sendJson(response, 200, {
        data: {
          account: enterpriseAccount(),
          agent: enterpriseAgent(this.agentId),
          access_token: this.token,
          token_type: 'Bearer',
          expires_at: '2099-07-30T12:00:00.000Z'
        }
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      sendJson(response, 200, {
        data: {
          account: enterpriseAccount(),
          agent: enterpriseAgent(this.requireAgentId()),
          collector_registration: {
            exists: true,
            revoked: false,
            install_command: 'exit 0',
            install_powershell_command: 'exit 0'
          },
          applications: { frontend: true }
        }
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
      response.statusCode = 204;
      response.end();
      return;
    }

    if (
      request.method === 'POST'
      && url.pathname === '/api/v1/app/agents/token/reveal'
    ) {
      sendJson(response, 200, {
        data: {
          token_id: 'token_packaged_e2e',
          agent_id: this.requireAgentId(),
          token: this.mcpToken,
          token_type: 'Bearer',
          fingerprint: createHash('sha256')
            .update(this.mcpToken)
            .digest('hex'),
          status: 'active',
          expires_at: null,
          scopes: ['mcp:call'],
          created_at: '2026-08-07T08:00:00.000Z'
        }
      });
      return;
    }

    if (
      request.method === 'GET'
      && url.pathname === '/api/v1/app/agents/mcp-catalog'
    ) {
      sendJson(response, 200, {
        data: {
          agent_id: this.requireAgentId(),
          upstreams: [{
            id: 'crm-main',
            name: '客户关系管理',
            domain: 'sales',
            mcp_endpoint:
              `http://${request.headers.host ?? '127.0.0.1'}/mcp/servers/crm-main`,
            upstream_transport: 'streamable_http',
            namespace: 'crm',
            status: 'active',
            tools: [{
              id: 'cap_customer_search',
              upstream_name: 'customer.search',
              name: 'customer.search',
              exposed_name: 'crm.customer.search',
              title: '查询客户',
              description: '按条件查询客户资料',
              risk_level: 'low',
              confirm_required: false,
              status: 'active',
              authorized: true,
              authorization_expires_at: null
            }, {
              id: 'cap_customer_update',
              upstream_name: 'customer.update',
              name: 'customer.update',
              exposed_name: 'crm.customer.update',
              title: '更新客户',
              description: '更新客户资料',
              risk_level: 'medium',
              confirm_required: true,
              status: 'active',
              authorized: false,
              authorization_expires_at: null
            }]
          }]
        }
      });
      return;
    }

    if (
      request.method === 'GET'
      && url.pathname === '/api/v1/app/knowledge-bases'
    ) {
      sendJson(response, 200, {
        data: [this.remoteKnowledgeBase()],
        meta: { next_cursor: '', has_next: false }
      });
      return;
    }

    if (
      request.method === 'GET'
      && url.pathname === '/api/v1/app/knowledge-bases/documents'
      && url.searchParams.get('knowledge_base_id') === enterpriseKnowledgeBaseId
    ) {
      sendJson(response, 200, {
        data: [
          this.remoteKnowledgeDocument(),
          ...(this.uploadedKnowledgeDocument
            ? [this.remoteUploadedKnowledgeDocument()]
            : [])
        ],
        meta: { next_cursor: '', has_next: false }
      });
      return;
    }

    if (
      request.method === 'POST'
      && url.pathname === '/api/v1/app/knowledge-bases/documents'
    ) {
      if (
        requestBody.multipartFieldNames.join(',') !== 'knowledge_base_id,file'
        || !requestBody.raw.includes(Buffer.from(enterpriseKnowledgeBaseId))
        || !requestBody.raw.includes(Buffer.from('发布流程.md'))
      ) {
        sendJson(response, 400, {
          error: { code: 'invalid_knowledge_upload' }
        });
        return;
      }
      this.uploadedKnowledgeDocument = true;
      sendJson(response, 201, {
        data: this.remoteUploadedKnowledgeDocument()
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/app/skills') {
      sendJson(response, 200, { data: [this.remoteSkill()] });
      return;
    }

    if (
      request.method === 'GET'
      && url.pathname === '/api/v1/app/skills/detail'
      && url.searchParams.get('skill_id') === 'skill_enterprise_review'
    ) {
      sendJson(response, 200, {
        data: {
          ...this.remoteSkill(),
          changelog: 'Initial packaged E2E release.'
        }
      });
      return;
    }

    if (
      request.method === 'GET'
      && url.pathname === '/api/v1/app/skills/package'
      && url.searchParams.get('skill_id') === 'skill_enterprise_review'
      && url.searchParams.get('version_id') === 'version_1'
    ) {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/zip');
      response.setHeader('Content-Length', String(this.packageBytes.byteLength));
      response.end(this.packageBytes);
      return;
    }

    sendJson(response, 404, { error: { code: 'not_found' } });
  }

  private remoteSkill() {
    return {
      skill_id: 'skill_enterprise_review',
      name: enterpriseSkillName,
      description: 'Enterprise review workflow',
      version_id: 'version_1',
      version: '1.0.0',
      package_sha256: this.packageSha256,
      updated_at: '2026-07-30T12:00:00.000Z'
    };
  }

  private remoteKnowledgeBase() {
    return {
      knowledge_base_id: enterpriseKnowledgeBaseId,
      name: '企业制度',
      description: '公司制度和员工手册',
      status: 'active',
      document_count: this.uploadedKnowledgeDocument ? 2 : 1,
      permissions: {
        read: true,
        upload: true,
        search: false
      }
    };
  }

  private remoteKnowledgeDocument() {
    return {
      document_id: 'doc_packaged_handbook',
      knowledge_base_id: enterpriseKnowledgeBaseId,
      name: '员工手册.pdf',
      size_bytes: 102400,
      mime_type: 'application/pdf',
      status: 'ready',
      error_message: '',
      uploaded_by: enterpriseEmail,
      created_at: '2026-08-04T08:00:00.000Z',
      updated_at: '2026-08-04T08:01:00.000Z'
    };
  }

  private remoteUploadedKnowledgeDocument() {
    return {
      document_id: 'doc_packaged_release',
      knowledge_base_id: enterpriseKnowledgeBaseId,
      name: '发布流程.md',
      size_bytes: Buffer.byteLength('# 发布流程'),
      mime_type: 'text/markdown',
      status: 'processing',
      error_message: '',
      uploaded_by: enterpriseEmail,
      created_at: '2026-08-05T08:00:00.000Z',
      updated_at: '2026-08-05T08:00:00.000Z'
    };
  }

  private requireAgentId(): string {
    if (this.agentId === undefined) {
      throw new Error('Fake enterprise session has no agent identity');
    }
    return this.agentId;
  }
}

async function waitForWorkspace(page: Page): Promise<void> {
  await page.waitForURL(url => (
    url.protocol === 'clawee-app:' && url.hostname === 'app'
  ), { timeout: 45_000 });
  await expect.poll(async () => await page.evaluate(async () => (
    await window.claweeDesktop?.readBootstrapState()
  )?.phase), { timeout: 30_000 }).toBe('ready');
}

async function readEnterpriseSession(page: Page): Promise<Record<string, unknown>> {
  return await page.evaluate(async () => {
    const response = await fetch('/.clawee/runtime/enterprise/session');
    return await response.json() as Record<string, unknown>;
  });
}

function writeCodexShim(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'codex.cmd')
    : join(binDir, 'codex');
  writeFileSync(
    scriptPath,
    process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${fakeCodexScript}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`
  );
  if (process.platform !== 'win32') chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeDesktopSettings(userData: string, codexBin: string): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'desktop-settings.json'),
    `${JSON.stringify({
      closeBehavior: 'quit',
      notificationsEnabled: false,
      codexBin,
      successfulCodexBin: codexBin
    }, null, 2)}\n`
  );
}

function withoutElectronRunAsNode(
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.CLAWEE_UPDATE_URL;
  delete next.CLAWEE_ENTERPRISE_E2E_AUTHORIZED;
  delete next.CLAWEE_ENTERPRISE_KEYRING_SERVICE;
  delete next.CLAWEE_ENTERPRISE_KEYRING_ACCOUNT;
  return next;
}

function writeEnterpriseClientConfig(
  homeDir: string,
  gateway: string
): void {
  const claweeHome = join(homeDir, '.clawee');
  mkdirSync(claweeHome, { recursive: true });
  writeFileSync(
    join(claweeHome, 'config.toml'),
    `gateway = ${JSON.stringify(gateway)}\n`
  );
}

async function deleteE2ECredential(
  runId: string,
  service: string
): Promise<void> {
  const entry = createKeyringEntry(runId, service);
  await Promise.race([
    entry.deletePassword().catch(() => undefined),
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Keyring cleanup timed out'));
      }, 3_000);
      timeout.unref();
    })
  ]);
}

function createKeyringEntry(runId: string, service: string): {
  deletePassword(): Promise<unknown>;
} {
  const requireFromDaemon = createRequire(
    join(rootDir, 'apps', 'daemon', 'package.json')
  );
  const keyring = requireFromDaemon('@napi-rs/keyring') as {
    AsyncEntry: new (
      service: string,
      account: string
    ) => {
      deletePassword(): Promise<unknown>;
    };
  };
  return new keyring.AsyncEntry(
    service,
    service === enterpriseMcpKeyringService
      ? `clawee-agent-mcp:${runId}`
      : `clawee-agent:${runId}`
  );
}

async function readRequestBody(request: IncomingMessage): Promise<{
  raw: Buffer;
  json?: unknown;
  multipartFieldNames: string[];
}> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 1024 * 1024) throw new Error('Fake request body too large');
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks);
  const contentType = request.headers['content-type'] ?? '';
  if (raw.length === 0) {
    return { raw, multipartFieldNames: [] };
  }
  if (contentType.startsWith('application/json')) {
    return {
      raw,
      json: JSON.parse(raw.toString('utf8')) as unknown,
      multipartFieldNames: []
    };
  }
  if (contentType.startsWith('multipart/form-data')) {
    return {
      raw,
      multipartFieldNames: Array.from(
        raw.toString('utf8').matchAll(
          /content-disposition:\s*form-data;\s*name="([^"]+)"/gi
        ),
        match => match[1]!
      )
    };
  }
  return { raw, multipartFieldNames: [] };
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown
): void {
  const contents = Buffer.from(JSON.stringify(body));
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Content-Length', String(contents.byteLength));
  response.end(contents);
}

function enterpriseAccount() {
  return {
    account_id: enterpriseAccountId,
    email: enterpriseEmail,
    name: 'Packaged E2E',
    status: 'active'
  };
}

function enterpriseAgent(agentId: string) {
  return {
    agent_id: agentId,
    name: 'Packaged E2E'
  };
}

function readPersistedAgentId(homeDir: string): string {
  const path = join(homeDir, '.clawee', 'config.toml');
  const value: unknown = parse(readFileSync(path, 'utf8'));
  if (
    !isRecord(value)
    || typeof value.agent_id !== 'string'
  ) {
    throw new Error(`Invalid persisted enterprise agent identity: ${path}`);
  }
  return value.agent_id;
}

function readPersistedMcpByEndpoint(
  codexHome: string,
  endpoint: string
): Record<string, unknown> {
  const path = join(codexHome, 'config.toml');
  const value: unknown = parse(readFileSync(path, 'utf8'));
  if (!isRecord(value) || !isRecord(value.mcp_servers)) {
    throw new Error('Codex config does not contain MCP servers');
  }
  const server = Object.values(value.mcp_servers)
    .find(candidate => isRecord(candidate) && candidate.url === endpoint);
  if (!isRecord(server)) {
    throw new Error(`Codex config does not contain MCP endpoint: ${endpoint}`);
  }
  return server;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ZipEntryInput = {
  name: string;
  data: string;
};

function createZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data, 'utf8');
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
