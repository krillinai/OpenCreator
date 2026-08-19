import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { join } from 'node:path';
import { redactText } from '../security/redaction.js';
import { parseJsonLine } from '../events/parser.js';
import { buildCodexProbeArgs } from './probe-argv.js';
import { createCodexProbeHome, type CodexProbeHome } from './probe-home.js';
import {
  CodexExecError,
  startCodexExec,
  type CodexExecTerminationReason
} from './runner.js';

export const CODEX_PROBE_TIMEOUT_MS = 45_000;
export const CODEX_PROBE_SPAWN_TIMEOUT_MS = 5_000;
export const CODEX_PROBE_FORCE_KILL_GRACE_MS = 2_000;
export const CODEX_PROBE_FINAL_SETTLE_MS = 1_000;

export type CodexProbeInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  timeoutMs: number;
  spawnTimeoutMs?: number;
  forceKillGraceMs?: number;
  finalKillSettleMs?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
};

export type CodexProbeResult = {
  ready: boolean;
  responseReceived: boolean;
  markerMatched: boolean;
  durationMs: number;
  timings: CodexProbeTimings;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationReason: CodexExecTerminationReason;
  errorCode?: 'CODEX_PROBE_TOOL_USED';
  stderrSummary?: string;
};

export type CodexProbeTimings = {
  homePreparationMs: number;
  firstEventMs?: number;
  responseReceivedMs?: number;
  processExitMs: number;
};

export async function probeCodex(input: CodexProbeInput): Promise<CodexProbeResult> {
  mkdirSync(input.cwd, { recursive: true });
  const marker = `OPENCREATOR_READY_${randomBytes(12).toString('hex')}`;
  const outputPath = join(input.cwd, `probe-${process.pid}-${Date.now()}.txt`);
  rmSync(outputPath, { force: true });
  const prompt = [
    'This is a OpenCreator startup availability probe.',
    'Do not call tools and do not modify files.',
    'Reply briefly to this hello message.',
    `If possible, include this marker: ${marker}`
  ].join('\n');
  const startedAt = Date.now();
  let probeHome: CodexProbeHome | undefined;
  let homePreparationMs: number | undefined;
  let firstEventMs: number | undefined;
  let responseReceivedMs: number | undefined;

  try {
    probeHome = createCodexProbeHome(input.codexHome);
    homePreparationMs = elapsedMs(startedAt);
    const processHandle = startCodexExec({
      codexBin: input.codexBin,
      codexHome: probeHome.path,
      cwd: input.cwd,
      args: buildCodexProbeArgs({ cwd: input.cwd, outputPath }),
      prompt,
      timeoutMs: input.timeoutMs,
      spawnTimeoutMs: input.spawnTimeoutMs ?? CODEX_PROBE_SPAWN_TIMEOUT_MS,
      forceKillGraceMs: input.forceKillGraceMs ?? CODEX_PROBE_FORCE_KILL_GRACE_MS,
      finalKillSettleMs: input.finalKillSettleMs ?? CODEX_PROBE_FINAL_SETTLE_MS,
      env: input.env,
      onStdoutLine(line) {
        const inspected = inspectProbeLine(line);
        if (inspected.eventSeen && firstEventMs === undefined) {
          firstEventMs = elapsedMs(startedAt);
        }
        if (inspected.agentMessage !== undefined && responseReceivedMs === undefined) {
          responseReceivedMs = elapsedMs(startedAt);
        }
      }
    });
    const abort = () => processHandle.cancel();
    if (input.signal?.aborted === true) {
      abort();
    } else {
      input.signal?.addEventListener('abort', abort, { once: true });
    }
    const result = await processHandle.result.finally(() => {
      input.signal?.removeEventListener('abort', abort);
    });
    const processExitMs = elapsedMs(startedAt);
    const outputMessage = readProbeOutput(outputPath);
    const parsedOutput = inspectProbeOutput(result.stdoutLines);
    const message = outputMessage ?? parsedOutput.agentMessage;
    const responseReceived = message !== undefined;
    if (responseReceived && responseReceivedMs === undefined) {
      responseReceivedMs = processExitMs;
    }
    return {
      ready: result.exitCode === 0 && responseReceived && !parsedOutput.toolUsed,
      responseReceived,
      markerMatched: message?.includes(marker) ?? false,
      durationMs: processExitMs,
      timings: probeTimings({
        homePreparationMs,
        firstEventMs,
        responseReceivedMs,
        processExitMs
      }),
      exitCode: result.exitCode,
      signal: result.signal,
      terminationReason: result.terminationReason,
      ...(parsedOutput.toolUsed
        ? { errorCode: 'CODEX_PROBE_TOOL_USED' as const }
        : {}),
      ...stderrSummary(result.stderr)
    };
  } catch (error) {
    const processExitMs = elapsedMs(startedAt);
    if (error instanceof CodexExecError) {
      return {
        ready: false,
        responseReceived: false,
        markerMatched: false,
        durationMs: processExitMs,
        timings: probeTimings({
          homePreparationMs,
          firstEventMs,
          responseReceivedMs,
          processExitMs
        }),
        exitCode: null,
        signal: null,
        terminationReason: error.terminationReason,
        ...stderrSummary(error.stderr)
      };
    }
    return {
      ready: false,
      responseReceived: false,
      markerMatched: false,
      durationMs: processExitMs,
      timings: probeTimings({
        homePreparationMs,
        firstEventMs,
        responseReceivedMs,
        processExitMs
      }),
      exitCode: null,
      signal: null,
      terminationReason: 'spawn_failed',
      ...stderrSummary(error instanceof Error ? error.message : String(error))
    };
  } finally {
    probeHome?.cleanup();
    rmSync(outputPath, { force: true });
  }
}

function readProbeOutput(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const value = readFileSync(path, 'utf8').trim();
  return value.length === 0 ? undefined : value;
}

function inspectProbeOutput(lines: string[]): {
  agentMessage?: string;
  toolUsed: boolean;
} {
  let agentMessage: string | undefined;
  let toolUsed = false;
  for (const line of lines) {
    const inspected = inspectProbeLine(line);
    toolUsed ||= inspected.toolUsed;
    agentMessage ??= inspected.agentMessage;
  }
  return { agentMessage, toolUsed };
}

function inspectProbeLine(line: string): {
  eventSeen: boolean;
  agentMessage?: string;
  toolUsed: boolean;
} {
  const parsed = parseJsonLine(line);
  if (!parsed.ok || !isRecord(parsed.value)) {
    return { eventSeen: false, toolUsed: false };
  }
  const item = isRecord(parsed.value.item) ? parsed.value.item : undefined;
  const eventType = typeof parsed.value.type === 'string'
    ? parsed.value.type
    : undefined;
  const itemType = typeof item?.type === 'string' ? item.type : undefined;
  let agentMessage: string | undefined;
  if (
    eventType === 'item.completed'
    && itemType === 'agent_message'
    && typeof item?.text === 'string'
    && item.text.trim().length > 0
  ) {
    agentMessage = item.text.trim();
  }
  if (
    eventType === 'agent_message'
    && typeof parsed.value.message === 'string'
    && parsed.value.message.trim().length > 0
  ) {
    agentMessage ??= parsed.value.message.trim();
  }
  return {
    eventSeen: eventType !== undefined,
    agentMessage,
    toolUsed: isToolEventType(eventType) || isToolEventType(itemType)
  };
}

function isToolEventType(value: string | undefined): boolean {
  return value !== undefined && TOOL_EVENT_TYPES.has(value);
}

const TOOL_EVENT_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'mcp_call',
  'web_search',
  'computer_use',
  'image_generation',
  'dynamic_tool_call',
  'tool_call',
  'function_call'
]);

function stderrSummary(stderr: string): { stderrSummary?: string } {
  const redacted = redactText(stderr).trim();
  if (redacted.length === 0) return {};
  return { stderrSummary: redacted.slice(-8 * 1024) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function probeTimings(input: {
  homePreparationMs?: number;
  firstEventMs?: number;
  responseReceivedMs?: number;
  processExitMs: number;
}): CodexProbeTimings {
  return {
    homePreparationMs: input.homePreparationMs ?? input.processExitMs,
    ...(input.firstEventMs === undefined
      ? {}
      : { firstEventMs: input.firstEventMs }),
    ...(input.responseReceivedMs === undefined
      ? {}
      : { responseReceivedMs: input.responseReceivedMs }),
    processExitMs: input.processExitMs
  };
}
