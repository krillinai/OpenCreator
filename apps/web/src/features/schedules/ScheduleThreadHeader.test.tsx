import type {
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OpenCreatorProject } from '../projects/project-model.js';
import type { ScheduleSidebarTaskStatus } from '../shell/sidebar-task-model.js';
import { ScheduleThreadHeader } from './ScheduleThreadHeader.js';

describe('ScheduleThreadHeader', () => {
  it.each([
    ['idle', '已启用'],
    ['running', '运行中'],
    ['queued', '已排队'],
    ['waiting_approval', '等待审批'],
    ['failed', '上次失败'],
    ['paused', '已暂停'],
  ] satisfies Array<[ScheduleSidebarTaskStatus, string]>)(
    'renders the %s task status',
    (status, label) => {
      renderHeader({ status });

      expect(screen.getByRole('status', { name: '任务状态' })).toHaveTextContent(label);
      if (status === 'idle') {
        expect(screen.getByText('下次 7/15 09:00')).toBeInTheDocument();
      }
    }
  );

  it('runs and pauses a task while keeping every action disabled during requests', async () => {
    const user = userEvent.setup();
    const runNow = createDeferred<void>();
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ enabled: input.enabled ?? true })
    ));
    const onScheduleChanged = vi.fn();
    renderHeader({
      onRunNow: vi.fn(() => runNow.promise),
      onScheduleChanged,
      service: createService({ updateSchedule }),
    });

    await user.click(screen.getByRole('button', { name: '立即运行任务' }));
    expect(screen.getByRole('button', { name: '立即运行任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '暂停任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑任务' })).toBeDisabled();
    expect(screen.getByRole('status', { name: '任务操作状态' })).toHaveTextContent('正在启动');

    runNow.resolve();
    expect(await screen.findByRole('button', { name: '立即运行任务' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '暂停任务' }));
    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', { enabled: false });
    expect(onScheduleChanged).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-1',
      enabled: false,
    }));
  });

  it('loads the existing schedule into ScheduleEditor and saves the update', async () => {
    const user = userEvent.setup();
    const getSchedule = vi.fn(async () => scheduleDetail());
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ name: input.name ?? '每日总结' })
    ));
    const onScheduleChanged = vi.fn();
    renderHeader({
      onScheduleChanged,
      service: createService({ getSchedule, updateSchedule }),
    });

    await user.click(screen.getByRole('button', { name: '编辑任务' }));

    expect(getSchedule).toHaveBeenCalledWith('schedule-1');
    const dialog = await screen.findByRole('dialog', { name: '编辑任务 每日总结' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('编辑定时任务')).toBeInTheDocument();
    expect(dialog.parentElement).toHaveClass('schedule-thread-editor-backdrop');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    await user.clear(screen.getByLabelText('定时任务标题'));
    await user.type(screen.getByLabelText('定时任务标题'), '每周总结');
    await user.click(screen.getByRole('button', { name: '保存更改' }));

    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      name: '每周总结',
      prompt: '完整执行指令',
      cron: '0 9 * * *',
    }));
    expect(onScheduleChanged).toHaveBeenCalledWith(expect.objectContaining({
      name: '每周总结',
    }));
    expect(screen.queryByRole('dialog', { name: '编辑任务 每日总结' })).not.toBeInTheDocument();
  });

  it('restores a paused task and settles errors without leaving actions disabled', async () => {
    const user = userEvent.setup();
    const updateSchedule = vi.fn(async () => {
      throw new Error('更新失败');
    });
    renderHeader({
      schedule: schedule({ enabled: false }),
      status: 'paused',
      service: createService({ updateSchedule }),
    });

    await user.click(screen.getByRole('button', { name: '恢复任务' }));

    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', { enabled: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('更新失败');
    expect(screen.getByRole('button', { name: '恢复任务' })).toBeEnabled();
  });
});

function renderHeader(overrides: {
  schedule?: ScheduleResponse;
  status?: ScheduleSidebarTaskStatus;
  service?: ReturnType<typeof createService>;
  onRunNow?(schedule: ScheduleResponse): Promise<void> | void;
  onScheduleChanged?(schedule: ScheduleResponse): void;
} = {}) {
  return render(
    <ScheduleThreadHeader
      schedule={overrides.schedule ?? schedule()}
      status={overrides.status ?? 'idle'}
      nextRunLabel="下次 7/15 09:00"
      service={overrides.service ?? createService()}
      projects={projects}
      profiles={[]}
      onRunNow={overrides.onRunNow ?? vi.fn()}
      onScheduleChanged={overrides.onScheduleChanged ?? vi.fn()}
    />
  );
}

function createService(overrides: {
  getSchedule?(id: string): Promise<ScheduleDetailResponse>;
  updateSchedule?(id: string, input: UpdateScheduleRequest): Promise<ScheduleResponse>;
} = {}) {
  return {
    getSchedule: overrides.getSchedule ?? (async () => scheduleDetail()),
    updateSchedule: overrides.updateSchedule ?? (async () => schedule()),
  };
}

function schedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'schedule-1',
    threadId: 'thread-schedule-1',
    name: '每日总结',
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结项目进展',
    profile: 'default',
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
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
    ...overrides,
  };
}

function scheduleDetail(
  overrides: Partial<ScheduleDetailResponse> = {}
): ScheduleDetailResponse {
  return {
    ...schedule(overrides),
    prompt: '完整执行指令',
    ...overrides,
  };
}

const projects: OpenCreatorProject[] = [
  {
    id: 'current',
    name: '当前项目',
    cwd: '/workspace/current',
    sandbox: 'workspace-write',
    profile: 'default',
    model: null,
    reasoning: null,
  },
];

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(nextResolve => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
