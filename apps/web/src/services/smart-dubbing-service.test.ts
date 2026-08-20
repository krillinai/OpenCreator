import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createSmartDubbingService } from './smart-dubbing-service.js';

describe('smart dubbing service', () => {
  it('uses the authenticated Runtime generation and content endpoints', async () => {
    const result = {
      id: 'result_123456',
      fileName: 'dubbing.mp3',
      mime: 'audio/mpeg' as const,
      size: 12,
      provider: 'openai' as const,
      model: 'gpt-4o-mini-tts',
      voice: 'nova' as const,
      style: 'natural' as const,
      speed: 1,
      format: 'mp3' as const,
      characterCount: 12,
      createdAt: '2026-08-20T00:00:00.000Z'
    };
    const post = vi.fn(async () => ({ result }));
    const rawGet = vi.fn(async () => new Response('audio'));
    const rawRequest = vi.fn(async () => new Response('preview-audio'));
    const service = createSmartDubbingService({ post, rawGet, rawRequest } as unknown as RuntimeClient);
    const request = {
      text: 'Hello world',
      voice: 'nova' as const,
      style: 'natural' as const,
      speed: 1,
      format: 'mp3' as const
    };

    await expect(service.generate(request)).resolves.toEqual({ result });
    await service.preview(request);
    await service.openContent(result.id);

    expect(post).toHaveBeenCalledWith('/smart-dubbing/results', request);
    expect(rawRequest).toHaveBeenCalledWith('/smart-dubbing/preview', {
      method: 'POST',
      body: request
    });
    expect(rawGet).toHaveBeenCalledWith('/smart-dubbing/results/result_123456/content');
  });
});
