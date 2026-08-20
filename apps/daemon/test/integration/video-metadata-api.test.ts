import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVideoMetadataRoutes } from '../../src/api/routes.video-metadata.js';
import {
  createVideoMetadataService,
  VideoMetadataError
} from '../../src/video-metadata/service.js';

describe('video metadata API', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns normalized YouTube title information without fetching the submitted URL', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      title: '  A useful video title  ',
      author_name: 'Creator name',
      width: 1920,
      height: 1080
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await registerVideoMetadataRoutes(server, createVideoMetadataService({
      fetchImpl: fetchImpl as typeof fetch
    }));

    const response = await server.inject({
      method: 'GET',
      url: '/video-metadata?url=https%3A%2F%2Fyoutu.be%2Fvideo_123'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      platform: 'youtube',
      title: 'A useful video title',
      authorName: 'Creator name',
      thumbnailUrl: 'https://i.ytimg.com/vi/video_123/hqdefault.jpg',
      width: 1920,
      height: 1080
    });
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://www.youtube.com/oembed');
    expect(requestedUrl.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=video_123');
  });

  it('rejects unsupported links without making an upstream request', async () => {
    const fetchImpl = vi.fn();
    await registerVideoMetadataRoutes(server, createVideoMetadataService({
      fetchImpl: fetchImpl as typeof fetch
    }));

    const response = await server.inject({
      method: 'GET',
      url: '/video-metadata?url=https%3A%2F%2Fexample.com%2Fvideo'
    });

    expect(response.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns title information for a Bilibili video', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      code: 0,
      data: {
        title: 'Bilibili video title',
        owner: { name: 'Bilibili creator' },
        pic: 'https://i0.hdslb.com/bfs/archive/example.jpg',
        dimension: { width: 1080, height: 1920, rotate: 0 }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await registerVideoMetadataRoutes(server, createVideoMetadataService({
      fetchImpl: fetchImpl as typeof fetch
    }));

    const response = await server.inject({
      method: 'GET',
      url: '/video-metadata?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'bilibili',
      title: 'Bilibili video title',
      authorName: 'Bilibili creator',
      width: 1080,
      height: 1920
    });
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://api.bilibili.com/x/web-interface/view');
    expect(requestedUrl.searchParams.get('bvid')).toBe('BV1xx411c7mD');
  });

  it('normalizes rotated Bilibili dimensions', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        title: 'Rotated video',
        dimension: { width: 1920, height: 1080, rotate: 90 }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await registerVideoMetadataRoutes(server, createVideoMetadataService({
      fetchImpl: fetchImpl as typeof fetch
    }));

    const response = await server.inject({
      method: 'GET',
      url: '/video-metadata?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx411c7mD'
    });

    expect(response.json()).toMatchObject({ width: 1080, height: 1920 });
  });

  it('maps unavailable upstream metadata to a recoverable API error', async () => {
    await registerVideoMetadataRoutes(server, {
      async get() {
        throw new VideoMetadataError('UPSTREAM_ERROR', 'Video metadata request failed');
      }
    });

    const response = await server.inject({
      method: 'GET',
      url: '/video-metadata?url=https%3A%2F%2Fyoutu.be%2Fvideo_123'
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: {
        code: 'VIDEO_METADATA_UNAVAILABLE',
        message: 'Video metadata request failed'
      }
    });
  });
});
