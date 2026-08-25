import { nanoid } from 'nanoid';
import { dirname } from 'node:path';
import type { AppServerRuntimeExecution, AppServerRuntimeManager } from '../../codex/app-server-runtime-manager.js';
import type { ThreadManager } from '../../threads/types.js';
import type {
  AgentRuntimeAdapter,
  AgentRuntimeExecution,
  AgentRuntimeTurnInput,
  AgentRuntimeTurnResult
} from './runtime-adapter.js';

const CREATOR_TURN_TIMEOUT_MS = 20 * 60_000;
const CREATOR_TURN_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const CREATOR_PROCESS_SPAWN_TIMEOUT_MS = 15_000;

export function createCodexCreatorAdapter(input: {
  runtimeManager: AppServerRuntimeManager;
  threads: Pick<ThreadManager, 'getThread' | 'setCodexThreadId'>;
  skillPath: string;
  guideVersion: number;
  guideHash: string;
  available: boolean;
}): AgentRuntimeAdapter {
  const active = new Map<string, AppServerRuntimeExecution>();

  function startTurn(turn: AgentRuntimeTurnInput): AgentRuntimeExecution {
    const thread = input.threads.getThread(turn.threadId);
    if (thread === undefined || !input.available) {
      throw new Error('Creator Agent runtime is unavailable');
    }
    const runId = turn.runId ?? `creator_run_${nanoid(12)}`;
    const messages = createAgentMessageAccumulator();
    const execution = input.runtimeManager.startTurn({
      scope: { kind: 'creator-job', id: turn.context.jobId },
      runId,
      thread,
      jobId: turn.context.jobId,
      projectId: turn.context.projectId,
      capabilityScopes: ['creator:context', 'creator:artifact:read', 'creator:action'],
      cwd: thread.cwd,
      profile: thread.profile,
      sandbox: thread.sandbox,
      model: thread.model ?? undefined,
      reasoning: thread.reasoning ?? undefined,
      codexThreadId: thread.codexThreadId ?? undefined,
      readThreadBeforeResume: false,
      timeoutMs: CREATOR_TURN_TIMEOUT_MS,
      inactivityTimeoutMs: CREATOR_TURN_INACTIVITY_TIMEOUT_MS,
      spawnTimeoutMs: CREATOR_PROCESS_SPAWN_TIMEOUT_MS,
      prompt: creatorPrompt(turn),
      developerInstructions: developerInstructions(input.guideVersion),
      skillRoots: [dirname(input.skillPath)],
      requiredSkillNames: ['opencreator-runtime'],
      skills: [{ name: 'opencreator-runtime', path: input.skillPath }],
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
        configurationFingerprint: `opencreator-runtime:${input.guideVersion}:${input.guideHash}`
      },
      onNotification: async notification => {
        recordAgentMessage(messages, notification);
        await turn.onNotification?.(notification);
      },
      onThreadRead: turn.onThreadRead,
      onApprovalRequest: turn.onApprovalRequest,
      onThreadStarted(runtimeThreadId) {
        input.threads.setCodexThreadId(thread.id, runtimeThreadId);
      }
    });
    active.set(runId, execution);
    const started = execution.started.then(info => {
      turn.onStarted?.(info);
      return info;
    });
    void started.catch(() => undefined);
    const result = Promise.all([execution.result, started])
      .then(([runtimeResult, startInfo]): AgentRuntimeTurnResult => {
        if (runtimeResult.turnStatus !== 'completed') {
          throw new Error(`Creator Codex turn ${runtimeResult.turnStatus}`);
        }
        return {
          content: finalAgentMessage(messages),
          runtimeThreadId: runtimeResult.threadId,
          runtimeTurnId: runtimeResult.turnId,
          processGeneration: startInfo.generation
        };
      })
      .finally(() => active.delete(runId));
    return {
      cancel: execution.cancel,
      started,
      result
    };
  }

  return {
    id: 'codex',
    available: input.available,
    startTurn,
    runTurn(turn) {
      return startTurn(turn).result;
    },
    async steer(runId, message, clientMessageId) {
      const execution = active.get(runId);
      if (execution?.steer === undefined) throw new Error('Creator Agent has no active turn');
      const result = await execution.steer({
        message,
        ...(clientMessageId === undefined ? {} : { clientMessageId })
      });
      return result.turnId;
    },
    interrupt(runId: string): boolean {
      const execution = active.get(runId);
      if (execution === undefined) return false;
      execution.cancel();
      return true;
    },
    closeScope(jobId: string) {
      return input.runtimeManager.closeScope(
        { kind: 'creator-job', id: jobId },
        'creator_scope_closed'
      );
    }
  };
}

function creatorPrompt(turn: AgentRuntimeTurnInput): string {
  return [
    `用户请求：${turn.message}`,
    `OpenCreator Context Projection：${JSON.stringify(turn.context)}`,
    turn.selection === null
      ? '当前没有工作台选区。'
      : `当前工作台选区：${JSON.stringify(turn.selection)}`,
    turn.conflictAttempt === 0
      ? '基于当前任务状态完成请求；revision 仅用于工具写入，不要在用户回复中展示。'
      : '上一次写入发生内部状态冲突；重新读取 context 后最多再尝试一次。'
  ].join('\n');
}

function developerInstructions(guideVersion: number): string {
  return [
    `你是 OpenCreator Creator Agent，运行规则版本 ${guideVersion}。`,
    'Creator Core 是 Job、revision、StageRun、Artifact 和 Activity 的唯一业务状态源。',
    '开始处理前调用 creator_get_context。需要大文本时按需调用 creator_get_artifact。',
    '所有修改只能调用 creator_apply_action，并携带最新 expectedRevision 和唯一 idempotencyKey。',
    '调用 update-settings 或 undo-action 时，必须使用 input: { patch: { ... }, objectId?: string }；patch 必须非空，设置字段必须写在 patch 内。',
    '调用 run-stage 时，必须使用 input: { stageId: "..." }；stageId 必须逐字使用 Creator Context 的 availableStageIds，不得使用 render 等别名。',
    '严格遵循 Creator Context.templateGuidance 中的模板字段与执行约束；工具返回参数错误时，重新读取 context 并用正确结构重试，不得把失败写入当成成功。',
    '不得直接修改 Creator 数据库、Artifact 文件或调用 KrillinAI。',
    '模板定义不属于 Skill；以 Creator Context 和工具端校验为准。',
    '不要在回复中播报 Skill、上下文读取、工具选择或审批实现等内部处理过程。',
    'Job revision 只用于内部乐观并发控制。除非用户明确询问冲突或诊断，否则不要向用户展示 revision。',
    'state.resultVersion 是项目快照版本；Artifact.version 是字幕、配音、横屏视频、竖屏视频等子项自己的版本。必须明确表达为“项目 V2”“横屏视频 V1”，不得混用。',
    '项目快照通过 state.resultSnapshots 引用各子项 Artifact；未变化的子项会跨项目版本复用同一个 Artifact，不得声称文件被复制或子项版本已经升级。',
    'Creator Context.selectedResultSnapshot 与工作台当前查看的项目版本一致；latestResultVersion 表示项目最新版本。回答前必须区分当前查看版本与最新版本。',
    '不得输出演示、模拟或猜测的执行结果。运行时失败时直接说明真实错误。'
  ].join('\n');
}

type AgentMessageRecord = {
  id: string;
  text: string;
  phase: 'commentary' | 'final_answer' | null;
};

function createAgentMessageAccumulator(): Map<string, AgentMessageRecord> {
  return new Map();
}

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
  const current = messages.get(itemId) ?? { id: itemId, text: '', phase: null };
  if (item?.type === 'agentMessage') {
    const phase = item.phase === 'commentary' || item.phase === 'final_answer'
      ? item.phase
      : current.phase;
    messages.set(itemId, {
      ...current,
      phase,
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

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
