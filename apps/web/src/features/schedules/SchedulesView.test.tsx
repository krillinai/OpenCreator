import type {
  CreateScheduleRequest,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@opencreator/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import {
  SchedulesView,
  type ScheduleViewService,
} from './SchedulesView.js';

describe('SchedulesView', () => {
  it('opens the manual editor directly without a OpenCreator creation menu', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(await screen.findByRole('button', { name: /创建/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('使用 OpenCreator 创建')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '创建定时任务' })).toBeInTheDocument();
    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('描述')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '执行频率' })).toBeInTheDocument();
    expect(screen.getByLabelText('任务内容')).toHaveAttribute(
      'placeholder',
      '描述需要帮你做什么...'
    );
    expect(screen.queryByRole('heading', { name: '详情' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('定时任务标题')).toHaveAttribute('placeholder', '输入任务标题');
    expect(screen.getByRole('heading', { name: '请选择访问权限' })).toBeInTheDocument();
    expect(screen.getByText('请选择访问权限').closest('details')).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '创建定时任务' })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: '定时任务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(screen.getByText('每天 18:00')).toBeInTheDocument();
    expect(screen.queryByText('0 18 * * *')).not.toBeInTheDocument();
    expect(screen.getByText('建议')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: '搜索定时任务' }), '每周');
    expect(screen.getByRole('heading', { name: '每周回顾' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '每日总结' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: '搜索定时任务' }));
    await user.click(screen.getByRole('button', { name: '已暂停' }));
    expect(screen.getByRole('heading', { name: '每周回顾' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '每日总结' })).not.toBeInTheDocument();
  });

  it('creates a schedule manually with friendly frequency controls', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    const onScheduleChanged = vi.fn();
    const createSchedule = vi.fn(async (input: CreateScheduleRequest) => schedule({
      id: 'schedule-created',
      threadId: 'thread-created',
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
      onOpenTask,
      onScheduleChanged,
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [] })),
        createSchedule,
      }),
    });

    await openCreateEditor(user);
    expect(screen.queryByLabelText('Cron 表达式')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('运行配置')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('项目')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('推理')).not.toBeInTheDocument();
    expect(screen.queryByText('运行于')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('时区')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('最长运行分钟')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('任务重叠时')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('定时任务标题'), '每日简报');
    await user.type(screen.getByLabelText('任务内容'), '总结今天的项目进展');
    await user.selectOptions(screen.getByLabelText('重复'), 'weekdays');
    await user.click(screen.getByRole('button', { name: '执行时间' }));
    expect(screen.getByRole('dialog', { name: '选择执行时间' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '小时 08' }));
    await user.click(screen.getByRole('option', { name: '分钟 00' }));
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
    expect(onScheduleChanged).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-created',
      threadId: 'thread-created'
    }));
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '创建定时任务' })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('定时任务标题')).toHaveValue('每日简报');
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

    await openCreateEditor(user);
    await user.click(screen.getByRole('button', { name: '创建任务' }));
    expect(screen.getByText('请输入任务标题')).toBeInTheDocument();
    expect(screen.getByText('请描述需要帮你做什么')).toBeInTheDocument();
    expect(screen.getByLabelText('定时任务标题')).toHaveFocus();
    expect(createSchedule).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('定时任务标题'), '目录检查');
    await user.type(screen.getByLabelText('任务内容'), '检查项目状态');
    await user.click(screen.getByRole('button', { name: '创建任务' }));

    expect(await screen.findByText('项目目录不存在或无法访问')).toBeInTheDocument();
  });

  it('loads full details, preserves legacy schedules, and saves advanced edits', async () => {
    const user = userEvent.setup();
    const onScheduleChanged = vi.fn();
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ name: input.name ?? '每日总结', enabled: input.enabled ?? true })
    ));
    renderView({
      onScheduleChanged,
      service: createService({
        listSchedules: vi.fn(async () => ({
          schedules: [schedule({ cron: '0 9 1 * *' })],
        })),
        getSchedule: vi.fn(async () => scheduleDetail({
          cron: '0 9 1 * *',
          profile: 'review',
          model: 'gpt-5.6',
          reasoning: 'high',
          timeoutMs: 120_000,
          concurrencyPolicy: 'queue',
        })),
        updateSchedule,
      }),
    });

    await user.click(await screen.findByRole('button', { name: '编辑每日总结' }));
    expect(await screen.findByText('编辑定时任务')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('完整的每日总结执行指令')).toBeInTheDocument();
    expect(screen.getByLabelText('重复')).toHaveValue('advanced');
    expect(screen.getByText(/旧版高级计划/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('定时任务标题'));
    await user.type(screen.getByLabelText('定时任务标题'), '每月总结');
    await user.click(screen.getByRole('button', { name: '保存更改' }));

    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      name: '每月总结',
      prompt: '完整的每日总结执行指令',
      cron: '0 9 1 * *',
      concurrencyPolicy: 'queue',
      profile: 'review',
      model: 'gpt-5.6',
      reasoning: 'high',
      timeoutMs: 120_000,
    }));
    expect(onScheduleChanged).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-1',
      name: '每月总结'
    }));
  });

  it('opens the targeted schedule editor from an external task action', async () => {
    const getSchedule = vi.fn(async () => scheduleDetail());
    renderView({
      editScheduleId: 'schedule-1',
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [schedule()] })),
        getSchedule
      })
    });

    expect(await screen.findByDisplayValue('完整的每日总结执行指令')).toBeInTheDocument();
    expect(getSchedule).toHaveBeenCalledWith('schedule-1');
  });

  it('opens task titles and previous runs in the bound task thread', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    renderView({
      onOpenTask,
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [schedule()] })),
      }),
    });

    await user.click(await screen.findByRole('button', { name: '打开任务会话 每日总结' }));
    expect(onOpenTask).toHaveBeenLastCalledWith('thread-schedule-1');

    await user.click(screen.getByRole('button', { name: '查看上次运行' }));
    expect(onOpenTask).toHaveBeenLastCalledWith('thread-schedule-1', 'run-previous');
  });

  it('toggles, starts a run in the task thread, and deletes a schedule', async () => {
    const user = userEvent.setup();
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ enabled: input.enabled ?? true })
    ));
    const onRunNow = vi.fn(async (_schedule: ScheduleResponse): Promise<void> => undefined);
    const onScheduleChanged = vi.fn();
    const onScheduleDeleted = vi.fn();
    const deleteSchedule = vi.fn(async () => ({ deleted: true as const }));
    renderView({
      onRunNow,
      onScheduleChanged,
      onScheduleDeleted,
      confirmDelete: () => true,
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [schedule()] })),
        updateSchedule,
        deleteSchedule,
      }),
    });

    const toggle = await screen.findByRole('switch', { name: '暂停每日总结' });
    await user.click(toggle);
    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', { enabled: false });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(onScheduleChanged).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-1',
      enabled: false
    }));

    await user.click(screen.getByRole('button', { name: '立即运行每日总结' }));
    expect(onRunNow).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-1',
      threadId: 'thread-schedule-1'
    }));

    await user.click(screen.getByRole('button', { name: '删除每日总结' }));
    expect(deleteSchedule).toHaveBeenCalledWith('schedule-1');
    expect(onScheduleDeleted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'schedule-1',
      threadId: 'thread-schedule-1'
    }));
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
    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载定时任务');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});

async function openCreateEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /创建/ }));
}

function renderView(overrides: Partial<Parameters<typeof createView>[0]> = {}) {
  return render(createView(overrides));
}

function createView(overrides: {
  connected?: boolean;
  service?: ScheduleViewService | null;
  editScheduleId?: string;
  onOpenTask?(threadId: string, runId?: string): void;
  onRunNow?(schedule: ScheduleResponse): Promise<void> | void;
  onScheduleChanged?(schedule: ScheduleResponse): void;
  onScheduleDeleted?(schedule: ScheduleResponse): void;
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
      editScheduleId={overrides.editScheduleId}
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
      onOpenTask={overrides.onOpenTask ?? vi.fn()}
      onRunNow={overrides.onRunNow ?? vi.fn()}
      onScheduleChanged={overrides.onScheduleChanged ?? vi.fn()}
      onScheduleDeleted={overrides.onScheduleDeleted ?? vi.fn()}
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
    listOperations: async () => ({ operations: [] }),
    ...overrides,
  };
}

function schedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: 'schedule-1',
    threadId: 'thread-schedule-1',
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
