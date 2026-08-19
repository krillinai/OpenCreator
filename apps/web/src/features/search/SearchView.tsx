import type {
  ConversationSearchQuery,
  ConversationSearchResponse,
  ConversationSearchResult,
  ThreadResponse,
} from '@opencreator/protocol';
import { LoaderCircle, Search } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { OpenCreatorProject } from '../projects/project-model.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
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
  projects: OpenCreatorProject[];
  recentThreads: ThreadResponse[];
  onOpenResult(result: ConversationSearchResult): void;
}) {
  const l = useLocalizedCopy();
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
            error: l('无法搜索会话', 'Could not search conversations'),
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [l, normalizedQuery, props.connected, props.service]);

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
        error: l('无法加载更多搜索结果', 'Could not load more search results'),
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
    <section className="search-view" aria-label={l('搜索会话', 'Search conversations')}>
      <div className="search-view__shell">
        <label className="search-view__input">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label={l('搜索会话', 'Search conversations')}
            placeholder={l('搜索会话内容', 'Search conversation content')}
            value={query}
            aria-activedescendant={
              activeResult === undefined ? undefined : searchResultDomId(activeResult)
            }
            onChange={event => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {state.loading ? (
            <LoaderCircle className="spin" size={17} aria-label={l('正在搜索', 'Searching')} />
          ) : null}
        </label>

        <div className="search-view__body">
          {!props.connected ? (
            <SearchStatus title={l('连接本地服务后可以搜索会话', 'Connect the local service to search conversations')} />
          ) : normalizedQuery.length === 0 ? (
            recentThreads.length === 0 ? (
              <SearchStatus title={l('还没有最近会话', 'No recent conversations')} />
            ) : (
              <ConversationSection title={l('最近会话', 'Recent conversations')} label={l('最近会话列表', 'Recent conversation list')}>
                {recentThreads.map(thread => {
                  const result = threadToSearchResult(thread);
                  return (
                    <ConversationRow
                      key={thread.id}
                      projectName={projectNameForId(thread.projectId, props.projects, l)}
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
            <SearchStatus title={l('正在搜索', 'Searching')} loading />
          ) : state.results.length === 0 ? (
            <SearchStatus title={l('没有找到匹配的会话', 'No matching conversations')} />
          ) : (
            <ConversationSection title={l('搜索结果', 'Search results')} label={l('会话搜索结果', 'Conversation search results')}>
              {state.results.map((result, index) => (
                <ConversationRow
                  active={index === activeResultIndex}
                  key={result.threadId}
                  projectName={projectNameForId(result.projectId, props.projects, l)}
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
                  aria-label={l('加载更多结果', 'Load more results')}
                  onClick={() => void loadMore()}
                >
                  {state.loadingMore ? (
                    <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  ) : null}
                  <span>{state.loadingMore ? l('正在加载', 'Loading') : l('加载更多', 'Load more')}</span>
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
  projects: OpenCreatorProject[],
  l: LocalizeCopy
): string {
  if (projectId === null) return l('未知项目', 'Unknown project');
  return projects.find(project => project.id === projectId)?.name ?? l('未知项目', 'Unknown project');
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
