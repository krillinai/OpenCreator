import { nanoid } from 'nanoid';
import { resolve } from 'node:path';
import type { AppServerRuntimeManager } from '../../codex/app-server-runtime-manager.js';
import type { RuntimeThread } from '../../threads/types.js';
import { CreatorExecutorError } from '../executor.js';

const TURN_TIMEOUT_MS = 10 * 60_000;
const TURN_INACTIVITY_TIMEOUT_MS = 2 * 60_000;
const PROCESS_SPAWN_TIMEOUT_MS = 15_000;

export type StickmanCodexJsonCompletionInput = {
  stageId: string;
  prompt: string;
  signal: AbortSignal;
  jobId: string;
  projectId: string;
  cwd: string;
  model: string;
};

export function createStickmanCodexJsonCompletion(input: {
  runtimeManager: AppServerRuntimeManager;
}) {
  return async (request: StickmanCodexJsonCompletionInput): Promise<unknown> => {
    const runId = `stickman_json_${nanoid(12)}`;
    const messages = new Map<string, AgentMessageRecord>();
    const execution = input.runtimeManager.startTurn({
      scope: { kind: 'creator-job', id: request.jobId },
      runId,
      thread: completionThread(request),
      jobId: request.jobId,
      projectId: request.projectId,
      cwd: request.cwd,
      profile: 'default',
      sandbox: 'read-only',
      ...(request.model.trim().length === 0 ? {} : { model: request.model.trim() }),
      prompt: request.prompt,
      developerInstructions: [
        'Return exactly one valid JSON value that satisfies the user prompt.',
        'Do not use Markdown fences, commentary, citations, or explanatory text.',
        'Do not call tools. Do not read or modify files. Do not access the network.'
      ].join('\n'),
      timeoutMs: TURN_TIMEOUT_MS,
      inactivityTimeoutMs: TURN_INACTIVITY_TIMEOUT_MS,
      spawnTimeoutMs: PROCESS_SPAWN_TIMEOUT_MS,
      runtimeInjection: {
        mcpServers: [],
        env: {},
        builtInTools: {
          shell: false,
          fileRead: false,
          fileWrite: false,
          applyPatch: false,
          webSearch: false
        },
        configurationFingerprint: 'stickman-json-completion-v1'
      },
      onNotification(notification) {
        recordAgentMessage(messages, notification);
      }
    });
    const cancel = () => execution.cancel();
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener('abort', cancel, { once: true });

    try {
      const result = await execution.result;
      if (request.signal.aborted || result.turnStatus === 'interrupted') {
        throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      }
      if (result.turnStatus !== 'completed') {
        throw new CreatorExecutorError(
          'creator_llm_failed',
          `Codex JSON completion failed during ${request.stageId}`
        );
      }
      return parseJsonResponse(finalAgentMessage(messages));
    } catch (error) {
      if (request.signal.aborted) {
        throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      }
      if (error instanceof CreatorExecutorError) throw error;
      throw new CreatorExecutorError(
        'creator_llm_failed',
        `Codex JSON completion failed during ${request.stageId}: ${errorMessage(error)}`
      );
    } finally {
      request.signal.removeEventListener('abort', cancel);
    }
  };
}

function completionThread(input: StickmanCodexJsonCompletionInput): RuntimeThread {
  const now = new Date().toISOString();
  const cwd = resolve(input.cwd);
  return {
    id: `stickman-content-${input.jobId}`,
    title: `Stickman content: ${input.stageId}`,
    projectId: input.projectId,
    enterpriseSubjectId: null,
    origin: 'opencreator_created',
    cwd,
    canonicalCwd: cwd,
    workspaceMode: 'external',
    profile: 'default',
    model: input.model.trim() || null,
    reasoning: null,
    sandbox: 'read-only',
    status: 'active',
    purpose: 'creator_agent',
    createdAt: now,
    updatedAt: now
  };
}

type AgentMessageRecord = {
  text: string;
  phase: 'commentary' | 'final_answer' | null;
};

function recordAgentMessage(
  messages: Map<string, AgentMessageRecord>,
  notification: Record<string, unknown>
): void {
  const method = typeof notification.method === 'string' ? notification.method : '';
  const params = readRecord(notification.params);
  const item = readRecord(params?.item);
  const itemId = typeof params?.itemId === 'string'
    ? params.itemId
    : typeof item?.id === 'string'
      ? item.id
      : null;
  if (itemId === null) return;
  const current = messages.get(itemId) ?? { text: '', phase: null };
  if (item?.type === 'agentMessage') {
    messages.set(itemId, {
      phase: item.phase === 'commentary' || item.phase === 'final_answer'
        ? item.phase
        : current.phase,
      text: agentMessageText(item) ?? current.text
    });
    return;
  }
  if (method === 'item/agentMessage/delta' && typeof params?.delta === 'string') {
    messages.set(itemId, { ...current, text: current.text + params.delta });
  }
}

function finalAgentMessage(messages: Map<string, AgentMessageRecord>): string {
  const ordered = [...messages.values()];
  return ordered.filter(message => message.phase === 'final_answer').at(-1)?.text
    ?? ordered.filter(message => message.phase !== 'commentary').at(-1)?.text
    ?? ordered.at(-1)?.text
    ?? '';
}

function agentMessageText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return undefined;
  const text = item.content
    .map(entry => readRecord(entry))
    .map(entry => typeof entry?.text === 'string' ? entry.text : '')
    .join('');
  return text || undefined;
}

function parseJsonResponse(content: string): unknown {
  const normalized = stripMarkdownFence(content.trim());
  if (normalized.length === 0) {
    throw new CreatorExecutorError(
      'creator_llm_invalid_response',
      'Codex response did not contain JSON'
    );
  }
  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    throw new CreatorExecutorError(
      'creator_llm_invalid_response',
      'Codex response was not valid JSON'
    );
  }
}

function stripMarkdownFence(value: string): string {
  const match = /^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(value);
  return match?.[1]?.trim() ?? value;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
