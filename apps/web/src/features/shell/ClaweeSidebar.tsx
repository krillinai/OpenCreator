import type { EnterpriseSessionResponse } from '@clawee/protocol';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  Activity,
  Blocks,
  CircleAlert,
  Clock3,
  Folder,
  FolderCog,
  FolderMinus,
  FolderPlus,
  FolderOpen,
  LibraryBig,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  Search,
  Settings,
  Settings2,
  ShieldAlert,
  SquarePen,
  Trash2,
  TriangleAlert,
  UserRound,
  type LucideIcon
} from 'lucide-react';
import type { ActiveView } from '../../app/app-state.js';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import type { ColorMode } from '../../styles/color-mode.js';
import type {
  ClaweeConversation,
  ClaweeProject
} from '../projects/project-model.js';
import type {
  SidebarTaskStatus,
  SidebarTaskSummary
} from './sidebar-task-model.js';

export function ClaweeSidebar(props: {
  projects: ClaweeProject[];
  conversations: ClaweeConversation[];
  tasks: SidebarTaskSummary[];
  runningConversationIds?: ReadonlySet<string>;
  currentProjectId?: string;
  selectedConversationId?: string;
  activeView: ActiveView;
  collapsed?: boolean;
  autoCollapsed?: boolean;
  colorMode?: ColorMode;
  enterpriseSession?: EnterpriseSessionResponse;
  onNewConversation(projectId?: string): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onSelectTask(threadId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenAccount(): void;
  onOpenSettings(): void;
  onToggleCollapsed(): void;
  onAddProject?(): void;
  onManageProjects?(): void;
  onEditProject?(projectId: string): void;
  onReplaceProjectDirectory?(projectId: string): void;
  onArchiveProject?(projectId: string): void;
  onArchiveConversation?(conversationId: string): void | Promise<void>;
  onDeleteTaskDraft?(threadId: string): void | Promise<void>;
}) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(props.currentProjectId);
  const [projectMenuId, setProjectMenuId] = useState<string>();
  const [archivingConversationId, setArchivingConversationId] = useState<string>();
  const [deletingDraftThreadId, setDeletingDraftThreadId] = useState<string>();
  const [draftPendingDeletion, setDraftPendingDeletion] = useState<{ threadId: string }>();
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<{
    id: string;
    name: string;
  }>();
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const collapsed = props.collapsed === true;
  const autoCollapsed = props.autoCollapsed === true;
  const account = props.enterpriseSession?.account;
  const accountTitle = account?.name ?? '企业账户';
  const accountLabel = account === undefined
    ? '企业账户'
    : `${account.name} ${account.email}`;
  const fullLogoSrc = props.colorMode === 'light' ? '/logo-v2-black.svg' : '/logo-v2-white.svg';
  const globalActions: Array<{
    label: string;
    icon: LucideIcon;
    view?: ActiveView;
    onClick(): void;
  }> = [
    { label: '新对话', icon: SquarePen, onClick: () => props.onNewConversation() },
    { label: 'Agent 活动', icon: Activity, view: 'activity', onClick: () => props.onOpenView('activity') },
    { label: '搜索', icon: Search, view: 'search', onClick: () => props.onOpenView('search') },
    { label: '定时任务', icon: Clock3, view: 'schedules', onClick: () => props.onOpenView('schedules') },
    { label: '插件', icon: Blocks, view: 'plugins', onClick: () => props.onOpenView('plugins') },
    { label: '知识库', icon: LibraryBig, view: 'knowledge', onClick: () => props.onOpenView('knowledge') }
  ];
  const conversationsByProject = new Map<string, ClaweeConversation[]>();
  const selectedTaskThread = props.tasks.some(
    task => task.threadId === props.selectedConversationId
  );

  for (const conversation of props.conversations) {
    const projectConversations = conversationsByProject.get(conversation.projectId) ?? [];
    projectConversations.push(conversation);
    conversationsByProject.set(conversation.projectId, projectConversations);
  }

  useEffect(() => {
    setExpandedProjectId(props.currentProjectId);
  }, [props.currentProjectId]);

  useEffect(() => {
    if (projectMenuId === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setProjectMenuId(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectMenuId(undefined);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [projectMenuId]);

  return (
    <nav className="clawee-sidebar" aria-label="Clawee" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-brand">
        {collapsed ? (
          <button
            className="sidebar-brand-button sidebar-expand-button"
            type="button"
            aria-disabled={autoCollapsed || undefined}
            aria-label={autoCollapsed ? '侧栏已自动收起' : '展开侧栏'}
            title={autoCollapsed ? '窗口较窄，关闭文件工作区后可展开侧栏' : '展开侧栏'}
            onClick={autoCollapsed ? undefined : props.onToggleCollapsed}
          >
            <img
              className="sidebar-logo-image sidebar-logo-mark"
              src={props.colorMode === 'light' ? '/logo-v2-black-logo.svg' : '/logo-v2-white-logo.svg'}
              alt="Clawee"
            />
            <PanelLeftOpen className="sidebar-expand-icon" size={19} strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : (
          <>
            <div className="sidebar-logo-lockup">
              <span className="sidebar-logo-word">Clawee</span>
            </div>
            <button
              className="sidebar-collapse-button"
              type="button"
              aria-label="收起侧栏"
              title="收起侧栏"
              onClick={props.onToggleCollapsed}
            >
              <PanelLeftClose size={18} strokeWidth={1.85} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="sidebar-primary">
        {globalActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="sidebar-row"
              title={collapsed ? action.label : undefined}
              aria-current={action.view && props.activeView === action.view ? 'page' : undefined}
              onClick={action.onClick}
            >
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      {collapsed ? null : (
        <section className="sidebar-section" aria-labelledby="clawee-projects-heading">
          <div className="sidebar-section-heading">
            <h2 id="clawee-projects-heading">项目</h2>
            {props.onAddProject || props.onManageProjects ? (
              <div className="sidebar-section-actions">
                {props.onAddProject ? (
                  <button
                    type="button"
                    className="sidebar-section-action"
                    aria-label="创建项目"
                    title="创建项目"
                    onClick={props.onAddProject}
                  >
                    <FolderPlus size={16} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}
                {props.onManageProjects ? (
                  <button
                    type="button"
                    className="sidebar-section-action"
                    aria-label="管理项目"
                    title="管理项目"
                    onClick={props.onManageProjects}
                  >
                    <Settings2 size={16} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="sidebar-project-tree" aria-label="项目和对话">
            {props.projects.map((project) => {
              const isCurrentProject =
                !selectedTaskThread && project.id === props.currentProjectId;
              const isExpanded = project.id === expandedProjectId;
              const projectConversations = conversationsByProject.get(project.id) ?? [];
              const ProjectIcon = isCurrentProject ? FolderOpen : Folder;

              return (
                <div className="sidebar-project-node" key={project.id}>
                  <div className="sidebar-project-row-shell">
                    <button
                      type="button"
                      className="sidebar-row project-row"
                      data-current-project={isCurrentProject ? 'true' : undefined}
                      aria-expanded={isExpanded}
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedProjectId(undefined);
                          return;
                        }
                        setExpandedProjectId(project.id);
                        if (projectConversations.length === 0) {
                          props.onSelectProject(project.id);
                        }
                      }}
                    >
                      <ProjectIcon className="project-icon" size={18} strokeWidth={1.85} aria-hidden="true" />
                      <span>{project.name}</span>
                    </button>
                    <div
                      className="sidebar-project-actions"
                      ref={projectMenuId === project.id ? projectMenuRef : undefined}
                    >
                      <button
                        type="button"
                        className="sidebar-project-new-conversation"
                        aria-label={`在 ${project.name} 中新建会话`}
                        title="新建会话"
                        onClick={() => props.onNewConversation(project.id)}
                      >
                        <SquarePen size={16} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      {props.onArchiveProject ? (
                        <div className="sidebar-project-menu-shell">
                          <button
                            type="button"
                            className="sidebar-project-menu-trigger"
                            aria-label={`项目操作 ${project.name}`}
                            title="项目操作"
                            aria-haspopup="menu"
                            aria-expanded={projectMenuId === project.id}
                            onClick={() => setProjectMenuId(
                              current => current === project.id ? undefined : project.id
                            )}
                          >
                            <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                          {projectMenuId === project.id ? (
                            <div
                              className="sidebar-project-menu"
                              role="menu"
                              aria-label={`${project.name} 项目操作`}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setProjectMenuId(undefined);
                                  props.onEditProject?.(project.id);
                                }}
                              >
                                <Settings2 size={15} strokeWidth={1.9} aria-hidden="true" />
                                <span>编辑项目</span>
                              </button>
                              {props.onReplaceProjectDirectory ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setProjectMenuId(undefined);
                                    props.onReplaceProjectDirectory?.(project.id);
                                  }}
                                >
                                  <FolderCog size={15} strokeWidth={1.9} aria-hidden="true" />
                                  <span>更换目录</span>
                                </button>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                aria-label={`移除项目 ${project.name}`}
                                title="仅从项目列表移除，不会删除本机文件"
                                onClick={() => {
                                  setProjectMenuId(undefined);
                                  setProjectPendingRemoval({ id: project.id, name: project.name });
                                }}
                              >
                                <FolderMinus size={15} strokeWidth={1.9} aria-hidden="true" />
                                <span>移除项目</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {isExpanded && projectConversations.length > 0 ? (
                    <div className="sidebar-conversation-tree" aria-label={`${project.name} 对话`}>
                      {projectConversations.map((conversation) => {
                        const isRunning = props.runningConversationIds?.has(conversation.id) === true;
                        return (
                          <div
                            key={conversation.id}
                            className="sidebar-conversation-row-shell"
                            data-has-action={props.onArchiveConversation === undefined ? 'false' : 'true'}
                            role="group"
                            aria-label={conversation.title}
                          >
                            <button
                              type="button"
                              className="conversation-row nested-conversation-row"
                              aria-current={conversation.id === props.selectedConversationId ? 'page' : undefined}
                              onClick={() => props.onSelectConversation(conversation.id)}
                            >
                              <strong>{conversation.title}</strong>
                              <span className="conversation-row-meta">
                                {isRunning ? (
                                  <LoaderCircle
                                    className="conversation-run-spinner"
                                    size={13}
                                    strokeWidth={2}
                                    aria-label="正在运行"
                                  />
                                ) : null}
                                <span className="conversation-updated-label">{conversation.updatedLabel}</span>
                              </span>
                            </button>
                            {props.onArchiveConversation ? (
                              <button
                                type="button"
                                className="sidebar-conversation-archive"
                                aria-label="归档"
                                title={isRunning ? '任务运行结束后可归档' : '归档会话'}
                                disabled={
                                  isRunning
                                  || archivingConversationId === conversation.id
                                }
                                onClick={async () => {
                                  if (!window.confirm(
                                    `归档“${conversation.title}”？归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。`
                                  )) {
                                    return;
                                  }
                                  setArchivingConversationId(conversation.id);
                                  try {
                                    await props.onArchiveConversation?.(conversation.id);
                                  } finally {
                                    setArchivingConversationId(undefined);
                                  }
                                }}
                              >
                                {archivingConversationId === conversation.id ? (
                                  <LoaderCircle
                                    className="conversation-run-spinner"
                                    size={14}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Archive size={14} strokeWidth={1.9} aria-hidden="true" />
                                )}
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {collapsed ? null : (
        <section
          className="sidebar-section sidebar-task-section"
          aria-labelledby="clawee-tasks-heading"
        >
          <h2 id="clawee-tasks-heading">任务</h2>
          {props.tasks.length === 0 ? (
            <p className="sidebar-empty">暂无任务</p>
          ) : (
            <div className="sidebar-task-list" aria-label="任务会话">
              {props.tasks.map(task => {
                const visual = taskStatusVisual(task.status);
                const StatusIcon = visual.icon;
                const disabled = task.status === 'repair_required' || task.threadId === undefined;
                const detail = task.status === 'idle'
                  ? task.nextRunLabel ?? visual.label
                  : visual.label;
                const canDeleteDraft =
                  task.status === 'draft'
                  && task.threadId !== undefined
                  && props.onDeleteTaskDraft !== undefined;
                return (
                  <div
                    className="sidebar-task-row-shell"
                    data-status={task.status}
                    key={task.id}
                  >
                    <button
                      type="button"
                      className="sidebar-task-row"
                      data-status={task.status}
                      aria-current={task.threadId === props.selectedConversationId ? 'page' : undefined}
                      disabled={disabled}
                      onClick={() => {
                        if (task.threadId !== undefined) props.onSelectTask(task.threadId);
                      }}
                    >
                      <StatusIcon
                        className={task.status === 'running' ? 'sidebar-task-spinner' : 'sidebar-task-icon'}
                        size={16}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      <span className="sidebar-task-copy">
                        <strong>{task.name}</strong>
                        <span>{detail}</span>
                      </span>
                      {task.unread ? (
                        <span className="sidebar-task-unread" aria-label="未读更新" />
                      ) : null}
                    </button>
                    {canDeleteDraft ? (
                      <button
                        type="button"
                        className="sidebar-task-delete"
                        aria-label={`删除草稿 ${task.name}`}
                        title="删除草稿"
                        disabled={deletingDraftThreadId === task.threadId}
                        onClick={() => {
                          if (task.threadId === undefined) return;
                          setDraftPendingDeletion({ threadId: task.threadId });
                        }}
                      >
                        {deletingDraftThreadId === task.threadId ? (
                          <LoaderCircle className="sidebar-task-spinner" size={15} aria-hidden="true" />
                        ) : (
                          <Trash2 size={15} aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="sidebar-bottom">
        <button
          className="sidebar-account-button"
          type="button"
          aria-label={accountLabel}
          aria-current={props.activeView === 'account' ? 'page' : undefined}
          title={collapsed ? accountTitle : undefined}
          onClick={props.onOpenAccount}
        >
          <span className="sidebar-account-avatar" aria-hidden="true">
            <UserRound size={16} strokeWidth={2} />
          </span>
          <span className="sidebar-account-copy">
            <strong>{accountTitle}</strong>
            {account === undefined ? null : <small>{account.email}</small>}
          </span>
        </button>
        <button
          className="sidebar-settings-button"
          type="button"
          aria-label="设置"
          aria-current={props.activeView === 'settings' ? 'page' : undefined}
          title="设置"
          onClick={props.onOpenSettings}
        >
          <Settings size={17} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <ConfirmDialog
        open={projectPendingRemoval !== undefined}
        title="移除项目"
        description={projectPendingRemoval === undefined
          ? '项目目录和文件不会被删除。'
          : `确认从 Clawee 中移除“${projectPendingRemoval.name}”？项目目录和文件不会被删除。`}
        confirmLabel="移除项目"
        destructive
        onCancel={() => setProjectPendingRemoval(undefined)}
        onConfirm={() => {
          if (projectPendingRemoval === undefined) return;
          props.onArchiveProject?.(projectPendingRemoval.id);
          setProjectPendingRemoval(undefined);
        }}
      />
      <ConfirmDialog
        open={draftPendingDeletion !== undefined}
        title="删除任务草稿"
        description="此操作不会删除项目文件。"
        confirmLabel="删除草稿"
        destructive
        busy={deletingDraftThreadId !== undefined}
        onCancel={() => setDraftPendingDeletion(undefined)}
        onConfirm={() => {
          if (draftPendingDeletion === undefined || deletingDraftThreadId !== undefined) return;
          const { threadId } = draftPendingDeletion;
          setDeletingDraftThreadId(threadId);
          void Promise.resolve(props.onDeleteTaskDraft?.(threadId)).finally(() => {
            setDeletingDraftThreadId(undefined);
            setDraftPendingDeletion(undefined);
          });
        }}
      />
    </nav>
  );
}

function taskStatusVisual(status: SidebarTaskStatus): {
  icon: LucideIcon;
  label: string;
} {
  switch (status) {
    case 'draft':
      return { icon: SquarePen, label: '草稿' };
    case 'running':
      return { icon: LoaderCircle, label: '运行中' };
    case 'queued':
      return { icon: Clock3, label: '排队中' };
    case 'waiting_approval':
      return { icon: ShieldAlert, label: '待审批' };
    case 'failed':
      return { icon: CircleAlert, label: '失败' };
    case 'paused':
      return { icon: PauseCircle, label: '已暂停' };
    case 'repair_required':
      return { icon: TriangleAlert, label: '需修复' };
    case 'idle':
      return { icon: Clock3, label: '等待首次运行' };
  }
}
