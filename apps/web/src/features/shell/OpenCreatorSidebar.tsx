import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  CircleAlert,
  Clock3,
  Folder,
  FolderCog,
  FolderKanban,
  FolderMinus,
  FolderPlus,
  FolderOpen,
  House,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  PauseCircle,
  Pin,
  PinOff,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';
import type { ActiveView } from '../../app/app-state.js';
import OpenCreatorMark from '../../components/brand/OpenCreatorMark.js';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import type { ColorMode } from '../../styles/color-mode.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import type {
  OpenCreatorConversation,
  OpenCreatorProject
} from '../projects/project-model.js';
import type {
  SidebarTaskStatus,
  SidebarTaskSummary
} from './sidebar-task-model.js';

const SIDEBAR_ACTION_MENU_WIDTH = 154;
const SIDEBAR_ACTION_MENU_MAX_HEIGHT = 104;
const SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN = 8;
const SIDEBAR_ACTION_MENU_GAP = 4;

export function OpenCreatorSidebar(props: {
  projects: OpenCreatorProject[];
  conversations: OpenCreatorConversation[];
  tasks: SidebarTaskSummary[];
  runningConversationIds?: ReadonlySet<string>;
  currentProjectId?: string;
  selectedConversationId?: string;
  activeView: ActiveView;
  homeActive?: boolean;
  projectNavigationMode?: 'library' | 'tree';
  collapsed?: boolean;
  autoCollapsed?: boolean;
  colorMode?: ColorMode;
  onNewConversation(projectId?: string): void;
  onOpenHome(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onSelectTask(threadId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenSettings(): void;
  onToggleCollapsed(): void;
  onAddProject?(): void;
  onManageProjects?(): void;
  onEditProject?(projectId: string): void;
  onReplaceProjectDirectory?(projectId: string): void;
  onArchiveProject?(projectId: string): void;
  onArchiveConversation?(conversationId: string): void | Promise<void>;
  onRenameConversation?(conversationId: string, title: string): void | Promise<void>;
  onPinConversation?(conversationId: string, pinned: boolean): void | Promise<void>;
  onDeleteConversation?(conversationId: string): void | Promise<void>;
  onDeleteTaskDraft?(threadId: string): void | Promise<void>;
  onArchiveTask?(task: SidebarTaskSummary): void | Promise<void>;
  onRenameTask?(task: SidebarTaskSummary, title: string): void | Promise<void>;
  onDeleteTask?(task: SidebarTaskSummary): void | Promise<void>;
}) {
  const { t } = useAppLanguage();
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(props.currentProjectId);
  const [projectMenuId, setProjectMenuId] = useState<string>();
  const [archivingConversationId, setArchivingConversationId] = useState<string>();
  const [conversationPendingArchive, setConversationPendingArchive] = useState<{
    id: string;
    title: string;
  }>();
  const [conversationMenuId, setConversationMenuId] = useState<string>();
  const [conversationMenuPosition, setConversationMenuPosition] = useState<{ top: number; left: number }>();
  const [conversationRename, setConversationRename] = useState<{
    id: string;
    originalTitle: string;
    title: string;
  }>();
  const [conversationPendingDeletion, setConversationPendingDeletion] = useState<{
    id: string;
    title: string;
  }>();
  const [conversationActionBusyId, setConversationActionBusyId] = useState<string>();
  const [deletingDraftThreadId, setDeletingDraftThreadId] = useState<string>();
  const [draftPendingDeletion, setDraftPendingDeletion] = useState<{ threadId: string }>();
  const [taskMenuId, setTaskMenuId] = useState<string>();
  const [taskMenuPosition, setTaskMenuPosition] = useState<{ top: number; left: number }>();
  const [taskRename, setTaskRename] = useState<{ id: string; originalTitle: string; title: string }>();
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<SidebarTaskSummary>();
  const [taskActionBusyId, setTaskActionBusyId] = useState<string>();
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<{
    id: string;
    name: string;
  }>();
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const conversationMenuPortalRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuPortalRef = useRef<HTMLDivElement>(null);
  const renameCanceledRef = useRef(false);
  const collapsed = props.collapsed === true;
  const autoCollapsed = props.autoCollapsed === true;
  const globalActions: Array<{
    label: string;
    icon: LucideIcon;
    current: boolean;
    onClick(): void;
  }> = [
    {
      label: t('nav.home'),
      icon: House,
      current: props.homeActive === true,
      onClick: props.onOpenHome
    },
    {
      label: t('nav.dashboard'),
      icon: PanelsTopLeft,
      current: props.activeView === 'dashboard',
      onClick: () => props.onOpenView('dashboard')
    },
    {
      label: t('nav.projects'),
      icon: FolderKanban,
      current: props.activeView === 'projects',
      onClick: () => props.onOpenView('projects')
    },
    {
      label: t('nav.settings'),
      icon: SlidersHorizontal,
      current: props.activeView === 'settings',
      onClick: props.onOpenSettings
    }
  ];
  if (props.projectNavigationMode === 'tree') {
    globalActions.push({
      label: t('nav.schedules'),
      icon: Clock3,
      current: props.activeView === 'schedules',
      onClick: () => props.onOpenView('schedules')
    });
  }
  const conversationsByProject = new Map<string, OpenCreatorConversation[]>();
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

  useEffect(() => {
    if (conversationMenuId === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !conversationMenuRef.current?.contains(target)
        && !conversationMenuPortalRef.current?.contains(target)
      ) {
        setConversationMenuId(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConversationMenuId(undefined);
    };
    const closeOnViewportChange = () => setConversationMenuId(undefined);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [conversationMenuId]);

  useEffect(() => {
    if (taskMenuId === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !taskMenuRef.current?.contains(target)
        && !taskMenuPortalRef.current?.contains(target)
      ) setTaskMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTaskMenuId(undefined);
    };
    const closeOnViewportChange = () => setTaskMenuId(undefined);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [taskMenuId]);

  return (
    <nav className="opencreator-sidebar" aria-label="OpenCreator" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-brand">
        {collapsed ? (
          <button
            className="sidebar-brand-button sidebar-expand-button"
            type="button"
            aria-disabled={autoCollapsed || undefined}
            aria-label={autoCollapsed ? t('nav.autoCollapsed') : t('nav.expand')}
            title={autoCollapsed ? t('nav.autoCollapsedHint') : t('nav.expand')}
            onClick={autoCollapsed ? undefined : props.onToggleCollapsed}
          >
            <OpenCreatorMark
              className="sidebar-logo-image"
              size={28}
              aria-hidden="true"
            />
            <PanelLeftOpen className="sidebar-expand-icon" size={19} strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : (
          <>
            <div className="sidebar-logo-lockup">
              <span className="sidebar-logo-word">OpenCreator</span>
            </div>
            <div className="sidebar-brand-actions">
              <button
                className="sidebar-collapse-button"
                type="button"
                aria-label={t('nav.collapse')}
                title={t('nav.collapse')}
                onClick={props.onToggleCollapsed}
              >
                <PanelLeftClose size={18} strokeWidth={1.85} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="sidebar-primary">
        {globalActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              className="sidebar-row"
              key={action.label}
              title={collapsed ? action.label : undefined}
              aria-current={action.current ? 'page' : undefined}
              onClick={action.onClick}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="sidebar-row-label">{action.label}</span>
            </button>
          );
        })}
      </div>

      {collapsed || props.projectNavigationMode !== 'tree' ? null : (
        <section className="sidebar-section" aria-labelledby="opencreator-projects-heading">
          <div className="sidebar-section-heading">
            <h2 id="opencreator-projects-heading">项目</h2>
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
                            data-has-action="true"
                            role="group"
                            aria-label={conversation.title}
                          >
                            {conversationRename?.id === conversation.id ? (
                              <input
                                className="sidebar-conversation-rename-input"
                                aria-label={`重命名 ${conversationRename.originalTitle}`}
                                autoFocus
                                value={conversationRename.title}
                                onChange={event => setConversationRename(current => (
                                  current === undefined ? current : { ...current, title: event.target.value }
                                ))}
                                onKeyDown={event => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    renameCanceledRef.current = true;
                                    setConversationRename(undefined);
                                  }
                                }}
                                onBlur={() => {
                                  if (renameCanceledRef.current) {
                                    renameCanceledRef.current = false;
                                    return;
                                  }
                                  const nextTitle = conversationRename.title.trim();
                                  if (nextTitle.length === 0 || nextTitle === conversationRename.originalTitle) {
                                    setConversationRename(undefined);
                                    return;
                                  }
                                  setConversationActionBusyId(conversation.id);
                                  void Promise.resolve(
                                    props.onRenameConversation?.(conversation.id, nextTitle)
                                  ).finally(() => {
                                    setConversationActionBusyId(undefined);
                                    setConversationRename(undefined);
                                  });
                                }}
                              />
                            ) : <button
                              type="button"
                              className="conversation-row nested-conversation-row"
                              aria-current={
                                props.activeView === 'conversation'
                                && conversation.id === props.selectedConversationId
                                  ? 'page'
                                  : undefined
                              }
                              onClick={() => props.onSelectConversation(conversation.id)}
                            >
                              <strong>
                                <span className="conversation-title-default">{conversation.title}</span>
                                <span className="conversation-title-hover" aria-hidden="true">
                                  {abbreviateConversationTitle(conversation.title)}
                                </span>
                              </strong>
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
                            </button>}
                            <div
                              className="sidebar-conversation-actions"
                              ref={conversationMenuId === conversation.id ? conversationMenuRef : undefined}
                            >
                              <div className="sidebar-conversation-menu-shell">
                                <button
                                  type="button"
                                  className="sidebar-conversation-action"
                                  aria-label="更多"
                                  title="更多"
                                  aria-haspopup="menu"
                                  aria-expanded={conversationMenuId === conversation.id}
                                  onClick={event => {
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setConversationMenuPosition(positionSidebarActionMenu(rect));
                                    setConversationMenuId(current => (
                                      current === conversation.id ? undefined : conversation.id
                                    ));
                                  }}
                                >
                                  <MoreHorizontal size={16} strokeWidth={1.9} aria-hidden="true" />
                                </button>
                                {conversationMenuId === conversation.id && conversationMenuPosition !== undefined
                                  ? createPortal((
                                    <div
                                      className="sidebar-conversation-menu sidebar-conversation-menu--portal"
                                      role="menu"
                                      aria-label={`${conversation.title} 操作`}
                                      ref={conversationMenuPortalRef}
                                      style={conversationMenuPosition}
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setConversationMenuId(undefined);
                                          setConversationRename({
                                            id: conversation.id,
                                            originalTitle: conversation.title,
                                            title: conversation.title
                                          });
                                        }}
                                      >
                                        <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
                                        <span>重命名</span>
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="is-destructive"
                                        disabled={isRunning}
                                        onClick={() => {
                                          setConversationMenuId(undefined);
                                          setConversationPendingDeletion({
                                            id: conversation.id,
                                            title: conversation.title
                                          });
                                        }}
                                      >
                                        <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
                                        <span>删除任务</span>
                                      </button>
                                    </div>
                                  ), document.body)
                                  : null}
                              </div>
                              {props.onArchiveConversation ? (
                              <button
                                type="button"
                                className="sidebar-conversation-action sidebar-conversation-archive"
                                aria-label="归档"
                                title={isRunning ? '任务运行结束后可归档' : '归档会话'}
                                disabled={
                                  isRunning
                                  || archivingConversationId === conversation.id
                                  || conversationActionBusyId === conversation.id
                                }
                                onClick={() => {
                                  setConversationPendingArchive({
                                    id: conversation.id,
                                    title: conversation.title
                                  });
                                }}
                              >
                                {archivingConversationId === conversation.id ? (
                                  <LoaderCircle
                                    className="conversation-run-spinner"
                                    size={16}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Archive size={16} strokeWidth={1.9} aria-hidden="true" />
                                )}
                              </button>
                              ) : null}
                              {props.onPinConversation ? (
                                <button
                                  type="button"
                                  className="sidebar-conversation-action"
                                  aria-label={conversation.pinnedAt == null ? '置顶' : '取消置顶'}
                                  title={conversation.pinnedAt == null ? '置顶会话' : '取消置顶'}
                                  disabled={conversationActionBusyId === conversation.id}
                                  onClick={() => {
                                    setConversationActionBusyId(conversation.id);
                                    void Promise.resolve(props.onPinConversation?.(
                                      conversation.id,
                                      conversation.pinnedAt == null
                                    )).finally(() => setConversationActionBusyId(undefined));
                                  }}
                                >
                                  {conversation.pinnedAt == null
                                    ? <Pin size={16} strokeWidth={1.9} aria-hidden="true" />
                                    : <PinOff size={16} strokeWidth={1.9} aria-hidden="true" />}
                                </button>
                              ) : null}
                            </div>
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

      {collapsed || props.projectNavigationMode !== 'tree' ? null : (
        <section
          className="sidebar-section sidebar-task-section"
          aria-labelledby="opencreator-tasks-heading"
        >
          <h2 id="opencreator-tasks-heading">任务</h2>
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
                const isRunning = task.status === 'running' || task.status === 'queued';
                const isRenaming = taskRename?.id === task.id;
                return (
                  <div
                    className="sidebar-task-row-shell"
                    data-status={task.status}
                    key={task.id}
                  >
                    {isRenaming ? (
                      <input
                        className="sidebar-task-rename-input"
                        aria-label={`重命名任务 ${task.name}`}
                        autoFocus
                        value={taskRename.title}
                        onChange={event => setTaskRename(current => current === undefined
                          ? current
                          : { ...current, title: event.target.value })}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            renameCanceledRef.current = true;
                            setTaskRename(undefined);
                          } else if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                        }}
                        onBlur={() => {
                          if (renameCanceledRef.current) {
                            renameCanceledRef.current = false;
                            return;
                          }
                          const title = taskRename.title.trim();
                          if (title.length === 0 || title === taskRename.originalTitle) {
                            setTaskRename(undefined);
                            return;
                          }
                          setTaskActionBusyId(task.id);
                          void Promise.resolve(props.onRenameTask?.(task, title)).finally(() => {
                            setTaskActionBusyId(undefined);
                            setTaskRename(undefined);
                          });
                        }}
                      />
                    ) : <button
                      type="button"
                      className="sidebar-task-row"
                      data-status={task.status}
                      aria-current={
                        props.activeView === 'conversation'
                        && task.threadId === props.selectedConversationId
                          ? 'page'
                          : undefined
                      }
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
                    </button>}
                    {isRenaming ? null : (
                      <div className="sidebar-task-actions" ref={taskMenuId === task.id ? taskMenuRef : undefined}>
                        <div className="sidebar-task-menu-shell">
                          <button
                            type="button"
                            className="sidebar-task-action"
                            aria-label={`更多 ${task.name}`}
                            aria-haspopup="menu"
                            aria-expanded={taskMenuId === task.id}
                            onClick={event => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setTaskMenuPosition(positionSidebarActionMenu(rect));
                              setTaskMenuId(current => current === task.id ? undefined : task.id);
                            }}
                          >
                            <MoreHorizontal size={14} aria-hidden="true" />
                          </button>
                          {taskMenuId === task.id && taskMenuPosition !== undefined ? createPortal((
                            <div
                              className="sidebar-task-menu sidebar-task-menu--portal"
                              role="menu"
                              aria-label={`${task.name} 操作`}
                              ref={taskMenuPortalRef}
                              style={taskMenuPosition}
                            >
                              <button type="button" role="menuitem" onClick={() => {
                                setTaskMenuId(undefined);
                                setTaskRename({ id: task.id, originalTitle: task.name, title: task.name });
                              }}>
                                <Pencil size={15} aria-hidden="true" /><span>重命名</span>
                              </button>
                              <button type="button" role="menuitem" className="is-destructive" disabled={isRunning} onClick={() => {
                                setTaskMenuId(undefined);
                                setTaskPendingDeletion(task);
                              }}>
                                <Trash2 size={15} aria-hidden="true" /><span>删除任务</span>
                              </button>
                            </div>
                          ), document.body) : null}
                        </div>
                      <button
                        type="button"
                        className="sidebar-task-action sidebar-task-archive"
                        aria-label={`归档 ${task.name}`}
                        title={isRunning ? '任务运行结束后可归档' : '归档任务'}
                        disabled={isRunning || taskActionBusyId === task.id}
                        onClick={() => {
                          setTaskActionBusyId(task.id);
                          void Promise.resolve(props.onArchiveTask?.(task)).finally(() => setTaskActionBusyId(undefined));
                        }}
                      >
                        {taskActionBusyId === task.id ? (
                          <LoaderCircle className="sidebar-task-spinner" size={15} aria-hidden="true" />
                        ) : (
                          <Archive size={14} aria-hidden="true" />
                        )}
                      </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={conversationPendingDeletion !== undefined}
        title="删除任务"
        description={conversationPendingDeletion === undefined
          ? '永久删除后无法恢复，但不会删除项目文件。'
          : `确认永久删除“${conversationPendingDeletion.title}”？会话及历史记录将无法恢复，但不会删除项目文件。`}
        confirmLabel="永久删除"
        destructive
        busy={conversationActionBusyId !== undefined}
        onCancel={() => setConversationPendingDeletion(undefined)}
        onConfirm={() => {
          if (conversationPendingDeletion === undefined || conversationActionBusyId !== undefined) return;
          const { id } = conversationPendingDeletion;
          setConversationActionBusyId(id);
          void Promise.resolve(props.onDeleteConversation?.(id)).finally(() => {
            setConversationActionBusyId(undefined);
            setConversationPendingDeletion(undefined);
          });
        }}
      />
      <ConfirmDialog
        open={conversationPendingArchive !== undefined}
        title="归档对话"
        description={conversationPendingArchive === undefined
          ? '归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。'
          : `确认归档“${conversationPendingArchive.title}”？归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。`}
        confirmLabel="归档"
        busy={archivingConversationId !== undefined}
        onCancel={() => setConversationPendingArchive(undefined)}
        onConfirm={() => {
          if (conversationPendingArchive === undefined || archivingConversationId !== undefined) return;
          const { id } = conversationPendingArchive;
          setArchivingConversationId(id);
          void Promise.resolve(props.onArchiveConversation?.(id)).finally(() => {
            setArchivingConversationId(undefined);
            setConversationPendingArchive(undefined);
          });
        }}
      />
      <ConfirmDialog
        open={projectPendingRemoval !== undefined}
        title="移除项目"
        description={projectPendingRemoval === undefined
          ? '项目目录和文件不会被删除。'
          : `确认从 OpenCreator 中移除“${projectPendingRemoval.name}”？项目目录和文件不会被删除。`}
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
        open={taskPendingDeletion !== undefined}
        title="删除任务"
        description={taskPendingDeletion === undefined
          ? '删除后无法恢复。'
          : `确认删除“${taskPendingDeletion.name}”？删除后无法恢复。`}
        confirmLabel="删除任务"
        destructive
        busy={taskActionBusyId !== undefined}
        onCancel={() => setTaskPendingDeletion(undefined)}
        onConfirm={() => {
          if (taskPendingDeletion === undefined || taskActionBusyId !== undefined) return;
          const task = taskPendingDeletion;
          setTaskActionBusyId(task.id);
          void Promise.resolve(props.onDeleteTask?.(task)).finally(() => {
            setTaskActionBusyId(undefined);
            setTaskPendingDeletion(undefined);
          });
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

function positionSidebarActionMenu(trigger: DOMRect): { top: number; left: number } {
  return {
    top: Math.max(
      SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
      Math.min(
        window.innerHeight - SIDEBAR_ACTION_MENU_MAX_HEIGHT - SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
        trigger.bottom + SIDEBAR_ACTION_MENU_GAP
      )
    ),
    left: Math.max(
      SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
      Math.min(
        window.innerWidth - SIDEBAR_ACTION_MENU_WIDTH - SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
        trigger.right - SIDEBAR_ACTION_MENU_WIDTH
      )
    )
  };
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

function abbreviateConversationTitle(title: string): string {
  const characters = Array.from(title);
  return characters.length > 7 ? `${characters.slice(0, 7).join('')}...` : title;
}
