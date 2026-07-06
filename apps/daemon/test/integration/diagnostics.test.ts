import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadRepository } from '../../src/storage/repositories.js';
import { createFakeCodex } from '../helpers/fake-codex.js';

let tempDir = '';
let server: FastifyInstance | undefined;
let db: Database.Database | undefined;
const RUN_STATUS_TIMEOUT_MS = 5_000;
type TestInjectPayload = string | object;

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

  it('returns diagnostics response for authorized route requests', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await server.inject({
      method: 'GET',
      url: '/runs/run_1/diagnostics',
      headers: { authorization: 'Bearer secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runId: 'run_1', files: [] });
  });

  it('includes thread and resume diagnostics for failed resume runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
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
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;
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
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-diagnostics-'));
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
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;

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
      sandbox: 'read-only',
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

function authPost(url: string, payload: unknown) {
  return server!.inject({
    method: 'POST',
    url,
    headers: { authorization: 'Bearer secret' },
    payload: payload as TestInjectPayload
  });
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
