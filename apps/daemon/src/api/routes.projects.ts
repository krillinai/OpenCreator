import type {
  CreateManagedProjectRequest,
  CreateProjectRequest,
  LegacyLocalStorageProjectV1,
  MigrateLocalStorageProjectsV1Request,
  ProjectSandbox,
  ProjectStatus,
  ReasoningEffort,
  ReplaceProjectDirectoryRequest,
  UpdateProjectRequest
} from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ProjectManagerError,
  type ProjectManager
} from '../projects/types.js';
import { apiError } from './errors.js';

const PROJECT_STATUSES = ['active', 'archived', 'all'] as const;
const PROJECT_SANDBOXES = [
  'follow-global',
  'read-only',
  'workspace-write',
  'danger-full-access'
] as const satisfies readonly ProjectSandbox[];
const REASONING_EFFORTS = [
  'default',
  'low',
  'medium',
  'high',
  'xhigh'
] as const satisfies readonly ReasoningEffort[];

export async function registerProjectRoutes(
  server: FastifyInstance,
  manager: ProjectManager,
  runs: { hasActiveRunForProject(projectId: string): boolean }
): Promise<void> {
  server.get('/projects', async (request, reply) => {
    const status = parseProjectListStatus(request.query);
    if (!status.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', status.message));
    }
    return { projects: manager.listProjects(status.value) };
  });

  server.post<{ Body: unknown }>('/projects', async (request, reply) => {
    const body = parseCreateProjectRequest(request.body);
    if (!body.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
    }
    try {
      return reply.code(201).send({ project: manager.createProject(body.value) });
    } catch (error) {
      return sendProjectError(reply, error);
    }
  });

  server.post('/projects/default', async (_request, reply) => {
    try {
      return { project: manager.ensureDefaultProject() };
    } catch (error) {
      return sendProjectError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/projects/managed', async (request, reply) => {
    const body = parseCreateManagedProjectRequest(request.body);
    if (!body.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
    }
    try {
      return reply.code(201).send({ project: manager.createManagedProject(body.value) });
    } catch (error) {
      return sendProjectError(reply, error);
    }
  });

  server.post<{ Body: unknown }>(
    '/projects/migrations/local-storage-v1',
    async (request, reply) => {
      const body = parseLocalStorageV1MigrationRequest(request.body);
      if (!body.ok) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
      }
      try {
        return manager.migrateLocalStorageV1(body.value);
      } catch (error) {
        return sendProjectError(reply, error);
      }
    }
  );

  server.patch<{ Params: { id: string }; Body: unknown }>(
    '/projects/:id',
    async (request, reply) => {
      const body = parseUpdateProjectRequest(request.body);
      if (!body.ok) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
      }
      try {
        return { project: manager.updateProject(request.params.id, body.value) };
      } catch (error) {
        return sendProjectError(reply, error);
      }
    }
  );

  server.post<{ Params: { id: string } }>(
    '/projects/:id/archive',
    async (request, reply) => {
      const existing = manager.getProject(request.params.id);
      if (existing === undefined) {
        return reply.code(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'));
      }
      if (runs.hasActiveRunForProject(existing.id)) {
        return reply
          .code(409)
          .send(apiError('PROJECT_HAS_ACTIVE_RUN', 'Project has active run'));
      }
      try {
        return { project: manager.archiveProject(existing.id) };
      } catch (error) {
        return sendProjectError(reply, error);
      }
    }
  );

  server.post<{ Params: { id: string } }>(
    '/projects/:id/restore',
    async (request, reply) => {
      try {
        return { project: manager.restoreProject(request.params.id) };
      } catch (error) {
        return sendProjectError(reply, error);
      }
    }
  );

  server.post<{ Params: { id: string }; Body: unknown }>(
    '/projects/:id/replace-directory',
    async (request, reply) => {
      const body = parseReplaceDirectoryRequest(request.body);
      if (!body.ok) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
      }
      const existing = manager.getProject(request.params.id);
      if (existing === undefined) {
        return reply.code(404).send(apiError('PROJECT_NOT_FOUND', 'Project not found'));
      }
      if (runs.hasActiveRunForProject(existing.id)) {
        return reply
          .code(409)
          .send(apiError('PROJECT_HAS_ACTIVE_RUN', 'Project has active run'));
      }
      try {
        return {
          project: manager.replaceProjectDirectory(existing.id, body.value)
        };
      } catch (error) {
        return sendProjectError(reply, error);
      }
    }
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseProjectListStatus(
  query: unknown
): ParseResult<ProjectStatus | 'all'> {
  if (query === undefined || query === null) return { ok: true, value: 'active' };
  if (!isPlainObject(query)) return { ok: false, message: 'query must be an object' };
  const status = query.status;
  if (status === undefined) return { ok: true, value: 'active' };
  if (!isOneOf(status, PROJECT_STATUSES)) {
    return { ok: false, message: 'status must be active, archived, or all' };
  }
  return { ok: true, value: status };
}

function parseCreateProjectRequest(body: unknown): ParseResult<CreateProjectRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.cwd !== 'string' || body.cwd.trim().length === 0) {
    return { ok: false, message: 'cwd is required' };
  }
  const shared = parseProjectConfig(body);
  if (!shared.ok) return shared;
  return {
    ok: true,
    value: {
      cwd: body.cwd,
      ...shared.value
    }
  };
}

function parseCreateManagedProjectRequest(
  body: unknown
): ParseResult<CreateManagedProjectRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.name !== 'string') {
    return { ok: false, message: 'name must be a string' };
  }
  if (Object.keys(body).some(key => key !== 'name')) {
    return { ok: false, message: 'body contains unsupported fields' };
  }
  return { ok: true, value: { name: body.name } };
}

function parseUpdateProjectRequest(body: unknown): ParseResult<UpdateProjectRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if ('cwd' in body || 'status' in body || 'id' in body) {
    return {
      ok: false,
      message: 'cwd and status must be changed through dedicated project actions'
    };
  }
  const parsed = parseProjectConfig(body);
  if (!parsed.ok) return parsed;
  if (Object.keys(parsed.value).length === 0) {
    return { ok: false, message: 'at least one project field is required' };
  }
  return parsed;
}

function parseReplaceDirectoryRequest(
  body: unknown
): ParseResult<ReplaceProjectDirectoryRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.cwd !== 'string' || body.cwd.trim().length === 0) {
    return { ok: false, message: 'cwd is required' };
  }
  return { ok: true, value: { cwd: body.cwd } };
}

function parseLocalStorageV1MigrationRequest(
  body: unknown
): ParseResult<MigrateLocalStorageProjectsV1Request> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (Object.keys(body).some(key => key !== 'projects')) {
    return { ok: false, message: 'body contains unsupported fields' };
  }
  if (!Array.isArray(body.projects)) {
    return { ok: false, message: 'projects must be an array' };
  }

  const projects: LegacyLocalStorageProjectV1[] = [];
  const ids = new Set<string>();
  for (const [index, item] of body.projects.entries()) {
    const parsed = parseLegacyProject(item, index);
    if (!parsed.ok) return parsed;
    if (ids.has(parsed.value.id)) {
      return {
        ok: false,
        message: `projects[${index}].id must be unique`
      };
    }
    ids.add(parsed.value.id);
    projects.push(parsed.value);
  }
  return { ok: true, value: { projects } };
}

function parseLegacyProject(
  value: unknown,
  index: number
): ParseResult<LegacyLocalStorageProjectV1> {
  if (!isPlainObject(value)) {
    return { ok: false, message: `projects[${index}] must be an object` };
  }
  const parsed: Partial<LegacyLocalStorageProjectV1> = {};
  for (const key of ['id', 'name', 'cwd', 'profile'] as const) {
    const field = value[key];
    if (typeof field !== 'string' || field.trim().length === 0) {
      return {
        ok: false,
        message: `projects[${index}].${key} must be a non-empty string`
      };
    }
    parsed[key] = field;
  }
  if (!isOneOf(value.sandbox, PROJECT_SANDBOXES)) {
    return {
      ok: false,
      message: `projects[${index}].sandbox must be a valid project sandbox`
    };
  }
  parsed.sandbox = value.sandbox;
  if (value.model !== null && typeof value.model !== 'string') {
    return {
      ok: false,
      message: `projects[${index}].model must be a string or null`
    };
  }
  parsed.model = value.model;
  if (value.reasoning !== null && !isOneOf(value.reasoning, REASONING_EFFORTS)) {
    return {
      ok: false,
      message: `projects[${index}].reasoning must be a valid reasoning effort or null`
    };
  }
  parsed.reasoning = value.reasoning;
  return { ok: true, value: parsed as LegacyLocalStorageProjectV1 };
}

function parseProjectConfig(
  body: Record<string, unknown>
): ParseResult<UpdateProjectRequest> {
  const value: UpdateProjectRequest = {};
  for (const key of ['name', 'profile'] as const) {
    const field = body[key];
    if (field === undefined) continue;
    if (typeof field !== 'string' || field.trim().length === 0) {
      return { ok: false, message: `${key} must be a non-empty string` };
    }
    value[key] = field;
  }

  if (body.model !== undefined) {
    if (body.model !== null && typeof body.model !== 'string') {
      return { ok: false, message: 'model must be a string or null' };
    }
    value.model = body.model;
  }
  if (body.reasoning !== undefined) {
    if (body.reasoning !== null && !isOneOf(body.reasoning, REASONING_EFFORTS)) {
      return { ok: false, message: 'reasoning must be a valid reasoning effort or null' };
    }
    value.reasoning = body.reasoning;
  }
  if (body.sandbox !== undefined) {
    if (!isOneOf(body.sandbox, PROJECT_SANDBOXES)) {
      return { ok: false, message: 'sandbox must be a valid project sandbox' };
    }
    value.sandbox = body.sandbox;
  }
  return { ok: true, value };
}

function sendProjectError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ProjectManagerError)) throw error;
  if (error.code === 'PROJECT_NAME_INVALID') {
    return reply.code(400).send(apiError(error.code, error.message));
  }
  if (error.code === 'PROJECT_NOT_FOUND') {
    return reply.code(404).send(apiError(error.code, error.message));
  }
  if (error.code === 'PROJECT_DIRECTORY_UNAVAILABLE') {
    return reply.code(422).send(apiError(error.code, error.message));
  }
  return reply.code(409).send(apiError(error.code, error.message));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  options: T
): value is T[number] {
  return typeof value === 'string' && options.includes(value);
}
