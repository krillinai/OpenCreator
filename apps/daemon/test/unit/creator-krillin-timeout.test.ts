import { describe, expect, it, vi } from 'vitest';
import { enforceKrillinDeadlines } from '../../src/creator/krillin/adapter.js';

describe('KrillinAI stage deadlines', () => {
  it('cancels a task after the inactivity deadline', async () => {
    const cancelTask = vi.fn(async () => task());
    await expect(enforceKrillinDeadlines({
      client: {
        health: async () => ({ ok: true, generation: 1 }),
        cancelTask
      },
      taskId: 'task_1',
      startedAt: 0,
      lastActivityAt: 0,
      now: () => 180_000,
      inactivityTimeoutMs: 180_000,
      stageTimeoutMs: 3_600_000
    })).rejects.toMatchObject({ code: 'creator_stage_inactivity_timeout' });
    expect(cancelTask).toHaveBeenCalledWith('task_1');
  });

  it('does not time out while new events keep the task active', async () => {
    const cancelTask = vi.fn(async () => task());
    await expect(enforceKrillinDeadlines({
      client: {
        health: async () => ({ ok: true, generation: 1 }),
        cancelTask
      },
      taskId: 'task_1',
      startedAt: 0,
      lastActivityAt: 179_999,
      now: () => 180_000,
      inactivityTimeoutMs: 180_000,
      stageTimeoutMs: 3_600_000
    })).resolves.toBeUndefined();
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('enforces the total stage duration even when activity is recent', async () => {
    const cancelTask = vi.fn(async () => task());
    await expect(enforceKrillinDeadlines({
      client: {
        health: async () => ({ ok: true, generation: 1 }),
        cancelTask
      },
      taskId: 'task_1',
      startedAt: 0,
      lastActivityAt: 3_599_999,
      now: () => 3_600_000,
      inactivityTimeoutMs: 180_000,
      stageTimeoutMs: 3_600_000
    })).rejects.toMatchObject({ code: 'creator_stage_timeout' });
    expect(cancelTask).toHaveBeenCalledWith('task_1');
  });
});

function task() {
  return {
    id: 'task_1',
    jobId: 'job_1',
    stageRunId: 'stage_1',
    stageType: 'subtitle' as const,
    status: 'canceled' as const,
    lastEventSeq: 1,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}
