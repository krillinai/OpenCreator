import { describe, expect, it, vi } from 'vitest';
import { ApiClientError, RuntimeClient } from './client.js';

describe('RuntimeClient', () => {
  it('rawGet sends authorization header for authenticated requests', async () => {
    const fetchMock = vi.fn(async () => new Response('plain text', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    const response = await client.rawGet('/workspace/files/blob?threadId=t1&path=img.png');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:60855/workspace/files/blob?threadId=t1&path=img.png',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' })
      })
    );
  });

  it('rawGet forwards an abort signal to the underlying request', async () => {
    const fetchMock = vi.fn(async () => new Response('stream', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
    const client = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      token: 'tok',
      fetchImpl: fetchMock
    });
    const controller = new AbortController();

    await client.rawGet('/creator/jobs/job_1/events', {
      signal: controller.signal
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:60855/creator/jobs/job_1/events',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('sends authorization header for authenticated requests', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ codexVersion: 'test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    await client.get('/codex/status');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:60855/codex/status', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' })
    }));
  });

  it('does not send authorization header for healthz', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    await client.get('/healthz');

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:60855/healthz', expect.objectContaining({
      headers: expect.not.objectContaining({ Authorization: expect.any(String) })
    }));
  });

  it('throws ApiClientError for Runtime error responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' }
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'bad', fetchImpl: fetchMock });

    await expect(client.get('/runs')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401
    });
  });

  it('throws ApiClientError for successful responses containing an error envelope', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'RUN_NOT_FOUND',
        message: 'Run was not found'
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      token: 'tok',
      fetchImpl: fetchMock
    });

    await expect(client.get('/runs/missing')).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
      status: 500
    });
  });

  it('preserves Fastify top-level error details', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      statusCode: 500,
      code: '-32600',
      error: 'Internal Server Error',
      message: 'thread not loaded: codex-thread-persisted'
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      token: 'tok',
      fetchImpl: fetchMock
    });

    await expect(client.get('/threads/thread/history'))
      .rejects.toMatchObject({
        status: 500,
        code: '-32600',
        message: 'thread not loaded: codex-thread-persisted'
      });
  });

  it('throws ApiClientError for non-JSON error responses', async () => {
    const fetchMock = vi.fn(async () => new Response('Internal Server Error', {
      status: 500,
      headers: { 'content-type': 'text/plain' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    const request = client.get('/runs');

    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({
      status: 500,
      code: 'HTTP_ERROR'
    });
  });

  it('rawRequest throws ApiClientError for Runtime error responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' }
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'bad', fetchImpl: fetchMock });

    await expect(client.rawRequest('/runs', { method: 'GET' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401
    });
  });

  it('classifies a local configuration conflict without claiming an upstream rejection', async () => {
    const client = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'IMAGE_GENERATION_CONFIG_REQUIRED', message: 'private config path' }
      }), { status: 409 }))
    });
    await expect(client.get('/image-generation/results')).rejects.toMatchObject({
      code: 'IMAGE_GENERATION_CONFIG_REQUIRED',
      issue: {
        publicFacts: { kind: 'configuration', httpStatus: 409 },
        fallbackMessage: expect.stringContaining('配置')
      }
    });
  });

  it('preserves a server issue and normalizes legacy network and parse failures', async () => {
    const serverIssue = {
      id: 'issue-1',
      diagnosticId: 'OC-12345678',
      code: 'creator_upload_failed',
      scope: { kind: 'creator-job' as const, jobId: 'job-1' },
      source: 'upload' as const,
      category: 'execution' as const,
      severity: 'error' as const,
      status: 'open' as const,
      operation: 'creator.upload-source',
      summaryKey: 'issue.upload_failed',
      summaryParams: {},
      fallbackMessage: 'Upload failed.',
      retryable: false,
      repairActions: [],
      fingerprint: 'sha256-demo',
      occurrenceCount: 1,
      occurredAt: '2026-09-23T00:00:00.000Z',
      lastOccurredAt: '2026-09-23T00:00:00.000Z'
    };
    const serverClient = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'secret upstream body', issue: serverIssue }
      }), { status: 500 }))
    });
    await expect(serverClient.get('/creator/jobs/job-1')).rejects.toMatchObject({ issue: serverIssue });

    const factsClient = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: {
          code: 'IMAGE_GENERATION_UPSTREAM_ERROR', message: 'private provider response',
          issue: serverIssue,
          publicFacts: { kind: 'rate-limited', provider: 'openai', httpStatus: 429 }
        }
      }), { status: 502 }))
    });
    await expect(factsClient.get('/creator/jobs/job-1')).rejects.toMatchObject({
      issue: { ...serverIssue, publicFacts: { kind: 'rate-limited', provider: 'openai', httpStatus: 429 } }
    });

    const parseClient = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      fetchImpl: vi.fn(async () => new Response('{not-json', { status: 200 }))
    });
    await expect(parseClient.get('/projects')).rejects.toMatchObject({
      code: 'INVALID_JSON_RESPONSE',
      issue: expect.objectContaining({
        scope: { kind: 'page', surface: 'projects' },
        diagnosticId: expect.not.stringContaining('FNV1A'),
        fallbackMessage: expect.not.stringContaining('not-json')
      })
    });

    const networkClient = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      fetchImpl: vi.fn(async () => { throw new TypeError('Authorization: Bearer secret'); })
    });
    await expect(networkClient.get('/projects')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      issue: expect.objectContaining({ source: 'network' })
    });
  });

  it('does not turn a caller abort into an issue', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('aborted', 'AbortError');
    const client = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      fetchImpl: vi.fn(async () => { throw abort; })
    });

    await expect(client.rawGet('/creator/jobs/job-1/events', { signal: controller.signal }))
      .rejects.toBe(abort);
  });

  it('request sends JSON body through rawRequest-compatible fetch behavior', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({ baseUrl: 'http://127.0.0.1:60855', token: 'tok', fetchImpl: fetchMock });

    await client.post('/workspace/files/content', { path: 'a.txt', content: 'hello' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:60855/workspace/files/content',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ path: 'a.txt', content: 'hello' })
      })
    );
  });

  it('postBinary sends authenticated bytes without JSON serialization', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    }));
    const client = new RuntimeClient({
      baseUrl: 'http://127.0.0.1:60855',
      token: 'tok',
      fetchImpl: fetchMock
    });
    const payload = new Blob(['hello'], { type: 'text/plain' });

    await client.postBinary('/attachments?draftId=draft-1', payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:60855/attachments?draftId=draft-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Content-Type': 'application/octet-stream'
        }),
        body: payload
      })
    );
  });
});
