import {
  readOpenCreatorConfig,
  resolveStorageSettings,
  resolveUiSettings,
  updateOpenCreatorStorageSettings,
  updateOpenCreatorUiSettings
} from '@opencreator/config';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  OpenCreatorStorageSettings,
  OpenCreatorStorageSettingsResponse,
  OpenCreatorUiSettingsResponse,
  UpdateOpenCreatorStorageSettingsRequest,
  UpdateOpenCreatorUiSettingsRequest
} from '@opencreator/protocol';

export type OpenCreatorSettingsStore = ReturnType<typeof createOpenCreatorSettingsStore>;

export function createOpenCreatorSettingsStore(
  configFile: string,
  storageDefaults: OpenCreatorStorageSettings,
  existingProfile = false
) {
  return {
    claimAgentOnboarding(offer: boolean): boolean {
      const directory = dirname(configFile);
      try {
        mkdirSync(directory, { recursive: true });
        closeSync(openSync(join(directory, 'agent-onboarding-v1'), 'wx', 0o600));
        return offer && !existingProfile;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw cause;
      }
    },
    readUi(): OpenCreatorUiSettingsResponse {
      const snapshot = readOpenCreatorConfig(configFile);
      return {
        settings: resolveUiSettings(snapshot),
        configured: snapshot.configured.ui
      };
    },
    updateUi(update: UpdateOpenCreatorUiSettingsRequest): OpenCreatorUiSettingsResponse {
      const snapshot = updateOpenCreatorUiSettings(configFile, update);
      return {
        settings: resolveUiSettings(snapshot),
        configured: true
      };
    },
    readStorage(): OpenCreatorStorageSettingsResponse {
      const snapshot = readOpenCreatorConfig(configFile);
      return {
        settings: resolveStorageSettings(snapshot, storageDefaults),
        configured: snapshot.configured.storage
      };
    },
    updateStorage(
      update: UpdateOpenCreatorStorageSettingsRequest
    ): OpenCreatorStorageSettingsResponse {
      const current = resolveStorageSettings(readOpenCreatorConfig(configFile), storageDefaults);
      const snapshot = updateOpenCreatorStorageSettings(configFile, { ...current, ...update });
      return {
        settings: resolveStorageSettings(snapshot, storageDefaults),
        configured: true
      };
    }
  };
}
