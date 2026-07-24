import { describe, expect, it } from 'vitest';
import { parseJsonLine } from '../../src/events/parser.js';
import {
  normalizeAppServerEvent,
  normalizeCodexEvent
} from '../../src/events/normalizer.js';

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

  it('normalizes file change items as visible file_change events', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 3,
      raw: {
        type: 'item.completed',
        item: {
          id: 'item_2',
          type: 'file_change',
          changes: [
            { path: '/repo/放假.md', kind: 'add' },
            { path: '/repo/old.md', kind: 'delete' },
            { path: 123, kind: 'replace' }
          ],
          status: 'completed'
        }
      }
    });

    expect(event.type).toBe('file_change');
    expect(event.payload).toMatchObject({
      type: 'file_change',
      changes: [
        { path: '/repo/放假.md', kind: 'add' },
        { path: '/repo/old.md', kind: 'delete' },
        { path: '', kind: 'unknown' }
      ],
      status: 'completed'
    });
  });

  it('normalizes public reasoning summaries', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 4,
      raw: {
        type: 'item.completed',
        item: {
          type: 'reasoning',
          summary: [
            { type: 'summary_text', text: '我先确认项目结构和可用命令。' },
            { type: 'summary_text', text: '然后运行测试验证结果。' }
          ]
        }
      }
    });

    expect(event.type).toBe('reasoning_summary');
    expect(event.payload).toMatchObject({
      type: 'reasoning_summary',
      text: '我先确认项目结构和可用命令。\n\n然后运行测试验证结果。',
      format: 'plain_text',
      delivery: 'summary'
    });
  });

  it('normalizes reasoning summaries from text fields', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 4,
      raw: {
        type: 'item.completed',
        item: {
          type: 'reasoning',
          text: '我会先读取输入，再给出结果。'
        }
      }
    });

    expect(event.type).toBe('reasoning_summary');
    expect(event.payload).toMatchObject({
      type: 'reasoning_summary',
      text: '我会先读取输入，再给出结果。'
    });
  });

  it('normalizes top-level Codex stream errors as visible runtime errors', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 5,
      raw: {
        type: 'error',
        message: 'Reconnecting... 1/5 (unexpected status 503 Service Unavailable)'
      }
    });

    expect(event.type).toBe('error');
    expect(event.payload).toMatchObject({
      type: 'error',
      code: 'CODEX_STREAM_ERROR',
      message: 'Reconnecting... 1/5 (unexpected status 503 Service Unavailable)'
    });
  });

  it('normalizes Codex error items as visible diagnostics', () => {
    const event = normalizeCodexEvent({
      runId: 'run_1',
      seq: 6,
      raw: {
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'error',
          message: 'Skill descriptions were shortened to fit the skills context budget.'
        }
      }
    });

    expect(event.type).toBe('diagnostic');
    expect(event.payload).toMatchObject({
      type: 'diagnostic',
      code: 'CODEX_ITEM_ERROR',
      severity: 'warning',
      message: 'Skill descriptions were shortened to fit the skills context budget.'
    });
  });

  it('shows app-server reconnect attempts as warnings instead of terminal errors', () => {
    const event = normalizeAppServerEvent({
      runId: 'run_1',
      seq: 7,
      raw: {
        method: 'error',
        params: {
          error: {
            message: 'Reconnecting... 1/5',
            codexErrorInfo: {
              responseStreamDisconnected: {
                httpStatusCode: null
              }
            }
          },
          additionalDetails: 'stream disconnected before completion'
        }
      }
    });

    expect(event.type).toBe('diagnostic');
    expect(event.payload).toMatchObject({
      type: 'diagnostic',
      code: 'CODEX_STREAM_RETRYING',
      severity: 'warning',
      message: 'Codex 响应连接中断，正在自动重连（1/5）'
    });
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
