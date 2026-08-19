import type { HostBridge, HostNotification } from '../host/bridge.js';
import type { ConnectionConfig } from '../runtime/types.js';
import {
  readJsonFromStorage,
  writeJsonToStorage
} from '../storage/browser-storage.js';

export type NotificationPermissionState =
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported';

export type NotificationSettings = {
  enabled: boolean;
  permission: NotificationPermissionState;
};

type NotificationApi = {
  permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
};

const SETTINGS_KEY = 'opencreator.tasks.notifications.v1';
const UNREAD_KEY = 'opencreator.tasks.unread.v1';

export function createNotificationService(input: {
  hostBridge: HostBridge;
  notificationApi?: NotificationApi;
}) {
  let backgroundActive = false;

  function readSettings(): NotificationSettings {
    const stored = readJsonFromStorage<NotificationSettings>(SETTINGS_KEY);
    const permission = readPermission(input);
    const enabled = input.hostBridge.kind === 'desktop'
      ? stored?.enabled !== false && permission === 'granted'
      : stored?.enabled === true && permission === 'granted';
    return {
      enabled,
      permission
    };
  }

  return {
    getSettings: readSettings,

    async enable(): Promise<NotificationSettings> {
      let permission = readPermission(input);
      if (
        input.hostBridge.kind === 'browser'
        && permission === 'default'
        && input.notificationApi !== undefined
      ) {
        permission = await input.notificationApi.requestPermission();
      }
      const settings: NotificationSettings = {
        enabled: permission === 'granted',
        permission
      };
      writeJsonToStorage(SETTINGS_KEY, settings);
      return settings;
    },

    disable(): NotificationSettings {
      const settings: NotificationSettings = {
        enabled: false,
        permission: readPermission(input)
      };
      writeJsonToStorage(SETTINGS_KEY, settings);
      return settings;
    },

    async notify(message: HostNotification): Promise<boolean> {
      const settings = readSettings();
      if (!settings.enabled) return false;
      await input.hostBridge.notify(message);
      return true;
    },

    async syncBackground(connection: ConnectionConfig | null): Promise<boolean> {
      const configure = input.hostBridge.configureBackgroundNotifications;
      if (input.hostBridge.kind !== 'desktop' || configure === undefined) {
        backgroundActive = false;
        return false;
      }
      const enabled = readSettings().enabled && connection !== null;
      try {
        const result = await configure({ enabled });
        backgroundActive = enabled && result.ok;
      } catch {
        backgroundActive = false;
      }
      return backgroundActive;
    },

    shouldNotifyInForeground(createdBy: string): boolean {
      return createdBy !== 'schedule' || !backgroundActive;
    },

    getUnreadIds(): Set<string> {
      const stored = readJsonFromStorage<unknown>(UNREAD_KEY);
      if (!Array.isArray(stored)) return new Set();
      return new Set(stored.filter((value): value is string => (
        typeof value === 'string' && value.length > 0
      )));
    },

    setUnreadIds(ids: ReadonlySet<string>): void {
      writeJsonToStorage(UNREAD_KEY, [...ids]);
    }
  };
}

function readPermission(input: {
  hostBridge: HostBridge;
  notificationApi?: NotificationApi;
}): NotificationPermissionState {
  if (input.hostBridge.kind === 'desktop') return 'granted';
  return input.notificationApi?.permission ?? 'unsupported';
}
