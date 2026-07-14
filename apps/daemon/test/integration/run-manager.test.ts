import type { SandboxMode } from '@clawee/protocol';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCodex } from '../helpers/fake-codex.js';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import { createAgentScheduleRunInjector } from '../../src/agent-tools/run-injection.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunManager } from '../../src/runs/manager.js';
import {
  createOrderedLogWriter,
  type OrderedLogWriter
} from '../../src/runs/ordered-log-writer.js';
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
  homeDir?: string;
  resumeCapabilityVerified?: boolean;
  logWriterFactory?(runDir: string): OrderedLogWriter;
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
    homeDir: input.homeDir,
    threadAccess: threadManager,
    resumeCapabilityVerified: input.resumeCapabilityVerified ?? true,
    logWriterFactory: input.logWriterFactory
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
  it('expands a home-relative cwd before starting a standalone run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-home-cwd-'));
    const workspace = join(tempDir, 'workspace');
    mkdirSync(workspace);
    const { manager } = createTestRunManager({ tempDir, homeDir: tempDir });

    const run = await manager.createAndRun({
      prompt: 'home-relative workspace',
      cwd: '~/workspace',
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('succeeded');
    expect(manager.getRun(run.id)?.cwd).toBe(workspace);
    const meta = JSON.parse(
      readFileSync(join(tempDir, 'runs', run.id, 'meta.json'), 'utf8')
    ) as { cwd?: string; args?: string[] };
    expect(meta.cwd).toBe(workspace);
    expect(meta.args).toContain(workspace);
  });

  it('uses the context-enriched execution prompt and records only context references in metadata', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-context-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const recorded: Array<{ runId: string; sourceIds: string[] }> = [];
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      recordRunContext(runId, items) {
        recorded.push({ runId, sourceIds: items.map(item => item.sourceId) });
      }
    });

    const run = await manager.createAndRun({
      prompt: 'original user prompt',
      executionPrompt: 'managed context\noriginal user prompt',
      contextItems: [{
        kind: 'memory',
        sourceId: 'mem_1',
        content: 'managed context',
        order: 0,
        scope: 'global'
      }],
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(fake.readPrompt()).toBe('managed context\noriginal user prompt');
    expect(recorded).toEqual([{ runId: run.id, sourceIds: ['mem_1'] }]);
    const meta = JSON.parse(
      readFileSync(join(tempDir, 'runs', run.id, 'meta.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(meta.contextItemIds).toEqual(['mem_1']);
    expect(JSON.stringify(meta)).not.toContain('managed context');
  });

  it('uses long-running friendly defaults for interactive codex runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
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
      prompt: 'interactive prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    });

    expect(run.status).toBe('succeeded');
    const diagnostics = JSON.parse(
      readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')
    ) as { timeoutMs?: number; inactivityTimeoutMs?: number; spawnTimeoutMs?: number };
    expect(diagnostics.timeoutMs).toBe(7_200_000);
    expect(diagnostics.inactivityTimeoutMs).toBe(600_000);
    expect(diagnostics.spawnTimeoutMs).toBe(30_000);
  });

  it('uses conservative defaults for scheduled codex runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
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
      prompt: 'scheduled prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      createdBy: 'schedule'
    });

    expect(run.status).toBe('succeeded');
    const diagnostics = JSON.parse(
      readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')
    ) as { timeoutMs?: number; inactivityTimeoutMs?: number; spawnTimeoutMs?: number };
    expect(diagnostics.timeoutMs).toBe(1_800_000);
    expect(diagnostics.inactivityTimeoutMs).toBe(600_000);
    expect(diagnostics.spawnTimeoutMs).toBe(30_000);
  });

  it('persists schedule source metadata and per-run timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
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
      prompt: 'scheduled prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      createdBy: 'schedule',
      sourceId: 'sch_123',
      timeoutMs: 2500
    });

    const row = db.prepare('SELECT created_by, source_id, timeout_ms FROM runs WHERE id = ?').get(run.id) as {
      created_by: string;
      source_id: string | null;
      timeout_ms: number | null;
    };
    expect(row).toEqual({
      created_by: 'schedule',
      source_id: 'sch_123',
      timeout_ms: 2500
    });
    expect(manager.getRun(run.id)).toMatchObject({
      createdBy: 'schedule',
      sourceId: 'sch_123',
      timeoutMs: 2500
    });
  });

  it('uses per-run timeout when executing codex', async () => {
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

    const run = await manager.createAndRun({
      prompt: 'scheduled prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      timeoutMs: 50
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)?.terminationReason).toBe('timeout');
    expect(manager.getRun(run.id)?.errorCode).toBe('CODEX_EXEC_TIMEOUT');
  });

  it('maps inactivity timeout to a distinct codex error code', async () => {
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
      prompt: 'scheduled prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)).toMatchObject({
      terminationReason: 'inactivity_timeout',
      errorCode: 'CODEX_EXEC_INACTIVITY_TIMEOUT'
    });
  });

  it('maps spawn timeout to a distinct codex error code', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      initialDelayMs: 5000
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
      prompt: 'scheduled prompt',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    });

    expect(run.status).toBe('failed');
    expect(manager.getRun(run.id)).toMatchObject({
      terminationReason: 'spawn_timeout',
      errorCode: 'CODEX_EXEC_SPAWN_TIMEOUT'
    });
  });

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

  it('keeps high-frequency event logs ordered and records writer metrics', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        ...Array.from({ length: 120 }, (_, index) => ({
          type: 'item.completed',
          item: { type: 'agent_message', text: `event ${index}` }
        })),
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
      prompt: 'generate many events',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('succeeded');
    const fileEvents = readFileSync(
      join(tempDir, 'runs', run.id, 'events.ndjson'),
      'utf8'
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as { seq: number });
    expect(fileEvents.map(event => event.seq)).toEqual(
      manager.listEvents(run.id).map(event => event.seq)
    );

    const diagnostics = JSON.parse(
      readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')
    ) as {
      logWriter?: {
        writesAttempted: number;
        writesCompleted: number;
        failureCount: number;
        drainCount: number;
        peakQueuedBytes: number;
      };
    };
    expect(diagnostics.logWriter).toMatchObject({
      failureCount: 0
    });
    expect(diagnostics.logWriter?.writesAttempted).toBeGreaterThan(120);
    expect(diagnostics.logWriter?.writesCompleted).toBe(
      diagnostics.logWriter?.writesAttempted
    );
    expect(diagnostics.logWriter?.drainCount).toBeGreaterThan(0);
    expect(diagnostics.logWriter?.peakQueuedBytes).toBeGreaterThan(0);
  });

  it('isolates subscriber failures from run execution and event log persistence', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      initialDelayMs: 100,
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin
    });

    const run = manager.startRun({
      prompt: 'subscriber failure',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    manager.subscribe(run.id, () => {
      throw new Error('simulated subscriber failure');
    });

    await waitForRunStatus(manager, run.id, 'succeeded');

    const databaseSeqs = manager.listEvents(run.id).map(event => event.seq);
    const fileSeqs = readFileSync(
      join(tempDir, 'runs', run.id, 'events.ndjson'),
      'utf8'
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => (JSON.parse(line) as { seq: number }).seq);
    expect(fileSeqs).toEqual(databaseSeqs);
    expect(manager.listEvents(run.id).some(event => event.type === 'done')).toBe(true);
  });

  it('records a run diagnostic when asynchronous log writes fail', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      logWriterFactory(runDir) {
        return createOrderedLogWriter({
          directory: runDir,
          appendFile: async (path, content) => {
            if (path.endsWith('raw.redacted.ndjson')) {
              throw new Error('simulated disk failure');
            }
            await appendFile(path, content);
          }
        });
      }
    });

    const run = await manager.createAndRun({
      prompt: 'trigger log failure',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(run.status).toBe('failed');
    expect(manager.listEvents(run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'diagnostic',
          payload: expect.objectContaining({
            type: 'diagnostic',
            code: 'RUN_LOG_WRITE_FAILED'
          })
        })
      ])
    );
    const diagnostics = JSON.parse(
      readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')
    ) as {
      logWriter?: {
        failureCount: number;
        failures: Array<{ file: string; message: string }>;
      };
    };
    expect(diagnostics.logWriter?.failureCount).toBeGreaterThan(0);
    expect(diagnostics.logWriter?.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'raw.redacted.ndjson',
          message: 'simulated disk failure'
        })
      ])
    );
  });

  it('waits for active runs and queued log writes during close', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    let releaseWrite!: () => void;
    const blockedWrite = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    let writeStarted = false;
    const { manager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      logWriterFactory(runDir) {
        return createOrderedLogWriter({
          directory: runDir,
          appendFile: async (path, content) => {
            writeStarted = true;
            await blockedWrite;
            await appendFile(path, content);
          }
        });
      }
    });

    const run = manager.startRun({
      prompt: 'close with pending logs',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    await expect.poll(() => writeStarted, { timeout: 5_000 }).toBe(true);

    let closed = false;
    const close = manager.close({ timeoutMs: 2_000 }).then(() => {
      closed = true;
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(closed).toBe(false);

    releaseWrite();
    await close;

    expect(manager.getRun(run.id)?.status).toMatch(/canceled|failed/);
  }, 10_000);

  it('shares in-flight close work after an earlier close call times out', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    let releaseWrite!: () => void;
    const blockedWrite = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    let writeStarted = false;
    const { manager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      logWriterFactory(runDir) {
        return createOrderedLogWriter({
          directory: runDir,
          appendFile: async (path, content) => {
            writeStarted = true;
            await blockedWrite;
            await appendFile(path, content);
          }
        });
      }
    });

    manager.startRun({
      prompt: 'retry close after timeout',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    await expect.poll(() => writeStarted, { timeout: 5_000 }).toBe(true);

    const firstClose = manager.close({ timeoutMs: 25 });
    let secondCloseSettled = false;
    const secondClose = manager.close({ timeoutMs: 2_000 }).finally(() => {
      secondCloseSettled = true;
    });

    await expect(firstClose).rejects.toThrow('Timed out waiting for run log writers to close');
    expect(secondCloseSettled).toBe(false);

    releaseWrite();
    await secondClose;
  }, 10_000);

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
    const argv = fake.readArgv();
    expect(argv.slice(0, 4)).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check']);
    expect(argv).toEqual(expect.arrayContaining(['-c', 'sandbox_mode="read-only"']));
    expect(argv.at(-1)).toBe('codex-thread-1');
    const meta = JSON.parse(readFileSync(join(tempDir, 'runs', run.id, 'meta.json'), 'utf8')) as {
      args: string[];
    };
    expect(meta.args).toEqual(argv);
    expect(meta.args).toEqual(expect.arrayContaining(['-c', 'sandbox_mode="read-only"']));
  });

  it('injects per-run schedule tools without persisting the capability secret', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-agent-tools-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-agent-tools' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const threadManager = createThreadManager({ db, dataDir: tempDir });
    const thread = threadManager.createThread({
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    const capabilities = createAgentCapabilityTokenStore();
    const codexHome = join(tempDir, 'codex-home');
    mkdirSync(codexHome, { recursive: true });
    const configPath = join(codexHome, 'config.toml');
    writeFileSync(configPath, 'model = "existing-model"\\n');
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome,
      threadAccess: threadManager,
      resumeCapabilityVerified: true,
      agentToolInjector: createAgentScheduleRunInjector({
        capabilities,
        getBaseUrl: () => 'http://127.0.0.1:43123',
        command: '/usr/bin/node',
        args: ['/app/agent-tools/stdio-server.js']
      }),
      onRunTerminal: runId => capabilities.revokeRun(runId)
    });

    const run = await manager.createAndRun({
      threadId: thread.id,
      prompt: '创建一个每日总结任务'
    });

    expect(run.status).toBe('succeeded');
    const argv = fake.readArgv();
    const env = fake.readAgentToolEnv();
    const token = env.CLAWEE_AGENT_CAPABILITY_TOKEN!;
    expect(argv).toEqual(expect.arrayContaining([
      '-c',
      'mcp_servers.clawee_schedule.command="/usr/bin/node"',
      '-c',
      'mcp_servers.clawee_schedule.enabled_tools=["clawee_schedule_create","clawee_schedule_update","clawee_schedule_pause","clawee_schedule_resume","clawee_schedule_run_now","clawee_schedule_get"]'
    ]));
    expect(env.CLAWEE_AGENT_TOOL_URL).toBe('http://127.0.0.1:43123');
    expect(token).toMatch(/^clwcap_/);
    expect(readFileSync(configPath, 'utf8')).toBe('model = "existing-model"\\n');

    const persisted = [
      fake.readPrompt(),
      readFileSync(join(tempDir, 'runs', run.id, 'meta.json'), 'utf8'),
      readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8'),
      JSON.stringify(manager.listEvents(run.id))
    ].join('\n');
    expect(persisted).not.toContain(token);
    expect(JSON.stringify(argv)).not.toContain(token);
    expect(() => capabilities.authorize(token, {
      scope: 'schedule:get'
    })).toThrow('revoked');
    capabilities.close();
  });

  it('uses the thread sandbox override for workspace-write resumed runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = threadManager.createThread({
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    });
    threadManager.setCodexThreadId(thread.id, 'codex-thread-1');

    const run = await manager.createAndRun(threadRun(thread, 'continue'));

    expect(run.status).toBe('succeeded');
    expect(fake.readArgv()).toEqual(
      expect.arrayContaining(['exec', 'resume', '-c', 'sandbox_mode="workspace-write"'])
    );
    expect(fake.readArgv()).not.toContain('--sandbox');
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

  it('resolves execution configuration from the thread when the caller only provides threadId', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager);

    const run = await manager.createAndRun({
      threadId: thread.id,
      prompt: 'public schedule prompt',
      executionPrompt: 'internal schedule prompt',
      publicPrompt: 'public schedule prompt',
      triggeredAt: '2026-07-14T14:05:00.000Z',
      createdBy: 'schedule',
      sourceId: 'sch_one'
    });

    expect(run).toMatchObject({ threadId: thread.id, status: 'succeeded' });
    expect(manager.getRun(run.id)).toMatchObject({
      threadId: thread.id,
      cwd: thread.cwd,
      profile: thread.profile,
      sandbox: thread.sandbox,
      createdBy: 'schedule',
      sourceId: 'sch_one',
      publicPrompt: 'public schedule prompt',
      triggeredAt: '2026-07-14T14:05:00.000Z'
    });
    expect(manager.listEvents(run.id)[0]).toMatchObject({
      runId: run.id,
      seq: 1,
      type: 'schedule_trigger',
      payload: {
        type: 'schedule_trigger',
        prompt: 'public schedule prompt',
        triggeredAt: '2026-07-14T14:05:00.000Z'
      }
    });
    expect(fake.readPrompt()).toBe('internal schedule prompt');
  });

  it('does not persist schedule-only public metadata for ordinary runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-ordinary' },
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    const { manager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin
    });

    const run = await manager.createAndRun({
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      prompt: 'ordinary prompt',
      publicPrompt: 'must not persist',
      triggeredAt: '2026-07-14T14:06:00.000Z'
    });

    const stored = manager.getRun(run.id);
    expect(stored?.createdBy).toBe('api');
    expect(stored?.publicPrompt).toBeUndefined();
    expect(stored?.triggeredAt).toBeUndefined();
    expect(manager.listEvents(run.id).some(event => event.type === 'schedule_trigger')).toBe(false);
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
    expect(fake.readArgv()).toEqual(
      expect.arrayContaining(['exec', 'resume', 'codex-thread-1', '--json'])
    );
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

  it('interrupts the active run and prioritizes the follow-up ahead of regular queued runs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-interrupt-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager);

    const active = manager.startRun(threadRun(thread, 'active'));
    const regular = manager.startRun({
      ...threadRun(thread, 'regular'),
      submissionMode: 'enqueue'
    });
    const interrupting = manager.startRun({
      ...threadRun(thread, 'interrupting'),
      submissionMode: 'interrupt_and_enqueue'
    });

    expect(manager.hasActiveRunForThread(thread.id)).toBe(true);
    expect(regular).toMatchObject({
      status: 'queued',
      submissionMode: 'enqueue',
      queuePosition: 1
    });
    expect(interrupting).toMatchObject({
      status: 'queued',
      submissionMode: 'interrupt_and_enqueue',
      queuePosition: 1
    });
    expect(manager.getRun(regular.id)).toMatchObject({ queuePosition: 2 });
    await waitForRunStatus(manager, active.id, 'canceled');
    await waitForRunStatus(manager, interrupting.id, 'running');
    await expect.poll(
      () => existsSync(join(tempDir, 'prompt.txt')) ? fake.readPrompt() : ''
    ).toBe('interrupting');

    expect(manager.cancelRun(interrupting.id)).toBe(true);
    await waitForRunStatus(manager, interrupting.id, 'canceled');
    await waitForRunStatus(manager, regular.id, 'running');
    await expect.poll(
      () => existsSync(join(tempDir, 'prompt.txt')) ? fake.readPrompt() : ''
    ).toBe('regular');
    expect(manager.listRunsByThread(thread.id).filter(run => run.status === 'running')).toHaveLength(1);
    expect(manager.cancelRun(regular.id)).toBe(true);
    await waitForRunStatus(manager, regular.id, 'canceled');
    expect(manager.hasActiveRunForThread(thread.id)).toBe(false);
  });

  it('keeps multiple interrupting follow-ups in FIFO order', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-run-interrupt-fifo-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: true
    });
    const thread = createPersistedThread(threadManager);

    const active = manager.startRun(threadRun(thread, 'active'));
    const first = manager.startRun({
      ...threadRun(thread, 'first interrupt'),
      submissionMode: 'interrupt_and_enqueue'
    });
    const second = manager.startRun({
      ...threadRun(thread, 'second interrupt'),
      submissionMode: 'interrupt_and_enqueue'
    });

    expect(first.queuePosition).toBe(1);
    expect(second.queuePosition).toBe(2);
    await waitForRunStatus(manager, active.id, 'canceled');
    await waitForRunStatus(manager, first.id, 'running');
    await expect.poll(
      () => existsSync(join(tempDir, 'prompt.txt')) ? fake.readPrompt() : ''
    ).toBe('first interrupt');
    manager.cancelRun(first.id);
    await waitForRunStatus(manager, first.id, 'canceled');
    await waitForRunStatus(manager, second.id, 'running');
    await expect.poll(
      () => existsSync(join(tempDir, 'prompt.txt')) ? fake.readPrompt() : ''
    ).toBe('second interrupt');
    expect(manager.cancelRun(second.id)).toBe(true);
    await waitForRunStatus(manager, second.id, 'canceled');
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
    let logWriter: OrderedLogWriter | undefined;
    const { manager, threadManager } = createTestRunManager({
      tempDir,
      codexBin: fake.bin,
      resumeCapabilityVerified: false,
      logWriterFactory(runDir) {
        logWriter = createOrderedLogWriter({ directory: runDir });
        return logWriter;
      }
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
    await expect.poll(() => logWriter?.getMetrics().closed).toBe(true);
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

  it('keeps a completed turn successful when the codex process times out during shutdown', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex-thread-1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed' }
      ],
      hang: true
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      timeoutMs: 2000,
      inactivityTimeoutMs: 5000
    });

    const run = await manager.createAndRun({
      prompt: 'hello',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      threadId: 'thread_1',
      resumeMode: 'auto'
    });

    expect(run.status).toBe('succeeded');
    expect(manager.getRun(run.id)).toMatchObject({
      status: 'succeeded',
      terminationReason: 'completed'
    });
    expect(manager.getRun(run.id)?.errorCode).toBeUndefined();
    const doneEvents = manager.listEvents(run.id).filter(event => event.type === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toMatchObject({
      payload: { status: 'succeeded', terminationReason: 'completed' }
    });
    expect(readFileSync(join(tempDir, 'runs', run.id, 'diagnostics.json'), 'utf8')).toContain(
      'CODEX_PROCESS_EXIT_TIMEOUT_AFTER_TURN_COMPLETED'
    );
  });

  it('does not hide a missing thread id when a completed thread run times out during shutdown', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-manager-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed' }
      ],
      hang: true
    });
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      timeoutMs: 2000,
      inactivityTimeoutMs: 5000
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
    expect(manager.getRun(run.id)).toMatchObject({
      status: 'failed',
      terminationReason: 'stream_error',
      errorCode: 'CODEX_THREAD_ID_MISSING'
    });
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
