import type {
  CreateScheduleRequest,
  CodexProfileResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@opencreator/protocol';
import {
  Bell,
  CalendarClock,
  CirclePlay,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { ApiClientError } from '../../runtime/errors.js';
import type { OpenCreatorProject } from '../projects/project-model.js';
import {
  createScheduleRequest,
  createScheduleUpdate,
  ScheduleEditor,
  scheduleDetailToEditorValues,
  scheduleResponseToEditorValues,
  type ScheduleEditorErrors,
  type ScheduleEditorValues,
  validateScheduleEditorValues,
} from './ScheduleEditor.js';
import {
  defaultScheduleFrequency,
  formatScheduleFrequency,
  formatScheduleNextRun,
  scheduleFrequencyToCron,
  type ScheduleFrequency,
} from './schedule-frequency.js';
import './schedules-view.css';

export type ScheduleViewService = {
  listSchedules(): Promise<ScheduleListResponse>;
  getSchedule(id: string): Promise<ScheduleDetailResponse>;
  createSchedule(input: CreateScheduleRequest): Promise<ScheduleResponse>;
  updateSchedule(id: string, input: UpdateScheduleRequest): Promise<ScheduleResponse>;
  deleteSchedule(id: string): Promise<{ deleted: true }>;
  listOperations(id: string, limit?: number): Promise<ScheduleOperationListResponse>;
};

type EditorState =
  | {
      mode: 'create';
      source: 'manual' | 'suggestion';
      values: ScheduleEditorValues;
    }
  | {
      mode: 'edit';
      scheduleId: string;
      values: ScheduleEditorValues;
      loading: boolean;
    };

type ScheduleFilter = 'all' | 'enabled' | 'paused';

export type SchedulesViewProps = {
  connected: boolean;
  service: ScheduleViewService | null;
  projects: OpenCreatorProject[];
  currentProjectId: string;
  editScheduleId?: string;
  profiles?: CodexProfileResponse[];
  defaultTimezone: string;
  pollIntervalMs?: number;
  onOpenTask(threadId: string, runId?: string): void;
  onRunNow(schedule: ScheduleResponse): Promise<void> | void;
  onScheduleChanged(schedule: ScheduleResponse): void;
  onScheduleDeleted(schedule: ScheduleResponse): void;
  confirmDelete?(schedule: ScheduleResponse): boolean;
};

export function SchedulesView(props: SchedulesViewProps) {
  const confirm = useConfirmDialog();
  const [schedules, setSchedules] = useState<ScheduleResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [actionErrorById, setActionErrorById] = useState<Record<string, string | undefined>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [editor, setEditor] = useState<EditorState>();
  const [editorErrors, setEditorErrors] = useState<ScheduleEditorErrors>({});
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const requestGenerationRef = useRef(0);
  const openedExternalEditIdRef = useRef<string>();

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
      setLoadError('无法加载定时任务');
    } finally {
      if (generation === requestGenerationRef.current && showLoading) setLoading(false);
    }
  }, [props.connected, props.service]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setEditor(undefined);
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

  useEffect(() => {
    const scheduleId = props.editScheduleId;
    if (scheduleId === undefined) {
      openedExternalEditIdRef.current = undefined;
      return;
    }
    if (openedExternalEditIdRef.current === scheduleId) return;
    const schedule = schedules.find(item => item.id === scheduleId);
    if (schedule === undefined) return;
    openedExternalEditIdRef.current = scheduleId;
    void openEditEditor(schedule);
  }, [props.editScheduleId, schedules]);

  useEffect(() => {
    if (editor === undefined) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setEditor(undefined);
        setEditorErrors({});
      }
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [editor]);

  const filteredSchedules = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return schedules.filter(schedule => {
      if (filter === 'enabled' && !schedule.enabled) return false;
      if (filter === 'paused' && schedule.enabled) return false;
      if (normalizedQuery.length === 0) return true;
      return [
        schedule.name,
        schedule.promptPreviewRedacted,
        formatScheduleFrequency(schedule.cron),
      ].some(value => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [filter, query, schedules]);

  if (!props.connected || props.service === null) {
    return (
      <section className="schedules-view">
        <div className="schedules-state">
          <CalendarClock size={28} aria-hidden="true" />
          <h2>已安排功能暂不可用</h2>
          <p>连接本地运行内核后可以创建和管理任务</p>
        </div>
      </section>
    );
  }

  function openCreateEditor(
    source: 'manual' | 'suggestion' = 'manual',
    override?: Partial<ScheduleEditorValues>
  ) {
    setEditorErrors({});
    setEditor({
      mode: 'create',
      source,
      values: {
        ...createDefaultValues(currentProject, props.defaultTimezone),
        ...override,
      },
    });
  }

  async function openEditEditor(schedule: ScheduleResponse) {
    if (props.service === null) return;
    setEditorErrors({});
    setEditor({
      mode: 'edit',
      scheduleId: schedule.id,
      values: scheduleResponseToEditorValues(schedule),
      loading: true,
    });
    try {
      const detail = await props.service.getSchedule(schedule.id);
      setEditor(current => (
        current?.mode === 'edit' && current.scheduleId === schedule.id
          ? {
              mode: 'edit',
              scheduleId: schedule.id,
              values: scheduleDetailToEditorValues(detail),
              loading: false,
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
    const validationErrors = validateScheduleEditorValues(values);
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
      setEditor(undefined);
      setEditorErrors({});
      setSchedules(current => upsertSchedule(current, saved));
      props.onScheduleChanged(saved);
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
      props.onScheduleChanged(updated);
    } catch (error) {
      setSchedules(current => replaceSchedule(current, schedule));
      setActionError(schedule.id, errorMessage(error, '无法更新任务状态'));
    } finally {
      setBusy(schedule.id, false);
    }
  }

  async function runSchedule(schedule: ScheduleResponse) {
    if (busyIds.has(schedule.id)) return;
    setBusy(schedule.id, true);
    clearActionError(schedule.id);
    try {
      await props.onRunNow(schedule);
    } catch (error) {
      setActionError(schedule.id, errorMessage(error, '无法立即运行任务'));
    } finally {
      setBusy(schedule.id, false);
    }
  }

  async function deleteSchedule(schedule: ScheduleResponse) {
    if (props.service === null || busyIds.has(schedule.id)) return;
    const confirmed = props.confirmDelete?.(schedule)
      ?? await confirm({
        title: '删除任务',
        description: `确认删除“${schedule.name}”？删除后无法恢复。`,
        confirmLabel: '删除任务',
        destructive: true
      });
    if (!confirmed) return;
    setBusy(schedule.id, true);
    clearActionError(schedule.id);
    try {
      await props.service.deleteSchedule(schedule.id);
      setSchedules(current => current.filter(item => item.id !== schedule.id));
      props.onScheduleDeleted(schedule);
      if (editor?.mode === 'edit' && editor.scheduleId === schedule.id) {
        setEditor(undefined);
      }
    } catch (error) {
      setActionError(schedule.id, errorMessage(error, '无法删除任务'));
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

  function closeEditor() {
    setEditor(undefined);
    setEditorErrors({});
  }

  return (
    <section className="schedules-view">
      <div className="schedules-view__inner">
        <>
            <header className="schedules-view__header">
              <div>
                <h1>定时任务</h1>
                <p>安排任务、设置提醒或定期处理工作</p>
              </div>
              <button
                className="schedule-button schedule-button--secondary"
                type="button"
                onClick={() => openCreateEditor('manual')}
              >
                <Plus size={16} />
                创建
              </button>
            </header>

            <label className="schedules-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="搜索定时任务"
                type="search"
                value={query}
                placeholder="搜索定时任务"
                onChange={event => setQuery(event.target.value)}
              />
            </label>

            <div className="schedules-filters" role="group" aria-label="任务状态">
              {scheduleFilterOptions.map(option => (
                <button
                  aria-pressed={filter === option.value}
                  className={filter === option.value ? 'is-active' : ''}
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="schedules-state" role="status">
                <LoaderCircle size={24} className="schedule-spin" />
                正在加载定时任务
              </div>
            ) : loadError ? (
              <div className="schedules-state schedules-state--error" role="alert">
                <p>{loadError}</p>
                <button
                  className="schedule-button schedule-button--secondary"
                  type="button"
                  onClick={() => void loadSchedules(true)}
                >
                  <RefreshCw size={16} />
                  重新加载
                </button>
              </div>
            ) : filteredSchedules.length === 0 ? (
              <div className="schedules-empty">
                <CalendarClock size={24} aria-hidden="true" />
                <strong>
                  {schedules.length === 0 ? '还没有定时任务' : '没有找到匹配的任务'}
                </strong>
                <span>
                  {schedules.length === 0
                    ? '从建议开始，或者创建一个自己的任务'
                    : '换个关键词或状态筛选试试'}
                </span>
              </div>
            ) : (
              <ul className="schedules-list">
                {filteredSchedules.map(schedule => {
                  const busy = busyIds.has(schedule.id);
                  const nextRun = formatScheduleNextRun(
                    schedule.nextRunAt,
                    schedule.timezone
                  );
                  return (
                    <li className="schedule-row" key={schedule.id}>
                      <div className="schedule-row__icon" aria-hidden="true">
                        {schedule.enabled ? <Bell size={17} /> : <CalendarClock size={17} />}
                      </div>
                      <div className="schedule-row__content">
                        <div className="schedule-row__title">
                          <h2>
                            <button
                              className="schedule-row__title-button"
                              type="button"
                              aria-label={`打开任务会话 ${schedule.name}`}
                              onClick={() => props.onOpenTask(schedule.threadId)}
                            >
                              {schedule.name}
                            </button>
                          </h2>
                          {schedule.lastStatus === 'running'
                            || schedule.lastStatus === 'queued' ? (
                              <span className="schedule-running-label">
                                <LoaderCircle size={13} className="schedule-spin" />
                                {lastStatusLabel(schedule.lastStatus)}
                              </span>
                            ) : null}
                        </div>
                        <p>{schedule.promptPreviewRedacted}</p>
                        <div className="schedule-row__meta">
                          <span>{formatScheduleFrequency(schedule.cron)}</span>
                          {nextRun ? <span>下次 {nextRun}</span> : null}
                          {!schedule.enabled ? <span>已暂停</span> : null}
                        </div>
                        {schedule.lastRunId ? (
                          <button
                            className="schedule-row__run-link"
                            type="button"
                            onClick={() => props.onOpenTask(
                              schedule.threadId,
                              schedule.lastRunId!
                            )}
                          >
                            <ExternalLink size={14} />
                            查看上次运行
                          </button>
                        ) : null}
                        {actionErrorById[schedule.id] ? (
                          <p className="schedule-row__error" role="status">
                            {actionErrorById[schedule.id]}
                          </p>
                        ) : null}
                      </div>
                      <div className="schedule-row__actions">
                        <button
                          className="schedule-switch"
                          type="button"
                          role="switch"
                          aria-checked={schedule.enabled}
                          aria-label={`${schedule.enabled ? '暂停' : '启用'}${schedule.name}`}
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
                          {busy ? (
                            <LoaderCircle size={16} className="schedule-spin" />
                          ) : (
                            <CirclePlay size={16} />
                          )}
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

            {query.trim().length === 0 && filter === 'all' ? (
              <section className="schedule-suggestions" aria-labelledby="schedule-suggestions-heading">
                <h2 id="schedule-suggestions-heading">建议</h2>
                <div className="schedule-suggestion-list">
                  {scheduleSuggestions.map(suggestion => {
                    const Icon = suggestion.icon;
                    return (
                      <button
                        key={suggestion.name}
                        type="button"
                        onClick={() => openCreateEditor('suggestion', {
                          name: suggestion.name,
                          prompt: suggestion.prompt,
                          frequency: suggestion.frequency,
                        })}
                      >
                        <Icon
                          className={`schedule-suggestion-icon schedule-suggestion-icon--${suggestion.tone}`}
                          size={18}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>
                            {suggestion.name}
                            <small>{suggestion.scheduleLabel}</small>
                          </strong>
                          <span>{suggestion.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
          {editor ? (
            <div
              className="schedule-editor-overlay"
              onMouseDown={event => {
                if (event.target === event.currentTarget) closeEditor();
              }}
            >
              <div
                aria-label={editor.mode === 'create' ? '创建定时任务' : '编辑定时任务'}
                aria-modal="true"
                className="schedule-editor-dialog"
                role="dialog"
              >
                <ScheduleEditor
                  mode={editor.mode}
                  initialValues={editor.values}
                  projects={props.projects}
                  loading={editor.mode === 'edit' && editor.loading}
                  saving={saving}
                  errors={editorErrors}
                  onCancel={closeEditor}
                  onSubmit={values => void saveEditor(values)}
                />
              </div>
            </div>
          ) : null}
        </>
      </div>
    </section>
  );
}

function createDefaultValues(
  project: OpenCreatorProject | undefined,
  timezone: string
): ScheduleEditorValues {
  return {
    name: '',
    prompt: '',
    frequency: { ...defaultScheduleFrequency },
    timezone,
    cwd: project?.cwd ?? '',
    profile: project?.profile ?? 'default',
    model: project?.model ?? '',
    reasoning: (project?.reasoning ?? '') as ScheduleEditorValues['reasoning'],
    sandbox: project?.sandbox === 'danger-full-access'
      || project?.sandbox === 'workspace-write'
      ? project.sandbox
      : 'workspace-write',
    timeoutMinutes: '',
    concurrencyPolicy: 'skip',
    enabled: true,
  };
}

function mapScheduleError(error: unknown): ScheduleEditorErrors {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('cwd') || normalized.includes('directory')) {
    return { form: '项目目录不存在或无法访问' };
  }
  if (normalized.includes('cron')) return { frequency: '执行频率无效' };
  if (normalized.includes('timezone')) return { timezone: '时区无效' };
  if (normalized.includes('profile')) {
    return { form: '当前项目的运行配置不可用，请先在项目设置中修复' };
  }
  if (normalized.includes('timeout')) return { timeoutMinutes: '最长运行时间无效' };
  if (error instanceof ApiClientError) return { form: error.message };
  return { form: '无法保存计划任务' };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function upsertSchedule(
  current: ScheduleResponse[],
  schedule: ScheduleResponse
): ScheduleResponse[] {
  const index = current.findIndex(item => item.id === schedule.id);
  if (index < 0) return [schedule, ...current];
  return current.map(item => item.id === schedule.id ? schedule : item);
}

function replaceSchedule(
  current: ScheduleResponse[],
  schedule: ScheduleResponse
): ScheduleResponse[] {
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

const scheduleFilterOptions: Array<{ value: ScheduleFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'paused', label: '已暂停' },
];

const scheduleSuggestions: Array<{
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
  scheduleLabel: string;
  description: string;
  icon: typeof Bell;
  tone: 'blue' | 'violet' | 'green';
}> = [
  {
    name: '每日简报',
    prompt: '结合当前项目内容，总结昨天的进展、未完成事项和今天最重要的三件事。',
    frequency: { repeat: 'weekdays', time: '08:00', days: [] },
    scheduleLabel: '工作日 08:00',
    description: '汇总项目进展、未完成事项和当天优先级',
    icon: Bell,
    tone: 'blue',
  },
  {
    name: '每周回顾',
    prompt: '整理本周完成的工作、遇到的问题、关键决定和下周计划。',
    frequency: { repeat: 'weekly', time: '16:00', days: [5] },
    scheduleLabel: '每周五 16:00',
    description: '每周五整理工作进展并形成清晰的状态更新',
    icon: PencilLine,
    tone: 'violet',
  },
  {
    name: '跟进监控',
    prompt: '检查最近的项目和日历活动，列出需要继续跟进或可能阻塞的事项。',
    frequency: { repeat: 'weekdays', time: '09:00', days: [] },
    scheduleLabel: '工作日 09:00',
    description: '查看最近活动并标记需要持续关注的事项',
    icon: MoreHorizontal,
    tone: 'green',
  },
];
