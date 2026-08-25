import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildServer as buildRuntimeServer,
  type BuildServerInput
} from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';
import { createFakeCodex } from '../helpers/fake-codex.js';

let tempDir = '';
let server: FastifyInstance | undefined;
let db: Database.Database | undefined;
const RUN_STATUS_TIMEOUT_MS = 5_000;
type TestInjectPayload = string | object;

const buildServer = (input: BuildServerInput) => buildRuntimeServer({
  persistentAppServerEnabled: false,
  runtimeTransport: 'exec',
  ...input
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('diagnostics', () => {
  it('rejects unauthorized diagnostics route requests', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await server.inject({ method: 'GET', url: '/runs/run_1/diagnostics' });

    expect(response.statusCode).toBe(401);
  });

  it('returns enhanced diagnostics with a codex status snapshot and redacted default files', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertFinishedRun(database, 'run_1');
    writeRunFiles(tempDir, 'run_1', {
      'meta.json': '{"id":"run_1"}',
      'stderr.redacted.log': 'Authorization: Bearer sk-secret-token\n',
      'raw.redacted.ndjson': 'Authorization: Bearer sk-raw-token\n'
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexBin: 'codex-test',
      codexHome: join(tempDir, 'codex-home')
    });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: 'run_1',
      codexStatusSnapshot: {
        codexBin: 'codex-test',
        codexVersion: 'unknown',
        codexHome: join(tempDir, 'codex-home')
      },
      warnings: expect.arrayContaining(['Diagnostics are redacted on a best-effort basis.'])
    });
    expect(response.json().files).toEqual([
      { name: 'meta.json', content: '{"id":"run_1"}' },
      { name: 'stderr.redacted.log', content: 'Authorization: Bearer [REDACTED]\n' }
    ]);
  });

  it('exports a safe schedule trigger trace without prompt, token, or result content', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertScheduleRunTrace(database);
    writeRunFiles(tempDir, 'run_schedule', {
      'meta.json': JSON.stringify({
        id: 'run_schedule',
        prompt: 'TOKEN=private-file-prompt',
        result: 'TOKEN=private-file-result'
      })
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexHome: join(tempDir, 'codex-home')
    });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_schedule/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().scheduleTrace).toEqual({
      scheduleId: 'sch_trace',
      threadId: 'thread_trace',
      runId: 'run_schedule',
      triggerType: 'timer_trigger',
      actorType: 'timer',
      actorRunId: null,
      scheduledAt: '2026-07-14T09:00:00.000Z',
      startedAt: '2026-07-14T09:00:01.000Z',
      endedAt: '2026-07-14T09:00:03.000Z',
      status: 'failed',
      queueReason: null,
      errorCode: 'RUN_FAILED',
      events: [
        {
          type: 'SCHEDULE_TRIGGERED',
          occurredAt: '2026-07-14T09:00:00.000Z',
          operationId: 'schop_trace'
        },
        {
          type: 'SCHEDULE_RUN_STARTED',
          occurredAt: '2026-07-14T09:00:01.000Z'
        },
        {
          type: 'SCHEDULE_RUN_WAITING_APPROVAL',
          occurredAt: '2026-07-14T09:00:02.000Z'
        },
        {
          type: 'SCHEDULE_RUN_COMPLETED',
          occurredAt: '2026-07-14T09:00:03.000Z',
          errorCode: 'RUN_FAILED'
        }
      ]
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /private-schedule|private-public|private-error|private-approval|private-file/i
    );
  });

  it('includes raw.redacted.ndjson only when includeRawRedacted is true', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertFinishedRun(database, 'run_1');
    writeRunFiles(tempDir, 'run_1', {
      'meta.json': '{"id":"run_1"}',
      'raw.redacted.ndjson': 'Authorization: Bearer sk-raw-token\n'
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexHome: join(tempDir, 'codex-home')
    });

    const withoutRaw = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });
    const withRaw = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics?includeRawRedacted=true',
      headers: { authorization: 'Bearer secret' }
    });

    expect(withoutRaw.statusCode).toBe(200);
    expect(withoutRaw.json().files.map((file: { name: string }) => file.name)).not.toContain(
      'raw.redacted.ndjson'
    );
    expect(withRaw.statusCode).toBe(200);
    expect(withRaw.json().files).toContainEqual({
      name: 'raw.redacted.ndjson',
      content: 'Authorization: Bearer [REDACTED]\n'
    });
  });

  it('returns validation and not found errors for invalid or missing runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexHome: join(tempDir, 'codex-home')
    });

    const invalid = await server.inject({
      method: 'GET',
      url: '/runs/not-a-run/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });
    const missing = await server.inject({
      method: 'GET',
      url: '/runs/run_missing/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('RUN_NOT_FOUND');
  });

  it('returns empty files with a warning when the DB run exists but the run directory is missing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    insertFinishedRun(database, 'run_1');
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexHome: join(tempDir, 'codex-home')
    });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: 'run_1',
      files: [],
      warnings: expect.arrayContaining(['Run diagnostics directory is missing.'])
    });
  });

  it('includes thread and resume diagnostics for failed resume runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const database = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db = database;
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      stderrLines: ['No session found for missing-session'],
      exitCode: 1
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: database,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      resumeCapabilityVerified: true
    });
    const thread = await createApiConversation();
    createThreadRepository(database).setCodexThreadId(thread.id, 'missing-session');

    const created = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'continue',
      resumeMode: 'resume_thread'
    });
    await waitForRunStatus(created.json().id, 'failed');

    expect(readDiagnosticsFile(tempDir, created.json().id)).toMatchObject({
      threadId: thread.id,
      codexThreadId: 'missing-session',
      resumeMode: 'resume_thread',
      errorCode: 'RESUME_TARGET_NOT_FOUND'
    });
  });

  it('includes thread diagnostics when canceling queued thread runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }],
      hang: true
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });
    const thread = await createApiConversation();

    const first = await authPost('/runs', { threadId: thread.id, prompt: 'hang' });
    const second = await authPost('/runs', { threadId: thread.id, prompt: 'queued' });
    expect(second.json().status).toBe('queued');

    const canceled = await authPost(`/runs/${second.json().id}/cancel`, {});
    expect(canceled.statusCode).toBe(202);
    await waitForRunStatus(second.json().id, 'canceled');

    expect(readDiagnosticsFile(tempDir, second.json().id)).toMatchObject({
      threadId: thread.id,
      resumeMode: 'new_thread',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      queueState: 'queued',
      terminationReason: 'user_canceled'
    });

    await authPost(`/runs/${first.json().id}/cancel`, {});
    await waitForRunStatus(first.json().id, 'canceled');
  });
});

function readDiagnosticsFile(root: string, runId: string) {
  return JSON.parse(readFileSync(join(root, 'runs', runId, 'diagnostics.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function insertFinishedRun(database: Database.Database, id: string): void {
  createRunRepository(database).insertRun({
    id,
    publicStatus: 'succeeded',
    internalStatus: 'succeeded',
    createdBy: 'test',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1
  });
}

function insertScheduleRunTrace(database: Database.Database): void {
  database.prepare(`
    INSERT INTO schedules (
      id, thread_id, name, cron, timezone, prompt, prompt_hash, prompt_preview_redacted,
      profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
    ) VALUES (
      'sch_trace', 'thread_trace', 'trace task', '0 9 * * *', 'UTC',
      'TOKEN=private-schedule-prompt', 'hash', '[REDACTED]', 'default',
      @cwd, @cwd, 'read-only', 'queue', 'skip'
    )
  `).run({ cwd: tempDir });
  database.prepare(`
    INSERT INTO runs (
      id, thread_id, public_status, internal_status, created_by, source_id,
      public_prompt, triggered_at, profile, cwd, canonical_cwd, workspace_mode,
      sandbox, codex_version, codex_bin, codex_home, normalizer_version,
      started_at, ended_at, error_code, error_message
    ) VALUES (
      'run_schedule', 'thread_trace', 'failed', 'failed', 'schedule', 'sch_trace',
      'TOKEN=private-public-prompt', '2026-07-14T09:00:00.000Z', 'default',
      @cwd, @cwd, 'external', 'read-only', 'test', 'codex', @codexHome, 1,
      '2026-07-14T09:00:01.000Z', '2026-07-14T09:00:03.000Z',
      'RUN_FAILED', 'TOKEN=private-error-result'
    )
  `).run({
    cwd: tempDir,
    codexHome: join(tempDir, 'codex-home')
  });
  database.prepare(`
    INSERT INTO schedule_operations (
      id, schedule_id, operation, status, run_id, actor_type, created_at
    ) VALUES (
      'schop_trace', 'sch_trace', 'timer_trigger', 'succeeded', 'run_schedule',
      'timer', '2026-07-14T09:00:00.000Z'
    )
  `).run();
  database.prepare(`
    INSERT INTO approvals (
      id, run_id, thread_id, turn_id, item_id, request_id, kind, status, risk,
      title, summary, details_json, requested_at, expires_at, resolved_at
    ) VALUES (
      'approval_trace', 'run_schedule', 'thread_trace', 'turn_1', 'item_1',
      'request_1', 'command_execution', 'approved', 'medium', 'Approve command',
      'TOKEN=private-approval-summary', '{"result":"TOKEN=private-approval-result"}',
      '2026-07-14T09:00:02.000Z', '2026-07-14T09:10:00.000Z',
      '2026-07-14T09:00:02.500Z'
    )
  `).run();
}

function writeRunFiles(root: string, runId: string, files: Record<string, string>): void {
  const runDir = join(root, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(runDir, name), content);
  }
}

function authPost(url: string, payload: unknown) {
  return server!.inject({
    method: 'POST',
    url,
    headers: { authorization: 'Bearer secret' },
    payload: payload as TestInjectPayload
  });
}

async function createApiConversation(): Promise<{
  id: string;
  projectId: string;
}> {
  const project = await authPost('/projects', {
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  });
  expect(project.statusCode).toBe(201);
  const projectId = project.json().project.id as string;
  const thread = await authPost('/threads', { projectId });
  expect(thread.statusCode).toBe(201);
  return thread.json().thread as {
    id: string;
    projectId: string;
  };
}

async function waitForRunStatus(runId: string, status: string): Promise<void> {
  await expect
    .poll(async () => {
      const response = await server?.inject({
        method: 'GET',
        url: `/runs/${runId}`,
        headers: { authorization: 'Bearer secret' }
      });
      return response?.json().status;
    }, { timeout: RUN_STATUS_TIMEOUT_MS })
    .toBe(status);
}
