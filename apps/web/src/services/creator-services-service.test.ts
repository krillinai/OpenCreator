import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createCreatorServicesService } from './creator-services-service.js';

describe('creator services service', () => {
  it('uses the authenticated Runtime configuration endpoints', async () => {
    const config = createDefaultCreatorServicesConfig();
    const get = vi.fn();
    const patch = vi.fn();
    const remove = vi.fn();
    const client = {
      get<T>(): Promise<T> {
        get();
        return Promise.resolve({ config } as T);
      },
      patch<T>(_path: string, _body: unknown): Promise<T> {
        patch(_path, _body);
        return Promise.resolve({ config } as T);
      },
      delete<T>(_path: string): Promise<T> {
        remove(_path);
        return Promise.resolve({ config } as T);
      }
    };
    const service = createCreatorServicesService(client);

    await service.getConfig();
    await service.saveConfig(config);
    await service.resetConfig();

    expect(get).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/creator-services/config', config);
    expect(remove).toHaveBeenCalledWith('/creator-services/config');
  });
});
