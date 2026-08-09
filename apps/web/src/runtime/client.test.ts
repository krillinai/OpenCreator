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
        code: 'ENTERPRISE_PROTOCOL_ERROR',
        message: 'Enterprise knowledge operation failed'
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

    await expect(client.get('/enterprise/knowledge-bases')).rejects.toMatchObject({
      code: 'ENTERPRISE_PROTOCOL_ERROR',
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

    await expect(client.get('/enterprise/knowledge-conversations/thread/history'))
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
