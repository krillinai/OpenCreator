import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSseChunk, sseEventsToFrames, subscribeRunEvents } from './sse.js';

describe('sse parser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses id event and data frame', () => {
    const frames = sseEventsToFrames([
      'id: 4\n',
      'event: assistant_message\n',
      'data: {"type":"assistant_message","seq":4}\n',
      '\n'
    ]);

    expect(frames).toEqual([
      {
        id: '4',
        event: 'assistant_message',
        data: '{"type":"assistant_message","seq":4}'
      }
    ]);
  });

  it('ignores heartbeat comments', () => {
    expect(parseSseChunk(': heartbeat\n\n')).toEqual([]);
  });

  it('keeps incomplete frames buffered', () => {
    const result = parseSseChunk('id: 5\nevent: status\n');
    expect(result).toEqual([]);
  });

  it('does not let incomplete helper calls pollute later direct calls', () => {
    expect(parseSseChunk('id: 6\nevent: status\n')).toEqual([]);
    expect(parseSseChunk('data: {"type":"done"}\n\n')).toEqual([
      {
        data: '{"type":"done"}'
      }
    ]);
  });

  it('parses frames with CRLF line endings', () => {
    const frames = sseEventsToFrames([
      'id: 7\r\n',
      'event: done\r\n',
      'data: {"type":"done","seq":7}\r\n',
      '\r\n'
    ]);

    expect(frames).toEqual([
      {
        id: '7',
        event: 'done',
        data: '{"type":"done","seq":7}'
      }
    ]);
  });

  it('keeps subscription buffers isolated', async () => {
    const received: string[] = [];
    const errors: Error[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const runId = String(url).includes('/runs/run-a/') ? 'run-a' : 'run-b';

      return new Response(
        streamFromChunks([
          `data: {"id":"${runId}-event","runId":"${runId}","seq":1,"ts":"2026-07-06T00:00:00.000Z","type":"done",`,
          '"payload":{"type":"done","status":"succeeded","terminationReason":"completed"},"normalizerVersion":1}\n\n'
        ])
      );
    }) as typeof fetch;

    await Promise.all([
      subscribeRunEvents({
        baseUrl: 'https://runtime.test',
        token: 'token',
        runId: 'run-a',
        fetchImpl,
        onEvent: (event) => received.push(event.runId),
        onError: (error) => errors.push(error)
      }),
      subscribeRunEvents({
        baseUrl: 'https://runtime.test',
        token: 'token',
        runId: 'run-b',
        fetchImpl,
        onEvent: (event) => received.push(event.runId),
        onError: (error) => errors.push(error)
      })
    ]);

    expect(errors).toEqual([]);
    expect(received.sort()).toEqual(['run-a', 'run-b']);
  });

  it('binds the default browser fetch when no fetch implementation is injected', async () => {
    const received: string[] = [];
    vi.stubGlobal('fetch', (async function fetchMock(this: typeof globalThis) {
      if (this !== globalThis) throw new Error('fetch was called without its global binding');
      return new Response(
        streamFromChunks([
          'data: {"id":"evt_1","runId":"run_1","seq":1,"ts":"2026-07-06T00:00:00.000Z","type":"done","payload":{"type":"done","status":"succeeded","terminationReason":"completed"},"normalizerVersion":1}\n\n'
        ])
      );
    }) as typeof fetch);

    await subscribeRunEvents({
      baseUrl: 'https://runtime.test',
      token: 'token',
      runId: 'run_1',
      onEvent: (event) => received.push(event.type),
      onError: (error) => {
        throw error;
      }
    });

    expect(received).toEqual(['done']);
  });

  it('cancels the response reader when parsing an SSE event fails', async () => {
    let canceled = false;
    const errors: Error[] = [];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {not-json}\n\n'));
      },
      cancel() {
        canceled = true;
      }
    });
    const fetchImpl = (async () => new Response(body)) as typeof fetch;

    await subscribeRunEvents({
      baseUrl: 'https://runtime.test',
      token: 'token',
      runId: 'run_1',
      fetchImpl,
      onEvent: () => {
        throw new Error('unexpected event');
      },
      onError: (error) => errors.push(error)
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('JSON');
    expect(canceled).toBe(true);
  });
});

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    }
  });
}
