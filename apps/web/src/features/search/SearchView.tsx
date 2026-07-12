import type {
  ConversationSearchItemType,
  ConversationSearchQuery,
  ConversationSearchResponse,
  ConversationSearchResult
} from '@clawee/protocol';
import { CalendarDays, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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

type SearchItemTypeFilter = 'all' | ConversationSearchItemType;
type SearchTimeFilter = 'all' | '7d' | '30d';

const SEARCH_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

export function SearchView(props: {
  connected: boolean;
  service: SearchViewService | null;
  projects: ClaweeProject[];
  currentProjectId: string;
  currentProjectCwd?: string;
  onOpenResult(result: ConversationSearchResult): void;
  now?(): Date;
}) {
  const [query, setQuery] = useState('');
  const [projectScope, setProjectScope] = useState<'all' | 'current'>('all');
  const [itemType, setItemType] = useState<SearchItemTypeFilter>('all');
  const [timeFilter, setTimeFilter] = useState<SearchTimeFilter>('all');
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [state, setState] = useState<SearchState>(emptySearchState);
  const requestGenerationRef = useRef(0);
  const currentProject = useMemo(() => {
    const project = props.projects.find(item => item.id === props.currentProjectId);
    if (project === undefined || props.currentProjectCwd === undefined) return project;
    return { ...project, cwd: props.currentProjectCwd };
  }, [props.currentProjectCwd, props.currentProjectId, props.projects]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    const normalizedQuery = query.trim();
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
        hasMore: false
      });
      void props.service!.searchConversations(buildSearchQuery({
        query: normalizedQuery,
        projectScope,
        currentProject,
        itemType,
        timeFilter,
        now: props.now
      }))
        .then(response => {
          if (generation !== requestGenerationRef.current) return;
          setState({
            results: response.results,
            loading: false,
            loadingMore: false,
            hasMore: response.hasMore,
            ...(response.nextCursor === undefined ? {} : { nextCursor: response.nextCursor })
          });
        })
        .catch(() => {
          if (generation !== requestGenerationRef.current) return;
          setState({
            results: [],
            loading: false,
            loadingMore: false,
            hasMore: false,
            error: '无法搜索会话'
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [
    currentProject,
    itemType,
    projectScope,
    props.connected,
    props.now,
    props.service,
    query,
    timeFilter
  ]);

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
        ...buildSearchQuery({
          query: query.trim(),
          projectScope,
          currentProject,
          itemType,
          timeFilter,
          now: props.now
        }),
        cursor: state.nextCursor
      });
      if (generation !== requestGenerationRef.current) return;
      setState(current => ({
        ...current,
        results: appendUniqueResults(current.results, response.results),
        loadingMore: false,
        hasMore: response.hasMore,
        nextCursor: response.nextCursor
      }));
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setState(current => ({
        ...current,
        loadingMore: false,
        error: '无法加载更多搜索结果'
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

  const activeResult = activeResultIndex < 0 ? undefined : state.results[activeResultIndex];
  return (
    <section className="search-view" aria-labelledby="conversation-search-title">
      <header className="search-view__header">
        <div>
          <h1 id="conversation-search-title">搜索会话</h1>
          <span>{state.results.length > 0 ? `${state.results.length} 条结果` : '本地会话索引'}</span>
        </div>
      </header>

      <div className="search-view__controls">
        <label className="search-view__input">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索会话"
            placeholder="搜索标题、消息或文件路径"
            value={query}
            aria-activedescendant={activeResult === undefined ? undefined : searchResultDomId(activeResult)}
            onChange={event => setQuery(event.currentTarget.value)}
            onKeyDown={handleSearchKeyDown}
          />
          {state.loading ? <LoaderCircle className="spin" size={17} aria-label="正在搜索" /> : null}
        </label>
        <label className="search-view__select">
          <span>项目范围</span>
          <select
            aria-label="项目范围"
            value={projectScope}
            onChange={event => setProjectScope(event.currentTarget.value as 'all' | 'current')}
          >
            <option value="all">全部项目</option>
            <option value="current">当前项目</option>
          </select>
        </label>
        <label className="search-view__select">
          <span>内容类型</span>
          <select
            aria-label="内容类型"
            value={itemType}
            onChange={event => setItemType(event.currentTarget.value as SearchItemTypeFilter)}
          >
            <option value="all">全部内容</option>
            <option value="title">标题</option>
            <option value="user_message">我的消息</option>
            <option value="assistant_message">Clawee 回复</option>
            <option value="reasoning_summary">处理过程</option>
            <option value="tool_use">工具调用</option>
            <option value="tool_result">工具结果</option>
            <option value="file_change">文件变更</option>
          </select>
        </label>
        <label className="search-view__select">
          <CalendarDays size={16} aria-hidden="true" />
          <span>时间范围</span>
          <select
            aria-label="时间范围"
            value={timeFilter}
            onChange={event => setTimeFilter(event.currentTarget.value as SearchTimeFilter)}
          >
            <option value="all">不限时间</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
          </select>
        </label>
      </div>

      <div className="search-view__body">
        {!props.connected ? (
          <SearchStatus title="本地服务连接后可以搜索会话" />
        ) : query.trim().length === 0 ? (
          <SearchStatus title="输入关键词开始搜索" />
        ) : state.error !== undefined ? (
          <SearchStatus title={state.error} alert />
        ) : state.loading ? (
          <SearchStatus title="正在搜索会话" loading />
        ) : state.results.length === 0 ? (
          <SearchStatus title="没有找到匹配的会话" />
        ) : (
          <div className="search-view__results" role="list" aria-label="会话搜索结果">
            {state.results.map((result, index) => (
              <article
                key={searchResultKey(result)}
                id={searchResultDomId(result)}
                role="listitem"
                className="search-result"
                data-active={index === activeResultIndex ? 'true' : undefined}
                data-testid={`search-result-${result.itemId ?? 'title'}`}
              >
                <button type="button" onClick={() => props.onOpenResult(result)}>
                  <div className="search-result__topline">
                    <strong>{result.title}</strong>
                    <span>{formatSearchDate(result.createdAt)}</span>
                  </div>
                  <p>{result.snippet.map((segment, segmentIndex) => (
                    segment.highlighted
                      ? <mark key={segmentIndex}>{segment.text}</mark>
                      : <span key={segmentIndex}>{segment.text}</span>
                  ))}</p>
                  <div className="search-result__meta">
                    <span>{searchItemTypeLabel(result.itemType)}</span>
                    <code>{result.cwd}</code>
                  </div>
                </button>
              </article>
            ))}
            {state.hasMore ? (
              <button
                type="button"
                className="search-view__load-more"
                disabled={state.loadingMore}
                aria-label="加载更多结果"
                onClick={() => void loadMore()}
              >
                {state.loadingMore ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : null}
                <span>{state.loadingMore ? '正在加载' : '加载更多'}</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function SearchStatus(props: { title: string; alert?: boolean; loading?: boolean }) {
  return (
    <div
      className="search-view__status"
      role={props.alert ? 'alert' : props.loading ? 'status' : undefined}
    >
      {props.loading ? <LoaderCircle className="spin" size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
      <strong>{props.title}</strong>
    </div>
  );
}

function buildSearchQuery(input: {
  query: string;
  projectScope: 'all' | 'current';
  currentProject?: ClaweeProject;
  itemType: SearchItemTypeFilter;
  timeFilter: SearchTimeFilter;
  now?: () => Date;
}): ConversationSearchQuery {
  return {
    query: input.query,
    limit: SEARCH_PAGE_SIZE,
    ...(input.projectScope === 'current' && input.currentProject !== undefined
      ? { cwd: input.currentProject.cwd }
      : {}),
    ...(input.itemType === 'all' ? {} : { itemTypes: [input.itemType] }),
    ...(input.timeFilter === 'all'
      ? {}
      : {
          createdAfter: new Date(
            (input.now?.() ?? new Date()).getTime()
            - (input.timeFilter === '7d' ? 7 : 30) * 24 * 60 * 60 * 1_000
          ).toISOString()
        })
  };
}

function appendUniqueResults(
  current: ConversationSearchResult[],
  next: ConversationSearchResult[]
): ConversationSearchResult[] {
  const keys = new Set(current.map(searchResultKey));
  return [
    ...current,
    ...next.filter(result => {
      const key = searchResultKey(result);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    })
  ];
}

function searchResultKey(result: ConversationSearchResult): string {
  return `${result.threadId}:${result.itemType}:${result.itemId ?? 'title'}`;
}

function searchResultDomId(result: ConversationSearchResult): string {
  return `conversation-search-${searchResultKey(result).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function searchItemTypeLabel(itemType: ConversationSearchItemType): string {
  switch (itemType) {
    case 'title':
      return '会话标题';
    case 'user_message':
      return '我的消息';
    case 'assistant_message':
      return 'Clawee 回复';
    case 'reasoning_summary':
      return '处理过程';
    case 'tool_use':
      return '工具调用';
    case 'tool_result':
      return '工具结果';
    case 'file_change':
      return '文件变更';
  }
}

function formatSearchDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function emptySearchState(): SearchState {
  return {
    results: [],
    loading: false,
    loadingMore: false,
    hasMore: false
  };
}
