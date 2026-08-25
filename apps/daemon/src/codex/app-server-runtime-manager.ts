import type { RuntimeThread } from '../threads/types.js';
import type {
  AgentScheduleProcessInjector,
  AgentToolProcessInjection,
  AgentToolRunInjection
} from '../agent-tools/run-injection.js';
import type { AgentCapabilityScope } from '../agent-tools/capability-token.js';
import {
  createCodexAppServerHost,
  normalizeAppServerProfile,
  type CodexAppServerHost,
  type CodexAppServerHostInput,
  type CodexAppServerHostLifecycleEvent,
  type CodexAppServerProcess,
  type CodexAppServerResult,
  type CodexAppServerTurnInput
} from './app-server-host-2026-07-28.js';

export type AppServerRuntimeScope = {
  kind: 'project' | 'creator-job';
  id: string;
};

export type AppServerRuntimeTurnInput = CodexAppServerTurnInput & {
  scope: AppServerRuntimeScope;
  runId: string;
  thread: RuntimeThread;
  profile: string;
  runtimeInjection?: AgentToolRunInjection;
  spawnTimeoutMs?: number;
  forceKillGraceMs?: number;
  jobId?: string;
  projectId?: string;
  capabilityScopes?: AgentCapabilityScope[];
  skillRoots?: string[];
  requiredSkillNames?: string[];
};

export type AppServerRuntimeExecution = CodexAppServerProcess & {
  started: Promise<{ pid: number; reused: boolean; generation: number }>;
};

export type AppServerRuntimeManager = ReturnType<typeof createAppServerRuntimeManager>;

type ScopeEntry = {
  scope: AppServerRuntimeScope;
  host?: CodexAppServerHost;
  injection?: AgentToolProcessInjection;
  profile?: string;
  fingerprint?: string;
  generation?: number;
  active: boolean;
  pending: number;
  staleReason?: string;
  lastUsedAt: number;
  queue: Promise<void>;
  activeProcess?: CodexAppServerProcess;
};

export function createAppServerRuntimeManager(input: {
  codexBin: string;
  codexHome: string;
  processInjector?: AgentScheduleProcessInjector;
  createHost?(input: CodexAppServerHostInput): CodexAppServerHost;
  maxIdleHosts?: number;
  idleTtlMs?: number;
  sweepIntervalMs?: number;
  now?(): number;
  setInterval?(callback: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
  onHostLifecycle?(input: {
    scope: AppServerRuntimeScope;
    generation: number;
    event: CodexAppServerHostLifecycleEvent;
  }): void;
}) {
  const createHost = input.createHost ?? createCodexAppServerHost;
  const maxIdleHosts = input.maxIdleHosts ?? 4;
  const idleTtlMs = input.idleTtlMs ?? 5 * 60_000;
  const now = input.now ?? (() => Date.now());
  const entries = new Map<string, ScopeEntry>();
  let processGeneration = 0;
  let closing = false;
  let closeWork: Promise<void> | undefined;
  const setTimer = input.setInterval ?? ((callback, ms) => setInterval(callback, ms));
  const clearTimer = input.clearInterval ?? (handle => clearInterval(handle as NodeJS.Timeout));
  const sweepTimer = setTimer(() => {
    void sweepIdle().catch(() => undefined);
  }, input.sweepIntervalMs ?? 60_000);
  unrefTimer(sweepTimer);

  function acquireScope(scope: AppServerRuntimeScope) {
    const entry = getOrCreateEntry(scope);
    return {
      startTurn(turn: Omit<AppServerRuntimeTurnInput, 'scope'>) {
        return startTurn({ ...turn, scope });
      },
      close(reason?: string) {
        return closeScope(scope, reason);
      },
      get state() {
        return describeEntry(entry);
      }
    };
  }

  function startTurn(turn: AppServerRuntimeTurnInput): AppServerRuntimeExecution {
    assertOpen();
    const entry = getOrCreateEntry(turn.scope);
    entry.pending += 1;
    let process: CodexAppServerProcess | undefined;
    let cancelRequested = false;
    let resolveStarted!: (value: { pid: number; reused: boolean; generation: number }) => void;
    let rejectStarted!: (error: Error) => void;
    const started = new Promise<{ pid: number; reused: boolean; generation: number }>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    void started.catch(() => undefined);

    const work = entry.queue.then(async () => {
      entry.pending -= 1;
      if (cancelRequested) throw new Error('Codex app-server turn canceled before start');
      assertOpen();
      entry.active = true;
      try {
        const prepared = await prepareHost(entry, turn);
        const activation = entry.injection?.activate({
          runId: turn.runId,
          thread: turn.thread,
          createdBy: 'api',
          processGeneration: prepared.generation,
          jobId: turn.jobId,
          projectId: turn.projectId,
          scopes: turn.capabilityScopes
        });
        try {
          process = prepared.host.run({
            ...turnInput(turn),
            readThreadBeforeResume: turn.readThreadBeforeResume
              ?? (!prepared.reused && turn.codexThreadId !== undefined),
            manifestKey: [activation?.manifestKey, turn.runtimeInjection?.configurationFingerprint]
              .filter(Boolean)
              .join(':') || undefined
          });
          entry.activeProcess = process;
          if (cancelRequested) process.cancel();
          resolveStarted({
            pid: prepared.pid,
            reused: prepared.reused,
            generation: prepared.generation
          });
          return await process.result;
        } finally {
          entry.injection?.deactivate(turn.runId);
          entry.activeProcess = undefined;
        }
      } finally {
        entry.active = false;
        entry.lastUsedAt = now();
        if (entry.host !== undefined && !entry.host.isReusable()) {
          await clearHost(entry, 'host_not_reusable', turn.forceKillGraceMs);
        } else if (entry.staleReason !== undefined) {
          const reason = entry.staleReason;
          entry.staleReason = undefined;
          await clearHost(entry, reason, turn.forceKillGraceMs);
        }
        await sweepIdle();
      }
    });
    const result = work.catch(error => {
      rejectStarted(toError(error));
      throw error;
    });
    entry.queue = result.then(() => undefined, () => undefined);
    return {
      cancel() {
        cancelRequested = true;
        process?.cancel();
      },
      async steer(input) {
        if (process?.steer === undefined) throw new Error('Codex app-server turn has not started');
        return process.steer(input);
      },
      started,
      result
    };
  }

  async function prepareHost(
    entry: ScopeEntry,
    turn: AppServerRuntimeTurnInput
  ): Promise<{
    host: CodexAppServerHost;
    pid: number;
    reused: boolean;
    generation: number;
  }> {
    const profile = normalizeAppServerProfile(turn.profile);
    const fingerprint = runtimeFingerprint(profile, turn);
    if (entry.host !== undefined && entry.staleReason !== undefined) {
      const reason = entry.staleReason;
      entry.staleReason = undefined;
      await clearHost(entry, reason, turn.forceKillGraceMs);
      assertOpen();
    }
    if (
      entry.host !== undefined
      && (!entry.host.isReusable() || entry.profile !== profile || entry.fingerprint !== fingerprint)
    ) {
      await clearHost(entry, 'runtime_configuration_changed', turn.forceKillGraceMs);
      assertOpen();
    }
    const reused = entry.host !== undefined;
    if (entry.host === undefined) {
      entry.injection = input.processInjector?.create();
      const processConfiguration = mergeInjections(entry.injection, turn.runtimeInjection);
      const generation = ++processGeneration;
      entry.profile = profile;
      entry.fingerprint = fingerprint;
      entry.generation = generation;
      entry.host = createHost({
        codexBin: input.codexBin,
        codexHome: input.codexHome,
        cwd: turn.cwd,
        profile,
        mcpServers: processConfiguration?.mcpServers,
        builtInTools: processConfiguration?.builtInTools,
        env: processConfiguration?.env,
        skillRoots: turn.skillRoots,
        requiredSkillNames: turn.requiredSkillNames,
        spawnTimeoutMs: turn.spawnTimeoutMs,
        forceKillGraceMs: turn.forceKillGraceMs,
        onLifecycle(event) {
          input.onHostLifecycle?.({
            scope: entry.scope,
            generation,
            event
          });
        }
      });
    }
    const host = entry.host;
    const pid = await host.started;
    return {
      host,
      pid,
      reused,
      generation: entry.generation!
    };
  }

  async function invalidate(reason: string, scope?: AppServerRuntimeScope): Promise<void> {
    const targets = scope === undefined
      ? [...entries.values()]
      : [...entries.values()].filter(entry => scopeKey(entry.scope) === scopeKey(scope));
    await Promise.all(targets.map(async entry => {
      if (entry.active || entry.pending > 0) {
        entry.staleReason = reason;
        return;
      }
      await enqueueClear(entry, reason);
    }));
  }

  async function closeScope(
    scope: AppServerRuntimeScope,
    reason = 'scope_closed',
    interruptGraceMs = 1_000,
    forceKillGraceMs?: number
  ): Promise<void> {
    const key = scopeKey(scope);
    const entry = entries.get(key);
    if (entry === undefined) return;
    if (entry.active) entry.activeProcess?.cancel();
    if (entry.active && !await settleWithin(entry.queue, interruptGraceMs)) {
      await clearHost(entry, reason, forceKillGraceMs);
    }
    await entry.queue;
    await clearHost(entry, reason, forceKillGraceMs);
    entries.delete(key);
  }

  async function closeScopes(
    kind: AppServerRuntimeScope['kind'],
    reason = 'scopes_closed',
    interruptGraceMs = 1_000,
    forceKillGraceMs?: number
  ) {
    await Promise.all([...entries.values()]
      .filter(entry => entry.scope.kind === kind)
      .map(entry => closeScope(
        entry.scope,
        reason,
        interruptGraceMs,
        forceKillGraceMs
      )));
  }

  async function sweepIdle(): Promise<void> {
    if (closing) return;
    const idle = [...entries.values()]
      .filter(entry => !entry.active && entry.pending === 0 && entry.host !== undefined)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    const expired = idle.filter(entry => now() - entry.lastUsedAt >= idleTtlMs);
    const overLimit = idle.slice(0, Math.max(0, idle.length - maxIdleHosts));
    for (const entry of new Set([...expired, ...overLimit])) {
      await clearHost(entry, 'idle_evicted');
      if (entry.pending === 0 && !entry.active) entries.delete(scopeKey(entry.scope));
    }
  }

  async function clearHost(entry: ScopeEntry, reason: string, graceMs?: number) {
    const host = entry.host;
    const injection = entry.injection;
    entry.host = undefined;
    entry.injection = undefined;
    entry.profile = undefined;
    entry.fingerprint = undefined;
    entry.generation = undefined;
    try {
      await host?.close(reason, graceMs);
    } finally {
      injection?.close();
    }
  }

  async function enqueueClear(entry: ScopeEntry, reason: string): Promise<void> {
    const work = entry.queue.then(() => clearHost(entry, reason));
    entry.queue = work.then(() => undefined, () => undefined);
    await work;
  }

  function getOrCreateEntry(scope: AppServerRuntimeScope): ScopeEntry {
    assertScope(scope);
    const key = scopeKey(scope);
    const existing = entries.get(key);
    if (existing !== undefined) return existing;
    const entry: ScopeEntry = {
      scope: { ...scope },
      active: false,
      pending: 0,
      lastUsedAt: now(),
      queue: Promise.resolve()
    };
    entries.set(key, entry);
    return entry;
  }

  function assertOpen() {
    if (closing) throw new Error('Codex app-server Runtime Manager is closing');
  }

  return {
    acquireScope,
    startTurn,
    invalidate,
    closeScope,
    closeScopes,
    isScopeBusy(scope: AppServerRuntimeScope) {
      const entry = entries.get(scopeKey(scope));
      return entry !== undefined && (entry.active || entry.pending > 0);
    },
    listScopes() {
      return [...entries.values()].map(describeEntry);
    },
    async sweepIdle() {
      await sweepIdle();
    },
    async close() {
      if (closeWork !== undefined) return await closeWork;
      closing = true;
      clearTimer(sweepTimer);
      closeWork = Promise.all([...entries.values()].map(async entry => {
        if (entry.active) entry.activeProcess?.cancel();
        if (entry.active && !await settleWithin(entry.queue, 1_000)) {
          await clearHost(entry, 'runtime_manager_closed');
        }
        await entry.queue;
        await clearHost(entry, 'runtime_manager_closed');
      })).then(() => {
        entries.clear();
      });
      await closeWork;
    }
  };
}

async function settleWithin(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work.then(() => true, () => true),
      new Promise<false>(resolve => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function turnInput(input: AppServerRuntimeTurnInput): CodexAppServerTurnInput {
  return {
    cwd: input.cwd,
    sandbox: input.sandbox,
    model: input.model,
    reasoning: input.reasoning,
    prompt: input.prompt,
    developerInstructions: input.developerInstructions,
    skills: input.skills,
    imagePaths: input.imagePaths,
    codexThreadId: input.codexThreadId,
    timeoutMs: input.timeoutMs,
    inactivityTimeoutMs: input.inactivityTimeoutMs,
    onNotification: input.onNotification,
    onThreadRead: input.onThreadRead,
    onThreadStarted: input.onThreadStarted,
    onTurnStartWritten: input.onTurnStartWritten,
    onApprovalRequest: input.onApprovalRequest,
    onStderrChunk: input.onStderrChunk
  };
}

function mergeInjections(
  processInjection: AgentToolProcessInjection | undefined,
  runtimeInjection: AgentToolRunInjection | undefined
): AgentToolRunInjection | undefined {
  if (processInjection === undefined) return runtimeInjection;
  if (runtimeInjection === undefined) return processInjection;
  return {
    mcpServers: [...processInjection.mcpServers, ...runtimeInjection.mcpServers],
    env: { ...processInjection.env, ...runtimeInjection.env },
    builtInTools: runtimeInjection.builtInTools,
    configurationFingerprint: runtimeInjection.configurationFingerprint
  };
}

function runtimeFingerprint(profile: string, turn: AppServerRuntimeTurnInput): string {
  const injection = turn.runtimeInjection;
  return JSON.stringify({
    profile,
    mcpServers: injection?.mcpServers ?? [],
    builtInTools: injection?.builtInTools ?? null,
    configurationFingerprint: injection?.configurationFingerprint ?? '',
    skillRoots: turn.skillRoots ?? [],
    requiredSkillNames: turn.requiredSkillNames ?? []
  });
}

function scopeKey(scope: AppServerRuntimeScope): string {
  return `${scope.kind}:${scope.id}`;
}

function assertScope(scope: AppServerRuntimeScope) {
  if (scope.id.trim().length === 0) throw new Error('Codex app-server scope id is required');
}

function describeEntry(entry: ScopeEntry) {
  return {
    scope: { ...entry.scope },
    pid: entry.host?.pid,
    generation: entry.generation,
    active: entry.active,
    pending: entry.pending,
    lastUsedAt: entry.lastUsedAt
  };
}

function unrefTimer(handle: unknown) {
  if (
    typeof handle === 'object'
    && handle !== null
    && 'unref' in handle
    && typeof handle.unref === 'function'
  ) {
    handle.unref();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export type { CodexAppServerResult };
