import type {
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleResponse
} from '@clawee/protocol';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentCapabilityTokenError,
  createAgentCapabilityTokenStore,
  type AgentCapabilityTokenStore
} from '../../src/agent-tools/capability-token.js';
import {
  createDefaultAgentScheduleOperations,
  type AgentScheduleActor,
  type AgentScheduleOperations
} from '../../src/agent-tools/internal-routes.js';
import { buildServer } from '../../src/api/server.js';
import { createProjectManager } from '../../src/projects/manager.js';
import { createRunManager } from '../../src/runs/manager.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadManager } from '../../src/threads/manager.js';
import type { RuntimeThread } from '../../src/threads/types.js';
import { createFakeCodex } from '../helpers/fake-codex.js';

let server: FastifyInstance | undefined;
let runManager: ReturnType<typeof createRunManager> | undefined;
let db: Database.Database | undefined;
let tempDir = '';
const RUN_STATUS_TIMEOUT_MS = 5_000;

afterEach(async () => {
  await server?.close();
  server = undefined;
  await runManager?.close();
  runManager = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('agent tool internal api', () => {
  it('binds draft creation to the actor thread and ignores forged execution configuration', async () => {
    const fixture = await createRealServerFixture();
    const draft = fixture.threadManager.createThread({
      purpose: 'schedule_draft',
      title: '任务草稿',
      cwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'read-only'
    });
    const token = fixture.tokens.issue({
      runId: 'run-draft-create',
      threadId: draft.id,
      createdBy: 'api',
      scopes: ['schedule:create']
    }).token;

    const response = await capabilityRequest(
      'POST',
      '/internal/agent-tools/schedules',
      token,
      {
        name: '每日总结',
        cron: '0 18 * * *',
        timezone: 'Asia/Shanghai',
        prompt: '总结当天进展',
        cwd: join(tempDir, 'forged'),
        profile: 'forged-profile',
        model: 'forged-model',
        reasoning: 'low',
        sandbox: 'danger-full-access'
      }
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      threadId: draft.id,
      cwd: draft.cwd,
      canonicalCwd: draft.canonicalCwd,
      profile: draft.profile,
      model: draft.model,
      reasoning: draft.reasoning,
      sandbox: draft.sandbox
    });
    expect(fixture.threadManager.getThread(draft.id)).toMatchObject({
      purpose: 'schedule_task',
      scheduleId: response.json().id,
      title: '每日总结'
    });
    expect(readLatestScheduleOperation()).toMatchObject({
      operation: 'create',
      run_id: null,
      actor_type: 'agent',
      actor_run_id: 'run-draft-create'
    });
  });

  it('passes the capability actor into the default run-now operation', async () => {
    const runNow = vi.fn(() => ({
      run: null,
      schedule: schedule({ id: 'schedule-1', threadId: 'thread-1' }),
      skipped: false,
      queued: false
    }));
    const operations = createDefaultAgentScheduleOperations({
      coordinator: {} as never,
      scheduler: { runNow } as never,
      threadManager: { getThread: vi.fn() }
    });
    const actor: AgentScheduleActor = {
      runId: 'run-editor',
      threadId: 'thread-1',
      createdBy: 'api'
    };

    await operations.runScheduleNow('schedule-1', actor);

    expect(runNow).toHaveBeenCalledWith('schedule-1', {
      type: 'agent',
      runId: 'run-editor'
    });
  });

  it('creates a dedicated inherited task thread from a conversation', async () => {
    const fixture = await createRealServerFixture();
    const conversation = fixture.threadManager.createConversationThread({
      projectId: fixture.projectId,
      title: '普通会话',
      profile: 'default',
      model: 'gpt-5',
      reasoning: 'medium',
      sandbox: 'workspace-write'
    });
    const token = fixture.tokens.issue({
      runId: 'run-conversation-create',
      threadId: conversation.id,
      createdBy: 'api',
      scopes: ['schedule:create']
    }).token;

    const response = await capabilityRequest(
      'POST',
      '/internal/agent-tools/schedules',
      token,
      {
        name: '每周复盘',
        cron: '0 17 * * 5',
        timezone: 'Asia/Shanghai',
        prompt: '复盘本周工作'
      }
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().threadId).not.toBe(conversation.id);
    expect(fixture.threadManager.getThread(conversation.id)?.purpose).toBe('conversation');
    expect(fixture.threadManager.getThread(response.json().threadId)).toMatchObject({
      purpose: 'schedule_task',
      cwd: conversation.cwd,
      canonicalCwd: conversation.canonicalCwd,
      profile: conversation.profile,
      model: conversation.model,
      reasoning: conversation.reasoning,
      sandbox: conversation.sandbox
    });
  });

  it('resolves current task bindings and returns same-project candidates without guessing', async () => {
    const fixture = await createRealServerFixture();
    const conversation = fixture.threadManager.createConversationThread({
      projectId: fixture.projectId,
      profile: 'default',
      sandbox: 'workspace-write'
    });
    const first = await createPublicSchedule('每日总结', tempDir);
    const second = await createPublicSchedule('每周复盘', tempDir);
    const otherProject = join(tempDir, 'other-project');
    mkdirSync(otherProject);
    const third = await createPublicSchedule('其他项目任务', otherProject);
    const conversationToken = fixture.tokens.issue({
      runId: 'run-select',
      threadId: conversation.id,
      createdBy: 'api',
      scopes: ['schedule:update']
    }).token;

    const ambiguous = await capabilityRequest(
      'PATCH',
      '/internal/agent-tools/schedules/current',
      conversationToken,
      { name: '不能猜测' }
    );

    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json()).toEqual({
      error: {
        code: 'SCHEDULE_SELECTION_REQUIRED',
        message: 'Multiple schedules are available'
      },
      candidates: expect.arrayContaining([
        expect.objectContaining({ scheduleId: first.id, name: '每日总结' }),
        expect.objectContaining({ scheduleId: second.id, name: '每周复盘' })
      ])
    });
    expect(ambiguous.json().candidates).toHaveLength(2);

    const explicit = await capabilityRequest(
      'PATCH',
      `/internal/agent-tools/schedules/${first.id}`,
      conversationToken,
      { name: '已明确选择' }
    );
    expect(explicit.statusCode).toBe(200);
    expect(explicit.json().name).toBe('已明确选择');

    const crossProject = await capabilityRequest(
      'PATCH',
      `/internal/agent-tools/schedules/${third.id}`,
      conversationToken,
      { name: '越权更新' }
    );
    expect(crossProject.statusCode).toBe(403);

    const otherProjectRecord = fixture.projectManager.createProject({
      cwd: otherProject,
      profile: 'default',
      sandbox: 'workspace-write'
    });
    const otherConversation = fixture.threadManager.createConversationThread({
      projectId: otherProjectRecord.id
    });
    const singleCandidateToken = fixture.tokens.issue({
      runId: 'run-single-candidate',
      threadId: otherConversation.id,
      createdBy: 'api',
      scopes: ['schedule:update']
    }).token;
    const singleCandidate = await capabilityRequest(
      'PATCH',
      '/internal/agent-tools/schedules/current',
      singleCandidateToken,
      { name: '唯一候选任务' }
    );
    expect(singleCandidate.statusCode).toBe(200);
    expect(singleCandidate.json()).toMatchObject({
      id: third.id,
      name: '唯一候选任务'
    });

    const taskToken = fixture.tokens.issue({
      runId: 'run-task-current',
      threadId: first.threadId,
      createdBy: 'api',
      scopes: ['schedule:update']
    }).token;
    const currentTask = await capabilityRequest(
      'PATCH',
      '/internal/agent-tools/schedules/current',
      taskToken,
      { name: '任务会话更新' }
    );
    expect(currentTask.statusCode).toBe(200);
    expect(currentTask.json()).toMatchObject({
      id: first.id,
      threadId: first.threadId,
      name: '任务会话更新'
    });
  });

  it('uses capability auth without falling back to the public bearer token', async () => {
    const fixture = await createServerFixture();
    const token = fixture.tokens.issue({
      runId: 'run-1',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    }).token;
    const wrongScope = fixture.tokens.issue({
      runId: 'run-2',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:update']
    }).token;

    const missing = await server!.inject({
      method: 'GET',
      url: '/internal/agent-tools/schedules/schedule-1'
    });
    const publicBearer = await server!.inject({
      method: 'GET',
      url: '/internal/agent-tools/schedules/schedule-1',
      headers: { authorization: 'Bearer public-secret' }
    });
    const forbiddenScope = await capabilityGet(
      '/internal/agent-tools/schedules/schedule-1',
      wrongScope
    );
    const crossThread = await capabilityGet(
      '/internal/agent-tools/schedules/schedule-2',
      token
    );
    const allowed = await capabilityGet(
      '/internal/agent-tools/schedules/schedule-1',
      token
    );

    expect(missing.statusCode).toBe(401);
    expect(publicBearer.statusCode).toBe(401);
    expect(forbiddenScope.statusCode).toBe(403);
    expect(crossThread.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      id: 'schedule-1',
      threadId: 'thread-1'
    });
    expect([
      missing.body,
      publicBearer.body,
      forbiddenScope.body,
      crossThread.body
    ].join('\n')).not.toContain(token);
  });

  it('rejects mutation routes for automatic schedule runs even with a forged scope grant', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-agent-tool-automatic-'));
    const operations = createOperations();
    const automaticGrantStore = {
      issue: vi.fn(() => ({
        token: 'clwcap_automatic',
        expiresAt: '2026-07-14T00:05:00.000Z'
      })),
      issueProcess: vi.fn(() => {
        throw new Error('not used by this test');
      }),
      authorize: vi.fn(() => ({
        runId: 'run-automatic',
        threadId: 'thread-1',
        createdBy: 'schedule' as const,
        scopes: ['schedule:update' as const],
        issuedAt: '2026-07-14T00:00:00.000Z',
        expiresAt: '2026-07-14T00:05:00.000Z'
      })),
      inspect: vi.fn(() => ({
        runId: 'run-automatic',
        threadId: 'thread-1',
        createdBy: 'schedule' as const,
        scopes: ['schedule:update' as const],
        issuedAt: '2026-07-14T00:00:00.000Z',
        expiresAt: '2026-07-14T00:05:00.000Z'
      })),
      revokeRun: vi.fn(() => 0),
      cleanupExpired: vi.fn(() => 0),
      close: vi.fn()
    } satisfies AgentCapabilityTokenStore;
    server = await buildServer({
      token: 'public-secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      agentCapabilityTokens: automaticGrantStore,
      agentScheduleOperations: operations
    });

    const response = await capabilityRequest(
      'PATCH',
      '/internal/agent-tools/schedules/schedule-1',
      'clwcap_automatic',
      { name: '自动任务越权更新' }
    );

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: {
        code: 'CAPABILITY_SCOPE_FORBIDDEN',
        message: 'Automatic schedule runs cannot mutate schedules'
      }
    });
    expect(operations.updateSchedule).not.toHaveBeenCalled();
  });

  it('passes the token actor to scoped operations and rejects identity overrides', async () => {
    const fixture = await createServerFixture();
    const token = fixture.tokens.issue({
      runId: 'run-editor',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: [
        'schedule:create',
        'schedule:update',
        'schedule:pause',
        'schedule:resume',
        'schedule:run_now'
      ]
    }).token;

    const override = await capabilityRequest(
      'PATCH',
      '/internal/agent-tools/schedules/schedule-1',
      token,
      { name: '伪造更新', threadId: 'thread-2' }
    );
    expect(override.statusCode).toBe(400);
    expect(fixture.operations.updateSchedule).not.toHaveBeenCalled();

    expect((await capabilityRequest(
      'PATCH',
      '/internal/agent-tools/schedules/schedule-1',
      token,
      { name: '更新后的任务' }
    )).statusCode).toBe(200);
    expect((await capabilityRequest(
      'POST',
      '/internal/agent-tools/schedules/schedule-1/pause',
      token,
      {}
    )).statusCode).toBe(200);
    expect((await capabilityRequest(
      'POST',
      '/internal/agent-tools/schedules/schedule-1/resume',
      token,
      {}
    )).statusCode).toBe(200);
    expect((await capabilityRequest(
      'POST',
      '/internal/agent-tools/schedules/schedule-1/run-now',
      token,
      {}
    )).statusCode).toBe(202);
    expect((await capabilityRequest(
      'POST',
      '/internal/agent-tools/schedules',
      token,
      { name: '新任务' }
    )).statusCode).toBe(201);

    const actor: AgentScheduleActor = {
      runId: 'run-editor',
      threadId: 'thread-1',
      createdBy: 'api'
    };
    expect(fixture.operations.updateSchedule).toHaveBeenCalledWith(
      'schedule-1',
      { name: '更新后的任务' },
      actor
    );
    expect(fixture.operations.pauseSchedule).toHaveBeenCalledWith('schedule-1', actor);
    expect(fixture.operations.resumeSchedule).toHaveBeenCalledWith('schedule-1', actor);
    expect(fixture.operations.runScheduleNow).toHaveBeenCalledWith('schedule-1', actor);
    expect(fixture.operations.createSchedule).toHaveBeenCalledWith({ name: '新任务' }, actor);
  });

  it('revokes a run capability when the run reaches a terminal state', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-agent-capability-run-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const tokens = createAgentCapabilityTokenStore();
    const projectManager = createProjectManager({ db, homeDir: tempDir });
    const project = projectManager.createProject({
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    const threadManager = createThreadManager({
      db,
      dataDir: tempDir,
      projectManager
    });
    const thread = threadManager.createConversationThread({
      projectId: project.id
    });
    const fakeCodex = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.completed' }
      ],
      delayMs: 100
    });
    runManager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fakeCodex.bin,
      codexHome: join(tempDir, 'codex-home'),
      threadAccess: threadManager,
      resumeCapabilityVerified: true,
      onRunTerminal: runId => tokens.revokeRun(runId)
    });

    const run = runManager.startRun({
      threadId: thread.id,
      prompt: '完成任务'
    });
    const token = tokens.issue({
      runId: run.id,
      threadId: thread.id,
      createdBy: 'api',
      scopes: ['schedule:get']
    }).token;
    expect(tokens.authorize(token, { scope: 'schedule:get' }).runId).toBe(run.id);

    await expect
      .poll(
        () => runManager?.getRun(run.id)?.status,
        { timeout: RUN_STATUS_TIMEOUT_MS }
      )
      .toBe('succeeded');
    expectCapabilityError(
      () => tokens.authorize(token, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_REVOKED'
    );

    tokens.close();
  });

  it('revokes a run capability when an active run is canceled', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-agent-capability-cancel-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const tokens = createAgentCapabilityTokenStore();
    const projectManager = createProjectManager({ db, homeDir: tempDir });
    const project = projectManager.createProject({
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    const threadManager = createThreadManager({
      db,
      dataDir: tempDir,
      projectManager
    });
    const thread = threadManager.createConversationThread({
      projectId: project.id
    });
    const fakeCodex = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'thread.started', thread_id: 'codex-thread-cancel' }],
      hang: true
    });
    runManager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fakeCodex.bin,
      codexHome: join(tempDir, 'codex-home'),
      threadAccess: threadManager,
      resumeCapabilityVerified: true,
      onRunTerminal: runId => tokens.revokeRun(runId)
    });

    const run = runManager.startRun({
      threadId: thread.id,
      prompt: '等待取消'
    });
    const token = tokens.issue({
      runId: run.id,
      threadId: thread.id,
      createdBy: 'api',
      scopes: ['schedule:get']
    }).token;
    await expect
      .poll(
        () => runManager?.getRun(run.id)?.status,
        { timeout: RUN_STATUS_TIMEOUT_MS }
      )
      .toBe('running');

    expect(runManager.cancelRun(run.id)).toBe(true);
    await expect
      .poll(
        () => runManager?.getRun(run.id)?.status,
        { timeout: RUN_STATUS_TIMEOUT_MS }
      )
      .toBe('canceled');
    expectCapabilityError(
      () => tokens.authorize(token, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_REVOKED'
    );

    tokens.close();
  });

  it('clears every capability when the daemon closes', async () => {
    const fixture = await createServerFixture();
    const token = fixture.tokens.issue({
      runId: 'run-close',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    }).token;

    await server!.close();
    server = undefined;

    expectCapabilityError(
      () => fixture.tokens.authorize(token, { scope: 'schedule:get' }),
      'CAPABILITY_TOKEN_INVALID'
    );
  });

  it('injects the listening daemon origin into production Run child environments', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-agent-tool-listen-'));
    const fakeCodex = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-agent-tools' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'public-secret',
      dataDir: tempDir,
      codexBin: fakeCodex.bin,
      codexHome: join(tempDir, 'codex-home'),
      resumeCapabilityVerified: true,
      agentToolsEnabled: true
    });
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address() as AddressInfo;
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: 'Bearer public-secret' },
      payload: {
        cwd: tempDir,
        profile: 'default',
        sandbox: 'read-only'
      }
    });
    expect(projectResponse.statusCode).toBe(201);
    const threadResponse = await server.inject({
      method: 'POST',
      url: '/threads',
      headers: { authorization: 'Bearer public-secret' },
      payload: {
        projectId: projectResponse.json().project.id
      }
    });
    expect(threadResponse.statusCode).toBe(201);
    const threadId = threadResponse.json().thread.id as string;
    const runResponse = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer public-secret' },
      payload: {
        threadId,
        prompt: '创建每日总结任务'
      }
    });
    const runId = runResponse.json().id as string;

    await expect.poll(async () => {
      const response = await server!.inject({
        method: 'GET',
        url: `/runs/${runId}`,
        headers: { authorization: 'Bearer public-secret' }
      });
      return response.json().status as string;
    }, { timeout: RUN_STATUS_TIMEOUT_MS }).toBe('succeeded');

    expect(fakeCodex.readAgentToolEnv()).toMatchObject({
      CLAWEE_AGENT_CAPABILITY_TOKEN: expect.stringMatching(/^clwcap_/),
      NO_PROXY: expect.stringContaining('127.0.0.1'),
      no_proxy: expect.stringContaining('127.0.0.1')
    });
    expect(fakeCodex.readArgv()).toEqual(expect.arrayContaining([
      '-c',
      `mcp_servers.clawee_schedule.url="http://127.0.0.1:${address.port}/internal/agent-tools/mcp"`,
      '-c',
      'mcp_servers.clawee_schedule.bearer_token_env_var="CLAWEE_AGENT_CAPABILITY_TOKEN"'
    ]));
  });

  it('serves authenticated schedule tools over streamable HTTP', async () => {
    const fixture = await createServerFixture();
    const address = await server!.listen({ host: '127.0.0.1', port: 0 });
    const token = fixture.tokens.issue({
      runId: 'run-mcp-http',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:get']
    }).token;
    const endpoint = new URL('/internal/agent-tools/mcp', address);

    const unauthorized = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'unauthorized-test', version: '1.0.0' }
        }
      })
    });
    expect(unauthorized.status).toBe(401);

    const client = new Client({
      name: 'clawee-http-test',
      version: '1.0.0'
    });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: { authorization: `Bearer ${token}` }
      }
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map(tool => tool.name)).toEqual([
        'clawee_schedule_get'
      ]);

      const result = await client.callTool({
        name: 'clawee_schedule_get',
        arguments: { scheduleId: 'schedule-1' }
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        scheduleId: 'schedule-1',
        threadId: 'thread-1',
        name: '每日总结'
      });
      expect(fixture.operations.getSchedule).toHaveBeenCalledWith(
        'schedule-1',
        expect.objectContaining({
          runId: 'run-mcp-http',
          threadId: 'thread-1'
        })
      );
    } finally {
      await client.close();
    }
  });

  it('rejects an inactive process token and exposes only its active grant tools', async () => {
    const fixture = await createServerFixture();
    const address = await server!.listen({ host: '127.0.0.1', port: 0 });
    const lease = fixture.tokens.issueProcess({
      createdBy: 'api',
      maxScopes: ['schedule:get', 'schedule:update']
    });
    const endpoint = new URL('/internal/agent-tools/mcp', address);
    const initializeBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'process-token-test', version: '1.0.0' }
      }
    });

    const inactive = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${lease.token}`,
        'content-type': 'application/json'
      },
      body: initializeBody
    });
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toMatchObject({
      error: { code: 'CAPABILITY_CONTEXT_INACTIVE' }
    });

    lease.activate({
      runId: 'run-process',
      threadId: 'thread-1',
      createdBy: 'api',
      scopes: ['schedule:update']
    });
    const client = new Client({
      name: 'clawee-process-http-test',
      version: '1.0.0'
    });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: { authorization: `Bearer ${lease.token}` }
      }
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map(tool => tool.name)).toEqual([
        'clawee_schedule_update'
      ]);
    } finally {
      await client.close();
    }

    expect(lease.deactivate('run-process')).toBe(true);
    const inactiveAgain = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${lease.token}`,
        'content-type': 'application/json'
      },
      body: initializeBody
    });
    expect(inactiveAgain.status).toBe(403);
  });
});

async function createServerFixture(): Promise<{
  tokens: AgentCapabilityTokenStore;
  operations: ReturnType<typeof createOperations>;
}> {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-agent-tool-api-'));
  const tokens = createAgentCapabilityTokenStore();
  const operations = createOperations();
  server = await buildServer({
    token: 'public-secret',
    dataDir: tempDir,
    codexHome: join(tempDir, 'codex-home'),
    agentCapabilityTokens: tokens,
    agentScheduleOperations: operations,
    agentToolsEnabled: true
  });
  return { tokens, operations };
}

function createOperations() {
  const schedules = new Map([
    ['schedule-1', scheduleDetail({ id: 'schedule-1', threadId: 'thread-1' })],
    ['schedule-2', scheduleDetail({ id: 'schedule-2', threadId: 'thread-2' })]
  ]);
  const threads = new Map<string, RuntimeThread>([
    ['thread-1', runtimeThread({ id: 'thread-1', scheduleId: 'schedule-1' })],
    ['thread-2', runtimeThread({ id: 'thread-2', scheduleId: 'schedule-2' })]
  ]);
  return {
    getActorThread: vi.fn((actor: AgentScheduleActor) => threads.get(actor.threadId)),
    listSchedules: vi.fn(() => [...schedules.values()]),
    getSchedule: vi.fn((id: string) => schedules.get(id)),
    createSchedule: vi.fn(async (_input: unknown, actor: AgentScheduleActor) => (
      schedule({ id: 'schedule-created', threadId: actor.threadId })
    )),
    updateSchedule: vi.fn(async (id: string, input: unknown) => (
      schedule({ ...schedules.get(id), ...(input as object) })
    )),
    pauseSchedule: vi.fn(async (id: string) => (
      schedule({ ...schedules.get(id), enabled: false })
    )),
    resumeSchedule: vi.fn(async (id: string) => (
      schedule({ ...schedules.get(id), enabled: true })
    )),
    runScheduleNow: vi.fn(async (id: string): Promise<RunScheduleNowResponse> => ({
      run: null,
      schedule: schedule(schedules.get(id)),
      skipped: false,
      queued: true
    }))
  } satisfies AgentScheduleOperations;
}

async function createRealServerFixture(): Promise<{
  tokens: AgentCapabilityTokenStore;
  threadManager: ReturnType<typeof createThreadManager>;
  projectManager: ReturnType<typeof createProjectManager>;
  projectId: string;
}> {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-agent-tool-real-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const tokens = createAgentCapabilityTokenStore();
  const projectManager = createProjectManager({ db, homeDir: tempDir });
  const project = projectManager.createProject({
    cwd: tempDir,
    profile: 'default',
    sandbox: 'workspace-write'
  });
  const threadManager = createThreadManager({
    db,
    dataDir: tempDir,
    projectManager
  });
  server = await buildServer({
    token: 'public-secret',
    dataDir: tempDir,
    db,
    codexHome: join(tempDir, 'codex-home'),
    agentCapabilityTokens: tokens,
    schedulerAutostart: false
  });
  return {
    tokens,
    threadManager,
    projectManager,
    projectId: project.id
  };
}

async function createPublicSchedule(name: string, cwd: string): Promise<ScheduleResponse> {
  const response = await server!.inject({
    method: 'POST',
    url: '/schedules',
    headers: {
      authorization: 'Bearer public-secret',
      'content-type': 'application/json'
    },
    payload: {
      name,
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: `${name}内容`,
      cwd
    }
  });
  expect(response.statusCode).toBe(201);
  return response.json() as ScheduleResponse;
}

function readLatestScheduleOperation(): {
  operation: string;
  run_id: string | null;
  actor_type: string | null;
  actor_run_id: string | null;
} {
  return db!.prepare(`
    SELECT operation, run_id, actor_type, actor_run_id
    FROM schedule_operations
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `).get() as {
    operation: string;
    run_id: string | null;
    actor_type: string | null;
    actor_run_id: string | null;
  };
}

function scheduleDetail(
  overrides: Partial<ScheduleDetailResponse> = {}
): ScheduleDetailResponse {
  return {
    ...schedule(overrides),
    prompt: '完整任务内容',
    ...overrides
  };
}

function schedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'schedule-1',
    threadId: 'thread-1',
    name: '每日总结',
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结项目',
    profile: 'default',
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'queue',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-15T01:00:00.000Z',
    lastRunAt: null,
    lastRunId: null,
    lastStatus: null,
    pendingTrigger: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides
  };
}

function runtimeThread(overrides: Partial<RuntimeThread> = {}): RuntimeThread {
  return {
    id: 'thread-1',
    scheduleId: 'schedule-1',
    title: '每日总结',
    projectId: null,
    enterpriseSubjectId: null,
    origin: 'clawee_created',
    codexThreadId: null,
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'schedule_task',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  };
}

function capabilityGet(path: string, token: string) {
  return server!.inject({
    method: 'GET',
    url: path,
    headers: { authorization: `Bearer ${token}` }
  });
}

function capabilityRequest(
  method: 'PATCH' | 'POST',
  path: string,
  token: string,
  payload: object
) {
  return server!.inject({
    method,
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    payload
  });
}

function expectCapabilityError(
  operation: () => unknown,
  code: AgentCapabilityTokenError['code']
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AgentCapabilityTokenError);
    expect(error).toMatchObject({ code });
  }
}
