import type {
  NotificationAcknowledgeResponse,
  NotificationOutboxItem,
  NotificationOutboxListResponse
} from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  consumeNotificationBatch,
  notificationRoute
} from './notification-host.js';

describe('notification host adapter', () => {
  it('shows a pending batch, acknowledges it, and opens the targeted task route on click', async () => {
    const notification: NotificationOutboxItem = {
      id: 'notification_1',
      cursor: '7',
      kind: 'schedule_waiting_approval',
      title: '日报等待审批',
      body: '需要允许写入 docs/daily',
      threadId: 'thread/task',
      runId: 'run 1',
      approvalId: 'approval 1',
      createdAt: '2026-07-15T00:20:00.000Z'
    };
    const list = vi.fn(async (): Promise<NotificationOutboxListResponse> => ({
      notifications: [notification],
      nextCursor: '7'
    }));
    const acknowledge = vi.fn(async (): Promise<NotificationAcknowledgeResponse> => ({
      acknowledged: 1
    }));
    const clickHandlers: Array<() => Promise<void>> = [];
    const openRoute = vi.fn(async () => undefined);

    await expect(consumeNotificationBatch({
      after: '0',
      client: { list, acknowledge },
      adapter: {
        async show(_message, onClick) {
          clickHandlers.push(onClick);
        },
        openRoute
      }
    })).resolves.toEqual({
      displayed: 1,
      acknowledged: 1,
      nextCursor: '7'
    });

    expect(list).toHaveBeenCalledWith('0', 50);
    expect(acknowledge).toHaveBeenCalledWith(['notification_1']);
    await clickHandlers[0]?.();
    expect(openRoute).toHaveBeenCalledWith(
      '#/thread/thread%2Ftask?runId=run+1&approvalId=approval+1'
    );
  });

  it('builds a thread route without optional targets', () => {
    expect(notificationRoute({
      id: 'notification_2',
      cursor: '8',
      kind: 'schedule_succeeded',
      title: '日报',
      body: '已完成',
      threadId: 'thread_2',
      runId: 'run_2',
      createdAt: '2026-07-15T00:21:00.000Z'
    })).toBe('#/thread/thread_2?runId=run_2');
  });

  it('keeps the previous cursor when the batch was not fully acknowledged', async () => {
    const notification: NotificationOutboxItem = {
      id: 'notification_3',
      cursor: '9',
      kind: 'schedule_failed',
      title: '日报失败',
      body: '请查看详情',
      threadId: 'thread_3',
      runId: 'run_3',
      createdAt: '2026-07-15T00:22:00.000Z'
    };

    await expect(consumeNotificationBatch({
      after: '4',
      client: {
        async list() {
          return { notifications: [notification], nextCursor: '9' };
        },
        async acknowledge() {
          return { acknowledged: 0 };
        }
      },
      adapter: {
        async show() {
          return;
        },
        async openRoute() {
          return;
        }
      }
    })).resolves.toMatchObject({
      displayed: 1,
      acknowledged: 0,
      nextCursor: '4'
    });
  });
});
