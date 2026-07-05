import type Database from 'better-sqlite3';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { createThreadRepository, type ThreadRow } from '../storage/repositories.js';
import type { CreateRuntimeThreadInput, RuntimeThread, ThreadManager } from './types.js';

export type CreateThreadManagerInput = {
  db: Database.Database;
  dataDir: string;
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
          : request.cwd ?? process.cwd();
      mkdirSync(cwd, { recursive: true });
      const canonicalCwd = realpathSync(cwd);
      const title = request.title ?? null;
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
        status
      });

      return mapThreadRow(threads.getThread(id)!);
    },

    getThread(id: string): RuntimeThread | undefined {
      const row = threads.getThread(id);
      return row === undefined ? undefined : mapThreadRow(row);
    },

    listThreads(filter?: { status?: 'active' | 'archived' | 'all'; limit?: number }): RuntimeThread[] {
      return threads.listThreads(filter).map(mapThreadRow);
    },

    archiveThread(id: string): RuntimeThread {
      if (threads.getThread(id) === undefined) throw new Error('THREAD_NOT_FOUND');
      threads.archiveThread(id);
      return mapThreadRow(threads.getThread(id)!);
    },

    setCodexThreadId(threadId: string, codexThreadId: string): void {
      threads.setCodexThreadId(threadId, codexThreadId);
    },

    touchThread(threadId: string): void {
      threads.touchThread(threadId);
    }
  };
}

function mapThreadRow(row: ThreadRow): RuntimeThread {
  return {
    id: row.id,
    title: row.title,
    codexThreadId: row.codex_thread_id,
    cwd: row.cwd,
    canonicalCwd: row.canonical_cwd,
    workspaceMode: row.workspace_mode as RuntimeThread['workspaceMode'],
    profile: row.profile,
    model: row.model,
    reasoning: row.reasoning as RuntimeThread['reasoning'],
    sandbox: row.sandbox as RuntimeThread['sandbox'],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}
