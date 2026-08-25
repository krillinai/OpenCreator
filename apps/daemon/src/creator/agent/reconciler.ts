import type {
  CreatorAgentItemKind,
  CreatorAgentItemStatus,
  CreatorAgentTurn,
  CreatorAgentTurnStatus,
  CreatorJson
} from '@opencreator/protocol';
import type { CreatorAgentRepository } from './repository.js';
import {
  creatorRuntimeItemMetadata,
  creatorRuntimeToolName
} from './event-normalizer.js';

export function createCreatorAgentReconciler(input: {
  repository: CreatorAgentRepository;
}) {
  return {
    reconcileAfterDaemonRestart() {
      return input.repository.markForRecovery();
    },
    reconcileGeneration(sessionId: string, processGeneration: number) {
      return input.repository.expireApprovalsBeforeGeneration(
        sessionId,
        processGeneration
      );
    },
    reconcileThread(event: {
      jobId: string;
      sessionId: string;
      thread: Record<string, unknown>;
    }) {
      const runtimeThreadId = stringValue(event.thread.id);
      const runtimeTurns = Array.isArray(event.thread.turns)
        ? event.thread.turns.map(recordValue).filter(isDefined)
        : [];
      if (runtimeThreadId !== undefined) {
        input.repository.updateSession({
          id: event.sessionId,
          runtimeThreadId
        });
      }
      let reconciledTurns = 0;
      let reconciledItems = 0;
      for (const runtimeTurn of runtimeTurns) {
        const runtimeTurnId = stringValue(runtimeTurn.id);
        if (runtimeTurnId === undefined) continue;
        let turn = input.repository.getTurnByRuntimeId(event.sessionId, runtimeTurnId);
        if (turn === undefined) {
          turn = unresolvedTurn(input.repository.listTurns(event.sessionId));
          if (turn === undefined) {
            turn = input.repository.createTurn({
              jobId: event.jobId,
              sessionId: event.sessionId,
              runtimeTurnId,
              role: 'assistant',
              content: runtimeTurnContent(runtimeTurn),
              status: runtimeTurnStatus(runtimeTurn)
            });
          } else {
            turn = input.repository.updateTurn({
              id: turn.id,
              runtimeTurnId
            });
          }
        }
        const content = runtimeTurnContent(runtimeTurn) || turn.content;
        input.repository.updateTurn({
          id: turn.id,
          runtimeTurnId,
          content,
          status: runtimeTurnStatus(runtimeTurn)
        });
        reconciledTurns += 1;

        const items = Array.isArray(runtimeTurn.items)
          ? runtimeTurn.items.map(recordValue).filter(isDefined)
          : [];
        for (const runtimeItem of items) {
          const runtimeItemId = stringValue(runtimeItem.id);
          if (runtimeItemId === undefined) continue;
          const normalized = normalizeRuntimeItem(runtimeItem, runtimeTurnStatus(runtimeTurn));
          const existing = input.repository.getItemByRuntimeId(
            event.sessionId,
            runtimeItemId
          );
          if (existing === undefined) {
            input.repository.insertItem({
              jobId: event.jobId,
              sessionId: event.sessionId,
              turnId: turn.id,
              runtimeItemId,
              kind: normalized.kind,
              status: normalized.status,
              ...(normalized.role === undefined ? {} : { role: normalized.role }),
              ...(normalized.text === undefined ? {} : { text: normalized.text }),
              ...(normalized.toolName === undefined ? {} : { toolName: normalized.toolName }),
              data: normalized.data,
              sequence: nextItemSequence(input.repository, event.sessionId, turn.id)
            });
          } else if (!terminalItemStatus(existing.status)) {
            input.repository.updateItem({
              id: existing.id,
              status: normalized.status,
              text: normalized.text,
              toolName: normalized.toolName,
              data: normalized.data
            });
          }
          reconciledItems += 1;
        }
      }
      return { runtimeThreadId, reconciledTurns, reconciledItems };
    }
  };
}

function unresolvedTurn(turns: CreatorAgentTurn[]): CreatorAgentTurn | undefined {
  return [...turns].reverse().find(turn => (
    turn.role === 'assistant'
    && (turn.runtimeTurnId === undefined || turn.runtimeTurnId === null)
    && ['needs_user_resolution', 'interrupted'].includes(turn.status)
  ));
}

function runtimeTurnStatus(turn: Record<string, unknown>): CreatorAgentTurnStatus {
  const status = stringValue(turn.status);
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'interrupted') return 'interrupted';
  return 'needs_user_resolution';
}

function runtimeTurnContent(turn: Record<string, unknown>): string {
  if (!Array.isArray(turn.items)) return '';
  return turn.items
    .map(recordValue)
    .filter(isDefined)
    .filter(item => item.type === 'agentMessage')
    .map(item => stringValue(item.text) ?? '')
    .join('');
}

function normalizeRuntimeItem(
  item: Record<string, unknown>,
  turnStatus: CreatorAgentTurnStatus
): {
  kind: CreatorAgentItemKind;
  status: CreatorAgentItemStatus;
  role?: 'user' | 'assistant';
  text?: string;
  toolName?: string;
  data: Record<string, CreatorJson>;
} {
  const type = stringValue(item.type) ?? '';
  const kind: CreatorAgentItemKind = type === 'userMessage'
    ? 'user_message'
    : type === 'agentMessage'
      ? 'assistant_message'
      : type === 'reasoning' || type === 'plan'
        ? 'reasoning'
        : type === 'commandExecution'
          || type === 'fileChange'
          || type === 'mcpToolCall'
          || type === 'dynamicToolCall'
          ? 'tool_result'
          : 'reasoning';
  const itemStatus = stringValue(item.status);
  const status: CreatorAgentItemStatus = itemStatus === 'failed'
    || turnStatus === 'failed'
    ? 'failed'
    : itemStatus === 'inProgress'
      ? 'running'
      : turnStatus === 'interrupted'
        ? 'canceled'
        : 'completed';
  const text = type === 'agentMessage'
    ? stringValue(item.text)
    : type === 'reasoning'
      ? stringArray(item.summary).join('\n') || stringArray(item.content).join('\n')
      : type === 'commandExecution'
        ? stringValue(item.aggregatedOutput) ?? stringValue(item.command)
        : undefined;
  const toolName = creatorRuntimeToolName(item)
    ?? (type === 'commandExecution'
      ? 'commandExecution'
      : type === 'fileChange'
        ? 'fileChange'
        : undefined);
  return {
    kind,
    status,
    ...(type === 'userMessage' ? { role: 'user' as const } : {}),
    ...(type === 'agentMessage' ? { role: 'assistant' as const } : {}),
    ...(text === undefined || text.length === 0 ? {} : { text }),
    ...(toolName === undefined || toolName.length === 0 ? {} : { toolName }),
    data: creatorRuntimeItemMetadata(item)
  };
}

function nextItemSequence(
  repository: CreatorAgentRepository,
  sessionId: string,
  turnId: string
): number {
  const items = repository.listItems(sessionId).filter(item => item.turnId === turnId);
  return Math.max(0, ...items.map(item => item.sequence)) + 1;
}

function terminalItemStatus(status: CreatorAgentItemStatus): boolean {
  return ['completed', 'failed', 'canceled'].includes(status);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
