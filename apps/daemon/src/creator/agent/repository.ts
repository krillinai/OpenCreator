import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  CreatorActor,
  CreatorAgentApproval,
  CreatorAgentApprovalStatus,
  CreatorAgentEvent,
  CreatorAgentItem,
  CreatorAgentItemKind,
  CreatorAgentItemStatus,
  CreatorAgentSession,
  CreatorAgentSessionStatus,
  CreatorAgentTimelineResponse,
  CreatorAgentTurn,
  CreatorAgentTurnStatus,
  CreatorCommandReceipt,
  CreatorCommandReceiptStatus,
  CreatorJson
} from '@opencreator/protocol';

type RepositoryOptions = {
  idFactory?(prefix: string): string;
  now?(): string;
};

type CreateSessionInput = {
  jobId: string;
  threadId: string;
  runtimeThreadId?: string | null;
  status?: CreatorAgentSessionStatus;
  hostGeneration?: number | null;
};

type CreateTurnInput = {
  jobId: string;
  sessionId: string;
  clientMessageId?: string | null;
  runtimeTurnId?: string | null;
  role: CreatorAgentTurn['role'];
  content: string;
  status: CreatorAgentTurnStatus;
};

type InsertItemInput = {
  jobId: string;
  sessionId: string;
  turnId: string;
  runtimeItemId?: string | null;
  kind: CreatorAgentItemKind;
  status: CreatorAgentItemStatus;
  role?: CreatorAgentItem['role'];
  text?: string;
  toolName?: string;
  approvalId?: string;
  data?: Record<string, CreatorJson>;
  sequence: number;
};

type AppendEventInput = {
  jobId: string;
  sessionId: string;
  turnId?: string | null;
  itemId?: string | null;
  sequence?: number;
  type: CreatorAgentEvent['type'];
  name: string;
  payload?: Record<string, CreatorJson>;
  runtimeEventKey?: string | null;
};

type CreateApprovalInput = Omit<
  CreatorAgentApproval,
  'id' | 'resolvedAt' | 'resolutionReason'
> & {
  resolvedAt?: string | null;
  resolutionReason?: string | null;
};

type CreateReceiptInput = Omit<CreatorCommandReceipt, 'id' | 'createdAt' | 'updatedAt'>;

export type CreatorAgentRepository = ReturnType<typeof createCreatorAgentRepository>;

export function createCreatorAgentRepository(
  db: Database.Database,
  options: RepositoryOptions = {}
) {
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${nanoid()}`);
  const now = options.now ?? (() => new Date().toISOString());

  function createSession(input: CreateSessionInput): CreatorAgentSession {
    const id = idFactory('creator_agent_session');
    const timestamp = now();
    db.prepare(`
      INSERT INTO creator_agent_sessions (
        id, job_id, thread_id, runtime_thread_id, status, host_generation,
        created_at, updated_at, interrupted_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      id,
      input.jobId,
      input.threadId,
      input.runtimeThreadId ?? null,
      input.status ?? 'active',
      input.hostGeneration ?? null,
      timestamp,
      timestamp
    );
    return getSession(id)!;
  }

  function getSession(id: string): CreatorAgentSession | undefined {
    return hydrateSession(db.prepare(`
      SELECT * FROM creator_agent_sessions WHERE id = ?
    `).get(id) as SessionRow | undefined);
  }

  function getSessionByJob(jobId: string): CreatorAgentSession | undefined {
    return hydrateSession(db.prepare(`
      SELECT * FROM creator_agent_sessions WHERE job_id = ?
    `).get(jobId) as SessionRow | undefined);
  }

  function updateSession(input: {
    id: string;
    runtimeThreadId?: string | null;
    status?: CreatorAgentSessionStatus;
    hostGeneration?: number | null;
  }): CreatorAgentSession {
    const current = requireValue(getSession(input.id), 'Creator Agent session');
    const status = input.status ?? current.status;
    const timestamp = now();
    db.prepare(`
      UPDATE creator_agent_sessions
      SET runtime_thread_id = ?, status = ?, host_generation = ?, updated_at = ?,
          interrupted_at = CASE WHEN ? = 'interrupted' THEN COALESCE(interrupted_at, ?) ELSE interrupted_at END,
          closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, ?) ELSE closed_at END
      WHERE id = ?
    `).run(
      input.runtimeThreadId === undefined ? current.runtimeThreadId : input.runtimeThreadId,
      status,
      input.hostGeneration === undefined ? current.hostGeneration : input.hostGeneration,
      timestamp,
      status,
      timestamp,
      status,
      timestamp,
      input.id
    );
    return getSession(input.id)!;
  }

  function createTurn(input: CreateTurnInput): CreatorAgentTurn {
    const id = idFactory('creator_agent_turn');
    const timestamp = now();
    db.prepare(`
      INSERT INTO creator_agent_turns (
        id, job_id, session_id, client_message_id, runtime_turn_id,
        role, content, status, audit_json, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.sessionId,
      input.clientMessageId ?? null,
      input.runtimeTurnId ?? null,
      input.role,
      input.content,
      input.status,
      timestamp,
      input.status === 'running' ? timestamp : null,
      isTerminalTurn(input.status) ? timestamp : null
    );
    return getTurn(id)!;
  }

  function getTurn(id: string): CreatorAgentTurn | undefined {
    return hydrateTurn(db.prepare(`
      SELECT * FROM creator_agent_turns WHERE id = ?
    `).get(id) as TurnRow | undefined);
  }

  function getTurnByRuntimeId(
    sessionId: string,
    runtimeTurnId: string
  ): CreatorAgentTurn | undefined {
    return hydrateTurn(db.prepare(`
      SELECT * FROM creator_agent_turns
      WHERE session_id = ? AND runtime_turn_id = ?
    `).get(sessionId, runtimeTurnId) as TurnRow | undefined);
  }

  function listTurns(sessionId: string): CreatorAgentTurn[] {
    return (db.prepare(`
      SELECT * FROM creator_agent_turns
      WHERE session_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(sessionId) as TurnRow[]).map(row => hydrateTurn(row)!);
  }

  function updateTurn(input: {
    id: string;
    runtimeTurnId?: string | null;
    content?: string;
    status?: CreatorAgentTurnStatus;
    audit?: CreatorAgentTurn['audit'];
  }): CreatorAgentTurn {
    const current = requireValue(getTurn(input.id), 'Creator Agent turn');
    const status = input.status ?? current.status;
    const timestamp = now();
    db.prepare(`
      UPDATE creator_agent_turns
      SET runtime_turn_id = ?, content = ?, status = ?, audit_json = ?,
          started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
          completed_at = CASE WHEN ? IN (
            'completed','failed','canceled','interrupted','needs_user_resolution'
          ) THEN COALESCE(completed_at, ?) ELSE completed_at END
      WHERE id = ?
    `).run(
      input.runtimeTurnId === undefined ? current.runtimeTurnId ?? null : input.runtimeTurnId,
      input.content ?? current.content,
      status,
      JSON.stringify(input.audit ?? current.audit),
      status,
      timestamp,
      status,
      timestamp,
      input.id
    );
    return getTurn(input.id)!;
  }

  function insertItem(input: InsertItemInput): CreatorAgentItem {
    const id = idFactory('creator_agent_item');
    const timestamp = now();
    db.prepare(`
      INSERT INTO creator_agent_items (
        id, job_id, session_id, turn_id, runtime_item_id, kind, status,
        role, text, tool_name, approval_id, data_json, sequence,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.sessionId,
      input.turnId,
      input.runtimeItemId ?? null,
      input.kind,
      input.status,
      input.role ?? null,
      input.text ?? null,
      input.toolName ?? null,
      input.approvalId ?? null,
      JSON.stringify(input.data ?? {}),
      input.sequence,
      timestamp,
      timestamp
    );
    return getItem(id)!;
  }

  function getItem(id: string): CreatorAgentItem | undefined {
    return hydrateItem(db.prepare(`
      SELECT * FROM creator_agent_items WHERE id = ?
    `).get(id) as ItemRow | undefined);
  }

  function getItemByRuntimeId(
    sessionId: string,
    runtimeItemId: string
  ): CreatorAgentItem | undefined {
    return hydrateItem(db.prepare(`
      SELECT * FROM creator_agent_items
      WHERE session_id = ? AND runtime_item_id = ?
    `).get(sessionId, runtimeItemId) as ItemRow | undefined);
  }

  function listItems(sessionId: string): CreatorAgentItem[] {
    return (db.prepare(`
      SELECT * FROM creator_agent_items
      WHERE session_id = ?
      ORDER BY created_at ASC, sequence ASC, rowid ASC
    `).all(sessionId) as ItemRow[]).map(row => hydrateItem(row)!);
  }

  function updateItem(input: {
    id: string;
    runtimeItemId?: string | null;
    status?: CreatorAgentItemStatus;
    text?: string | null;
    toolName?: string | null;
    approvalId?: string | null;
    data?: Record<string, CreatorJson>;
  }): CreatorAgentItem {
    const current = requireValue(getItem(input.id), 'Creator Agent item');
    db.prepare(`
      UPDATE creator_agent_items
      SET runtime_item_id = ?, status = ?, text = ?, tool_name = ?, approval_id = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.runtimeItemId === undefined ? current.runtimeItemId : input.runtimeItemId,
      input.status ?? current.status,
      input.text === undefined ? current.text ?? null : input.text,
      input.toolName === undefined ? current.toolName ?? null : input.toolName,
      input.approvalId === undefined ? current.approvalId ?? null : input.approvalId,
      JSON.stringify(input.data ?? current.data),
      now(),
      input.id
    );
    return getItem(input.id)!;
  }

  function finalizeTurnItems(
    turnId: string,
    status: CreatorAgentItemStatus
  ): number {
    return db.prepare(`
      UPDATE creator_agent_items
      SET status = ?, updated_at = ?
      WHERE turn_id = ? AND status IN ('queued', 'running')
    `).run(status, now(), turnId).changes;
  }

  function appendEvent(input: AppendEventInput): CreatorAgentEvent {
    if (input.runtimeEventKey !== undefined && input.runtimeEventKey !== null) {
      const existing = getEventByRuntimeKey(input.sessionId, input.runtimeEventKey);
      if (existing !== undefined) return existing;
    }
    const id = idFactory('creator_agent_event');
    const sequence = input.sequence ?? nextEventSequence(input.sessionId);
    db.prepare(`
      INSERT INTO creator_agent_events (
        id, job_id, session_id, turn_id, item_id, sequence,
        type, name, payload_json, runtime_event_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.sessionId,
      input.turnId ?? null,
      input.itemId ?? null,
      sequence,
      input.type,
      input.name,
      JSON.stringify(input.payload ?? {}),
      input.runtimeEventKey ?? null,
      now()
    );
    return getEvent(id)!;
  }

  function getEvent(id: string): CreatorAgentEvent | undefined {
    return hydrateEvent(db.prepare(`
      SELECT * FROM creator_agent_events WHERE id = ?
    `).get(id) as EventRow | undefined);
  }

  function getEventByRuntimeKey(
    sessionId: string,
    runtimeEventKey: string
  ): CreatorAgentEvent | undefined {
    return hydrateEvent(db.prepare(`
      SELECT * FROM creator_agent_events
      WHERE session_id = ? AND runtime_event_key = ?
    `).get(sessionId, runtimeEventKey) as EventRow | undefined);
  }

  function listEvents(sessionId: string, afterSequence = 0): CreatorAgentEvent[] {
    return (db.prepare(`
      SELECT * FROM creator_agent_events
      WHERE session_id = ? AND sequence > ?
      ORDER BY sequence ASC
    `).all(sessionId, afterSequence) as EventRow[]).map(row => hydrateEvent(row)!);
  }

  function nextEventSequence(sessionId: string): number {
    const row = db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
      FROM creator_agent_events WHERE session_id = ?
    `).get(sessionId) as { sequence: number };
    return row.sequence;
  }

  function createApproval(input: CreateApprovalInput): CreatorAgentApproval {
    const id = idFactory('creator_agent_approval');
    db.prepare(`
      INSERT INTO creator_agent_approvals (
        id, job_id, session_id, turn_id, item_id, runtime_request_id,
        process_generation, kind, status, title, summary, details_json,
        requested_at, expires_at, resolved_at, resolution_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.sessionId,
      input.turnId,
      input.itemId,
      input.runtimeRequestId,
      input.processGeneration,
      input.kind,
      input.status,
      input.title,
      input.summary,
      JSON.stringify(input.details),
      input.requestedAt,
      input.expiresAt,
      input.resolvedAt ?? null,
      input.resolutionReason ?? null
    );
    return getApproval(id)!;
  }

  function getApproval(id: string): CreatorAgentApproval | undefined {
    return hydrateApproval(db.prepare(`
      SELECT * FROM creator_agent_approvals WHERE id = ?
    `).get(id) as ApprovalRow | undefined);
  }

  function listApprovals(
    sessionId: string,
    status?: CreatorAgentApprovalStatus
  ): CreatorAgentApproval[] {
    const rows = status === undefined
      ? db.prepare(`
          SELECT * FROM creator_agent_approvals
          WHERE session_id = ? ORDER BY requested_at ASC, rowid ASC
        `).all(sessionId)
      : db.prepare(`
          SELECT * FROM creator_agent_approvals
          WHERE session_id = ? AND status = ? ORDER BY requested_at ASC, rowid ASC
        `).all(sessionId, status);
    return (rows as ApprovalRow[]).map(row => hydrateApproval(row)!);
  }

  function updateApproval(input: {
    id: string;
    status: CreatorAgentApprovalStatus;
    resolutionReason?: string | null;
  }): CreatorAgentApproval {
    const timestamp = now();
    db.prepare(`
      UPDATE creator_agent_approvals
      SET status = ?, resolved_at = CASE WHEN ? = 'pending' THEN NULL ELSE ? END,
          resolution_reason = ?
      WHERE id = ?
    `).run(
      input.status,
      input.status,
      timestamp,
      input.resolutionReason ?? null,
      input.id
    );
    return requireValue(getApproval(input.id), 'Creator Agent approval');
  }

  function expireApprovalsBeforeGeneration(
    sessionId: string,
    processGeneration: number
  ): number {
    return db.prepare(`
      UPDATE creator_agent_approvals
      SET status = 'expired', resolved_at = ?, resolution_reason = 'process_generation_changed'
      WHERE session_id = ? AND status = 'pending' AND process_generation <> ?
    `).run(now(), sessionId, processGeneration).changes;
  }

  function createReceipt(input: CreateReceiptInput): CreatorCommandReceipt {
    const id = idFactory('creator_command_receipt');
    const timestamp = now();
    db.prepare(`
      INSERT INTO creator_command_receipts (
        id, job_id, actor, command, idempotency_key, request_hash,
        expected_revision, committed_revision, status, result_json,
        error_code, error_message, stage_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.actor,
      input.command,
      input.idempotencyKey,
      input.requestHash,
      input.expectedRevision,
      input.committedRevision,
      input.status,
      input.result === null ? null : JSON.stringify(input.result),
      input.errorCode,
      input.errorMessage,
      input.stageRunId,
      timestamp,
      timestamp
    );
    return getReceipt(id)!;
  }

  function getReceipt(id: string): CreatorCommandReceipt | undefined {
    return hydrateReceipt(db.prepare(`
      SELECT * FROM creator_command_receipts WHERE id = ?
    `).get(id) as ReceiptRow | undefined);
  }

  function getReceiptByKey(
    jobId: string,
    idempotencyKey: string
  ): CreatorCommandReceipt | undefined {
    return hydrateReceipt(db.prepare(`
      SELECT * FROM creator_command_receipts
      WHERE job_id = ? AND idempotency_key = ?
    `).get(jobId, idempotencyKey) as ReceiptRow | undefined);
  }

  function updateReceipt(input: {
    id: string;
    status: CreatorCommandReceiptStatus;
    committedRevision?: number | null;
    result?: Record<string, CreatorJson> | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    stageRunId?: string | null;
  }): CreatorCommandReceipt {
    const current = requireValue(getReceipt(input.id), 'Creator command receipt');
    db.prepare(`
      UPDATE creator_command_receipts
      SET status = ?, committed_revision = ?, result_json = ?, error_code = ?,
          error_message = ?, stage_run_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.committedRevision === undefined
        ? current.committedRevision
        : input.committedRevision,
      input.result === undefined
        ? current.result === null ? null : JSON.stringify(current.result)
        : input.result === null ? null : JSON.stringify(input.result),
      input.errorCode === undefined ? current.errorCode : input.errorCode,
      input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
      input.stageRunId === undefined ? current.stageRunId : input.stageRunId,
      now(),
      input.id
    );
    return getReceipt(input.id)!;
  }

  function timeline(jobId: string): CreatorAgentTimelineResponse | undefined {
    const session = getSessionByJob(jobId);
    if (session === undefined) return undefined;
    const events = listEvents(session.id);
    return {
      session,
      turns: listTurns(session.id),
      items: listItems(session.id),
      approvals: listApprovals(session.id),
      lastEventSequence: events.at(-1)?.sequence ?? 0
    };
  }

  function markForRecovery(): { sessions: number; turns: number; approvals: number } {
    return db.transaction(() => {
      const timestamp = now();
      const approvals = db.prepare(`
        UPDATE creator_agent_approvals
        SET status = 'expired', resolved_at = ?, resolution_reason = 'daemon_restarted'
        WHERE status = 'pending'
      `).run(timestamp).changes;
      const turns = db.prepare(`
        UPDATE creator_agent_turns
        SET status = 'needs_user_resolution', completed_at = COALESCE(completed_at, ?)
        WHERE status IN ('running', 'waiting_approval')
      `).run(timestamp).changes;
      db.prepare(`
        UPDATE creator_agent_items
        SET status = CASE (
          SELECT status FROM creator_agent_turns
          WHERE creator_agent_turns.id = creator_agent_items.turn_id
        )
          WHEN 'failed' THEN 'failed'
          WHEN 'canceled' THEN 'canceled'
          WHEN 'interrupted' THEN 'interrupted'
          WHEN 'needs_user_resolution' THEN 'interrupted'
          ELSE 'completed'
        END,
        updated_at = ?
        WHERE status IN ('queued', 'running')
          AND turn_id IN (
            SELECT id FROM creator_agent_turns
            WHERE status IN (
              'completed', 'failed', 'canceled', 'interrupted', 'needs_user_resolution'
            )
          )
      `).run(timestamp);
      const sessions = db.prepare(`
        UPDATE creator_agent_sessions
        SET status = 'interrupted', interrupted_at = COALESCE(interrupted_at, ?), updated_at = ?
        WHERE status = 'active' AND id IN (
          SELECT DISTINCT session_id FROM creator_agent_turns
          WHERE status = 'needs_user_resolution'
        )
      `).run(timestamp, timestamp).changes;
      return { sessions, turns, approvals };
    })();
  }

  return {
    transaction<T>(operation: () => T): T {
      return db.transaction(operation)();
    },
    createSession,
    getSession,
    getSessionByJob,
    updateSession,
    createTurn,
    getTurn,
    getTurnByRuntimeId,
    listTurns,
    updateTurn,
    insertItem,
    getItem,
    getItemByRuntimeId,
    listItems,
    updateItem,
    finalizeTurnItems,
    appendEvent,
    getEvent,
    getEventByRuntimeKey,
    listEvents,
    nextEventSequence,
    createApproval,
    getApproval,
    listApprovals,
    updateApproval,
    expireApprovalsBeforeGeneration,
    createReceipt,
    getReceipt,
    getReceiptByKey,
    updateReceipt,
    timeline,
    markForRecovery
  };
}

type SessionRow = {
  id: string;
  job_id: string;
  thread_id: string;
  runtime_thread_id: string | null;
  status: CreatorAgentSessionStatus;
  host_generation: number | null;
  created_at: string;
  updated_at: string;
  interrupted_at: string | null;
  closed_at: string | null;
};

type TurnRow = {
  id: string;
  job_id: string;
  session_id: string;
  client_message_id: string | null;
  runtime_turn_id: string | null;
  role: CreatorAgentTurn['role'];
  content: string;
  status: CreatorAgentTurnStatus;
  audit_json: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type ItemRow = {
  id: string;
  job_id: string;
  session_id: string;
  turn_id: string;
  runtime_item_id: string | null;
  kind: CreatorAgentItemKind;
  status: CreatorAgentItemStatus;
  role: CreatorAgentItem['role'] | null;
  text: string | null;
  tool_name: string | null;
  approval_id: string | null;
  data_json: string;
  sequence: number;
  created_at: string;
  updated_at: string;
};

type EventRow = {
  id: string;
  job_id: string;
  session_id: string;
  turn_id: string | null;
  item_id: string | null;
  sequence: number;
  type: CreatorAgentEvent['type'];
  name: string;
  payload_json: string;
  created_at: string;
};

type ApprovalRow = {
  id: string;
  job_id: string;
  session_id: string;
  turn_id: string;
  item_id: string;
  runtime_request_id: string;
  process_generation: number;
  kind: CreatorAgentApproval['kind'];
  status: CreatorAgentApprovalStatus;
  title: string;
  summary: string;
  details_json: string;
  requested_at: string;
  expires_at: string;
  resolved_at: string | null;
  resolution_reason: string | null;
};

type ReceiptRow = {
  id: string;
  job_id: string;
  actor: CreatorActor;
  command: string;
  idempotency_key: string;
  request_hash: string;
  expected_revision: number;
  committed_revision: number | null;
  status: CreatorCommandReceiptStatus;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  stage_run_id: string | null;
  created_at: string;
  updated_at: string;
};

function hydrateSession(row: SessionRow | undefined): CreatorAgentSession | undefined {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jobId: row.job_id,
    threadId: row.thread_id,
    runtimeThreadId: row.runtime_thread_id,
    status: row.status,
    hostGeneration: row.host_generation,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    interruptedAt: nullableIso(row.interrupted_at),
    closedAt: nullableIso(row.closed_at)
  };
}

function hydrateTurn(row: TurnRow | undefined): CreatorAgentTurn | undefined {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    clientMessageId: row.client_message_id,
    runtimeTurnId: row.runtime_turn_id,
    role: row.role,
    content: row.content,
    status: row.status,
    audit: parseJson(row.audit_json) as CreatorAgentTurn['audit'],
    createdAt: toIso(row.created_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at)
  };
}

function hydrateItem(row: ItemRow | undefined): CreatorAgentItem | undefined {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    runtimeItemId: row.runtime_item_id,
    kind: row.kind,
    status: row.status,
    ...(row.role === null ? {} : { role: row.role }),
    ...(row.text === null ? {} : { text: row.text }),
    ...(row.tool_name === null ? {} : { toolName: row.tool_name }),
    ...(row.approval_id === null ? {} : { approvalId: row.approval_id }),
    data: parseJsonRecord(row.data_json),
    sequence: row.sequence,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function hydrateEvent(row: EventRow | undefined): CreatorAgentEvent | undefined {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    sequence: row.sequence,
    type: row.type,
    name: row.name,
    payload: parseJsonRecord(row.payload_json),
    createdAt: toIso(row.created_at)
  };
}

function hydrateApproval(row: ApprovalRow | undefined): CreatorAgentApproval | undefined {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    runtimeRequestId: row.runtime_request_id,
    processGeneration: row.process_generation,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    details: parseJsonRecord(row.details_json),
    requestedAt: toIso(row.requested_at),
    expiresAt: toIso(row.expires_at),
    resolvedAt: nullableIso(row.resolved_at),
    resolutionReason: row.resolution_reason
  };
}

function hydrateReceipt(row: ReceiptRow | undefined): CreatorCommandReceipt | undefined {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    jobId: row.job_id,
    actor: row.actor,
    command: row.command,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    expectedRevision: row.expected_revision,
    committedRevision: row.committed_revision,
    status: row.status,
    result: row.result_json === null ? null : parseJsonRecord(row.result_json),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    stageRunId: row.stage_run_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function isTerminalTurn(status: CreatorAgentTurnStatus): boolean {
  return [
    'completed',
    'failed',
    'canceled',
    'interrupted',
    'needs_user_resolution'
  ].includes(status);
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} not found`);
  return value;
}

function parseJson(value: string): CreatorJson {
  return JSON.parse(value) as CreatorJson;
}

function parseJsonRecord(value: string): Record<string, CreatorJson> {
  const parsed = parseJson(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Invalid Creator JSON record');
  }
  return parsed;
}

function nullableIso(value: string | null): string | null {
  return value === null ? null : toIso(value);
}

function toIso(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(normalized).toISOString();
}
