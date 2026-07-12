import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import {
  SchedulesView,
  type ScheduleViewService
} from './SchedulesView.js';

describe('SchedulesView', () => {
  it('loads schedules and renders operational status', async () => {
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [schedule()] }))
      })
    });

    expect(await screen.findByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(screen.getByText('0 18 * * *')).toBeInTheDocument();
    expect(screen.getByText('Asia/Shanghai')).toBeInTheDocument();
    expect(screen.getByText('/workspace/current')).toBeInTheDocument();
    expect(screen.getByText('已启用')).toBeInTheDocument();
    expect(screen.getByText('上次成功')).toBeInTheDocument();
  });

  it('creates a schedule with current project defaults', async () => {
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
      misfirePolicy: input.misfirePolicy ?? 'skip'
    }));
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [] })),
        createSchedule
      })
    });

    await user.click(await screen.findByRole('button', { name: '新建计划' }));
    expect(screen.getByRole('option', { name: 'review' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('名称'), '每日总结');
    await user.type(screen.getByLabelText('执行指令'), '总结今天的项目进展');
    await user.type(screen.getByLabelText('Cron 表达式'), '0 18 * * *');
    await user.click(screen.getByRole('button', { name: '保存计划' }));

    expect(createSchedule).toHaveBeenCalledWith({
      name: '每日总结',
      cron: '0 18 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      prompt: '总结今天的项目进展',
      profile: 'default',
      cwd: '/workspace/current',
      sandbox: 'workspace-write',
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip'
    });
    expect(await screen.findByRole('heading', { name: '每日总结' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: '新建计划任务' })).not.toBeInTheDocument();
  });

  it('validates fields locally and maps daemon errors to the matching field', async () => {
    const user = userEvent.setup();
    const createSchedule = vi.fn(async () => {
      throw new ApiClientError({
        status: 422,
        code: 'SCHEDULE_INVALID',
        message: 'cwd must exist: path not found'
      });
    });
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [] })),
        createSchedule
      })
    });

    await user.click(await screen.findByRole('button', { name: '新建计划' }));
    await user.click(screen.getByRole('button', { name: '保存计划' }));
    expect(screen.getByText('请输入计划名称')).toBeInTheDocument();
    expect(screen.getByText('请输入执行指令')).toBeInTheDocument();
    expect(screen.getByText('Cron 表达式需要包含 5 个字段')).toBeInTheDocument();
    expect(createSchedule).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('名称'), '目录检查');
    await user.type(screen.getByLabelText('执行指令'), '检查项目状态');
    await user.type(screen.getByLabelText('Cron 表达式'), '0 9 * * *');
    await user.clear(screen.getByLabelText('项目目录'));
    await user.type(screen.getByLabelText('项目目录'), '/missing/workspace');
    await user.click(screen.getByRole('button', { name: '保存计划' }));

    expect(await screen.findByText('项目目录不存在或无法访问')).toBeInTheDocument();
    expect(screen.getByLabelText('项目目录')).toHaveAttribute('aria-invalid', 'true');
  });

  it('loads full schedule details and saves edits', async () => {
    const user = userEvent.setup();
    const updateSchedule = vi.fn(async (_id: string, input: UpdateScheduleRequest) => (
      schedule({ name: input.name ?? '每日总结', enabled: input.enabled ?? true })
    ));
    renderView({
      service: createService({
        listSchedules: vi.fn(async () => ({ schedules: [schedule()] })),
        getSchedule: vi.fn(async () => scheduleDetail()),
        updateSchedule
      })
    });

    await user.click(await screen.findByRole('button', { name: '编辑每日总结' }));
    expect(await screen.findByDisplayValue('完整的每日总结执行指令')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('名称'));
    await user.type(screen.getByLabelText('名称'), '工作日总结');
    await user.selectOptions(screen.getByLabelText('并发策略'), 'queue');
    await user.click(screen.getByRole('button', { name: '保存计划' }));

    expect(updateSchedule).toHaveBeenCalledWith('schedule-1', expect.objectContaining({
      name: '工作日总结',
      prompt: '完整的每日总结执行指令',
      concurrencyPolicy: 'queue',
      model: null,
      reasoning: null,
      timeoutMs: null
    }));
    expect(await screen.findByRole('heading', { name: '工作日总结' })).toBeInTheDocument();
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
      queued: false
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
        deleteSchedule
      })
    });

    const toggle = await screen.findByRole('switch', { name: '停用每日总结' });
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
    expect(screen.getByText('本地服务连接后可以管理计划任务')).toBeInTheDocument();

    rerender(createView({
      service: createService({
        listSchedules: vi.fn(async () => {
          throw new Error('failed');
        })
      })
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载计划任务');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});

function renderView(overrides: Partial<Parameters<typeof createView>[0]> = {}) {
  return render(createView(overrides));
}

function createView(overrides: {
  connected?: boolean;
  service?: ScheduleViewService | null;
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
          reasoning: null
        }
      ]}
      currentProjectId="current"
      profiles={[
        {
          name: 'review',
          status: 'valid',
          config: {},
          diagnostics: [],
          source: 'review.config.toml',
          codexHomeMode: 'isolated'
        }
      ]}
      defaultTimezone="Asia/Shanghai"
      pollIntervalMs={0}
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
      queued: false
    }),
    listOperations: async () => ({ operations: [] }),
    ...overrides
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
    ...overrides
  };
}

function scheduleDetail(): ScheduleDetailResponse {
  return {
    ...schedule(),
    prompt: '完整的每日总结执行指令'
  };
}
