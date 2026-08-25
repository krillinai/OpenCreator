import type {
  ConversationSearchQuery,
  ConversationSearchSnippetSegment,
  ThreadHistoryItem
} from '@opencreator/protocol';
import type { CodexAppServerRequestClient } from '../app-server-client.js';
import { CodexAppServerResponseError } from '../app-server-client.js';
import { extractPublicConversationInput } from '../../threads/conversation-title.js';

export type { CodexAppServerRequestClient } from '../app-server-client.js';

export type CodexConversationSearchResult = {
  codexThreadId: string;
  title: string;
  cwd: string;
  itemType: 'title';
  createdAt: string;
  snippet: ConversationSearchSnippetSegment[];
};

export type CodexConversationSearchPage = {
  results: CodexConversationSearchResult[];
  hasMore: boolean;
  nextCursor?: string;
};

export type CodexSessionProvider = {
  listTurns(input: {
    codexThreadId: string;
    limit: number;
    cursor?: string;
  }): Promise<CodexThreadHistoryPage>;
  search(query: ConversationSearchQuery): Promise<CodexConversationSearchPage>;
  restart?(): Promise<void>;
  close(): Promise<void>;
};

export type CodexThreadHistoryPage = {
  items: ThreadHistoryItem[];
  hasMore: boolean;
  nextCursor?: string;
  oldestItemAt?: string;
};

export type CreateCodexSessionProviderInput = {
  client: CodexAppServerRequestClient;
  historyCacheTtlMs?: number;
  now?: () => number;
};

type CodexThread = {
  id: string;
  preview: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  cwd: string;
};

type CodexThreadListResponse = {
  data: CodexThread[];
  nextCursor: string | null;
};

type CodexThreadSearchResponse = {
  data: Array<{
    thread: CodexThread;
    snippet: string;
  }>;
  nextCursor: string | null;
};

type CodexTurn = {
  id: string;
  items: CodexThreadItem[];
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  startedAt: number | null;
  completedAt: number | null;
};

type CodexThreadItem = Record<string, unknown> & {
  type: string;
  id?: string;
};

type CodexTurnsListResponse = {
  data: CodexTurn[];
  nextCursor: string | null;
};

type CachedHistoryPage = {
  expiresAt: number;
  page: Promise<CodexThreadHistoryPage>;
};

const INTERACTIVE_SOURCE_KINDS = ['cli', 'vscode', 'exec', 'appServer'] as const;
const DEFAULT_HISTORY_CACHE_TTL_MS = 5_000;
const MAX_HISTORY_CACHE_ENTRIES = 100;

export function createCodexSessionProvider(
  input: CreateCodexSessionProviderInput
): CodexSessionProvider {
  const now = input.now ?? Date.now;
  const historyCacheTtlMs = input.historyCacheTtlMs ?? DEFAULT_HISTORY_CACHE_TTL_MS;
  const historyCache = new Map<string, CachedHistoryPage>();

  return {
    listTurns(options) {
      const key = JSON.stringify([
        options.codexThreadId,
        options.cursor ?? null,
        options.limit
      ]);
      if (options.cursor !== undefined) {
        const cached = historyCache.get(key);
        if (cached !== undefined && cached.expiresAt > now()) return cached.page;
        if (cached !== undefined) historyCache.delete(key);
      }

      const page = requestTurns(input.client, options).then(mapTurnsPage);
      if (options.cursor === undefined) return page;

      historyCache.set(key, {
        expiresAt: now() + historyCacheTtlMs,
        page
      });
      while (historyCache.size > MAX_HISTORY_CACHE_ENTRIES) {
        const oldestKey = historyCache.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        historyCache.delete(oldestKey);
      }
      void page.catch(() => {
        if (historyCache.get(key)?.page === page) historyCache.delete(key);
      });
      return page;
    },

    async search(query) {
      const response = await input.client.request<CodexThreadSearchResponse>('thread/search', {
        searchTerm: query.query,
        limit: query.limit ?? 20,
        cursor: query.cursor ?? null,
        archived: false,
        sourceKinds: [...INTERACTIVE_SOURCE_KINDS],
        sortKey: 'recency_at',
        sortDirection: 'desc'
      });
      const results = response.data.flatMap(result => {
        if (
          query.itemTypes !== undefined
          && query.itemTypes.length > 0
          && !query.itemTypes.includes('title')
        ) {
          return [];
        }
        if (query.cwd !== undefined && result.thread.cwd !== query.cwd) return [];
        const createdAt = unixSecondsToIso(
          result.thread.recencyAt ?? result.thread.updatedAt
        );
        if (
          query.createdAfter !== undefined
          && Date.parse(createdAt) < Date.parse(query.createdAfter)
        ) {
          return [];
        }
        if (
          query.createdBefore !== undefined
          && Date.parse(createdAt) > Date.parse(query.createdBefore)
        ) {
          return [];
        }
        return [{
          codexThreadId: result.thread.id,
          title: result.thread.name?.trim()
            || result.thread.preview?.trim()
            || '未命名对话',
          cwd: result.thread.cwd,
          itemType: 'title' as const,
          createdAt,
          snippet: buildSnippet(result.snippet, query.query)
        }];
      });
      return {
        results,
        hasMore: response.nextCursor !== null,
        ...(response.nextCursor === null ? {} : { nextCursor: response.nextCursor })
      };
    },

    async restart() {
      historyCache.clear();
      await input.client.restart?.();
    },

    async close() {
      historyCache.clear();
      await input.client.close();
    }
  };
}

async function requestTurns(
  client: CodexAppServerRequestClient,
  options: { codexThreadId: string; limit: number; cursor?: string }
): Promise<CodexTurnsListResponse> {
  const params = {
    threadId: options.codexThreadId,
    cursor: options.cursor ?? null,
    limit: options.limit,
    sortDirection: 'desc',
    itemsView: 'summary'
  };
  try {
    return await client.request<CodexTurnsListResponse>('thread/turns/list', params);
  } catch (error) {
    if (!isThreadNotLoadedError(error)) throw error;
    await client.request('thread/resume', {
      threadId: options.codexThreadId
    });
    return client.request<CodexTurnsListResponse>('thread/turns/list', params);
  }
}

function isThreadNotLoadedError(error: unknown): boolean {
  return error instanceof CodexAppServerResponseError
    && error.code === -32600
    && error.message.startsWith('thread not loaded:');
}

function mapTurnsPage(response: CodexTurnsListResponse): CodexThreadHistoryPage {
  const items = [...response.data]
    .reverse()
    .flatMap(turn => mapTurn(turn));
  return {
    items,
    hasMore: response.nextCursor !== null,
    ...(response.nextCursor === null ? {} : { nextCursor: response.nextCursor }),
    ...(items[0] === undefined ? {} : { oldestItemAt: items[0].createdAt })
  };
}

function mapTurn(turn: CodexTurn): ThreadHistoryItem[] {
  const startedAt = unixSecondsToIso(turn.startedAt ?? turn.completedAt ?? 0);
  const completedAt = unixSecondsToIso(turn.completedAt ?? turn.startedAt ?? 0);
  const items: ThreadHistoryItem[] = [];

  for (const item of turn.items) {
    if (isUserMessageItem(item)) {
      const rawText = item.content
        .flatMap(content => (
          isRecord(content)
          && content.type === 'text'
          && typeof content.text === 'string'
            ? [content.text]
            : []
        ))
        .join('\n')
        .trim();
      const text = extractPublicConversationInput(rawText);
      if (text === undefined) continue;
      const scheduleTrigger = parseScheduleExecutionPrompt(text);
      items.push(scheduleTrigger === undefined
        ? {
            id: item.id,
            type: 'user_message',
            text,
            createdAt: startedAt,
            turnId: turn.id
          }
        : {
            id: item.id,
            type: 'schedule_trigger',
            prompt: scheduleTrigger.prompt,
            triggeredAt: scheduleTrigger.triggeredAt,
            createdAt: startedAt,
            turnId: turn.id
          });
      continue;
    }
    if (isAgentMessageItem(item) && item.text.trim().length > 0) {
      items.push({
        id: item.id,
        type: 'assistant_message',
        text: item.text,
        createdAt: completedAt,
        turnId: turn.id
      });
    }
  }

  if (turn.status !== 'inProgress') {
    items.push({
      id: `history_done_${turn.id}`,
      type: 'done',
      status:
        turn.status === 'completed'
          ? 'succeeded'
          : turn.status === 'interrupted'
            ? 'canceled'
            : 'failed',
      createdAt: completedAt,
      turnId: turn.id
    });
  }
  return items;
}

function buildSnippet(
  source: string,
  query: string
): ConversationSearchSnippetSegment[] {
  const normalizedSource = normalizeSearchText(source);
  const normalizedQuery = normalizeSearchText(query);
  const index = normalizedSource.toLocaleLowerCase().indexOf(
    normalizedQuery.toLocaleLowerCase()
  );
  if (index < 0 || normalizedQuery.length === 0) {
    return normalizedSource.length === 0
      ? []
      : [{ text: normalizedSource.slice(0, 160), highlighted: false }];
  }

  const start = Math.max(0, index - 72);
  const end = Math.min(
    normalizedSource.length,
    index + normalizedQuery.length + 72
  );
  const segments: ConversationSearchSnippetSegment[] = [];
  if (start > 0) segments.push({ text: '…', highlighted: false });
  if (index > start) {
    segments.push({
      text: normalizedSource.slice(start, index),
      highlighted: false
    });
  }
  segments.push({
    text: normalizedSource.slice(index, index + normalizedQuery.length),
    highlighted: true
  });
  if (index + normalizedQuery.length < end) {
    segments.push({
      text: normalizedSource.slice(index + normalizedQuery.length, end),
      highlighted: false
    });
  }
  if (end < normalizedSource.length) segments.push({ text: '…', highlighted: false });
  return segments;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function unixSecondsToIso(value: number): string {
  if (!Number.isFinite(value)) return new Date(0).toISOString();
  return new Date(value * 1_000).toISOString();
}

function isUserMessageItem(
  item: CodexThreadItem
): item is CodexThreadItem & { id: string; content: unknown[] } {
  return item.type === 'userMessage'
    && typeof item.id === 'string'
    && Array.isArray(item.content);
}

function isAgentMessageItem(
  item: CodexThreadItem
): item is CodexThreadItem & { id: string; text: string } {
  return item.type === 'agentMessage'
    && typeof item.id === 'string'
    && typeof item.text === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SCHEDULE_EXECUTION_PREFIX = '这是 OpenCreator 已经触发的一次计划任务执行。';
const SCHEDULE_TRIGGER_MARKER = '\n本次触发时间：';
const SCHEDULE_CONTENT_MARKER = '\n任务内容：\n';

function parseScheduleExecutionPrompt(
  text: string
): { prompt: string; triggeredAt: string } | undefined {
  const normalized = text.trimEnd();
  if (!normalized.startsWith(`${SCHEDULE_EXECUTION_PREFIX}\n\n执行规则：\n`)) return undefined;

  const contentIndex = normalized.lastIndexOf(SCHEDULE_CONTENT_MARKER);
  if (contentIndex < 0) return undefined;
  const metadata = normalized.slice(0, contentIndex);
  const triggerIndex = metadata.lastIndexOf(SCHEDULE_TRIGGER_MARKER);
  if (triggerIndex < 0) return undefined;

  const triggeredAt = metadata
    .slice(triggerIndex + SCHEDULE_TRIGGER_MARKER.length)
    .trim();
  const prompt = normalized
    .slice(contentIndex + SCHEDULE_CONTENT_MARKER.length)
    .trimEnd();
  if (triggeredAt.length === 0 || prompt.trim().length === 0) return undefined;
  return { prompt, triggeredAt };
}
