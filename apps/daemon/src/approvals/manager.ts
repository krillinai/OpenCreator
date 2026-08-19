import type {
  ApprovalDecisionResponse,
  ApprovalKind,
  ApprovalListQuery,
  ApprovalRisk,
  ApprovalStatus,
  RuntimeApproval
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

export type ApprovalRuntimeDecision = Extract<
  ApprovalStatus,
  'approved' | 'rejected' | 'expired' | 'canceled'
>;

export type ApprovalRequest = {
  runId: string;
  threadId?: string;
  codexThreadId?: string;
  turnId: string;
  itemId: string;
  requestId: string;
  kind: ApprovalKind;
  risk: ApprovalRisk;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  ttlMs?: number;
};

export type PendingApproval = {
  approval: RuntimeApproval;
  decision: Promise<ApprovalRuntimeDecision>;
};

export type ApprovalManager = {
  request(input: ApprovalRequest): PendingApproval;
  get(id: string): RuntimeApproval | undefined;
  list(query?: ApprovalListQuery): RuntimeApproval[];
  approve(id: string): ApprovalDecisionResponse;
  reject(id: string): ApprovalDecisionResponse;
  cancelRun(runId: string, reason?: string): RuntimeApproval[];
  detach(id: string): void;
  subscribe(listener: (approval: RuntimeApproval) => void): () => void;
};

export class ApprovalManagerError extends Error {
  readonly code: 'APPROVAL_NOT_FOUND';

  constructor(message = 'Approval not found') {
    super(message);
    this.name = 'ApprovalManagerError';
    this.code = 'APPROVAL_NOT_FOUND';
  }
}

type ApprovalRow = {
  id: string;
  run_id: string;
  thread_id: string | null;
  codex_thread_id: string | null;
  turn_id: string;
  item_id: string;
  request_id: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  risk: ApprovalRisk;
  title: string;
  summary: string;
  details_json: string;
  requested_at: string;
  expires_at: string;
  resolved_at: string | null;
  resolution_reason: string | null;
};

type ActiveApproval = {
  timer: NodeJS.Timeout;
  resolve(decision: ApprovalRuntimeDecision): void;
};

const DEFAULT_APPROVAL_TTL_MS = 10 * 60 * 1000;

export function createApprovalManager(options: {
  db: Database.Database;
  defaultTtlMs?: number;
}): ApprovalManager {
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  const active = new Map<string, ActiveApproval>();
  const listeners = new Set<(approval: RuntimeApproval) => void>();
  const insert = options.db.prepare(`
    INSERT INTO approvals (
      id, run_id, thread_id, codex_thread_id, turn_id, item_id, request_id,
      kind, status, risk, title, summary, details_json, requested_at, expires_at
    ) VALUES (
      @id, @runId, @threadId, @codexThreadId, @turnId, @itemId, @requestId,
      @kind, 'pending', @risk, @title, @summary, @detailsJson, @requestedAt, @expiresAt
    )
  `);
  const get = options.db.prepare<string>('SELECT * FROM approvals WHERE id = ?');
  const list = options.db.prepare<{
    status: ApprovalStatus | 'all';
    runId: string | null;
    threadId: string | null;
    limit: number;
  }>(`
    SELECT *
    FROM approvals
    WHERE (@status = 'all' OR status = @status)
      AND (@runId IS NULL OR run_id = @runId)
      AND (@threadId IS NULL OR thread_id = @threadId)
    ORDER BY requested_at DESC, id DESC
    LIMIT @limit
  `);
  const resolvePending = options.db.prepare(`
    UPDATE approvals
    SET status = @status,
        resolved_at = @resolvedAt,
        resolution_reason = @resolutionReason,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND status = 'pending'
  `);
  const recoverPending = options.db.prepare(`
    UPDATE approvals
    SET status = 'canceled',
        resolved_at = @resolvedAt,
        resolution_reason = 'daemon_restart',
        updated_at = CURRENT_TIMESTAMP
    WHERE status = 'pending'
  `);
  const listPendingByRun = options.db.prepare<string>(`
    SELECT * FROM approvals WHERE run_id = ? AND status = 'pending'
  `);

  recoverPending.run({ resolvedAt: new Date().toISOString() });

  function notify(approval: RuntimeApproval): void {
    for (const listener of listeners) {
      try {
        listener(approval);
      } catch {
        // Approval persistence and runtime decisions cannot depend on observers.
      }
    }
  }

  function getApproval(id: string): RuntimeApproval | undefined {
    const row = get.get(id) as ApprovalRow | undefined;
    return row === undefined ? undefined : mapApproval(row);
  }

  function transition(
    id: string,
    status: ApprovalRuntimeDecision,
    reason: string
  ): ApprovalDecisionResponse {
    const current = getApproval(id);
    if (current === undefined) throw new ApprovalManagerError();
    if (current.status !== 'pending') return { approval: current, changed: false };

    const resolvedAt = new Date().toISOString();
    const changed = resolvePending.run({
      id,
      status,
      resolvedAt,
      resolutionReason: reason
    }).changes > 0;
    const approval = getApproval(id)!;
    if (!changed) return { approval, changed: false };

    const pending = active.get(id);
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      active.delete(id);
      pending.resolve(status);
    }
    notify(approval);
    return { approval, changed: true };
  }

  const manager: ApprovalManager = {
    request(input): PendingApproval {
      const id = `approval_${nanoid(12)}`;
      const requestedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + (input.ttlMs ?? defaultTtlMs)).toISOString();
      insert.run({
        id,
        runId: input.runId,
        threadId: input.threadId ?? null,
        codexThreadId: input.codexThreadId ?? null,
        turnId: input.turnId,
        itemId: input.itemId,
        requestId: input.requestId,
        kind: input.kind,
        risk: input.risk,
        title: input.title,
        summary: input.summary,
        detailsJson: JSON.stringify(input.details),
        requestedAt,
        expiresAt
      });
      const approval = getApproval(id)!;
      let resolveDecision!: (decision: ApprovalRuntimeDecision) => void;
      const decision = new Promise<ApprovalRuntimeDecision>(resolve => {
        resolveDecision = resolve;
      });
      const timer = setTimeout(() => {
        transition(id, 'expired', 'timeout');
      }, Math.max(0, Date.parse(expiresAt) - Date.now()));
      timer.unref();
      active.set(id, { timer, resolve: resolveDecision });
      notify(approval);
      return { approval, decision };
    },

    get: getApproval,

    list(query = {}) {
      return (list.all({
        status: query.status ?? 'all',
        runId: query.runId ?? null,
        threadId: query.threadId ?? null,
        limit: query.limit ?? 100
      }) as ApprovalRow[]).map(mapApproval);
    },

    approve(id) {
      return transition(id, 'approved', 'user_approved');
    },

    reject(id) {
      return transition(id, 'rejected', 'user_rejected');
    },

    cancelRun(runId, reason = 'run_canceled') {
      const rows = listPendingByRun.all(runId) as ApprovalRow[];
      return rows.map(row => transition(row.id, 'canceled', reason).approval);
    },

    detach(id) {
      const pending = active.get(id);
      if (pending === undefined) return;
      clearTimeout(pending.timer);
      active.delete(id);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return manager;
}

function mapApproval(row: ApprovalRow): RuntimeApproval {
  return {
    id: row.id,
    runId: row.run_id,
    threadId: row.thread_id,
    codexThreadId: row.codex_thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    requestId: row.request_id,
    kind: row.kind,
    status: row.status,
    risk: row.risk,
    title: row.title,
    summary: row.summary,
    details: parseDetails(row.details_json),
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    resolutionReason: row.resolution_reason
  };
}

function parseDetails(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
