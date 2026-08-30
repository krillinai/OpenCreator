import { type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorCollaborationPanel, {
  type CreatorPanelQuickAction
} from './CreatorCollaborationPanel.js';
import { creatorPanelAdapterFor } from './creator-panel-adapters.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

export default function CreatorToolShell(props: {
  title: string;
  subtitle: string;
  context: string;
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

  return (
    <main className={`creator-workspace-page${props.pageClassName ? ` ${props.pageClassName}` : ''}`}>
      <div className="creator-workspace-layout">
        <section className="creator-workspace-main" aria-label={`${props.title} ${l('操作区', 'workspace')}`}>
          <header className="creator-workspace-header">
            <button type="button" onClick={props.onBack} aria-label={l('返回', 'Back')}>
              <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <div>
              <h1>{props.title}</h1>
              <p>{props.subtitle}</p>
            </div>
          </header>
          <div className={`creator-workspace-content${props.contentClassName ? ` ${props.contentClassName}` : ''}`}>{props.children}</div>
        </section>

        <CreatorCollaborationPanel
          adapter={adapter}
          stepLabel={props.stepLabel ?? props.title}
          contextSummary={props.context}
          promptHint={props.placeholder}
          currentIssue={props.currentIssue}
          quickActions={quickActions}
          onCancelTask={props.onCancelTask}
          onResumeTask={props.onResumeTask}
          taskControlPending={props.taskControlPending}
        />
      </div>
    </main>
  );
}
