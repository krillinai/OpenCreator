import type {
  CreateScheduleRequest,
  CodexProfileResponse,
  ReasoningEffort,
  SandboxMode,
  ScheduleConcurrencyPolicy,
  ScheduleDetailResponse,
  UpdateScheduleRequest,
} from '@clawee/protocol';
import { ChevronDown, LoaderCircle, Save, Sparkles, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClaweeProject } from '../projects/project-model.js';
import {
  cronToScheduleFrequency,
  scheduleFrequencyToCron,
  scheduleRepeatOptions,
  scheduleWeekdays,
  type ScheduleFrequency,
  type ScheduleRepeat,
} from './schedule-frequency.js';

export type ScheduleEditorValues = {
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
  timezone: string;
  cwd: string;
  profile: string;
  model: string;
  reasoning: '' | ReasoningEffort;
  sandbox: SandboxMode;
  timeoutMinutes: string;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  enabled: boolean;
};

export type ScheduleEditorErrors = Partial<
  Record<
    | keyof Omit<ScheduleEditorValues, 'frequency'>
    | 'frequency'
    | 'form',
    string
  >
>;

export function ScheduleEditor(props: {
  mode: 'create' | 'edit';
  initialValues: ScheduleEditorValues;
  projects: ClaweeProject[];
  profiles?: CodexProfileResponse[];
  loading?: boolean;
  saving?: boolean;
  generatedByAssistant?: boolean;
  errors?: ScheduleEditorErrors;
  onCancel(): void;
  onSubmit(values: ScheduleEditorValues): void;
}) {
  const [values, setValues] = useState(props.initialValues);

  useEffect(() => {
    setValues(props.initialValues);
  }, [props.initialValues]);

  const formLabel = props.mode === 'create' ? '创建计划任务' : `编辑${values.name || '计划任务'}`;
  const profileOptions = Array.from(new Set([
    'default',
    values.profile,
    ...(props.profiles ?? [])
      .filter(profile => profile.status === 'valid')
      .map(profile => profile.name),
  ])).filter(Boolean);
  const projectOptions = props.projects.some(project => project.cwd === values.cwd)
    ? props.projects
    : [
        ...props.projects,
        {
          id: `schedule-current-${values.cwd}`,
          name: values.cwd || '当前项目',
          cwd: values.cwd,
          sandbox: 'workspace-write' as const,
          profile: values.profile,
          model: values.model || null,
          reasoning: values.reasoning || null,
        },
      ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit(values);
  }

  function update<K extends keyof ScheduleEditorValues>(
    key: K,
    value: ScheduleEditorValues[K]
  ) {
    setValues(current => ({ ...current, [key]: value }));
  }

  function updateRepeat(repeat: ScheduleRepeat) {
    setValues(current => {
      const days = repeat === 'weekly'
        ? [current.frequency.days[0] ?? 1]
        : repeat === 'custom'
          ? current.frequency.days.length > 0
            ? current.frequency.days
            : [1, 3, 5]
          : [];
      return {
        ...current,
        frequency: {
          repeat,
          time: current.frequency.time,
          days,
          ...(repeat === 'advanced'
            ? { legacyCron: current.frequency.legacyCron }
            : {}),
        },
      };
    });
  }

  function toggleDay(day: number) {
    setValues(current => {
      const selected = current.frequency.days.includes(day);
      const days = selected
        ? current.frequency.days.filter(value => value !== day)
        : [...current.frequency.days, day];
      return {
        ...current,
        frequency: {
          ...current.frequency,
          days,
        },
      };
    });
  }

  return (
    <form className="schedule-editor" aria-label={formLabel} onSubmit={submit}>
      <header className="schedule-editor__topbar">
        <strong>{props.mode === 'create' ? '创建计划任务' : '编辑计划任务'}</strong>
        <button
          className="schedule-icon-button schedule-icon-button--plain"
          type="button"
          aria-label="取消编辑"
          title="关闭"
          onClick={props.onCancel}
        >
          <X size={18} />
        </button>
      </header>

      {props.loading ? (
        <div className="schedule-editor__loading" role="status">
          <LoaderCircle size={18} className="schedule-spin" />
          正在加载计划详情
        </div>
      ) : (
        <>
          <div className="schedule-editor__scroll">
            {props.generatedByAssistant ? (
              <p className="schedule-assistant-result" role="status">
                <Sparkles size={16} aria-hidden="true" />
                Clawee 已生成计划草稿，请确认后创建
              </p>
            ) : null}
            {props.errors?.form ? (
              <p className="schedule-form-error" role="alert">
                {props.errors.form}
              </p>
            ) : null}

            <label className="schedule-title-field">
              <span>已安排任务标题</span>
              <input
                aria-label="已安排任务标题"
                value={values.name}
                placeholder="例如：每日简报"
                aria-invalid={props.errors?.name ? 'true' : undefined}
                onChange={event => update('name', event.target.value)}
              />
              {props.errors?.name ? (
                <small className="schedule-field__error">{props.errors.name}</small>
              ) : null}
            </label>

            <label className="schedule-prompt-field">
              <textarea
                aria-label="任务内容"
                value={values.prompt}
                placeholder="描述 Clawee 应该做什么"
                rows={5}
                aria-invalid={props.errors?.prompt ? 'true' : undefined}
                onChange={event => update('prompt', event.target.value)}
              />
              {props.errors?.prompt ? (
                <small className="schedule-field__error">{props.errors.prompt}</small>
              ) : null}
            </label>

            <section className="schedule-editor-group" aria-labelledby="schedule-details-heading">
              <h2 id="schedule-details-heading">详情</h2>
              <div className="schedule-setting-list">
                <SettingRow label="运行于">
                  <span className="schedule-setting-value">新任务</span>
                </SettingRow>
                <SettingRow label="项目">
                  <SelectControl
                    ariaLabel="项目"
                    value={values.cwd}
                    onChange={value => update('cwd', value)}
                  >
                    {projectOptions.map(project => (
                      <option key={`${project.id}-${project.cwd}`} value={project.cwd}>
                        {project.name}
                      </option>
                    ))}
                  </SelectControl>
                </SettingRow>
                <SettingRow label="运行配置">
                  <SelectControl
                    ariaLabel="运行配置"
                    value={values.profile}
                    onChange={value => update('profile', value)}
                  >
                    {profileOptions.map(profile => (
                      <option key={profile} value={profile}>{profile}</option>
                    ))}
                  </SelectControl>
                </SettingRow>
                <SettingRow label="模型">
                  <input
                    className="schedule-setting-input"
                    aria-label="模型"
                    value={values.model}
                    placeholder="使用运行配置默认值"
                    onChange={event => update('model', event.target.value)}
                  />
                </SettingRow>
                <SettingRow label="推理">
                  <SelectControl
                    ariaLabel="推理"
                    value={values.reasoning}
                    onChange={value => update(
                      'reasoning',
                      value as ScheduleEditorValues['reasoning']
                    )}
                  >
                    <option value="">使用运行配置默认值</option>
                    <option value="default">默认</option>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="xhigh">极高</option>
                  </SelectControl>
                </SettingRow>
              </div>
              {props.errors?.cwd ? (
                <small className="schedule-field__error">{props.errors.cwd}</small>
              ) : null}
              {props.errors?.profile ? (
                <small className="schedule-field__error">{props.errors.profile}</small>
              ) : null}
            </section>

            <section className="schedule-editor-group" aria-labelledby="schedule-frequency-heading">
              <h2 id="schedule-frequency-heading">频率</h2>
              <div className="schedule-setting-list">
                <SettingRow label="重复">
                  <SelectControl
                    ariaLabel="重复"
                    value={values.frequency.repeat}
                    onChange={value => updateRepeat(value as ScheduleRepeat)}
                  >
                    {values.frequency.repeat === 'advanced' ? (
                      <option value="advanced">高级计划（保持原设置）</option>
                    ) : null}
                    {scheduleRepeatOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectControl>
                </SettingRow>

                {values.frequency.repeat === 'advanced' ? (
                  <div className="schedule-legacy-note">
                    这是旧版高级计划。保持当前选项可原样保存，也可以改成更简单的重复频率。
                  </div>
                ) : (
                  <>
                    <SettingRow
                      label={values.frequency.repeat === 'hourly' ? '分钟' : '时间'}
                    >
                      {values.frequency.repeat === 'hourly' ? (
                        <div className="schedule-hourly-control">
                          <span>每小时第</span>
                          <input
                            aria-label="每小时分钟"
                            type="number"
                            min="0"
                            max="59"
                            value={Number(values.frequency.time.slice(3, 5))}
                            onChange={event => {
                              const minute = Math.min(
                                59,
                                Math.max(0, Number(event.target.value) || 0)
                              );
                              update('frequency', {
                                ...values.frequency,
                                time: `00:${String(minute).padStart(2, '0')}`,
                              });
                            }}
                          />
                          <span>分钟</span>
                        </div>
                      ) : (
                        <input
                          className="schedule-time-input"
                          aria-label="执行时间"
                          type="time"
                          value={values.frequency.time}
                          onChange={event => update('frequency', {
                            ...values.frequency,
                            time: event.target.value,
                          })}
                        />
                      )}
                    </SettingRow>

                    {values.frequency.repeat === 'weekly'
                      || values.frequency.repeat === 'custom' ? (
                        <div className="schedule-day-picker" role="group" aria-label="执行日期">
                          {scheduleWeekdays.map(day => {
                            const selected = values.frequency.days.includes(day.value);
                            return (
                              <button
                                aria-pressed={selected}
                                className={selected ? 'is-selected' : ''}
                                key={day.value}
                                onClick={() => {
                                  if (values.frequency.repeat === 'weekly') {
                                    update('frequency', {
                                      ...values.frequency,
                                      days: [day.value],
                                    });
                                  } else {
                                    toggleDay(day.value);
                                  }
                                }}
                                type="button"
                              >
                                {day.shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                  </>
                )}
              </div>
              {props.errors?.frequency ? (
                <small className="schedule-field__error">{props.errors.frequency}</small>
              ) : null}
            </section>

            <details className="schedule-editor-advanced">
              <summary>
                <span>更多运行设置</span>
                <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <div className="schedule-setting-list">
                <SettingRow label="权限">
                  <SelectControl
                    ariaLabel="权限"
                    value={values.sandbox}
                    onChange={value => update('sandbox', value as SandboxMode)}
                  >
                    <option value="read-only">只读</option>
                    <option value="workspace-write">工作区可写</option>
                    <option value="danger-full-access">完全访问</option>
                  </SelectControl>
                </SettingRow>
                <SettingRow label="时区">
                  <input
                    className="schedule-setting-input"
                    aria-label="时区"
                    value={values.timezone}
                    onChange={event => update('timezone', event.target.value)}
                  />
                </SettingRow>
                <SettingRow label="最长运行">
                  <div className="schedule-timeout-control">
                    <input
                      aria-label="最长运行分钟"
                      type="number"
                      min="1"
                      value={values.timeoutMinutes}
                      placeholder="默认"
                      onChange={event => update('timeoutMinutes', event.target.value)}
                    />
                    <span>分钟</span>
                  </div>
                </SettingRow>
                <SettingRow label="任务重叠时">
                  <SelectControl
                    ariaLabel="任务重叠时"
                    value={values.concurrencyPolicy}
                    onChange={value => update(
                      'concurrencyPolicy',
                      value as ScheduleConcurrencyPolicy
                    )}
                  >
                    <option value="skip">跳过本次</option>
                    <option value="queue">排队执行</option>
                    <option value="parallel">同时执行</option>
                  </SelectControl>
                </SettingRow>
              </div>
              {props.errors?.timezone ? (
                <small className="schedule-field__error">{props.errors.timezone}</small>
              ) : null}
              {props.errors?.timeoutMinutes ? (
                <small className="schedule-field__error">
                  {props.errors.timeoutMinutes}
                </small>
              ) : null}
            </details>

            <label className="schedule-editor__enabled">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={event => update('enabled', event.target.checked)}
              />
              <span>
                <strong>创建后启用</strong>
                <small>关闭后会保存为暂停状态</small>
              </span>
            </label>
          </div>

          <footer className="schedule-editor__actions">
            <button
              className="schedule-button schedule-button--secondary"
              type="button"
              onClick={props.onCancel}
            >
              取消
            </button>
            <button
              className="schedule-button schedule-button--primary"
              type="submit"
              disabled={props.saving}
            >
              {props.saving ? (
                <LoaderCircle size={16} className="schedule-spin" />
              ) : (
                <Save size={16} />
              )}
              {props.mode === 'create' ? '创建任务' : '保存更改'}
            </button>
          </footer>
        </>
      )}
    </form>
  );
}

export function createScheduleRequest(values: ScheduleEditorValues): CreateScheduleRequest {
  const input: CreateScheduleRequest = {
    name: values.name.trim(),
    cron: scheduleFrequencyToCron(values.frequency),
    timezone: values.timezone.trim(),
    enabled: values.enabled,
    prompt: values.prompt.trim(),
    profile: values.profile.trim(),
    cwd: values.cwd.trim(),
    sandbox: values.sandbox,
    concurrencyPolicy: values.concurrencyPolicy,
    misfirePolicy: 'skip',
  };
  if (values.model.trim().length > 0) input.model = values.model.trim();
  if (values.reasoning !== '') input.reasoning = values.reasoning;
  if (values.timeoutMinutes.trim().length > 0) {
    input.timeoutMs = Number(values.timeoutMinutes) * 60_000;
  }
  return input;
}

export function createScheduleUpdate(values: ScheduleEditorValues): UpdateScheduleRequest {
  return {
    ...createScheduleRequest(values),
    model: values.model.trim() || null,
    reasoning: values.reasoning || null,
    timeoutMs: values.timeoutMinutes.trim().length > 0
      ? Number(values.timeoutMinutes) * 60_000
      : null,
  };
}

export function scheduleDetailToEditorValues(
  schedule: ScheduleDetailResponse
): ScheduleEditorValues {
  return {
    name: schedule.name,
    prompt: schedule.prompt,
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

function SettingRow(props: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="schedule-setting-row">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function SelectControl(props: {
  ariaLabel: string;
  value: string;
  children: React.ReactNode;
  onChange(value: string): void;
}) {
  return (
    <span className="schedule-select-control">
      <select
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
      >
        {props.children}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  );
}
