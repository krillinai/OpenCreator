import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@clawee/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import {
  SchedulesView,
  type ScheduleViewService,
} from './SchedulesView.js';

describe('SchedulesView', () => {
  it('closes the create menu on outside pointer presses and Escape', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole('button', { name: /创建/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('searchbox', { name: '搜索已安排任务' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /创建/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders a simple searchable list with friendly schedules and status filters', async () => {
    const user = userEvent.setup();
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({
          schedules: [
            schedule(),
            schedule({
              id: 'paused',
              name: '每周回顾',
              cron: '0 16 * * 5',
              enabled: false,
              promptPreviewRedacted: '整理本周工作',
            }),
          ],
        })),
      }),
    });

    expect(await screen.findByRole('heading', { name: '已安排的任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(screen.getByText('每天 18:00')).toBeInTheDocument();
    expect(screen.queryByText('0 18 * * *')).not.toBeInTheDocument();
    expect(screen.getByText('建议')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: '搜索已安排任务' }), '每周');
    expect(screen.getByRole('heading', { name: '每周回顾' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '每日总结' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: '搜索已安排任务' }));
    await user.click(screen.getByRole('button', { name: '已暂停' }));
    expect(screen.getByRole('heading', { name: '每周回顾' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '每日总结' })).not.toBeInTheDocument();
  });

  it('creates a schedule manually with friendly frequency controls', async () => {
    const user = userEvent.setup();
    const createSchedule = vi.fn(async (input: CreateScheduleRequest) => schedule({
      id: 'schedule-created',
      name: input.name,
      cron: input.cron,
      timezone: input.timezone ?? 'Asia/Shanghai',
      enabled: input.enabled ?? true,
      promptPreviewRedacted: input.prompt,
      profile: input.profile ?? 'default',
      cwd: input.cwd ?? '/workspace/current',
      canonicalCwd: input.cwd ?? '/workspace/current',
      model: input.model ?? null,
      reasoning: input.reasoning ?? null,
      sandbox: input.sandbox ?? 'workspace-write',
      timeoutMs: input.timeoutMs ?? null,
      concurrencyPolicy: input.concurrencyPolicy ?? 'skip',
      misfirePolicy: input.misfirePolicy ?? 'skip',
    }));
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [] })),
        createSchedule,
      }),
    });

    await openCreateMenu(user, '手动设置');
    expect(screen.queryByLabelText('Cron 表达式')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'review' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('已安排任务标题'), '每日简报');
    await user.type(screen.getByLabelText('任务内容'), '总结今天的项目进展');
    await user.selectOptions(screen.getByLabelText('重复'), 'weekdays');
    fireEvent.change(screen.getByLabelText('执行时间'), { target: { value: '08:00' } });
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(createSchedule).toHaveBeenCalledWith({
      name: '每日简报',
      cron: '0 8 * * 1-5',
      timezone: 'Asia/Shanghai',
      enabled: true,
      prompt: '总结今天的项目进展',
      profile: 'default',
      cwd: '/workspace/current',
      sandbox: 'workspace-write',
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip',
    });
    expect(await screen.findByRole('heading', { name: '每日简报' })).toBeInTheDocument();
  });

  it('opens Clawee schedule creation in a new conversation', async () => {
    const user = userEvent.setup();
    const onCreateWithClawee = vi.fn();
    renderView({ onCreateWithClawee });

    await openCreateMenu(user, '使用 Clawee 创建');

    expect(onCreateWithClawee).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('使用 Clawee 创建计划任务')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('告诉 Clawee 要安排什么')).not.toBeInTheDocument();
  });

  it('prefills suggested tasks without creating them immediately', async () => {
    const user = userEvent.setup();
    const createSchedule = vi.fn(async () => schedule());
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [] })),
        createSchedule,
      }),
    });

    await user.click(await screen.findByRole('button', { name: /每日简报/ }));
    expect(screen.getByLabelText('已安排任务标题')).toHaveValue('每日简报');
    expect(screen.getByLabelText('重复')).toHaveValue('weekdays');
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it('validates the simple fields and maps daemon errors to project selection', async () => {
    const user = userEvent.setup();
    const createSchedule = vi.fn(async () => {
      throw new ApiClientError({
        status: 422,
        code: 'SCHEDULE_INVALID',
        message: 'cwd must exist: path not found',
      });
    });
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [] })),
        createSchedule,
      }),
    });

    await openCreateMenu(user, '手动设置');
    await user.click(screen.getByRole('button', { name: '创建任务' }));
    expect(screen.getByText('请输入任务标题')).toBeInTheDocument();
    expect(screen.getByText('请描述 Clawee 应该做什么')).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('已安排任务标题'), '目录检查');
    await user.type(screen.getByLabelText('任务内容'), '检查项目状态');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByText('项目目录不存在或无法访问')).toBeInTheDocument();
  });

  it('loads full details, preserves legacy schedules, and saves advanced edits', async () => {
    const user = userEvent.setup();
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ name: input.name ?? '每日总结', enabled: input.enabled ?? true })
    ));
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({
          schedules: [schedule({ cron: '0 9 1 * *' })],
        })),
        getSchedule: vi.fn(async () => scheduleDetail({ cron: '0 9 1 * *' })),
        updateSchedule,
      }),
    });

    await user.click(await screen.findByRole('button', { name: '编辑每日总结' }));
    expect(await screen.findByDisplayValue('完整的每日总结执行指令')).toBeInTheDocument();
    expect(screen.getByLabelText('重复')).toHaveValue('advanced');
    expect(screen.getByText(/旧版高级计划/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('已安排任务标题'));
    await user.type(screen.getByLabelText('已安排任务标题'), '每月总结');
    await user.click(screen.getByText('更多运行设置'));
    await user.selectOptions(screen.getByLabelText('任务重叠时'), 'queue');
    await user.click(screen.getByRole('button', { name: '保存更改' }));

    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      name: '每月总结',
      prompt: '完整的每日总结执行指令',
      cron: '0 9 1 * *',
      concurrencyPolicy: 'queue',
      model: null,
      reasoning: null,
      timeoutMs: null,
    }));
  });

  it('toggles, runs, opens the run, and deletes a schedule', async () => {
    const user = userEvent.setup();
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ enabled: input.enabled ?? true })
    ));
    const runNow = vi.fn(async (): Promise<RunScheduleNowResponse> => ({
      run: { id: 'run-1', threadId: 'thread-1', status: 'queued' },
      schedule: schedule({ lastRunId: 'run-1', lastStatus: 'queued' }),
      skipped: false,
      queued: false,
    }));
    const deleteSchedule = vi.fn(async () => ({ deleted: true as const }));
    const onOpenRun = vi.fn();
    renderView({
      onOpenRun,
      confirmDelete: () => true,
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [schedule()] })),
        updateSchedule,
        runNow,
        deleteSchedule,
      }),
    });

    const toggle = await screen.findByRole('switch', { name: '暂停每日总结' });
    await user.click(toggle);
    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', { enabled: false });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByRole('button', { name: '立即运行每日总结' }));
    expect(runNow).toHaveBeenCalledWith('schedule-1');
    await user.click(await screen.findByRole('button', { name: '查看运行' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-1', 'thread-1');

    await user.click(screen.getByRole('button', { name: '删除每日总结' }));
    expect(deleteSchedule).toHaveBeenCalledWith('schedule-1');
    expect(screen.queryByRole('heading', { name: '每日总结' })).not.toBeInTheDocument();
  });

  it('shows disconnected and load error states', async () => {
    const { rerender } = renderView({ connected: false, service: null });
    expect(screen.getByText('连接本地运行内核后可以创建和管理任务')).toBeInTheDocument();

    rerender(createView({
      service: createService({
        listSchedules: vi.fn(async () => {
          throw new Error('failed');
        }),
      }),
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载已安排的任务');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});

async function openCreateMenu(
  user: ReturnType<typeof userEvent.setup>,
  item: '手动设置' | '使用 Clawee 创建'
) {
  await user.click(await screen.findByRole('button', { name: /创建/ }));
  await user.click(screen.getByRole('menuitem', { name: new RegExp(item) }));
}

function renderView(overrides: Partial<Parameters<typeof createView>[0]> = {}) {
  return render(createView(overrides));
}

function createView(overrides: {
  connected?: boolean;
  service?: ScheduleViewService | null;
  onCreateWithClawee?(): Promise<void> | void;
  onOpenRun?(runId: string, threadId?: string): void;
  confirmDelete?(schedule: ScheduleResponse): boolean;
} = {}) {
  return (
    <SchedulesView
      connected={overrides.connected ?? true}
      service={overrides.service ?? createService()}
      projects={[
        {
          id: 'current',
          name: '当前项目',
          cwd: '/workspace/current',
          sandbox: 'workspace-write',
          profile: 'default',
          model: null,
          reasoning: null,
        },
      ]}
      currentProjectId="current"
      profiles={[
        {
          name: 'review',
          status: 'valid',
          config: {},
          diagnostics: [],
          source: 'review.config.toml',
          codexHomeMode: 'isolated',
        },
      ]}
      defaultTimezone="Asia/Shanghai"
      pollIntervalMs={0}
      onCreateWithClawee={overrides.onCreateWithClawee ?? vi.fn()}
      onOpenRun={overrides.onOpenRun ?? vi.fn()}
      confirmDelete={overrides.confirmDelete}
    />
  );
}

function createService(
  overrides: Partial<ScheduleViewService> = {}
): ScheduleViewService {
  return {
    listSchedules: async () => ({ schedules: [] }),
    getSchedule: async () => scheduleDetail(),
    createSchedule: async () => schedule(),
    updateSchedule: async () => schedule(),
    deleteSchedule: async () => ({ deleted: true }),
    runNow: async () => ({
      run: null,
      schedule: schedule(),
      skipped: true,
      queued: false,
    }),
    listOperations: async () => ({ operations: [] }),
    ...overrides,
  };
}

function schedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'schedule-1',
    name: '每日总结',
    cron: '0 18 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结今天的项目进展',
    profile: 'default',
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'skip',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-13T10:00:00.000Z',
    lastRunAt: '2026-07-12T10:00:00.000Z',
    lastRunId: 'run-previous',
    lastStatus: 'succeeded',
    pendingTrigger: false,
    createdAt: '2026-07-07T00:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    ...overrides,
  };
}

function scheduleDetail(
  overrides: Partial<ScheduleDetailResponse> = {}
): ScheduleDetailResponse {
  return {
    ...schedule(overrides),
    prompt: '完整的每日总结执行指令',
    ...overrides,
  };
}
