import type {
  CreateScheduleRequest,
  ReasoningEffort,
  SandboxMode,
  ScheduleConcurrencyPolicy,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@opencreator/protocol';
import { Check, ChevronDown, Clock3, LoaderCircle, Save, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import type { OpenCreatorProject } from '../projects/project-model.js';
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
  projects: OpenCreatorProject[];
  loading?: boolean;
  saving?: boolean;
  errors?: ScheduleEditorErrors;
  onCancel(): void;
  onSubmit(values: ScheduleEditorValues): void;
}) {
  const confirm = useConfirmDialog();
  const [values, setValues] = useState(props.initialValues);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setValues(props.initialValues);
  }, [props.initialValues]);

  useEffect(() => {
    if (props.errors === undefined || Object.keys(props.errors).length === 0) return;
    const firstInvalidField = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    firstInvalidField?.focus();
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [props.errors]);

  const formLabel = props.mode === 'create' ? '创建定时任务' : `编辑${values.name || '定时任务'}`;
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
    <form ref={formRef} className="schedule-editor" aria-label={formLabel} onSubmit={submit}>
      <header className="schedule-editor__topbar">
        <strong>{props.mode === 'create' ? '创建定时任务' : '编辑定时任务'}</strong>
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
            {props.errors?.form ? (
              <p className="schedule-form-error" role="alert">
                {props.errors.form}
              </p>
            ) : null}

            <label className="schedule-title-field">
              <span>
                标题
                <small>必填</small>
              </span>
              <input
                aria-label="定时任务标题"
                value={values.name}
                placeholder="输入任务标题"
                aria-invalid={props.errors?.name ? 'true' : undefined}
                onChange={event => update('name', event.target.value)}
              />
              {props.errors?.name ? (
                <small className="schedule-field__error">{props.errors.name}</small>
              ) : null}
            </label>

            <label className="schedule-prompt-field">
              <span>描述</span>
              <textarea
                aria-label="任务内容"
                value={values.prompt}
                placeholder="描述需要帮你做什么..."
                rows={3}
                aria-invalid={props.errors?.prompt ? 'true' : undefined}
                onChange={event => update('prompt', event.target.value)}
              />
              {props.errors?.prompt ? (
                <small className="schedule-field__error">{props.errors.prompt}</small>
              ) : null}
            </label>

            <section className="schedule-editor-group" aria-labelledby="schedule-frequency-heading">
              <h2 id="schedule-frequency-heading">执行频率</h2>
              <div className="schedule-setting-list schedule-setting-list--time-popover">
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
                        <ScheduleTimePicker
                          value={values.frequency.time}
                          onChange={time => update('frequency', {
                            ...values.frequency,
                            time,
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

            <section
              className="schedule-editor-advanced"
              aria-labelledby="schedule-advanced-heading"
            >
              <h2 id="schedule-advanced-heading">请选择访问权限</h2>
              <div className="schedule-setting-list">
                <SettingRow label="权限">
                  <SelectControl
                    ariaLabel="权限"
                    value={values.sandbox === 'danger-full-access'
                      ? 'danger-full-access'
                      : 'workspace-write'}
                    onChange={async value => {
                      if (
                        value === 'danger-full-access'
                        && values.sandbox !== 'danger-full-access'
                        && !await confirm({
                          title: '开启完全访问权限',
                          description: '完全访问权限允许任务访问本机文件并执行本地操作。仅为可信任务开启。',
                          confirmLabel: '开启'
                        })
                      ) {
                        return;
                      }
                      update('sandbox', value as SandboxMode);
                    }}
                  >
                    <option value="workspace-write">请求批准</option>
                    <option value="danger-full-access">完全访问权限</option>
                  </SelectControl>
                </SettingRow>
              </div>
            </section>

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
              className="schedule-button schedule-button--secondary"
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

function ScheduleTimePicker(props: {
  value: string;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hour = props.value.slice(0, 2);
  const minute = props.value.slice(3, 5);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    rootRef.current
      ?.querySelectorAll<HTMLElement>('[aria-selected="true"]')
      .forEach(element => element.scrollIntoView?.({ block: 'center' }));
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="schedule-time-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="执行时间"
        className="schedule-time-picker__trigger"
        type="button"
        onClick={() => setOpen(current => !current)}
      >
        <span>{props.value}</span>
        <Clock3 size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="schedule-time-picker__popover" role="dialog" aria-label="选择执行时间">
          <TimeColumn
            label="小时"
            selected={hour}
            values={Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'))}
            onSelect={nextHour => props.onChange(`${nextHour}:${minute}`)}
          />
          <TimeColumn
            label="分钟"
            selected={minute}
            values={Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))}
            onSelect={nextMinute => props.onChange(`${hour}:${nextMinute}`)}
          />
        </div>
      ) : null}
    </div>
  );
}

function TimeColumn(props: {
  label: string;
  selected: string;
  values: string[];
  onSelect(value: string): void;
}) {
  return (
    <div className="schedule-time-picker__column" role="listbox" aria-label={props.label}>
      {props.values.map(value => {
        const selected = value === props.selected;
        return (
          <button
            aria-label={`${props.label} ${value}`}
            aria-selected={selected}
            key={value}
            role="option"
            type="button"
            onClick={() => props.onSelect(value)}
          >
            <span>{value}</span>
            {selected ? <Check size={14} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
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

export function validateScheduleEditorValues(
  values: ScheduleEditorValues
): ScheduleEditorErrors {
  const errors: ScheduleEditorErrors = {};
  if (values.name.trim().length === 0) errors.name = '请输入任务标题';
  if (values.prompt.trim().length === 0) errors.prompt = '请描述需要帮你做什么';
  try {
    scheduleFrequencyToCron(values.frequency);
  } catch {
    errors.frequency = '请选择执行频率';
  }
  if (values.cwd.trim().length === 0) errors.form = '当前项目不可用，请先选择或创建项目';
  if (values.profile.trim().length === 0) {
    errors.form = '当前项目的运行配置不可用，请先在项目设置中修复';
  }
  return errors;
}

export function scheduleDetailToEditorValues(
  schedule: ScheduleDetailResponse
): ScheduleEditorValues {
  return scheduleResponseToEditorValues(schedule);
}

export function scheduleResponseToEditorValues(
  schedule: ScheduleResponse | ScheduleDetailResponse
): ScheduleEditorValues {
  return {
    name: schedule.name,
    prompt: 'prompt' in schedule ? schedule.prompt : schedule.promptPreviewRedacted,
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
