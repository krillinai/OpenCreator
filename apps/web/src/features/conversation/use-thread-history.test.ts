import type { ThreadHistoryResponse } from '@opencreator/protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useThreadHistory } from './use-thread-history.js';

describe('useThreadHistory', () => {
  it('loads only the latest page first and prepends older pages without duplicates', async () => {
    const getThreadHistory = vi.fn(async (
      threadId: string,
      query?: { limit?: number; before?: string }
    ): Promise<ThreadHistoryResponse> => {
      if (query?.before === 'cursor_older') {
        return {
          threadId,
          codexThreadId: 'codex_thread_1',
          items: [
            historyMessage('history_1', '更早的消息'),
            historyMessage('history_2', '分页边界消息')
          ],
          hasMore: false
        };
      }
      return {
        threadId,
        codexThreadId: 'codex_thread_1',
        items: [
          historyMessage('history_2', '分页边界消息'),
          historyMessage('history_3', '最新消息')
        ],
        hasMore: true,
        nextCursor: 'cursor_older'
      };
    });
    const { result } = renderHook(() => useThreadHistory({
      threadId: 'thread_1',
      enabled: true,
      service: { getThreadHistory }
    }));

    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(getThreadHistory).toHaveBeenNthCalledWith(1, 'thread_1', { limit: 50 });
    expect(result.current.items.map(item => item.id)).toEqual(['history_2', 'history_3']);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(getThreadHistory).toHaveBeenNthCalledWith(2, 'thread_1', {
      limit: 50,
      before: 'cursor_older'
    });
    expect(result.current.items.map(item => item.id)).toEqual([
      'history_1',
      'history_2',
      'history_3'
    ]);
    expect(result.current.hasMore).toBe(false);
  });

  it('ignores a slower response after switching threads', async () => {
    let resolveThreadA: ((response: ThreadHistoryResponse) => void) | undefined;
    const getThreadHistory = vi.fn((
      threadId: string
    ): Promise<ThreadHistoryResponse> => {
      if (threadId === 'thread_a') {
        return new Promise(resolve => {
          resolveThreadA = resolve;
        });
      }
      return Promise.resolve({
        threadId,
        items: [historyMessage('thread_b_message', '会话 B')]
      });
    });
    const { result, rerender } = renderHook(
      ({ threadId }) => useThreadHistory({
        threadId,
        enabled: true,
        service: { getThreadHistory }
      }),
      { initialProps: { threadId: 'thread_a' } }
    );

    rerender({ threadId: 'thread_b' });
    await waitFor(() => expect(result.current.items[0]?.id).toBe('thread_b_message'));

    await act(async () => {
      resolveThreadA?.({
        threadId: 'thread_a',
        items: [historyMessage('thread_a_message', '会话 A')]
      });
      await Promise.resolve();
    });

    expect(result.current.threadId).toBe('thread_b');
    expect(result.current.items.map(item => item.id)).toEqual(['thread_b_message']);
  });

  it('loads a bounded window around a search target item', async () => {
    const getThreadHistory = vi.fn(async (
      threadId: string
    ): Promise<ThreadHistoryResponse> => ({
      threadId,
      items: [historyMessage('target-item', '目标消息')],
      hasMore: true,
      nextCursor: 'older-cursor',
      targetItemId: 'target-item'
    }));
    const { result } = renderHook(() => useThreadHistory({
      threadId: 'thread_1',
      targetItemId: 'target-item',
      enabled: true,
      service: { getThreadHistory }
    }));

    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(getThreadHistory).toHaveBeenCalledWith('thread_1', {
      limit: 50,
      targetItemId: 'target-item'
    });
    expect(result.current.items.map(item => item.id)).toEqual(['target-item']);
    expect(result.current.hasMore).toBe(true);
  });
});

function historyMessage(id: string, text: string) {
  return {
    id,
    type: 'user_message' as const,
    text,
    createdAt: '2026-07-12T00:00:00.000Z'
  };
}
