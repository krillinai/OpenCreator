import { useEffect, useState } from 'react';
import {
  CircleAlert,
  Clock3,
  Folder,
  FolderOpen,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PauseCircle,
  Plug,
  Search,
  Settings,
  ShieldAlert,
  SquarePen,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';
import type { ActiveView } from '../../app/app-state.js';
import type { ColorMode } from '../../styles/color-mode.js';
import type { ClaweeConversation, ClaweeProject } from '../projects/project-model.js';
import type {
  SidebarTaskStatus,
  SidebarTaskSummary
} from './sidebar-task-model.js';

export function ClaweeSidebar(props: {
  projects: ClaweeProject[];
  conversations: ClaweeConversation[];
  tasks: SidebarTaskSummary[];
  runningConversationIds?: ReadonlySet<string>;
  currentProjectId: string;
  selectedConversationId?: string;
  activeView: ActiveView;
  collapsed?: boolean;
  colorMode?: ColorMode;
  onNewConversation(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onSelectTask(threadId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenSettings(): void;
  onToggleCollapsed(): void;
}) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(props.currentProjectId);
  const collapsed = props.collapsed === true;
  const logoSrc = props.colorMode === 'light' ? '/logo-black.png' : '/logo-white.png';
  const globalActions: Array<{
    label: string;
    icon: LucideIcon;
    view?: ActiveView;
    onClick(): void;
  }> = [
    { label: '新对话', icon: SquarePen, onClick: props.onNewConversation },
    { label: '搜索', icon: Search, view: 'search', onClick: () => props.onOpenView('search') },
    { label: '已安排', icon: Clock3, view: 'schedules', onClick: () => props.onOpenView('schedules') },
    { label: '插件', icon: Plug, view: 'plugins', onClick: () => props.onOpenView('plugins') }
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

  return (
    <nav className="clawee-sidebar" aria-label="Clawee" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-brand">
        {collapsed ? (
          <button
            className="sidebar-brand-button sidebar-expand-button"
            type="button"
            aria-label="展开侧栏"
            title="展开侧栏"
            onClick={props.onToggleCollapsed}
          >
            <span className="sidebar-logo-mark-crop">
              <img className="sidebar-logo-image sidebar-logo-mark" src={logoSrc} alt="Clawee" />
            </span>
            <PanelLeftOpen className="sidebar-expand-icon" size={19} strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : (
          <>
            <div className="sidebar-logo-lockup">
              <img className="sidebar-logo-image sidebar-logo-full" src={logoSrc} alt="Clawee" />
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
          <h2 id="clawee-projects-heading">项目</h2>
          <div className="sidebar-project-tree" aria-label="项目和对话">
            {props.projects.map((project) => {
              const isCurrentProject =
                !selectedTaskThread && project.id === props.currentProjectId;
              const isExpanded = project.id === expandedProjectId;
              const projectConversations = conversationsByProject.get(project.id) ?? [];
              const ProjectIcon = isCurrentProject ? FolderOpen : Folder;

              return (
                <div className="sidebar-project-node" key={project.id}>
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
                  {isExpanded && projectConversations.length > 0 ? (
                    <div className="sidebar-conversation-tree" aria-label={`${project.name} 对话`}>
                      {projectConversations.map((conversation) => {
                        const isRunning = props.runningConversationIds?.has(conversation.id) === true;
                        return (
                          <button
                            key={conversation.id}
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
                return (
                  <button
                    key={task.id}
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
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="sidebar-bottom">
        <button
          className="settings-button"
          type="button"
          aria-label="设置 账户"
          title={collapsed ? '设置' : undefined}
          onClick={props.onOpenSettings}
        >
          <span className="settings-avatar" aria-hidden="true">
            <Settings size={16} strokeWidth={2} />
          </span>
          <span>设置</span>
        </button>
      </div>
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
