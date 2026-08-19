import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DiagnosticsError,
  collectRunDiagnostics
} from '../../src/diagnostics/collector.js';
import type { RunRepository, RunRow } from '../../src/storage/repositories.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('diagnostics collector', () => {
  it('collects the default diagnostic files without raw.redacted.ndjson', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    writeRunFiles(tempDir, 'run_1', {
      'meta.json': '{"id":"run_1"}',
      'events.ndjson': '{"type":"done"}\n',
      'stderr.redacted.log': 'TOKEN=plain-token',
      'diagnostics.json': '{"exitCode":0}',
      'raw.redacted.ndjson': '{"secret":"still-redacted"}\n'
    });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files.map(file => file.name).sort()).toEqual([
      'diagnostics.json',
      'events.ndjson',
      'meta.json',
      'stderr.redacted.log'
    ]);
    expect(result.files.find(file => file.name === 'stderr.redacted.log')?.content).toBe(
      'TOKEN=[REDACTED]'
    );
    expect(result.warnings).toContain('Diagnostics are redacted on a best-effort basis.');
  });

  it('includes raw.redacted.ndjson only when requested', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    writeRunFiles(tempDir, 'run_1', {
      'meta.json': '{"id":"run_1"}',
      'raw.redacted.ndjson': 'AUTH=raw-auth\n'
    });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1',
      includeRawRedacted: true
    });

    expect(result.files).toEqual([
      { name: 'meta.json', content: '{"id":"run_1"}' },
      { name: 'raw.redacted.ndjson', content: 'AUTH=[REDACTED]\n' }
    ]);
  });

  it('surfaces recorded log writer failures as diagnostic warnings', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    writeRunFiles(tempDir, 'run_1', {
      'diagnostics.json': JSON.stringify({
        logWriter: {
          failureCount: 2,
          backpressureRejects: 1,
          failures: [
            { file: 'events.ndjson', message: 'disk unavailable' },
            { file: 'raw.redacted.ndjson', message: 'queue limit exceeded' }
          ]
        }
      })
    });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Run log writer recorded 2 failed writes.',
        'Run log writer rejected 1 writes because the queue limit was exceeded.'
      ])
    );
  });

  it('rejects invalid run ids before filesystem access', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));

    expect(() =>
      collectRunDiagnostics({
        dataDir: tempDir,
        runs: makeRunRepository(['run_1']),
        runId: '../outside'
      })
    ).toThrowError(new DiagnosticsError('VALIDATION_FAILED', 'run id is invalid'));
  });

  it('returns RUN_NOT_FOUND for syntactically valid missing runs', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));

    expect(() =>
      collectRunDiagnostics({
        dataDir: tempDir,
        runs: makeRunRepository([]),
        runId: 'run_missing'
      })
    ).toThrowError(new DiagnosticsError('RUN_NOT_FOUND', 'Run not found'));
  });

  it('keeps a 200-style collection result when files are missing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    mkdirSync(join(tempDir, 'runs', 'run_1'), { recursive: true });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Diagnostics are redacted on a best-effort basis.',
        'Diagnostic file meta.json is missing.',
        'Diagnostic file events.ndjson is missing.',
        'Diagnostic file stderr.redacted.log is missing.',
        'Diagnostic file diagnostics.json is missing.'
      ])
    );
  });

  it('returns empty files when the runs root is missing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1',
      schedules: {
        getRunTrace: () => ({
          scheduleId: 'sch_1',
          threadId: 'thread_1',
          runId: 'run_1',
          triggerType: 'run_now',
          actorType: 'user',
          actorRunId: null,
          scheduledAt: '2026-07-14T09:00:00.000Z',
          startedAt: null,
          endedAt: null,
          status: 'queued',
          queueReason: 'thread_active',
          errorCode: null,
          events: []
        })
      }
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toContain('Run diagnostics directory is missing.');
    expect(result.scheduleTrace).toMatchObject({
      scheduleId: 'sch_1',
      threadId: 'thread_1',
      runId: 'run_1'
    });
  });

  it('returns empty files when the run diagnostics directory is missing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    mkdirSync(join(tempDir, 'runs'), { recursive: true });

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toContain('Run diagnostics directory is missing.');
  });

  it('skips diagnostics when the runs root is a symlink', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    const realRunsDir = join(tempDir, 'real-runs');
    mkdirSync(realRunsDir, { recursive: true });
    symlinkSync(realRunsDir, join(tempDir, 'runs'));

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toContain('Run diagnostics root was skipped because it is unsafe.');
  });

  it('skips diagnostics when the run directory is a symlink', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    const realRunDir = join(tempDir, 'real-run');
    mkdirSync(join(tempDir, 'runs'), { recursive: true });
    mkdirSync(realRunDir, { recursive: true });
    symlinkSync(realRunDir, join(tempDir, 'runs', 'run_1'));

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([]);
    expect(result.warnings).toContain(
      'Run diagnostics directory was skipped because it is unsafe.'
    );
  });

  it('skips symlinked diagnostic files', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    const runDir = join(tempDir, 'runs', 'run_1');
    const outsideDir = join(tempDir, 'outside');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'meta.json'), 'SECRET=outside');
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');
    symlinkSync(join(outsideDir, 'meta.json'), join(runDir, 'meta.json'));

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([{ name: 'events.ndjson', content: '{"type":"done"}\n' }]);
    expect(result.warnings).toContain('Diagnostic file meta.json was skipped because it is unsafe.');
  });

  it('skips allowed diagnostic file names that are directories', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-diagnostics-collector-'));
    const runDir = join(tempDir, 'runs', 'run_1');
    mkdirSync(join(runDir, 'meta.json'), { recursive: true });
    writeFileSync(join(runDir, 'events.ndjson'), '{"type":"done"}\n');

    const result = collectRunDiagnostics({
      dataDir: tempDir,
      runs: makeRunRepository(['run_1']),
      runId: 'run_1'
    });

    expect(result.files).toEqual([{ name: 'events.ndjson', content: '{"type":"done"}\n' }]);
    expect(result.warnings).toContain('Diagnostic file meta.json was skipped because it is unsafe.');
  });
});

function writeRunFiles(root: string, runId: string, files: Record<string, string>): void {
  const runDir = join(root, 'runs', runId);
  mkdirSync(runDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(runDir, name), content);
  }
}

function makeRunRepository(ids: string[]): Pick<RunRepository, 'getRun'> {
  return {
    getRun(id: string) {
      if (!ids.includes(id)) return undefined;
      return { id } as RunRow;
    }
  };
}
