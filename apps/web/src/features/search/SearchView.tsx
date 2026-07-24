import type {
  ConversationSearchQuery,
  ConversationSearchResponse,
  ConversationSearchResult,
  ThreadResponse,
} from '@clawee/protocol';
import { LoaderCircle, Search } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ClaweeProject } from '../projects/project-model.js';
import './search-view.css';

export type SearchViewService = {
  searchConversations(query: ConversationSearchQuery): Promise<ConversationSearchResponse>;
};

type SearchState = {
  results: ConversationSearchResult[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  nextCursor?: string;
  error?: string;
};

const SEARCH_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;
const RECENT_CONVERSATION_LIMIT = 20;

export function SearchView(props: {
  connected: boolean;
  service: SearchViewService | null;
  projects: ClaweeProject[];
  recentThreads: ThreadResponse[];
  onOpenResult(result: ConversationSearchResult): void;
}) {
  const [query, setQuery] = useState('');
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [state, setState] = useState<SearchState>(emptySearchState);
  const requestGenerationRef = useRef(0);
  const normalizedQuery = query.trim();
  const recentThreads = props.recentThreads.slice(0, RECENT_CONVERSATION_LIMIT);

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    setActiveResultIndex(-1);

    if (!props.connected || props.service === null || normalizedQuery.length === 0) {
      setState(emptySearchState());
      return;
    }

    const timeout = window.setTimeout(() => {
      setState({
        results: [],
        loading: true,
        loadingMore: false,
        hasMore: false,
      });
      void props.service!.searchConversations({
        query: normalizedQuery,
        limit: SEARCH_PAGE_SIZE,
      })
        .then(response => {
          if (generation !== requestGenerationRef.current) return;
          setState({
            results: collapseSearchResults(response.results),
            loading: false,
            loadingMore: false,
            hasMore: response.hasMore,
            ...(response.nextCursor === undefined
              ? {}
              : { nextCursor: response.nextCursor }),
          });
        })
        .catch(() => {
          if (generation !== requestGenerationRef.current) return;
          setState({
            results: [],
            loading: false,
            loadingMore: false,
            hasMore: false,
            error: '无法搜索会话',
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [normalizedQuery, props.connected, props.service]);

  async function loadMore() {
    if (
      props.service === null
      || state.nextCursor === undefined
      || state.loadingMore
      || !state.hasMore
    ) {
      return;
    }
    const generation = requestGenerationRef.current;
    setState(current => ({ ...current, loadingMore: true, error: undefined }));
    try {
      const response = await props.service.searchConversations({
        query: normalizedQuery,
        limit: SEARCH_PAGE_SIZE,
        cursor: state.nextCursor,
      });
      if (generation !== requestGenerationRef.current) return;
      setState(current => ({
        ...current,
        results: appendUniqueConversations(current.results, response.results),
        loadingMore: false,
        hasMore: response.hasMore,
        nextCursor: response.nextCursor,
      }));
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setState(current => ({
        ...current,
        loadingMore: false,
        error: '无法加载更多搜索结果',
      }));
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (state.results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResultIndex(current => Math.min(state.results.length - 1, current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResultIndex(current => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Enter' && activeResultIndex >= 0) {
      event.preventDefault();
      const result = state.results[activeResultIndex];
      if (result !== undefined) props.onOpenResult(result);
    }
  }

  const activeResult = activeResultIndex < 0
    ? undefined
    : state.results[activeResultIndex];

  return (
    <section className="search-view" aria-label="搜索会话">
      <div className="search-view__shell">
        <label className="search-view__input">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索会话"
            placeholder="搜索会话内容"
            value={query}
            aria-activedescendant={
              activeResult === undefined ? undefined : searchResultDomId(activeResult)
            }
            onChange={event => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {state.loading ? (
            <LoaderCircle className="spin" size={17} aria-label="正在搜索" />
          ) : null}
        </label>

        <div className="search-view__body">
          {!props.connected ? (
            <SearchStatus title="连接本地服务后可以搜索会话" />
          ) : normalizedQuery.length === 0 ? (
            recentThreads.length === 0 ? (
              <SearchStatus title="还没有最近会话" />
            ) : (
              <ConversationSection title="最近会话" label="最近会话列表">
                {recentThreads.map(thread => {
                  const result = threadToSearchResult(thread);
                  return (
                    <ConversationRow
                      key={thread.id}
                      projectName={projectNameForId(thread.projectId, props.projects)}
                      result={result}
                      onOpen={props.onOpenResult}
                    />
                  );
                })}
              </ConversationSection>
            )
          ) : state.error !== undefined ? (
            <SearchStatus title={state.error} alert />
          ) : state.loading ? (
            <SearchStatus title="正在搜索" loading />
          ) : state.results.length === 0 ? (
            <SearchStatus title="没有找到匹配的会话" />
          ) : (
            <ConversationSection title="搜索结果" label="会话搜索结果">
              {state.results.map((result, index) => (
                <ConversationRow
                  active={index === activeResultIndex}
                  key={result.threadId}
                  projectName={projectNameForId(result.projectId, props.projects)}
                  result={result}
                  testId={`search-result-${result.itemId ?? 'title'}`}
                  onOpen={props.onOpenResult}
                />
              ))}
              {state.hasMore ? (
                <button
                  type="button"
                  className="search-view__load-more"
                  disabled={state.loadingMore}
                  aria-label="加载更多结果"
                  onClick={() => void loadMore()}
                >
                  {state.loadingMore ? (
                    <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  ) : null}
                  <span>{state.loadingMore ? '正在加载' : '加载更多'}</span>
                </button>
              ) : null}
            </ConversationSection>
          )}
        </div>
      </div>
    </section>
  );
}

function ConversationSection(props: {
  title: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="search-view__section" aria-labelledby={`search-section-${props.title}`}>
      <h2 id={`search-section-${props.title}`}>{props.title}</h2>
      <div className="search-view__results" role="list" aria-label={props.label}>
        {props.children}
      </div>
    </section>
  );
}

function ConversationRow(props: {
  result: ConversationSearchResult;
  projectName: string;
  active?: boolean;
  testId?: string;
  onOpen(result: ConversationSearchResult): void;
}) {
  const snippet = props.result.snippet;
  return (
    <article
      id={searchResultDomId(props.result)}
      role="listitem"
      className="search-result"
      data-active={props.active ? 'true' : undefined}
      data-testid={props.testId}
    >
      <button type="button" onClick={() => props.onOpen(props.result)}>
        <div className="search-result__topline">
          <strong>{props.result.title}</strong>
          <span>{props.projectName}</span>
        </div>
        {snippet.length > 0 ? (
          <p>
            {snippet.map((segment, segmentIndex) => (
              segment.highlighted
                ? <mark key={segmentIndex}>{segment.text}</mark>
                : <span key={segmentIndex}>{segment.text}</span>
            ))}
          </p>
        ) : null}
      </button>
    </article>
  );
}

function SearchStatus(props: { title: string; alert?: boolean; loading?: boolean }) {
  return (
    <div
      className="search-view__status"
      role={props.alert ? 'alert' : props.loading ? 'status' : undefined}
    >
      {props.loading ? (
        <LoaderCircle className="spin" size={17} aria-hidden="true" />
      ) : null}
      <span>{props.title}</span>
    </div>
  );
}

function collapseSearchResults(
  results: ConversationSearchResult[]
): ConversationSearchResult[] {
  return appendUniqueConversations([], results);
}

function appendUniqueConversations(
  current: ConversationSearchResult[],
  next: ConversationSearchResult[]
): ConversationSearchResult[] {
  const threadIds = new Set(current.map(result => result.threadId));
  return [
    ...current,
    ...next.filter(result => {
      if (threadIds.has(result.threadId)) return false;
      threadIds.add(result.threadId);
      return true;
    }),
  ];
}

function threadToSearchResult(thread: ThreadResponse): ConversationSearchResult {
  if (thread.projectId === null) {
    throw new Error('Conversation threads must have a projectId');
  }
  return {
    threadId: thread.id,
    projectId: thread.projectId,
    codexThreadId: thread.codexThreadId ?? '',
    title: thread.title?.trim() || thread.codexThreadId || thread.id,
    cwd: thread.cwd,
    itemType: 'title',
    createdAt: thread.updatedAt,
    snippet: [],
  };
}

function projectNameForId(
  projectId: string | null,
  projects: ClaweeProject[]
): string {
  if (projectId === null) return '未知项目';
  return projects.find(project => project.id === projectId)?.name ?? '未知项目';
}

function searchResultDomId(result: ConversationSearchResult): string {
  return `conversation-search-${result.threadId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function emptySearchState(): SearchState {
  return {
    results: [],
    loading: false,
    loadingMore: false,
    hasMore: false,
  };
}
