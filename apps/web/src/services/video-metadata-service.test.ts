import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createVideoMetadataService } from './video-metadata-service.js';

describe('video metadata service', () => {
  it('requests metadata through the shared Runtime API', async () => {
    const get = vi.fn(async () => ({
      platform: 'youtube' as const,
      title: 'Video title',
      authorName: 'Creator',
      thumbnailUrl: 'https://i.ytimg.com/vi/video_123/hqdefault.jpg'
    }));
    const service = createVideoMetadataService({ get } as unknown as RuntimeClient);

    await expect(service.getVideoMetadata('https://youtu.be/video_123')).resolves.toMatchObject({
      title: 'Video title'
    });
    expect(get).toHaveBeenCalledWith(
      '/video-metadata?url=https%3A%2F%2Fyoutu.be%2Fvideo_123'
    );
  });
});
