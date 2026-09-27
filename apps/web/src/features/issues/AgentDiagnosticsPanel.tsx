import type { OpenCreatorIssue } from '@opencreator/protocol';
import { MessageSquareText, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import OpenCreatorMark from '../../components/brand/OpenCreatorMark.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { IssueActionButtons, type IssueActionRegistry } from './IssuePresenter.js';
import { issueConversationText, presentIssue } from './issue-catalog.js';
import { getPageIssueActionsSnapshot, subscribePageIssueActions } from './page-issue-action-hub.js';
import {
  clearPageIssues,
  dismissPageIssue,
  getPageIssues,
  subscribePageIssues
} from './page-issue-hub.js';
import './agent-diagnostics.css';

export default function AgentDiagnosticsPanel(props: {
  hiddenCreatorIssues?: boolean;
  onAskIssue(issue: OpenCreatorIssue, question: string): void;
}) {
  const { language } = useAppLanguage();
  const locale = language === 'en-US' ? 'en-US' : 'zh-CN';
  const allIssues = useSyncExternalStore(subscribePageIssues, getPageIssues, getPageIssues);
  const actionsByIssueId = useSyncExternalStore(subscribePageIssueActions, getPageIssueActionsSnapshot, getPageIssueActionsSnapshot);
  const issues = useMemo(() => allIssues.filter(issue => (
    !props.hiddenCreatorIssues
    || issue.scope.kind !== 'page'
    || issue.scope.surface !== 'creator-launch'
  )), [allIssues, props.hiddenCreatorIssues]);
  const [open, setOpen] = useState(false);
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const latestIssueRef = useRef<string>();
  const focusedIssue = issues.find(issue => issue.id === focusedIssueId) ?? issues.at(-1) ?? null;

  useEffect(() => {
    const latest = issues.at(-1);
    const key = latest === undefined ? undefined : `${latest.id}:${latest.occurrenceCount}`;
    if (key !== undefined && key !== latestIssueRef.current) setOpen(true);
    latestIssueRef.current = key;
  }, [allIssues]);
  useEffect(() => () => clearPageIssues(), []);

  if (issues.length === 0) return null;

  function send() {
    const question = input.trim();
    if (!question || focusedIssue === null) return;
    props.onAskIssue(focusedIssue, question);
    setInput('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="agent-diagnostics-trigger" type="button" onClick={() => setOpen(true)} aria-label={locale === 'en-US' ? 'Open Agent diagnostics' : '打开 Agent 诊断'}>
        <MessageSquareText size={18} aria-hidden="true" />
        <span>{issues.length}</span>
      </button>
    );
  }

  return (
    <aside className="agent-diagnostics-panel" aria-label={locale === 'en-US' ? 'Agent diagnostics' : 'Agent 诊断'}>
      <header>
        <span aria-hidden="true"><OpenCreatorMark size={18} /></span>
        <strong>OpenCreator</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label={locale === 'en-US' ? 'Close diagnostics' : '收起诊断'} title={locale === 'en-US' ? 'Close diagnostics' : '收起诊断'}><X size={17} aria-hidden="true" /></button>
      </header>
      <div className="agent-diagnostics-timeline" role="log" aria-label={locale === 'en-US' ? 'Diagnostic conversation' : '诊断对话'} aria-live="polite">
        {issues.map(issue => (
          <DiagnosticMessage
            key={issue.id}
            issue={issue}
            language={locale}
            actions={actionsByIssueId.get(issue.id)?.actions}
            focused={focusedIssue?.id === issue.id}
            onFocus={() => setFocusedIssueId(issue.id)}
            onDismiss={() => dismissPageIssue(issue.id)}
          />
        ))}
      </div>
      <form onSubmit={event => { event.preventDefault(); send(); }}>
        <input
          aria-label={locale === 'en-US' ? 'Ask about this error' : '询问错误原因或修复办法'}
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder={locale === 'en-US' ? 'Ask about this error' : '询问错误原因或修复办法'}
        />
        <button type="submit" disabled={!input.trim()} aria-label={locale === 'en-US' ? 'Send question' : '发送问题'} title={locale === 'en-US' ? 'Send question' : '发送问题'}><Send size={16} aria-hidden="true" /></button>
      </form>
    </aside>
  );
}

function DiagnosticMessage(props: {
  issue: OpenCreatorIssue;
  language: 'zh-CN' | 'en-US';
  actions?: IssueActionRegistry;
  focused: boolean;
  onFocus(): void;
  onDismiss(): void;
}) {
  return (
    <article className="agent-diagnostics-message" data-issue-id={props.issue.id} data-focused={props.focused}>
      <div className="agent-diagnostics-message-meta">
        <span>{props.language === 'en-US' ? 'System diagnosis' : '系统诊断'}</span>
        <button type="button" onClick={props.onDismiss} aria-label={props.language === 'en-US' ? 'Dismiss this issue' : '移除这条诊断'} title={props.language === 'en-US' ? 'Dismiss this issue' : '移除这条诊断'}><X size={14} aria-hidden="true" /></button>
      </div>
      <button type="button" className="agent-diagnostics-message-body" onClick={props.onFocus} aria-label={props.language === 'en-US' ? 'Focus this issue' : '询问这条问题'}>
        <span>{presentIssue(props.issue, props.language).description}</span>
        <span>{issueConversationText(props.issue, props.language).nextStep}</span>
      </button>
      <IssueActionButtons issue={props.issue} actions={props.actions} includeFocusAgent={false} />
    </article>
  );
}
