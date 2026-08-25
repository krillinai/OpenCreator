import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createKrillinServiceClient } from '../../src/creator/krillin/service-client.js';

let server: Server | undefined;

afterEach(async () => {
  if (server !== undefined) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
});

describe('KrillinAI OpenCreator service client', () => {
  it('sends Bearer auth and preserves the event cursor', async () => {
    const requests: Array<{ path: string; authorization?: string }> = [];
    const origin = await listen((request, response) => {
      requests.push({
        path: request.url ?? '',
        ...(request.headers.authorization === undefined
          ? {}
          : { authorization: request.headers.authorization })
      });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ events: [], nextSeq: 9 }));
    });
    const client = createKrillinServiceClient({ origin, token: 'secret-token' });

    await expect(client.events('task_1', 9)).resolves.toEqual({ events: [], nextSeq: 9 });
    expect(requests).toEqual([{
      path: '/v1/tasks/task_1/events?afterSeq=9',
      authorization: 'Bearer secret-token'
    }]);
  });

  it('returns stable service errors without echoing the request body', async () => {
    const origin = await listen((_request, response) => {
      response.statusCode = 409;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        error: {
          code: 'idempotency_key_reused',
          message: 'Idempotency key was reused',
          retryable: false
        }
      }));
    });
    const client = createKrillinServiceClient({ origin, token: 'secret-token' });

    await expect(client.createTask({
      protocolVersion: 1,
      jobId: 'job_1',
      stageRunId: 'stage_1',
      stageType: 'subtitle',
      idempotencyKey: 'stage_1',
      requestHash: 'a'.repeat(64),
      inputArtifactIds: [],
      options: {},
      providerConfig: { apiKey: 'must-not-appear' }
    })).rejects.toMatchObject({
      code: 'idempotency_key_reused',
      status: 409,
      message: 'Idempotency key was reused'
    });
  });
});

async function listen(
  handler: RequestListener
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not listen');
  return `http://127.0.0.1:${address.port}`;
}
