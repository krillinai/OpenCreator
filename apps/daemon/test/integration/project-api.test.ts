import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { CodexSessionProvider } from '../../src/codex/sessions/app-server-provider.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import {
  createRunRepository,
  createThreadRepository
} from '../../src/storage/repositories.js';

let server: FastifyInstance | undefined;
let db: Database.Database | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('project API', () => {
  it('ensures the same default project across repeated requests', async () => {
    const setup = await createSetup();

    const first = await request('POST', '/projects/default');
    const repeated = await request('POST', '/projects/default');

    expect(first.statusCode).toBe(200);
    expect(first.json().project).toMatchObject({
      name: '默认项目',
      cwd: join(tempDir, 'OpenCreator', 'Default Project'),
      directoryState: 'available'
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().project).toEqual(first.json().project);
    expect(
      setup.db.prepare('SELECT COUNT(*) AS count FROM projects').get()
    ).toEqual({ count: 1 });
  });

  it('creates managed projects under the configured OpenCreator directory', async () => {
    await createSetup();

    const created = await request('POST', '/projects/managed', { name: ' 浏览器项目 ' });

    expect(created.statusCode).toBe(201);
    expect(created.json().project).toMatchObject({
      name: '浏览器项目',
      cwd: join(tempDir, 'OpenCreator', '浏览器项目'),
      directoryState: 'available'
    });
    expect(realpathSync(join(tempDir, 'OpenCreator', '浏览器项目')))
      .toBe(created.json().project.canonicalCwd);

    const invalid = await request('POST', '/projects/managed', { name: '../escape' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('PROJECT_NAME_INVALID');

    const duplicate = await request('POST', '/projects/managed', { name: '浏览器项目' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('PROJECT_DIRECTORY_CONFLICT');
  });

  it('manages projects without deleting threads and replaces execution directories atomically', async () => {
    const setup = await createSetup();
    const firstDir = join(tempDir, 'first');
    const secondDir = join(tempDir, 'second');
    mkdirSync(firstDir);
    mkdirSync(secondDir);

    const createdResponse = await request('POST', '/projects', {
      cwd: firstDir,
      name: 'First',
      profile: 'default',
      sandbox: 'workspace-write'
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json().project as {
      id: string;
      canonicalCwd: string;
    };
    expect(created.canonicalCwd).toBe(realpathSync(firstDir));

    createThreadRepository(setup.db).insertThread({
      id: 'thread_owned',
      title: 'Owned',
      codexThreadId: 'codex_owned',
      projectId: created.id,
      origin: 'opencreator_created',
      cwd: firstDir,
      canonicalCwd: realpathSync(firstDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write',
      status: 'active',
      purpose: 'conversation'
    });
    createThreadRepository(setup.db).insertThread({
      id: 'thread_schedule',
      title: 'Schedule',
      cwd: firstDir,
      canonicalCwd: realpathSync(firstDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write',
      status: 'active',
      purpose: 'schedule_task'
    });

    const updated = await request('PATCH', `/projects/${created.id}`, {
      name: 'Renamed',
      model: 'gpt-test'
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().project).toMatchObject({
      id: created.id,
      name: 'Renamed',
      model: 'gpt-test'
    });

    const archived = await request('POST', `/projects/${created.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().project.status).toBe('archived');
    expect(createThreadRepository(setup.db).getThread('thread_owned')).toMatchObject({
      codex_thread_id: 'codex_owned',
      project_id: created.id,
      status: 'active'
    });

    const restored = await request('POST', `/projects/${created.id}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().project.status).toBe('active');

    const replaced = await request(
      'POST',
      `/projects/${created.id}/replace-directory`,
      { cwd: secondDir }
    );
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().project).toMatchObject({
      id: created.id,
      cwd: secondDir,
      canonicalCwd: realpathSync(secondDir)
    });
    expect(createThreadRepository(setup.db).getThread('thread_owned')).toMatchObject({
      project_id: created.id,
      cwd: secondDir,
      canonical_cwd: realpathSync(secondDir),
      codex_thread_id: 'codex_owned'
    });
    expect(createThreadRepository(setup.db).getThread('thread_schedule')).toMatchObject({
      cwd: firstDir
    });
  });

  it('rejects duplicate directories and project mutations with active runs', async () => {
    const setup = await createSetup();
    const projectDir = join(tempDir, 'project');
    const replacementDir = join(tempDir, 'replacement');
    mkdirSync(projectDir);
    mkdirSync(replacementDir);

    const first = await request('POST', '/projects', { cwd: projectDir });
    expect(first.statusCode).toBe(201);
    const projectId = first.json().project.id as string;

    const duplicate = await request('POST', '/projects', { cwd: projectDir });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('PROJECT_DIRECTORY_CONFLICT');

    createThreadRepository(setup.db).insertThread({
      id: 'thread_running',
      projectId,
      origin: 'opencreator_created',
      cwd: projectDir,
      canonicalCwd: realpathSync(projectDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write',
      status: 'active',
      purpose: 'conversation'
    });
    createRunRepository(setup.db).insertRun({
      id: 'run_running',
      threadId: 'thread_running',
      publicStatus: 'running',
      internalStatus: 'running',
      createdBy: 'api',
      profile: 'default',
      cwd: projectDir,
      canonicalCwd: realpathSync(projectDir),
      workspaceMode: 'external',
      sandbox: 'workspace-write',
      codexVersion: 'codex-cli test',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const archive = await request('POST', `/projects/${projectId}/archive`);
    expect(archive.statusCode).toBe(409);
    expect(archive.json().error.code).toBe('PROJECT_HAS_ACTIVE_RUN');

    const replace = await request(
      'POST',
      `/projects/${projectId}/replace-directory`,
      { cwd: replacementDir }
    );
    expect(replace.statusCode).toBe(409);
    expect(replace.json().error.code).toBe('PROJECT_HAS_ACTIVE_RUN');
  });

  it('migrates local storage projects once and classifies owned, unassigned and discovered threads', async () => {
    const setup = await createSetup();
    const sharedDir = join(tempDir, 'shared');
    const missingDir = join(tempDir, 'missing');
    mkdirSync(sharedDir);
    const threads = createThreadRepository(setup.db);
    threads.insertThread({
      id: 'thread_owned',
      title: 'Owned',
      projectId: null,
      origin: 'opencreator_created',
      cwd: sharedDir,
      canonicalCwd: realpathSync(sharedDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write',
      status: 'active',
      purpose: 'conversation'
    });
    threads.insertThread({
      id: 'thread_unassigned',
      title: 'Unassigned',
      projectId: null,
      origin: 'opencreator_created',
      cwd: tempDir,
      canonicalCwd: realpathSync(tempDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write',
      status: 'active',
      purpose: 'conversation'
    });
    threads.insertThread({
      id: 'thread_codex_external',
      title: 'External',
      projectId: null,
      origin: 'codex_discovered',
      cwd: sharedDir,
      canonicalCwd: realpathSync(sharedDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation'
    });

    const invalid = await request('POST', '/projects/migrations/local-storage-v1', {
      projects: [
        legacyProject('legacy-shared', sharedDir, 'Shared'),
        {
          ...legacyProject('legacy-invalid', missingDir, 'Invalid'),
          profile: ''
        }
      ]
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');
    expect(
      setup.db.prepare('SELECT COUNT(*) AS count FROM projects').get()
    ).toEqual({ count: 0 });

    const migrated = await request('POST', '/projects/migrations/local-storage-v1', {
      projects: [
        legacyProject('legacy-shared', sharedDir, 'Shared'),
        legacyProject('legacy-duplicate', join(sharedDir, '..', 'shared'), 'Duplicate'),
        legacyProject('legacy-missing', missingDir, 'Missing'),
        legacyProject('local-home', tempDir, '本机目录')
      ]
    });

    expect(migrated.statusCode).toBe(200);
    expect(migrated.json()).toMatchObject({
      status: 'applied',
      assignedThreadIds: ['thread_owned'],
      unassignedThreadIds: ['thread_unassigned']
    });
    const firstResult = migrated.json() as {
      projectIdMap: Record<string, string>;
      assignedThreadIds: string[];
      unassignedThreadIds: string[];
    };
    expect(firstResult.projectIdMap['legacy-shared']).toBeTruthy();
    expect(firstResult.projectIdMap['legacy-duplicate'])
      .toBe(firstResult.projectIdMap['legacy-shared']);
    expect(firstResult.projectIdMap['legacy-missing']).toBeTruthy();
    expect(firstResult.projectIdMap).not.toHaveProperty('local-home');
    expect(threads.getThread('thread_owned')).toMatchObject({
      project_id: firstResult.projectIdMap['legacy-shared']
    });
    expect(threads.getThread('thread_unassigned')).toMatchObject({
      project_id: null
    });
    expect(threads.getThread('thread_codex_external')).toMatchObject({
      project_id: null,
      origin: 'codex_discovered'
    });

    const projects = await request('GET', '/projects?status=all');
    expect(projects.json().projects).toHaveLength(2);
    expect(projects.json().projects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: firstResult.projectIdMap['legacy-shared'],
        directoryState: 'available'
      }),
      expect.objectContaining({
        id: firstResult.projectIdMap['legacy-missing'],
        directoryState: 'missing'
      })
    ]));
    const projectCount = setup.db
      .prepare('SELECT COUNT(*) AS count FROM projects')
      .get() as { count: number };

    const repeated = await request('POST', '/projects/migrations/local-storage-v1', {
      projects: []
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual({
      status: 'already_applied',
      projectIdMap: firstResult.projectIdMap,
      assignedThreadIds: firstResult.assignedThreadIds,
      unassignedThreadIds: firstResult.unassignedThreadIds
    });
    expect(
      setup.db.prepare('SELECT COUNT(*) AS count FROM projects').get()
    ).toEqual(projectCount);
  });

  it('assigns an unowned OpenCreator thread without changing its execution directory', async () => {
    const setup = await createSetup();
    const projectDir = join(tempDir, 'project');
    const legacyDir = join(tempDir, 'legacy');
    mkdirSync(projectDir);
    mkdirSync(legacyDir);
    const created = await request('POST', '/projects', {
      cwd: projectDir,
      name: 'Target'
    });
    const projectId = created.json().project.id as string;
    const threads = createThreadRepository(setup.db);
    threads.insertThread({
      id: 'thread_unowned',
      title: 'Unowned',
      projectId: null,
      origin: 'opencreator_created',
      cwd: legacyDir,
      canonicalCwd: realpathSync(legacyDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write',
      status: 'active',
      purpose: 'conversation'
    });
    threads.insertThread({
      id: 'thread_discovered',
      title: 'Discovered',
      projectId: null,
      origin: 'codex_discovered',
      cwd: legacyDir,
      canonicalCwd: realpathSync(legacyDir),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation'
    });

    const assigned = await request('POST', '/threads/thread_unowned/assign-project', {
      projectId
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().thread).toMatchObject({
      id: 'thread_unowned',
      projectId,
      cwd: legacyDir,
      canonicalCwd: realpathSync(legacyDir)
    });
    expect(threads.getThread('thread_unowned')).toMatchObject({
      project_id: projectId,
      cwd: legacyDir,
      canonical_cwd: realpathSync(legacyDir)
    });

    const repeated = await request('POST', '/threads/thread_unowned/assign-project', {
      projectId
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().error.code).toBe('THREAD_ALREADY_ASSIGNED');

    const discovered = await request('POST', '/threads/thread_discovered/assign-project', {
      projectId
    });
    expect(discovered.statusCode).toBe(404);
    expect(discovered.json().error.code).toBe('THREAD_NOT_FOUND');
  });
});

async function createSetup(): Promise<{ db: Database.Database }> {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-project-api-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  server = await buildServer({
    token: 'secret',
    dataDir: tempDir,
    defaultProjectRoot: tempDir,
    db,
    codexSessionProvider: fakeProvider()
  });
  return { db };
}

async function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: Record<string, unknown>
) {
  return await server!.inject({
    method,
    url,
    headers: {
      authorization: 'Bearer secret',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { payload: body })
  });
}

function fakeProvider(): CodexSessionProvider {
  return {
    async listTurns() {
      return { items: [], hasMore: false };
    },
    async search() {
      return { results: [], hasMore: false };
    },
    async close() {
      return;
    }
  };
}

function legacyProject(id: string, cwd: string, name: string) {
  return {
    id,
    name,
    cwd,
    sandbox: 'follow-global',
    profile: 'default',
    model: null,
    reasoning: null
  };
}
