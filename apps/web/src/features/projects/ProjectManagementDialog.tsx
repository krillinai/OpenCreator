import type {
  ReasoningEffort,
  ThreadResponse,
  UpdateProjectRequest
} from '@clawee/protocol';
import { FolderCog, FolderMinus, FolderPlus, RefreshCw, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import type { ClaweeProject } from './project-model.js';

const reasoningOptions: Array<{ value: '' | ReasoningEffort; label: string }> = [
  { value: '', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' }
];

export function ProjectManagementDialog(props: {
  open: boolean;
  projects: ClaweeProject[];
  archivedProjects: ClaweeProject[];
  unassignedThreads: ThreadResponse[];
  initialProjectId?: string;
  busy?: boolean;
  error?: string;
  onClose(): void;
  onUpdate(projectId: string, input: UpdateProjectRequest): Promise<void>;
  onArchive(projectId: string): Promise<void>;
  onRestore(projectId: string): Promise<void>;
  onReplaceDirectory?(projectId: string): Promise<void>;
  onAssignThread(threadId: string, projectId: string): Promise<void>;
  onAddProject?(): void | Promise<void>;
  onAddProjectDirectory?(): void | Promise<void>;
}) {
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<ClaweeProject>();
  const [removingProjectId, setRemovingProjectId] = useState<string>();
  const [assignmentByThreadId, setAssignmentByThreadId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!props.open) return;
    setEditingProjectId(props.initialProjectId);
  }, [props.initialProjectId, props.open]);

  useEffect(() => {
    setAssignmentByThreadId(current => {
      const next = { ...current };
      for (const thread of props.unassignedThreads) {
        if (next[thread.id] === undefined && props.projects[0] !== undefined) {
          next[thread.id] = props.projects[0].id;
        }
      }
      return next;
    });
  }, [props.projects, props.unassignedThreads]);

  const editingProject = useMemo(
    () => props.projects.find(project => project.id === editingProjectId),
    [editingProjectId, props.projects]
  );

  if (!props.open) return null;

  return (
    <div className="project-management-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section
        className="project-management-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="项目管理"
      >
        <header>
          <div>
            <h2>项目管理</h2>
            <p>管理项目目录、默认配置和会话归属。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭项目管理" onClick={props.onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}

        <div className="project-management-body">
          <section aria-labelledby="active-projects-title">
            <h3 id="active-projects-title">活跃项目</h3>
            {props.projects.length === 0 ? (
              <div className="project-management-empty project-management-empty-action">
                <p>还没有项目。创建项目后即可开始对话或认领已有会话。</p>
                <div className="project-management-actions">
                  {props.onAddProject ? (
                    <button type="button" onClick={() => void props.onAddProject?.()}>
                      <FolderPlus size={15} aria-hidden="true" />
                      <span>创建项目</span>
                    </button>
                  ) : null}
                  {props.onAddProjectDirectory ? (
                    <button type="button" onClick={() => void props.onAddProjectDirectory?.()}>
                      <FolderPlus size={15} aria-hidden="true" />
                      <span>使用现有文件夹</span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="project-management-list">
                {props.projects.map(project => (
                  <article className="project-management-item" key={project.id}>
                    <div className="project-management-item-copy">
                      <strong>{project.name}</strong>
                      <span>{project.cwd}</span>
                      {project.directoryState === 'missing' ? (
                        <span className="project-directory-warning">目录不可用</span>
                      ) : null}
                    </div>
                    <div className="project-management-actions">
                      <button type="button" onClick={() => setEditingProjectId(project.id)}>
                        编辑
                      </button>
                      {props.onReplaceDirectory ? (
                        <button
                          type="button"
                          onClick={() => void props.onReplaceDirectory?.(project.id)}
                        >
                          <FolderCog size={15} aria-hidden="true" />
                          <span>{project.directoryState === 'missing' ? '修复目录' : '更换目录'}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={props.busy || removingProjectId === project.id}
                        onClick={() => setProjectPendingRemoval(project)}
                      >
                        <FolderMinus size={15} aria-hidden="true" />
                        <span>移除</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {editingProject ? (
            <ProjectEditForm
              key={editingProject.id}
              project={editingProject}
              disabled={props.busy}
              onCancel={() => setEditingProjectId(undefined)}
              onSave={async input => {
                await props.onUpdate(editingProject.id, input);
                setEditingProjectId(undefined);
              }}
            />
          ) : null}

          <section aria-labelledby="unassigned-threads-title">
            <h3 id="unassigned-threads-title">待归属会话</h3>
            {props.unassignedThreads.length === 0 ? (
              <p className="project-management-empty">没有待归属会话</p>
            ) : props.projects.length === 0 ? (
              <div className="project-management-empty project-management-empty-action">
                <p>有 {props.unassignedThreads.length} 个待归属会话。添加项目后即可认领。</p>
                {props.onAddProject ? (
                  <button type="button" onClick={() => void props.onAddProject?.()}>
                    <FolderPlus size={15} aria-hidden="true" />
                    <span>创建项目</span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="project-management-list">
                {props.unassignedThreads.map(thread => {
                  const targetProjectId = assignmentByThreadId[thread.id] ?? '';
                  const targetProject = props.projects.find(project => project.id === targetProjectId);
                  const directoryMismatch =
                    targetProject !== undefined
                    && normalizePath(targetProject.canonicalCwd ?? targetProject.cwd)
                      !== normalizePath(thread.canonicalCwd);
                  return (
                    <article className="project-management-item" key={thread.id}>
                      <div className="project-management-item-copy">
                        <strong>{thread.title?.trim() || thread.id}</strong>
                        <span>{thread.cwd}</span>
                        {directoryMismatch ? (
                          <span className="project-directory-warning">
                            会话目录与目标项目不同，认领不会修改会话目录
                          </span>
                        ) : null}
                      </div>
                      <div className="project-assignment-controls">
                        <select
                          aria-label={`目标项目 ${thread.title?.trim() || thread.id}`}
                          value={targetProjectId}
                          onChange={event => {
                            const projectId = event.currentTarget.value;
                            setAssignmentByThreadId(current => ({
                              ...current,
                              [thread.id]: projectId
                            }));
                          }}
                        >
                          {props.projects.map(project => (
                            <option key={project.id} value={project.id}>{project.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={targetProjectId.length === 0 || props.busy}
                          onClick={() => void props.onAssignThread(thread.id, targetProjectId)}
                        >
                          认领
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="archived-projects-title">
            <h3 id="archived-projects-title">已移除项目</h3>
            {props.archivedProjects.length === 0 ? (
              <p className="project-management-empty">暂无已移除项目</p>
            ) : (
              <div className="project-management-list">
                {props.archivedProjects.map(project => (
                  <article className="project-management-item" key={project.id}>
                    <div className="project-management-item-copy">
                      <strong>{project.name}</strong>
                      <span>{project.cwd}</span>
                    </div>
                    <button type="button" onClick={() => void props.onRestore(project.id)}>
                      <RefreshCw size={15} aria-hidden="true" />
                      <span>恢复</span>
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
      <ConfirmDialog
        open={projectPendingRemoval !== undefined}
        title="移除项目"
        description={projectPendingRemoval === undefined
          ? '项目目录和文件不会被删除。'
          : `确认从 Clawee 中移除“${projectPendingRemoval.name}”？项目目录和文件不会被删除。`}
        confirmLabel="移除项目"
        destructive
        busy={removingProjectId !== undefined}
        onCancel={() => setProjectPendingRemoval(undefined)}
        onConfirm={() => {
          if (projectPendingRemoval === undefined || removingProjectId !== undefined) return;
          const projectId = projectPendingRemoval.id;
          setRemovingProjectId(projectId);
          void props.onArchive(projectId).finally(() => {
            setRemovingProjectId(undefined);
            setProjectPendingRemoval(undefined);
          });
        }}
      />
    </div>
  );
}

function ProjectEditForm(props: {
  project: ClaweeProject;
  disabled?: boolean;
  onCancel(): void;
  onSave(input: UpdateProjectRequest): Promise<void>;
}) {
  const [name, setName] = useState(props.project.name);
  const [profile, setProfile] = useState(props.project.profile);
  const [model, setModel] = useState(props.project.model ?? '');
  const [reasoning, setReasoning] = useState<'' | ReasoningEffort>(
    props.project.reasoning ?? ''
  );
  const [sandbox, setSandbox] = useState(props.project.sandbox);

  return (
    <form className="project-edit-form" onSubmit={event => {
      event.preventDefault();
      void props.onSave({
        name,
        profile,
        model: model.trim().length === 0 ? null : model,
        reasoning: reasoning === '' ? null : reasoning,
        sandbox
      });
    }}>
      <h3>编辑 {props.project.name}</h3>
      <label>
        <span>名称</span>
        <input value={name} onChange={event => setName(event.currentTarget.value)} />
      </label>
      <label>
        <span>Profile</span>
        <input value={profile} onChange={event => setProfile(event.currentTarget.value)} />
      </label>
      <label>
        <span>模型</span>
        <input value={model} onChange={event => setModel(event.currentTarget.value)} placeholder="默认模型" />
      </label>
      <label>
        <span>推理强度</span>
        <select value={reasoning} onChange={event => setReasoning(event.currentTarget.value as '' | ReasoningEffort)}>
          {reasoningOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>权限</span>
        <select
          value={normalizeProjectSandbox(sandbox)}
          onChange={event => {
            const value = event.currentTarget.value as ClaweeProject['sandbox'];
            if (
              value === 'danger-full-access'
              && sandbox !== 'danger-full-access'
              && !window.confirm(
                '完全访问权限允许 Clawee 访问本机文件并执行本地操作。确定要为此项目开启吗？'
              )
            ) {
              return;
            }
            setSandbox(value);
          }}
        >
          <option value="follow-global">跟随全局</option>
          <option value="workspace-write">请求批准</option>
          <option value="danger-full-access">完全访问权限</option>
        </select>
      </label>
      <div className="project-edit-actions">
        <button type="button" onClick={props.onCancel}>取消</button>
        <button type="submit" disabled={props.disabled || name.trim().length === 0 || profile.trim().length === 0}>
          <Save size={15} aria-hidden="true" />
          <span>保存</span>
        </button>
      </div>
    </form>
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizeProjectSandbox(
  value: ClaweeProject['sandbox']
): 'follow-global' | 'workspace-write' | 'danger-full-access' {
  if (value === 'danger-full-access' || value === 'follow-global') return value;
  return 'workspace-write';
}
