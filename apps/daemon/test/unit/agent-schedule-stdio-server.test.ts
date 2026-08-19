import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentScheduleMcpServer } from '../../src/agent-tools/stdio-server.js';

let closeWork: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closeWork.map(close => close()));
  closeWork = [];
});

describe('agent schedule MCP server', () => {
  it('registers all schedule tools and executes structured create input', async () => {
    const request = vi.fn(async () => ({
      id: 'schedule-1',
      threadId: 'thread-1',
      name: '每日总结',
      enabled: true,
      nextRunAt: '2026-07-15T10:00:00.000Z'
    }));
    const server = createAgentScheduleMcpServer({
      request,
      defaultTimezone: 'UTC'
    });
    const client = new Client({
      name: 'opencreator-agent-test',
      version: '0.1.0'
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeWork.push(() => client.close(), () => server.close());

    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).toEqual([
      'opencreator_schedule_create',
      'opencreator_schedule_update',
      'opencreator_schedule_pause',
      'opencreator_schedule_resume',
      'opencreator_schedule_run_now',
      'opencreator_schedule_get'
    ]);

    const result = await client.callTool({
      name: 'opencreator_schedule_create',
      arguments: {
        name: '每日总结',
        task: '总结今天的工作',
        timing: { type: 'daily', time: '18:00' },
        timezone: 'Asia/Shanghai'
      }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      scheduleId: 'schedule-1',
      threadId: 'thread-1',
      name: '每日总结',
      enabled: true,
      nextRunAt: '2026-07-15T10:00:00.000Z'
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/internal/agent-tools/schedules'
    }));
  });

  it('rejects unknown fields before the internal api is called', async () => {
    const request = vi.fn();
    const server = createAgentScheduleMcpServer({
      request,
      defaultTimezone: 'UTC'
    });
    const client = new Client({
      name: 'opencreator-agent-test',
      version: '0.1.0'
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeWork.push(() => client.close(), () => server.close());

    const result = await client.callTool({
      name: 'opencreator_schedule_create',
      arguments: {
        name: '伪造任务',
        task: '内容',
        timing: { type: 'daily', time: '09:00' },
        threadId: 'thread-forged'
      }
    });

    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('registers only tools enabled for the active process grant', async () => {
    const server = createAgentScheduleMcpServer({
      request: vi.fn(),
      enabledTools: [
        'opencreator_schedule_update',
        'opencreator_schedule_get'
      ]
    });
    const client = new Client({
      name: 'opencreator-agent-test',
      version: '0.1.0'
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeWork.push(() => client.close(), () => server.close());

    const listed = await client.listTools();
    expect(listed.tools.map(tool => tool.name)).toEqual([
      'opencreator_schedule_update',
      'opencreator_schedule_get'
    ]);
  });
});
