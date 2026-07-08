import { useEffect, useState } from 'react';
import {
  Clock3,
  NotebookTabs,
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
  currentProjectId: string;
  selectedConversationId?: string;
  activeView: ActiveView;
  onNewConversation(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenSettings(): void;
  onCheckUpdates(): void;
}) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(props.currentProjectId);
  const globalActions: Array<{ label: string; icon: LucideIcon; view?: ActiveView; onClick(): void }> = [
    { label: '新对话', icon: SquarePen, onClick: props.onNewConversation },
    { label: '搜索', icon: Search, view: 'search', onClick: () => props.onOpenView('search') },
    { label: '已安排', icon: Clock3, view: 'schedules', onClick: () => props.onOpenView('schedules') },
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
    <nav className="clawee-sidebar" aria-label="Clawee">
      <div className="sidebar-primary">
        {globalActions.map((action) => {
          const Icon = action.icon;
          return (
          <button
            key={action.label}
            type="button"
            className="sidebar-row"
            aria-current={action.view && props.activeView === action.view ? 'page' : undefined}
            onClick={action.onClick}
          >
            <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
            <span>{action.label}</span>
          </button>
          );
        })}
      </div>

      <section className="sidebar-section" aria-labelledby="clawee-projects-heading">
        <h2 id="clawee-projects-heading">项目</h2>
        <div className="sidebar-project-tree" aria-label="项目和对话">
          {props.projects.map((project) => {
            const isCurrentProject = project.id === props.currentProjectId;
            const isExpanded = project.id === expandedProjectId;
            const projectConversations = conversationsByProject.get(project.id) ?? [];

            return (
              <div className="sidebar-project-node" key={project.id}>
                <button
                  type="button"
                  className="sidebar-row project-row"
                  aria-current={isCurrentProject ? 'true' : undefined}
                  aria-expanded={isExpanded}
                  onClick={() => {
                    if (isExpanded) {
                      setExpandedProjectId(undefined);
                      return;
                    }
                    setExpandedProjectId(project.id);
                    props.onSelectProject(project.id);
                  }}
                >
                  <NotebookTabs size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>{project.name}</span>
                </button>
                {isExpanded ? (
                  <div className="sidebar-conversation-tree" aria-label={`${project.name} 对话`}>
                    {projectConversations.length === 0 ? (
                      <p className="sidebar-empty">暂无聊天</p>
                    ) : (
                      projectConversations.map((conversation) => (
                        <button
                          key={conversation.id}
                          type="button"
                          className="conversation-row nested-conversation-row"
                          aria-current={conversation.id === props.selectedConversationId ? 'page' : undefined}
                          onClick={() => props.onSelectConversation(conversation.id)}
                        >
                          <strong>{conversation.title}</strong>
                          <span>{conversation.updatedLabel}</span>
                        </button>
                      ))
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

      <div className="sidebar-bottom">
        <button className="settings-button" type="button" aria-label="设置 账户" onClick={props.onOpenSettings}>
          <span className="settings-avatar" aria-hidden="true">
            <Settings size={16} strokeWidth={2} />
          </span>
          <span>设置</span>
        </button>
        <button className="update-button" type="button" onClick={props.onCheckUpdates}>
          更新
        </button>
      </div>
    </nav>
  );
}
