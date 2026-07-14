import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import {
  AGENT_SCHEDULE_MCP_SERVER_NAME,
  createAgentScheduleRunInjector,
  resolveAgentScheduleStdioCommand
} from '../../src/agent-tools/run-injection.js';
import type { RuntimeThread } from '../../src/threads/types.js';

describe('agent tool run injection', () => {
  it('grants all schedule capabilities to a user run in a conversation thread', () => {
    const tokens = createAgentCapabilityTokenStore();
    const injector = createAgentScheduleRunInjector({
      capabilities: tokens,
      getBaseUrl: () => 'http://127.0.0.1:43123',
      command: '/usr/bin/node',
      args: ['/app/agent-tools/stdio-server.js']
    });

    const injection = injector.prepare({
      runId: 'run-user',
      thread: thread({ purpose: 'conversation' }),
      createdBy: 'api'
    });

    expect(injection?.mcpServers).toEqual([
      expect.objectContaining({
        name: AGENT_SCHEDULE_MCP_SERVER_NAME,
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
      getBaseUrl: () => 'http://127.0.0.1:43123',
      command: '/usr/bin/node',
      args: ['/app/agent-tools/stdio-server.js']
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
      getBaseUrl: () => undefined,
      command: '/usr/bin/node',
      args: ['/app/agent-tools/stdio-server.js']
    });

    expect(injector.prepare({
      runId: 'run-before-listen',
      thread: thread(),
      createdBy: 'api'
    })).toBeUndefined();
    tokens.close();
  });

  it('uses absolute source and loader paths in daemon development mode', () => {
    const command = resolveAgentScheduleStdioCommand();

    expect(command.args[0]).toBe('--import');
    expect(command.args[1]).toBeDefined();
    expect(isAbsolute(command.args[1]!)).toBe(true);
    expect(existsSync(command.args[1]!)).toBe(true);
    expect(command.args[2]).toBeDefined();
    expect(isAbsolute(command.args[2]!)).toBe(true);
    expect(existsSync(command.args[2]!)).toBe(true);
  });
});

function thread(overrides: Partial<RuntimeThread> = {}): RuntimeThread {
  return {
    id: 'thread-1',
    title: '测试会话',
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
