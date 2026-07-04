import { describe, expect, it } from 'vitest';
import { parseJsonLine } from '../../src/events/parser.js';
import { normalizeCodexEvent } from '../../src/events/normalizer.js';

describe('event parser and normalizer', () => {
  it('parses valid json lines', () => {
    expect(parseJsonLine('{"type":"turn.started"}')).toEqual({ ok: true, value: { type: 'turn.started' } });
  });

  it('reports invalid json lines', () => {
    const result = parseJsonLine('{broken');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.line).toBe('{broken');
      expect(result.error).toEqual(expect.any(String));
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('normalizes agent messages', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 1,
      raw: {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'hello' }
      }
    });
    expect(event.type).toBe('assistant_message');
    expect(event.payload).toMatchObject({ type: 'assistant_message', text: 'hello' });
  });

  it('normalizes command execution result', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 2,
      raw: {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'pwd',
          aggregated_output: '/repo',
          exit_code: 0,
          status: 'completed'
        }
      }
    });
    expect(event.type).toBe('tool_result');
    expect(event.payload).toMatchObject({ type: 'tool_result', output: '/repo', exitCode: 0 });
  });

  it('normalizes turn completion as finalizing before daemon exit decides done', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 3,
      raw: { type: 'turn.completed' }
    });
    expect(event.type).toBe('status');
    expect(event.payload).toMatchObject({ type: 'status', label: 'finalizing' });
  });

  it('uses fallback raw event id inside unknown event payload', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 3,
      raw: {
        id: 'raw_evt_1',
        type: 'unexpected.event'
      }
    });
    expect(event.type).toBe('unknown_event');
    expect(event.rawEventId).toBe('raw_evt_1');
    expect(event.payload).toMatchObject({
      type: 'unknown_event',
      rawEventId: 'run_1:3',
      codexType: 'unexpected.event'
    });
  });
});
