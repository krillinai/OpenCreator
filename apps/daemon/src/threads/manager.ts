import type { ThreadPurpose } from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { expandHome } from '../platform/paths.js';
import { createThreadRepository, type ThreadRow } from '../storage/repositories.js';
import { createConversationTitle } from './conversation-title.js';
import type {
  CreateRuntimeThreadInput,
  ImportCodexThreadInput,
  RuntimeThread,
  ThreadManager,
  UpdateRuntimeThreadInput,
  UpdateScheduleThreadInput
} from './types.js';

export type CreateThreadManagerInput = {
  db: Database.Database;
  dataDir: string;
  homeDir?: string;
};

export function createThreadManager(input: CreateThreadManagerInput): ThreadManager {
  const threads = createThreadRepository(input.db);

  return {
    createThread(request: CreateRuntimeThreadInput): RuntimeThread {
      const id = `thread_${nanoid(10)}`;
      const workspaceMode = request.workspaceMode ?? 'managed';
      const cwd =
        workspaceMode === 'managed'
          ? join(input.dataDir, 'workspaces', id)
          : normalizeExternalCwd(request.cwd ?? process.cwd(), input.homeDir ?? homedir());
      mkdirSync(cwd, { recursive: true });
      const canonicalCwd = realpathSync(cwd);
      const title = request.title === undefined ? null : createConversationTitle(request.title);
      const profile = request.profile ?? 'default';
      const sandbox = request.sandbox ?? 'read-only';
      const status = 'active';

      threads.insertThread({
        id,
        title,
        cwd,
        canonicalCwd,
        workspaceMode,
        profile,
        model: request.model ?? null,
        reasoning: request.reasoning ?? null,
        sandbox,
        status,
        purpose: request.purpose ?? 'conversation'
      });

      return mapThreadRow(threads.getThread(id)!);
    },

    getThread(id: string): RuntimeThread | undefined {
      const row = threads.getThread(id);
      return row === undefined ? undefined : mapThreadRow(row);
    },

    getThreadByCodexThreadId(codexThreadId: string): RuntimeThread | undefined {
      const row = threads.getThreadByCodexThreadId(codexThreadId);
      return row === undefined ? undefined : mapThreadRow(row);
    },

    listThreads(filter?: {
      status?: 'active' | 'archived' | 'all';
      purpose?: ThreadPurpose;
      excludePurpose?: ThreadPurpose;
      limit?: number;
    }): RuntimeThread[] {
      return threads.listThreads(filter).map(mapThreadRow);
    },

    importCodexThread(request: ImportCodexThreadInput): RuntimeThread {
      const existing = threads.getThreadByCodexThreadId(request.codexThreadId);
      const cwd = request.cwd;
      const canonicalCwd = existsSync(cwd) ? realpathSync(cwd) : cwd;
      const updatedAt = toSqliteTimestamp(request.updatedAt);
      if (existing !== undefined) {
        threads.updateImportedThread({
          id: existing.id,
          title: createConversationTitle(request.title, '未命名对话'),
          cwd,
          canonicalCwd,
          updatedAt
        });
        return mapThreadRow(threads.getThread(existing.id)!);
      }

      const id = createImportedThreadId(request.codexThreadId);

      threads.insertThread({
        id,
        title: createConversationTitle(request.title, '未命名对话'),
        codexThreadId: request.codexThreadId,
        cwd,
        canonicalCwd,
        workspaceMode: 'external',
        profile: request.profile ?? 'default',
        model: request.model ?? null,
        reasoning: request.reasoning ?? null,
        sandbox: request.sandbox ?? 'read-only',
        status: 'active',
        purpose: 'conversation',
        createdAt: toSqliteTimestamp(request.createdAt),
        updatedAt
      });

      return mapThreadRow(threads.getThread(id)!);
    },

    updateThread(id: string, request: UpdateRuntimeThreadInput): RuntimeThread {
      const existing = getRequiredThread(id);
      if (existing.purpose === 'schedule_task') throw new Error('THREAD_MANAGED_BY_SCHEDULE');
      threads.updateThreadSandbox({ id, sandbox: request.sandbox });
      return mapThreadRow(threads.getThread(id)!);
    },

    updateScheduleThread(id: string, request: UpdateScheduleThreadInput): RuntimeThread {
      const existing = getRequiredThread(id);
      if (existing.purpose !== 'schedule_task') throw new Error('THREAD_NOT_SCHEDULE_TASK');
      const cwd = normalizeExternalCwd(request.cwd, input.homeDir ?? homedir());
      mkdirSync(cwd, { recursive: true });
      threads.updateScheduleThread({
        id,
        title: createConversationTitle(request.title),
        cwd,
        canonicalCwd: realpathSync(cwd),
        profile: request.profile,
        model: request.model ?? null,
        reasoning: request.reasoning ?? null,
        sandbox: request.sandbox
      });
      return mapThreadRow(threads.getThread(id)!);
    },

    setPurpose(id: string, purpose: RuntimeThread['purpose']): RuntimeThread {
      getRequiredThread(id);
      threads.setThreadPurpose({ id, purpose });
      return mapThreadRow(threads.getThread(id)!);
    },

    archiveThread(id: string): RuntimeThread {
      const existing = getRequiredThread(id);
      if (existing.purpose === 'schedule_task') throw new Error('THREAD_MANAGED_BY_SCHEDULE');
      threads.archiveThread(id);
      return mapThreadRow(threads.getThread(id)!);
    },

    archiveScheduleThread(id: string): RuntimeThread {
      const existing = getRequiredThread(id);
      if (existing.purpose !== 'schedule_task') throw new Error('THREAD_NOT_SCHEDULE_TASK');
      threads.archiveThread(id);
      return mapThreadRow(threads.getThread(id)!);
    },

    archiveCodexThread(codexThreadId: string): RuntimeThread | undefined {
      const existing = threads.getThreadByCodexThreadId(codexThreadId);
      if (existing === undefined) return undefined;
      threads.archiveThread(existing.id);
      return mapThreadRow(threads.getThread(existing.id)!);
    },

    setCodexThreadId(threadId: string, codexThreadId: string): void {
      threads.setCodexThreadId(threadId, codexThreadId);
    },

    touchThread(threadId: string): void {
      threads.touchThread(threadId);
    }
  };

  function getRequiredThread(id: string): ThreadRow {
    const thread = threads.getThread(id);
    if (thread === undefined) throw new Error('THREAD_NOT_FOUND');
    return thread;
  }
}

function normalizeExternalCwd(cwd: string, homeDir: string): string {
  return expandHome(cwd, homeDir);
}

function createImportedThreadId(codexThreadId: string): string {
  const safe = codexThreadId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return `thread_codex_${safe || nanoid(10)}`;
}

function toSqliteTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function mapThreadRow(row: ThreadRow): RuntimeThread {
  return {
    id: row.id,
    ...(row.schedule_id === null ? {} : { scheduleId: row.schedule_id }),
    title: row.title === null ? null : createConversationTitle(row.title),
    codexThreadId: row.codex_thread_id,
    cwd: row.cwd,
    canonicalCwd: row.canonical_cwd,
    workspaceMode: row.workspace_mode as RuntimeThread['workspaceMode'],
    profile: row.profile,
    model: row.model,
    reasoning: row.reasoning as RuntimeThread['reasoning'],
    sandbox: row.sandbox as RuntimeThread['sandbox'],
    status: row.status,
    purpose: row.purpose,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}
