import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import {
  CREATOR_ISSUE_UPSERT_SQL,
  createCreatorRepository
} from '../../src/creator/repository.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator issues', () => {
  it('persists safe facts without carrying an old cause into a new occurrence', () => {
    const { db, repository } = createFixture();
    const service = createCreatorIssueService(repository);
    const first = service.capture({
      jobId: 'job-1', code: 'creator_provider_request_failed', source: 'provider',
      publicFacts: { kind: 'rate-limited', provider: 'openai', httpStatus: 429, upstreamCode: 'rate_limit_exceeded' }
    });
    expect(service.get('job-1', first.id)?.publicFacts).toEqual({
      kind: 'rate-limited', provider: 'openai', httpStatus: 429, upstreamCode: 'rate_limit_exceeded'
    });

    const repeated = service.capture({
      jobId: 'job-1', code: 'creator_provider_request_failed', source: 'provider'
    });
    expect(repeated.id).toBe(first.id);
    expect(repeated.publicFacts).toBeUndefined();
    db.close();
  });

  it('drops token-like provider identifiers before persisting an issue', () => {
    const { db, repository } = createFixture();
    const issue = createCreatorIssueService(repository).capture({
      jobId: 'job-1', code: 'creator_provider_request_failed', source: 'provider',
      publicFacts: { kind: 'unknown', provider: 'sk-private-secret', upstreamCode: 'sk-private-secret' }
    });
    expect(issue.publicFacts).toEqual({ kind: 'unknown' });
    db.close();
  });

  it('keeps one id through occurrence, resolution and reopen', () => {
    const { db, repository } = createFixture();
    const service = createCreatorIssueService(repository);
    const first = service.capture({
      jobId: 'job-1',
      code: 'creator_upload_failed',
      source: 'upload',
      operation: 'creator.upload-source',
      fallbackMessage: 'Authorization: Bearer secret at C:\\Users\\Mayn\\video.mp4',
      technicalDetail: 'api_key=secret\n at provider.js:1',
      retryable: true,
      repairActions: [{
        kind: 'retry-operation',
        operationId: 'creator.upload-source',
        requiresConfirmation: false,
        risk: 'normal'
      }]
    });
    const repeated = service.capture({
      jobId: 'job-1',
      code: 'creator_upload_failed',
      source: 'upload',
      operation: 'creator.upload-source'
    });

    expect(repeated.id).toBe(first.id);
    expect(repeated.occurrenceCount).toBe(2);
    expect(JSON.stringify(repeated)).not.toContain('secret');
    expect(JSON.stringify(repeated)).not.toContain('Users');

    const resolving = service.beginResolution({
      jobId: 'job-1',
      issueId: first.id,
      resolutionAttemptId: '550e8400-e29b-41d4-a716-446655440000',
      associationKind: 'endpoint',
      associationId: 'upload-1'
    });
    expect(resolving.status).toBe('resolving');
    const resolved = service.finishResolution({
      jobId: 'job-1',
      issueId: first.id,
      resolutionAttemptId: '550e8400-e29b-41d4-a716-446655440000',
      result: 'succeeded'
    });
    expect(resolved.status).toBe('resolved');

    const reopened = service.capture({
      jobId: 'job-1',
      code: 'creator_upload_failed',
      source: 'upload',
      operation: 'creator.upload-source'
    });
    expect(reopened).toMatchObject({ id: first.id, status: 'open', occurrenceCount: 3 });
    expect(repository.listIssueEvents('job-1').events.map(event => event.kind)).toEqual([
      'occurrence',
      'occurrence',
      'resolving',
      'attempt_succeeded',
      'resolved',
      'reopened'
    ]);
    db.close();
  });

  it('returns only whitelisted aggregate dimensions', () => {
    const { db, repository } = createFixture();
    const service = createCreatorIssueService(repository);
    service.capture({
      jobId: 'job-1',
      code: 'creator_provider_failed',
      source: 'provider',
      fallbackMessage: 'Authorization=secret /Users/private/project provider body {"prompt":"steal"}'
    });
    const rows = repository.aggregateIssueStats('job-1', {
      from: '2026-09-22T00:00:00.000Z',
      to: '2026-09-24T00:00:00.000Z'
    });

    expect(rows).toEqual([{
      code: 'creator_provider_failed',
      source: 'provider',
      status: 'open',
      retryResult: 'none',
      count: 1
    }]);
    expect(Object.keys(rows[0]!)).toEqual(['code', 'source', 'status', 'retryResult', 'count']);
    expect(JSON.stringify(rows)).not.toContain('secret');
    db.close();
  });

  it('uses the production upsert atomically across competing sqlite connections', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-issue-race-'));
    const path = join(tempDir, 'app.sqlite');
    const db = openRuntimeDatabase(path);
    createCreatorRepository(db).createJob({
      projectId: 'project-1',
      templateId: 'video-translation',
      templateVersion: 1,
      status: 'running',
      state: {}
    });
    db.prepare('UPDATE creator_jobs SET id = ?').run('job-1');
    db.close();

    const workerCount = 4;
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const view = new Int32Array(barrier);
    const timestamp = '2026-09-23T00:00:00.000Z';
    const workers = Array.from({ length: workerCount }, (_, index) => runRaceWorker({
      path,
      sql: CREATOR_ISSUE_UPSERT_SQL,
      barrier,
      index,
      timestamp
    }));
    while (Atomics.load(view, 0) < workerCount) Atomics.wait(view, 0, Atomics.load(view, 0), 100);
    Atomics.store(view, 1, 1);
    Atomics.notify(view, 1, workerCount);
    const ids = await Promise.all(workers);

    const verify = new Database(path);
    const row = verify.prepare(`
      SELECT id, occurrence_count AS occurrenceCount FROM creator_issues
    `).get() as { id: string; occurrenceCount: number };
    const issueCount = (verify.prepare('SELECT COUNT(*) AS count FROM creator_issues').get() as { count: number }).count;
    const eventCount = (verify.prepare('SELECT COUNT(*) AS count FROM creator_issue_events').get() as { count: number }).count;
    verify.close();
    expect(new Set(ids)).toEqual(new Set([row.id]));
    expect(issueCount).toBe(1);
    expect(row.occurrenceCount).toBe(workerCount);
    expect(eventCount).toBe(workerCount);
  });

  it('derives one stable legacy issue only while the latest scoped stage run is failed', () => {
    const { db, repository } = createFixture();
    const failed = repository.createStageRun({
      jobId: 'job-1',
      stageId: 'subtitle',
      executor: 'krillinai',
      status: 'failed',
      scopeKey: null
    });
    repository.updateStageRun({
      id: failed.id,
      status: 'failed',
      errorCode: 'creator_translation_output_language_mismatch',
      errorMessage: 'raw legacy provider response must stay private'
    });

    const first = repository.getJob('job-1')!.issues!;
    const second = repository.getJob('job-1')!.issues!;
    expect(first).toEqual(second);
    expect(first).toMatchObject([{
      id: expect.stringMatching(/^legacy_/),
      source: 'output-validator',
      status: 'open',
      stageRunId: failed.id
    }]);
    expect(JSON.stringify(first)).not.toContain('raw legacy provider response');
    expect(repository.getIssue('job-1', first[0]!.id)).toEqual(first[0]);

    repository.createStageRun({
      jobId: 'job-1',
      stageId: 'subtitle',
      executor: 'krillinai',
      status: 'succeeded',
      scopeKey: null
    });
    expect(repository.getJob('job-1')!.issues).toEqual([]);
    db.close();
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-issues-'));
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  let sequence = 0;
  const repository = createCreatorRepository(db, {
    idFactory: prefix => `${prefix}_${++sequence}`,
    now: () => '2026-09-23T00:00:00.000Z'
  });
  repository.createJob({
    projectId: 'project-1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: 'running',
    state: {}
  });
  db.prepare('UPDATE creator_jobs SET id = ?').run('job-1');
  return { db, repository };
}

function runRaceWorker(input: {
  path: string;
  sql: string;
  barrier: SharedArrayBuffer;
  index: number;
  timestamp: string;
}): Promise<string> {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require('better-sqlite3');
    const db = new Database(workerData.path);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 10000');
    const barrier = new Int32Array(workerData.barrier);
    Atomics.add(barrier, 0, 1);
    Atomics.notify(barrier, 0, 1);
    Atomics.wait(barrier, 1, 0);
    const result = db.transaction(() => {
      const row = db.prepare(workerData.sql).get({
        id: 'candidate-' + workerData.index,
        jobId: 'job-1',
        diagnosticId: 'OC-RACE000' + workerData.index,
        code: 'creator_race', source: 'api', category: 'execution', severity: 'error',
        operation: 'creator.race', stageId: null, stageRunId: null, scopeKey: null,
        summaryKey: 'issue.execution', summaryParamsJson: '{}',
        fallbackMessage: 'Operation failed.', publicFactsJson: null, technicalDetail: null, retryable: 0,
        repairActionsJson: '[]', fingerprint: 'same-fingerprint', timestamp: workerData.timestamp
      });
      db.prepare('INSERT INTO creator_issue_events (id, issue_id, kind, retry_result, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('event-' + workerData.index, row.id, row.last_event_kind, row.last_retry_result, workerData.timestamp);
      return row.id;
    })();
    db.close();
    parentPort.postMessage({ id: result });
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: input });
    worker.once('message', message => resolve((message as { id: string }).id));
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`Issue race worker exited with ${code}`));
    });
  });
}
