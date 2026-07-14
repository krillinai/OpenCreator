import type { TaskItem } from '@clawee/protocol';
import { describe, expect, it } from 'vitest';
import {
  collectTaskTransitions,
  createTaskNotification,
  shouldSendSystemNotification
} from './task-monitor.js';

function createTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'run_1',
    runId: 'run_1',
    threadId: 'thread_1',
    title: '整理发布说明',
    status: 'running',
    runStatus: 'running',
    cwd: '/workspace',
    profile: 'default',
    createdBy: 'api',
    submissionMode: 'enqueue',
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:01:00.000Z',
    ...overrides
  };
}

describe('task monitor', () => {
  it('uses the first snapshot as a silent baseline', () => {
    const result = collectTaskTransitions(new Map(), [
      createTask({ status: 'succeeded', runStatus: 'succeeded' })
    ], false);

    expect(result.transitions).toEqual([]);
    expect(result.statuses.get('run_1')).toBe('succeeded');
  });

  it('reports only actionable or terminal status transitions after the baseline', () => {
    const previous = new Map<string, TaskItem['status']>([
      ['run_1', 'running'],
      ['run_2', 'queued']
    ]);
    const result = collectTaskTransitions(previous, [
      createTask({ status: 'succeeded', runStatus: 'succeeded' }),
      createTask({
        id: 'run_2',
        runId: 'run_2',
        status: 'running',
        runStatus: 'running'
      }),
      createTask({
        id: 'run_3',
        runId: 'run_3',
        status: 'waiting_approval',
        runStatus: 'running'
      })
    ], true);

    expect(result.transitions.map(task => task.id)).toEqual(['run_1', 'run_3']);
  });

  it('creates concise Chinese notification copy for each transition', () => {
    expect(createTaskNotification(
      createTask({ status: 'failed', runStatus: 'failed', errorMessage: '模型连接失败' })
    )).toEqual({
      title: '任务失败',
      body: '整理发布说明：模型连接失败'
    });
  });

  it('uses reminder copy for completed scheduled tasks', () => {
    expect(createTaskNotification(
      createTask({
        createdBy: 'schedule',
        status: 'succeeded',
        runStatus: 'succeeded',
        title: '喝水提醒',
        cwd: '/workspace'
      })
    )).toEqual({
      title: '已安排提醒',
      body: '喝水提醒'
    });
  });

  it('suppresses system notifications only for the visible current conversation', () => {
    const task = createTask();

    expect(shouldSendSystemNotification(task, 'conversation', 'thread_1')).toBe(false);
    expect(shouldSendSystemNotification(task, 'tasks', 'thread_1')).toBe(true);
    expect(shouldSendSystemNotification(task, 'conversation', 'thread_2')).toBe(true);
  });
});
