import type {
  ConversationSearchItemType,
  ConversationSearchQuery
} from '@clawee/protocol';
import type { FastifyInstance } from 'fastify';
import {
  SearchCursorError,
  type ConversationSearchService
} from '../search/service.js';
import { apiError } from './errors.js';

const SEARCH_ITEM_TYPES = [
  'title',
  'user_message',
  'assistant_message',
  'reasoning_summary',
  'tool_use',
  'tool_result',
  'file_change'
] as const satisfies readonly ConversationSearchItemType[];
const LIMIT_PATTERN = /^[1-9]\d*$/;
const MAX_SEARCH_LIMIT = 50;

export async function registerSearchRoutes(
  server: FastifyInstance,
  service: ConversationSearchService,
  options: { syncCodexSessions?(): void } = {}
): Promise<void> {
  server.get('/search/conversations', async (request, reply) => {
    const parsed = parseConversationSearchQuery(request.query);
    if (!parsed.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    }

    options.syncCodexSessions?.();
    try {
      return service.search(parsed.value);
    } catch (error) {
      if (error instanceof SearchCursorError) {
        return reply.code(400).send(apiError('SEARCH_CURSOR_INVALID', error.message));
      }
      throw error;
    }
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseConversationSearchQuery(query: unknown): ParseResult<ConversationSearchQuery> {
  const queryValue = getQueryString(query, 'query');
  if (!queryValue.ok) return queryValue;
  if (queryValue.value === undefined || queryValue.value.trim().length === 0) {
    return { ok: false, message: 'query is required' };
  }

  const limit = getQueryString(query, 'limit');
  if (!limit.ok) return limit;
  let parsedLimit: number | undefined;
  if (limit.value !== undefined) {
    if (!LIMIT_PATTERN.test(limit.value)) {
      return { ok: false, message: 'limit must be an integer between 1 and 50' };
    }
    parsedLimit = Number(limit.value);
    if (parsedLimit < 1 || parsedLimit > MAX_SEARCH_LIMIT) {
      return { ok: false, message: 'limit must be an integer between 1 and 50' };
    }
  }

  const cursor = getQueryString(query, 'cursor');
  if (!cursor.ok) return cursor;
  const cwd = getQueryString(query, 'cwd');
  if (!cwd.ok) return cwd;
  const itemTypes = parseItemTypes(query);
  if (!itemTypes.ok) return itemTypes;
  const createdAfter = parseDateQuery(query, 'createdAfter');
  if (!createdAfter.ok) return createdAfter;
  const createdBefore = parseDateQuery(query, 'createdBefore');
  if (!createdBefore.ok) return createdBefore;
  if (
    createdAfter.value !== undefined
    && createdBefore.value !== undefined
    && createdAfter.value > createdBefore.value
  ) {
    return { ok: false, message: 'createdAfter must not be later than createdBefore' };
  }

  return {
    ok: true,
    value: {
      query: queryValue.value,
      ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
      ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
      ...(cwd.value === undefined || cwd.value.trim().length === 0 ? {} : { cwd: cwd.value }),
      ...(itemTypes.value === undefined ? {} : { itemTypes: itemTypes.value }),
      ...(createdAfter.value === undefined ? {} : { createdAfter: createdAfter.value }),
      ...(createdBefore.value === undefined ? {} : { createdBefore: createdBefore.value })
    }
  };
}

function parseItemTypes(query: unknown): ParseResult<ConversationSearchItemType[] | undefined> {
  const value = getQueryString(query, 'types');
  if (!value.ok) return value;
  if (value.value === undefined || value.value.trim().length === 0) {
    return { ok: true, value: undefined };
  }
  const types = [...new Set(value.value.split(',').map(type => type.trim()))];
  if (types.some(type => !SEARCH_ITEM_TYPES.includes(type as ConversationSearchItemType))) {
    return { ok: false, message: 'types contains an unsupported item type' };
  }
  return {
    ok: true,
    value: types as ConversationSearchItemType[]
  };
}

function parseDateQuery(
  query: unknown,
  key: 'createdAfter' | 'createdBefore'
): ParseResult<string | undefined> {
  const value = getQueryString(query, key);
  if (!value.ok) return value;
  if (value.value === undefined) return value;
  const timestamp = Date.parse(value.value);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, message: `${key} must be an ISO date string` };
  }
  return { ok: true, value: new Date(timestamp).toISOString() };
}

function getQueryString(query: unknown, key: string): ParseResult<string | undefined> {
  if (query === undefined || query === null) return { ok: true, value: undefined };
  if (typeof query !== 'object' || Array.isArray(query)) {
    return { ok: false, message: 'query parameters must be an object' };
  }
  const value = (query as Record<string, unknown>)[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, message: `${key} must be a string` };
  return { ok: true, value };
}
