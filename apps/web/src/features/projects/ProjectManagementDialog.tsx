import type {
  ReasoningEffort,
  ThreadResponse,
  UpdateProjectRequest
} from '@opencreator/protocol';
import { FolderCog, FolderMinus, FolderPlus, RefreshCw, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import type { OpenCreatorProject } from './project-model.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

const reasoningOptions: Array<{ value: '' | ReasoningEffort; label: string }> = [
  { value: '', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' }
];

export function ProjectManagementDialog(props: {
  open: boolean;
  projects: OpenCreatorProject[];
  archivedProjects: OpenCreatorProject[];
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
  const l = useLocalizedCopy();
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<OpenCreatorProject>();
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
        aria-label={l('项目管理', 'Project management')}
      >
        <header>
          <div>
            <h2>{l('项目管理', 'Project management')}</h2>
            <p>{l('管理项目目录、默认配置和会话归属。', 'Manage project folders, defaults, and conversation assignment.')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={l('关闭项目管理', 'Close project management')} onClick={props.onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}

        <div className="project-management-body">
          <section aria-labelledby="active-projects-title">
            <div className="project-management-section-heading">
              <h3 id="active-projects-title">{l('活跃项目', 'Active projects')}</h3>
              <div className="project-management-actions">
                {props.onAddProject ? (
                  <button type="button" onClick={() => void props.onAddProject?.()}>
                    <FolderPlus size={15} aria-hidden="true" />
                    <span>{l('创建项目', 'Create project')}</span>
                  </button>
                ) : null}
                {props.onAddProjectDirectory ? (
                  <button type="button" onClick={() => void props.onAddProjectDirectory?.()}>
                    <FolderPlus size={15} aria-hidden="true" />
                    <span>{l('使用现有文件夹', 'Use existing folder')}</span>
                  </button>
                ) : null}
              </div>
            </div>
            {props.projects.length === 0 ? (
              <div className="project-management-empty project-management-empty-action">
                <p>{l('还没有项目。创建项目后即可开始对话或认领已有会话。', 'No projects yet. Create one to start working or assign existing conversations.')}</p>
              </div>
            ) : (
              <div className="project-management-list">
                {props.projects.map(project => (
                  <article className="project-management-item" key={project.id}>
                    <div className="project-management-item-copy">
                      <strong>{project.name}</strong>
                      <span>{project.cwd}</span>
                      {project.directoryState === 'missing' ? (
                        <span className="project-directory-warning">{l('目录不可用', 'Folder unavailable')}</span>
                      ) : null}
                    </div>
                    <div className="project-management-actions">
                      <button type="button" onClick={() => setEditingProjectId(project.id)}>
                        {l('编辑', 'Edit')}
                      </button>
                      {props.onReplaceDirectory ? (
                        <button
                          type="button"
                          onClick={() => void props.onReplaceDirectory?.(project.id)}
                        >
                          <FolderCog size={15} aria-hidden="true" />
                          <span>{project.directoryState === 'missing' ? l('修复目录', 'Repair folder') : l('更换目录', 'Change folder')}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={props.busy || removingProjectId === project.id}
                        onClick={() => setProjectPendingRemoval(project)}
                      >
                        <FolderMinus size={15} aria-hidden="true" />
                        <span>{l('移除', 'Remove')}</span>
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
            <h3 id="unassigned-threads-title">{l('待归属会话', 'Unassigned conversations')}</h3>
            {props.unassignedThreads.length === 0 ? (
              <p className="project-management-empty">{l('没有待归属会话', 'No unassigned conversations')}</p>
            ) : props.projects.length === 0 ? (
              <div className="project-management-empty project-management-empty-action">
                <p>{l(`有 ${props.unassignedThreads.length} 个待归属会话。添加项目后即可认领。`, `${props.unassignedThreads.length} conversations are unassigned. Add a project to assign them.`)}</p>
                {props.onAddProject ? (
                  <button type="button" onClick={() => void props.onAddProject?.()}>
                    <FolderPlus size={15} aria-hidden="true" />
                    <span>{l('创建项目', 'Create project')}</span>
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
                            {l('会话目录与目标项目不同，认领不会修改会话目录', 'The conversation folder differs from the project. Assignment will not move it.')}
                          </span>
                        ) : null}
                      </div>
                      <div className="project-assignment-controls">
                        <select
                          aria-label={`${l('目标项目', 'Target project')} ${thread.title?.trim() || thread.id}`}
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
                          {l('认领', 'Assign')}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="archived-projects-title">
            <h3 id="archived-projects-title">{l('已移除项目', 'Removed projects')}</h3>
            {props.archivedProjects.length === 0 ? (
              <p className="project-management-empty">{l('暂无已移除项目', 'No removed projects')}</p>
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
                      <span>{l('恢复', 'Restore')}</span>
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
        title={l('移除项目', 'Remove project')}
        description={projectPendingRemoval === undefined
          ? l('项目目录和文件不会被删除。', 'The project folder and files will not be deleted.')
          : l(`确认从 OpenCreator 中移除“${projectPendingRemoval.name}”？项目目录和文件不会被删除。`, `Remove "${projectPendingRemoval.name}" from OpenCreator? Its folder and files will not be deleted.`)}
        confirmLabel={l('移除项目', 'Remove project')}
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
  project: OpenCreatorProject;
  disabled?: boolean;
  onCancel(): void;
  onSave(input: UpdateProjectRequest): Promise<void>;
}) {
  const l = useLocalizedCopy();
  const confirm = useConfirmDialog();
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
      <h3>{l('编辑', 'Edit')} {props.project.name}</h3>
      <label>
        <span>{l('名称', 'Name')}</span>
        <input value={name} onChange={event => setName(event.currentTarget.value)} />
      </label>
      <label>
        <span>Profile</span>
        <input value={profile} onChange={event => setProfile(event.currentTarget.value)} />
      </label>
      <label>
        <span>{l('模型', 'Model')}</span>
        <input value={model} onChange={event => setModel(event.currentTarget.value)} placeholder={l('默认模型', 'Default model')} />
      </label>
      <label>
        <span>{l('推理强度', 'Reasoning effort')}</span>
        <select value={reasoning} onChange={event => setReasoning(event.currentTarget.value as '' | ReasoningEffort)}>
          {reasoningOptions.map(option => (
            <option key={option.value} value={option.value}>{localizeReasoning(option.label, l)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{l('权限', 'Permission')}</span>
        <select
          value={normalizeProjectSandbox(sandbox)}
          onChange={async event => {
            const value = event.currentTarget.value as OpenCreatorProject['sandbox'];
            if (
              value === 'danger-full-access'
              && sandbox !== 'danger-full-access'
              && !await confirm({
                title: l('开启完全访问权限', 'Enable full access'),
                description: l(
                  '完全访问权限允许 OpenCreator 访问本机文件并执行本地操作。仅为可信项目开启。',
                  'Full access allows OpenCreator to access local files and perform local operations. Enable it only for trusted projects.'
                ),
                confirmLabel: l('开启', 'Enable')
              })
            ) {
              return;
            }
            setSandbox(value);
          }}
        >
          <option value="follow-global">{l('跟随全局', 'Follow global setting')}</option>
          <option value="workspace-write">{l('请求批准', 'Ask for approval')}</option>
          <option value="danger-full-access">{l('完全访问权限', 'Full access')}</option>
        </select>
      </label>
      <div className="project-edit-actions">
        <button type="button" onClick={props.onCancel}>{l('取消', 'Cancel')}</button>
        <button type="submit" disabled={props.disabled || name.trim().length === 0 || profile.trim().length === 0}>
          <Save size={15} aria-hidden="true" />
          <span>{l('保存', 'Save')}</span>
        </button>
      </div>
    </form>
  );
}

function localizeReasoning(label: string, l: ReturnType<typeof useLocalizedCopy>): string {
  const labels: Record<string, string> = { 默认: 'Default', 低: 'Low', 中: 'Medium', 高: 'High', 超高: 'Extra high' };
  return l(label, labels[label] ?? label);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizeProjectSandbox(
  value: OpenCreatorProject['sandbox']
): 'follow-global' | 'workspace-write' | 'danger-full-access' {
  if (value === 'danger-full-access' || value === 'follow-global') return value;
  return 'workspace-write';
}
