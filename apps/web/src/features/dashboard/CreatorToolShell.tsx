import { useState, type ReactNode } from 'react';
import { ArrowLeft, ServerOff } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import ToolAgentComposer from './ToolAgentComposer.js';
import CreatorAgentPanel from './CreatorAgentPanel.js';
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
  children: ReactNode;
  onBack(): void;
  onCommand?(command: string): string;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [input, setInput] = useState('');

  function runCommand(command: string) {
    const prompt = command.trim();
    if (!prompt) return;
    if (session === null) return;
    const operation = session.agentBusy
      ? session.steerAgentTurn(prompt)
      : session.runAgentTurn(prompt);
    void operation.catch(() => undefined);
  }

  function submit() {
    const prompt = input.trim();
    if (!prompt) return;
    setInput('');
    runCommand(prompt);
  }

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

        {session !== null ? (
          <CreatorAgentPanel
            title="OpenCreator"
            statusSummary={props.context}
            activities={session.job.activities}
            turns={session.turns}
            items={session.items}
            approvals={session.approvals}
            busy={session.agentBusy}
            onInterrupt={() => void session.interruptAgentTurn().catch(() => undefined)}
            onApproval={(approval, decision) => void session.respondAgentApproval(
              approval.id,
              decision,
              approval.processGeneration
            ).catch(() => undefined)}
            composer={(
              <>
                <div className="creator-tool-agent-suggestions" aria-label={l('Agent 建议', 'Agent suggestions')}>
                  {props.suggestions.map(suggestion => (
                    <button type="button" key={suggestion} onClick={() => runCommand(suggestion)}>{suggestion}</button>
                  ))}
                </div>
                <ToolAgentComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={submit}
                  ariaLabel={`${l('告诉 Agent', 'Tell the Agent your')} ${props.title} ${l('要求', 'requirements')}`}
                  placeholder={props.placeholder}
                />
              </>
            )}
          />
        ) : <aside className="creator-tool-agent" aria-label="OpenCreator" role="alert">
          <ServerOff size={18} aria-hidden="true" />
          <p>{l('Creator Runtime 未连接，无法启动 Agent。', 'Creator Runtime is disconnected, so the Agent cannot start.')}</p>
        </aside>}
      </div>
    </main>
  );
}
