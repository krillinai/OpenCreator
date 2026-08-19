import type { AgentEventEnvelope } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { eventToTimelineItem } from './timeline-model.js';

describe('timeline model', () => {
  it('maps schedule trigger events to public timeline input', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_schedule_trigger',
      runId: 'run_schedule',
      seq: 1,
      ts: '2026-07-14T14:05:00.000Z',
      type: 'schedule_trigger',
      payload: {
        type: 'schedule_trigger',
        prompt: '生成每日项目摘要',
        triggeredAt: '2026-07-14T14:05:00.000Z'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toEqual({
      kind: 'schedule_trigger',
      id: 'evt_schedule_trigger',
      runId: 'run_schedule',
      prompt: '生成每日项目摘要',
      triggeredAt: '2026-07-14T14:05:00.000Z',
      source: 'runtime'
    });
  });

  it('maps approval events to actionable timeline approvals', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_approval',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-12T10:00:00.000Z',
      type: 'approval',
      normalizerVersion: 1,
      payload: {
        type: 'approval',
        approval: {
          id: 'approval_1',
          runId: 'run_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'item_1',
          requestId: 'rpc_1',
          kind: 'command_execution',
          status: 'pending',
          risk: 'high',
          title: '允许执行命令',
          summary: 'rm -rf build',
          details: { command: 'rm -rf build' },
          requestedAt: '2026-07-12T10:00:00.000Z',
          expiresAt: '2026-07-12T10:10:00.000Z'
        }
      }
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'approval',
      approval: {
        id: 'approval_1',
        status: 'pending'
      }
    });
  });

  it('maps assistant_message events', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_1',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'assistant_message',
      payload: { type: 'assistant_message', text: 'hello', format: 'plain_text', delivery: 'message' },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'assistant_message',
      text: 'hello',
      source: 'runtime'
    });
  });

  it('maps reasoning_summary events as visible process summaries', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_reasoning',
      runId: 'run_1',
      seq: 2,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'reasoning_summary',
      payload: {
        type: 'reasoning_summary',
        text: '我先确认输入要求。\n\n然后执行本地检查。',
        format: 'plain_text',
        delivery: 'summary'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'reasoning_summary',
      text: '我先确认输入要求。\n\n然后执行本地检查。',
      source: 'runtime'
    });
  });

  it('maps tool_use events with the tool name and complete payload summary', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_tool_use',
      runId: 'run_1',
      seq: 2,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'tool_use',
      payload: {
        type: 'tool_use',
        toolCallId: 'call_1',
        name: 'exec_command',
        input: { command: 'pnpm test', args: ['--runInBand'] }
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'tool_step',
      name: 'exec_command',
      content:
        '{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test","args":["--runInBand"]}}',
      source: 'runtime'
    });
  });

  it('maps tool_result events with the tool call id and complete payload summary', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_tool_result',
      runId: 'run_1',
      seq: 3,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'tool_result',
      payload: {
        type: 'tool_result',
        toolCallId: 'call_1',
        output: 'test output',
        exitCode: 0,
        isError: false
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'tool_step',
      name: 'call_1',
      content:
        '{"type":"tool_result","toolCallId":"call_1","output":"test output","exitCode":0,"isError":false}',
      source: 'runtime'
    });
  });

  it('maps diagnostic and error events to diagnostics with complete payload summaries', () => {
    const diagnostic: AgentEventEnvelope = {
      id: 'evt_diagnostic',
      runId: 'run_1',
      seq: 4,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'diagnostic',
      payload: {
        type: 'diagnostic',
        code: 'warn_1',
        severity: 'warning',
        message: 'check config',
        details: { path: 'settings.json', reason: 'missing value' }
      },
      normalizerVersion: 1
    };
    const error: AgentEventEnvelope = {
      id: 'evt_error',
      runId: 'run_1',
      seq: 5,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'error',
      payload: {
        type: 'error',
        code: 'runtime_error',
        message: 'runtime failed',
        details: { exitCode: 1, stderr: 'boom' }
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(diagnostic)).toMatchObject({
      kind: 'diagnostic',
      severity: 'warning',
      message: 'check config',
      content:
        '{"type":"diagnostic","code":"warn_1","severity":"warning","message":"check config","details":{"path":"settings.json","reason":"missing value"}}'
    });
    expect(eventToTimelineItem(error)).toMatchObject({
      kind: 'diagnostic',
      severity: 'error',
      message: 'runtime failed',
      content:
        '{"type":"error","code":"runtime_error","message":"runtime failed","details":{"exitCode":1,"stderr":"boom"}}'
    });
  });

  it('maps done events with the termination reason', () => {
    const done: AgentEventEnvelope = {
      id: 'evt_done',
      runId: 'run_1',
      seq: 6,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'done',
      payload: {
        type: 'done',
        status: 'succeeded',
        terminationReason: 'completed'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(done)).toMatchObject({
      kind: 'done',
      status: 'succeeded',
      terminationReason: 'completed',
      content: '{"type":"done","status":"succeeded","terminationReason":"completed"}'
    });
  });

  it('maps status events with thread identifiers in the content summary', () => {
    const status: AgentEventEnvelope = {
      id: 'evt_status',
      runId: 'run_1',
      seq: 7,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'status',
      payload: {
        type: 'status',
        label: 'running',
        threadId: 'thread_1',
        codexThreadId: 'codex_thread_1'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(status)).toMatchObject({
      kind: 'run_status',
      label: 'running',
      content: '{"type":"status","label":"running","threadId":"thread_1","codexThreadId":"codex_thread_1"}'
    });
  });

  it('maps usage events with the complete payload summary', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_usage',
      runId: 'run_1',
      seq: 8,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'usage',
      payload: {
        type: 'usage',
        inputTokens: 12,
        outputTokens: 34,
        source: 'stream_cumulative'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'run_status',
      label: 'usage',
      content: '{"type":"usage","inputTokens":12,"outputTokens":34,"source":"stream_cumulative"}'
    });
  });

  it('maps file_change events to visible change cards', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_file_change',
      runId: 'run_1',
      seq: 9,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'file_change',
      payload: {
        type: 'file_change',
        status: 'completed',
        changes: [
          { path: '/repo/放假.md', kind: 'add' },
          { path: '/repo/notes.md', kind: 'modify' }
        ]
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'change_card',
      id: 'evt_file_change',
      runId: 'run_1',
      title: '新增 1 个文件，修改 1 个文件',
      path: '/repo/放假.md',
      delta: '2 项变更',
      source: 'runtime'
    });
  });

  it('hides unknown_event events from the main conversation timeline', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_unknown',
      runId: 'run_1',
      seq: 9,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'unknown_event',
      payload: {
        type: 'unknown_event',
        rawEventId: 'raw_1',
        codexType: 'session_configured'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(event)).toBeNull();
  });

  it('ignores circular unknown_event payloads without throwing', () => {
    const payload: Record<string, unknown> = {
      type: 'unknown_event',
      rawEventId: 'raw_2'
    };
    payload.self = payload;
    const event = {
      id: 'evt_circular',
      runId: 'run_1',
      seq: 10,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'unknown_event',
      payload,
      normalizerVersion: 1
    } as AgentEventEnvelope;

    expect(eventToTimelineItem(event)).toBeNull();
  });

  it('ignores BigInt unknown_event payload fields without throwing', () => {
    const event = {
      id: 'evt_bigint',
      runId: 'run_1',
      seq: 11,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'unknown_event',
      payload: {
        type: 'unknown_event',
        rawEventId: 'raw_3',
        tokenCount: 123n
      },
      normalizerVersion: 1
    } as AgentEventEnvelope;

    expect(eventToTimelineItem(event)).toBeNull();
  });
});
