import { nanoid } from 'nanoid';
import type {
  CreatorAgentApproval,
  CreatorAgentApprovalStatus,
  CreatorAgentEvent,
  CreatorAgentTimelineResponse,
  CreatorAgentSteerRequest,
  CreatorAgentTurn,
  CreatorAgentTurnRequest,
  CreatorActionResponse
} from '@opencreator/protocol';
import type {
  AppServerApprovalDecision,
  AppServerRequest
} from '../../codex/app-server-host-2026-07-28.js';
import type { ThreadManager } from '../../threads/types.js';
import {
  CreatorCommandError,
  type CreatorCommandDispatcher
} from '../command-dispatcher.js';
import { CreatorServiceError, type CreatorService } from '../service.js';
import type { AgentContextBuilder } from './context-builder.js';
import { normalizeCreatorRuntimeEvent } from './event-normalizer.js';
import { createCreatorAgentReconciler } from './reconciler.js';
import type { CreatorAgentRepository } from './repository.js';
import type { AgentRuntimeAdapter } from './runtime-adapter.js';

export type CreatorAgentService = ReturnType<typeof createCreatorAgentService>;

type PendingApproval = {
  sessionId: string;
  turnId: string;
  processGeneration: number;
  resolve(decision: AppServerApprovalDecision): void;
};

export function createCreatorAgentService(input: {
  creator: CreatorService;
  dispatcher: CreatorCommandDispatcher;
  repository: CreatorAgentRepository;
  threads: Pick<ThreadManager, 'createThread' | 'getThread' | 'updateThread'>;
  contextBuilder: AgentContextBuilder;
  runtime: AgentRuntimeAdapter;
  now?(): string;
  onEvent?(event: CreatorAgentEvent): void;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  const pendingApprovals = new Map<string, PendingApproval>();
  const activeRunByJob = new Map<string, string>();
  const reconciler = createCreatorAgentReconciler({ repository: input.repository });

  async function runTurn(jobId: string, request: CreatorAgentTurnRequest): Promise<{
    turn: CreatorAgentTurn;
    action?: CreatorActionResponse;
  }> {
    const initialJob = input.creator.getJob(jobId);
    if (initialJob === undefined) {
      throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
    }
    if (!input.runtime.available) {
      throw new CreatorServiceError('creator_agent_unavailable', 'Creator Agent is not ready');
    }
    const { threadId, sessionId } = ensureSession(jobId, request.sandbox);
    const userTurn = input.repository.createTurn({
      jobId,
      sessionId,
      clientMessageId: request.clientMessageId ?? `client_${nanoid(12)}`,
      role: 'user',
      content: request.message,
      status: 'completed'
    });
    const userItem = input.repository.insertItem({
      jobId,
      sessionId,
      turnId: userTurn.id,
      kind: 'user_message',
      status: 'completed',
      role: 'user',
      text: request.message,
      sequence: 1
    });
    appendEvent({
      jobId,
      sessionId,
      turnId: userTurn.id,
      itemId: userItem.id,
      type: 'item',
      name: 'user_message.created',
      runtimeEventKey: `client:${request.clientMessageId ?? userTurn.id}`
    });

    const audit: CreatorAgentTurn['audit'] = [];
    let lastTurn: CreatorAgentTurn | undefined;
    let actionResponse: CreatorActionResponse | undefined;
    for (const conflictAttempt of [0, 1] as const) {
      const job = input.creator.getJob(jobId)!;
      const context = input.contextBuilder.build(job, request.selection ?? null);
      audit.push({ tool: 'creator_get_context', revision: context.revision, result: 'ok' });
      const assistantTurn = input.repository.createTurn({
        jobId,
        sessionId,
        role: 'assistant',
        content: '',
        status: 'queued'
      });
      lastTurn = input.repository.updateTurn({
        id: assistantTurn.id,
        status: 'running',
        audit
      });
      const runId = assistantTurn.id;
      activeRunByJob.set(jobId, runId);
      let processGeneration = input.repository.getSession(sessionId)?.hostGeneration ?? 0;
      try {
        const runtimeResult = await input.runtime.runTurn({
          runId,
          threadId,
          message: request.message,
          selection: request.selection ?? null,
          context,
          conflictAttempt,
          onStarted(info) {
            processGeneration = info.generation;
            input.repository.updateSession({
              id: sessionId,
              status: 'active',
              hostGeneration: info.generation
            });
            input.repository.expireApprovalsBeforeGeneration(
              sessionId,
              info.generation
            );
            expirePendingApprovals(sessionId, info.generation);
          },
          onNotification(notification) {
            persistRuntimeNotification({
              jobId,
              sessionId,
              turnId: assistantTurn.id,
              notification
            });
          },
          onThreadRead(thread) {
            reconciler.reconcileThread({ jobId, sessionId, thread });
          },
          onApprovalRequest(request) {
            if (
              input.threads.getThread(threadId)?.sandbox === 'danger-full-access'
              && isCreatorToolRequest(request)
            ) return Promise.resolve('approved');
            if (isAutoApprovedCreatorReadRequest(request)) return Promise.resolve('approved');
            return awaitApproval({
              jobId,
              sessionId,
              turnId: assistantTurn.id,
              processGeneration,
              request
            });
          }
        });
        if (runtimeResult.runtimeThreadId !== undefined) {
          input.repository.updateSession({
            id: sessionId,
            runtimeThreadId: runtimeResult.runtimeThreadId,
            status: 'active',
            hostGeneration: runtimeResult.processGeneration ?? processGeneration
          });
        }
        lastTurn = persistAssistantResult({
          jobId,
          sessionId,
          turnId: assistantTurn.id,
          runtimeTurnId: runtimeResult.runtimeTurnId,
          content: runtimeResult.content,
          status: 'completed',
          audit
        });
        if (runtimeResult.action === undefined) break;
        try {
          const dispatched = input.dispatcher.dispatch(jobId, {
            ...runtimeResult.action,
            idempotencyKey: `${assistantTurn.id}:action:${conflictAttempt}`
          }, 'agent');
          actionResponse = { job: dispatched.job, receipt: dispatched.receipt };
          audit.push({
            tool: 'creator_apply_action',
            revision: runtimeResult.action.expectedRevision,
            result: 'ok'
          });
          lastTurn = input.repository.updateTurn({
            id: assistantTurn.id,
            audit
          });
          break;
        } catch (error) {
          if (!(error instanceof CreatorCommandError)
            || error.code !== 'creator_revision_conflict') throw error;
          audit.push({
            tool: 'creator_apply_action',
            revision: runtimeResult.action.expectedRevision,
            result: 'creator_revision_conflict'
          });
          lastTurn = input.repository.updateTurn({
            id: assistantTurn.id,
            audit,
            status: conflictAttempt === 1 ? 'needs_user_resolution' : 'completed'
          });
          if (conflictAttempt === 1) return { turn: lastTurn };
        }
      } catch (error) {
        expirePendingApprovalsForTurn(sessionId, assistantTurn.id, 'expired');
        lastTurn = input.repository.updateTurn({
          id: assistantTurn.id,
          status: 'failed',
          content: error instanceof Error ? error.message : 'Creator Agent failed',
          audit
        });
        input.repository.finalizeTurnItems(assistantTurn.id, 'failed');
        input.repository.insertItem({
          jobId,
          sessionId,
          turnId: assistantTurn.id,
          kind: 'error',
          status: 'failed',
          text: lastTurn.content,
          sequence: nextItemSequence(sessionId, assistantTurn.id)
        });
        appendEvent({
          jobId,
          sessionId,
          turnId: assistantTurn.id,
          type: 'turn',
          name: 'turn.failed',
          payload: { message: lastTurn.content }
        });
        throw error;
      } finally {
        if (activeRunByJob.get(jobId) === runId) activeRunByJob.delete(jobId);
      }
    }
    if (lastTurn === undefined) throw new Error('Creator Agent did not create a turn');
    return {
      turn: lastTurn,
      ...(actionResponse === undefined ? {} : { action: actionResponse })
    };
  }

  function ensureSession(
    jobId: string,
    requestedSandbox?: CreatorAgentTurnRequest['sandbox']
  ): { threadId: string; sessionId: string } {
    const job = input.creator.getJob(jobId)!;
    let threadId = job.agentThreadId;
    let thread = threadId === null ? undefined : input.threads.getThread(threadId);
    if (threadId === null || thread === undefined) {
      const thread = input.threads.createThread({
        title: `OpenCreator ${job.templateId}`,
        purpose: 'creator_agent',
        sandbox: requestedSandbox ?? 'workspace-write'
      });
      threadId = thread.id;
      input.creator.bindAgentThread(jobId, threadId);
    } else if (requestedSandbox !== undefined && thread.sandbox !== requestedSandbox) {
      thread = input.threads.updateThread(threadId, { sandbox: requestedSandbox });
    }
    const existing = input.repository.getSessionByJob(jobId);
    const session = existing ?? input.repository.createSession({
      jobId,
      threadId,
      status: 'active'
    });
    return { threadId, sessionId: session.id };
  }

  function persistRuntimeNotification(event: {
    jobId: string;
    sessionId: string;
    turnId: string;
    notification: Record<string, unknown>;
  }): void {
    const normalized = normalizeCreatorRuntimeEvent(event.notification);
    const runtimeClientMessageId = normalized.item?.kind === 'user_message'
      && typeof normalized.item.data.clientId === 'string'
      ? normalized.item.data.clientId
      : undefined;
    const targetTurnId = runtimeClientMessageId === undefined
      ? event.turnId
      : input.repository.listTurns(event.sessionId).find(turn => (
          turn.role === 'user' && turn.clientMessageId === runtimeClientMessageId
        ))?.id ?? event.turnId;
    let itemId: string | null = null;
    if (normalized.runtimeItemId !== null && normalized.item !== undefined) {
      const existing = input.repository.getItemByRuntimeId(
        event.sessionId,
        normalized.runtimeItemId
      );
      const localUserItem = existing === undefined && normalized.item.kind === 'user_message'
        ? input.repository.listItems(event.sessionId).find(item => (
            item.turnId === targetTurnId
            && item.kind === 'user_message'
            && item.runtimeItemId === null
          ))
        : undefined;
      const item = existing === undefined && localUserItem === undefined
        ? input.repository.insertItem({
            jobId: event.jobId,
            sessionId: event.sessionId,
            turnId: targetTurnId,
            runtimeItemId: normalized.runtimeItemId,
            kind: normalized.item.kind,
            status: normalized.item.status,
            text: normalized.item.text,
            toolName: normalized.item.toolName,
            data: normalized.item.data,
            sequence: nextItemSequence(event.sessionId, targetTurnId)
          })
        : input.repository.updateItem({
            id: (existing ?? localUserItem)!.id,
            runtimeItemId: normalized.runtimeItemId,
            status: terminalItemStatus((existing ?? localUserItem)!.status)
              ? (existing ?? localUserItem)!.status
              : normalized.item.status,
            text: normalized.item.text,
            toolName: normalized.item.toolName,
            data: normalized.item.data
          });
      itemId = item.id;
      if (
        item.kind === 'assistant_message'
        && item.data.phase === 'final_answer'
        && item.text !== undefined
      ) {
        input.repository.updateTurn({ id: event.turnId, content: item.text });
      }
    } else if (normalized.runtimeItemId !== null && normalized.textDelta !== undefined) {
      const existing = input.repository.getItemByRuntimeId(
        event.sessionId,
        normalized.runtimeItemId
      );
      if (existing !== undefined && !terminalItemStatus(existing.status)) {
        const text = `${existing.text ?? ''}${normalized.textDelta}`;
        const item = input.repository.updateItem({ id: existing.id, text });
        itemId = item.id;
        if (item.kind === 'assistant_message' && item.data.phase === 'final_answer') {
          input.repository.updateTurn({ id: event.turnId, content: text });
        }
      }
    }
    appendEvent({
      jobId: event.jobId,
      sessionId: event.sessionId,
      turnId: targetTurnId,
      itemId,
      type: normalized.type,
      name: normalized.name,
      payload: normalized.payload,
      runtimeEventKey: normalized.runtimeEventKey
    });
  }

  function persistAssistantResult(event: {
    jobId: string;
    sessionId: string;
    turnId: string;
    runtimeTurnId?: string;
    content: string;
    status: CreatorAgentTurn['status'];
    audit: CreatorAgentTurn['audit'];
  }): CreatorAgentTurn {
    const assistantMessages = input.repository.listItems(event.sessionId).filter(item => (
      item.turnId === event.turnId && item.kind === 'assistant_message'
    ));
    const existingMessage = assistantMessages.find(item => item.data.phase === 'final_answer')
      ?? assistantMessages.at(-1);
    if (existingMessage === undefined && event.content.length > 0) {
      input.repository.insertItem({
        jobId: event.jobId,
        sessionId: event.sessionId,
        turnId: event.turnId,
        kind: 'assistant_message',
        status: 'completed',
        role: 'assistant',
        text: event.content,
        sequence: nextItemSequence(event.sessionId, event.turnId)
      });
    } else if (existingMessage !== undefined) {
      input.repository.updateItem({
        id: existingMessage.id,
        status: 'completed',
        text: event.content || existingMessage.text
      });
    }
    const turn = input.repository.updateTurn({
      id: event.turnId,
      runtimeTurnId: event.runtimeTurnId,
      content: event.content,
      status: event.status,
      audit: event.audit
    });
    input.repository.finalizeTurnItems(
      event.turnId,
      itemStatusForTerminalTurn(event.status)
    );
    appendEvent({
      jobId: event.jobId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      type: 'turn',
      name: `turn.${event.status}`,
      runtimeEventKey: event.runtimeTurnId === undefined
        ? null
        : `${event.runtimeTurnId}:${event.status}`
    });
    return turn;
  }

  function awaitApproval(event: {
    jobId: string;
    sessionId: string;
    turnId: string;
    processGeneration: number;
    request: AppServerRequest;
  }): Promise<AppServerApprovalDecision> {
    const params = event.request.params;
    const runtimeItemId = typeof params.itemId === 'string'
      ? params.itemId
      : `approval_item_${event.request.id}`;
    const existingItem = input.repository.getItemByRuntimeId(
      event.sessionId,
      runtimeItemId
    );
    const item = existingItem ?? input.repository.insertItem({
      jobId: event.jobId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      runtimeItemId,
      kind: 'approval',
      status: 'running',
      data: JSON.parse(JSON.stringify(params)),
      sequence: nextItemSequence(event.sessionId, event.turnId)
    });
    const requestedAt = now();
    const approval = input.repository.createApproval({
      jobId: event.jobId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      itemId: item.id,
      runtimeRequestId: String(event.request.id),
      processGeneration: event.processGeneration,
      kind: approvalKind(event.request.method),
      status: 'pending',
      title: approvalTitle(event.request.method),
      summary: typeof params.reason === 'string' ? params.reason : 'Creator Agent 请求执行操作',
      details: JSON.parse(JSON.stringify(params)),
      requestedAt,
      expiresAt: new Date(Date.parse(requestedAt) + 15 * 60_000).toISOString()
    });
    input.repository.updateItem({ id: item.id, approvalId: approval.id });
    input.repository.updateTurn({ id: event.turnId, status: 'waiting_approval' });
    appendEvent({
      jobId: event.jobId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      itemId: item.id,
      type: 'approval',
      name: 'approval.pending',
      payload: { approvalId: approval.id, processGeneration: event.processGeneration }
    });
    return new Promise(resolve => {
      pendingApprovals.set(approval.id, {
        sessionId: event.sessionId,
        turnId: event.turnId,
        processGeneration: event.processGeneration,
        resolve
      });
    });
  }

  function respondApproval(
    approvalId: string,
    decision: Extract<CreatorAgentApprovalStatus, 'approved' | 'rejected' | 'canceled'>,
    processGeneration: number
  ): CreatorAgentApproval {
    const approval = input.repository.getApproval(approvalId);
    if (approval === undefined) throw new CreatorServiceError('creator_approval_not_found', 'Approval not found');
    const pending = pendingApprovals.get(approvalId);
    const expiredByTime = Date.parse(approval.expiresAt) <= Date.parse(now());
    if (
      approval.status !== 'pending'
      || pending === undefined
      || approval.processGeneration !== processGeneration
      || pending.processGeneration !== processGeneration
      || expiredByTime
    ) {
      if (approval.status === 'pending') {
        const expired = input.repository.updateApproval({
          id: approval.id,
          status: 'expired',
          resolutionReason: expiredByTime
            ? 'approval_expired'
            : 'process_generation_changed'
        });
        if (pending !== undefined) {
          pendingApprovals.delete(approvalId);
          pending.resolve('expired');
        }
        input.repository.updateItem({ id: approval.itemId, status: 'canceled' });
        input.repository.updateTurn({ id: approval.turnId, status: 'running' });
        appendApprovalResolvedEvent(expired);
        return expired;
      }
      return approval;
    }
    pendingApprovals.delete(approvalId);
    const updated = input.repository.updateApproval({ id: approval.id, status: decision });
    input.repository.updateItem({
      id: approval.itemId,
      status: decision === 'approved' || decision === 'rejected'
        ? 'completed'
        : 'canceled'
    });
    input.repository.updateTurn({ id: approval.turnId, status: 'running' });
    appendApprovalResolvedEvent(updated);
    pending.resolve(decision);
    return updated;
  }

  function expirePendingApprovals(sessionId: string, processGeneration: number): void {
    for (const [approvalId, pending] of pendingApprovals) {
      if (
        pending.sessionId !== sessionId
        || pending.processGeneration === processGeneration
      ) continue;
      pendingApprovals.delete(approvalId);
      pending.resolve('expired');
    }
  }

  function expirePendingApprovalsForTurn(
    sessionId: string,
    turnId: string,
    decision: AppServerApprovalDecision
  ): void {
    for (const [approvalId, pending] of pendingApprovals) {
      if (pending.sessionId !== sessionId || pending.turnId !== turnId) continue;
      pendingApprovals.delete(approvalId);
      const approval = input.repository.getApproval(approvalId);
      if (approval?.status === 'pending') {
        const expired = input.repository.updateApproval({
          id: approvalId,
          status: 'expired',
          resolutionReason: 'turn_ended'
        });
        input.repository.updateItem({ id: approval.itemId, status: 'canceled' });
        appendApprovalResolvedEvent(expired);
      }
      pending.resolve(decision);
    }
  }

  function appendApprovalResolvedEvent(approval: CreatorAgentApproval): void {
    appendEvent({
      jobId: approval.jobId,
      sessionId: approval.sessionId,
      turnId: approval.turnId,
      itemId: approval.itemId,
      type: 'approval',
      name: `approval.${approval.status}`,
      payload: {
        approvalId: approval.id,
        processGeneration: approval.processGeneration
      },
      runtimeEventKey: `approval:${approval.id}:${approval.status}`
    });
  }

  function nextItemSequence(sessionId: string, turnId: string): number {
    const items = input.repository.listItems(sessionId).filter(item => item.turnId === turnId);
    return Math.max(0, ...items.map(item => item.sequence)) + 1;
  }

  async function steer(
    jobId: string,
    request: CreatorAgentSteerRequest
  ): Promise<CreatorAgentTurn> {
    const runId = activeRunByJob.get(jobId);
    if (runId === undefined || input.runtime.steer === undefined) {
      throw new CreatorServiceError(
        'creator_agent_steer_unavailable',
        'Creator Agent has no steerable turn'
      );
    }
    const content = request.message.trim();
    if (content.length === 0) throw new TypeError('message must be a non-empty string');
    const { sessionId } = ensureSession(jobId);
    const clientMessageId = request.clientMessageId ?? `client_${nanoid(12)}`;
    const userTurn = input.repository.createTurn({
      jobId,
      sessionId,
      clientMessageId,
      role: 'user',
      content,
      status: 'completed'
    });
    const item = input.repository.insertItem({
      jobId,
      sessionId,
      turnId: userTurn.id,
      kind: 'user_message',
      status: 'completed',
      role: 'user',
      text: content,
      data: { steered: true },
      sequence: 1
    });
    appendEvent({
      jobId,
      sessionId,
      turnId: userTurn.id,
      itemId: item.id,
      type: 'item',
      name: 'user_message.steered',
      runtimeEventKey: `client:${clientMessageId}`
    });
    try {
      await input.runtime.steer(runId, content, clientMessageId);
      return userTurn;
    } catch (error) {
      input.repository.updateTurn({ id: userTurn.id, status: 'failed' });
      input.repository.updateItem({ id: item.id, status: 'failed' });
      throw error;
    }
  }

  function appendEvent(
    event: Parameters<CreatorAgentRepository['appendEvent']>[0]
  ): CreatorAgentEvent {
    const stored = input.repository.appendEvent(event);
    input.onEvent?.(stored);
    return stored;
  }

  return {
    runTurn,
    steer,
    getHistory(jobId: string): CreatorAgentTurn[] {
      return input.repository.timeline(jobId)?.turns ?? [];
    },
    getTimeline(jobId: string): CreatorAgentTimelineResponse {
      const timeline = input.repository.timeline(jobId) ?? {
        session: null,
        turns: [],
        items: [],
        approvals: [],
        lastEventSequence: 0
      };
      if (timeline.session === null) return timeline;
      const sandbox = input.threads.getThread(timeline.session.threadId)?.sandbox;
      return {
        ...timeline,
        session: {
          ...timeline.session,
          ...(sandbox === 'workspace-write' || sandbox === 'danger-full-access'
            ? { sandbox }
            : {})
        }
      };
    },
    listEvents(jobId: string, afterSequence = 0) {
      const session = input.repository.getSessionByJob(jobId);
      return session === undefined
        ? []
        : input.repository.listEvents(session.id, afterSequence);
    },
    respondApproval,
    interrupt(jobId: string): boolean {
      const runId = activeRunByJob.get(jobId);
      return runId === undefined ? false : input.runtime.interrupt?.(runId) ?? false;
    },
    async closeScope(jobId: string) {
      await input.runtime.closeScope?.(jobId);
    }
  };
}

function terminalItemStatus(status: CreatorAgentApproval['status'] | string): boolean {
  return ['completed', 'failed', 'canceled', 'interrupted'].includes(status);
}

function itemStatusForTerminalTurn(
  status: CreatorAgentTurn['status']
): 'completed' | 'failed' | 'canceled' | 'interrupted' {
  if (status === 'failed') return 'failed';
  if (status === 'canceled') return 'canceled';
  if (status === 'interrupted') return 'interrupted';
  return 'completed';
}

function approvalKind(method: AppServerRequest['method']): CreatorAgentApproval['kind'] {
  if (method === 'item/commandExecution/requestApproval') return 'command_execution';
  if (method === 'item/fileChange/requestApproval') return 'file_change';
  if (method === 'item/permissions/requestApproval') return 'permissions';
  return 'tool_call';
}

function approvalTitle(method: AppServerRequest['method']): string {
  if (method === 'item/commandExecution/requestApproval') return '确认命令执行';
  if (method === 'item/fileChange/requestApproval') return '确认文件修改';
  if (method === 'item/permissions/requestApproval') return '确认权限请求';
  return '确认工具调用';
}

function isAutoApprovedCreatorReadRequest(request: AppServerRequest): boolean {
  if (!isCreatorToolRequest(request)) return false;
  const params = request.params;
  const message = typeof params.message === 'string' ? params.message : '';
  return /\"creator_get_(?:context|artifact)\"/.test(message);
}

function isCreatorToolRequest(request: AppServerRequest): boolean {
  if (request.method !== 'mcpServer/elicitation/request') return false;
  const params = request.params;
  if (params.serverName !== 'opencreator_tools') return false;
  const nestedRequest = isRecord(params.request) ? params.request : undefined;
  const meta = [params._meta, params.meta, nestedRequest?._meta, nestedRequest?.meta]
    .find(isRecord);
  if (
    meta?.codex_approval_kind === 'mcp_tool_call'
    || meta?.codex_request_type === 'approval_request'
  ) {
    return true;
  }
  const message = typeof params.message === 'string'
    ? params.message
    : typeof nestedRequest?.message === 'string'
      ? nestedRequest.message
      : '';
  return /^Allow .+ to run tool "creator_(?:get_context|get_artifact|apply_action)"\?$/.test(
    message.trim()
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
