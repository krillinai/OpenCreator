import type {
  CreateScheduleRequest,
  CodexProfileResponse,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@clawee/protocol';
import {
  Bell,
  CalendarClock,
  ChevronDown,
  CirclePlay,
  ExternalLink,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiClientError } from '../../runtime/errors.js';
import type { ScheduleAssistantService } from '../../services/schedule-assistant.js';
import type { ClaweeProject } from '../projects/project-model.js';
import {
  createScheduleRequest,
  createScheduleUpdate,
  ScheduleEditor,
  scheduleDetailToEditorValues,
  type ScheduleEditorErrors,
  type ScheduleEditorValues,
} from './ScheduleEditor.js';
import {
  cronToScheduleFrequency,
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
  runNow(id: string): Promise<RunScheduleNowResponse>;
  listOperations(id: string, limit?: number): Promise<ScheduleOperationListResponse>;
};

type EditorState =
  | {
      mode: 'create';
      source: 'manual' | 'assistant' | 'suggestion';
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
  assistant?: ScheduleAssistantService | null;
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
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantDescription, setAssistantDescription] = useState('');
  const [assistantGenerating, setAssistantGenerating] = useState(false);
  const [assistantError, setAssistantError] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const createMenuRef = useRef<HTMLDivElement>(null);
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
      setLoadError('无法加载已安排的任务');
    } finally {
      if (generation === requestGenerationRef.current && showLoading) setLoading(false);
    }
  }, [props.connected, props.service]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setEditor(undefined);
    setAssistantOpen(false);
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

  useEffect(() => {
    if (!createMenuOpen) return;
    function closeMenu(event: MouseEvent) {
      if (!createMenuRef.current?.contains(event.target as Node)) {
        setCreateMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setCreateMenuOpen(false);
    }
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [createMenuOpen]);

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
    source: 'manual' | 'assistant' | 'suggestion' = 'manual',
    override?: Partial<ScheduleEditorValues>
  ) {
    setCreateMenuOpen(false);
    setAssistantOpen(false);
    setEditorErrors({});
    setLatestRun(undefined);
    setEditor({
      mode: 'create',
      source,
      values: {
        ...createDefaultValues(currentProject, props.defaultTimezone),
        ...override,
      },
    });
  }

  function openAssistant() {
    setCreateMenuOpen(false);
    setEditor(undefined);
    setAssistantError(undefined);
    setAssistantOpen(true);
  }

  async function generateWithAssistant() {
    if (props.assistant === null || props.assistant === undefined || currentProject === undefined) {
      setAssistantError('Clawee 创建功能暂不可用');
      return;
    }
    if (assistantDescription.trim().length === 0) {
      setAssistantError('先描述你希望 Clawee 定期完成什么');
      return;
    }

    setAssistantGenerating(true);
    setAssistantError(undefined);
    try {
      const draft = await props.assistant.generate({
        description: assistantDescription,
        cwd: currentProject.cwd,
        profile: currentProject.profile,
        timezone: props.defaultTimezone,
      });
      openCreateEditor('assistant', {
        name: draft.name,
        prompt: draft.prompt,
        frequency: draft.frequency,
      });
    } catch (error) {
      setAssistantError(errorMessage(error, 'Clawee 无法生成计划，请重试'));
    } finally {
      setAssistantGenerating(false);
    }
  }

  async function openEditEditor(schedule: ScheduleResponse) {
    if (props.service === null) return;
    setEditorErrors({});
    setLatestRun(undefined);
    setEditor({
      mode: 'edit',
      scheduleId: schedule.id,
      values: scheduleToLoadingValues(schedule),
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
      setAssistantDescription('');
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
      setActionError(schedule.id, errorMessage(error, '无法更新任务状态'));
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
          ...(response.run.threadId ? { threadId: response.run.threadId } : {}),
        });
      } else if (response.queued) {
        setActionError(schedule.id, '本次运行已排队，会在当前任务结束后执行');
      } else if (response.skipped) {
        setActionError(schedule.id, '已有任务在运行，本次已跳过');
      }
    } catch (error) {
      setActionError(schedule.id, errorMessage(error, '无法立即运行任务'));
    } finally {
      setBusy(schedule.id, false);
    }
  }

  async function deleteSchedule(schedule: ScheduleResponse) {
    if (props.service === null || busyIds.has(schedule.id)) return;
    const confirmed = props.confirmDelete?.(schedule)
      ?? window.confirm(`确认删除任务“${schedule.name}”？`);
    if (!confirmed) return;
    setBusy(schedule.id, true);
    clearActionError(schedule.id);
    try {
      await props.service.deleteSchedule(schedule.id);
      setSchedules(current => current.filter(item => item.id !== schedule.id));
      setLatestRun(undefined);
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
      <div
        className={`schedules-view__inner${
          editor || assistantOpen ? ' schedules-view__inner--editing' : ''
        }`}
      >
        {editor ? (
          <ScheduleEditor
            mode={editor.mode}
            initialValues={editor.values}
            projects={props.projects}
            profiles={props.profiles}
            loading={editor.mode === 'edit' && editor.loading}
            saving={saving}
            generatedByAssistant={
              editor.mode === 'create' && editor.source === 'assistant'
            }
            errors={editorErrors}
            onCancel={closeEditor}
            onSubmit={values => void saveEditor(values)}
          />
        ) : assistantOpen ? (
          <section className="schedule-assistant" aria-label="使用 Clawee 创建计划任务">
            <header className="schedule-editor__topbar">
              <strong>使用 Clawee 创建</strong>
              <button
                className="schedule-icon-button schedule-icon-button--plain"
                type="button"
                aria-label="关闭 Clawee 创建"
                title="关闭"
                onClick={() => setAssistantOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="schedule-assistant__body">
              <div className="schedule-assistant__intro">
                <Sparkles size={22} aria-hidden="true" />
                <h1>描述你想自动完成的事</h1>
                <p>用一句话说明任务内容和执行时间，Clawee 会帮你生成设置。</p>
              </div>
              <label className="schedule-assistant__prompt">
                <span>任务描述</span>
                <textarea
                  aria-label="告诉 Clawee 要安排什么"
                  rows={7}
                  value={assistantDescription}
                  placeholder="例如：每个工作日早上 8 点，总结当前项目的进展、阻塞和今天最重要的三件事"
                  onChange={event => setAssistantDescription(event.target.value)}
                />
              </label>
              <div className="schedule-assistant__examples" aria-label="示例">
                {assistantExamples.map(example => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setAssistantDescription(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
              {assistantError ? (
                <p className="schedule-form-error" role="alert">{assistantError}</p>
              ) : null}
            </div>
            <footer className="schedule-editor__actions">
              <button
                className="schedule-button schedule-button--secondary"
                type="button"
                onClick={() => setAssistantOpen(false)}
              >
                取消
              </button>
              <button
                className="schedule-button schedule-button--primary"
                type="button"
                disabled={assistantGenerating}
                onClick={() => void generateWithAssistant()}
              >
                {assistantGenerating ? (
                  <LoaderCircle size={16} className="schedule-spin" />
                ) : (
                  <Sparkles size={16} />
                )}
                {assistantGenerating ? 'Clawee 正在生成' : '生成计划'}
              </button>
            </footer>
          </section>
        ) : (
          <>
            <header className="schedules-view__header">
              <div>
                <h1>已安排的任务</h1>
                <p>让 Clawee 安排任务、设置提醒或定期处理工作</p>
              </div>
              <div className="schedule-create-menu" ref={createMenuRef}>
                <button
                  aria-expanded={createMenuOpen}
                  aria-haspopup="menu"
                  className="schedule-button schedule-button--primary"
                  type="button"
                  onClick={() => setCreateMenuOpen(open => !open)}
                >
                  <Plus size={16} />
                  创建
                  <ChevronDown size={14} />
                </button>
                {createMenuOpen ? (
                  <div className="schedule-create-menu__popover" role="menu">
                    <button type="button" role="menuitem" onClick={openAssistant}>
                      <MessageCircle size={17} />
                      <span>
                        <strong>使用 Clawee 创建</strong>
                        <small>用自然语言描述任务</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openCreateEditor('manual')}
                    >
                      <PencilLine size={17} />
                      <span>
                        <strong>手动设置</strong>
                        <small>直接选择时间和项目</small>
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            </header>

            <label className="schedules-search">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="搜索已安排任务"
                type="search"
                value={query}
                placeholder="搜索已安排任务"
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
                正在加载已安排的任务
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
                  {schedules.length === 0 ? '还没有已安排的任务' : '没有找到匹配的任务'}
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
                  const showLatestRun =
                    latestRun !== undefined && schedule.lastRunId === latestRun.runId;
                  return (
                    <li className="schedule-row" key={schedule.id}>
                      <div className="schedule-row__icon" aria-hidden="true">
                        {schedule.enabled ? <Bell size={17} /> : <CalendarClock size={17} />}
                      </div>
                      <div className="schedule-row__content">
                        <div className="schedule-row__title">
                          <h2>{schedule.name}</h2>
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
                        {showLatestRun ? (
                          <button
                            className="schedule-row__run-link"
                            type="button"
                            onClick={() => props.onOpenRun(
                              latestRun.runId,
                              latestRun.threadId
                            )}
                          >
                            <ExternalLink size={14} />
                            查看运行
                          </button>
                        ) : schedule.lastRunId ? (
                          <button
                            className="schedule-row__run-link"
                            type="button"
                            onClick={() => props.onOpenRun(schedule.lastRunId!)}
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
          </>
        )}
      </div>
    </section>
  );
}

function createDefaultValues(
  project: ClaweeProject | undefined,
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

function scheduleToLoadingValues(schedule: ScheduleResponse): ScheduleEditorValues {
  return {
    name: schedule.name,
    prompt: '',
    frequency: cronToScheduleFrequency(schedule.cron),
    timezone: schedule.timezone,
    cwd: schedule.cwd,
    profile: schedule.profile,
    model: schedule.model ?? '',
    reasoning: schedule.reasoning ?? '',
    sandbox: schedule.sandbox,
    timeoutMinutes: schedule.timeoutMs === null || schedule.timeoutMs === undefined
      ? ''
      : String(Math.max(1, Math.round(schedule.timeoutMs / 60_000))),
    concurrencyPolicy: schedule.concurrencyPolicy,
    enabled: schedule.enabled,
  };
}

function validateSchedule(values: ScheduleEditorValues): ScheduleEditorErrors {
  const errors: ScheduleEditorErrors = {};
  if (values.name.trim().length === 0) errors.name = '请输入任务标题';
  if (values.prompt.trim().length === 0) errors.prompt = '请描述 Clawee 应该做什么';
  try {
    scheduleFrequencyToCron(values.frequency);
  } catch (error) {
    errors.frequency = errorMessage(error, '请选择执行频率');
  }
  if (values.timezone.trim().length === 0) errors.timezone = '请输入时区';
  if (values.cwd.trim().length === 0) errors.cwd = '请选择项目';
  if (values.profile.trim().length === 0) errors.profile = '请选择运行配置';
  if (
    values.timeoutMinutes.trim().length > 0
    && (!Number.isFinite(Number(values.timeoutMinutes))
      || Number(values.timeoutMinutes) <= 0)
  ) {
    errors.timeoutMinutes = '最长运行时间必须大于 0 分钟';
  }
  return errors;
}

function mapScheduleError(error: unknown): ScheduleEditorErrors {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('cwd') || normalized.includes('directory')) {
    return { cwd: '项目目录不存在或无法访问' };
  }
  if (normalized.includes('cron')) return { frequency: '执行频率无效' };
  if (normalized.includes('timezone')) return { timezone: '时区无效' };
  if (normalized.includes('profile')) return { profile: '运行配置不存在或无效' };
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

const assistantExamples = [
  '每个工作日早上 8 点总结当前项目进展',
  '每周五下午 4 点整理本周完成情况和下周计划',
  '每天上午 9 点检查项目里需要关注的更新',
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
