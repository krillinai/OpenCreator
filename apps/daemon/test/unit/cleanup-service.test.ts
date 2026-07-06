import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CleanupError,
  createCleanupService
} from '../../src/cleanup/service.js';
import type { RunRepository, RunRow, ThreadRepository, ThreadRow } from '../../src/storage/repositories.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('cleanup service', () => {
  it('previews old non-active run log directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'runs', 'run_old', 'events.ndjson'), 'done');
    setTreeMtime(join(tempDir, 'runs', 'run_old'), new Date('2026-05-01T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([
        makeRunRow({ id: 'run_old', public_status: 'succeeded', internal_status: 'succeeded' })
      ]),
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview.items).toEqual([
      {
        type: 'run_logs',
        id: 'run_old',
        path: join(tempDir, 'runs', 'run_old'),
        sizeBytes: 4,
        lastModifiedAt: '2026-05-01T00:00:00.000Z',
        reason: 'run logs older than 30 days'
      }
    ]);
    expect(preview.totalSizeBytes).toBe(4);
    expect(preview.warnings).toEqual([]);
  });

  it('does not return recent run directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'runs', 'run_recent', 'events.ndjson'), 'done');
    setTreeMtime(join(tempDir, 'runs', 'run_recent'), new Date('2026-06-20T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([makeRunRow({ id: 'run_recent' })]),
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items).toEqual([]);
  });

  it('does not return active run directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'runs', 'run_active_public', 'events.ndjson'), 'queued');
    writeRuntimeFile(join(tempDir, 'runs', 'run_active_internal', 'events.ndjson'), 'running');
    setTreeMtime(join(tempDir, 'runs'), new Date('2026-05-01T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([
        makeRunRow({ id: 'run_active_public', public_status: 'running', internal_status: 'succeeded' }),
        makeRunRow({ id: 'run_active_internal', public_status: 'failed', internal_status: 'canceling' })
      ]),
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items).toEqual([]);
  });

  it('does not return non run_* directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'runs', 'other_1', 'events.ndjson'), 'done');
    setTreeMtime(join(tempDir, 'runs', 'other_1'), new Date('2026-05-01T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([makeRunRow({ id: 'other_1' })]),
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items).toEqual([]);
  });

  it('previews only archived managed thread workspaces', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'workspaces', 'thread_archived', 'workspace.txt'), 'workspace');
    setTreeMtime(join(tempDir, 'workspaces', 'thread_archived'), new Date('2026-05-01T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([]),
      threads: makeThreadRepository([
        makeThreadRow({ id: 'thread_archived', workspace_mode: 'managed', status: 'archived' })
      ]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items).toEqual([
      {
        type: 'managed_thread_workspace',
        id: 'thread_archived',
        path: join(tempDir, 'workspaces', 'thread_archived'),
        sizeBytes: 9,
        lastModifiedAt: '2026-05-01T00:00:00.000Z',
        reason: 'archived managed thread workspace older than 30 days'
      }
    ]);
  });

  it('does not return active managed thread workspaces', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'workspaces', 'thread_active', 'workspace.txt'), 'workspace');
    setTreeMtime(join(tempDir, 'workspaces', 'thread_active'), new Date('2026-05-01T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([]),
      threads: makeThreadRepository([
        makeThreadRow({ id: 'thread_active', workspace_mode: 'managed', status: 'active' })
      ]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items).toEqual([]);
  });

  it('does not return archived external workspaces', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'workspaces', 'thread_external', 'workspace.txt'), 'workspace');
    setTreeMtime(join(tempDir, 'workspaces', 'thread_external'), new Date('2026-05-01T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([]),
      threads: makeThreadRepository([
        makeThreadRow({ id: 'thread_external', workspace_mode: 'external', status: 'archived' })
      ]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items).toEqual([]);
  });

  it('rejects invalid olderThanDays', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([]),
      threads: makeThreadRepository([])
    });

    expect(() => service.preview({ olderThanDays: 0 })).toThrowError(
      new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer')
    );
    expect(() => service.delete({ olderThanDays: 1.5 })).toThrowError(
      new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer')
    );
  });

  it('skips symlinked candidates with a warning', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    const realRunDir = join(tempDir, 'real-run');
    mkdirSync(join(tempDir, 'runs'), { recursive: true });
    mkdirSync(realRunDir, { recursive: true });
    symlinkSync(realRunDir, join(tempDir, 'runs', 'run_link'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([makeRunRow({ id: 'run_link' })]),
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview.items).toEqual([]);
    expect(preview.warnings).toContain(
      `Skipping unsafe runtime cleanup candidate: ${join(tempDir, 'runs', 'run_link')}`
    );
  });

  it('skips symlinked roots with a warning', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    const realRunsDir = join(tempDir, 'real-runs');
    mkdirSync(realRunsDir, { recursive: true });
    symlinkSync(realRunsDir, join(tempDir, 'runs'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([]),
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    const preview = service.preview({ olderThanDays: 30 });

    expect(preview.items).toEqual([]);
    expect(preview.warnings).toContain(`Skipping unsafe runtime cleanup root: ${join(tempDir, 'runs')}`);
  });

  it('deletes candidates after rescanning and leaves non-candidates in place', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    const oldRunDir = join(tempDir, 'runs', 'run_old');
    const recentRunDir = join(tempDir, 'runs', 'run_recent');
    const oldThreadDir = join(tempDir, 'workspaces', 'thread_old');
    writeRuntimeFile(join(oldRunDir, 'events.ndjson'), 'done');
    writeRuntimeFile(join(recentRunDir, 'events.ndjson'), 'done');
    writeRuntimeFile(join(oldThreadDir, 'workspace.txt'), 'workspace');
    setTreeMtime(oldRunDir, new Date('2026-05-01T00:00:00.000Z'));
    setTreeMtime(oldThreadDir, new Date('2026-05-01T00:00:00.000Z'));
    setTreeMtime(recentRunDir, new Date('2026-06-20T00:00:00.000Z'));

    const service = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([makeRunRow({ id: 'run_old' }), makeRunRow({ id: 'run_recent' })]),
      threads: makeThreadRepository([makeThreadRow({ id: 'thread_old', status: 'archived' })]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    expect(service.preview({ olderThanDays: 30 }).items.map(item => item.id).sort()).toEqual([
      'run_old',
      'thread_old'
    ]);
    writeRuntimeFile(join(tempDir, 'runs', 'run_rescan', 'events.ndjson'), 'done');
    setTreeMtime(join(tempDir, 'runs', 'run_rescan'), new Date('2026-05-01T00:00:00.000Z'));

    const deleted = createCleanupService({
      dataDir: tempDir,
      runs: makeRunRepository([
        makeRunRow({ id: 'run_old' }),
        makeRunRow({ id: 'run_recent' }),
        makeRunRow({ id: 'run_rescan' })
      ]),
      threads: makeThreadRepository([makeThreadRow({ id: 'thread_old', status: 'archived' })]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    }).delete({ olderThanDays: 30 });

    expect(deleted.deleted.map(item => item.id).sort()).toEqual(['run_old', 'run_rescan', 'thread_old']);
    expect(deleted.failed).toEqual([]);
    expect(deleted.totalDeletedBytes).toBe(17);
    expect(existsSync(oldRunDir)).toBe(false);
    expect(existsSync(join(tempDir, 'runs', 'run_rescan'))).toBe(false);
    expect(existsSync(oldThreadDir)).toBe(false);
    expect(existsSync(recentRunDir)).toBe(true);
  });

  it('does not delete DB rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-cleanup-service-'));
    writeRuntimeFile(join(tempDir, 'runs', 'run_old', 'events.ndjson'), 'done');
    setTreeMtime(join(tempDir, 'runs', 'run_old'), new Date('2026-05-01T00:00:00.000Z'));
    const rows = new Map([['run_old', makeRunRow({ id: 'run_old' })]]);
    const runs = {
      getRun(id: string) {
        return rows.get(id);
      }
    };

    const service = createCleanupService({
      dataDir: tempDir,
      runs,
      threads: makeThreadRepository([]),
      clock: () => new Date('2026-07-06T00:00:00.000Z')
    });

    service.delete({ olderThanDays: 30 });

    expect(rows.has('run_old')).toBe(true);
    expect(existsSync(join(tempDir, 'runs', 'run_old'))).toBe(false);
  });
});

function writeRuntimeFile(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content);
}

function setTreeMtime(path: string, date: Date): void {
  const stat = lstatSync(path);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of readdirSync(path)) {
      setTreeMtime(join(path, entry), date);
    }
  }
  utimesSync(path, date, date);
}

function makeRunRepository(rows: RunRow[]): Pick<RunRepository, 'getRun'> {
  const byId = new Map(rows.map(row => [row.id, row]));
  return {
    getRun(id: string) {
      return byId.get(id);
    }
  };
}

function makeThreadRepository(rows: ThreadRow[]): Pick<ThreadRepository, 'getThread'> {
  const byId = new Map(rows.map(row => [row.id, row]));
  return {
    getThread(id: string) {
      return byId.get(id);
    }
  };
}

function makeRunRow(overrides: Partial<RunRow> & { id: string }): RunRow {
  const { id, ...rest } = overrides;
  return {
    id,
    thread_id: null,
    codex_thread_id: null,
    resume_mode: 'independent',
    queue_state: 'none',
    public_status: 'succeeded',
    internal_status: 'succeeded',
    created_by: 'api',
    source_id: null,
    profile: 'default',
    cwd: tempDir,
    canonical_cwd: tempDir,
    workspace_mode: 'managed',
    prompt_hash: null,
    prompt_preview_redacted: null,
    model: null,
    reasoning: null,
    sandbox: 'read-only',
    codex_version: '0.0.0-test',
    codex_bin: 'codex',
    codex_home: tempDir,
    normalizer_version: 1,
    timeout_ms: null,
    inactivity_timeout_ms: null,
    transcript_reseed_mode: null,
    resume_argv_json: null,
    usage_source: null,
    termination_reason: null,
    exit_code: null,
    signal: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    error_code: null,
    error_message: null,
    ...rest
  };
}

function makeThreadRow(overrides: Partial<ThreadRow> & { id: string }): ThreadRow {
  const { id, ...rest } = overrides;
  return {
    id,
    title: null,
    codex_thread_id: null,
    cwd: tempDir,
    canonical_cwd: tempDir,
    workspace_mode: 'managed',
    profile: 'default',
    sandbox: 'read-only',
    model: null,
    reasoning: null,
    status: 'archived',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    archived_at: '2026-05-01T00:00:00.000Z',
    last_error_code: null,
    last_error_message: null,
    ...rest
  };
}
