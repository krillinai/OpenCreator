import type { CreatorRepairAction, OpenCreatorIssue } from '@opencreator/protocol';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  LocateFixed,
  MessageSquareText,
  RotateCw,
  Settings,
  X
} from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { issueDiagnosticText, presentIssue } from './issue-catalog.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { OriginalErrorDetails } from './OriginalErrorDetails.js';
import { registerPageIssueActions } from './page-issue-action-hub.js';
import './issue-presenter.css';

const PageIssueRoutingContext = createContext(false);

export function PageIssueRoutingProvider(props: { children: ReactNode }) {
  return <PageIssueRoutingContext.Provider value>{props.children}</PageIssueRoutingContext.Provider>;
}

export type IssueActionRegistry = {
  retryOperations?: Record<string, () => void | Promise<void>>;
  settingsRoutes?: Record<string, () => void>;
  inputFields?: Record<string, () => void>;
  onFocusAgent?(issue: OpenCreatorIssue): void;
};

export function IssuePresenter(props: {
  issue: OpenCreatorIssue;
  actions?: IssueActionRegistry;
  onDismiss?(issueId: string): void;
  compact?: boolean;
}) {
  const { language } = useAppLanguage();
  const localize = useLocalizedCopy();
  const copy = presentIssue(props.issue, language);
  return <IssueNotice
    id={props.issue.id}
    status={props.issue.status}
    statusLabel={copy.statusLabel}
    title={copy.title}
    description={copy.description}
    compact={props.compact}
    detail={issueDiagnosticText(props.issue, language)}
    actions={<IssueActionButtons issue={props.issue} actions={props.actions} />}
    dismiss={props.onDismiss !== undefined ? (
        <button
          type="button"
          className="issue-presenter-dismiss"
          aria-label={localize('关闭问题', 'Dismiss issue')}
          title={localize('关闭问题', 'Dismiss issue')}
          onClick={() => props.onDismiss?.(props.issue.id)}
        >
          <X aria-hidden="true" size={16} />
        </button>
    ) : null}
  />;
}

export type IssueNoticeProps = {
  title: string;
  description?: string;
  nextStep?: string;
  detail?: string;
  compact?: boolean;
  settingsLink?: { href: string; label: string };
  actions?: ReactNode;
};

export function IssueNotice({ status = 'open', ...props }: IssueNoticeProps & {
  id?: string;
  status?: OpenCreatorIssue['status'];
  statusLabel?: string;
  dismiss?: ReactNode;
}) {
  const StatusIcon = status === 'resolved' ? CheckCircle2 : status === 'resolving' ? CircleDot : AlertCircle;
  return (
    <section
      className={`issue-presenter issue-presenter-${status}${props.compact ? ' issue-presenter-compact' : ''}`}
      role={status === 'open' ? 'alert' : 'status'}
      data-issue-id={props.id}
    >
      <StatusIcon aria-hidden="true" size={18} />
      <div className="issue-presenter-body">
        <div className="issue-presenter-heading">
          <strong>{props.title}</strong>
          {props.statusLabel ? <span>{props.statusLabel}</span> : null}
        </div>
        {props.description ? <p>{props.description}</p> : null}
        {props.nextStep ? <p>{props.nextStep}</p> : null}
        <OriginalErrorDetails detail={props.detail} />
        {props.settingsLink ? <div className="issue-presenter-actions">
          <a href={props.settingsLink.href}>
            {props.settingsLink.label}<ArrowRight size={14} aria-hidden="true" />
          </a>
        </div> : null}
        {props.actions}
      </div>
      {props.dismiss}
    </section>
  );
}

export function IssueList(props: {
  issues: OpenCreatorIssue[];
  actions?: IssueActionRegistry;
  onDismiss?(issueId: string): void;
  compact?: boolean;
}) {
  const routeToAgent = useContext(PageIssueRoutingContext);
  const pageIssueIds = props.issues.filter(issue => issue.scope.kind === 'page').map(issue => issue.id).join('|');
  useEffect(() => {
    if (!routeToAgent || props.actions === undefined) return;
    return registerPageIssueActions(pageIssueIds.split('|').filter(Boolean), props.actions);
  }, [pageIssueIds, props.actions, routeToAgent]);
  const visibleIssues = routeToAgent
    ? props.issues.filter(issue => issue.scope.kind !== 'page')
    : props.issues;
  return visibleIssues.length > 0 ? (
    <div className="issue-presenter-list">
      {visibleIssues.map(issue => (
        <IssuePresenter key={issue.id} issue={issue} actions={props.actions} onDismiss={props.onDismiss} compact={props.compact} />
      ))}
    </div>
  ) : null;
}

export function IssueActionButtons(props: {
  issue: OpenCreatorIssue;
  actions?: IssueActionRegistry;
  includeFocusAgent?: boolean;
}) {
  const localize = useLocalizedCopy();
  const [pendingAction, setPendingAction] = useState('');
  const actions = props.issue.repairActions.filter(action => (
    (props.includeFocusAgent !== false || action.kind !== 'focus-agent')
    && canHandle(action, props.actions)
  ));
  if (actions.length === 0) return null;
  return (
    <div className="issue-presenter-actions">
      {actions.map(action => (
        <button
          key={actionKey(action)}
          type="button"
          disabled={pendingAction.length > 0 || props.issue.status === 'resolving'}
          onClick={() => void runAction(action, props.issue, props.actions!, setPendingAction).catch(() => undefined)}
        >
          <ActionIcon action={action} />
          {actionLabel(action, localize)}
        </button>
      ))}
    </div>
  );
}

function canHandle(action: CreatorRepairAction, registry: IssueActionRegistry | undefined): boolean {
  if (registry === undefined) return false;
  switch (action.kind) {
    case 'retry-operation': return registry.retryOperations?.[action.operationId] !== undefined;
    case 'open-settings': return registry.settingsRoutes?.[action.settingsRouteId] !== undefined;
    case 'select-input': return registry.inputFields?.[action.inputField] !== undefined;
    case 'focus-agent': return registry.onFocusAgent !== undefined;
  }
}

async function runAction(
  action: CreatorRepairAction,
  issue: OpenCreatorIssue,
  registry: IssueActionRegistry,
  setPending: (value: string) => void
): Promise<void> {
  if (action.kind === 'retry-operation') {
    if (
      (action.requiresConfirmation || action.risk !== 'normal')
      && !globalThis.confirm('This operation may incur charges or overwrite results. Continue?')
    ) return;
    const handler = registry.retryOperations?.[action.operationId];
    if (handler === undefined) return;
    setPending(action.operationId);
    try {
      await handler();
    } finally {
      setPending('');
    }
    return;
  }
  if (action.kind === 'open-settings') registry.settingsRoutes?.[action.settingsRouteId]?.();
  if (action.kind === 'select-input') registry.inputFields?.[action.inputField]?.();
  if (action.kind === 'focus-agent') registry.onFocusAgent?.(issue);
}

function ActionIcon(props: { action: CreatorRepairAction }) {
  if (props.action.kind === 'retry-operation') return <RotateCw aria-hidden="true" size={14} />;
  if (props.action.kind === 'open-settings') return <Settings aria-hidden="true" size={14} />;
  if (props.action.kind === 'select-input') return <LocateFixed aria-hidden="true" size={14} />;
  return <MessageSquareText aria-hidden="true" size={14} />;
}

function actionKey(action: CreatorRepairAction): string {
  if (action.kind === 'retry-operation') return `${action.kind}:${action.operationId}`;
  if (action.kind === 'open-settings') return `${action.kind}:${action.settingsRouteId}`;
  if (action.kind === 'select-input') return `${action.kind}:${action.inputField}`;
  return action.kind;
}

function actionLabel(action: CreatorRepairAction, localize: LocalizeCopy): string {
  if (action.kind === 'retry-operation') return localize('重试', 'Retry');
  if (action.kind === 'open-settings') return localize('打开设置', 'Open settings');
  if (action.kind === 'select-input') return localize('重新选择输入', 'Select input');
  return localize('询问 Agent', 'Ask Agent');
}
