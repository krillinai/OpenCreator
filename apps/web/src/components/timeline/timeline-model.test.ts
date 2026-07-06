import type { AgentEventEnvelope } from '@clawee/protocol';
import { describe, expect, it } from 'vitest';
import { eventToTimelineItem } from './timeline-model.js';

describe('timeline model', () => {
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

  it('maps unknown_event events with the complete payload summary', () => {
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

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'run_status',
      label: 'unknown_event',
      content: '{"type":"unknown_event","rawEventId":"raw_1","codexType":"session_configured"}'
    });
  });

  it('serializes circular unknown_event payloads without throwing', () => {
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

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'run_status',
      label: 'unknown_event',
      content: '{"type":"unknown_event","rawEventId":"raw_2","self":"[Circular]"}'
    });
  });

  it('serializes BigInt unknown_event payload fields as strings', () => {
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

    expect(eventToTimelineItem(event)).toMatchObject({
      kind: 'run_status',
      label: 'unknown_event',
      content: '{"type":"unknown_event","rawEventId":"raw_3","tokenCount":"123"}'
    });
  });
});
