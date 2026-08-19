import type {
  ThreadHistoryItem,
  ThreadHistoryQuery,
  ThreadHistoryResponse
} from '@opencreator/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

const HISTORY_PAGE_SIZE = 50;

export type ThreadHistoryService = {
  getThreadHistory(
    threadId: string,
    query?: ThreadHistoryQuery
  ): Promise<ThreadHistoryResponse>;
};

type ThreadHistoryState = {
  threadId?: string;
  items: ThreadHistoryItem[];
  initialLoading: boolean;
  loadingOlder: boolean;
  loaded: boolean;
  hasMore: boolean;
  nextCursor?: string;
  codexThreadId?: string | null;
  error?: string;
};

export function useThreadHistory(input: {
  threadId?: string;
  targetItemId?: string;
  enabled: boolean;
  service: ThreadHistoryService | null;
  reloadKey?: number;
  consumeSkipInitialLoad?(threadId: string): boolean;
}) {
  const [state, setState] = useState<ThreadHistoryState>(() => emptyState(input.threadId));
  const stateRef = useRef(state);
  const requestGenerationRef = useRef(0);
  const getThreadHistory = input.service?.getThreadHistory;
  stateRef.current = state;

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    const threadId = input.threadId;

    if (!input.enabled || threadId === undefined || getThreadHistory === undefined) {
      const next = emptyState(threadId);
      stateRef.current = next;
      setState(next);
      return;
    }

    if (input.consumeSkipInitialLoad?.(threadId) === true) {
      const next: ThreadHistoryState = {
        ...emptyState(threadId),
        loaded: true
      };
      stateRef.current = next;
      setState(next);
      return;
    }

    const loading: ThreadHistoryState = {
      ...emptyState(threadId),
      initialLoading: true
    };
    stateRef.current = loading;
    setState(loading);

    let canceled = false;
    void getThreadHistory(threadId, {
      limit: HISTORY_PAGE_SIZE,
      ...(input.targetItemId === undefined ? {} : { targetItemId: input.targetItemId })
    })
      .then(response => {
        if (
          canceled
          || generation !== requestGenerationRef.current
          || response.threadId !== threadId
        ) {
          return;
        }
        const next: ThreadHistoryState = {
          threadId,
          items: response.items,
          initialLoading: false,
          loadingOlder: false,
          loaded: true,
          hasMore: response.hasMore === true,
          ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor }),
          ...(response.codexThreadId === undefined
            ? {}
            : { codexThreadId: response.codexThreadId })
        };
        stateRef.current = next;
        setState(next);
      })
      .catch(() => {
        if (canceled || generation !== requestGenerationRef.current) return;
        const next: ThreadHistoryState = {
          ...emptyState(threadId),
          loaded: true,
          error: '无法加载聊天历史'
        };
        stateRef.current = next;
        setState(next);
      });

    return () => {
      canceled = true;
    };
  }, [
    getThreadHistory,
    input.consumeSkipInitialLoad,
    input.enabled,
    input.reloadKey,
    input.threadId,
    input.targetItemId
  ]);

  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    const threadId = current.threadId;
    const before = current.nextCursor;
    if (
      threadId === undefined
      || before === undefined
      || current.loadingOlder
      || !current.hasMore
      || getThreadHistory === undefined
    ) {
      return;
    }

    const generation = requestGenerationRef.current;
    const loading = {
      ...current,
      loadingOlder: true,
      error: undefined
    };
    stateRef.current = loading;
    setState(loading);

    try {
      const response = await getThreadHistory(threadId, {
        limit: HISTORY_PAGE_SIZE,
        before
      });
      if (
        generation !== requestGenerationRef.current
        || response.threadId !== threadId
      ) {
        return;
      }
      const latest = stateRef.current;
      const existingIds = new Set(latest.items.map(item => item.id));
      const olderItems = response.items.filter(item => !existingIds.has(item.id));
      const next: ThreadHistoryState = {
        ...latest,
        items: [...olderItems, ...latest.items],
        loadingOlder: false,
        hasMore: response.hasMore === true,
        nextCursor: response.nextCursor,
        ...(response.codexThreadId === undefined
          ? {}
          : { codexThreadId: response.codexThreadId })
      };
      stateRef.current = next;
      setState(next);
    } catch {
      if (generation !== requestGenerationRef.current) return;
      const next = {
        ...stateRef.current,
        loadingOlder: false,
        error: '无法加载更早的聊天历史'
      };
      stateRef.current = next;
      setState(next);
    }
  }, [getThreadHistory]);

  return {
    ...state,
    loadOlder
  };
}

function emptyState(threadId?: string): ThreadHistoryState {
  return {
    ...(threadId === undefined ? {} : { threadId }),
    items: [],
    initialLoading: false,
    loadingOlder: false,
    loaded: false,
    hasMore: false
  };
}
