import type {
  ConversationSummary,
  CreateMemoryRequest,
  MemoryEntry,
  MemoryListQuery,
  RunContextItem,
  RuntimeErrorCode,
  RunContextResponse,
  ThreadHistoryItem,
  UpdateMemoryRequest
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { redactText } from '../security/redaction.js';
import { createMemoryRepository } from './repository.js';

const MEMORY_CONTENT_LIMIT = 2_000;
const RUN_MEMORY_COUNT_LIMIT = 12;
const RUN_MEMORY_CHAR_LIMIT = 6_000;
const RUN_SUMMARY_CHAR_LIMIT = 3_000;
const SUMMARY_SOURCE_ITEM_LIMIT = 24;
const SUMMARY_ITEM_CHAR_LIMIT = 240;
const SENSITIVE_PATTERN = /\b(password|passwd|token|api[\s_-]?key|secret|authorization)\b\s*[:=]/i;

export class MemoryServiceError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'MemoryServiceError';
  }
}

export function createMemoryService(input: { db: Database.Database }) {
  const repository = createMemoryRepository(input.db);

  return {
    createMemory(request: CreateMemoryRequest): MemoryEntry {
      const content = validateContent(request.content);
      const scopeKey = validateScope(request.scope, request.scopeKey);
      const sensitive = isSensitive(content);
      if (sensitive && request.acknowledgeSensitive !== true) {
        throw new MemoryServiceError(
          'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED',
          'Memory may contain sensitive information and requires explicit confirmation',
          409
        );
      }
      if (request.source !== 'user' && request.source !== 'agent_suggestion') {
        throw new MemoryServiceError('VALIDATION_FAILED', 'source must be user or agent_suggestion', 400);
      }
      const now = new Date().toISOString();
      const memory: MemoryEntry = {
        id: `mem_${nanoid(10)}`,
        content,
        scope: request.scope,
        ...(scopeKey === undefined ? {} : { scopeKey }),
        source: request.source,
        enabled: true,
        sensitive,
        userConfirmedAt: now,
        createdAt: now,
        updatedAt: now
      };
      repository.insertMemory(memory);
      return memory;
    },
    getMemory(id: string): MemoryEntry | undefined {
      return repository.getMemory(id);
    },
    listMemories(query: MemoryListQuery = {}) {
      return { memories: repository.listMemories(query) };
    },
    updateMemory(id: string, request: UpdateMemoryRequest): MemoryEntry | undefined {
      const current = repository.getMemory(id);
      if (current === undefined) return undefined;
      const content = request.content === undefined ? current.content : validateContent(request.content);
      const sensitive = isSensitive(content);
      if (sensitive && request.content !== undefined && request.acknowledgeSensitive !== true) {
        throw new MemoryServiceError(
          'MEMORY_SENSITIVE_CONFIRMATION_REQUIRED',
          'Memory may contain sensitive information and requires explicit confirmation',
          409
        );
      }
      const next: MemoryEntry = {
        ...current,
        content,
        enabled: request.enabled ?? current.enabled,
        sensitive,
        userConfirmedAt: request.content === undefined
          ? current.userConfirmedAt
          : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      repository.updateMemory(next);
      return next;
    },
    deleteMemory(id: string): boolean {
      return repository.deleteMemory(id);
    },
    disableAll(): number {
      return repository.disableAll(new Date().toISOString());
    },
    prepareRunContext(context: {
      prompt: string;
      threadId: string;
      projectKey: string;
    }): {
      executionPrompt: string;
      items: RunContextItem[];
    } {
      const selected: RunContextItem[] = [];
      let usedChars = 0;
      const memories = repository.selectContextMemories(
        context.threadId,
        context.projectKey,
        RUN_MEMORY_COUNT_LIMIT
      );
      for (const memory of memories) {
        if (usedChars + memory.content.length > RUN_MEMORY_CHAR_LIMIT) continue;
        selected.push({
          kind: 'memory',
          sourceId: memory.id,
          content: memory.content,
          order: selected.length,
          scope: memory.scope,
          ...(memory.scopeKey === undefined ? {} : { scopeKey: memory.scopeKey })
        });
        usedChars += memory.content.length;
      }
      const summary = repository.latestSummary(context.threadId);
      if (summary !== undefined) {
        selected.push({
          kind: 'summary',
          sourceId: summary.id,
          content: summary.content.slice(0, RUN_SUMMARY_CHAR_LIMIT),
          order: selected.length,
          summaryVersion: summary.version
        });
      }
      return {
        executionPrompt: buildExecutionPrompt(context.prompt, selected),
        items: selected
      };
    },
    prepareThreadRotationContext(context: {
      prompt: string;
      threadId: string;
    }): {
      executionPrompt: string;
      items: RunContextItem[];
    } {
      const summary = repository.latestSummary(context.threadId);
      const items: RunContextItem[] = summary === undefined
        ? []
        : [{
            kind: 'summary',
            sourceId: summary.id,
            content: redactText(summary.content.slice(0, RUN_SUMMARY_CHAR_LIMIT)),
            order: 0,
            summaryVersion: summary.version
          }];
      return {
        executionPrompt: buildThreadRotationPrompt(redactText(context.prompt), items[0]),
        items
      };
    },
    recordRunContext(runId: string, items: RunContextItem[]): void {
      repository.replaceRunContext(runId, items);
    },
    listRunContext(runId: string): RunContextResponse {
      return { runId, items: repository.listRunContext(runId) };
    },
    createSummary(summaryInput: {
      threadId: string;
      items: ThreadHistoryItem[];
    }): ConversationSummary {
      const sourceItems = summaryInput.items
        .map(toSummaryLine)
        .filter((value): value is { id: string; line: string } => value !== undefined)
        .slice(-SUMMARY_SOURCE_ITEM_LIMIT);
      if (sourceItems.length === 0) {
        throw new MemoryServiceError(
          'SUMMARY_SOURCE_EMPTY',
          'Conversation has no text history to summarize',
          422
        );
      }
      const now = new Date().toISOString();
      const version = repository.nextSummaryVersion(summaryInput.threadId);
      const summary: ConversationSummary = {
        id: `summary_${nanoid(10)}`,
        threadId: summaryInput.threadId,
        content: sourceItems.map(item => item.line).join('\n').slice(0, RUN_SUMMARY_CHAR_LIMIT),
        coveredFromCursor: sourceItems[0]!.id,
        coveredToCursor: sourceItems.at(-1)!.id,
        itemCount: sourceItems.length,
        version,
        createdAt: now,
        updatedAt: now
      };
      repository.insertSummary(summary);
      return summary;
    },
    listSummaries(query: { threadId?: string; limit?: number } = {}) {
      return {
        summaries: repository.listSummaries(query.threadId, query.limit)
      };
    },
    deleteSummary(id: string): boolean {
      return repository.deleteSummary(id);
    }
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;

function validateContent(value: string): string {
  if (typeof value !== 'string') {
    throw new MemoryServiceError('VALIDATION_FAILED', 'content must be a string', 400);
  }
  const content = value.trim();
  if (content.length === 0) {
    throw new MemoryServiceError('VALIDATION_FAILED', 'content is required', 400);
  }
  if (content.length > MEMORY_CONTENT_LIMIT) {
    throw new MemoryServiceError(
      'VALIDATION_FAILED',
      `content must contain at most ${MEMORY_CONTENT_LIMIT} characters`,
      400
    );
  }
  return content;
}

function validateScope(scope: CreateMemoryRequest['scope'], scopeKey?: string): string | undefined {
  if (scope !== 'global' && scope !== 'project' && scope !== 'thread') {
    throw new MemoryServiceError('VALIDATION_FAILED', 'scope must be global, project, or thread', 400);
  }
  if (scope === 'global') return undefined;
  if (typeof scopeKey !== 'string' || scopeKey.trim().length === 0) {
    throw new MemoryServiceError('VALIDATION_FAILED', 'scopeKey is required for project and thread memories', 400);
  }
  return scopeKey.trim();
}

function isSensitive(content: string): boolean {
  return SENSITIVE_PATTERN.test(content) || /\bsk-[a-z0-9_-]{8,}\b/i.test(content);
}

function buildExecutionPrompt(prompt: string, items: RunContextItem[]): string {
  if (items.length === 0) return prompt;
  const lines = [
    '[OpenCreator 用户显式管理的上下文]',
    ...items.map(item => (
      item.kind === 'memory'
        ? `- 记忆（${item.scope ?? 'global'}）：${item.content}`
        : `- 会话摘要 v${item.summaryVersion ?? 1}：${item.content}`
    )),
    '[上下文结束]',
    '',
    '用户当前请求：',
    prompt
  ];
  return lines.join('\n');
}

function buildThreadRotationPrompt(prompt: string, summary?: RunContextItem): string {
  return [
    '[OpenCreator 执行上下文恢复摘要]',
    summary === undefined
      ? '- 暂无可用会话摘要，请仅依据本次公开任务输入继续。'
      : `- 会话摘要 v${summary.summaryVersion ?? 1}：${summary.content}`,
    '[恢复摘要结束]',
    '',
    '本次公开任务输入：',
    prompt
  ].join('\n');
}

function toSummaryLine(item: ThreadHistoryItem): { id: string; line: string } | undefined {
  let prefix: string;
  let rawText: string;
  switch (item.type) {
    case 'user_message':
      prefix = '用户';
      rawText = item.text;
      break;
    case 'schedule_trigger':
      prefix = '定时任务';
      rawText = item.prompt;
      break;
    case 'assistant_message':
      prefix = '助手';
      rawText = item.text;
      break;
    case 'reasoning_summary':
      prefix = '过程';
      rawText = item.text;
      break;
    case 'tool_result':
      prefix = `工具 ${item.name}`;
      rawText = item.output;
      break;
    default:
      return undefined;
  }
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return undefined;
  return {
    id: item.id,
    line: `${prefix}：${text.slice(0, SUMMARY_ITEM_CHAR_LIMIT)}`
  };
}
