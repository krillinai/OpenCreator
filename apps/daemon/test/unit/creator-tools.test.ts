import type { CreatorJob } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  createCreatorToolDefinitions,
  createCreatorToolOperations
} from '../../src/agent-tools/creator-tools.js';

describe('creator tools', () => {
  it('waits for a stage terminal state and returns the latest context', async () => {
    let current = job('running');
    const build = vi.fn((value: CreatorJob) => ({
      jobId: value.id,
      revision: value.revision
    }));
    const operations = createCreatorToolOperations({
      service: { getJob: () => current } as never,
      dispatcher: {} as never,
      contextBuilder: { build } as never,
      stagePollIntervalMs: 1,
      stageWaitTimeoutMs: 50
    });

    const waiting = operations.waitForStage(current.id, 'stage_1');
    current = job('succeeded', 2);
    const result = await waiting;

    expect(result).toEqual({
      timedOut: false,
      context: { jobId: 'job_1', revision: 2 }
    });
    expect(build).toHaveBeenCalledWith(current);
  });

  it('routes the stage wait tool through the bound internal endpoint', async () => {
    const request = vi.fn(async () => ({ timedOut: false }));
    const definitions = createCreatorToolDefinitions({ request });

    await definitions.creator_wait_for_stage.execute({
      stageRunId: 'stage_1',
      timeoutSeconds: 30
    });

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/internal/agent-tools/creator/stages/wait',
      body: {
        stageRunId: 'stage_1',
        timeoutSeconds: 30
      }
    });
  });
});

function job(status: CreatorJob['stages'][number]['status'], revision = 1): CreatorJob {
  return {
    id: 'job_1',
    projectId: 'project_1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: status === 'running' ? 'running' : 'completed',
    revision,
    presetOrigin: null,
    state: {},
    agentThreadId: null,
    stages: [{
      id: 'stage_1',
      jobId: 'job_1',
      stageId: 'render-horizontal',
      executor: 'krillinai',
      status,
      dispatchStatus: status === 'running' ? 'claimed' : 'finished',
      claimOwner: status === 'running' ? 'scheduler_1' : null,
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: 'stage_1',
      progress: {},
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-09-03T00:00:00.000Z',
      finishedAt: status === 'running' ? null : '2026-09-03T00:00:01.000Z'
    }],
    artifacts: [],
    activities: [],
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:01.000Z'
  };
}
