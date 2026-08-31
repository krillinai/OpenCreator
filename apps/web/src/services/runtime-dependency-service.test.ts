import { describe, expect, it, vi } from 'vitest';
import { createRuntimeDependencyService } from './runtime-dependency-service.js';

describe('runtime dependency service', () => {
  it('uses the shared Runtime dependency endpoints', async () => {
    const client = {
      get: vi.fn(async () => ({ ytDlp: {} })),
      post: vi.fn(async () => ({ ytDlp: {} }))
    };
    const service = createRuntimeDependencyService(client);

    await service.getYtDlpStatus();
    await service.checkYtDlpUpdate(false);
    await service.updateYtDlp();

    expect(client.get).toHaveBeenCalledWith('/creator/yt-dlp/status');
    expect(client.post).toHaveBeenNthCalledWith(
      1,
      '/creator/yt-dlp/check',
      { force: false }
    );
    expect(client.post).toHaveBeenNthCalledWith(2, '/creator/yt-dlp/update');
  });
});
