import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsStore,
  type SettingsPersistence
} from '../src/main/settings-store.js';
import type { OpenCreatorConfigSnapshot } from '@opencreator/config';

const emptySnapshot = (): OpenCreatorConfigSnapshot => ({
  document: { version: 1 },
  configured: {
    ui: false,
    storage: false,
    desktop: false,
    runtime: false,
    creatorServices: false
  }
});

describe('SettingsStore', () => {
  it('uses defaults when persisted TOML is corrupt', () => {
    const persistence: SettingsPersistence = {
      read: () => {
        throw new Error('broken');
      },
      update: vi.fn(() => emptySnapshot())
    };
    const store = createSettingsStore('/virtual/config.toml', persistence);

    expect(store.read()).toMatchObject({
      closeBehavior: 'hide',
      notificationsEnabled: true,
      telemetryEnabled: true
    });
  });

  it('writes normalized settings through the injected atomic adapter', () => {
    const update = vi.fn((_path, apply) => ({
      ...emptySnapshot(),
      document: apply({ version: 1 })
    }));
    const persistence: SettingsPersistence = {
      read: () => ({
        document: {
          version: 1,
          desktop: {
            closeBehavior: 'hide',
            notificationsEnabled: true,
            telemetryEnabled: true
          }
        },
        configured: {
          ...emptySnapshot().configured,
          desktop: true
        }
      }),
      update
    };
    const store = createSettingsStore('/virtual/config.toml', persistence);

    store.update({
      closeBehavior: 'quit',
      telemetryEnabled: false,
      telemetryInstallId: '123e4567-e89b-42d3-a456-426614174000'
    });

    expect(update).toHaveBeenCalledOnce();
    const apply = update.mock.calls[0]![1];
    expect(apply({ version: 1 }).desktop?.closeBehavior).toBe('quit');
    expect(apply({ version: 1 }).desktop).toMatchObject({
      telemetryEnabled: false,
      telemetryInstallId: '123e4567-e89b-42d3-a456-426614174000'
    });
    expect(store.read().closeBehavior).toBe('quit');
  });

  it('persists fresh-install defaults into config.toml sections', () => {
    const update = vi.fn((_path, apply) => ({
      ...emptySnapshot(),
      document: apply({ version: 1 })
    }));
    const persistence: SettingsPersistence = {
      read: emptySnapshot,
      update
    };

    const store = createSettingsStore('/virtual/config.toml', persistence);

    expect(store.read()).toMatchObject({
      closeBehavior: 'hide',
      notificationsEnabled: true,
      telemetryEnabled: true
    });
    const initialized = update.mock.calls[0]![1]({ version: 1 });
    expect(initialized.desktop).toMatchObject({
      closeBehavior: 'hide',
      notificationsEnabled: true,
      telemetryEnabled: true
    });
    expect(initialized.runtime).toMatchObject({
      codexMode: 'bundled'
    });
  });
});
