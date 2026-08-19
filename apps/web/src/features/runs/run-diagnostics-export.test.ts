import type { RunDiagnosticsResponse } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { serializeRunDiagnosticsBundle } from './run-diagnostics-export.js';

describe('run diagnostics export', () => {
  it('keeps the safe schedule trace in the downloaded bundle', () => {
    const diagnostics: RunDiagnosticsResponse = {
      runId: 'run_schedule',
      files: [{ name: 'meta.json', content: '{"prompt":"[REDACTED]"}' }],
      warnings: ['Diagnostics are redacted on a best-effort basis.'],
      codexStatusSnapshot: {
        codexBin: 'codex',
        codexVersion: 'test',
        codexHome: '/tmp/codex-home',
        codexHomeMode: 'isolated',
        codexHomeSource: 'isolated',
        codexHomeWritable: true,
        capabilities: {},
        diagnostics: []
      },
      scheduleTrace: {
        scheduleId: 'sch_1',
        threadId: 'thread_1',
        runId: 'run_schedule',
        triggerType: 'run_now',
        actorType: 'agent',
        actorRunId: 'run_actor',
        scheduledAt: '2026-07-14T09:00:00.000Z',
        startedAt: '2026-07-14T09:00:01.000Z',
        endedAt: '2026-07-14T09:00:03.000Z',
        status: 'succeeded',
        queueReason: null,
        errorCode: null,
        events: [
          {
            type: 'SCHEDULE_TRIGGERED',
            occurredAt: '2026-07-14T09:00:00.000Z',
            operationId: 'schop_1'
          },
          {
            type: 'SCHEDULE_RUN_COMPLETED',
            occurredAt: '2026-07-14T09:00:03.000Z'
          }
        ]
      }
    };

    const bundle = JSON.parse(serializeRunDiagnosticsBundle(diagnostics)) as {
      scheduleTrace?: unknown;
    };

    expect(bundle.scheduleTrace).toEqual(diagnostics.scheduleTrace);
    expect(JSON.stringify(bundle.scheduleTrace)).not.toMatch(/prompt|token|result/i);
  });
});
