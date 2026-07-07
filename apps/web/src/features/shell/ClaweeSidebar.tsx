import type { ActiveView } from '../../app/app-state.js';
import type { ClaweeConversation, ClaweeProject } from '../projects/project-model.js';

export function ClaweeSidebar(props: {
  projects: ClaweeProject[];
  conversations: ClaweeConversation[];
  currentProjectId: string;
  activeView: ActiveView;
  onNewConversation(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenSettings(): void;
  onCheckUpdates(): void;
}) {
  const globalActions: Array<{ label: string; view?: ActiveView; onClick(): void }> = [
    { label: '新对话', onClick: props.onNewConversation },
    { label: '搜索', view: 'search', onClick: () => props.onOpenView('search') },
    { label: '已安排', view: 'schedules', onClick: () => props.onOpenView('schedules') },
    { label: '插件', view: 'plugins', onClick: () => props.onOpenView('plugins') }
  ];

  return (
    <nav className="clawee-sidebar" aria-label="Clawee">
      <div className="sidebar-primary">
        {globalActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="sidebar-row"
            aria-current={action.view && props.activeView === action.view ? 'page' : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>

      <section className="sidebar-section" aria-labelledby="clawee-projects-heading">
        <h2 id="clawee-projects-heading">项目</h2>
        <div className="sidebar-section-list">
          {props.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="sidebar-row"
              aria-current={project.id === props.currentProjectId ? 'true' : undefined}
              onClick={() => props.onSelectProject(project.id)}
            >
              {project.name}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section sidebar-conversations" aria-labelledby="clawee-conversations-heading">
        <h2 id="clawee-conversations-heading">对话</h2>
        <div className="sidebar-section-list">
          {props.conversations.length === 0 ? (
            <p className="sidebar-empty">暂无聊天</p>
          ) : (
            props.conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className="conversation-row"
                onClick={() => props.onSelectConversation(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>{conversation.updatedLabel}</span>
              </button>
            ))
          )}
        </div>
      </section>

      <div className="sidebar-bottom">
        <button className="settings-button" type="button" aria-label="设置 账户" onClick={props.onOpenSettings}>
          <span className="settings-avatar" aria-hidden="true">
            W
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
