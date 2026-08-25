import type { ReasoningEffort, SandboxMode } from '@opencreator/protocol';
import type { BuiltInToolPolicy, CodexMcpServerConfig } from './argv.js';
import type { RuntimeThread } from '../threads/types.js';
import { createCodexIsolatedHome, createCodexProbeHome } from './probe-home.js';
import {
  buildCodexAppServerArgs,
  type AppServerApprovalDecision,
  type AppServerRequest,
  type CodexAppServerProcess,
  type CodexAppServerResult
} from './app-server-host-2026-07-28.js';
import {
  createAppServerRuntimeManager,
  type AppServerRuntimeExecution
} from './app-server-runtime-manager.js';

export type {
  AppServerApprovalDecision,
  AppServerRequest,
  CodexAppServerProcess,
  CodexAppServerResult
};
export { buildCodexAppServerArgs };

let oneShotSequence = 0;

export type StartCodexAppServerInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
  prompt: string;
  imagePaths?: string[];
  codexThreadId?: string;
  timeoutMs?: number;
  spawnTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  forceKillGraceMs?: number;
  mcpServers?: CodexMcpServerConfig[];
  builtInTools?: BuiltInToolPolicy;
  isolatedHomePath?: string;
  env?: Record<string, string>;
  beforeSpawn?: () => Promise<void>;
  onNotification?: (notification: Record<string, unknown>) => Promise<void> | void;
  onThreadStarted?: (threadId: string) => Promise<void> | void;
  onTurnStartWritten?: () => void;
  onApprovalRequest?: (
    request: AppServerRequest
  ) => Promise<AppServerApprovalDecision>;
  onStderrChunk?: (chunk: string) => Promise<void> | void;
};

export function startCodexAppServer(
  input: StartCodexAppServerInput
): CodexAppServerProcess {
  const isolatedHome = input.builtInTools !== undefined
    ? input.isolatedHomePath === undefined
      ? createCodexProbeHome(input.codexHome)
      : createCodexIsolatedHome(input.codexHome, input.isolatedHomePath)
    : undefined;
  const id = `one-shot-${++oneShotSequence}`;
  let manager: ReturnType<typeof createAppServerRuntimeManager> | undefined;
  let execution: AppServerRuntimeExecution | undefined;
  let cancelRequested = false;
  return {
    cancel() {
      cancelRequested = true;
      execution?.cancel();
    },
    async steer(steerInput) {
      if (execution?.steer === undefined) throw new Error('Codex app server has not started');
      return execution.steer(steerInput);
    },
    result: Promise.resolve(input.beforeSpawn?.())
      .then(async () => {
        if (cancelRequested) {
          throw new Error('Codex app server canceled before spawn');
        }
        manager = createAppServerRuntimeManager({
          codexBin: input.codexBin,
          codexHome: isolatedHome?.path ?? input.codexHome
        });
        const thread = oneShotThread(id, input);
        execution = manager.startTurn({
          scope: { kind: 'project', id },
          runId: id,
          thread,
          cwd: input.cwd,
          profile: input.profile,
          sandbox: input.sandbox,
          model: input.model,
          reasoning: input.reasoning,
          prompt: input.prompt,
          imagePaths: input.imagePaths,
          codexThreadId: input.codexThreadId,
          timeoutMs: input.timeoutMs,
          inactivityTimeoutMs: input.inactivityTimeoutMs,
          spawnTimeoutMs: input.spawnTimeoutMs,
          forceKillGraceMs: input.forceKillGraceMs,
          runtimeInjection: {
            mcpServers: input.mcpServers ?? [],
            env: input.env ?? {},
            builtInTools: input.builtInTools
          },
          onNotification: input.onNotification,
          onThreadStarted: input.onThreadStarted,
          onTurnStartWritten: input.onTurnStartWritten,
          onApprovalRequest: input.onApprovalRequest,
          onStderrChunk: input.onStderrChunk
        });
        if (cancelRequested) execution.cancel();
        return await execution.result;
      })
      .finally(async () => {
        await manager?.close().catch(() => undefined);
        isolatedHome?.cleanup();
      })
  };
}

function oneShotThread(id: string, input: StartCodexAppServerInput): RuntimeThread {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
    projectId: null,
    enterpriseSubjectId: null,
    origin: 'opencreator_created',
    cwd: input.cwd,
    canonicalCwd: input.cwd,
    workspaceMode: 'external',
    profile: input.profile,
    model: input.model ?? null,
    reasoning: input.reasoning ?? null,
    sandbox: input.sandbox,
    status: 'active',
    purpose: 'conversation',
    createdAt: now,
    updatedAt: now
  };
}
