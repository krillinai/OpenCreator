import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createKrillinCodexLlmGateway } from '../../src/creator/krillin/codex-llm-gateway.js';

describe('Krillin Codex LLM gateway', () => {
  it('authenticates and converts a Codex final message to chat completions', async () => {
    const run = vi.fn((input: { onNotification?(value: Record<string, unknown>): void }) => {
      input.onNotification?.({
        method: 'item/completed',
        params: { item: { id: 'answer', type: 'agentMessage', text: '{"translation":"你好"}' } }
      });
      return {
        cancel() {},
        result: Promise.resolve({
          threadId: 'thread-1',
          turnId: 'turn-1',
          turnStatus: 'completed' as const,
          stderr: '',
          terminationReason: 'completed' as const,
          outputTruncation: {
            stderr: { truncated: false, droppedBytes: 0, droppedItems: 0 },
            frames: { truncated: false, droppedBytes: 0, droppedItems: 0 }
          }
        })
      };
    });
    const createHost = vi.fn(() => ({
      pid: 1,
      started: Promise.resolve(1),
      run,
      isReusable: () => true,
      close: vi.fn(async () => undefined)
    }));
    const gateway = createKrillinCodexLlmGateway({
      codexBin: '/bundled/codex',
      codexHome: '/isolated/codex-home',
      cwd: '/workspace',
      createHost
    });
    const server = Fastify();
    await gateway.register(server);
    const config = gateway.config('http://127.0.0.1:1234');

    const unauthorized = await server.inject({
      method: 'POST',
      url: '/internal/krillin-llm/v1/chat/completions',
      payload: { messages: [{ role: 'user', content: 'translate' }] }
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await server.inject({
      method: 'POST',
      url: '/internal/krillin-llm/v1/chat/completions',
      headers: { authorization: `Bearer ${config.apiKey}` },
      payload: {
        model: 'codex',
        messages: [
          { role: 'system', content: 'Translate subtitles.' },
          { role: 'user', content: 'Hello' }
        ],
        response_format: { type: 'json_object' }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      model: 'codex',
      choices: [{ message: { role: 'assistant', content: '{"translation":"你好"}' } }]
    });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('SYSTEM:\nTranslate subtitles.'),
      developerInstructions: expect.stringContaining('valid JSON')
    }));
    const origin = await server.listen({ port: 0, host: '127.0.0.1' });
    const streamed = await fetch(`${origin}/internal/krillin-llm/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'codex',
        stream: true,
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });
    const streamBody = await streamed.text();
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get('content-type')).toContain('text/event-stream');
    expect(streamBody).toContain('"object":"chat.completion.chunk"');
    expect(streamBody).toContain('"content":"{\\"translation\\":\\"你好\\"}"');
    expect(streamBody).toContain('data: [DONE]');
    expect(createHost).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    await gateway.close();
    await server.close();
  });
});
