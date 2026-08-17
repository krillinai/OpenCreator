import { describe, expect, it } from 'vitest';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import {
  AGENT_SCHEDULE_MCP_SERVER_NAME,
  createAgentScheduleProcessInjector,
  createAgentScheduleRunInjector
} from '../../src/agent-tools/run-injection.js';
import type { RuntimeThread } from '../../src/threads/types.js';

describe('agent tool run injection', () => {
  it('grants all schedule capabilities to a user run in a conversation thread', () => {
    const tokens = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities: tokens,
      getBaseUrl: () => 'http://127.0.0.1:43123',
      env: {
        NO_PROXY: 'existing.example',
        no_proxy: 'internal.example,127.0.0.1'
      }
    });

    const injection = injector.prepare({
      runId: 'run-user',
      thread: thread({ purpose: 'conversation' }),
      createdBy: 'api'
    });

    expect(injection?.mcpServers).toEqual([
      expect.objectContaining({
        name: AGENT_SCHEDULE_MCP_SERVER_NAME,
        url: 'http://127.0.0.1:43123/internal/agent-tools/mcp',
        bearerTokenEnvVar: 'CLAWEE_AGENT_CAPABILITY_TOKEN',
        enabledTools: [
          'clawee_schedule_create',
          'clawee_schedule_update',
          'clawee_schedule_pause',
          'clawee_schedule_resume',
          'clawee_schedule_run_now',
          'clawee_schedule_get'
        ]
      })
    ]);
    const token = injection?.env.CLAWEE_AGENT_CAPABILITY_TOKEN;
    expect(token).toMatch(/^clwcap_/);
    expect(injection?.env).toMatchObject({
      NO_PROXY: 'existing.example,internal.example,127.0.0.1,localhost',
      no_proxy: 'existing.example,internal.example,127.0.0.1,localhost'
    });
    expect(tokens.authorize(token, { scope: 'schedule:create' })).toMatchObject({
      runId: 'run-user',
      threadId: 'thread-1'
    });
    tokens.close();
  });

  it('removes create from task-thread user runs and all mutations from automatic runs', () => {
    const tokens = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities: tokens,
      getBaseUrl: () => 'http://127.0.0.1:43123'
    });

    const taskRun = injector.prepare({
      runId: 'run-task-user',
      thread: thread({ purpose: 'schedule_task' }),
      createdBy: 'api'
    });
    const automaticRun = injector.prepare({
      runId: 'run-schedule',
      thread: thread({ purpose: 'schedule_task' }),
      createdBy: 'schedule'
    });

    expect(taskRun?.mcpServers[0]?.enabledTools).toEqual([
      'clawee_schedule_update',
      'clawee_schedule_pause',
      'clawee_schedule_resume',
      'clawee_schedule_run_now',
      'clawee_schedule_get'
    ]);
    expect(automaticRun?.mcpServers[0]?.enabledTools).toEqual([
      'clawee_schedule_get'
    ]);
    expect(() => tokens.authorize(
      automaticRun?.env.CLAWEE_AGENT_CAPABILITY_TOKEN,
      { scope: 'schedule:update' }
    )).toThrow('scope is not allowed');
    tokens.close();
  });

  it('does not issue a token before the daemon has a listening address', () => {
    const tokens = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities: tokens,
      getBaseUrl: () => undefined
    });

    expect(injector.prepare({
      runId: 'run-before-listen',
      thread: thread(),
      createdBy: 'api'
    })).toBeUndefined();
    tokens.close();
  });

  it('uses one inactive process token and switches the active manifest per run', () => {
    const tokens = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleProcessInjector({
      capabilities: tokens,
      getBaseUrl: () => 'http://127.0.0.1:43123'
    });
    const injection = injector.create();

    expect(injection?.mcpServers).toEqual([
      expect.objectContaining({
        name: AGENT_SCHEDULE_MCP_SERVER_NAME,
        url: 'http://127.0.0.1:43123/internal/agent-tools/mcp',
        bearerTokenEnvVar: 'CLAWEE_AGENT_CAPABILITY_TOKEN'
      })
    ]);
    expect(injection?.mcpServers[0]).not.toHaveProperty('enabledTools');
    const token = injection?.env.CLAWEE_AGENT_CAPABILITY_TOKEN;
    expectCapabilityCode(
      () => tokens.inspect(token),
      'CAPABILITY_CONTEXT_INACTIVE'
    );

    const conversation = injection?.activate({
      runId: 'run-conversation',
      thread: thread({ purpose: 'conversation' }),
      createdBy: 'api'
    });
    expect(conversation?.manifestKey).toContain('clawee_schedule_create');
    expect(tokens.authorize(token, { scope: 'schedule:create' })).toMatchObject({
      runId: 'run-conversation',
      threadId: 'thread-1'
    });
    injection?.deactivate('run-conversation');

    const task = injection?.activate({
      runId: 'run-task',
      thread: thread({ id: 'thread-2', purpose: 'schedule_task' }),
      createdBy: 'api'
    });
    expect(task?.manifestKey).not.toBe(conversation?.manifestKey);
    expect(task?.manifestKey).not.toContain('clawee_schedule_create');
    expect(tokens.authorize(token, { scope: 'schedule:update' })).toMatchObject({
      runId: 'run-task',
      threadId: 'thread-2'
    });
    expectCapabilityCode(
      () => tokens.authorize(token, { scope: 'schedule:create' }),
      'CAPABILITY_SCOPE_FORBIDDEN'
    );

    injection?.close();
    expectCapabilityCode(
      () => tokens.inspect(token),
      'CAPABILITY_TOKEN_INVALID'
    );
    tokens.close();
  });
});

function expectCapabilityCode(
  operation: () => unknown,
  code: string
): void {
  try {
    operation();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

function thread(overrides: Partial<RuntimeThread> = {}): RuntimeThread {
  return {
    id: 'thread-1',
    title: '测试会话',
    projectId: 'project-1',
    enterpriseSubjectId: null,
    origin: 'clawee_created',
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides
  };
}
