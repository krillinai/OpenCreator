import type { FastifyInstance } from 'fastify';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { RuntimeCapabilityMatrix } from '../../src/codex/capabilities.js';
import type { MarketArchiveDownloader } from '../../src/codex/skills/market-downloader.js';
import { SchedulerError, type SchedulerService } from '../../src/scheduler/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';
import { createThreadManager } from '../../src/threads/manager.js';
import { createFakeCodex } from '../helpers/fake-codex.js';
import { createRunManager } from '../../src/runs/manager.js';

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
  it('starts and stops an injected scheduler when autostart is enabled', async () => {
    const scheduler = createFakeScheduler({
      start: vi.fn(),
      stop: vi.fn()
    });

    server = await buildServer({
      token: 'secret',
      scheduler,
      schedulerAutostart: true
    });

    expect(scheduler.start).toHaveBeenCalledTimes(1);

    await server.close();
    server = undefined;

    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });

  it('leaves an injected scheduler stopped when autostart is not enabled', async () => {
    const scheduler = createFakeScheduler({
      start: vi.fn(),
      stop: vi.fn()
    });

    server = await buildServer({
      token: 'secret',
      scheduler
    });

    expect(scheduler.start).not.toHaveBeenCalled();

    await server.close();
    server = undefined;

    expect(scheduler.stop).toHaveBeenCalledTimes(1);
  });

  it('closes the run manager before server shutdown completes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runManager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: join(tempDir, 'codex'),
      codexHome: join(tempDir, 'codex-home')
    });
    const close = vi.spyOn(runManager, 'close');

    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db,
      runManager
    });

    await server.close();
    server = undefined;

    expect(close).toHaveBeenCalledWith({ timeoutMs: 5_000 });
  });

  it('rejects unauthorized requests', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/codex/status' });
    expect(response.statusCode).toBe(401);
  });

  it('allows web app CORS preflight from localhost origins', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/runs',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,last-event-id'
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'authorization'
    );
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'content-type'
    );
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'last-event-id'
    );
  });

  it('allows web app CORS preflight from Vite fallback ports', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/runs',
      headers: {
        origin: 'http://127.0.0.1:5174',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type'
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5174');
  });

  it('does not allow arbitrary web origins', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({
      method: 'OPTIONS',
      url: '/runs',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'GET'
      }
    });

    expect(response.headers['access-control-allow-origin']).not.toBe('https://example.com');
  });

  it('workspace files routes expose external thread files and enforce auth and path validation', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-workspace-files-'));
    writeFileSync(join(tempDir, 'README.md'), '# Hello\n');
    writeFileSync(join(tempDir, 'note.txt'), 'before');
    writeFileSync(
      join(tempDir, 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=',
        'base64'
      )
    );
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    })).json().thread as { id: string };

    const directory = await authGet(
      `/workspace/files/directory?threadId=${thread.id}&path=${encodeURIComponent('')}`
    );
    expect(directory.statusCode).toBe(200);
    expect(directory.json().nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'README.md', type: 'file' })])
    );

    const content = await authGet(
      `/workspace/files/content?threadId=${thread.id}&path=${encodeURIComponent('README.md')}`
    );
    expect(content.statusCode).toBe(200);
    expect(content.json().content).toBe('# Hello\n');

    const meta = content.json().meta as { versionToken: string };
    const save = await authPost('/workspace/files/content', {
      threadId: thread.id,
      path: 'note.txt',
      content: 'after',
      baseVersionToken: (
        await authGet(`/workspace/files/meta?threadId=${thread.id}&path=${encodeURIComponent('note.txt')}`)
      ).json().versionToken
    });
    expect(save.statusCode).toBe(200);
    expect(readFileSync(join(tempDir, 'note.txt'), 'utf8')).toBe('after');

    const blob = await authGet(
      `/workspace/files/blob?threadId=${thread.id}&path=${encodeURIComponent('pixel.png')}`
    );
    expect(blob.statusCode).toBe(200);
    expect(blob.headers['content-type']).toBe('image/png');
    expect(blob.headers['cache-control']).toBe('no-store');
    expect(Buffer.isBuffer(blob.rawPayload)).toBe(true);

    const unauthorized = await server.inject({
      method: 'GET',
      url: `/workspace/files/blob?threadId=${thread.id}&path=${encodeURIComponent('pixel.png')}`
    });
    expect(unauthorized.statusCode).toBe(401);

    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/workspace/files/content',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type'
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(String(preflight.headers['access-control-allow-methods'])).toContain('POST');

    const traversal = await authGet(
      `/workspace/files/content?threadId=${thread.id}&path=${encodeURIComponent('../secret.txt')}`
    );
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json()).toEqual({
      error: {
        code: 'PATH_INVALID',
        message: expect.any(String)
      }
    });
    expect(meta.versionToken).toEqual(expect.any(String));
  });

  it('workspace file save honors overwriteConflict only when explicitly true', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-workspace-conflict-'));
    writeFileSync(join(tempDir, 'note.txt'), 'before');
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    })).json().thread as { id: string };

    const initialMeta = (
      await authGet(`/workspace/files/meta?threadId=${thread.id}&path=${encodeURIComponent('note.txt')}`)
    ).json() as { versionToken: string };

    writeFileSync(join(tempDir, 'note.txt'), 'other');

    const conflict = await authPost('/workspace/files/content', {
      threadId: thread.id,
      path: 'note.txt',
      content: 'updated',
      baseVersionToken: initialMeta.versionToken
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      error: {
        code: 'FILE_CONFLICT',
        message: expect.any(String)
      }
    });

    const overwrite = await authPost('/workspace/files/content', {
      threadId: thread.id,
      path: 'note.txt',
      content: 'updated',
      baseVersionToken: initialMeta.versionToken,
      overwriteConflict: true
    });
    expect(overwrite.statusCode).toBe(200);
    expect(readFileSync(join(tempDir, 'note.txt'), 'utf8')).toBe('updated');
  });

  it('attachment routes enforce binary limits, content verification, scoped access, and persistence', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-attachment-api-'));
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=',
      'base64'
    );
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      attachmentMaxSizeBytes: 128
    });

    const uploadUrl = `/attachments?${new URLSearchParams({
      draftId: 'draft/1',
      fileName: "../../设计's 图.png",
      mime: 'image/png'
    })}`;
    const upload = await authUpload(uploadUrl, png);
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({
      attachment: {
        id: expect.any(String),
        fileName: "设计's 图.png",
        mime: 'image/png',
        size: png.length,
        draftId: 'draft/1',
        status: 'draft'
      },
      deduplicated: false
    });
    const attachmentId = upload.json().attachment.id as string;

    const duplicate = await authUpload(uploadUrl, png);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      attachment: { id: attachmentId },
      deduplicated: true
    });

    const metadata = await authGet(
      `/attachments/${attachmentId}?draftId=${encodeURIComponent('draft/1')}`
    );
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({ attachment: { id: attachmentId } });

    const content = await authGet(
      `/attachments/${attachmentId}/content?draftId=${encodeURIComponent('draft/1')}`
    );
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['content-disposition']).toContain('attachment');
    expect(content.headers['content-disposition']).toContain('%27');
    expect(content.rawPayload).toEqual(png);

    const unauthorized = await server.inject({
      method: 'GET',
      url: `/attachments/${attachmentId}/content?draftId=${encodeURIComponent('draft/1')}`
    });
    expect(unauthorized.statusCode).toBe(401);

    const wrongDraft = await authGet(`/attachments/${attachmentId}?draftId=draft-2`);
    expect(wrongDraft.statusCode).toBe(403);
    expect(wrongDraft.json().error.code).toBe('ATTACHMENT_ACCESS_DENIED');

    const spoofed = await authUpload(
      `/attachments?${new URLSearchParams({
        draftId: 'draft-2',
        fileName: 'fake.png',
        mime: 'image/png'
      })}`,
      Buffer.from('not a png')
    );
    expect(spoofed.statusCode).toBe(415);
    expect(spoofed.json().error.code).toBe('ATTACHMENT_TYPE_MISMATCH');

    const oversized = await authUpload(
      `/attachments?${new URLSearchParams({
        draftId: 'draft-2',
        fileName: 'large.txt',
        mime: 'text/plain'
      })}`,
      Buffer.alloc(129, 65)
    );
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe('ATTACHMENT_TOO_LARGE');

    await server.close();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      attachmentMaxSizeBytes: 128
    });
    const persisted = await authGet(
      `/attachments/${attachmentId}?draftId=${encodeURIComponent('draft/1')}`
    );
    expect(persisted.statusCode).toBe(200);

    const deleted = await authDelete(
      `/attachments/${attachmentId}?draftId=${encodeURIComponent('draft/1')}`
    );
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(
      (await authGet(`/attachments/${attachmentId}?draftId=${encodeURIComponent('draft/1')}`))
        .statusCode
    ).toBe(404);
  });

  it('runs accept attachment ids, pass controlled image paths to codex, and expose attachment metadata', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-images-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-images' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      capabilities: makeResumeCapableMatrix({
        execImages: true,
        resumeImages: true
      })
    });
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread as { id: string };
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=',
      'base64'
    );
    const uploaded = await authUpload(
      `/attachments?${new URLSearchParams({
        draftId: 'draft-images',
        fileName: 'screen.png',
        mime: 'image/png'
      })}`,
      png
    );
    const attachment = uploaded.json().attachment as {
      id: string;
      storageKey: string;
    };

    const created = await authPost('/runs', {
      threadId: thread.id,
      prompt: '描述这张图片',
      draftId: 'draft-images',
      attachmentIds: [attachment.id]
    });
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({
      id: expect.any(String),
      threadId: thread.id,
      attachments: [
        {
          id: attachment.id,
          threadId: thread.id,
          runId: expect.any(String),
          status: 'committed'
        }
      ]
    });
    const runId = created.json().id as string;
    await waitForRunStatus(runId, 'succeeded');

    expect(fake.readArgv()).toEqual(expect.arrayContaining([
      '--image',
      realpathSync(join(tempDir, 'attachments', attachment.storageKey))
    ]));
    expect(fake.readArgv()).not.toContain(attachment.id);

    expect((await authGet(`/runs/${runId}`)).json()).toMatchObject({
      id: runId,
      attachments: [{ id: attachment.id, runId }]
    });
    expect((await authGet(`/threads/${thread.id}/runs`)).json()).toMatchObject({
      runs: [{ id: runId, attachments: [{ id: attachment.id, runId }] }]
    });
  });

  it('rejects run images when codex image input is unsupported and keeps the draft reusable', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-images-unsupported-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      capabilities: makeResumeCapableMatrix({
        execImages: false,
        resumeImages: false
      })
    });
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread as { id: string };
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn6zkAAAAAASUVORK5CYII=',
      'base64'
    );
    const uploaded = await authUpload(
      `/attachments?${new URLSearchParams({
        draftId: 'draft-images',
        fileName: 'screen.png',
        mime: 'image/png'
      })}`,
      png
    );
    const attachmentId = uploaded.json().attachment.id as string;

    const rejected = await authPost('/runs', {
      threadId: thread.id,
      prompt: '描述这张图片',
      draftId: 'draft-images',
      attachmentIds: [attachmentId]
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('CODEX_IMAGE_INPUT_UNSUPPORTED');
    expect(
      (await authGet(`/attachments/${attachmentId}?draftId=draft-images`)).json()
    ).toMatchObject({
      attachment: {
        id: attachmentId,
        draftId: 'draft-images',
        status: 'draft'
      }
    });
  });

  it('creates, lists, gets, updates, deletes, and runs schedules', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-schedule' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      schedulerAutostart: false
    });

    const created = await authPost('/schedules', {
      name: 'daily status',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize status',
      cwd: tempDir,
      timeoutMs: 5000
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      threadId: expect.stringMatching(/^thread_/),
      name: 'daily status',
      promptPreviewRedacted: 'Summarize status',
      timeoutMs: 5000,
      concurrencyPolicy: 'queue',
      misfirePolicy: 'skip'
    });
    expect(created.json()).not.toHaveProperty('prompt');
    const id = created.json().id;
    const threadId = created.json().threadId;

    const taskThread = await authGet(`/threads/${threadId}`);
    expect(taskThread.statusCode).toBe(200);
    expect(taskThread.json().thread).toMatchObject({
      id: threadId,
      scheduleId: id,
      title: 'daily status',
      cwd: tempDir,
      canonicalCwd: realpathSync(tempDir),
      workspaceMode: 'external',
      profile: 'default',
      model: null,
      reasoning: null,
      sandbox: 'workspace-write',
      purpose: 'schedule_task'
    });

    const listed = await authGet('/schedules');
    expect(listed.statusCode).toBe(200);
    expect(listed.json().schedules).toEqual([expect.objectContaining({ id, name: 'daily status' })]);
    expect(listed.json().schedules[0]).not.toHaveProperty('prompt');

    const fetched = await authGet(`/schedules/${id}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({
      id,
      name: 'daily status',
      prompt: 'Summarize status'
    });

    const updated = await authPatch(`/schedules/${id}`, {
      enabled: false,
      name: 'paused status'
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id,
      enabled: false,
      name: 'paused status',
      nextRunAt: null
    });
    expect((await authGet(`/threads/${threadId}`)).json().thread).toMatchObject({
      id: threadId,
      title: 'paused status',
      status: 'active'
    });

    const runNow = await authPost(`/schedules/${id}/run-now`, {});
    expect(runNow.statusCode).toBe(202);
    expect(runNow.json().run).toMatchObject({ threadId, status: 'running' });
    await waitForRunStatus(runNow.json().run.id, 'succeeded');
    expect((await authGet(`/runs/${runNow.json().run.id}`)).json()).toMatchObject({
      threadId,
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      createdBy: 'schedule',
      sourceId: id
    });

    const operations = await authGet(`/schedules/${id}/operations`);
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'run_now' })])
    );

    const deleted = await authDelete(`/schedules/${id}`);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect((await authGet(`/threads/${threadId}`)).json().thread).toMatchObject({
      id: threadId,
      status: 'archived'
    });
  });

  it('allows metadata updates but blocks schedule task configuration and deletion during active runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, { stdoutLines: [{ type: 'turn.started' }], hang: true });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });
    const schedule = (await authPost('/schedules', {
      name: 'daily status',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize status',
      cwd: tempDir
    })).json();
    const run = (await authPost('/runs', {
      threadId: schedule.threadId,
      prompt: 'keep running'
    })).json();

    const metadata = await authPatch(`/schedules/${schedule.id}`, {
      name: 'renamed status',
      prompt: 'Use the new prompt',
      enabled: false
    });
    const configuration = await authPatch(`/schedules/${schedule.id}`, {
      sandbox: 'danger-full-access'
    });
    const deleted = await authDelete(`/schedules/${schedule.id}`);

    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({
      name: 'renamed status',
      enabled: false
    });
    expect(configuration.statusCode).toBe(409);
    expect(configuration.json().error.code).toBe('SCHEDULE_HAS_ACTIVE_RUN');
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe('SCHEDULE_HAS_ACTIVE_RUN');

    await authPost(`/runs/${run.id}/cancel`, {});
    await waitForRunStatus(run.id, 'canceled');
  });

  it('returns stable conflicts for missing and unexpectedly archived schedule threads', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      db
    });
    const missing = (await authPost('/schedules', {
      name: 'missing thread',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize status',
      cwd: tempDir
    })).json();
    db.prepare('DELETE FROM threads WHERE id = ?').run(missing.threadId);

    const missingResponse = await authPatch(`/schedules/${missing.id}`, {
      name: 'still missing'
    });

    const archived = (await authPost('/schedules', {
      name: 'archived thread',
      cron: '0 10 * * *',
      timezone: 'UTC',
      prompt: 'Summarize status',
      cwd: tempDir
    })).json();
    db.prepare(`
      UPDATE threads
      SET status = 'archived',
          archived_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(archived.threadId);

    const archivedResponse = await authPatch(`/schedules/${archived.id}`, {
      name: 'still archived'
    });

    expect(missingResponse.statusCode).toBe(409);
    expect(missingResponse.json().error.code).toBe('SCHEDULE_THREAD_MISSING');
    expect(archivedResponse.statusCode).toBe(409);
    expect(archivedResponse.json().error.code).toBe('SCHEDULE_THREAD_ARCHIVED');
  });

  it('maps invalid and missing schedule requests', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      schedulerAutostart: false
    });

    const invalidBody = await authPost('/schedules', {});
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json().error.code).toBe('VALIDATION_FAILED');

    const invalidCron = await authPost('/schedules', {
      name: 'daily status',
      cron: 'not a cron',
      timezone: 'UTC',
      prompt: 'Summarize status',
      cwd: tempDir
    });
    expect(invalidCron.statusCode).toBe(422);
    expect(invalidCron.json().error.code).toBe('SCHEDULE_INVALID');

    const invalidParallel = await authPost('/schedules', {
      name: 'parallel status',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize status',
      cwd: tempDir,
      concurrencyPolicy: 'parallel'
    });
    expect(invalidParallel.statusCode).toBe(422);
    expect(invalidParallel.json().error.code).toBe('SCHEDULE_INVALID');

    const missing = await authGet('/schedules/sch_missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('SCHEDULE_NOT_FOUND');
  });

  it('maps scheduler internal errors without leaking details', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const scheduler = createFakeScheduler({
      runNow() {
        throw new SchedulerError('INTERNAL_ERROR', 'secret path /tmp/foo');
      }
    });
    server = await buildServer({ token: 'secret', dataDir: tempDir, scheduler });

    const response = await authPost('/schedules/sch_1/run-now', {});

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error'
      }
    });
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('/tmp/foo');
  });

  it('maps scheduler internal errors from list without leaking details', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const scheduler = createFakeScheduler({
      listSchedules() {
        throw new SchedulerError('INTERNAL_ERROR', 'secret list /tmp/list');
      }
    });
    server = await buildServer({ token: 'secret', dataDir: tempDir, scheduler });

    const response = await authGet('/schedules');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error'
      }
    });
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('/tmp/list');
  });

  it('maps scheduler internal errors from get without leaking details', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const scheduler = createFakeScheduler({
      getSchedule() {
        throw new SchedulerError('INTERNAL_ERROR', 'secret get /tmp/get');
      }
    });
    server = await buildServer({ token: 'secret', dataDir: tempDir, scheduler });

    const response = await authGet('/schedules/sch_1');

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error'
      }
    });
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('/tmp/get');
  });

  it('keeps injected scheduler stopped by default and stops it on close', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    let startCount = 0;
    let stopCount = 0;
    const scheduler = createFakeScheduler({
      start() {
        startCount += 1;
      },
      stop() {
        stopCount += 1;
      }
    });

    server = await buildServer({ token: 'secret', dataDir: tempDir, scheduler });

    expect(startCount).toBe(0);
    await server.close();
    server = undefined;
    expect(stopCount).toBe(1);
  });

  it('returns health without auth', async () => {
    server = await buildServer({ token: 'secret' });
    const response = await server.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('previews and confirms runtime cleanup without deleting database rows', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, db });
    const oldRunDir = writeOldApiDir(join(tempDir, 'runs', 'run_cleanup_old'), 'events.ndjson', 'done');
    const activeRunDir = writeOldApiDir(join(tempDir, 'runs', 'run_cleanup_active'), 'events.ndjson', 'active');
    const archivedThreadDir = writeOldApiDir(
      join(tempDir, 'workspaces', 'thread_cleanup_archived'),
      'workspace.txt',
      'workspace'
    );
    const activeThreadDir = writeOldApiDir(
      join(tempDir, 'workspaces', 'thread_cleanup_active'),
      'workspace.txt',
      'active workspace'
    );
    const externalThreadDir = writeOldApiDir(
      join(tempDir, 'workspaces', 'thread_cleanup_external'),
      'workspace.txt',
      'external workspace'
    );

    insertApiRun('run_cleanup_old', { publicStatus: 'succeeded', internalStatus: 'succeeded' });
    insertApiRun('run_cleanup_active', { publicStatus: 'running', internalStatus: 'running' });
    insertApiThread('thread_cleanup_archived', { status: 'archived', workspaceMode: 'managed' });
    insertApiThread('thread_cleanup_active', { status: 'active', workspaceMode: 'managed' });
    insertApiThread('thread_cleanup_external', { status: 'archived', workspaceMode: 'external' });

    const preview = await authGet('/runtime/cleanup/preview?olderThanDays=30');
    expect(preview.statusCode).toBe(200);
    expect(preview.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'run_logs',
          id: 'run_cleanup_old',
          path: oldRunDir
        }),
        expect.objectContaining({
          type: 'managed_thread_workspace',
          id: 'thread_cleanup_archived',
          path: archivedThreadDir
        })
      ])
    );
    expect(preview.json().items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'run_cleanup_active' }),
        expect.objectContaining({ id: 'thread_cleanup_active' }),
        expect.objectContaining({ id: 'thread_cleanup_external' })
      ])
    );

    const unconfirmed = await authPost('/runtime/cleanup', { olderThanDays: 30 });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json().error.code).toBe('VALIDATION_FAILED');

    const deleted = await authPost('/runtime/cleanup', { olderThanDays: 30, confirm: true });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'run_cleanup_old', path: oldRunDir }),
        expect.objectContaining({ id: 'thread_cleanup_archived', path: archivedThreadDir })
      ])
    );
    expect(deleted.json().failed).toEqual([]);
    expect(existsSync(oldRunDir)).toBe(false);
    expect(existsSync(archivedThreadDir)).toBe(false);
    expect(existsSync(activeRunDir)).toBe(true);
    expect(existsSync(activeThreadDir)).toBe(true);
    expect(existsSync(externalThreadDir)).toBe(true);
    expect(createRunRepository(db).getRun('run_cleanup_old')).toBeDefined();
    expect(createThreadRepository(db).getThread('thread_cleanup_archived')).toBeDefined();
  });

  it('keeps run database records after cleanup so diagnostics reports missing files', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, db });
    const oldRunDir = writeOldApiDir(join(tempDir, 'runs', 'run_old'), 'events.ndjson', 'done');
    insertApiRun('run_old', { publicStatus: 'succeeded', internalStatus: 'succeeded' });

    const deleted = await authPost('/runtime/cleanup', { olderThanDays: 30, confirm: true });
    const diagnostics = await authGet('/runs/run_old/diagnostics');

    expect(deleted.statusCode).toBe(200);
    expect(existsSync(oldRunDir)).toBe(false);
    expect(createRunRepository(db).getRun('run_old')).toBeDefined();
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      runId: 'run_old',
      files: [],
      warnings: expect.arrayContaining(['Run diagnostics directory is missing.'])
    });
  });

  it('validates runtime cleanup query and body parameters', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    for (const url of [
      '/runtime/cleanup/preview',
      '/runtime/cleanup/preview?olderThanDays=0',
      '/runtime/cleanup/preview?olderThanDays=1.5',
      '/runtime/cleanup/preview?olderThanDays=abc'
    ]) {
      const response = await authGet(url);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }

    const stringBody = await server.inject({
      method: 'POST',
      url: '/runtime/cleanup',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      payload: '"not-object"'
    });
    expect(stringBody.statusCode).toBe(400);
    expect(stringBody.json().error.code).toBe('VALIDATION_FAILED');

    const confirmFalse = await authPost('/runtime/cleanup', { olderThanDays: 30, confirm: false });
    expect(confirmFalse.statusCode).toBe(400);
    expect(confirmFalse.json().error.code).toBe('VALIDATION_FAILED');

    const missingOlderThanDays = await authPost('/runtime/cleanup', { confirm: true });
    expect(missingOlderThanDays.statusCode).toBe(400);
    expect(missingOlderThanDays.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('unauthorized runtime cleanup route requests return 401', async () => {
    server = await buildServer({ token: 'secret' });

    const preview = await server.inject({
      method: 'GET',
      url: '/runtime/cleanup/preview?olderThanDays=30'
    });

    expect(preview.statusCode).toBe(401);
    expect(preview.json().error.code).toBe('UNAUTHORIZED');

    const cleanup = await server.inject({
      method: 'POST',
      url: '/runtime/cleanup',
      payload: { olderThanDays: 30, confirm: true }
    });

    expect(cleanup.statusCode).toBe(401);
    expect(cleanup.json().error.code).toBe('UNAUTHORIZED');
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
        resumeByThreadId: true,
        mcpList: true,
        mcpGet: true,
        mcpAdd: true,
        mcpRemove: true,
        mcpLogin: true,
        mcpLogout: true,
        mcpAddEnv: true,
        mcpAddUrl: true,
        mcpAddBearerTokenEnvVar: true,
        mcpAddOAuth: true,
        mcpRuntimeDiscoveryVerified: false,
        mcpRuntimeBehaviorVerified: false,
        skillsScan: true,
        skillsInstall: true,
        skillsDelete: true,
        skillsGlobalWrite: true,
        skillsRuntimeDiscoveryVerified: false,
        skillsRuntimeBehaviorVerified: false
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

  it('redacts sensitive profile values from list and detail responses', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(
      join(codexHome, 'review.config.toml'),
      [
        'model = "gpt-5.3-codex"',
        'api_token = "super-secret-value"',
        'service_password = "another-secret-value"',
        ''
      ].join('\n')
    );
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const listed = await authGet('/codex/profiles');
    const detail = await authGet('/codex/profiles/review');

    expect(listed.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(listed.json().profiles[0].config).toEqual({
      model: 'gpt-5.3-codex',
      api_token: '[REDACTED]',
      service_password: '[REDACTED]'
    });
    expect(detail.json().profile.config).toEqual(listed.json().profiles[0].config);
    expect(JSON.stringify(listed.json())).not.toContain('super-secret-value');
    expect(JSON.stringify(detail.json())).not.toContain('another-secret-value');
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

    const created = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });
    const updated = await authPatch('/codex/profiles/review', {
      config: { model: 'gpt-5.3-codex' }
    });
    const deleted = await authDelete('/codex/profiles/review');

    expect(created.statusCode).toBe(409);
    expect(created.json().error.code).toBe('CODEX_HOME_READ_ONLY');
    expect(updated.statusCode).toBe(409);
    expect(updated.json().error.code).toBe('CODEX_HOME_READ_ONLY');
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe('CODEX_HOME_READ_ONLY');
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

  it('rejects deleting a profile referenced by threads or schedules', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    expect((await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    })).statusCode).toBe(201);
    const thread = await authPost('/threads', {
      title: '审查会话',
      cwd: tempDir,
      workspaceMode: 'external',
      profile: 'review',
      sandbox: 'workspace-write'
    });
    const schedule = await authPost('/schedules', {
      name: '每日审查',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: '检查项目',
      cwd: tempDir,
      profile: 'review'
    });

    expect(thread.statusCode).toBe(201);
    expect(schedule.statusCode).toBe(201);

    const deleted = await authDelete('/codex/profiles/review');

    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toEqual({
      error: {
        code: 'CODEX_PROFILE_IN_USE',
        message: 'Profile is still referenced',
        details: {
          threads: expect.arrayContaining([
            {
              id: thread.json().thread.id,
              title: '审查会话'
            },
            {
              id: schedule.json().threadId,
              title: '每日审查'
            }
          ]),
          schedules: [
            {
              id: schedule.json().id,
              name: '每日审查'
            }
          ]
        }
      }
    });
    expect(deleted.json().error.details.threads).toHaveLength(2);
    expect((await authGet('/codex/profiles/review')).statusCode).toBe(200);
  });

  it('lists, installs, overwrites, deletes, and logs codex skills', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const source = join(tempDir, 'source-skill');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      'name: writer',
      'description: "first"',
      '---',
      ''
    ].join('\n'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const empty = await authGet('/codex/skills');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      skillsPath: join(codexHome, 'skills'),
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: []
    });

    const installed = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer'
    });
    expect(installed.statusCode).toBe(201);
    expect(installed.json().skill).toMatchObject({
      id: 'writer',
      name: 'writer',
      description: 'first',
      status: 'valid'
    });

    const duplicate = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer'
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CODEX_SKILL_EXISTS');

    writeFileSync(join(source, 'SKILL.md'), [
      '---',
      'name: writer',
      'description: "second"',
      '---',
      ''
    ].join('\n'));
    const overwritten = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer',
      overwrite: true
    });
    expect(overwritten.statusCode).toBe(201);
    expect(overwritten.json().operation.operation).toBe('overwrite');
    expect(overwritten.json().operation.backupPath).toEqual(expect.stringContaining('backups'));

    const listed = await authGet('/codex/skills');
    expect(listed.json().skills).toEqual([
      expect.objectContaining({ id: 'writer', description: 'second', status: 'valid' })
    ]);

    const deleted = await authDelete('/codex/skills/writer');
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ deleted: true });
    expect(deleted.json().backupPath).toEqual(expect.stringContaining('backups'));

    const operations = await authGet('/codex/skills/operations');
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations.map((operation: { operation: string }) => operation.operation)).toEqual([
      'delete',
      'overwrite',
      'install'
    ]);
  });

  it('scans global codex skills non-destructively and requires write confirmation', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const response = await authGet('/codex/skills');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      codexHomeMode: 'global',
      skillsWritable: true,
      requiresWriteConfirmation: true
    });
    expect(response.json().skillsPath).toEqual(expect.any(String));
    expect(Array.isArray(response.json().skills)).toBe(true);
  });

  it('returns invalid skill diagnostics instead of crashing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const invalidDir = join(codexHome, 'skills', 'broken');
    mkdirSync(invalidDir, { recursive: true });
    writeFileSync(join(invalidDir, 'SKILL.md'), '# no frontmatter');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const response = await authGet('/codex/skills');

    expect(response.statusCode).toBe(200);
    expect(response.json().skills).toEqual([
      expect.objectContaining({
        id: 'broken',
        status: 'invalid',
        diagnostics: [expect.stringContaining('frontmatter')]
      })
    ]);
  });

  it('requires explicit confirmation for global codex skill writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const source = join(tempDir, 'source-skill');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), '---\nname: writer\ndescription: writer\n---\n');
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const install = await authPost('/codex/skills/install', {
      sourcePath: source,
      id: 'writer'
    });

    expect(install.statusCode).toBe(409);
    expect(install.json().error.code).toBe('CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED');
  });

  it('maps invalid codex skill API requests to validation failures', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const stringBody = await server.inject({
      method: 'POST',
      url: '/codex/skills/install',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      payload: JSON.stringify('not-an-object')
    });
    expect(stringBody.statusCode).toBe(400);
    expect(stringBody.json().error.code).toBe('VALIDATION_FAILED');

    const invalidBodies: Array<{ label: string; payload: unknown }> = [
      { label: 'array body', payload: [] },
      { label: 'missing sourcePath', payload: { id: 'writer' } },
      { label: 'blank sourcePath', payload: { sourcePath: '   ' } },
      { label: 'invalid id', payload: { sourcePath: tempDir, id: '../writer' } },
      { label: 'non-boolean overwrite', payload: { sourcePath: tempDir, overwrite: 'yes' } },
      {
        label: 'false confirmation',
        payload: { sourcePath: tempDir, confirmWriteToCodexHome: false }
      }
    ];

    for (const { label, payload } of invalidBodies) {
      const response = await authPost('/codex/skills/install', payload);
      expect(response.statusCode, label).toBe(400);
      expect(response.json().error.code, label).toBe('VALIDATION_FAILED');
    }

    const invalidGet = await authGet('/codex/skills/bad%20id');
    const invalidDelete = await authDelete('/codex/skills/bad%20id');

    expect(invalidGet.statusCode).toBe(400);
    expect(invalidGet.json().error.code).toBe('VALIDATION_FAILED');
    expect(invalidDelete.statusCode).toBe(400);
    expect(invalidDelete.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('maps missing and invalid codex skill writes to skill API errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const invalidSource = join(tempDir, 'invalid-source');
    const missingSource = join(tempDir, 'does-not-exist');
    mkdirSync(invalidSource, { recursive: true });
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome });

    const missingDelete = await authDelete('/codex/skills/missing');
    const invalidSourcePathInstall = await authPost('/codex/skills/install', {
      sourcePath: missingSource,
      id: 'missing-source'
    });
    const invalidInstall = await authPost('/codex/skills/install', {
      sourcePath: invalidSource,
      id: 'broken'
    });

    expect(missingDelete.statusCode).toBe(404);
    expect(missingDelete.json().error.code).toBe('CODEX_SKILL_NOT_FOUND');
    expect(invalidSourcePathInstall.statusCode).toBe(422);
    expect(invalidSourcePathInstall.json().error.code).toBe('CODEX_SKILL_INVALID');
    expect(invalidInstall.statusCode).toBe(422);
    expect(invalidInstall.json().error.code).toBe('CODEX_SKILL_INVALID');
  });

  it('installs, updates, and lists codex skill market records', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const downloader = createFakeMarketArchiveDownloader();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome,
      marketArchiveDownloader: downloader
    });

    const installed = await authPost('/codex/skill-market/frontend-slides/install', {});
    expect(installed.statusCode).toBe(201);
    expect(installed.json().skill).toMatchObject({
      id: 'frontend-slides',
      description: 'market version 1'
    });
    expect(installed.json().record).toMatchObject({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1
    });

    const updated = await authPost('/codex/skill-market/frontend-slides/update', {});
    expect(updated.statusCode).toBe(200);
    expect(updated.json().skill).toMatchObject({
      id: 'frontend-slides',
      description: 'market version 2'
    });
    expect(updated.json().operation.operation).toBe('overwrite');

    const records = await authGet('/codex/skill-market/install-records');
    expect(records.statusCode).toBe(200);
    expect(records.json().records).toEqual([
      expect.objectContaining({
        skillId: 'frontend-slides',
        repository: 'zarazhangrui/frontend-slides',
        marketRevision: 1
      })
    ]);
  });

  it('maps codex skill market API errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const downloader = createFakeMarketArchiveDownloader();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome,
      marketArchiveDownloader: downloader
    });

    const unknown = await authPost('/codex/skill-market/missing-market-skill/install', {
      repository: 'attacker/repo',
      commit: 'bad',
      path: '../../bad'
    });
    const notInstallable = await authPost('/codex/skill-market/garrytan-gstack/install', {});
    const missingUpdate = await authPost('/codex/skill-market/frontend-slides/update', {});

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('CODEX_SKILL_MARKET_ENTRY_NOT_FOUND');
    expect(notInstallable.statusCode).toBe(422);
    expect(notInstallable.json().error.code).toBe('CODEX_SKILL_MARKET_NOT_INSTALLABLE');
    expect(missingUpdate.statusCode).toBe(404);
    expect(missingUpdate.json().error.code).toBe('CODEX_SKILL_NOT_FOUND');
  });

  it('maps codex skill market download failures to bad gateway', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      marketArchiveDownloader: {
        async download() {
          throw new Error('CODEX_SKILL_MARKET_DOWNLOAD_FAILED: archive unavailable');
        }
      }
    });

    const response = await authPost('/codex/skill-market/frontend-slides/install', {});

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('CODEX_SKILL_MARKET_DOWNLOAD_FAILED');
  });

  it('confirms global CODEX_HOME writes for codex skill market installs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = join(tempDir, 'fake-global-codex-home');
    try {
      server = await buildServer({
        token: 'secret',
        dataDir: tempDir,
        marketArchiveDownloader: createFakeMarketArchiveDownloader()
      });

      const response = await authPost('/codex/skill-market/frontend-slides/install', {});

      expect(response.statusCode).toBe(201);
      expect(response.json().skill).toMatchObject({ id: 'frontend-slides' });
      expect(response.json().operation.codexHome).toBe(process.env.CODEX_HOME);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  it('lists, adds, gets, removes, and logs codex mcp servers', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      capabilities: makeResumeCapableMatrix()
    });

    const empty = await authGet('/codex/mcp');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      requiresWriteConfirmation: false,
      servers: []
    });

    const added = await authPost('/codex/mcp/add', {
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' }
    });
    expect(added.statusCode).toBe(201);
    expect(JSON.stringify(added.json())).not.toContain('secret');
    expect(added.json().server).toMatchObject({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      envKeys: ['GITHUB_TOKEN'],
      hasSecrets: true
    });

    const serverResponse = await authGet('/codex/mcp/github');
    expect(serverResponse.statusCode).toBe(200);
    expect(serverResponse.json().server).toMatchObject({
      name: 'github',
      transport: 'stdio',
      envKeys: ['GITHUB_TOKEN']
    });

    const removed = await authDelete('/codex/mcp/github');
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: true });

    const operations = await authGet('/codex/mcp/operations');
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations.map((operation: { operation: string }) => operation.operation)).toEqual([
      'remove',
      'get',
      'get',
      'add',
      'list'
    ]);
    expect(JSON.stringify(operations.json())).not.toContain('secret');
    expect(fake.readCommands()).toContain('mcp add github --env GITHUB_TOKEN=secret -- node server.js');
  });

  it('requires explicit confirmation for global codex mcp writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      capabilities: makeResumeCapableMatrix()
    });

    const added = await authPost('/codex/mcp/add', {
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js']
    });

    expect(added.statusCode).toBe(409);
    expect(added.json().error.code).toBe('MCP_WRITE_CONFIRMATION_REQUIRED');
  });

  it('maps invalid and missing mcp API requests', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      capabilities: makeResumeCapableMatrix()
    });

    const invalidAdd = await authPost('/codex/mcp/add', {
      name: '../github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js']
    });
    const missing = await authGet('/codex/mcp/missing');

    expect(invalidAdd.statusCode).toBe(400);
    expect(invalidAdd.json().error.code).toBe('VALIDATION_FAILED');
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('MCP_SERVER_NOT_FOUND');
  });

  it('accepts body confirmation for global codex mcp login and logout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      capabilities: makeResumeCapableMatrix()
    });

    const login = await authPost('/codex/mcp/github/login', {
      confirmWriteToCodexHome: true
    });
    const logout = await authPost('/codex/mcp/github/logout', {
      confirmWriteToCodexHome: true
    });

    expect(login.statusCode).toBe(200);
    expect(logout.statusCode).toBe(200);
    expect(fake.readCommands()).toEqual(['mcp login github', 'mcp logout github']);

    const operations = await authGet('/codex/mcp/operations');
    expect(operations.statusCode).toBe(200);
    expect(operations.json().operations.map((operation: { operation: string }) => operation.operation)).toEqual([
      'logout',
      'login'
    ]);
  });

  it('maps unsupported mcp add capabilities to safe API errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      capabilities: makeResumeCapableMatrix({ mcpAddEnv: false })
    });

    const response = await authPost('/codex/mcp/add', {
      name: 'github',
      transport: 'stdio',
      command: 'node',
      env: { GITHUB_TOKEN: 'secret' }
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: {
        code: 'CODEX_INCOMPATIBLE',
        message: 'Codex does not support this MCP operation'
      }
    });
    expect(JSON.stringify(response.json())).not.toContain('GITHUB_TOKEN');
    expect(JSON.stringify(response.json())).not.toContain('secret');
    expect(fake.readCommands()).toEqual([]);
  });

  it('maps unsupported mcp add URL transport to safe API errors without running codex', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      capabilities: makeResumeCapableMatrix({ mcpAddUrl: false })
    });

    const response = await authPost('/codex/mcp/add', {
      name: 'github-http',
      transport: 'http',
      url: 'https://example.com/mcp'
    });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: {
        code: 'CODEX_INCOMPATIBLE',
        message: 'Codex does not support this MCP operation'
      }
    });
    expect(fake.readCommands()).toEqual([]);
  });

  it('maps failed codex mcp add commands to MCP_COMMAND_FAILED', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      capabilities: makeResumeCapableMatrix()
    });

    const response = await authPost('/codex/mcp/add', {
      name: 'broken',
      transport: 'stdio',
      command: 'node',
      args: ['server.js']
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: {
        code: 'MCP_COMMAND_FAILED',
        message: 'Codex MCP command failed'
      }
    });
    expect(fake.readCommands()).toEqual(['mcp add broken -- node server.js']);
  });

  it('redacts raw codex mcp get output from add responses and operations', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeMcpCodex(tempDir);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      capabilities: makeResumeCapableMatrix()
    });

    const added = await authPost('/codex/mcp/add', {
      name: 'secret-server',
      transport: 'stdio',
      command: 'node',
      env: { MCP_API_TOKEN: 'super-secret-value' }
    });
    const operations = await authGet('/codex/mcp/operations');
    const addedBody = added.json();
    const operationsBody = operations.json();

    expect(added.statusCode).toBe(201);
    expect(addedBody.server).toMatchObject({
      name: 'secret-server',
      transport: 'unknown',
      diagnostics: ['codex mcp get output was not fully recognized'],
      raw: 'secret-server configured with MCP_API_TOKEN=[REDACTED]\n'
    });
    expect(addedBody.server.raw).not.toContain('super-secret-value');
    expect(operations.statusCode).toBe(200);
    expect(operationsBody.operations).toEqual([
      expect.objectContaining({
        operation: 'get',
        serverName: 'secret-server',
        command: ['mcp', 'get', 'secret-server']
      }),
      expect.objectContaining({
        operation: 'add',
        serverName: 'secret-server',
        command: expect.arrayContaining(['MCP_API_TOKEN=[REDACTED]'])
      })
    ]);
    expect(JSON.stringify(operationsBody)).not.toContain('super-secret-value');
    expect(fake.readCommands()).toEqual([
      'mcp add secret-server --env MCP_API_TOKEN=super-secret-value -- node',
      'mcp get secret-server'
    ]);
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
      {
        label: 'mixed array config',
        payload: { name: 'review', config: { experimental_features: ['writer', 3, false] } }
      },
      {
        label: 'mixed integer and float array config',
        payload: { name: 'review', config: { nums: [1, 2.5] } }
      },
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
      {
        label: 'mixed array config',
        payload: { config: { experimental_features: ['writer', 3, false] } }
      },
      {
        label: 'mixed integer and float array config',
        payload: { config: { nums: [1, 2.5] } }
      },
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

  it('rejects explicit missing profiles for new runs and threads', async () => {
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

    const run = await authPost('/runs', {
      prompt: 'hello',
      cwd: tempDir,
      profile: 'missing-profile'
    });
    expect(run.statusCode).toBe(404);
    expect(run.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');

    const thread = await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'missing-profile',
      sandbox: 'read-only'
    });
    expect(thread.statusCode).toBe(404);
    expect(thread.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
  });

  it('allows runs and threads with profiles created in isolated codex home', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const createdProfile = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });
    expect(createdProfile.statusCode).toBe(201);

    const thread = await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'review',
      sandbox: 'read-only'
    });
    expect(thread.statusCode).toBe(201);
    expect(thread.json().thread.profile).toBe('review');

    const run = await authPost('/runs', {
      prompt: 'hello',
      cwd: tempDir,
      profile: 'review'
    });
    expect(run.statusCode).toBe(202);

    await waitForRunStatus(run.json().id, 'succeeded');
    expect(fake.readArgv()).toEqual(expect.arrayContaining(['-p', 'review']));
  });

  it('does not require default profile to exist', async () => {
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

    const run = await authPost('/runs', {
      prompt: 'hello',
      cwd: tempDir
    });
    expect(run.statusCode).toBe(202);

    await waitForRunStatus(run.json().id, 'succeeded');
  });

  it('rejects explicit profiles when base config.toml is invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'config.toml'), 'model = "broken');
    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "gpt-5.3-codex"\n');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.completed' }]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome
    });

    const response = await authPost('/runs', {
      prompt: 'hello',
      cwd: tempDir,
      profile: 'review'
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CODEX_CONFIG_INVALID');
  });

  it('rejects explicit profiles when profile overlay is invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "broken');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.completed' }]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome
    });

    const response = await authPost('/runs', {
      prompt: 'hello',
      cwd: tempDir,
      profile: 'review'
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('CODEX_PROFILE_INVALID');
  });

  it('rejects thread runs when the stored profile is externally deleted before run start', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome
    });

    const createdProfile = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });
    expect(createdProfile.statusCode).toBe(201);

    const thread = await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'review',
      sandbox: 'read-only'
    });
    expect(thread.statusCode).toBe(201);

    rmSync(join(codexHome, 'review.config.toml'));

    const run = await authPost('/runs', {
      threadId: thread.json().thread.id,
      prompt: 'hello'
    });
    if (run.statusCode === 202) await waitForRunStatus(run.json().id, 'succeeded');

    expect(run.statusCode).toBe(404);
    expect(run.json().error.code).toBe('CODEX_PROFILE_NOT_FOUND');
    expect(existsSync(join(tempDir, 'argv.json'))).toBe(false);
  });

  it('fails queued thread runs when the stored profile is externally deleted before dequeue', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ],
      lineDelayMs: 100
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      resumeCapabilityVerified: true
    });

    const createdProfile = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });
    expect(createdProfile.statusCode).toBe(201);

    const thread = await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'review',
      sandbox: 'read-only'
    });
    expect(thread.statusCode).toBe(201);

    const first = await authPost('/runs', {
      threadId: thread.json().thread.id,
      prompt: 'first'
    });
    expect(first.statusCode).toBe(202);

    const second = await authPost('/runs', {
      threadId: thread.json().thread.id,
      prompt: 'second'
    });
    expect(second.statusCode).toBe(202);
    expect(second.json().status).toBe('queued');

    rmSync(join(codexHome, 'review.config.toml'));

    await waitForRunStatus(first.json().id, 'succeeded');
    await waitForRunStatus(second.json().id, 'failed');

    const failed = await authGet(`/runs/${second.json().id}`);
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      status: 'failed',
      terminationReason: 'stream_error',
      errorCode: 'CODEX_PROFILE_NOT_FOUND'
    });
    const events = await authGet(`/runs/${second.json().id}/events`);
    expect(events.body).toContain('CODEX_PROFILE_NOT_FOUND');
    expect(fake.readPrompt()).toBe('first');
  });

  it('rejects thread runs when the stored profile overlay becomes invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome
    });

    const createdProfile = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });
    expect(createdProfile.statusCode).toBe(201);

    const thread = await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'review',
      sandbox: 'read-only'
    });
    expect(thread.statusCode).toBe(201);

    writeFileSync(join(codexHome, 'review.config.toml'), 'model = "broken');

    const run = await authPost('/runs', {
      threadId: thread.json().thread.id,
      prompt: 'hello'
    });
    if (run.statusCode === 202) await waitForRunStatus(run.json().id, 'succeeded');

    expect(run.statusCode).toBe(422);
    expect(run.json().error.code).toBe('CODEX_PROFILE_INVALID');
    expect(existsSync(join(tempDir, 'argv.json'))).toBe(false);
  });

  it('rejects thread runs when base config.toml becomes invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.completed' }
      ]
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome
    });

    const createdProfile = await authPost('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex' }
    });
    expect(createdProfile.statusCode).toBe(201);

    const thread = await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'review',
      sandbox: 'read-only'
    });
    expect(thread.statusCode).toBe(201);

    writeFileSync(join(codexHome, 'config.toml'), 'model = "broken');

    const run = await authPost('/runs', {
      threadId: thread.json().thread.id,
      prompt: 'hello'
    });
    if (run.statusCode === 202) await waitForRunStatus(run.json().id, 'succeeded');

    expect(run.statusCode).toBe(422);
    expect(run.json().error.code).toBe('CODEX_CONFIG_INVALID');
    expect(existsSync(join(tempDir, 'argv.json'))).toBe(false);
  });

  it('creates, lists, gets, and archives threads through the api', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });

    const created = await server.inject({
      method: 'POST',
      url: '/threads?limit=100',
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
    expect(listed.json().threads).toContainEqual(expect.objectContaining({ id: thread.id }));

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

  it('updates an active thread sandbox explicitly', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });
    const thread = (await authPost('/threads', {
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    })).json().thread;

    const updated = await authPatch(`/threads/${thread.id}`, {
      sandbox: 'danger-full-access'
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json().thread.sandbox).toBe('danger-full-access');

    const detail = await authGet(`/threads/${thread.id}`);
    expect(detail.json().thread.sandbox).toBe('danger-full-access');
  });

  it('creates schedule drafts but rejects direct public schedule task creation', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    server = await buildServer({ token: 'secret', dataDir: tempDir });

    const draft = await authPost('/threads', {
      title: 'Create schedule',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_draft'
    });
    const task = await authPost('/threads', {
      title: 'Bypass coordinator',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_task'
    });

    expect(draft.statusCode).toBe(201);
    expect(draft.json().thread.purpose).toBe('schedule_draft');
    expect(task.statusCode).toBe(400);
    expect(task.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('returns schedule bindings and blocks public mutation of schedule task threads', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createThreadManager({ db, dataDir: tempDir });
    const task = manager.createThread({
      title: 'Daily report',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_task'
    });
    db.prepare(`
      INSERT INTO schedules (
        id, thread_id, name, cron, timezone, prompt, prompt_hash, prompt_preview_redacted,
        profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sch_one',
      task.id,
      'Daily report',
      '0 9 * * *',
      'Asia/Shanghai',
      'Summarize project status',
      'hash',
      'Summarize project status',
      'default',
      tempDir,
      tempDir,
      'workspace-write',
      'queue',
      'skip'
    );
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      db
    });

    const detail = await authGet(`/threads/${task.id}`);
    const listed = await authGet('/threads');
    const updated = await authPatch(`/threads/${task.id}`, {
      sandbox: 'danger-full-access'
    });
    const archived = await authPost(`/threads/${task.id}/archive`, {});

    expect(detail.json().thread).toMatchObject({
      id: task.id,
      purpose: 'schedule_task',
      scheduleId: 'sch_one'
    });
    expect(listed.json().threads).toContainEqual(expect.objectContaining({
      id: task.id,
      scheduleId: 'sch_one'
    }));
    expect(updated.statusCode).toBe(409);
    expect(updated.json().error.code).toBe('THREAD_MANAGED_BY_SCHEDULE');
    expect(archived.statusCode).toBe(409);
    expect(archived.json().error.code).toBe('THREAD_MANAGED_BY_SCHEDULE');
  });

  it('imports global Codex sessions into the thread list', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '07');
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, 'rollout-2026-07-07T10-00-00-codex-session-api.jsonl');
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({
          timestamp: '2026-07-07T02:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'codex-session-api',
            session_id: 'codex-session-api',
            timestamp: '2026-07-07T02:00:00.000Z',
            cwd: tempDir
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '复盘今天的销售进展' }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '已复盘。' }
        })
      ].join('\n')
    );
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome, db });

    const listed = await authGet('/threads');
    const listedAgain = await authGet('/threads');

    expect(listed.statusCode).toBe(200);
    expect(listed.json().threads).toEqual([
      expect.objectContaining({
        title: '复盘今天的销售进展',
        codexThreadId: 'codex-session-api',
        cwd: tempDir,
        workspaceMode: 'external',
        status: 'active'
      })
    ]);
    expect(listedAgain.json().threads).toHaveLength(1);
    expect(
      db.prepare(
        'SELECT parsed_offset, parsed_line_count, last_error FROM codex_session_sources WHERE path = ?'
      ).get(sessionPath)
    ).toEqual({
      parsed_offset: statSync(sessionPath).size,
      parsed_line_count: 3,
      last_error: null
    });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM codex_session_items WHERE source_path = ?')
        .get(sessionPath)
    ).toEqual({ count: 2 });
  });

  it('hides subagent Codex sessions and keeps older user sessions visible within the list limit', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '09');
    mkdirSync(sessionDir, { recursive: true });
    const userPath = writeCodexSession(sessionDir, 'user-playground-session', {
      timestamp: '2026-07-09T01:00:00.000Z',
      cwd: join(tempDir, 'playground'),
      userMessage: 'Playground 正常会话'
    });
    const subagentPath = writeCodexSession(sessionDir, 'subagent-review-session', {
      timestamp: '2026-07-09T02:00:00.000Z',
      cwd: join(tempDir, 'playground'),
      userMessage: '你是 Task 1 的任务审查子代理',
      meta: {
        parent_thread_id: 'parent-thread',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } }
      }
    });
    utimesSync(userPath, new Date('2026-07-09T01:00:00.000Z'), new Date('2026-07-09T01:00:00.000Z'));
    utimesSync(subagentPath, new Date('2026-07-09T02:00:00.000Z'), new Date('2026-07-09T02:00:00.000Z'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    createThreadRepository(db).insertThread({
      id: 'thread_codex_subagentreviewsession',
      title: '旧的子 Agent 脏数据',
      codexThreadId: 'subagent-review-session',
      cwd: join(tempDir, 'playground'),
      canonicalCwd: join(tempDir, 'playground'),
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      createdAt: '2026-07-09 02:00:00',
      updatedAt: '2026-07-09 02:00:00'
    });
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome, db });

    const listed = await authGet('/threads?limit=1');
    const all = await authGet('/threads?status=all&limit=10');

    expect(listed.statusCode).toBe(200);
    expect(listed.json().threads).toEqual([
      expect.objectContaining({
        title: 'Playground 正常会话',
        codexThreadId: 'user-playground-session'
      })
    ]);
    expect(JSON.stringify(listed.json())).not.toContain('subagent-review-session');
    expect(all.json().threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codexThreadId: 'subagent-review-session',
          status: 'archived'
        })
      ])
    );
  });

  it('hides scheduled Codex sessions and archives previously imported scheduled threads', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const cwd = join(tempDir, 'playground');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '14');
    mkdirSync(sessionDir, { recursive: true });
    writeCodexSession(sessionDir, 'scheduled-reminder-session', {
      timestamp: '2026-07-14T01:00:00.000Z',
      cwd,
      userMessage: '提醒我起来活动'
    });
    writeCodexSession(sessionDir, 'normal-user-session', {
      timestamp: '2026-07-14T00:55:00.000Z',
      cwd,
      userMessage: '整理今天的工作记录'
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    createRunRepository(db).insertRun({
      id: 'run_scheduled_reminder',
      codexThreadId: 'scheduled-reminder-session',
      publicStatus: 'succeeded',
      internalStatus: 'succeeded',
      createdBy: 'schedule',
      sourceId: 'sch_reminder',
      profile: 'default',
      cwd,
      canonicalCwd: cwd,
      workspaceMode: 'external',
      sandbox: 'read-only',
      codexVersion: 'test',
      codexBin: 'codex',
      codexHome,
      normalizerVersion: 1
    });
    createThreadRepository(db).insertThread({
      id: 'thread_codex_scheduledremindersession',
      title: '提醒我起来活动',
      codexThreadId: 'scheduled-reminder-session',
      cwd,
      canonicalCwd: cwd,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active'
    });
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome, db });

    const listed = await authGet('/threads?status=active&limit=1');
    const all = await authGet('/threads?status=all&limit=10');

    expect(listed.statusCode).toBe(200);
    expect(listed.json().threads).toEqual([
      expect.objectContaining({
        codexThreadId: 'normal-user-session',
        title: '整理今天的工作记录'
      })
    ]);
    expect(all.json().threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          codexThreadId: 'scheduled-reminder-session',
          status: 'archived'
        })
      ])
    );
    expect(
      db.prepare('SELECT kind FROM codex_sessions WHERE codex_thread_id = ?')
        .get('scheduled-reminder-session')
    ).toEqual({ kind: 'schedule' });
  });

  it('returns Codex session chat history for imported runtime threads', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '07');
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(
      sessionDir,
      'rollout-2026-07-07T10-00-00-codex-session-history.jsonl'
    );
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({
          timestamp: '2026-07-07T02:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'codex-session-history',
            session_id: 'codex-session-history',
            timestamp: '2026-07-07T02:00:00.000Z',
            cwd: tempDir
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '# AGENTS.md instructions\n\n忽略这段注入上下文' }]
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '分析这个 skill 是干什么的' }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: '先读取 skill 说明。' }]
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:04.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '这个 skill 用于分析选品资料。' }
        })
      ].join('\n')
    );
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome, db });

    const listed = await authGet('/threads');
    const thread = listed.json().threads[0];
    appendFileSync(
      sessionPath,
      `\n${JSON.stringify({
        timestamp: '2026-07-07T02:00:05.000Z',
        type: 'event_msg',
        payload: { type: 'agent_message', message: '这是追加索引的回复。' }
      })}\n`
    );
    const history = await authGet(`/threads/${thread.id}/history`);

    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      threadId: thread.id,
      codexThreadId: 'codex-session-history',
      items: [
        { type: 'user_message', text: '分析这个 skill 是干什么的' },
        { type: 'reasoning_summary', text: '先读取 skill 说明。' },
        { type: 'assistant_message', text: '这个 skill 用于分析选品资料。' },
        { type: 'assistant_message', text: '这是追加索引的回复。' }
      ]
    });
    expect(history.body).not.toContain('AGENTS.md instructions');
    expect(
      db.prepare(
        'SELECT parsed_offset, parsed_line_count, last_error FROM codex_session_sources WHERE path = ?'
      ).get(sessionPath)
    ).toEqual({
      parsed_offset: statSync(sessionPath).size,
      parsed_line_count: 6,
      last_error: null
    });
  });

  it('supports stable thread history pagination and cursor errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-history-pagination-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '12');
    mkdirSync(sessionDir, { recursive: true });
    writeHistorySession(sessionDir, 'pagination-a', tempDir, [
      '第一条',
      '第二条',
      '第三条',
      '第四条',
      '第五条'
    ]);
    writeHistorySession(sessionDir, 'pagination-b', tempDir, [
      '另一个会话第一条',
      '另一个会话第二条'
    ]);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({ token: 'secret', dataDir: tempDir, codexHome, db });

    const listed = await authGet('/threads?status=all&limit=10');
    const threads = listed.json().threads as Array<{ id: string; codexThreadId: string }>;
    const threadA = threads.find(thread => thread.codexThreadId === 'pagination-a')!;
    const threadB = threads.find(thread => thread.codexThreadId === 'pagination-b')!;

    const legacy = await authGet(`/threads/${threadA.id}/history`);
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().items.map((item: { text: string }) => item.text)).toEqual([
      '第一条',
      '第二条',
      '第三条',
      '第四条',
      '第五条'
    ]);
    expect(legacy.json()).not.toHaveProperty('hasMore');
    expect(legacy.json()).not.toHaveProperty('nextCursor');

    const latest = await authGet(`/threads/${threadA.id}/history?limit=2`);
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({
      hasMore: true,
      oldestItemAt: '2026-07-12T07:00:04.000Z'
    });
    expect(latest.json().items.map((item: { text: string }) => item.text)).toEqual([
      '第四条',
      '第五条'
    ]);
    const cursor = latest.json().nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    expect(cursor).not.toContain(tempDir);

    const previous = await authGet(
      `/threads/${threadA.id}/history?limit=2&before=${encodeURIComponent(cursor)}`
    );
    expect(previous.statusCode).toBe(200);
    expect(previous.json().items.map((item: { text: string }) => item.text)).toEqual([
      '第二条',
      '第三条'
    ]);

    const invalid = await authGet(`/threads/${threadA.id}/history?limit=2&before=not-a-cursor`);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('THREAD_HISTORY_CURSOR_INVALID');

    const mismatch = await authGet(
      `/threads/${threadB.id}/history?limit=2&before=${encodeURIComponent(cursor)}`
    );
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('THREAD_HISTORY_CURSOR_MISMATCH');

    const anchorId = latest.json().items[0].id as string;
    db.prepare('DELETE FROM codex_session_items WHERE item_id = ?').run(anchorId);
    const expired = await authGet(
      `/threads/${threadA.id}/history?limit=2&before=${encodeURIComponent(cursor)}`
    );
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error.code).toBe('THREAD_HISTORY_CURSOR_EXPIRED');

    for (const url of [
      `/threads/${threadA.id}/history?limit=0`,
      `/threads/${threadA.id}/history?limit=101`
    ]) {
      const response = await authGet(url);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
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

  it('accepts queued and interrupting follow-up modes and exposes queue positions', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-run-queue-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-queue' },
        { type: 'turn.started' }
      ],
      hang: true
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });
    const thread = await createThreadViaApi();

    const active = (await authPost('/runs', {
      threadId: thread.id,
      prompt: 'active'
    })).json();
    await waitForRunStatus(active.id, 'running');

    const regularResponse = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'regular',
      submissionMode: 'enqueue'
    });
    expect(regularResponse.statusCode).toBe(202);
    expect(regularResponse.json()).toMatchObject({
      status: 'queued',
      submissionMode: 'enqueue',
      queuePosition: 1
    });

    const interruptingResponse = await authPost('/runs', {
      threadId: thread.id,
      prompt: 'interrupting',
      submissionMode: 'interrupt_and_enqueue'
    });
    expect(interruptingResponse.statusCode).toBe(202);
    expect(interruptingResponse.json()).toMatchObject({
      status: 'queued',
      submissionMode: 'interrupt_and_enqueue',
      queuePosition: 1
    });

    const runsResponse = await server.inject({
      method: 'GET',
      url: `/threads/${thread.id}/runs?limit=50`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(runsResponse.statusCode).toBe(200);
    expect(runsResponse.json().runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: regularResponse.json().id,
        submissionMode: 'enqueue',
        queuePosition: 2
      }),
      expect.objectContaining({
        id: interruptingResponse.json().id,
        submissionMode: 'interrupt_and_enqueue',
        queuePosition: 1
      })
    ]));

    await authPost(`/runs/${regularResponse.json().id}/cancel`, {});
    await authPost(`/runs/${interruptingResponse.json().id}/cancel`, {});
    await waitForRunStatus(active.id, 'canceled');
  });

  it('rejects invalid follow-up modes and interrupting runs without a thread', async () => {
    server = await buildServer({ token: 'secret' });

    const invalid = await authPost('/runs', {
      prompt: 'invalid',
      submissionMode: 'later'
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');

    const missingThread = await authPost('/runs', {
      prompt: 'interrupt',
      submissionMode: 'interrupt_and_enqueue'
    });
    expect(missingThread.statusCode).toBe(400);
    expect(missingThread.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('includes web app CORS headers on SSE event responses', async () => {
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

    const created = await authPost('/runs', {
      prompt: 'hello',
      cwd: tempDir,
      sandbox: 'read-only'
    });
    expect(created.statusCode).toBe(202);
    const run = created.json() as { id: string };

    await waitForRunStatus(run.id, 'succeeded');

    const events = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events`,
      headers: {
        authorization: 'Bearer secret',
        origin: 'http://127.0.0.1:5173'
      }
    });

    expect(events.statusCode).toBe(200);
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.headers.vary).toBe('Origin');
    expect(events.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
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
    expect(history.json().runs).toEqual([
      expect.objectContaining({ lastEventSeq: expect.any(Number) }),
      expect.objectContaining({ lastEventSeq: expect.any(Number) })
    ]);
    expect(history.json().runs.every((run: { lastEventSeq: number }) => run.lastEventSeq > 0))
      .toBe(true);
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

    const fromStart = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events?fromSeq=0`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(fromStart.statusCode).toBe(200);
    expect(fromStart.body).toContain('"seq":1');
    expect(fromStart.body).toContain('event: done');

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

    const queryTakesPriority = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events?fromSeq=2`,
      headers: {
        authorization: 'Bearer secret',
        'last-event-id': '0'
      }
    });
    expect(queryTakesPriority.statusCode).toBe(200);
    expect(queryTakesPriority.body).not.toContain('"seq":1');
    expect(queryTakesPriority.body).not.toContain('"seq":2');
    expect(queryTakesPriority.body).toContain('"seq":3');

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

    const events = parseSseData(fromStart.body);
    const lastSeq = events.at(-1)?.seq;
    expect(lastSeq).toBeDefined();

    const afterLast = await server.inject({
      method: 'GET',
      url: `/runs/${run.id}/events?fromSeq=${lastSeq}`,
      headers: { authorization: 'Bearer secret' }
    });
    expect(afterLast.statusCode).toBe(200);
    expect(afterLast.body).toBe('');
  });

  it.each(['-1', '1.5', 'NaN', 'invalid', ''])(
    'rejects invalid fromSeq value %j',
    async fromSeq => {
      tempDir = mkdtempSync(join(tmpdir(), 'clawee-api-'));
      db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
      server = await buildServer({ token: 'secret', dataDir: tempDir, db });
      db.prepare(`
        INSERT INTO runs (
          id, public_status, internal_status, created_by, profile, cwd, canonical_cwd,
          workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
        ) VALUES (
          'run_invalid_from_seq', 'succeeded', 'succeeded', 'api', 'default', @cwd, @cwd,
          'managed', 'read-only', 'unknown', 'codex', @codexHome, 1
        )
      `).run({
        cwd: tempDir,
        codexHome: join(tempDir, 'codex-home')
      });

      const response = await server.inject({
        method: 'GET',
        url: `/runs/run_invalid_from_seq/events?fromSeq=${encodeURIComponent(fromSeq)}`,
        headers: {
          authorization: 'Bearer secret',
          'last-event-id': '0'
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  );

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

function makeResumeCapableMatrix(overrides: Partial<RuntimeCapabilityMatrix> = {}): RuntimeCapabilityMatrix {
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
    execImages: true,
    resumeImages: true,
    resumeContextContinuityVerified: false,
    mcpList: true,
    mcpGet: true,
    mcpAdd: true,
    mcpRemove: true,
    mcpLogin: true,
    mcpLogout: true,
    mcpAddEnv: true,
    mcpAddUrl: true,
    mcpAddBearerTokenEnvVar: true,
    mcpAddOAuth: true,
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false,
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false,
    warnings: [],
    ...overrides
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

function authUpload(url: string, payload: Buffer) {
  return server!.inject({
    method: 'POST',
    url,
    headers: {
      authorization: 'Bearer secret',
      'content-type': 'application/octet-stream'
    },
    payload
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

function insertApiRun(
  id: string,
  overrides: Partial<{ publicStatus: string; internalStatus: string; workspaceMode: string }> = {}
): void {
  createRunRepository(db!).insertRun({
    id,
    publicStatus: overrides.publicStatus ?? 'succeeded',
    internalStatus: overrides.internalStatus ?? 'succeeded',
    createdBy: 'api',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: overrides.workspaceMode ?? 'managed',
    sandbox: 'read-only',
    codexVersion: 'unknown',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1
  });
}

function insertApiThread(
  id: string,
  overrides: Partial<{ status: 'active' | 'archived'; workspaceMode: string }> = {}
): void {
  const cwd = overrides.workspaceMode === 'external' ? tempDir : join(tempDir, 'workspaces', id);
  createThreadRepository(db!).insertThread({
    id,
    cwd,
    canonicalCwd: cwd,
    workspaceMode: overrides.workspaceMode ?? 'managed',
    profile: 'default',
    sandbox: 'read-only',
    status: overrides.status ?? 'active'
  });
}

function writeCodexSession(
  sessionDir: string,
  id: string,
  input: {
    timestamp: string;
    cwd: string;
    userMessage: string;
    meta?: Record<string, unknown>;
  }
): string {
  const path = join(sessionDir, `rollout-${id}.jsonl`);
  writeFileSync(
    path,
    [
      JSON.stringify({
        timestamp: input.timestamp,
        type: 'session_meta',
        payload: {
          id,
          session_id: id,
          timestamp: input.timestamp,
          cwd: input.cwd,
          ...input.meta
        }
      }),
      JSON.stringify({
        timestamp: input.timestamp,
        type: 'event_msg',
        payload: { type: 'user_message', message: input.userMessage }
      })
    ].join('\n')
  );
  return path;
}

function writeHistorySession(
  sessionDir: string,
  id: string,
  cwd: string,
  messages: string[]
): string {
  const path = join(sessionDir, `rollout-${id}.jsonl`);
  const lines = [
    {
      timestamp: '2026-07-12T07:00:00.000Z',
      type: 'session_meta',
      payload: {
        id,
        session_id: id,
        timestamp: '2026-07-12T07:00:00.000Z',
        cwd
      }
    },
    ...messages.map((message, index) => ({
      timestamp: `2026-07-12T07:00:0${index + 1}.000Z`,
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message,
        turn_id: `turn_${index + 1}`
      }
    }))
  ];
  writeFileSync(path, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  return path;
}

function writeOldApiDir(dir: string, fileName: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content);
  const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  utimesSync(join(dir, fileName), oldDate, oldDate);
  utimesSync(dir, oldDate, oldDate);
  return dir;
}

function createFakeScheduler(overrides: Partial<SchedulerService> = {}): SchedulerService {
  return {
    listSchedules() {
      return { schedules: [] };
    },
    getSchedule() {
      return undefined;
    },
    runNow() {
      throw new Error('unexpected runNow');
    },
    listOperations() {
      return { operations: [] };
    },
    start() {},
    stop() {},
    refreshTimer() {},
    ...overrides
  };
}

function createFakeMcpCodex(dir: string): { bin: string; readCommands: () => string[] } {
  const bin = join(dir, 'fake-mcp-codex.js');
  const commandsPath = join(dir, 'mcp-commands.json');
  writeFileSync(commandsPath, '[]');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "const { existsSync, readFileSync, writeFileSync } = require('node:fs');",
      "const { join } = require('node:path');",
      'const commandsPath = join(__dirname, "mcp-commands.json");',
      'const commands = existsSync(commandsPath) ? JSON.parse(readFileSync(commandsPath, "utf8")) : [];',
      'const args = process.argv.slice(2);',
      'commands.push(args.join(" "));',
      'writeFileSync(commandsPath, JSON.stringify(commands, null, 2));',
      'if (args[0] === "mcp" && args[1] === "list") {',
      '  process.stdout.write("[]\\n");',
      '  process.exit(0);',
      '}',
      'if (args[0] === "mcp" && args[1] === "add") {',
      '  if (args[2] === "broken") {',
      '    process.stderr.write("mcp add failed: invalid transport\\n");',
      '    process.exit(1);',
      '  }',
      '  process.exit(0);',
      '}',
      'if (args[0] === "mcp" && args[1] === "get" && args[2] === "secret-server") {',
      '  process.stdout.write("secret-server configured with MCP_API_TOKEN=super-secret-value\\n");',
      '  process.exit(0);',
      '}',
      'if (args[0] === "mcp" && args[1] === "get" && args[2] === "github") {',
      '  process.stdout.write(JSON.stringify({',
      '    name: "github",',
      '    transport: "stdio",',
      '    command: "node",',
      '    args: ["server.js"],',
      '    env: { GITHUB_TOKEN: "[REDACTED]" }',
      '  }) + "\\n");',
      '  process.exit(0);',
      '}',
      'if (args[0] === "mcp" && args[1] === "remove" && args[2] === "github") {',
      '  process.exit(0);',
      '}',
      'if (args[0] === "mcp" && (args[1] === "login" || args[1] === "logout") && args[2] === "github") {',
      '  process.exit(0);',
      '}',
      'const name = args[2] || "unknown";',
      'process.stderr.write("No MCP server named " + name + " is configured\\n");',
      'process.exit(1);',
      ''
    ].join('\n')
  );
  chmodSync(bin, 0o755);
  return {
    bin,
    readCommands: () => JSON.parse(readFileSync(commandsPath, 'utf8')) as string[]
  };
}

function createFakeMarketArchiveDownloader(): MarketArchiveDownloader {
  let version = 0;
  return {
    async download(input) {
      version += 1;
      const root = join(input.workDir, `fake-market-archive-${version}`);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'SKILL.md'), [
        '---',
        'name: frontend-slides',
        `description: "market version ${version}"`,
        '---',
        '',
        `market version ${version}`
      ].join('\n'));
      return root;
    }
  };
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
