import type {
  ConversationSearchQuery,
  ConversationSearchResponse,
  ConversationSearchResult
} from '@clawee/protocol';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchView, type SearchViewService } from './SearchView.js';

describe('SearchView', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces input and renders highlighted results', async () => {
    vi.useFakeTimers();
    const searchConversations = vi.fn(async (): Promise<ConversationSearchResponse> => ({
      results: [
        result({
          itemId: 'item-1',
          snippet: [
            { text: '刷新后', highlighted: false },
            { text: '页面卡住', highlighted: true }
          ]
        })
      ],
      hasMore: false
    }));
    renderSearch({ service: { searchConversations } });

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '页面卡住' }
    });
    expect(searchConversations).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(searchConversations).toHaveBeenCalledWith({
      query: '页面卡住',
      limit: 20
    });
    expect(screen.getByText('刷新后')).toBeInTheDocument();
    expect(screen.getByText('页面卡住').tagName).toBe('MARK');
  });

  it('ignores a slower response from an older query', async () => {
    vi.useFakeTimers();
    let resolveOld: ((response: ConversationSearchResponse) => void) | undefined;
    let resolveNew: ((response: ConversationSearchResponse) => void) | undefined;
    const searchConversations = vi.fn((query: ConversationSearchQuery) => new Promise<ConversationSearchResponse>(resolve => {
      if (query.query === '旧查询') resolveOld = resolve;
      else resolveNew = resolve;
    }));
    renderSearch({ service: { searchConversations } });
    const input = screen.getByRole('searchbox', { name: '搜索会话' });

    fireEvent.change(input, { target: { value: '旧查询' } });
    await act(async () => vi.advanceTimersByTime(250));
    fireEvent.change(input, { target: { value: '新查询' } });
    await act(async () => vi.advanceTimersByTime(250));

    await act(async () => {
      resolveNew?.({
        results: [result({ title: '新结果', itemId: 'new-item' })],
        hasMore: false
      });
      await Promise.resolve();
    });
    await act(async () => {
      resolveOld?.({
        results: [result({ title: '旧结果', itemId: 'old-item' })],
        hasMore: false
      });
      await Promise.resolve();
    });

    expect(screen.getByText('新结果')).toBeInTheDocument();
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument();
  });

  it('applies project and type filters, then appends the next page', async () => {
    vi.useFakeTimers();
    const searchConversations = vi.fn(async (query: ConversationSearchQuery): Promise<ConversationSearchResponse> => (
      query.cursor === undefined
        ? {
            results: [result({ title: '第一页', itemId: 'first-item' })],
            hasMore: true,
            nextCursor: 'next-page'
          }
        : {
            results: [result({ title: '第二页', itemId: 'second-item' })],
            hasMore: false
          }
    ));
    renderSearch({ service: { searchConversations } });

    fireEvent.change(screen.getByLabelText('项目范围'), {
      target: { value: 'current' }
    });
    fireEvent.change(screen.getByLabelText('内容类型'), {
      target: { value: 'assistant_message' }
    });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '共同关键词' }
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(searchConversations).toHaveBeenLastCalledWith({
      query: '共同关键词',
      limit: 20,
      cwd: '/workspace/current',
      itemTypes: ['assistant_message']
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }));
      await Promise.resolve();
    });

    expect(searchConversations).toHaveBeenLastCalledWith({
      query: '共同关键词',
      limit: 20,
      cursor: 'next-page',
      cwd: '/workspace/current',
      itemTypes: ['assistant_message']
    });
    expect(screen.getByText('第一页')).toBeInTheDocument();
    expect(screen.getByText('第二页')).toBeInTheDocument();
  });

  it('opens the active result with keyboard or click', async () => {
    vi.useFakeTimers();
    const onOpenResult = vi.fn();
    const results = [
      result({ title: '第一条结果', itemId: 'first-item' }),
      result({ title: '第二条结果', itemId: 'second-item' })
    ];
    renderSearch({
      onOpenResult,
      service: {
        searchConversations: vi.fn(async () => ({ results, hasMore: false }))
      }
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
    expect(screen.getByText('本地服务连接后可以搜索会话')).toBeInTheDocument();

    vi.useFakeTimers();
    const service: SearchViewService = {
      searchConversations: vi.fn(async () => {
        throw new Error('failed');
      })
    };
    rerender(createView({ connected: true, service }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索会话' }), {
      target: { value: '没有结果' }
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
  onOpenResult?(result: ConversationSearchResult): void;
} = {}) {
  return (
    <SearchView
      connected={overrides.connected ?? true}
      service={overrides.service ?? {
        searchConversations: async () => ({ results: [], hasMore: false })
      }}
      projects={[
        {
          id: 'current',
          name: '当前项目',
          cwd: '/workspace/current',
          sandbox: 'follow-global',
          profile: 'default',
          model: null,
          reasoning: null
        }
      ]}
      currentProjectId="current"
      onOpenResult={overrides.onOpenResult ?? vi.fn()}
    />
  );
}

function result(overrides: Partial<ConversationSearchResult> = {}): ConversationSearchResult {
  return {
    threadId: 'thread-1',
    codexThreadId: 'codex-thread-1',
    title: '搜索结果',
    cwd: '/workspace/current',
    itemId: 'item-1',
    itemType: 'user_message',
    createdAt: '2026-07-12T12:00:00.000Z',
    snippet: [{ text: '结果片段', highlighted: false }],
    ...overrides
  };
}
