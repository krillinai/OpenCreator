import { useEffect, useState } from 'react';
import {
  Clock3,
  Folder,
  FolderOpen,
  ListTodo,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  SquarePen,
  type LucideIcon
} from 'lucide-react';
import type { ActiveView } from '../../app/app-state.js';
import type { ClaweeConversation, ClaweeProject } from '../projects/project-model.js';

export function ClaweeSidebar(props: {
  projects: ClaweeProject[];
  conversations: ClaweeConversation[];
  runningConversationIds?: ReadonlySet<string>;
  currentProjectId: string;
  selectedConversationId?: string;
  activeView: ActiveView;
  unreadTaskCount?: number;
  collapsed?: boolean;
  onNewConversation(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenSettings(): void;
  onToggleCollapsed(): void;
}) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(props.currentProjectId);
  const collapsed = props.collapsed === true;
  const globalActions: Array<{
    label: string;
    icon: LucideIcon;
    view?: ActiveView;
    unreadCount?: number;
    onClick(): void;
  }> = [
    { label: '新对话', icon: SquarePen, onClick: props.onNewConversation },
    { label: '搜索', icon: Search, view: 'search', onClick: () => props.onOpenView('search') },
    { label: '已安排', icon: Clock3, view: 'schedules', onClick: () => props.onOpenView('schedules') },
    {
      label: '任务',
      icon: ListTodo,
      view: 'tasks',
      unreadCount: props.unreadTaskCount,
      onClick: () => props.onOpenView('tasks')
    },
    { label: '插件', icon: Plug, view: 'plugins', onClick: () => props.onOpenView('plugins') }
  ];
  const conversationsByProject = new Map<string, ClaweeConversation[]>();

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
            <img className="sidebar-logo-image sidebar-logo-mark" src="/logo-cor.png" alt="Clawee" />
            <PanelLeftOpen className="sidebar-expand-icon" size={19} strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : (
          <>
            <div className="sidebar-logo-lockup">
              <img className="sidebar-logo-image sidebar-logo-full" src="/logo-all.png" alt="Clawee" />
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
              aria-label={
                action.unreadCount !== undefined && action.unreadCount > 0
                  ? `${action.label} ${action.unreadCount} 条未读`
                  : undefined
              }
              aria-current={action.view && props.activeView === action.view ? 'page' : undefined}
              onClick={action.onClick}
            >
              <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
              <span>{action.label}</span>
              {action.unreadCount !== undefined && action.unreadCount > 0 ? (
                <span className="sidebar-task-badge" aria-hidden="true">
                  {action.unreadCount > 99 ? '99+' : action.unreadCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {collapsed ? null : (
        <>
          <section className="sidebar-section" aria-labelledby="clawee-projects-heading">
            <h2 id="clawee-projects-heading">项目</h2>
            <div className="sidebar-project-tree" aria-label="项目和对话">
              {props.projects.map((project) => {
                const isCurrentProject = project.id === props.currentProjectId;
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
                    {isExpanded ? (
                      <div className="sidebar-conversation-tree" aria-label={`${project.name} 对话`}>
                        {projectConversations.length === 0 ? (
                          <p className="sidebar-empty">暂无聊天</p>
                        ) : (
                          projectConversations.map((conversation) => {
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
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="sidebar-section sidebar-conversations" aria-labelledby="clawee-conversations-heading">
            <h2 id="clawee-conversations-heading">对话</h2>
            <p className="sidebar-empty">暂无聊天</p>
          </section>
        </>
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
