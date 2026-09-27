import {
  readOpenCreatorConfig,
  resolveStorageSettings,
  resolveUiSettings,
  updateOpenCreatorStorageSettings,
  updateOpenCreatorUiSettings
} from '@opencreator/config';
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
  storageDefaults: OpenCreatorStorageSettings
) {
  return {
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
