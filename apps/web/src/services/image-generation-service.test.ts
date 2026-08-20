import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createImageGenerationService } from './image-generation-service.js';

describe('image generation service', () => {
  it('uses authenticated Runtime generation and content endpoints', async () => {
    const request = { prompt: 'A portrait', provider: 'openai' as const, size: '1024x1024' as const, quality: 'medium' as const, count: 2 };
    const post = vi.fn(async () => ({ result: { id: 'image_result' } }));
    const rawGet = vi.fn(async () => new Response('image'));
    const service = createImageGenerationService({ post, rawGet } as unknown as RuntimeClient);

    await service.generate(request);
    await service.openContent('image_result', 1);

    expect(post).toHaveBeenCalledWith('/image-generation/results', request);
    expect(rawGet).toHaveBeenCalledWith('/image-generation/results/image_result/content/1');
  });
});
