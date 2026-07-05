import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { RuntimeCapabilityMatrix } from '../../src/codex/capabilities.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createFakeCodex } from '../helpers/fake-codex.js';

let server: FastifyInstance | undefined;
let tempDir = '';
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
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const capabilities = makeResumeCapableMatrix();
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', codexHome, capabilities });
    const response = await server.inject({
      method: 'GET',
      url: '/codex/status',
      headers: { authorization: 'Bearer secret' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      codexHomeSource: 'isolated',
      codexHomeWritable: true,
      codexVersion: capabilities.codexVersion,
      capabilities: {
        resumeJson: true,
        resumeByThreadId: true
      }
    });
  });

  it('lists profiles from an isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'review.config.toml'),
      'model = "gpt-5.3-codex"\n'
    );
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      writable: true,
      baseConfigValid: true,
      profiles: [
        {
          name: 'review',
          status: 'valid',
          config: { model: 'gpt-5.3-codex' }
        }
      ]
    });
  });

  it('returns invalid profile diagnostics instead of crashing for invalid profile config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "broken');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profiles).toEqual([
      expect.objectContaining({
        name: 'review',
        status: 'invalid',
        diagnostics: [expect.stringContaining('Failed to parse')]
      })
    ]);
  });

  it('returns diagnostics instead of crashing when base config is invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), 'model = "broken');
    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "gpt-5.3-codex"\n');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().baseConfigValid).toBe(false);
    expect(response.json().profiles).toEqual([
      expect.objectContaining({ name: 'review', status: 'valid' })
    ]);
    expect(response.json().diagnostics[0]).toContain('Failed to parse config.toml');
  });

  it('returns config invalid when getting a profile by name with invalid base config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), 'model = "broken');
    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "gpt-5.3-codex"\n');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles/review',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CODEX_CONFIG_INVALID');
  });

  it('returns diagnostics instead of crashing when codex home is not a directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    writeFileSync(codexHome, 'not a directory');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profiles).toEqual([]);
    expect(response.json().diagnostics.length).toBeGreaterThan(0);
  });

  it('gets a profile by name from an isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "gpt-5.3-codex"\n');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles/review',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profile: {
        name: 'review',
        status: 'valid',
        config: { model: 'gpt-5.3-codex' }
      }
    });
  });

  it('returns not found when getting a missing profile by name', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await server.inject({
      method: 'GET',
      url: '/codex/profiles/review',
      headers: { authorization: 'Bearer secret' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
  });

  it('creates, updates, and deletes profiles in an isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const created = await authPost('/codex/profiles', {
      name: 'review',
      config: {
        model: 'gpt-5.3-codex',
        model_reasoning_effort: 'high'
      }
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      profile: {
        name: 'review',
        status: 'valid',
        config: {
          model: 'gpt-5.3-codex',
          model_reasoning_effort: 'high'
        },
        codexHomeMode: 'isolated'
      }
    });

    const updated = await authPatch('/codex/profiles/review', {
      config: {
        model: 'gpt-5.3-codex',
        model_reasoning_effort: 'medium'
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      profile: {
        name: 'review',
        status: 'valid',
        config: {
          model: 'gpt-5.3-codex',
          model_reasoning_effort: 'medium'
        },
        codexHomeMode: 'isolated'
      }
    });

    const deleted = await authDelete('/codex/profiles/review');

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });

    const missing = await authGet('/codex/profiles/review');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
  });

  it('rejects profile writes for the global codex home', async () => {
    server = await buildServer({ token: 'secret' });

    const response = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CODEX_HOME_READ_ONLY');
  });

  it('returns CODEX_PROFILE_EXISTS when creating a duplicate profile', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const payload = {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    };

    expect((await authPost('/codex/profiles', payload)).statusCode).toBe(201);
    const duplicate = await authPost('/codex/profiles', payload);

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CODEX_PROFILE_EXISTS');
  });

  it('returns CODEX_PROFILE_NOT_FOUND when updating or deleting a missing profile', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const updated = await authPatch('/codex/profiles/missing', {
      config: { model: 'gpt-5.3-codex' }
    });
    const deleted = await authDelete('/codex/profiles/missing');

    expect(updated.statusCode).toBe(404);
    expect(updated.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
    expect(deleted.statusCode).toBe(404);
    expect(deleted.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
  });

  it('rejects invalid profile write bodies without server errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const invalidPosts: Array<{
      label: string;
      payload: unknown;
      headers?: Record<string, string>;
    }> = [
      {
        label: 'string body',
        payload: JSON.stringify('not-an-object'),
        headers: { 'content-type': 'application/json' }
      },
      { label: 'array body', payload: [] },
      { label: 'missing name', payload: { config: { model: 'gpt-5.3-codex' } } },
      { label: 'invalid name', payload: { name: '../review', config: { model: 'gpt-5.3-codex' } } },
      { label: 'missing config', payload: { name: 'review' } },
      { label: 'array config', payload: { name: 'review', config: [] } },
      { label: 'nested config', payload: { name: 'review', config: { nested: { bad: true } } } }
    ];

    for (const { label, payload, headers } of invalidPosts) {
      const response = await server.inject({
        method: 'POST',
        url: '/codex/profiles',
        headers: { authorization: 'Bearer secret', ...headers },
        payload: payload as TestInjectPayload
      });
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error.code, label).toBe('VALIDATION_FAILED');
    }

    const invalidPatches: Array<{
      label: string;
      payload: unknown;
      headers?: Record<string, string>;
    }> = [
      {
        label: 'string body',
        payload: JSON.stringify('not-an-object'),
        headers: { 'content-type': 'application/json' }
      },
      { label: 'array body', payload: [] },
      { label: 'missing config', payload: {} },
      { label: 'array config', payload: { config: [] } },
      { label: 'nested config', payload: { config: { nested: { bad: true } } } }
    ];

    for (const { label, payload, headers } of invalidPatches) {
      const response = await server.inject({
        method: 'PATCH',
        url: '/codex/profiles/review',
        headers: { authorization: 'Bearer secret', ...headers },
        payload: payload as TestInjectPayload
      });
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error.code, label).toBe('VALIDATION_FAILED');
    }
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

  it('rejects invalid thread list query parameters', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    for (const url of ['/threads?limit=-1', '/threads?limit=1.5', '/threads?status=paused']) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer secret' }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects invalid thread run history limits', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const created = await server.inject({
      method: 'POST',
      url: '/threads',
      headers: { authorization: 'Bearer secret' },
      payload: { workspaceMode: 'managed' }
    });
    const thread = created.json().thread;

    const response = await server.inject({
      method: 'GET',
      url: `/threads/${thread.id}/runs?limit=0`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects invalid thread creation bodies', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const invalidPayloads: Array<{
      label: string;
      payload: unknown;
      headers?: Record<string, string>;
    }> = [
      {
        label: 'string body',
        payload: JSON.stringify('not-an-object'),
        headers: { 'content-type': 'application/json' }
      },
      { label: 'array body', payload: [] },
      { label: 'numeric title', payload: { title: 123 } },
      { label: 'invalid workspace mode', payload: { workspaceMode: 'workspace' } },
      { label: 'invalid sandbox', payload: { sandbox: 'full-access' } },
      { label: 'invalid reasoning', payload: { reasoning: 'extreme' } },
      { label: 'numeric cwd', payload: { cwd: 123 } },
      { label: 'boolean profile', payload: { profile: false } },
      { label: 'numeric model', payload: { model: 4 } }
    ];

    for (const { label, payload, headers } of invalidPayloads) {
      const response = await server.inject({
        method: 'POST',
        url: '/threads',
        headers: { authorization: 'Bearer secret', ...headers },
        payload: payload as TestInjectPayload
      });
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error.code, label).toBe('VALIDATION_FAILED');
    }
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

  it('rejects invalid run request bodies without server errors', async () => {
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

    const invalidPayloads: Array<{
      label: string;
      payload: unknown;
      headers?: Record<string, string>;
    }> = [
      {
        label: 'string body',
        payload: JSON.stringify('not-an-object'),
        headers: { 'content-type': 'application/json' }
      },
      {
        label: 'malformed json body',
        payload: '{',
        headers: { 'content-type': 'application/json' }
      },
      { label: 'array body', payload: [] },
      { label: 'missing prompt', payload: {} },
      { label: 'empty prompt', payload: { prompt: '' } },
      { label: 'numeric prompt', payload: { prompt: 123 } },
      { label: 'object threadId', payload: { prompt: 'x', threadId: { bad: 1 } } },
      { label: 'numeric cwd', payload: { prompt: 'x', cwd: 123 } },
      { label: 'boolean profile', payload: { prompt: 'x', profile: false } },
      { label: 'numeric model', payload: { prompt: 'x', model: 4 } },
      { label: 'invalid resume mode', payload: { prompt: 'x', resumeMode: 'resume' } },
      { label: 'invalid sandbox', payload: { prompt: 'x', sandbox: 'full-access' } },
      { label: 'invalid reasoning', payload: { prompt: 'x', reasoning: 'extreme' } }
    ];

    for (const { label, payload, headers } of invalidPayloads) {
      const response = await server.inject({
        method: 'POST',
        url: '/runs',
        headers: { authorization: 'Bearer secret', ...headers },
        payload: payload as TestInjectPayload
      });
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error.code, label).toBe('VALIDATION_FAILED');
    }
  });

  it('creates a thread run using immutable thread config and binds codex thread id', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'hello' } },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      capabilities: makeResumeCapableMatrix()
    });

    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;

    const createdRun = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'hello'
    });
    expect(createdRun.statusCode).toBe(202);

    await waitForRunStatus(createdRun.json().id, 'succeeded');

    const detail = await authGet(`/threads/${thread.id}`);
    expect(detail.json().thread.codexThreadId).toBe('codex-thread-1');

    const resumedRun = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'continue'
    });
    expect(resumedRun.statusCode).toBe(202);

    await waitForRunStatus(resumedRun.json().id, 'succeeded');
    expect(fake.readArgv()).toEqual(
      expect.arrayContaining(['exec', 'resume', 'codex-thread-1', '--json'])
    );
  });

  it('lists runs for a thread in newest-first order', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      resumeCapabilityVerified: true
    });

    const thread = await createThreadViaApi();
    const first = await authPost('/runs', { threadId: thread.id, prompt: 'first' });
    const second = await authPost('/runs', { threadId: thread.id, prompt: 'second' });

    await waitForRunStatus(first.json().id, 'succeeded');
    await waitForRunStatus(second.json().id, 'succeeded');

    const history = await authGet(`/threads/${thread.id}/runs`);
    expect(history.statusCode).toBe(200);
    expect(history.json().runs.map((run: { id: string }) => run.id)).toEqual([
      second.json().id,
      first.json().id
    ]);
  });

  it('allows equivalent cwd paths when checking immutable thread config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
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

    const equivalentCwd = join(tempDir, 'equivalent-cwd');
    symlinkSync(tempDir, equivalentCwd);

    const createdRun = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'hello',
      cwd: equivalentCwd
    });

    expect(createdRun.statusCode).toBe(202);
    await waitForRunStatus(createdRun.json().id, 'succeeded');
  });

  it('rejects run requests that override thread config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;

    const response = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'hello',
      sandbox: 'workspace-write'
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('THREAD_CONFIG_IMMUTABLE');
  });

  it('rejects run requests that override non-sandbox thread config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;

    const response = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'hello',
      profile: 'review'
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('THREAD_CONFIG_IMMUTABLE');
  });

  it('rejects missing and archived thread run targets', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const missing = await authPost('/runs', {
      threadId: 'thread_missing',
      prompt: 'hello'
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('THREAD_NOT_FOUND');

    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;
    await authPost(`/threads/${thread.id}/archive`, {});

    const archived = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'hello'
    });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('THREAD_ARCHIVED');
  });

  it('rejects archiving a thread with a running run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, { stdoutLines: [{ type: 'turn.started' }], hang: true });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });
    const thread = await createThreadViaApi();
    const run = (await authPost('/runs', { threadId: thread.id, prompt: 'hang' })).json();

    const archived = await authPost(`/threads/${thread.id}/archive`, {});
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('THREAD_HAS_ACTIVE_RUN');

    await authPost(`/runs/${run.id}/cancel`, {});
    await waitForRunStatus(run.id, 'canceled');
  });

  it('rejects archiving a thread with a queued run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, db });
    const thread = await createThreadViaApi();
    db.prepare(`
      INSERT INTO runs (
        id, thread_id, public_status, internal_status, created_by, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (
        'run_queued_archive_conflict', @threadId, 'queued', 'queued', 'api', 'default', @cwd, @cwd,
        'managed', 'read-only', 'unknown', 'codex', @codexHome, 1
      )
    `).run({
      threadId: thread.id,
      cwd: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });

    const archived = await authPost(`/threads/${thread.id}/archive`, {});
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('THREAD_HAS_ACTIVE_RUN');
  });

  it('rejects archiving a thread with a canceling run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }],
      hang: true,
      ignoreSigterm: true
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });
    const thread = await createThreadViaApi();
    const run = (await authPost('/runs', { threadId: thread.id, prompt: 'hang' })).json();
    await authPost(`/runs/${run.id}/cancel`, {});
    await waitForRunInternalStatus(run.id, 'canceling');

    const archived = await authPost(`/threads/${thread.id}/archive`, {});
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('THREAD_HAS_ACTIVE_RUN');

    await waitForRunStatus(run.id, 'canceled');
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

function makeResumeCapableMatrix(): RuntimeCapabilityMatrix {
  return {
    codexVersion: 'codex-cli test',
    checkedAt: '2026-07-05T00:00:00.000Z',
    execJson: true,
    execStdinPrompt: true,
    execProfile: true,
    execCwd: true,
    execSandbox: true,
    execSkipGitRepoCheck: true,
    resumeJson: true,
    resumeByThreadId: true,
    resumeLast: true,
    resumeModelOverride: true,
    resumeConfigOverride: true,
    resumeCwdOverride: false,
    resumeProfileOverride: false,
    resumeSandboxOverride: false,
    resumeContextContinuityVerified: false,
    mcpAddEnv: true,
    warnings: []
  };
}

function authPost(url: string, payload: unknown) {
  return server!.inject({
    method: 'POST',
    url,
    headers: { authorization: 'Bearer secret' },
    payload: payload as TestInjectPayload
  });
}

function authPatch(url: string, payload: unknown) {
  return server!.inject({
    method: 'PATCH',
    url,
    headers: { authorization: 'Bearer secret' },
    payload: payload as TestInjectPayload
  });
}

function authDelete(url: string) {
  return server!.inject({
    method: 'DELETE',
    url,
    headers: { authorization: 'Bearer secret' }
  });
}

function authGet(url: string) {
  return server!.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer secret' }
  });
}

async function createThreadViaApi() {
  return (await authPost('/threads', {
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  })).json().thread;
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

async function waitForRunInternalStatus(runId: string, status: string): Promise<void> {
  await expect
    .poll(() => {
      const row = db
        ?.prepare('SELECT internal_status FROM runs WHERE id = ?')
        .get(runId) as { internal_status: string } | undefined;
      return row?.internal_status;
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
