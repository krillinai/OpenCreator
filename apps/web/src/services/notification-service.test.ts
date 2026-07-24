import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostBridge } from '../host/bridge.js';
import { createNotificationService } from './notification-service.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('NotificationService', () => {
  it('requires an explicit permission request before enabling browser notifications', async () => {
    const notify = vi.fn(async () => undefined);
    const api = {
      permission: 'default' as NotificationPermission,
      requestPermission: vi.fn(async () => {
        api.permission = 'granted';
        return 'granted' as NotificationPermission;
      })
    };
    const service = createNotificationService({
      hostBridge: hostBridge(notify),
      notificationApi: api
    });

    expect(service.getSettings()).toEqual({
      enabled: false,
      permission: 'default'
    });
    await expect(service.enable()).resolves.toEqual({
      enabled: true,
      permission: 'granted'
    });
    await expect(service.notify({
      title: '任务完成',
      body: '构建已经完成',
      threadId: 'thread_1',
      runId: 'run_1'
    })).resolves.toBe(true);

    expect(api.requestPermission).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      title: '任务完成',
      body: '构建已经完成',
      threadId: 'thread_1',
      runId: 'run_1'
    });
  });

  it('persists unread task ids and supports clearing them', () => {
    const service = createNotificationService({
      hostBridge: hostBridge(vi.fn())
    });

    service.setUnreadIds(new Set(['run_1', 'run_2']));
    expect(service.getUnreadIds()).toEqual(new Set(['run_1', 'run_2']));

    service.setUnreadIds(new Set());
    expect(service.getUnreadIds()).toEqual(new Set());
  });

  it('enables desktop notifications by default and honors manual disable', async () => {
    const notify = vi.fn(async () => undefined);
    const service = createNotificationService({
      hostBridge: hostBridge(notify, 'desktop')
    });

    expect(service.getSettings()).toEqual({
      enabled: true,
      permission: 'granted'
    });
    await expect(service.notify({
      title: '喝水提醒',
      body: '该喝水了。',
      threadId: 'thread_1',
      runId: 'run_1'
    })).resolves.toBe(true);
    expect(notify).toHaveBeenCalledWith({
      title: '喝水提醒',
      body: '该喝水了。',
      threadId: 'thread_1',
      runId: 'run_1'
    });

    expect(service.disable()).toEqual({
      enabled: false,
      permission: 'granted'
    });
    await expect(service.notify({
      title: '已安排提醒',
      body: '喝水提醒'
    })).resolves.toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('hands the daemon connection to a desktop background subscriber and avoids duplicate schedule notifications', async () => {
    const configureBackgroundNotifications = vi.fn(async () => ({ ok: true as const }));
    const service = createNotificationService({
      hostBridge: {
        ...hostBridge(vi.fn(), 'desktop'),
        configureBackgroundNotifications
      }
    });

    await expect(service.syncBackground({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    })).resolves.toBe(true);
    expect(configureBackgroundNotifications).toHaveBeenCalledWith({
      enabled: true
    });
    expect(service.shouldNotifyInForeground('schedule')).toBe(false);
    expect(service.shouldNotifyInForeground('api')).toBe(true);

    service.disable();
    await expect(service.syncBackground({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    })).resolves.toBe(false);
    expect(configureBackgroundNotifications).toHaveBeenLastCalledWith({
      enabled: false
    });
    expect(service.shouldNotifyInForeground('schedule')).toBe(true);
  });
});

function hostBridge(
  notify: HostBridge['notify'],
  kind: HostBridge['kind'] = 'browser'
): HostBridge {
  return {
    kind,
    readConnectionConfig: async () => null,
    openExternal: async () => undefined,
    revealPath: async () => ({ ok: false, code: 'UNSUPPORTED', message: 'test' }),
    notify
  };
}
