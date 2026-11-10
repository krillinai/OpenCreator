import { type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorCollaborationPanel, {
  type CreatorPanelQuickAction
} from './CreatorCollaborationPanel.js';
import CreatorResizableLayout from './CreatorResizableLayout.js';
import { creatorPanelAdapterFor } from './creator-panel-adapters.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

export default function CreatorToolShell(props: {
  title: string;
  titleIcon?: ReactNode;
  subtitle: string;
  context: string;
  taskSummary?: ReactNode;
  headerActions?: ReactNode;
  initialMessage?: string;
  suggestions: string[];
  placeholder: string;
  pageClassName?: string;
  contentClassName?: string;
  stepLabel?: string;
  currentIssue?: string;
  quickActions?: CreatorPanelQuickAction[];
  onCancelTask?(): void;
  onResumeTask?(): void;
  taskControlPending?: 'canceling' | 'resuming';
  embedded?: boolean;
  showAgentPanel?: boolean;
  children: ReactNode;
  onBack(): void;
  onCommand?(command: string): string;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const adapter = creatorPanelAdapterFor(session?.job.templateId ?? '');
  const quickActions = props.quickActions ?? props.suggestions.map((suggestion, index) => ({
    id: `suggestion-${index}`,
    label: suggestion,
    kind: 'agent' as const,
    prompt: suggestion
  }));

  if (props.embedded) return <div className="creator-tool-embedded">{props.children}</div>;

  const workspace = <section className="creator-workspace-main" aria-label={`${props.title} ${l('操作区', 'workspace')}`}>
    <header className={`creator-workspace-header${props.titleIcon === undefined ? '' : ' has-title-icon'}${props.headerActions === undefined ? '' : ' has-actions'}`}>
      <button type="button" onClick={props.onBack} aria-label={l('返回', 'Back')}>
        <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {props.titleIcon === undefined ? null : (
        <span className="creator-workspace-title-icon" aria-hidden="true">{props.titleIcon}</span>
      )}
      <div>
        <h1>{props.title}</h1>
        <p>{props.subtitle}</p>
      </div>
      {props.headerActions === undefined ? null : <div className="creator-workspace-header-actions">{props.headerActions}</div>}
    </header>
    {props.showAgentPanel === false && props.currentIssue ? <div className="creator-workspace-local-issue creator-collaboration-issue">
      <p>{props.currentIssue}</p>
      {props.quickActions?.filter(action => action.kind === 'action').map(action => <button type="button" key={action.id} disabled={action.disabled} onClick={action.onAction}>{action.label}</button>)}
    </div> : null}
    <div className={`creator-workspace-content${props.contentClassName ? ` ${props.contentClassName}` : ''}`}>{props.children}</div>
  </section>;

  return (
    <main className={`creator-workspace-page${props.pageClassName ? ` ${props.pageClassName}` : ''}`}>
      {props.showAgentPanel === false ? workspace : <CreatorResizableLayout
        className="creator-workspace-layout"
        workspace={workspace}
        agentPanel={<CreatorCollaborationPanel
          adapter={adapter}
          stepLabel={props.stepLabel ?? props.title}
          contextSummary={props.context}
          taskSummary={props.taskSummary}
          promptHint={props.placeholder}
          currentIssue={props.currentIssue}
          quickActions={quickActions}
          onCancelTask={props.onCancelTask}
          onResumeTask={props.onResumeTask}
          taskControlPending={props.taskControlPending}
        />}
      />}
    </main>
  );
}
