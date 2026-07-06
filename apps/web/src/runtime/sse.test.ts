import { describe, expect, it } from 'vitest';
import { parseSseChunk, sseEventsToFrames, subscribeRunEvents } from './sse.js';

describe('sse parser', () => {
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
