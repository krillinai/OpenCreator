import { describe, expect, it } from 'vitest';
import { normalizeCreatorRuntimeEvent } from '../../src/creator/agent/event-normalizer.js';

describe('creator agent event normalizer', () => {
  it('classifies runtime user prompts without retaining injected Creator context', () => {
    const normalized = normalizeCreatorRuntimeEvent({
      method: 'item/completed',
      params: {
        item: {
          id: 'runtime-user-1',
          type: 'userMessage',
          clientId: 'client-1',
          content: [{
            type: 'inputText',
            text: '用户请求：检查任务\nOpenCreator Context Projection：{"secret":"internal"}'
          }]
        }
      }
    });

    expect(normalized.item).toEqual({
      kind: 'user_message',
      status: 'completed',
      data: {
        type: 'userMessage',
        id: 'runtime-user-1',
        clientId: 'client-1'
      }
    });
    expect(JSON.stringify(normalized)).not.toContain('Context Projection');
    expect(JSON.stringify(normalized)).not.toContain('internal');
  });

  it('keeps only readable MCP tool identity and status metadata', () => {
    const normalized = normalizeCreatorRuntimeEvent({
      method: 'item/completed',
      params: {
        item: {
          id: 'runtime-tool-1',
          type: 'mcpToolCall',
          server: 'opencreator_tools',
          tool: 'creator_get_context',
          status: 'completed',
          durationMs: 12,
          arguments: { hidden: true },
          result: { structuredContent: { hidden: true } }
        }
      }
    });

    expect(normalized.item).toMatchObject({
      kind: 'tool_result',
      status: 'completed',
      toolName: 'opencreator_tools.creator_get_context',
      data: {
        type: 'mcpToolCall',
        id: 'runtime-tool-1',
        server: 'opencreator_tools',
        tool: 'creator_get_context',
        status: 'completed',
        durationMs: 12
      }
    });
    expect(JSON.stringify(normalized)).not.toContain('structuredContent');
    expect(JSON.stringify(normalized)).not.toContain('arguments');
  });

  it('preserves agent message phase and streaming text deltas', () => {
    expect(normalizeCreatorRuntimeEvent({
      method: 'item/started',
      params: {
        item: {
          id: 'runtime-message-1',
          type: 'agentMessage',
          phase: 'final_answer',
          text: ''
        }
      }
    }).item).toMatchObject({
      kind: 'assistant_message',
      status: 'running',
      data: { phase: 'final_answer' }
    });

    expect(normalizeCreatorRuntimeEvent({
      method: 'item/agentMessage/delta',
      params: {
        itemId: 'runtime-message-1',
        delta: '正在生成结果'
      }
    })).toMatchObject({
      runtimeItemId: 'runtime-message-1',
      textDelta: '正在生成结果'
    });
  });
});
