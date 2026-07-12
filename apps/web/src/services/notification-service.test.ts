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
});

function hostBridge(notify: HostBridge['notify']): HostBridge {
  return {
    kind: 'browser',
    readConnectionConfig: async () => null,
    openExternal: async () => undefined,
    revealPath: async () => ({ ok: false, code: 'UNSUPPORTED', message: 'test' }),
    notify
  };
}
