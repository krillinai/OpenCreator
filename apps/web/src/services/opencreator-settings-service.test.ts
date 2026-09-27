import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createOpenCreatorSettingsService } from './opencreator-settings-service.js';

describe('OpenCreator settings service', () => {
  it('uses the Runtime settings endpoints', async () => {
    const get = vi.fn(async () => ({
      configured: true,
      settings: {
        language: 'zh-CN',
        colorMode: 'dark',
        accentColor: 'red',
        customAccentColor: '#3b82f6',
        defaultPermission: 'danger-full-access'
      }
    }));
    const patch = vi.fn(async () => ({
      configured: true,
      settings: {
        language: 'zh-CN',
        colorMode: 'light',
        accentColor: 'red',
        customAccentColor: '#3b82f6',
        defaultPermission: 'danger-full-access'
      }
    }));
    const service = createOpenCreatorSettingsService({
      get: get as RuntimeClient['get'],
      patch: patch as RuntimeClient['patch']
    });

    await service.getUiSettings();
    await service.updateUiSettings({ colorMode: 'light' });
    await service.getStorageSettings();
    await service.updateStorageSettings({ outputRoot: '/tmp/exports' });

    expect(get).toHaveBeenCalledWith('/settings/ui');
    expect(patch).toHaveBeenCalledWith('/settings/ui', {
      colorMode: 'light'
    });
    expect(get).toHaveBeenCalledWith('/settings/storage');
    expect(patch).toHaveBeenCalledWith('/settings/storage', {
      outputRoot: '/tmp/exports'
    });
  });
});
