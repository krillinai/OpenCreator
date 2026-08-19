import type {
  CodexProfileResponse,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest,
} from '@opencreator/protocol';
import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock3,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OpenCreatorProject } from '../projects/project-model.js';
import type { ScheduleSidebarTaskStatus } from '../shell/sidebar-task-model.js';
import {
  createScheduleUpdate,
  ScheduleEditor,
  scheduleResponseToEditorValues,
  type ScheduleEditorErrors,
  type ScheduleEditorValues,
  validateScheduleEditorValues,
} from './ScheduleEditor.js';
import './schedules-view.css';

type ScheduleThreadService = {
  getSchedule(id: string): Promise<ScheduleDetailResponse>;
  updateSchedule(id: string, input: UpdateScheduleRequest): Promise<ScheduleResponse>;
};

type Operation = 'run' | 'toggle' | 'load_editor' | 'save_editor';

export function ScheduleThreadHeader(props: {
  schedule: ScheduleResponse;
  status: ScheduleSidebarTaskStatus;
  nextRunLabel?: string;
  service: ScheduleThreadService;
  projects: OpenCreatorProject[];
  profiles?: CodexProfileResponse[];
  onRunNow(schedule: ScheduleResponse): Promise<void> | void;
  onScheduleChanged(schedule: ScheduleResponse): void;
}) {
  const [operation, setOperation] = useState<Operation>();
  const [actionError, setActionError] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorValues, setEditorValues] = useState<ScheduleEditorValues>();
  const [editorErrors, setEditorErrors] = useState<ScheduleEditorErrors>({});
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editorDialogRef = useRef<HTMLElement>(null);
  const visual = statusVisual(props.status);
  const StatusIcon = visual.icon;
  const actionsBusy = operation !== undefined;

  useEffect(() => {
    setEditorOpen(false);
    setEditorValues(undefined);
    setEditorErrors({});
    setActionError(undefined);
    setOperation(undefined);
  }, [props.schedule.id]);

  useEffect(() => {
    if (!editorOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && operation !== 'save_editor') closeEditor();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [editorOpen, operation]);

  useEffect(() => {
    if (!editorOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const selector = editorValues === undefined
        ? 'button'
        : 'input, textarea, select, button';
      editorDialogRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editorOpen, editorValues]);

  async function runNow() {
    if (actionsBusy) return;
    setOperation('run');
    setActionError(undefined);
    try {
      await props.onRunNow(props.schedule);
    } catch (error) {
      setActionError(errorMessage(error, '无法立即运行任务'));
    } finally {
      setOperation(undefined);
    }
  }

  async function toggleEnabled() {
    if (actionsBusy) return;
    setOperation('toggle');
    setActionError(undefined);
    try {
      const updated = await props.service.updateSchedule(props.schedule.id, {
        enabled: !props.schedule.enabled,
      });
      props.onScheduleChanged(updated);
    } catch (error) {
      setActionError(errorMessage(error, '无法更新任务状态'));
    } finally {
      setOperation(undefined);
    }
  }

  async function openEditor() {
    if (actionsBusy) return;
    setEditorOpen(true);
    setEditorValues(undefined);
    setEditorErrors({});
    setOperation('load_editor');
    try {
      const schedule = await props.service.getSchedule(props.schedule.id);
      setEditorValues(scheduleResponseToEditorValues(schedule));
    } catch (error) {
      setEditorErrors({ form: errorMessage(error, '无法加载计划详情') });
    } finally {
      setOperation(undefined);
    }
  }

  async function saveEditor(values: ScheduleEditorValues) {
    if (operation === 'save_editor') return;
    const validationErrors = validateScheduleEditorValues(values);
    if (Object.keys(validationErrors).length > 0) {
      setEditorErrors(validationErrors);
      return;
    }
    setOperation('save_editor');
    setEditorErrors({});
    try {
      const updated = await props.service.updateSchedule(
        props.schedule.id,
        createScheduleUpdate(values)
      );
      props.onScheduleChanged(updated);
      closeEditor();
    } catch (error) {
      setEditorErrors({ form: errorMessage(error, '无法保存计划任务') });
    } finally {
      setOperation(undefined);
    }
  }

  function closeEditor() {
    if (operation === 'save_editor') return;
    setEditorOpen(false);
    setEditorValues(undefined);
    setEditorErrors({});
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  return (
    <>
      <section className="schedule-thread-header" aria-label="任务管理">
        <div className="schedule-thread-main">
          <span
            className="schedule-thread-status"
            data-status={props.status}
            role="status"
            aria-label="任务状态"
          >
            <StatusIcon
              className={props.status === 'running' ? 'schedule-thread-spinner' : undefined}
              size={15}
              aria-hidden="true"
            />
            <strong>{visual.label}</strong>
          </span>
          {props.status === 'idle' && props.nextRunLabel ? (
            <span className="schedule-thread-next">{props.nextRunLabel}</span>
          ) : null}
          {operationLabel(operation) ? (
            <span className="schedule-thread-operation" role="status" aria-label="任务操作状态">
              <LoaderCircle className="schedule-thread-spinner" size={14} aria-hidden="true" />
              {operationLabel(operation)}
            </span>
          ) : null}
        </div>
        <div className="schedule-thread-actions">
          <button
            type="button"
            aria-label="立即运行任务"
            title="立即运行"
            disabled={actionsBusy}
            onClick={() => void runNow()}
          >
            {operation === 'run' ? (
              <LoaderCircle className="schedule-thread-spinner" size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label={props.schedule.enabled ? '暂停任务' : '恢复任务'}
            title={props.schedule.enabled ? '暂停' : '恢复'}
            disabled={actionsBusy}
            onClick={() => void toggleEnabled()}
          >
            {operation === 'toggle' ? (
              <LoaderCircle className="schedule-thread-spinner" size={15} aria-hidden="true" />
            ) : props.schedule.enabled ? (
              <Pause size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
          </button>
          <button
            ref={editButtonRef}
            type="button"
            aria-label="编辑任务"
            title="编辑"
            disabled={actionsBusy}
            onClick={() => void openEditor()}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        </div>
        {actionError ? (
          <p className="schedule-thread-error" role="alert">{actionError}</p>
        ) : null}
      </section>

      {editorOpen ? createPortal((
        <div
          className="schedule-thread-editor-backdrop"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section
            ref={editorDialogRef}
            className="schedule-thread-editor-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`编辑任务 ${props.schedule.name}`}
          >
            {editorValues === undefined ? (
              <div className="schedule-thread-editor-loading">
                <header>
                  <strong>编辑定时任务</strong>
                  <button
                    type="button"
                    aria-label="取消编辑"
                    title="关闭"
                    onClick={closeEditor}
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </header>
                {editorErrors.form ? (
                  <p role="alert">{editorErrors.form}</p>
                ) : (
                  <span role="status">
                    <LoaderCircle className="schedule-thread-spinner" size={17} aria-hidden="true" />
                    正在加载计划详情
                  </span>
                )}
              </div>
            ) : (
              <ScheduleEditor
                mode="edit"
                initialValues={editorValues}
                projects={props.projects}
                saving={operation === 'save_editor'}
                errors={editorErrors}
                onCancel={closeEditor}
                onSubmit={values => void saveEditor(values)}
              />
            )}
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}

function statusVisual(status: ScheduleSidebarTaskStatus) {
  switch (status) {
    case 'idle':
      return { label: '已启用', icon: CircleCheck };
    case 'running':
      return { label: '运行中', icon: LoaderCircle };
    case 'queued':
      return { label: '已排队', icon: Clock3 };
    case 'waiting_approval':
      return { label: '等待审批', icon: ShieldAlert };
    case 'failed':
      return { label: '上次失败', icon: CircleAlert };
    case 'paused':
      return { label: '已暂停', icon: CirclePause };
    case 'repair_required':
      return { label: '需要修复', icon: Wrench };
  }
}

function operationLabel(operation: Operation | undefined): string | undefined {
  switch (operation) {
    case 'run':
      return '正在启动';
    case 'toggle':
      return '正在更新';
    case 'load_editor':
    case 'save_editor':
    case undefined:
      return undefined;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
