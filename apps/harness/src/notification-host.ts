import type {
  NotificationAcknowledgeResponse,
  NotificationOutboxItem,
  NotificationOutboxListResponse
} from '@opencreator/protocol';

export type NotificationOutboxClient = {
  list(after: string, limit: number): Promise<NotificationOutboxListResponse>;
  acknowledge(ids: string[]): Promise<NotificationAcknowledgeResponse>;
};

export type DesktopNotificationAdapter = {
  show(
    notification: NotificationOutboxItem,
    onClick: () => Promise<void>
  ): Promise<void>;
  openRoute(route: string): Promise<void>;
};

export async function consumeNotificationBatch(input: {
  after: string;
  limit?: number;
  client: NotificationOutboxClient;
  adapter: DesktopNotificationAdapter;
}): Promise<{
  displayed: number;
  acknowledged: number;
  nextCursor: string;
}> {
  const page = await input.client.list(input.after, input.limit ?? 50);
  const displayedIds: string[] = [];
  for (const notification of page.notifications) {
    await input.adapter.show(
      notification,
      () => input.adapter.openRoute(notificationRoute(notification))
    );
    displayedIds.push(notification.id);
  }
  const acknowledged = displayedIds.length === 0
    ? 0
    : (await input.client.acknowledge(displayedIds)).acknowledged;
  return {
    displayed: displayedIds.length,
    acknowledged,
    nextCursor: acknowledged === displayedIds.length
      ? page.nextCursor
      : input.after
  };
}

export function notificationRoute(notification: NotificationOutboxItem): string {
  const query = new URLSearchParams();
  query.set('runId', notification.runId);
  if (notification.approvalId !== undefined) {
    query.set('approvalId', notification.approvalId);
  }
  return `#/thread/${encodeURIComponent(notification.threadId)}?${query.toString()}`;
}
