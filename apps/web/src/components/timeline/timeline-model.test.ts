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

  it('maps tool_use events with the tool name and serialized input', () => {
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
      content: '{"command":"pnpm test","args":["--runInBand"]}',
      source: 'runtime'
    });
  });

  it('maps tool_result events with the tool call id and output', () => {
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
      content: 'test output',
      source: 'runtime'
    });
  });

  it('maps diagnostic and error events to diagnostics', () => {
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
        message: 'check config'
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
        message: 'runtime failed'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(diagnostic)).toMatchObject({
      kind: 'diagnostic',
      severity: 'warning',
      message: 'check config'
    });
    expect(eventToTimelineItem(error)).toMatchObject({
      kind: 'diagnostic',
      severity: 'error',
      message: 'runtime failed'
    });
  });

  it('maps done and status events', () => {
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
    const status: AgentEventEnvelope = {
      id: 'evt_status',
      runId: 'run_1',
      seq: 7,
      ts: '2026-07-06T00:00:00.000Z',
      type: 'status',
      payload: {
        type: 'status',
        label: 'running'
      },
      normalizerVersion: 1
    };

    expect(eventToTimelineItem(done)).toMatchObject({
      kind: 'done',
      status: 'succeeded'
    });
    expect(eventToTimelineItem(status)).toMatchObject({
      kind: 'run_status',
      label: 'running'
    });
  });

  it('keeps fallback payload details visible for events without dedicated timeline variants', () => {
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
});
