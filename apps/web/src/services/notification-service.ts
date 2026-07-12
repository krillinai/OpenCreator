import type { HostBridge } from '../host/bridge.js';
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

const SETTINGS_KEY = 'clawee.tasks.notifications.v1';
const UNREAD_KEY = 'clawee.tasks.unread.v1';

export function createNotificationService(input: {
  hostBridge: HostBridge;
  notificationApi?: NotificationApi;
}) {
  function readSettings(): NotificationSettings {
    const stored = readJsonFromStorage<NotificationSettings>(SETTINGS_KEY);
    const permission = readPermission(input);
    return {
      enabled: stored?.enabled === true && permission === 'granted',
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

    async notify(message: {
      title: string;
      body: string;
      threadId?: string;
      runId?: string;
    }): Promise<boolean> {
      const settings = readSettings();
      if (!settings.enabled) return false;
      await input.hostBridge.notify(message);
      return true;
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
