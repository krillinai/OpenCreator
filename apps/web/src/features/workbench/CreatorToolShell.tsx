import { useState, type ReactNode } from 'react';
import { ArrowLeft, Bot, MessageSquareText, Sparkles } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import ToolAgentComposer from './ToolAgentComposer.js';

type ToolMessage = {
  id: number;
  role: 'agent' | 'user';
  text: string;
};

export default function CreatorToolShell(props: {
  title: string;
  subtitle: string;
  context: string;
  initialMessage: string;
  suggestions: string[];
  placeholder: string;
  children: ReactNode;
  onBack(): void;
  onCommand(command: string): string;
}) {
  const l = useLocalizedCopy();
  const [messages, setMessages] = useState<ToolMessage[]>([
    { id: 1, role: 'agent', text: props.initialMessage }
  ]);
  const [input, setInput] = useState('');

  function runCommand(command: string) {
    const prompt = command.trim();
    if (!prompt) return;
    const response = props.onCommand(prompt);
    setMessages(current => [
      ...current,
      { id: current.length + 1, role: 'user', text: prompt },
      { id: current.length + 2, role: 'agent', text: response }
    ]);
  }

  function submit() {
    const prompt = input.trim();
    if (!prompt) return;
    setInput('');
    runCommand(prompt);
  }

  return (
    <main className="creator-workspace-page">
      <div className="creator-workspace-layout">
        <section className="creator-workspace-main" aria-label={`${props.title} ${l('操作区', 'workspace')}`}>
          <header className="creator-workspace-header">
            <button type="button" onClick={props.onBack} aria-label={l('返回工作台', 'Back to Workbench')}>
              <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <div>
              <h1>{props.title}</h1>
              <p>{props.subtitle}</p>
            </div>
          </header>
          <div className="creator-workspace-content">{props.children}</div>
        </section>

        <aside className="creator-tool-agent" aria-label="OpenCreator">
          <header>
            <span aria-hidden="true"><Bot size={17} strokeWidth={1.8} /></span>
            <div><h2>OpenCreator</h2><p>{l('正在协助：', 'Helping with: ')}{props.title}</p></div>
          </header>
          <div className="creator-tool-agent-context">
            <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
            <span><small>{l('当前任务', 'Current task')}</small><strong>{props.context}</strong></span>
          </div>
          <div className="creator-tool-agent-messages" aria-live="polite">
            {messages.map(message => (
              <div data-role={message.role} key={message.id}>
                {message.role === 'agent' ? <MessageSquareText size={14} strokeWidth={1.8} aria-hidden="true" /> : null}
                <p>{message.text}</p>
              </div>
            ))}
          </div>
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
        </aside>
      </div>
    </main>
  );
}
