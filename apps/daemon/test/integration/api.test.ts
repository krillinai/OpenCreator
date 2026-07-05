import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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

  it('creates, lists, gets, and archives threads through the api', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const created = await server.inject({
      method: 'POST',
      url: '/threads',
      headers: { authorization: 'Bearer secret' },
      payload: { title: 'R2', workspaceMode: 'managed', sandbox: 'read-only' }
    });
    expect(created.statusCode).toBe(201);
    const thread = created.json().thread;

    const listed = await server.inject({
      method: 'GET',
      url: '/threads',
      headers: { authorization: 'Bearer secret' }
    });
    expect(listed.json().threads).toEqual([expect.objectContaining({ id: thread.id })]);

    const detail = await server.inject({
      method: 'GET',
      url: `/threads/${thread.id}`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(detail.json().thread).toMatchObject({ id: thread.id, status: 'active' });

    const archived = await server.inject({
      method: 'POST',
      url: `/threads/${thread.id}/archive`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().thread.status).toBe('archived');
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

  it('replays events after the legacy afterSeq query parameter', async () => {
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

    const replay = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events?afterSeq=2`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.body).not.toContain('"seq":1');
    expect(replay.body).not.toContain('"seq":2');
    expect(replay.body).toContain('"seq":3');
    expect(replay.body).toContain('event: done');
  });

  it('replays many SSE events in sequence order', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        ...Array.from({ length: 50 }, (_, index) => ({
          type: 'item.completed',
          item: { type: 'agent_message', text: `message-${index + 1}` }
        })),
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

    const replay = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['content-type']).toContain('text/event-stream');

    const events = parseSseData(replay.body);
    expect(events).toHaveLength(53);
    expect(events.map(event => event.seq)).toEqual(
      Array.from({ length: 53 }, (_, index) => index + 1)
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', seq: 53 });
  });

  it('tails a running run and closes after done', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } },
        { type: 'turn.completed' }
      ],
      initialDelayMs: 100,
      lineDelayMs: 100
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

    const events = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(events.statusCode).toBe(200);
    expect(events.body).toContain('event: assistant_message');
    expect(events.body).toContain('event: done');
    await waitForRunStatus(run.id, 'succeeded');
  });

  it('sends SSE heartbeats while a run is still active', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }],
      hang: true
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      sseHeartbeatMs: 20
    });
    await server.listen({ host: '127.0.0.1', port: 0 });

    const created = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: { authorization: 'Bearer secret' },
      payload: { prompt: 'hello', cwd: tempDir, sandbox: 'read-only' }
    });
    const run = created.json() as { id: string };
    const address = server.server.address() as AddressInfo;
    const controller = new AbortController();

    const response = await fetch(
      `http://127.0.0.1:${address.port}/runs/${run.id}/events`,
      {
        headers: { authorization: 'Bearer secret' },
        signal: controller.signal
      }
    );
    expect(response.status).toBe(200);

    const text = await readUntil(response, ': heartbeat', controller, 500);
    expect(text).toContain(': heartbeat');

    const canceled = await server.inject({
      method: 'POST',
      url: `/runs/${run.id}/cancel`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(canceled.statusCode).toBe(202);
    await waitForRunStatus(run.id, 'canceled');
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

function parseSseData(body: string): Array<{ seq: number; type: string }> {
  return body
    .split('\n\n')
    .filter(chunk => chunk.trim().length > 0)
    .map(chunk => {
      const dataLine = chunk.split('\n').find(line => line.startsWith('data: '));
      expect(dataLine).toBeDefined();
      return JSON.parse(dataLine!.slice('data: '.length)) as { seq: number; type: string };
    });
}

async function readUntil(
  response: Response,
  needle: string,
  controller: AbortController,
  timeoutMs: number
): Promise<string> {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const decoder = new TextDecoder();
  let text = '';
  const timeout = delay(timeoutMs).then((): { timeout: true } => {
    controller.abort();
    return { timeout: true };
  });

  try {
    while (!text.includes(needle)) {
      const result = await Promise.race([reader!.read(), timeout]);
      if ('timeout' in result) break;
      if (result.done) break;
      text += decoder.decode(result.value, { stream: true });
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
  } finally {
    controller.abort();
    reader!.releaseLock();
  }

  return text;
}
