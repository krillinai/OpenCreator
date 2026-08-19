import type {
  CreateManagedProjectRequest,
  CreateProjectRequest,
  MigrateLocalStorageProjectsV1Request,
  MigrateLocalStorageProjectsV1Response,
  ProjectDirectoryState,
  ProjectResponse,
  ProjectStatus,
  ReplaceProjectDirectoryRequest,
  UpdateProjectRequest
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { expandHome } from '../platform/paths.js';
import {
  normalizeDatabaseTimestamp,
  normalizeNullableDatabaseTimestamp
} from '../storage/database.js';
import {
  createProjectRepository,
  createThreadRepository,
  type ProjectRow
} from '../storage/repositories.js';
import {
  ProjectManagerError,
  type CreateMigratedProjectInput,
  type ProjectManager
} from './types.js';

export type CreateProjectManagerInput = {
  db: Database.Database;
  homeDir?: string;
  managedProjectRoot?: string;
  idFactory?: () => string;
};

export function createProjectManager(input: CreateProjectManagerInput): ProjectManager {
  const projects = createProjectRepository(input.db);
  const threads = createThreadRepository(input.db);
  const homeDir = input.homeDir ?? homedir();
  const managedProjectRoot = input.managedProjectRoot === undefined
    ? join(homeDir, 'Documents', 'OpenCreator')
    : resolve(expandHome(input.managedProjectRoot, homeDir));
  const createId = input.idFactory ?? (() => `project_${nanoid(10)}`);

  return {
    ensureDefaultProject(): ProjectResponse {
      try {
        mkdirSync(managedProjectRoot, { recursive: true });
      } catch {
        throw new ProjectManagerError(
          'PROJECT_DIRECTORY_UNAVAILABLE',
          'OpenCreator 默认项目目录不可用'
        );
      }

      const cwd = join(managedProjectRoot, 'Default Project');
      let createdDirectory = false;
      if (!existsSync(cwd)) {
        try {
          mkdirSync(cwd);
          createdDirectory = true;
        } catch {
          if (!existsSync(cwd)) {
            throw new ProjectManagerError(
              'PROJECT_DIRECTORY_UNAVAILABLE',
              '无法创建默认项目目录'
            );
          }
        }
      }

      const directory = requireAvailableDirectory(cwd, homeDir);
      const existing = projects.getProjectByActiveCanonicalCwd(directory.canonicalCwd);
      if (existing !== undefined) return mapProjectRow(existing);

      try {
        return createProjectRecord({ cwd: directory.cwd, name: '默认项目' });
      } catch (error) {
        if (createdDirectory) {
          try {
            rmdirSync(cwd);
          } catch {
            // Only remove the directory when it is still empty.
          }
        }
        throw error;
      }
    },

    createProject: createProjectRecord,

    createManagedProject(request: CreateManagedProjectRequest): ProjectResponse {
      const name = normalizeManagedProjectName(request.name);
      try {
        mkdirSync(managedProjectRoot, { recursive: true });
      } catch {
        throw new ProjectManagerError(
          'PROJECT_DIRECTORY_UNAVAILABLE',
          'OpenCreator 默认项目目录不可用'
        );
      }

      const cwd = join(managedProjectRoot, name);
      if (existsSync(cwd)) {
        throw new ProjectManagerError('PROJECT_DIRECTORY_CONFLICT', '同名项目已存在');
      }
      try {
        mkdirSync(cwd);
      } catch {
        if (existsSync(cwd)) {
          throw new ProjectManagerError('PROJECT_DIRECTORY_CONFLICT', '同名项目已存在');
        }
        throw new ProjectManagerError(
          'PROJECT_DIRECTORY_UNAVAILABLE',
          '无法创建项目目录'
        );
      }

      try {
        return createProjectRecord({ cwd, name });
      } catch (error) {
        try {
          rmdirSync(cwd);
        } catch {
          // Only remove the directory when it is still empty.
        }
        throw error;
      }
    },

    createMigratedProject(request: CreateMigratedProjectInput): ProjectResponse {
      return createMigratedProjectRecord(request);
    },

    migrateLocalStorageV1(
      request: MigrateLocalStorageProjectsV1Request
    ): MigrateLocalStorageProjectsV1Response {
      return input.db.transaction((): MigrateLocalStorageProjectsV1Response => {
        const existing = projects.getMigration(LOCAL_STORAGE_V1_MIGRATION_KEY);
        if (existing !== undefined) {
          return {
            status: 'already_applied',
            ...readStoredMigrationResult(existing.result_json)
          };
        }

        const projectIdMap: Record<string, string> = {};
        const projectIdsByCanonicalCwd = new Map<string, string>();
        for (const legacy of request.projects) {
          if (legacy.id === LOCAL_HOME_PROJECT_ID) continue;
          const project = createMigratedProjectRecord({
            ...legacy,
            preferredId: legacy.id
          });
          projectIdMap[legacy.id] = project.id;
          if (project.canonicalCwd !== null) {
            projectIdsByCanonicalCwd.set(project.canonicalCwd, project.id);
          }
        }

        const assignedThreadIds: string[] = [];
        const unassignedThreadIds: string[] = [];
        for (const thread of threads.listUnassignedOpenCreatorConversationThreads()) {
          const projectId = projectIdsByCanonicalCwd.get(thread.canonical_cwd);
          if (projectId === undefined) {
            unassignedThreadIds.push(thread.id);
            continue;
          }
          if (threads.assignProject({ id: thread.id, projectId })) {
            assignedThreadIds.push(thread.id);
          } else {
            unassignedThreadIds.push(thread.id);
          }
        }

        const result: StoredLocalStorageV1MigrationResult = {
          projectIdMap,
          assignedThreadIds,
          unassignedThreadIds
        };
        projects.saveMigration({
          key: LOCAL_STORAGE_V1_MIGRATION_KEY,
          requestHash: hashMigrationRequest(request),
          resultJson: JSON.stringify(result)
        });
        return { status: 'applied', ...result };
      })();
    },

    getProject(id): ProjectResponse | undefined {
      const row = projects.getProject(id);
      return row === undefined ? undefined : mapProjectRow(row);
    },

    listProjects(status: ProjectStatus | 'all' = 'active'): ProjectResponse[] {
      return projects.listProjects(status).map(mapProjectRow);
    },

    updateProject(id: string, request: UpdateProjectRequest): ProjectResponse {
      const existing = getRequiredProject(id);
      projects.updateProjectConfig({
        id,
        name: request.name === undefined
          ? existing.name
          : normalizeProjectName(request.name, existing.cwd),
        profile: request.profile === undefined
          ? existing.profile
          : normalizeProfile(request.profile),
        model: request.model === undefined ? existing.model : request.model,
        reasoning: request.reasoning === undefined
          ? existing.reasoning
          : request.reasoning,
        sandbox: request.sandbox ?? existing.sandbox
      });
      return mapProjectRow(projects.getProject(id)!);
    },

    archiveProject(id: string): ProjectResponse {
      getRequiredProject(id);
      projects.archiveProject(id);
      return mapProjectRow(projects.getProject(id)!);
    },

    restoreProject(id: string): ProjectResponse {
      const existing = getRequiredProject(id);
      const directory = requireAvailableDirectory(existing.cwd, homeDir);
      const duplicate = projects.getProjectByActiveCanonicalCwd(directory.canonicalCwd);
      if (duplicate !== undefined && duplicate.id !== id) {
        throw new ProjectManagerError(
          'PROJECT_DIRECTORY_CONFLICT',
          'Project directory is already active'
        );
      }
      input.db.transaction(() => {
        projects.replaceProjectDirectory({
          id,
          cwd: directory.cwd,
          canonicalCwd: directory.canonicalCwd
        });
        projects.restoreProject(id);
      })();
      return mapProjectRow(projects.getProject(id)!);
    },

    replaceProjectDirectory(
      id: string,
      request: ReplaceProjectDirectoryRequest
    ): ProjectResponse {
      const existing = getRequiredProject(id);
      const directory = requireAvailableDirectory(request.cwd, homeDir);
      const duplicate = projects.getProjectByActiveCanonicalCwd(directory.canonicalCwd);
      if (duplicate !== undefined && duplicate.id !== id) {
        throw new ProjectManagerError(
          'PROJECT_DIRECTORY_CONFLICT',
          'Project directory is already active'
        );
      }
      input.db.transaction(() => {
        projects.replaceProjectDirectory({
          id,
          cwd: directory.cwd,
          canonicalCwd: directory.canonicalCwd
        });
        threads.updateProjectThreadsDirectory({
          projectId: existing.id,
          cwd: directory.cwd,
          canonicalCwd: directory.canonicalCwd
        });
      })();
      return mapProjectRow(projects.getProject(id)!);
    }
  };

  function createProjectRecord(request: CreateProjectRequest): ProjectResponse {
    const directory = requireAvailableDirectory(request.cwd, homeDir);
    const duplicate = projects.getProjectByActiveCanonicalCwd(directory.canonicalCwd);
    if (duplicate !== undefined) {
      throw new ProjectManagerError(
        'PROJECT_DIRECTORY_CONFLICT',
        'Project directory is already active'
      );
    }
    const id = nextAvailableId();
    projects.insertProject({
      id,
      name: normalizeProjectName(request.name, directory.cwd),
      cwd: directory.cwd,
      canonicalCwd: directory.canonicalCwd,
      profile: normalizeProfile(request.profile),
      model: request.model ?? null,
      reasoning: request.reasoning ?? null,
      sandbox: request.sandbox ?? 'follow-global'
    });
    return mapProjectRow(projects.getProject(id)!);
  }

  function nextAvailableId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = createId();
      if (id.trim().length > 0 && projects.getProject(id) === undefined) return id;
    }
    throw new Error('Unable to allocate a unique project id');
  }

  function createMigratedProjectRecord(
    request: CreateMigratedProjectInput
  ): ProjectResponse {
    const directory = readMigratedDirectory(request.cwd, homeDir);
    if (directory.canonicalCwd !== null) {
      const duplicate = projects.getProjectByActiveCanonicalCwd(directory.canonicalCwd);
      if (duplicate !== undefined) return mapProjectRow(duplicate);
    }
    const preferredId = request.preferredId?.trim();
    const id =
      preferredId !== undefined
      && preferredId.length > 0
      && projects.getProject(preferredId) === undefined
        ? preferredId
        : nextAvailableId();
    projects.insertProject({
      id,
      name: normalizeProjectName(request.name, directory.cwd),
      cwd: directory.cwd,
      canonicalCwd: directory.canonicalCwd,
      profile: normalizeProfile(request.profile),
      model: request.model ?? null,
      reasoning: request.reasoning ?? null,
      sandbox: request.sandbox ?? 'follow-global'
    });
    return mapProjectRow(projects.getProject(id)!);
  }

  function getRequiredProject(id: string): ProjectRow {
    const project = projects.getProject(id);
    if (project === undefined) {
      throw new ProjectManagerError('PROJECT_NOT_FOUND', 'Project not found');
    }
    return project;
  }
}

const LOCAL_STORAGE_V1_MIGRATION_KEY = 'local-storage-v1';
const LOCAL_HOME_PROJECT_ID = 'local-home';

type StoredLocalStorageV1MigrationResult = Omit<
  MigrateLocalStorageProjectsV1Response,
  'status'
>;

function hashMigrationRequest(request: MigrateLocalStorageProjectsV1Request): string {
  return createHash('sha256')
    .update(JSON.stringify(request))
    .digest('hex');
}

function readStoredMigrationResult(value: string): StoredLocalStorageV1MigrationResult {
  return JSON.parse(value) as StoredLocalStorageV1MigrationResult;
}

function requireAvailableDirectory(
  value: string,
  homeDir: string
): { cwd: string; canonicalCwd: string } {
  const cwd = normalizeProjectPath(value, homeDir);
  try {
    if (!statSync(cwd).isDirectory()) throw new Error('not a directory');
    return { cwd, canonicalCwd: realpathSync(cwd) };
  } catch {
    throw new ProjectManagerError(
      'PROJECT_DIRECTORY_UNAVAILABLE',
      'Project directory does not exist or is not accessible'
    );
  }
}

function readMigratedDirectory(
  value: string,
  homeDir: string
): { cwd: string; canonicalCwd: string | null } {
  const cwd = normalizeProjectPath(value, homeDir);
  try {
    if (!statSync(cwd).isDirectory()) return { cwd, canonicalCwd: null };
    return { cwd, canonicalCwd: realpathSync(cwd) };
  } catch {
    return { cwd, canonicalCwd: null };
  }
}

function normalizeProjectPath(value: string, homeDir: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProjectManagerError(
      'PROJECT_DIRECTORY_UNAVAILABLE',
      'Project directory is required'
    );
  }
  return resolve(expandHome(trimmed, homeDir));
}

function normalizeProjectName(value: string | undefined, cwd: string): string {
  const name = value?.trim() || basename(cwd) || '项目';
  if (name.length === 0) throw new Error('Project name is required');
  return name;
}

function normalizeManagedProjectName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new ProjectManagerError('PROJECT_NAME_INVALID', '项目名称不能为空');
  }
  if (name.length > 80) {
    throw new ProjectManagerError('PROJECT_NAME_INVALID', '项目名称不能超过 80 个字符');
  }
  if (
    name === '.'
    || name === '..'
    || name.includes('/')
    || name.includes('\\')
    || name.includes('\0')
  ) {
    throw new ProjectManagerError(
      'PROJECT_NAME_INVALID',
      '项目名称不能包含路径分隔符'
    );
  }
  return name;
}

function normalizeProfile(value: string | undefined): string {
  return value?.trim() || 'default';
}

function mapProjectRow(row: ProjectRow): ProjectResponse {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    canonicalCwd: row.canonical_cwd,
    directoryState: readDirectoryState(row),
    profile: row.profile,
    model: row.model,
    reasoning: row.reasoning as ProjectResponse['reasoning'],
    sandbox: row.sandbox,
    status: row.status,
    createdAt: normalizeDatabaseTimestamp(row.created_at),
    updatedAt: normalizeDatabaseTimestamp(row.updated_at),
    archivedAt: normalizeNullableDatabaseTimestamp(row.archived_at)
  };
}

function readDirectoryState(row: ProjectRow): ProjectDirectoryState {
  if (row.canonical_cwd === null) return 'missing';
  try {
    return statSync(row.cwd).isDirectory() && realpathSync(row.cwd) === row.canonical_cwd
      ? 'available'
      : 'missing';
  } catch {
    return 'missing';
  }
}
