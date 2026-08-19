import type { ReasoningEffort, SandboxMode } from '@opencreator/protocol';
import type { BuiltInToolPolicy, CodexMcpServerConfig } from './argv.js';
import { createCodexIsolatedHome, createCodexProbeHome } from './probe-home.js';
import {
  buildCodexAppServerArgs,
  createCodexAppServerHost,
  type AppServerApprovalDecision,
  type AppServerRequest,
  type CodexAppServerProcess,
  type CodexAppServerResult
} from './app-server-host-2026-07-28.js';

export type {
  AppServerApprovalDecision,
  AppServerRequest,
  CodexAppServerProcess,
  CodexAppServerResult
};
export { buildCodexAppServerArgs };

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
  if (input.beforeSpawn !== undefined) {
    let process: CodexAppServerProcess | undefined;
    let cancelRequested = false;
    return {
      cancel() {
        cancelRequested = true;
        process?.cancel();
      },
      result: input.beforeSpawn().then(() => {
        if (cancelRequested) throw new Error('Codex app server canceled before spawn');
        process = startCodexAppServer({ ...input, beforeSpawn: undefined });
        return process.result;
      })
    };
  }
  const isolatedHome = input.builtInTools !== undefined
    ? input.isolatedHomePath === undefined
      ? createCodexProbeHome(input.codexHome)
      : createCodexIsolatedHome(input.codexHome, input.isolatedHomePath)
    : undefined;
  const host = createCodexAppServerHost({
    codexBin: input.codexBin,
    codexHome: isolatedHome?.path ?? input.codexHome,
    cwd: input.cwd,
    profile: input.profile,
    mcpServers: input.mcpServers,
    builtInTools: input.builtInTools,
    env: input.env,
    spawnTimeoutMs: input.spawnTimeoutMs,
    forceKillGraceMs: input.forceKillGraceMs
  });
  const process = host.run({
    cwd: input.cwd,
    sandbox: input.sandbox,
    model: input.model,
    reasoning: input.reasoning,
    prompt: input.prompt,
    imagePaths: input.imagePaths,
    codexThreadId: input.codexThreadId,
    timeoutMs: input.timeoutMs,
    inactivityTimeoutMs: input.inactivityTimeoutMs,
    onNotification: input.onNotification,
    onThreadStarted: input.onThreadStarted,
    onTurnStartWritten: input.onTurnStartWritten,
    onApprovalRequest: input.onApprovalRequest,
    onStderrChunk: input.onStderrChunk
  });
  return {
    cancel: process.cancel,
    result: process.result.then(
      async result => {
        await host.close('one_shot_completed');
        isolatedHome?.cleanup();
        return result;
      },
      async error => {
        await host.close('one_shot_failed').catch(() => undefined);
        isolatedHome?.cleanup();
        throw error;
      }
    )
  };
}
