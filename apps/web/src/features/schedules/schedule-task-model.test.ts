import type { RunResponse, ScheduleResponse, ThreadResponse } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  initialRunRegistryState,
  runRegistryReducer
} from '../runs/run-registry.js';
import { createScheduleTaskSummaries } from './schedule-task-model.js';

describe('schedule task model', () => {
  it('merges schedule, bound task thread, and current run state without history data', () => {
    const schedule = createSchedule();
    const thread = createThread();
    const runRegistry = runRegistryReducer(initialRunRegistryState, {
      type: 'upsert_run',
      run: createRun()
    });

    expect(createScheduleTaskSummaries([schedule], [thread], runRegistry)).toEqual([
      {
        scheduleId: 'schedule-1',
        name: '每日总结',
        threadId: 'thread-task',
        bindingStatus: 'ready',
        enabled: true,
        nextRunAt: '2026-07-15T01:00:00.000Z',
        lastStatus: 'succeeded',
        pendingTrigger: false,
        currentRunStatus: 'running'
      }
    ]);
  });

  it('marks an old daemon response with an empty thread id for repair without creating a fake thread', () => {
    const malformed = {
      ...createSchedule(),
      threadId: null
    } as unknown as ScheduleResponse;

    expect(
      createScheduleTaskSummaries([malformed], [], initialRunRegistryState)
    ).toEqual([
      expect.objectContaining({
        scheduleId: 'schedule-1',
        threadId: null,
        bindingStatus: 'repair_required',
        bindingIssue: 'missing_thread_id',
        statusMessage: '任务会话需要修复',
        currentRunStatus: null
      })
    ]);
  });

  it('marks a missing bound thread for repair while preserving the reported thread id', () => {
    expect(
      createScheduleTaskSummaries(
        [createSchedule()],
        [],
        initialRunRegistryState
      )
    ).toEqual([
      expect.objectContaining({
        threadId: 'thread-task',
        bindingStatus: 'repair_required',
        bindingIssue: 'thread_not_found',
        statusMessage: '任务会话需要修复'
      })
    ]);
  });

  it('rejects a thread whose purpose or schedule binding does not match', () => {
    const wrongPurpose = createThread({
      purpose: 'conversation',
      scheduleId: undefined
    });
    const wrongSchedule = createThread({ scheduleId: 'schedule-other' });

    expect(
      createScheduleTaskSummaries(
        [createSchedule()],
        [wrongPurpose],
        initialRunRegistryState
      )[0]
    ).toMatchObject({
      bindingStatus: 'repair_required',
      bindingIssue: 'thread_purpose_mismatch'
    });
    expect(
      createScheduleTaskSummaries(
        [createSchedule()],
        [wrongSchedule],
        initialRunRegistryState
      )[0]
    ).toMatchObject({
      bindingStatus: 'repair_required',
      bindingIssue: 'schedule_mismatch'
    });
  });
});

function createSchedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'schedule-1',
    threadId: 'thread-task',
    name: '每日总结',
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结项目进展',
    profile: 'default',
    cwd: '/workspace/project',
    canonicalCwd: '/workspace/project',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'queue',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-15T01:00:00.000Z',
    lastRunAt: '2026-07-14T01:00:00.000Z',
    lastRunId: 'run-previous',
    lastStatus: 'succeeded',
    pendingTrigger: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T01:00:00.000Z',
    ...overrides
  };
}

function createThread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread-task',
    title: '每日总结',
    projectId: null,
    origin: 'opencreator_created',
    codexThreadId: 'codex-thread-task',
    cwd: '/workspace/project',
    canonicalCwd: '/workspace/project',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'schedule_task',
    scheduleId: 'schedule-1',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T01:00:00.000Z',
    archivedAt: null,
    ...overrides
  };
}

function createRun(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    id: 'run-current',
    threadId: 'thread-task',
    codexThreadId: 'codex-thread-task',
    status: 'running',
    ...overrides
  };
}
