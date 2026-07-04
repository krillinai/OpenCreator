import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { createFakeCodex } from '../helpers/fake-codex.js';

let server: FastifyInstance | undefined;
let tempDir = '';
const RUN_STATUS_TIMEOUT_MS = 5_000;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('runtime api', () => {
  it('rejects unauthorized requests', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/codex/status' });
    expect(response.statusCode).toBe(401);
  });

  it('returns health without auth', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns codex status with auth', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({
      method: 'GET',
      url: '/codex/status',
      headers: { authorization: 'Bearer secret' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ codexHomeMode: 'global' });
  });

  it('creates a run, lists history, and replays events over SSE', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'hello' }
        },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const created = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, sandbox: 'read-only' }
    });
    expect(created.statusCode).toBe(202);
    const run = created.json() as { id: string; status: string };
    expect(run.status).toBe('running');

    await waitForRunStatus(run.id, 'succeeded');

    const history = await server.inject({
      method: 'GET',
      url: '/runs',
      headers: { authorization: 'Bearer secret' }
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().runs[0]).toMatchObject({ id: run.id, status: 'succeeded' });

    const events = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain('event: assistant_message');
    expect(events.body).toContain('event: done');
  });

  it('replays events after fromSeq and Last-Event-ID', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const created = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, sandbox: 'read-only' }
    });
    const run = created.json() as { id: string };

    await waitForRunStatus(run.id, 'succeeded');

    const fromSeq = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events?fromSeq=2`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(fromSeq.statusCode).toBe(200);
    expect(fromSeq.body).not.toContain('"seq":1');
    expect(fromSeq.body).not.toContain('"seq":2');
    expect(fromSeq.body).toContain('"seq":3');
    expect(fromSeq.body).toContain('event: done');

    const lastEventId = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events`,
      headers: {
        authorization: 'Bearer secret',
        'last-event-id': '3'
      }
    });
    expect(lastEventId.statusCode).toBe(200);
    expect(lastEventId.body).not.toContain('"seq":3');
    expect(lastEventId.body).toContain('event: done');
  });

  it('cancels a running run through the api', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const created = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, sandbox: 'read-only' }
    });
    const run = created.json() as { id: string };

    const canceled = await server.inject({
      method: 'POST',
      url: `/runs/${run.id}/cancel`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(canceled.statusCode).toBe(202);

    await waitForRunStatus(run.id, 'canceled');
  });

  it('returns RUN_ALREADY_TERMINAL when canceling a completed run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.completed' }]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const created = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, sandbox: 'read-only' }
    });
    const run = created.json() as { id: string };

    await waitForRunStatus(run.id, 'succeeded');

    const canceled = await server.inject({
      method: 'POST',
      url: `/runs/${run.id}/cancel`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(canceled.statusCode).toBe(409);
    expect(canceled.json()).toEqual({
      error: {
        code: 'RUN_ALREADY_TERMINAL',
        message: 'Run is already terminal'
      }
    });
  });
});

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
