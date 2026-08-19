import type {
  ConversationSearchQuery,
  ConversationSearchResponse,
  ConversationSearchResult,
  ThreadResponse,
} from '@opencreator/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchView, type SearchViewService } from './SearchView.js';

describe('SearchView', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows recent conversations before the user starts searching', () => {
    const searchConversations = vi.fn();
    const onOpenResult = vi.fn();
    renderSearch({
      onOpenResult,
      recentThreads: [
        thread({
          id: 'thread-recent-1',
          title: '梳理 AI 任务创建逻辑',
          projectId: 'customer-agent',
          cwd: '/workspace/customer-agent',
        }),
        thread({
          id: 'thread-recent-2',
          title: '启动服务',
          projectId: 'opencreator-agent',
          cwd: '/workspace/opencreator-agent',
        }),
      ],
      service: { searchConversations },
    });

    expect(screen.getByRole('heading', { name: '最近会话' })).toBeInTheDocument();
    expect(screen.getByText('梳理 AI 任务创建逻辑')).toBeInTheDocument();
    expect(screen.getByText('customer-agent')).toBeInTheDocument();
    expect(screen.queryByLabelText('项目范围')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('内容类型')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('时间范围')).not.toBeInTheDocument();
    expect(searchConversations).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', {
      name: /梳理 AI 任务创建逻辑/,
    }));
    expect(onOpenResult).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-recent-1',
      itemType: 'title',
    }));
  });

  it('debounces input and renders a compact highlighted conversation result', async () => {
    vi.useFakeTimers();
    const searchConversations = vi.fn(async (): Promise<ConversationSearchResponse> => ({
      results: [
        result({
          itemId: 'item-1',
          snippet: [
            { text: '刷新后', highlighted: false },
            { text: '页面卡住', highlighted: true },
          ],
        }),
      ],
      hasMore: false,
    }));
    renderSearch({ service: { searchConversations } });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '页面卡住' },
    });
    expect(searchConversations).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(searchConversations).toHaveBeenCalledWith({
      query: '页面卡住',
      limit: 20,
    });
    expect(screen.getByText('页面卡住').tagName).toBe('MARK');
    expect(screen.getByText('当前项目')).toBeInTheDocument();
    expect(screen.queryByText('我的消息')).not.toBeInTheDocument();
    expect(screen.queryByText('/workspace/current')).not.toBeInTheDocument();
  });

  it('ignores a slower response from an older query', async () => {
    vi.useFakeTimers();
    let resolveOld: ((response: ConversationSearchResponse) => void) | undefined;
    let resolveNew: ((response: ConversationSearchResponse) => void) | undefined;
    const searchConversations = vi.fn((query: ConversationSearchQuery) => (
      new Promise<ConversationSearchResponse>(resolve => {
        if (query.query === '旧查询') resolveOld = resolve;
        else resolveNew = resolve;
      })
    ));
    renderSearch({ service: { searchConversations } });
    const input = screen.getByRole('searchbox', { name: '搜索会话' });

    fireEvent.change(input, { target: { value: '旧查询' } });
    await act(async () => vi.advanceTimersByTime(250));
    fireEvent.change(input, { target: { value: '新查询' } });
    await act(async () => vi.advanceTimersByTime(250));

    await act(async () => {
      resolveNew?.({
        results: [result({ title: '新结果', itemId: 'new-item' })],
        hasMore: false,
      });
      await Promise.resolve();
    });
    await act(async () => {
      resolveOld?.({
        results: [result({ title: '旧结果', itemId: 'old-item' })],
        hasMore: false,
      });
      await Promise.resolve();
    });

    expect(screen.getByText('新结果')).toBeInTheDocument();
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument();
  });

  it('deduplicates conversations and appends the next page', async () => {
    vi.useFakeTimers();
    const searchConversations = vi.fn(async (
      query: ConversationSearchQuery
    ): Promise<ConversationSearchResponse> => (
      query.cursor === undefined
        ? {
            results: [
              result({ threadId: 'thread-1', title: '第一页', itemId: 'first-item' }),
              result({ threadId: 'thread-1', title: '第一页', itemId: 'duplicate-item' }),
            ],
            hasMore: true,
            nextCursor: 'next-page',
          }
        : {
            results: [
              result({ threadId: 'thread-2', title: '第二页', itemId: 'second-item' }),
            ],
            hasMore: false,
          }
    ));
    renderSearch({ service: { searchConversations } });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '共同关键词' },
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(screen.getAllByText('第一页')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }));
      await Promise.resolve();
    });

    expect(searchConversations).toHaveBeenLastCalledWith({
      query: '共同关键词',
      limit: 20,
      cursor: 'next-page',
    });
    expect(screen.getByText('第二页')).toBeInTheDocument();
  });

  it('opens the active result with keyboard or click', async () => {
    vi.useFakeTimers();
    const onOpenResult = vi.fn();
    const results = [
      result({ threadId: 'thread-1', title: '第一条结果', itemId: 'first-item' }),
      result({ threadId: 'thread-2', title: '第二条结果', itemId: 'second-item' }),
    ];
    renderSearch({
      onOpenResult,
      service: {
        searchConversations: vi.fn(async () => ({ results, hasMore: false })),
      },
    });
    const input = screen.getByRole('searchbox', { name: '搜索会话' });
    fireEvent.change(input, { target: { value: '结果' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpenResult).toHaveBeenCalledWith(results[1]);

    fireEvent.click(
      within(screen.getByTestId('search-result-first-item')).getByRole('button')
    );
    expect(onOpenResult).toHaveBeenLastCalledWith(results[0]);
  });

  it('shows disconnected, error, and empty states', async () => {
    const { rerender } = renderSearch({ connected: false, service: null });
    expect(screen.getByText('连接本地服务后可以搜索会话')).toBeInTheDocument();

    vi.useFakeTimers();
    const service: SearchViewService = {
      searchConversations: vi.fn(async () => {
        throw new Error('failed');
      }),
    };
    rerender(createView({ connected: true, service }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '没有结果' },
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('无法搜索会话');
  });
});

function renderSearch(overrides: Partial<Parameters<typeof createView>[0]> = {}) {
  return render(createView(overrides));
}

function createView(overrides: {
  connected?: boolean;
  service?: SearchViewService | null;
  recentThreads?: ThreadResponse[];
  onOpenResult?(result: ConversationSearchResult): void;
} = {}) {
  return (
    <SearchView
      connected={overrides.connected ?? true}
      service={overrides.service ?? {
        searchConversations: async () => ({ results: [], hasMore: false }),
      }}
      projects={[
        {
          id: 'current',
          name: '当前项目',
          cwd: '/workspace/current',
          sandbox: 'follow-global',
          profile: 'default',
          model: null,
          reasoning: null,
        },
        {
          id: 'customer-agent',
          name: 'customer-agent',
          cwd: '/workspace/customer-agent',
          sandbox: 'follow-global',
          profile: 'default',
          model: null,
          reasoning: null,
        },
        {
          id: 'opencreator-agent',
          name: 'opencreator-agent',
          cwd: '/workspace/opencreator-agent',
          sandbox: 'follow-global',
          profile: 'default',
          model: null,
          reasoning: null,
        },
      ]}
      recentThreads={overrides.recentThreads ?? []}
      onOpenResult={overrides.onOpenResult ?? vi.fn()}
    />
  );
}

function thread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread-recent',
    title: '最近会话',
    projectId: 'current',
    origin: 'opencreator_created',
    codexThreadId: 'codex-recent',
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    ...overrides,
  };
}

function result(
  overrides: Partial<ConversationSearchResult> = {}
): ConversationSearchResult {
  return {
    threadId: 'thread-1',
    projectId: 'current',
    codexThreadId: 'codex-thread-1',
    title: '搜索结果',
    cwd: '/workspace/current',
    itemId: 'item-1',
    itemType: 'user_message',
    createdAt: '2026-07-12T12:00:00.000Z',
    snippet: [{ text: '结果片段', highlighted: false }],
    ...overrides,
  };
}
