import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsStore,
  type SettingsPersistence
} from '../src/main/settings-store.js';

describe('SettingsStore', () => {
  it('uses defaults when persisted JSON is corrupt', () => {
    const persistence: SettingsPersistence = {
      read: () => '{broken',
      writeAtomic: vi.fn()
    };
    const store = createSettingsStore('/virtual/settings.json', persistence);

    expect(store.read()).toMatchObject({
      closeBehavior: 'hide',
      notificationsEnabled: true
    });
  });

  it('writes normalized settings through the injected atomic adapter', () => {
    const writeAtomic = vi.fn();
    const persistence: SettingsPersistence = {
      read: () => JSON.stringify({
        closeBehavior: 'hide',
        notificationsEnabled: true
      }),
      writeAtomic
    };
    const store = createSettingsStore('/virtual/settings.json', persistence);

    store.update({ closeBehavior: 'quit' });

    expect(writeAtomic).toHaveBeenCalledWith(
      '/virtual/settings.json',
      expect.stringContaining('"closeBehavior": "quit"')
    );
  });
});
