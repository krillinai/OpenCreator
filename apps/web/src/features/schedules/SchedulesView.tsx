import type {
  CreateScheduleRequest,
  CodexProfileResponse,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import {
  CalendarClock,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../../runtime/errors.js';
import type { ClaweeProject } from '../projects/project-model.js';
import {
  createScheduleRequest,
  createScheduleUpdate,
  ScheduleEditor,
  scheduleDetailToEditorValues,
  type ScheduleEditorErrors,
  type ScheduleEditorValues
} from './ScheduleEditor.js';
import './schedules-view.css';

export type ScheduleViewService = {
  listSchedules(): Promise<ScheduleListResponse>;
  getSchedule(id: string): Promise<ScheduleDetailResponse>;
  createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse>;
  updateSchedule(id: string, input: UpdateScheduleRequest): Promise<ScheduleResponse>;
  deleteSchedule(id: string): Promise<{ deleted: true }>;
  runNow(id: string): Promise<RunScheduleNowResponse>;
  listOperations(id: string, limit?: number): Promise<ScheduleOperationListResponse>;
};

type EditorState =
  | { mode: 'create'; values: ScheduleEditorValues }
  | { mode: 'edit'; scheduleId: string; values: ScheduleEditorValues; loading: boolean };

export type SchedulesViewProps = {
  connected: boolean;
  service: ScheduleViewService | null;
  projects: ClaweeProject[];
  currentProjectId: string;
  profiles?: CodexProfileResponse[];
  defaultTimezone: string;
  pollIntervalMs?: number;
  onOpenRun(runId: string, threadId?: string): void;
  confirmDelete?(schedule: ScheduleResponse): boolean;
};

export function SchedulesView(props: SchedulesViewProps) {
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [actionErrorById, setActionErrorById] = useState<Record<string, string | undefined>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<EditorState>();
  const [editorErrors, setEditorErrors] = useState<ScheduleEditorErrors>({});
  const [saving, setSaving] = useState(false);
  const [latestRun, setLatestRun] = useState<{ runId: string; threadId?: string }>();
  const requestGenerationRef = useRef(0);

  const currentProject = useMemo(
    () => props.projects.find(project => project.id === props.currentProjectId) ?? props.projects[0],
    [props.currentProjectId, props.projects]
  );

  const loadSchedules = useCallback(async (showLoading: boolean) => {
    if (!props.connected || props.service === null) return;
    const generation = ++requestGenerationRef.current;
    if (showLoading) setLoading(true);
    setLoadError(undefined);
    try {
      const response = await props.service.listSchedules();
      if (generation !== requestGenerationRef.current) return;
      setSchedules(response.schedules);
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setLoadError('无法加载计划任务');
    } finally {
      if (generation === requestGenerationRef.current && showLoading) setLoading(false);
    }
  }, [props.connected, props.service]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setEditor(undefined);
    setLatestRun(undefined);
    if (!props.connected || props.service === null) {
      setSchedules([]);
      setLoading(false);
      setLoadError(undefined);
      return;
    }
    void loadSchedules(true);
  }, [loadSchedules, props.connected, props.service]);

  useEffect(() => {
    const intervalMs = props.pollIntervalMs ?? 15_000;
    if (!props.connected || props.service === null || intervalMs <= 0) return;
    const interval = window.setInterval(() => void loadSchedules(false), intervalMs);
    return () => window.clearInterval(interval);
  }, [loadSchedules, props.connected, props.pollIntervalMs, props.service]);

  if (!props.connected || props.service === null) {
    return (
      <section className="schedules-view">
        <div className="schedules-state">
          <CalendarClock size={28} aria-hidden="true" />
          <h2>计划任务暂不可用</h2>
          <p>本地服务连接后可以管理计划任务</p>
        </div>
      </section>
    );
  }

  function openCreateEditor() {
    setEditorErrors({});
    setLatestRun(undefined);
    setEditor({
      mode: 'create',
      values: createDefaultValues(currentProject, props.defaultTimezone)
    });
  }

  async function openEditEditor(schedule: ScheduleResponse) {
    if (props.service === null) return;
    setEditorErrors({});
    setLatestRun(undefined);
    setEditor({
      mode: 'edit',
      scheduleId: schedule.id,
      values: scheduleToLoadingValues(schedule),
      loading: true
    });
    try {
      const detail = await props.service.getSchedule(schedule.id);
      setEditor(current => (
        current?.mode === 'edit' && current.scheduleId === schedule.id
          ? {
              mode: 'edit',
              scheduleId: schedule.id,
              values: scheduleDetailToEditorValues(detail),
              loading: false
            }
          : current
      ));
    } catch (error) {
      setEditorErrors({ form: errorMessage(error, '无法加载计划详情') });
      setEditor(current => (
        current?.mode === 'edit' && current.scheduleId === schedule.id
          ? { ...current, loading: false }
          : current
      ));
    }
  }

  async function saveEditor(values: ScheduleEditorValues) {
    if (props.service === null || editor === undefined) return;
    const validationErrors = validateSchedule(values);
    if (Object.keys(validationErrors).length > 0) {
      setEditorErrors(validationErrors);
      return;
    }

    setSaving(true);
    setEditorErrors({});
    try {
      const saved = editor.mode === 'create'
        ? await props.service.createSchedule(createScheduleRequest(values))
        : await props.service.updateSchedule(editor.scheduleId, createScheduleUpdate(values));
      setSchedules(current => upsertSchedule(current, saved));
      setEditor(undefined);
    } catch (error) {
      setEditorErrors(mapScheduleError(error));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule(schedule: ScheduleResponse) {
    if (props.service === null || busyIds.has(schedule.id)) return;
    const enabled = !schedule.enabled;
    setSchedules(current => replaceSchedule(current, { ...schedule, enabled }));
    setBusy(schedule.id, true);
    clearActionError(schedule.id);
    try {
      const updated = await props.service.updateSchedule(schedule.id, { enabled });
      setSchedules(current => replaceSchedule(current, updated));
    } catch (error) {
      setSchedules(current => replaceSchedule(current, schedule));
      setActionError(schedule.id, errorMessage(error, '无法更新计划状态'));
    } finally {
      setBusy(schedule.id, false);
    }
  }

  async function runSchedule(schedule: ScheduleResponse) {
    if (props.service === null || busyIds.has(schedule.id)) return;
    setBusy(schedule.id, true);
    clearActionError(schedule.id);
    setLatestRun(undefined);
    try {
      const response = await props.service.runNow(schedule.id);
      setSchedules(current => replaceSchedule(current, response.schedule));
      if (response.run !== null) {
        setLatestRun({
          runId: response.run.id,
          ...(response.run.threadId ? { threadId: response.run.threadId } : {})
        });
      } else if (response.queued) {
        setActionError(schedule.id, '本次触发已排队，将在当前运行结束后执行');
      } else if (response.skipped) {
        setActionError(schedule.id, '当前并发策略跳过了本次触发');
      }
    } catch (error) {
      setActionError(schedule.id, errorMessage(error, '无法立即运行计划'));
    } finally {
      setBusy(schedule.id, false);
    }
  }

  async function deleteSchedule(schedule: ScheduleResponse) {
    if (props.service === null || busyIds.has(schedule.id)) return;
    const confirmed = props.confirmDelete?.(schedule)
      ?? window.confirm(`确认删除计划“${schedule.name}”？`);
    if (!confirmed) return;
    setBusy(schedule.id, true);
    clearActionError(schedule.id);
    try {
      await props.service.deleteSchedule(schedule.id);
      setSchedules(current => current.filter(item => item.id !== schedule.id));
      setLatestRun(undefined);
      if (editor?.mode === 'edit' && editor.scheduleId === schedule.id) setEditor(undefined);
    } catch (error) {
      setActionError(schedule.id, errorMessage(error, '无法删除计划'));
    } finally {
      setBusy(schedule.id, false);
    }
  }

  function setBusy(id: string, busy: boolean) {
    setBusyIds(current => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setActionError(id: string, message: string) {
    setActionErrorById(current => ({ ...current, [id]: message }));
  }

  function clearActionError(id: string) {
    setActionErrorById(current => ({ ...current, [id]: undefined }));
  }

  return (
    <section className="schedules-view">
      <div className={`schedules-view__inner${editor ? ' schedules-view__inner--editing' : ''}`}>
        <header className="schedules-view__header">
          <div>
            <h1>计划任务</h1>
            <p>按计划自动执行 Agent 任务，并从运行详情追踪结果。</p>
          </div>
          <button className="schedule-button schedule-button--primary" type="button" onClick={openCreateEditor}>
            <Plus size={16} />
            新建计划
          </button>
        </header>

        {editor ? (
          <ScheduleEditor
            mode={editor.mode}
            initialValues={editor.values}
            projects={props.projects}
            profiles={props.profiles}
            loading={editor.mode === 'edit' && editor.loading}
            saving={saving}
            errors={editorErrors}
            onCancel={() => {
              setEditor(undefined);
              setEditorErrors({});
            }}
            onSubmit={values => void saveEditor(values)}
          />
        ) : loading ? (
          <div className="schedules-state" role="status">
            <LoaderCircle size={24} className="schedule-spin" />
            正在加载计划任务
          </div>
        ) : loadError ? (
          <div className="schedules-state schedules-state--error" role="alert">
            <p>{loadError}</p>
            <button className="schedule-button schedule-button--secondary" type="button" onClick={() => void loadSchedules(true)}>
              <RefreshCw size={16} />
              重新加载
            </button>
          </div>
        ) : schedules.length === 0 ? (
          <div className="schedules-state">
            <CalendarClock size={28} aria-hidden="true" />
            <h2>暂无计划任务</h2>
            <p>创建后，任务会在本机服务运行期间按计划触发。</p>
          </div>
        ) : (
          <ul className="schedules-list">
            {schedules.map(schedule => {
              const busy = busyIds.has(schedule.id);
              const lastStatus = schedule.lastStatus;
              const showLatestRun = latestRun !== undefined && schedule.lastRunId === latestRun.runId;
              return (
                <li className="schedule-card" key={schedule.id}>
                  <div className="schedule-card__main">
                    <div className="schedule-card__title-row">
                      <h2>{schedule.name}</h2>
                      <span className={`schedule-status${schedule.enabled ? ' schedule-status--enabled' : ''}`}>
                        {schedule.enabled ? '已启用' : '已停用'}
                      </span>
                      {lastStatus ? (
                        <span className={`schedule-status schedule-status--${lastStatus}`}>
                          {lastStatusLabel(lastStatus)}
                        </span>
                      ) : null}
                    </div>

                    <dl className="schedule-card__meta">
                      <div>
                        <dt>Cron</dt>
                        <dd><code>{schedule.cron}</code></dd>
                      </div>
                      <div>
                        <dt>时区</dt>
                        <dd>{schedule.timezone}</dd>
                      </div>
                      <div>
                        <dt>项目目录</dt>
                        <dd title={schedule.cwd}>{schedule.cwd}</dd>
                      </div>
                    </dl>

                    {showLatestRun ? (
                      <button
                        className="schedule-card__run-link"
                        type="button"
                        onClick={() => props.onOpenRun(latestRun.runId, latestRun.threadId)}
                      >
                        <ExternalLink size={14} />
                        查看运行
                      </button>
                    ) : schedule.lastRunId ? (
                      <button
                        className="schedule-card__run-link"
                        type="button"
                        onClick={() => props.onOpenRun(schedule.lastRunId!)}
                      >
                        <ExternalLink size={14} />
                        查看上次运行
                      </button>
                    ) : null}

                    {actionErrorById[schedule.id] ? (
                      <p className="schedule-card__error" role="status">{actionErrorById[schedule.id]}</p>
                    ) : null}
                  </div>

                  <div className="schedule-card__actions">
                    <button
                      className="schedule-switch"
                      type="button"
                      role="switch"
                      aria-checked={schedule.enabled}
                      aria-label={`${schedule.enabled ? '停用' : '启用'}${schedule.name}`}
                      disabled={busy}
                      onClick={() => void toggleSchedule(schedule)}
                    />
                    <button
                      className="schedule-icon-button"
                      type="button"
                      aria-label={`立即运行${schedule.name}`}
                      title="立即运行"
                      disabled={busy}
                      onClick={() => void runSchedule(schedule)}
                    >
                      {busy ? <LoaderCircle size={16} className="schedule-spin" /> : <Play size={16} />}
                    </button>
                    <button
                      className="schedule-icon-button"
                      type="button"
                      aria-label={`编辑${schedule.name}`}
                      title="编辑"
                      disabled={busy}
                      onClick={() => void openEditEditor(schedule)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="schedule-icon-button"
                      type="button"
                      aria-label={`删除${schedule.name}`}
                      title="删除"
                      disabled={busy}
                      onClick={() => void deleteSchedule(schedule)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function createDefaultValues(project: ClaweeProject | undefined, timezone: string): ScheduleEditorValues {
  return {
    name: '',
    prompt: '',
    cron: '',
    timezone,
    cwd: project?.cwd ?? '',
    profile: project?.profile ?? 'default',
    model: project?.model ?? '',
    reasoning: (project?.reasoning ?? '') as ScheduleEditorValues['reasoning'],
    sandbox: project?.sandbox === 'danger-full-access' || project?.sandbox === 'workspace-write'
      ? project.sandbox
      : 'workspace-write',
    timeoutMs: '',
    concurrencyPolicy: 'skip',
    misfirePolicy: 'skip',
    enabled: true
  };
}

function scheduleToLoadingValues(schedule: ScheduleResponse): ScheduleEditorValues {
  return {
    name: schedule.name,
    prompt: '',
    cron: schedule.cron,
    timezone: schedule.timezone,
    cwd: schedule.cwd,
    profile: schedule.profile,
    model: schedule.model ?? '',
    reasoning: schedule.reasoning ?? '',
    sandbox: schedule.sandbox,
    timeoutMs: schedule.timeoutMs === null || schedule.timeoutMs === undefined ? '' : String(schedule.timeoutMs),
    concurrencyPolicy: schedule.concurrencyPolicy,
    misfirePolicy: schedule.misfirePolicy,
    enabled: schedule.enabled
  };
}

function validateSchedule(values: ScheduleEditorValues): ScheduleEditorErrors {
  const errors: ScheduleEditorErrors = {};
  if (values.name.trim().length === 0) errors.name = '请输入计划名称';
  if (values.prompt.trim().length === 0) errors.prompt = '请输入执行指令';
  if (values.cron.trim().split(/\s+/).filter(Boolean).length !== 5) {
    errors.cron = 'Cron 表达式需要包含 5 个字段';
  }
  if (values.timezone.trim().length === 0) errors.timezone = '请输入时区';
  if (values.cwd.trim().length === 0) errors.cwd = '请输入项目目录';
  if (values.profile.trim().length === 0) errors.profile = '请输入 Profile';
  if (
    values.timeoutMs.trim().length > 0
    && (!Number.isFinite(Number(values.timeoutMs)) || Number(values.timeoutMs) <= 0)
  ) {
    errors.timeoutMs = '超时必须是大于 0 的毫秒数';
  }
  return errors;
}

function mapScheduleError(error: unknown): ScheduleEditorErrors {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('cwd') || normalized.includes('directory')) {
    return { cwd: '项目目录不存在或无法访问' };
  }
  if (normalized.includes('cron')) return { cron: 'Cron 表达式无效' };
  if (normalized.includes('timezone')) return { timezone: '时区无效' };
  if (normalized.includes('profile')) return { profile: 'Profile 不存在或配置无效' };
  if (normalized.includes('timeout')) return { timeoutMs: '超时配置无效' };
  if (error instanceof ApiClientError) return { form: error.message };
  return { form: '无法保存计划任务' };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function upsertSchedule(current: ScheduleResponse[], schedule: ScheduleResponse): ScheduleResponse[] {
  const index = current.findIndex(item => item.id === schedule.id);
  if (index < 0) return [schedule, ...current];
  return current.map(item => item.id === schedule.id ? schedule : item);
}

function replaceSchedule(current: ScheduleResponse[], schedule: ScheduleResponse): ScheduleResponse[] {
  return current.map(item => item.id === schedule.id ? schedule : item);
}

function lastStatusLabel(status: ScheduleResponse['lastStatus']): string {
  switch (status) {
    case 'succeeded':
      return '上次成功';
    case 'failed':
      return '上次失败';
    case 'canceled':
      return '上次取消';
    case 'running':
      return '正在运行';
    case 'queued':
      return '等待运行';
    case 'skipped':
      return '上次跳过';
    default:
      return '等待首次运行';
  }
}
