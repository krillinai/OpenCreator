import type {
  CreateScheduleRequest,
  ReasoningEffort,
  SandboxMode,
  ScheduleConcurrencyPolicy,
  ScheduleDetailResponse,
  ScheduleMisfirePolicy,
  UpdateScheduleRequest
} from '@clawee/protocol';
import { LoaderCircle, Save, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ClaweeProject } from '../projects/project-model.js';

export type ScheduleEditorValues = {
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  cwd: string;
  profile: string;
  model: string;
  reasoning: '' | ReasoningEffort;
  sandbox: SandboxMode;
  timeoutMs: string;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: ScheduleMisfirePolicy;
  enabled: boolean;
};

export type ScheduleEditorErrors = Partial<Record<keyof ScheduleEditorValues | 'form', string>>;

export function ScheduleEditor(props: {
  mode: 'create' | 'edit';
  initialValues: ScheduleEditorValues;
  projects: ClaweeProject[];
  loading?: boolean;
  saving?: boolean;
  errors?: ScheduleEditorErrors;
  onCancel(): void;
  onSubmit(values: ScheduleEditorValues): void;
}) {
  const [values, setValues] = useState(props.initialValues);

  useEffect(() => {
    setValues(props.initialValues);
  }, [props.initialValues]);

  const formLabel = props.mode === 'create' ? '新建计划任务' : `编辑${values.name || '计划任务'}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit(values);
  }

  function update<K extends keyof ScheduleEditorValues>(key: K, value: ScheduleEditorValues[K]) {
    setValues(current => ({ ...current, [key]: value }));
  }

  return (
    <form className="schedule-editor" aria-label={formLabel} onSubmit={submit}>
      <header className="schedule-editor__header">
        <div>
          <p>{props.mode === 'create' ? '新建计划' : '编辑计划'}</p>
          <h2>{props.mode === 'create' ? '配置自动执行任务' : values.name || '未命名计划'}</h2>
        </div>
        <button
          className="schedule-icon-button"
          type="button"
          aria-label="取消编辑"
          title="取消"
          onClick={props.onCancel}
        >
          <X size={17} />
        </button>
      </header>

      {props.loading ? (
        <div className="schedule-editor__loading" role="status">
          <LoaderCircle size={18} className="schedule-spin" />
          正在加载计划详情
        </div>
      ) : (
        <>
          {props.errors?.form ? <p className="schedule-form-error" role="alert">{props.errors.form}</p> : null}

          <div className="schedule-editor__body">
            <Field label="名称" error={props.errors?.name}>
              <input
                aria-label="名称"
                value={values.name}
                aria-invalid={props.errors?.name ? 'true' : undefined}
                onChange={event => update('name', event.target.value)}
              />
            </Field>

            <Field label="执行指令" error={props.errors?.prompt} wide>
              <textarea
                aria-label="执行指令"
                rows={5}
                value={values.prompt}
                aria-invalid={props.errors?.prompt ? 'true' : undefined}
                onChange={event => update('prompt', event.target.value)}
              />
            </Field>

            <Field label="Cron 表达式" error={props.errors?.cron}>
              <input
                aria-label="Cron 表达式"
                value={values.cron}
                placeholder="0 9 * * *"
                spellCheck={false}
                aria-invalid={props.errors?.cron ? 'true' : undefined}
                onChange={event => update('cron', event.target.value)}
              />
            </Field>

            <Field label="时区" error={props.errors?.timezone}>
              <input
                aria-label="时区"
                value={values.timezone}
                placeholder="Asia/Shanghai"
                spellCheck={false}
                aria-invalid={props.errors?.timezone ? 'true' : undefined}
                onChange={event => update('timezone', event.target.value)}
              />
            </Field>

            <Field label="项目目录" error={props.errors?.cwd} wide>
              <input
                aria-label="项目目录"
                list="schedule-project-directories"
                value={values.cwd}
                spellCheck={false}
                aria-invalid={props.errors?.cwd ? 'true' : undefined}
                onChange={event => update('cwd', event.target.value)}
              />
              <datalist id="schedule-project-directories">
                {props.projects.map(project => (
                  <option key={project.id} value={project.cwd}>{project.name}</option>
                ))}
              </datalist>
            </Field>

            <Field label="Profile" error={props.errors?.profile}>
              <input
                aria-label="Profile"
                value={values.profile}
                spellCheck={false}
                aria-invalid={props.errors?.profile ? 'true' : undefined}
                onChange={event => update('profile', event.target.value)}
              />
            </Field>

            <Field label="模型" error={props.errors?.model}>
              <input
                aria-label="模型"
                value={values.model}
                placeholder="使用 Profile 默认值"
                spellCheck={false}
                aria-invalid={props.errors?.model ? 'true' : undefined}
                onChange={event => update('model', event.target.value)}
              />
            </Field>

            <Field label="推理级别" error={props.errors?.reasoning}>
              <select
                aria-label="推理级别"
                value={values.reasoning}
                aria-invalid={props.errors?.reasoning ? 'true' : undefined}
                onChange={event => update('reasoning', event.target.value as ScheduleEditorValues['reasoning'])}
              >
                <option value="">使用 Profile 默认值</option>
                <option value="default">默认</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="xhigh">超高</option>
              </select>
            </Field>

            <Field label="权限" error={props.errors?.sandbox}>
              <select
                aria-label="权限"
                value={values.sandbox}
                aria-invalid={props.errors?.sandbox ? 'true' : undefined}
                onChange={event => update('sandbox', event.target.value as SandboxMode)}
              >
                <option value="read-only">只读</option>
                <option value="workspace-write">工作区可写</option>
                <option value="danger-full-access">完全访问</option>
              </select>
            </Field>

            <Field label="超时（毫秒）" error={props.errors?.timeoutMs}>
              <input
                aria-label="超时（毫秒）"
                type="number"
                min="1"
                step="1000"
                value={values.timeoutMs}
                placeholder="使用默认值"
                aria-invalid={props.errors?.timeoutMs ? 'true' : undefined}
                onChange={event => update('timeoutMs', event.target.value)}
              />
            </Field>

            <Field label="并发策略" error={props.errors?.concurrencyPolicy}>
              <select
                aria-label="并发策略"
                value={values.concurrencyPolicy}
                aria-invalid={props.errors?.concurrencyPolicy ? 'true' : undefined}
                onChange={event => update('concurrencyPolicy', event.target.value as ScheduleConcurrencyPolicy)}
              >
                <option value="skip">跳过本次</option>
                <option value="queue">排队执行</option>
                <option value="parallel">并行执行</option>
              </select>
            </Field>

            <Field label="错过触发策略" error={props.errors?.misfirePolicy}>
              <select
                aria-label="错过触发策略"
                value={values.misfirePolicy}
                aria-invalid={props.errors?.misfirePolicy ? 'true' : undefined}
                onChange={event => update('misfirePolicy', event.target.value as ScheduleMisfirePolicy)}
              >
                <option value="skip">跳过错过的触发</option>
              </select>
            </Field>

            <label className="schedule-editor__enabled">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={event => update('enabled', event.target.checked)}
              />
              <span>
                <strong>启用计划</strong>
                <small>保存后按 Cron 自动运行</small>
              </span>
            </label>
          </div>

          <footer className="schedule-editor__actions">
            <button className="schedule-button schedule-button--secondary" type="button" onClick={props.onCancel}>
              取消
            </button>
            <button className="schedule-button schedule-button--primary" type="submit" disabled={props.saving}>
              {props.saving ? <LoaderCircle size={16} className="schedule-spin" /> : <Save size={16} />}
              保存计划
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
    cron: values.cron.trim(),
    timezone: values.timezone.trim(),
    enabled: values.enabled,
    prompt: values.prompt.trim(),
    profile: values.profile.trim(),
    cwd: values.cwd.trim(),
    sandbox: values.sandbox,
    concurrencyPolicy: values.concurrencyPolicy,
    misfirePolicy: values.misfirePolicy
  };
  if (values.model.trim().length > 0) input.model = values.model.trim();
  if (values.reasoning !== '') input.reasoning = values.reasoning;
  if (values.timeoutMs.trim().length > 0) input.timeoutMs = Number(values.timeoutMs);
  return input;
}

export function createScheduleUpdate(values: ScheduleEditorValues): UpdateScheduleRequest {
  return {
    ...createScheduleRequest(values),
    model: values.model.trim() || null,
    reasoning: values.reasoning || null,
    timeoutMs: values.timeoutMs.trim().length > 0 ? Number(values.timeoutMs) : null
  };
}

export function scheduleDetailToEditorValues(schedule: ScheduleDetailResponse): ScheduleEditorValues {
  return {
    name: schedule.name,
    prompt: schedule.prompt,
    cron: schedule.cron,
    timezone: schedule.timezone,
    cwd: schedule.cwd,
    profile: schedule.profile,
    model: schedule.model ?? '',
    reasoning: schedule.reasoning ?? '',
    sandbox: schedule.sandbox,
    timeoutMs: schedule.timeoutMs === null || schedule.timeoutMs === undefined
      ? ''
      : String(schedule.timeoutMs),
    concurrencyPolicy: schedule.concurrencyPolicy,
    misfirePolicy: schedule.misfirePolicy,
    enabled: schedule.enabled
  };
}

function Field(props: {
  label: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`schedule-field${props.wide ? ' schedule-field--wide' : ''}`}>
      <span>{props.label}</span>
      {props.children}
      {props.error ? <small className="schedule-field__error">{props.error}</small> : null}
    </label>
  );
}
