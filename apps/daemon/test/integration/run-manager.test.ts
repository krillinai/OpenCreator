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
const RUN_STATUS_TIMEOUT_MS = 5_000;

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
    .poll(() => manager.getRun(runId)?.status, { timeout: RUN_STATUS_TIMEOUT_MS })
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

  it('returns threadId for immediate and completed thread runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ],
      lineDelayMs: 50
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const started = manager.startRun(threadRun(thread, 'start'));
    expect(started).toMatchObject({ threadId: thread.id, status: 'running' });
    await waitForRunStatus(manager, started.id, 'succeeded');

    const completed = await manager.createAndRun(threadRun(thread, 'complete'));
    expect(completed).toMatchObject({ threadId: thread.id, status: 'succeeded' });
  });

  it('queues same-thread runs and starts the second after the first completes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed' }
      ],
      lineDelayMs: 50
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const first = manager.startRun(threadRun(thread, 'first'));
    const second = manager.startRun(threadRun(thread, 'second'));

    expect(second).toMatchObject({ id: second.id, threadId: thread.id, status: 'queued' });
    expect(manager.getRun(second.id)?.status).toBe('queued');
    await waitForRunStatus(manager, first.id, 'succeeded');
    await waitForRunStatus(manager, second.id, 'succeeded');
  });

  it('updates queued run resume mode when dequeued as a resumed thread run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ],
      lineDelayMs: 50
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager);

    const first = manager.startRun(threadRun(thread, 'first'));
    const second = manager.startRun(threadRun(thread, 'second'));

    await waitForRunStatus(manager, first.id, 'succeeded');
    await waitForRunStatus(manager, second.id, 'succeeded');

    const row = db!.prepare('SELECT resume_mode FROM runs WHERE id = ?').get(second.id) as
      | { resume_mode: string }
      | undefined;
    const meta = JSON.parse(readFileSync(join(tempDir, 'runs', second.id, 'meta.json'), 'utf8')) as {
      args: string[];
    };
    expect(row?.resume_mode).toBe('resume_thread');
    expect(meta.args).toEqual(expect.arrayContaining(['exec', 'resume', 'codex-thread-1', '--json']));
  });

  it('cancels queued same-thread runs without spawning codex', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ],
      lineDelayMs: 50
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const first = manager.startRun(threadRun(thread, 'first'));
    const second = manager.startRun(threadRun(thread, 'second'));

    expect(manager.cancelRun(second.id)).toBe(true);
    expect(manager.getRun(second.id)).toMatchObject({ status: 'canceled' });
    await waitForRunStatus(manager, first.id, 'succeeded');
    expect(fake.readPrompt()).toBe('first');
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

  it('runs explicit resume_thread without a thread id as an independent exec', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'independent' } },
        { type: 'turn.completed' }
      ]
    });
    const { manager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: false
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      resumeMode: 'resume_thread'
    });

    expect(run.status).toBe('succeeded');
    const completedRun = manager.getRun(run.id)!;
    expect(completedRun.status).toBe('succeeded');
    expect('errorCode' in completedRun).toBe(false);
    expect(fake.readArgv()).toEqual(expect.arrayContaining(['exec', '--json']));
    expect(fake.readArgv()).not.toContain('resume');
  });

  it('fails resume_thread when resume capability is unverified', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: false
    });
    const thread = createPersistedThread(threadManager, { codexThreadId: 'codex-thread-1' });

    const run = manager.startRun({
      ...threadRun(thread, 'continue'),
      resumeMode: 'resume_thread'
    });

    expect(run).toMatchObject({ threadId: thread.id, status: 'failed' });
    await waitForRunStatus(manager, run.id, 'failed');
    expect(manager.getRun(run.id)).toMatchObject({
      errorCode: 'RESUME_CAPABILITY_UNVERIFIED'
    });
    expect(existsSync(join(tempDir, 'argv.json'))).toBe(false);
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

  it('marks queued thread runs left before daemon restart as thread orphaned', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runId = 'run_thread_orphaned_1';
    mkdirSync(join(tempDir, 'runs', runId), { recursive: true });
    writeFileSync(join(tempDir, 'runs', runId, 'events.ndjson'), '');
    const runs = db.prepare(`
      INSERT INTO runs (
        id, thread_id, public_status, internal_status, created_by, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (
        @id, 'thread_1', 'queued', 'queued', 'api', 'default', @cwd, @cwd,
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
      errorCode: 'THREAD_RUN_ORPHANED'
    });
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
});
