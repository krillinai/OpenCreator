import type { RuntimeApproval } from '@clawee/protocol';
import { Check, ShieldAlert, X } from 'lucide-react';

export function ApprovalPanel(props: {
  approval: RuntimeApproval;
  resolving?: boolean;
  error?: string;
  onApprove(id: string): void;
  onReject(id: string): void;
}) {
  const pending = props.approval.status === 'pending';
  const showSummary = !approvalDetailsContainSummary(
    props.approval.details,
    props.approval.summary
  );
  return (
    <section
      className={`approval-panel approval-${props.approval.risk}`}
      aria-label={props.approval.title}
    >
      <div className="approval-heading">
        <ShieldAlert aria-hidden="true" size={18} />
        <div>
          <strong>{props.approval.title}</strong>
          <span>{formatApprovalStatus(props.approval.status)}</span>
        </div>
      </div>
      {showSummary ? <p>{props.approval.summary}</p> : null}
      <ApprovalDetails details={props.approval.details} />
      {props.approval.status === 'expired' ? (
        <p className="approval-resolution">
          审批已过期，本次任务不会继续执行。
        </p>
      ) : null}
      {props.approval.status === 'rejected' ? (
        <p className="approval-resolution">
          你已拒绝这项操作，本次任务不会继续执行。
        </p>
      ) : null}
      {props.error ? <p className="inline-error">{props.error}</p> : null}
      {pending ? (
        <div className="approval-actions">
          <button
            type="button"
            className="approval-reject"
            disabled={props.resolving}
            onClick={() => props.onReject(props.approval.id)}
          >
            <X aria-hidden="true" size={15} />
            拒绝
          </button>
          <button
            type="button"
            className="approval-approve"
            disabled={props.resolving}
            onClick={() => props.onApprove(props.approval.id)}
          >
            <Check aria-hidden="true" size={15} />
            批准
          </button>
        </div>
      ) : null}
    </section>
  );
}

function approvalDetailsContainSummary(
  details: Record<string, unknown>,
  summary: string
): boolean {
  const normalizedSummary = summary.trim();
  if (normalizedSummary.length === 0) return true;
  return Object.values(details).some(value => (
    typeof value === 'string' && value.trim() === normalizedSummary
  ));
}

function ApprovalDetails(props: { details: Record<string, unknown> }) {
  const command = stringValue(props.details.command);
  const cwd = stringValue(props.details.cwd);
  const grantRoot = stringValue(props.details.grantRoot);
  const network = isRecord(props.details.network) ? props.details.network : undefined;
  const host = stringValue(network?.host);

  if (command === undefined && cwd === undefined && grantRoot === undefined && host === undefined) {
    return null;
  }

  return (
    <dl className="approval-details">
      {command ? <Detail label="命令" value={command} code /> : null}
      {cwd ? <Detail label="目录" value={cwd} code /> : null}
      {grantRoot ? <Detail label="写入范围" value={grantRoot} code /> : null}
      {host ? <Detail label="网络目标" value={formatNetwork(network!)} code /> : null}
    </dl>
  );
}

function Detail(props: { label: string; value: string; code?: boolean }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.code ? <code>{props.value}</code> : props.value}</dd>
    </div>
  );
}

function formatNetwork(network: Record<string, unknown>): string {
  const protocol = stringValue(network.protocol) ?? 'network';
  const host = stringValue(network.host) ?? '';
  const port = typeof network.port === 'number' ? `:${network.port}` : '';
  return `${protocol}://${host}${port}`;
}

function formatApprovalStatus(status: RuntimeApproval['status']): string {
  switch (status) {
    case 'pending':
      return '等待你的决定';
    case 'approved':
      return '已批准';
    case 'rejected':
      return '已拒绝';
    case 'expired':
      return '已过期';
    case 'canceled':
      return '已取消';
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
