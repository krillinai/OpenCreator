import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createVideoGenerationService } from './video-generation-service.js';

describe('video generation service', () => {
  it('uses authenticated Runtime generation, polling, and content endpoints', async () => {
    const request = { prompt: 'A city reveal', provider: 'veo' as const, size: '1280x720' as const, duration: 8 as const };
    const post = vi.fn(async () => ({ result: { id: 'video_result' } }));
    const get = vi.fn(async () => ({ result: { id: 'video_result', status: 'completed' } }));
    const rawGet = vi.fn(async () => new Response('video'));
    const service = createVideoGenerationService({ post, get, rawGet } as unknown as RuntimeClient);

    await service.generate(request);
    await service.get('video_result');
    await service.openContent('video_result');

    expect(post).toHaveBeenCalledWith('/video-generation/results', request);
    expect(get).toHaveBeenCalledWith('/video-generation/results/video_result');
    expect(rawGet).toHaveBeenCalledWith('/video-generation/results/video_result/content');
  });
});
