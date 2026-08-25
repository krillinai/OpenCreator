import type {
  CreatorActivity,
  CreatorAgentApproval,
  CreatorAgentItem,
  CreatorAgentTurn
} from '@opencreator/protocol';
import {
  Activity,
  Bot,
  Check,
  MessageSquareText,
  Square,
  Sparkles,
  Wrench,
  X
} from 'lucide-react';
import type { ReactNode } from 'react';

export default function CreatorAgentPanel(props: {
  title: string;
  statusSummary: string;
  activities: CreatorActivity[];
  turns: CreatorAgentTurn[];
  items: CreatorAgentItem[];
  approvals: CreatorAgentApproval[];
  busy?: boolean;
  composer?: ReactNode;
  onInterrupt?(): void;
  onApproval?(
    approval: CreatorAgentApproval,
    decision: 'approved' | 'rejected' | 'canceled'
  ): void;
}) {
  const executionItems = props.items.filter(item => (
    item.kind !== 'user_message' && item.kind !== 'assistant_message'
  ));
  return (
    <aside className="creator-agent-panel" aria-label={props.title}>
      <header className="creator-agent-panel-header">
        <Bot size={17} aria-hidden="true" />
        <h2>{props.title}</h2>
        {props.busy && props.onInterrupt ? (
          <button type="button" onClick={props.onInterrupt} aria-label="停止 Agent">
            <Square size={14} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <section className="creator-agent-panel-section" role="region" aria-label="当前创作状态">
        <h3><Sparkles size={14} aria-hidden="true" />当前创作状态</h3>
        <p>{props.statusSummary}</p>
      </section>
      <section className="creator-agent-panel-section" role="region" aria-label="创作动态">
        <h3><Activity size={14} aria-hidden="true" />创作动态</h3>
        <ol>
          {props.activities.map(item => (
            <li key={item.id} data-actor={item.actor}>{item.summary}</li>
          ))}
        </ol>
      </section>
      <section className="creator-agent-panel-section creator-agent-panel-chat" role="log" aria-label="模型对话">
        <h3><MessageSquareText size={14} aria-hidden="true" />模型对话</h3>
        {props.turns
          .filter(turn => turn.content.trim().length > 0)
          .map(turn => (
            <p key={turn.id} data-role={turn.role} data-status={turn.status}>{turn.content}</p>
          ))}
      </section>
      {executionItems.length > 0 ? (
        <section className="creator-agent-panel-section creator-agent-panel-tools" role="region" aria-label="执行详情">
          <h3><Wrench size={14} aria-hidden="true" />执行详情</h3>
          <ol>
            {executionItems.map(item => (
              <li key={item.id} data-kind={item.kind} data-status={item.status}>
                <strong>{item.toolName ?? executionItemLabel(item)}</strong>
                {item.text ? <span>{item.text}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {props.approvals.length > 0 ? (
        <section className="creator-agent-panel-section creator-agent-panel-approvals" role="region" aria-label="Agent 审批">
          {props.approvals.map(approval => (
            <article key={approval.id} data-status={approval.status}>
              <strong>{approval.title}</strong>
              <p>{approval.summary}</p>
              {approval.status === 'pending' && props.onApproval ? (
                <div>
                  <button type="button" onClick={() => props.onApproval?.(approval, 'approved')} aria-label={`批准 ${approval.title}`}>
                    <Check size={14} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => props.onApproval?.(approval, 'rejected')} aria-label={`拒绝 ${approval.title}`}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : <small>{approvalStatusLabel(approval)}</small>}
            </article>
          ))}
        </section>
      ) : null}
      {props.composer}
    </aside>
  );
}

function executionItemLabel(item: CreatorAgentItem): string {
  if (item.kind === 'reasoning') return '思考过程';
  if (item.kind === 'tool_call') return '工具调用';
  if (item.kind === 'tool_result') return '工具结果';
  if (item.kind === 'approval') return '等待审批';
  return '运行错误';
}

function approvalStatusLabel(approval: CreatorAgentApproval): string {
  if (approval.status === 'approved') return '已批准';
  if (approval.status === 'rejected') return '已拒绝';
  if (approval.status === 'expired') return '已过期，请重新执行';
  if (approval.status === 'canceled') return '已取消';
  return '等待处理';
}
