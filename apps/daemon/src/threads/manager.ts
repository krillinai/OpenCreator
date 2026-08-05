import type { ThreadPurpose } from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { expandHome } from '../platform/paths.js';
import { createProjectManager } from '../projects/manager.js';
import type { ProjectManager } from '../projects/types.js';
import {
  normalizeDatabaseTimestamp,
  normalizeNullableDatabaseTimestamp
} from '../storage/database.js';
import { createThreadRepository, type ThreadRow } from '../storage/repositories.js';
import { createConversationTitle } from './conversation-title.js';
import type {
  CreateConversationThreadInput,
  CreateKnowledgeThreadInput,
  CreateRuntimeThreadInput,
  CreateScheduleThreadInput,
  RuntimeThread,
  ThreadManager,
  UpdateRuntimeThreadInput,
  UpdateScheduleThreadInput
} from './types.js';
import { ThreadManagerError } from './types.js';

export type CreateThreadManagerInput = {
  db: Database.Database;
  dataDir: string;
  homeDir?: string;
  projectManager?: Pick<ProjectManager, 'getProject'>;
};

export function createThreadManager(input: CreateThreadManagerInput): ThreadManager {
  const threads = createThreadRepository(input.db);
  const projects = input.projectManager ?? createProjectManager({
    db: input.db,
    homeDir: input.homeDir
  });

  return {
    createConversationThread(request: CreateConversationThreadInput): RuntimeThread {
      const project = projects.getProject(request.projectId);
      if (project === undefined) {
        throw new ThreadManagerError('PROJECT_NOT_FOUND', 'Project not found');
      }
      if (project.status === 'archived') {
        throw new ThreadManagerError('PROJECT_ARCHIVED', 'Project is archived');
      }
      if (project.directoryState !== 'available' || project.canonicalCwd === null) {
        throw new ThreadManagerError(
          'PROJECT_DIRECTORY_UNAVAILABLE',
          'Project directory does not exist or is not accessible'
        );
      }
      return createRuntimeThread({
        title: request.title,
        cwd: project.cwd,
        canonicalCwd: project.canonicalCwd,
        workspaceMode: 'external',
        profile: request.profile ?? project.profile,
        model: request.model ?? project.model,
        reasoning: request.reasoning ?? project.reasoning,
        sandbox: request.sandbox ?? (
          project.sandbox === 'danger-full-access'
            ? 'danger-full-access'
            : 'workspace-write'
        ),
        purpose: 'conversation',
        projectId: project.id,
        origin: 'clawee_created'
      });
    },

    createScheduleThread(request: CreateScheduleThreadInput): RuntimeThread {
      return createRuntimeThread({
        ...request,
        projectId: null,
        origin: 'clawee_created'
      });
    },

    createKnowledgeThread(request: CreateKnowledgeThreadInput): RuntimeThread {
      return createRuntimeThread({
        ...request,
        managedWorkspaceRoot: request.workspaceRoot,
        workspaceMode: 'managed',
        sandbox: 'read-only',
        purpose: 'knowledge_conversation',
        projectId: null,
        origin: 'clawee_created'
      });
    },

    createThread(request: CreateRuntimeThreadInput): RuntimeThread {
      return createRuntimeThread({
        ...request,
        projectId: null,
        origin: 'clawee_created'
      });
    },

    assertRunnableThread(id: string): RuntimeThread {
      const row = threads.getThread(id);
      if (row === undefined) {
        throw new ThreadManagerError('THREAD_NOT_FOUND', 'Thread not found');
      }
      const thread = mapThreadRow(row);
      if (thread.purpose !== 'conversation') return thread;
      if (thread.projectId === null) {
        throw new ThreadManagerError('PROJECT_NOT_FOUND', 'Thread is not assigned to a project');
      }
      const project = projects.getProject(thread.projectId);
      if (project === undefined) {
        throw new ThreadManagerError('PROJECT_NOT_FOUND', 'Project not found');
      }
      if (project.status === 'archived') {
        throw new ThreadManagerError('PROJECT_ARCHIVED', 'Project is archived');
      }
      if (project.directoryState !== 'available' || project.canonicalCwd === null) {
        throw new ThreadManagerError(
          'PROJECT_DIRECTORY_UNAVAILABLE',
          'Project directory does not exist or is not accessible'
        );
      }
      return thread;
    },

    getThread(id: string): RuntimeThread | undefined {
      const row = threads.getThread(id);
      return row === undefined ? undefined : mapThreadRow(row);
    },

    getPublicThread(id: string): RuntimeThread | undefined {
      const row = threads.getThread(id);
      if (row === undefined || isHiddenDiscoveredConversation(row)) return undefined;
      return mapThreadRow(row);
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

    listKnowledgeThreads(enterpriseSubjectId, filter = {}): RuntimeThread[] {
      return threads.listKnowledgeThreads({
        enterpriseSubjectId,
        status: filter.status,
        limit: filter.limit
      }).map(mapThreadRow);
    },

    listPublicThreads(filter = {}): RuntimeThread[] {
      return threads.listPublicThreads(filter).map(mapThreadRow);
    },

    assignProject(id: string, projectId: string): RuntimeThread {
      const existing = threads.getThread(id);
      if (
        existing === undefined
        || existing.origin !== 'clawee_created'
        || existing.purpose !== 'conversation'
      ) {
        throw new ThreadManagerError('THREAD_NOT_FOUND', 'Thread not found');
      }
      if (existing.project_id !== null) {
        throw new ThreadManagerError(
          'THREAD_ALREADY_ASSIGNED',
          'Thread is already assigned to a project'
        );
      }
      const project = projects.getProject(projectId);
      if (project === undefined) {
        throw new ThreadManagerError('PROJECT_NOT_FOUND', 'Project not found');
      }
      if (project.status === 'archived') {
        throw new ThreadManagerError('PROJECT_ARCHIVED', 'Project is archived');
      }
      if (!threads.assignProject({ id, projectId })) {
        throw new ThreadManagerError(
          'THREAD_ALREADY_ASSIGNED',
          'Thread is already assigned to a project'
        );
      }
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

    repairCodexThreadBindings(): {
      repairedThreadIds: string[];
      unresolvedThreadIds: string[];
    } {
      const repairedThreadIds: string[] = [];
      for (const candidate of threads.listCodexBindingRepairCandidates()) {
        try {
          const owner = threads.getThreadByCodexThreadId(candidate.codexThreadId);
          if (owner !== undefined && owner.id !== candidate.threadId) continue;
          threads.setCodexThreadId(candidate.threadId, candidate.codexThreadId);
          repairedThreadIds.push(candidate.threadId);
        } catch (error) {
          if (!isSqliteUniqueConstraintError(error)) throw error;
        }
      }
      return {
        repairedThreadIds,
        unresolvedThreadIds: threads.listUnresolvedCodexBindingThreadIds()
      };
    },

    setCodexThreadId(threadId: string, codexThreadId: string): void {
      const owner = threads.getThreadByCodexThreadId(codexThreadId);
      if (owner !== undefined && owner.id !== threadId) {
        throw new ThreadManagerError(
          'THREAD_CODEX_ID_CONFLICT',
          'Codex thread id is already bound to another thread'
        );
      }
      try {
        threads.setCodexThreadId(threadId, codexThreadId);
      } catch (error) {
        if (isSqliteUniqueConstraintError(error)) {
          throw new ThreadManagerError(
            'THREAD_CODEX_ID_CONFLICT',
            'Codex thread id is already bound to another thread'
          );
        }
        throw error;
      }
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

  function createRuntimeThread(request: {
    title?: string;
    cwd?: string;
    canonicalCwd?: string;
    workspaceMode?: RuntimeThread['workspaceMode'];
    profile?: string;
    model?: string | null;
    reasoning?: RuntimeThread['reasoning'];
    sandbox?: RuntimeThread['sandbox'];
    purpose?: RuntimeThread['purpose'];
    projectId: string | null;
    origin: RuntimeThread['origin'];
    enterpriseSubjectId?: string | null;
    managedWorkspaceRoot?: string;
  }): RuntimeThread {
    const id = `thread_${nanoid(10)}`;
    const workspaceMode = request.workspaceMode ?? 'managed';
    const cwd =
      workspaceMode === 'managed'
        ? resolve(request.managedWorkspaceRoot ?? resolve(input.dataDir, 'workspaces'), id)
        : normalizeExternalCwd(request.cwd ?? process.cwd(), input.homeDir ?? homedir());
    mkdirSync(cwd, { recursive: true });
    const canonicalCwd = request.canonicalCwd ?? realpathSync(cwd);

    threads.insertThread({
      id,
      title: request.title === undefined ? null : createConversationTitle(request.title),
      projectId: request.projectId,
      enterpriseSubjectId: request.enterpriseSubjectId ?? null,
      origin: request.origin,
      cwd,
      canonicalCwd,
      workspaceMode,
      profile: request.profile ?? 'default',
      model: request.model ?? null,
      reasoning: request.reasoning ?? null,
      sandbox: request.sandbox ?? 'workspace-write',
      status: 'active',
      purpose: request.purpose ?? 'conversation'
    });

    return mapThreadRow(threads.getThread(id)!);
  }
}

function normalizeExternalCwd(cwd: string, homeDir: string): string {
  return expandHome(cwd, homeDir);
}

function mapThreadRow(row: ThreadRow): RuntimeThread {
  return {
    id: row.id,
    ...(row.schedule_id === null ? {} : { scheduleId: row.schedule_id }),
    title: row.title === null ? null : createConversationTitle(row.title),
    projectId: row.project_id,
    enterpriseSubjectId: row.enterprise_subject_id,
    origin: row.origin,
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
    createdAt: normalizeDatabaseTimestamp(row.created_at),
    updatedAt: normalizeDatabaseTimestamp(row.updated_at),
    archivedAt: normalizeNullableDatabaseTimestamp(row.archived_at)
  };
}

function isSqliteUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('SQLITE_CONSTRAINT');
}

function isHiddenDiscoveredConversation(row: ThreadRow): boolean {
  return row.purpose === 'conversation' && row.origin === 'codex_discovered';
}
