import type { SandboxMode } from '@clawee/protocol';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCodex } from '../helpers/fake-codex.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunManager } from '../../src/runs/manager.js';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function createTestRunManager(input: {
  tempDir?: string;
  codexBin?: string;
  resumeCapabilityVerified?: boolean;
} = {}) {
  tempDir = input.tempDir ?? mkdtempSync(join(tmpdir(), 'clawee-manager-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const threadManager = createThreadManager({ db, dataDir: tempDir });
  const manager = createRunManager({
    db,
    dataDir: tempDir,
    codexBin: input.codexBin ?? createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    }).bin,
    codexHome: join(tempDir, 'codex-home'),
    threadAccess: threadManager,
    resumeCapabilityVerified: input.resumeCapabilityVerified ?? true
  });
  return { manager, threadManager };
}

function createPersistedThread(
  threadManager: ReturnType<typeof createThreadManager>,
  overrides: { codexThreadId?: string } = {}
) {
  const thread = threadManager.createThread({
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  });
  if (overrides.codexThreadId) threadManager.setCodexThreadId(thread.id, overrides.codexThreadId);
  return threadManager.getThread(thread.id)!;
}

function threadRun(
  thread: { id: string; cwd: string; profile: string; sandbox: SandboxMode },
  prompt: string
) {
  return {
    threadId: thread.id,
    prompt,
    cwd: thread.cwd,
    profile: thread.profile,
    sandbox: thread.sandbox,
    resumeMode: 'auto' as const
  };
}

async function waitForRunStatus(
  manager: ReturnType<typeof createRunManager>,
  runId: string,
  status: string
): Promise<void> {
  await expect
    .poll(() => manager.getRun(runId)?.status, { timeout: 1000 })
    .toBe(status);
}

describe('run manager', () => {
  it('creates a run and writes redacted raw/events/stderr/meta files', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'ok TOKEN=secret-value' }
        },
        { type: 'turn.completed' }
      ],
      stderrLines: ['warning TOKEN=secret-value']
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('succeeded');
    expect(existsSync(join(tempDir, 'runs', run.id, 'meta.json'))).toBe(true);
    expect(readFileSync(join(tempDir, 'runs', run.id, 'stderr.redacted.log'), 'utf8')).toContain(
      '[REDACTED]'
    );
    const rawRedacted = readFileSync(join(tempDir, 'runs', run.id, 'raw.redacted.ndjson'), 'utf8');
    const events = readFileSync(join(tempDir, 'runs', run.id, 'events.ndjson'), 'utf8');
    expect(rawRedacted).not.toContain('secret-value');
    expect(events).toContain('assistant_message');
    expect(events).not.toContain('secret-value');
    for (const line of rawRedacted.trim().split('\n')) JSON.parse(line);

    const fileSeqs = events
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => (JSON.parse(line) as { seq: number }).seq);
    const dbSeqs = manager.listEvents(run.id).map(event => event.seq);
    expect(fileSeqs).toEqual(dbSeqs);

    const row = db.prepare('SELECT public_status FROM runs WHERE id = ?').get(run.id) as
      | { public_status: string }
      | undefined;
    expect(row?.public_status).toBe('succeeded');
  });

  it('marks a run failed and writes diagnostics when codex exits non-zero', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }],
      stderrLines: ['failed TOKEN=secret-value'],
      exitCode: 42
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('failed');
    expect(readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')).toContain(
      '"exitCode": 42'
    );
    const row = db.prepare('SELECT public_status FROM runs WHERE id = ?').get(run.id) as
      | { public_status: string }
      | undefined;
    expect(row?.public_status).toBe('failed');
  });

  it('records a diagnostic event for invalid codex json lines', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      rawStdoutLines: ['{broken'],
      stdoutLines: [{ type: 'turn.completed' }]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    const events = manager.listEvents(run.id);
    expect(events.some(event => event.type === 'diagnostic')).toBe(true);
  });

  it('marks a zero-exit run failed when codex never emits a terminal turn event', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.terminationReason).toBe('stream_error');
    expect(manager.listEvents(run.id).some(event => event.type === 'diagnostic')).toBe(true);
  });

  it('marks a successful thread run failed when codex never emits a thread id', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      threadId: 'thread_1',
      resumeMode: 'auto'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.terminationReason).toBe('stream_error');
    expect(manager.getRun(run.id)?.errorCode).toBe('CODEX_THREAD_ID_MISSING');
    expect(manager.listEvents(run.id).some(event => event.type === 'error')).toBe(true);
  });

  it('does not prefill an existing codex thread id for a new thread run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex_thread_old' });

    const run = await manager.createAndRun({
      ...threadRun(thread, 'hello'),
      resumeMode: 'new_thread'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.errorCode).toBe('CODEX_THREAD_ID_MISSING');
    expect(manager.getRun(run.id)?.codexThreadId).toBeUndefined();
    expect(manager.listEvents(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diagnostic',
          payload: expect.objectContaining({ code: 'THREAD_CODEX_SESSION_RESET' })
        })
      ])
    );
  });

  it('uses codex exec resume for a thread with codexThreadId', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'resumed' } },
        { type: 'turn.completed' }
      ]
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const run = await manager.createAndRun(threadRun(thread, 'continue'));

    expect(run.status).toBe('succeeded');
    expect(fake.readArgv()).toEqual(
      expect.arrayContaining(['exec', 'resume', 'codex-thread-1', '--json'])
    );
  });

  it('maps missing resume targets to a not found error code', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      stderrLines: ['No session found for codex-thread-1'],
      exitCode: 1
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const run = await manager.createAndRun(threadRun(thread, 'continue'));

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)).toMatchObject({
      terminationReason: 'codex_exit_non_zero',
      errorCode: 'RESUME_TARGET_NOT_FOUND'
    });
    expect(readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')).toContain(
      'RESUME_TARGET_NOT_FOUND'
    );
  });

  it('maps other resume non-zero exits to a generic resume error code', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      stderrLines: ['resume failed unexpectedly'],
      exitCode: 1
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const run = await manager.createAndRun(threadRun(thread, 'continue'));

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.errorCode).toBe('RESUME_FAILED');
  });

  it('fails resume_thread when resume capability is unverified', async () => {
    const { manager, threadManager } = createTestRunManager({ resumeCapabilityVerified: false });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const run = manager.startRun({
      ...threadRun(thread, 'continue'),
      resumeMode: 'resume_thread'
    });

    await waitForRunStatus(manager, run.id, 'failed');
    expect(manager.getRun(run.id)).toMatchObject({
      errorCode: 'RESUME_CAPABILITY_UNVERIFIED'
    });
  });

  it('marks a thread run failed when codex emits an empty thread id', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: '   ' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      threadId: 'thread_1',
      resumeMode: 'auto'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.errorCode).toBe('CODEX_THREAD_ID_MISSING');
  });

  it('marks a run failed on timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      timeoutMs: 50,
      inactivityTimeoutMs: 5000
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.terminationReason).toBe('timeout');
  });

  it('marks a run failed on inactivity timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      timeoutMs: 5000,
      inactivityTimeoutMs: 50
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.terminationReason).toBe('inactivity_timeout');
  });

  it('marks a run failed on spawn timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }],
      initialDelayMs: 500,
      hang: true
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      timeoutMs: 5000,
      spawnTimeoutMs: 50,
      inactivityTimeoutMs: 5000
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.terminationReason).toBe('spawn_timeout');
  });

  it('marks runs left running before daemon restart as orphaned', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runId = 'run_orphaned_1';
    mkdirSync(join(tempDir, 'runs', runId), { recursive: true });
    writeFileSync(join(tempDir, 'runs', runId, 'events.ndjson'), '');
    const runs = db.prepare(`
      INSERT INTO runs (
        id, public_status, internal_status, created_by, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (
        @id, 'running', 'running', 'api', 'default', @cwd, @cwd,
        'managed', 'read-only', 'unknown', 'codex', @codexHome, 1
      )
    `);
    runs.run({
      id: runId,
      cwd: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });

    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: join(tempDir, 'codex'),
      codexHome: join(tempDir, 'codex-home')
    });

    expect(manager.getRun(runId)).toMatchObject({
      status: 'failed',
      terminationReason: 'daemon_restart',
      errorCode: 'DAEMON_RESTART'
    });
    const row = db.prepare('SELECT internal_status FROM runs WHERE id = ?').get(runId) as
      | { internal_status: string }
      | undefined;
    expect(row?.internal_status).toBe('orphaned');
    expect(manager.listEvents(runId).map(event => event.type)).toEqual(['error', 'done']);
  });

  it('can cancel a running run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000
    });

    const run = manager.startRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('running');
    expect(manager.cancelRun(run.id)).toBe(true);

    await expect
      .poll(() => manager.getRun(run.id)?.status, { timeout: 1000 })
      .toBe('canceled');
    expect(manager.listEvents(run.id).some(event => event.type === 'done')).toBe(true);
  });

  it('fails resume_thread requests without a thread id', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, { stdoutLines: [] });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home')
    });

    const run = manager.startRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      resumeMode: 'resume_thread'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.errorCode).toBe('RESUME_FAILED');
  });
});
