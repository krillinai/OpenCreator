import type { ReasoningEffort, SandboxMode } from '@opencreator/protocol';
import type { ChildProcess } from 'node:child_process';
import {
  buildCodexMcpConfigArgs,
  codexToolIsolationArgs,
  type BuiltInToolPolicy,
  type CodexMcpServerConfig
} from './argv.js';
import {
  BoundedFrameBuffer,
  BoundedTextBuffer,
  type BufferTruncation
} from './bounded-buffer.js';
import {
  spawnCodexProcess,
  terminateCodexProcess
} from './process.js';

const MAX_APP_SERVER_FRAME_BYTES = 1024 * 1024;
const MAX_APP_SERVER_STDERR_BYTES = 1024 * 1024;
const DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS = 30_000;

export type AppServerApprovalDecision =
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'canceled';

export type AppServerRequest = {
  id: string | number;
  method:
    | 'item/commandExecution/requestApproval'
    | 'item/fileChange/requestApproval'
    | 'item/permissions/requestApproval'
    | 'mcpServer/elicitation/request';
  params: Record<string, unknown>;
};

export type CodexAppServerTurnInput = {
  cwd: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
  prompt: string;
  developerInstructions?: string;
  skills?: Array<{ name: string; path: string }>;
  imagePaths?: string[];
  codexThreadId?: string;
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
  manifestKey?: string;
  onNotification?: (notification: Record<string, unknown>) => Promise<void> | void;
  readThreadBeforeResume?: boolean;
  onThreadRead?: (thread: Record<string, unknown>) => Promise<void> | void;
  onThreadStarted?: (threadId: string) => Promise<void> | void;
  onTurnStartWritten?: () => void;
  onApprovalRequest?: (
    request: AppServerRequest
  ) => Promise<AppServerApprovalDecision>;
  onStderrChunk?: (chunk: string) => Promise<void> | void;
};

export type CodexAppServerResult = {
  threadId: string;
  turnId: string;
  turnStatus: 'completed' | 'interrupted' | 'failed';
  stderr: string;
  terminationReason: 'completed' | 'canceled';
  outputTruncation: {
    stderr: BufferTruncation;
    frames: BufferTruncation;
  };
};

export type CodexAppServerProcess = {
  cancel(): void;
  steer?(input: { message: string; clientMessageId?: string }): Promise<{ turnId: string }>;
  result: Promise<CodexAppServerResult>;
};

export type CodexAppServerHostLifecycleEvent = {
  event:
    | 'process_started'
    | 'process_initialized'
    | 'mcp_refreshed'
    | 'process_exited';
  at: string;
  pid?: number;
  generation?: number;
  reason?: string;
};

export type CodexAppServerHostInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  profile: string;
  mcpServers?: CodexMcpServerConfig[];
  builtInTools?: BuiltInToolPolicy;
  env?: Record<string, string>;
  skillRoots?: string[];
  requiredSkillNames?: string[];
  spawnTimeoutMs?: number;
  forceKillGraceMs?: number;
  onLifecycle?(event: CodexAppServerHostLifecycleEvent): void;
};

export type CodexAppServerHost = {
  readonly pid: number | undefined;
  readonly started: Promise<number>;
  run(input: CodexAppServerTurnInput): CodexAppServerProcess;
  isReusable(): boolean;
  close(reason?: string, forceKillGraceMs?: number): Promise<void>;
};

type HostState =
  | 'starting'
  | 'ready'
  | 'turn_active'
  | 'closing'
  | 'failed'
  | 'closed';

type PendingRequest = {
  method: string;
  generation: number;
  timeout: NodeJS.Timeout;
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type PendingWrite = {
  reject(error: Error): void;
};

type ActiveJob = {
  generation: number;
  input: CodexAppServerTurnInput;
  stderr: BoundedTextBuffer;
  threadId?: string;
  turnId?: string;
  cancelRequested: boolean;
  interruptRequested: boolean;
  turnStartWritten: boolean;
  stage:
    | 'acquiring'
    | 'thread_starting'
    | 'mcp_refreshing'
    | 'turn_preparing'
    | 'turn_starting'
    | 'turn_start_written'
    | 'turn_active'
    | 'interrupting'
    | 'settled';
  settled: boolean;
  timeout?: NodeJS.Timeout;
  inactivityTimeout?: NodeJS.Timeout;
  resolve(result: CodexAppServerResult): void;
  reject(error: Error): void;
};

export function createCodexAppServerHost(
  input: CodexAppServerHostInput
): CodexAppServerHost {
  const child = spawnCodexProcess(
    input.codexBin,
    buildCodexAppServerArgs(input),
    {
      cwd: input.cwd,
      env: { ...process.env, ...input.env, CODEX_HOME: input.codexHome },
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );
  const stdoutFrames = new BoundedFrameBuffer(MAX_APP_SERVER_FRAME_BYTES);
  const pending = new Map<string | number, PendingRequest>();
  const pendingWrites = new Set<PendingWrite>();
  let state: HostState = 'starting';
  let requestSequence = 0;
  let generationSequence = 0;
  let activeJob: ActiveJob | undefined;
  let lastManifestKey: string | undefined;
  let spawnTimeout: NodeJS.Timeout | undefined;
  let forceKillTimeout: NodeJS.Timeout | undefined;
  let stdoutWork = Promise.resolve();
  let stderrWork = Promise.resolve();
  let closeWork: Promise<void> | undefined;
  let resolveStarted!: (pid: number) => void;
  let rejectStarted!: (error: Error) => void;
  let resolveClosed!: () => void;
  const started = new Promise<number>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const closed = new Promise<void>(resolve => {
    resolveClosed = resolve;
  });
  void started.catch(() => undefined);

  if (child.pid !== undefined) {
    resolveStarted(child.pid);
  } else {
    child.once('spawn', () => {
      if (child.pid === undefined) {
        rejectStarted(new Error('Codex app-server process did not expose a pid'));
        return;
      }
      resolveStarted(child.pid);
    });
    child.once('error', rejectStarted);
  }

  emitLifecycle({ event: 'process_started', pid: child.pid });

  if (input.spawnTimeoutMs !== undefined) {
    spawnTimeout = setTimeout(() => {
      failHost(new Error(
        `Codex app-server spawn timeout after ${input.spawnTimeoutMs}ms`
      ));
    }, input.spawnTimeoutMs);
  }

  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    markActivity();
    child.stdout!.pause();
    stdoutWork = stdoutWork
      .then(async () => {
        for (const line of stdoutFrames.push(chunk)) {
          if (line.trim().length === 0) continue;
          await handleFrame(line);
        }
      })
      .catch(error => failHost(toError(error)))
      .finally(() => {
        if (state !== 'closed') child.stdout!.resume();
      });
  });

  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => {
    markActivity();
    child.stderr!.pause();
    stderrWork = stderrWork
      .then(async () => {
        const job = activeJob;
        if (job === undefined || job.settled) return;
        job.stderr.append(chunk);
        await job.input.onStderrChunk?.(chunk);
      })
      .catch(error => failHost(toError(error)))
      .finally(() => {
        if (state !== 'closed') child.stderr!.resume();
      });
  });

  child.stdin!.on('error', error => failHost(error));
  child.on('error', error => failHost(error));
  child.on('close', (_code, signal) => {
    const finalFrame = stdoutFrames.flush();
    if (finalFrame !== undefined) {
      stdoutWork = stdoutWork.then(() => handleFrame(finalFrame));
    }
    void Promise.allSettled([stdoutWork, stderrWork]).then(() => {
      clearSpawnTimeout();
      clearForceKillTimeout();
      const error = new Error('Codex app-server closed before turn completion');
      rejectStarted(error);
      rejectWrites(error);
      rejectPending(error);
      if (activeJob !== undefined && !activeJob.settled) {
        settleJobError(activeJob, error, false);
      }
      state = 'closed';
      emitLifecycle({
        event: 'process_exited',
        pid: child.pid,
        reason: signal ?? undefined
      });
      resolveClosed();
    });
  });

  const initializePromise = request('initialize', {
    clientInfo: {
      name: 'opencreator-agent',
      title: 'OpenCreator Agent',
      version: '0.1.0'
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false
    }
  }, 0).then(async () => {
    await writeMessage({ method: 'initialized' });
    if ((input.skillRoots?.length ?? 0) > 0) {
      await request('skills/extraRoots/set', {
        extraRoots: input.skillRoots
      }, 0);
    }
    if ((input.requiredSkillNames?.length ?? 0) > 0) {
      const response = await request('skills/list', {
        cwds: [input.cwd],
        forceReload: true
      }, 0);
      const visible = listedSkillNames(response);
      const missing = input.requiredSkillNames!.filter(name => !visible.has(name));
      if (missing.length > 0) {
        throw new Error(`Required Codex skills are unavailable: ${missing.join(', ')}`);
      }
    }
    if (state === 'starting') state = 'ready';
    emitLifecycle({ event: 'process_initialized', pid: child.pid });
  }).catch(error => {
    failHost(toError(error));
    throw error;
  });
  void initializePromise.catch(() => undefined);

  function run(turnInput: CodexAppServerTurnInput): CodexAppServerProcess {
    if (
      state === 'closing'
      || state === 'failed'
      || state === 'closed'
    ) {
      throw new Error('Codex app-server host is not reusable');
    }
    if (activeJob !== undefined) {
      throw new Error('Codex app-server host is busy');
    }

    let resolveResult!: (result: CodexAppServerResult) => void;
    let rejectResult!: (error: Error) => void;
    const result = new Promise<CodexAppServerResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const job: ActiveJob = {
      generation: ++generationSequence,
      input: turnInput,
      stderr: new BoundedTextBuffer(MAX_APP_SERVER_STDERR_BYTES),
      cancelRequested: false,
      interruptRequested: false,
      turnStartWritten: false,
      stage: 'acquiring',
      settled: false,
      resolve: resolveResult,
      reject: rejectResult
    };
    activeJob = job;
    state = 'turn_active';
    startJobTimers(job);
    void executeJob(job);

    return {
      cancel() {
        if (job.settled || job.cancelRequested) return;
        job.cancelRequested = true;
        if (job.threadId !== undefined && job.turnId !== undefined) {
          void interruptJob(job);
        }
      },
      steer(input) {
        return steerJob(job, input);
      },
      result
    };
  }

  async function steerJob(
    job: ActiveJob,
    input: { message: string; clientMessageId?: string }
  ): Promise<{ turnId: string }> {
    if (
      job.settled
      || activeJob !== job
      || job.threadId === undefined
      || job.turnId === undefined
      || job.stage !== 'turn_active'
    ) {
      throw new Error('Codex app-server turn is not steerable');
    }
    const response = await request('turn/steer', {
      threadId: job.threadId,
      expectedTurnId: job.turnId,
      ...(input.clientMessageId === undefined
        ? {}
        : { clientUserMessageId: input.clientMessageId }),
      input: [{ type: 'text', text: input.message, text_elements: [] }]
    }, job.generation);
    assertCurrentJob(job);
    const turnId = isRecord(response) ? stringField(response, 'turnId') : undefined;
    if (turnId === undefined || turnId !== job.turnId) {
      throw new Error('Codex app-server turn/steer response is invalid');
    }
    return { turnId };
  }

  async function executeJob(job: ActiveJob): Promise<void> {
    try {
      await initializePromise;
      assertCurrentJob(job);
      if (job.cancelRequested) {
        throw new Error('Codex app-server run canceled before turn start');
      }

      job.stage = 'thread_starting';
      if (
        job.input.codexThreadId !== undefined
        && job.input.readThreadBeforeResume === true
      ) {
        const readResponse = await request('thread/read', {
          threadId: job.input.codexThreadId,
          includeTurns: true
        }, job.generation);
        assertCurrentJob(job);
        const readThread = isRecord(readResponse) && isRecord(readResponse.thread)
          ? readResponse.thread
          : undefined;
        if (readThread === undefined) {
          throw new Error('Codex app-server thread/read response is missing thread');
        }
        await job.input.onThreadRead?.(readThread);
        assertCurrentJob(job);
      }
      const threadResponse = await request(
        job.input.codexThreadId === undefined ? 'thread/start' : 'thread/resume',
        job.input.codexThreadId === undefined
          ? {
              cwd: job.input.cwd,
              model: job.input.model ?? null,
              permissions: permissionProfile(job.input.sandbox),
              approvalPolicy: approvalPolicy(job.input.sandbox),
              approvalsReviewer: 'user',
              serviceName: 'clawee-agent',
              developerInstructions: job.input.developerInstructions ?? null
            }
          : {
              threadId: job.input.codexThreadId,
              cwd: job.input.cwd,
              model: job.input.model ?? null,
              permissions: permissionProfile(job.input.sandbox),
              approvalPolicy: approvalPolicy(job.input.sandbox),
              approvalsReviewer: 'user',
              excludeTurns: true,
              developerInstructions: job.input.developerInstructions ?? null
            },
        job.generation
      );
      assertCurrentJob(job);
      const thread = isRecord(threadResponse) && isRecord(threadResponse.thread)
        ? threadResponse.thread
        : undefined;
      job.threadId = stringField(thread, 'id');
      if (job.threadId === undefined) {
        throw new Error('Codex app-server response is missing thread.id');
      }
      await job.input.onThreadStarted?.(job.threadId);
      assertCurrentJob(job);

      if (
        job.input.manifestKey !== undefined
        && job.input.manifestKey !== lastManifestKey
      ) {
        job.stage = 'mcp_refreshing';
        await request(
          'config/mcpServer/reload',
          undefined,
          job.generation
        );
        assertCurrentJob(job);
        lastManifestKey = job.input.manifestKey;
        emitLifecycle({
          event: 'mcp_refreshed',
          pid: child.pid,
          generation: job.generation
        });
      }
      job.stage = 'turn_preparing';
      if (job.cancelRequested) {
        throw new Error('Codex app-server run canceled before turn start');
      }

      const inputItems: Array<Record<string, unknown>> = [
        { type: 'text', text: job.input.prompt, text_elements: [] },
        ...(job.input.skills ?? []).map(skill => ({
          type: 'skill',
          name: skill.name,
          path: skill.path
        })),
        ...(job.input.imagePaths ?? []).map(path => ({
          type: 'localImage',
          path
        }))
      ];
      job.stage = 'turn_starting';
      const turnWork = request('turn/start', {
        threadId: job.threadId,
        input: inputItems,
        cwd: job.input.cwd,
        model: job.input.model ?? null,
        effort: normalizeReasoning(job.input.reasoning),
        permissions: permissionProfile(job.input.sandbox),
        approvalPolicy: approvalPolicy(job.input.sandbox),
        approvalsReviewer: 'user'
      }, job.generation, () => {
        assertCurrentJob(job);
        job.turnStartWritten = true;
        job.stage = 'turn_start_written';
        job.input.onTurnStartWritten?.();
      });
      const turnResponse = await turnWork;
      assertCurrentJob(job);
      const turn = isRecord(turnResponse) && isRecord(turnResponse.turn)
        ? turnResponse.turn
        : undefined;
      job.turnId = stringField(turn, 'id');
      if (job.turnId === undefined) {
        throw new Error('Codex app-server response is missing turn.id');
      }
      job.stage = 'turn_active';
      if (job.cancelRequested) await interruptJob(job);
    } catch (error) {
      if (job.settled || activeJob !== job) return;
      const normalized = toError(error);
      if (
        job.turnStartWritten
        || job.stage === 'mcp_refreshing'
        || normalized.message.includes('response is missing')
      ) {
        failHost(normalized);
        return;
      }
      settleJobError(job, normalized, true);
    }
  }

  async function interruptJob(job: ActiveJob): Promise<void> {
    if (
      job.settled
      || activeJob !== job
      || job.interruptRequested
      || job.threadId === undefined
      || job.turnId === undefined
    ) {
      return;
    }
    job.interruptRequested = true;
    job.stage = 'interrupting';
    try {
      await request('turn/interrupt', {
        threadId: job.threadId,
        turnId: job.turnId
      }, job.generation);
    } catch (error) {
      failHost(toError(error));
    }
  }

  async function handleFrame(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      throw new Error('Codex app-server emitted invalid JSON');
    }
    await handleMessage(message);
  }

  async function handleMessage(message: unknown): Promise<void> {
    if (!isRecord(message)) return;
    const id = message.id;
    if (
      (typeof id === 'string' || typeof id === 'number')
      && ('result' in message || 'error' in message)
    ) {
      const pendingRequest = pending.get(id);
      if (pendingRequest === undefined) return;
      pending.delete(id);
      clearTimeout(pendingRequest.timeout);
      if (isRecord(message.error)) {
        pendingRequest.reject(new Error(
          `Codex app-server request ${pendingRequest.method} failed: ${
            stringField(message.error, 'message')
            ?? 'unknown error'
          }`
        ));
      } else {
        pendingRequest.resolve(message.result);
      }
      return;
    }

    const method = stringField(message, 'method');
    if (
      (typeof id === 'string' || typeof id === 'number')
      && isRecord(message.params)
    ) {
      if (isApprovalRequest(method, message.params)) {
        void respondToServerRequest({
          id,
          method,
          params: message.params
        }).catch(error => failHost(toError(error)));
        return;
      }
      if (method === 'mcpServer/elicitation/request') {
        await writeMessage({
          id,
          result: approvalResponse(method, 'canceled', message.params)
        });
        return;
      }
    }
    if (method === undefined) return;

    const job = activeJob;
    if (
      job === undefined
      || job.settled
      || !messageBelongsToJob(message, job)
    ) {
      return;
    }
    await job.input.onNotification?.(message);
    if (method !== 'turn/completed' || !isRecord(message.params)) return;
    const turn = isRecord(message.params.turn) ? message.params.turn : undefined;
    const status = normalizeTurnStatus(stringField(turn, 'status'));
    const completedTurnId = stringField(turn, 'id');
    if (
      status === undefined
      || job.threadId === undefined
      || job.turnId === undefined
      || completedTurnId !== job.turnId
    ) {
      return;
    }
    settleJobResult(job, {
      threadId: job.threadId,
      turnId: job.turnId,
      turnStatus: status,
      stderr: job.stderr.text(),
      terminationReason:
        job.cancelRequested || status === 'interrupted'
          ? 'canceled'
          : 'completed',
      outputTruncation: {
        stderr: job.stderr.truncation(),
        frames: stdoutFrames.truncation()
      }
    });
  }

  async function respondToServerRequest(message: AppServerRequest): Promise<void> {
    const job = activeJob;
    if (
      job === undefined
      || job.settled
      || !messageBelongsToJob(
        { params: message.params },
        job
      )
    ) {
      await writeMessage({
        id: message.id,
        error: {
          code: -32001,
          message: 'Request does not belong to the active turn'
        }
      });
      return;
    }
    const generation = job.generation;
    if (approvalPolicy(job.input.sandbox) === 'never') {
      await writeMessage({
        id: message.id,
        result: approvalResponse(message.method, 'approved', message.params)
      });
      return;
    }
    if (job.input.onApprovalRequest === undefined) {
      await writeMessage({
        id: message.id,
        result: approvalResponse(message.method, 'rejected', message.params)
      });
      return;
    }
    try {
      const decision = await job.input.onApprovalRequest(message);
      if (
        activeJob !== job
        || job.settled
        || job.generation !== generation
      ) {
        await writeMessage({
          id: message.id,
          error: {
            code: -32001,
            message: 'Approval request is no longer active'
          }
        });
        return;
      }
      await writeMessage({
        id: message.id,
        result: approvalResponse(message.method, decision, message.params)
      });
    } catch (error) {
      await writeMessage({
        id: message.id,
        error: {
          code: -32000,
          message: toError(error).message
        }
      });
    }
  }

  function request(
    method: string,
    params: unknown,
    generation: number,
    onWritten?: () => void
  ): Promise<unknown> {
    const id = `opencreator_${++requestSequence}`;
    const response = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pendingRequest = pending.get(id);
        if (pendingRequest === undefined) return;
        pending.delete(id);
        const error = new Error(
          `Codex app-server request ${method} timed out after ${DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS}ms`
        );
        pendingRequest.reject(error);
        failHost(error);
      }, DEFAULT_APP_SERVER_REQUEST_TIMEOUT_MS);
      timeout.unref();
      pending.set(id, { method, generation, timeout, resolve, reject });
    });
    void response.catch(() => undefined);
    return writeMessage({ id, method, params }).then(
      () => {
        try {
          onWritten?.();
        } catch (error) {
          const pendingRequest = pending.get(id);
          if (pendingRequest !== undefined) clearTimeout(pendingRequest.timeout);
          pending.delete(id);
          const normalized = toError(error);
          failHost(normalized);
          throw normalized;
        }
        return response;
      },
      error => {
        const pendingRequest = pending.get(id);
        if (pendingRequest !== undefined) clearTimeout(pendingRequest.timeout);
        pending.delete(id);
        const normalized = toError(error);
        failHost(normalized);
        throw normalized;
      }
    );
  }

  function writeMessage(message: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const pendingWrite: PendingWrite = {
        reject(error) {
          if (settled) return;
          settled = true;
          pendingWrites.delete(pendingWrite);
          reject(error);
        }
      };
      const failWrite = (error: unknown): void => {
        const normalized = toError(error);
        pendingWrite.reject(normalized);
        failHost(normalized);
      };
      pendingWrites.add(pendingWrite);

      if (
        state === 'closed'
        || child.stdin === null
        || child.stdin.destroyed
        || !child.stdin.writable
      ) {
        failWrite(new Error('Codex app-server stdin is unavailable'));
        return;
      }
      try {
        child.stdin.write(
          `${JSON.stringify(message)}\n`,
          error => {
            if (error !== undefined && error !== null) {
              failWrite(error);
              return;
            }
            if (settled) return;
            settled = true;
            pendingWrites.delete(pendingWrite);
            resolve();
          }
        );
      } catch (error) {
        failWrite(error);
      }
    });
  }

  function rejectWrites(error: Error): void {
    for (const write of [...pendingWrites]) write.reject(error);
  }

  function startJobTimers(job: ActiveJob): void {
    if (job.input.timeoutMs !== undefined) {
      job.timeout = setTimeout(() => {
        failHost(new Error(
          `Codex app-server timeout after ${job.input.timeoutMs}ms`
        ));
      }, job.input.timeoutMs);
    }
    resetInactivityTimeout(job);
  }

  function resetInactivityTimeout(job: ActiveJob): void {
    if (job.input.inactivityTimeoutMs === undefined || job.settled) return;
    if (job.inactivityTimeout !== undefined) {
      clearTimeout(job.inactivityTimeout);
    }
    job.inactivityTimeout = setTimeout(() => {
      failHost(new Error(
        `Codex app-server inactivity timeout after ${job.input.inactivityTimeoutMs}ms`
      ));
    }, job.input.inactivityTimeoutMs);
  }

  function markActivity(): void {
    clearSpawnTimeout();
    if (activeJob !== undefined) resetInactivityTimeout(activeJob);
  }

  function settleJobResult(
    job: ActiveJob,
    result: CodexAppServerResult
  ): void {
    if (job.settled) return;
    job.settled = true;
    job.stage = 'settled';
    clearJobTimers(job);
    if (activeJob === job) activeJob = undefined;
    if (state === 'turn_active') state = 'ready';
    job.resolve(result);
  }

  function settleJobError(
    job: ActiveJob,
    error: Error,
    reusable: boolean
  ): void {
    if (job.settled) return;
    job.settled = true;
    job.stage = 'settled';
    clearJobTimers(job);
    rejectGeneration(job.generation, error);
    if (activeJob === job) activeJob = undefined;
    if (reusable && state === 'turn_active') state = 'ready';
    job.reject(error);
  }

  function failHost(error: Error): void {
    if (state === 'closed' || state === 'closing' || state === 'failed') return;
    state = 'failed';
    clearSpawnTimeout();
    rejectStarted(error);
    rejectWrites(error);
    rejectPending(error);
    if (activeJob !== undefined) settleJobError(activeJob, error, false);
    void terminateCodexProcess(child, 'SIGTERM');
    scheduleForceKill(input.forceKillGraceMs ?? 2_000);
  }

  function rejectPending(error: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  function rejectGeneration(generation: number, error: Error): void {
    for (const [id, request] of pending) {
      if (request.generation !== generation) continue;
      pending.delete(id);
      clearTimeout(request.timeout);
      request.reject(error);
    }
  }

  function clearJobTimers(job: ActiveJob): void {
    if (job.timeout !== undefined) clearTimeout(job.timeout);
    if (job.inactivityTimeout !== undefined) clearTimeout(job.inactivityTimeout);
    job.timeout = undefined;
    job.inactivityTimeout = undefined;
  }

  function clearSpawnTimeout(): void {
    if (spawnTimeout !== undefined) clearTimeout(spawnTimeout);
    spawnTimeout = undefined;
  }

  function clearForceKillTimeout(): void {
    if (forceKillTimeout !== undefined) clearTimeout(forceKillTimeout);
    forceKillTimeout = undefined;
  }

  function scheduleForceKill(graceMs: number): void {
    if (
      forceKillTimeout !== undefined
      || child.exitCode !== null
      || child.signalCode !== null
    ) {
      return;
    }
    forceKillTimeout = setTimeout(() => {
      void terminateCodexProcess(child, 'SIGKILL');
    }, graceMs);
  }

  function assertCurrentJob(job: ActiveJob): void {
    if (job.settled || activeJob !== job) {
      throw new Error('Codex app-server job is no longer active');
    }
  }

  function emitLifecycle(
    event: Omit<CodexAppServerHostLifecycleEvent, 'at'>
  ): void {
    input.onLifecycle?.({
      ...event,
      at: new Date().toISOString()
    });
  }

  return {
    get pid() {
      return child.pid;
    },
    started,
    run,
    isReusable() {
      return state === 'starting' || state === 'ready';
    },
    async close(reason = 'closed', forceKillGraceMs = input.forceKillGraceMs ?? 2_000) {
      if (closeWork !== undefined) return closeWork;
      closeWork = (async () => {
        if (state === 'closed') return;
        state = 'closing';
        clearSpawnTimeout();
        await terminateCodexProcess(child, 'SIGTERM');
        scheduleForceKill(forceKillGraceMs);
        await closed;
      })();
      await closeWork;
      void reason;
    }
  };
}

function listedSkillNames(value: unknown): Set<string> {
  const names = new Set<string>();
  if (!isRecord(value) || !Array.isArray(value.data)) return names;
  for (const entry of value.data) {
    if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
    for (const skill of entry.skills) {
      const name = stringField(isRecord(skill) ? skill : undefined, 'name');
      if (name !== undefined) names.add(name);
    }
  }
  return names;
}

export function buildCodexAppServerArgs(input: {
  profile: string;
  mcpServers?: CodexMcpServerConfig[];
  builtInTools?: BuiltInToolPolicy;
}): string[] {
  return [
    ...(input.builtInTools === undefined
      ? []
      : codexToolIsolationArgs(input.builtInTools)),
    ...(normalizeProfile(input.profile) === 'default'
      ? []
      : ['--profile', normalizeProfile(input.profile)]),
    ...buildCodexMcpConfigArgs(input.mcpServers),
    'app-server',
    '--stdio'
  ];
}

export function normalizeAppServerProfile(profile: string): string {
  return normalizeProfile(profile);
}

function messageBelongsToJob(
  message: Record<string, unknown>,
  job: ActiveJob
): boolean {
  const params = isRecord(message.params) ? message.params : undefined;
  if (params === undefined) return true;
  const threadId = stringField(params, 'threadId');
  if (
    threadId !== undefined
    && job.threadId !== undefined
    && threadId !== job.threadId
  ) {
    return false;
  }
  const turn = isRecord(params.turn) ? params.turn : undefined;
  const turnId = stringField(params, 'turnId') ?? stringField(turn, 'id');
  return !(
    turnId !== undefined
    && job.turnId !== undefined
    && turnId !== job.turnId
  );
}

function approvalPolicy(sandbox: SandboxMode): 'never' | 'on-request' {
  return sandbox === 'danger-full-access' ? 'never' : 'on-request';
}

function permissionProfile(sandbox: SandboxMode): string {
  if (sandbox === 'read-only') return ':read-only';
  if (sandbox === 'danger-full-access') return ':danger-full-access';
  return ':workspace';
}

function approvalResponse(
  method: AppServerRequest['method'],
  decision: AppServerApprovalDecision,
  params: Record<string, unknown>
): Record<string, unknown> {
  const accepted = decision === 'approved';
  if (method === 'mcpServer/elicitation/request') {
    return {
      action: accepted ? 'accept' : decision === 'canceled' ? 'cancel' : 'decline',
      content: accepted ? {} : null,
      _meta: null
    };
  }
  if (method === 'item/permissions/requestApproval') {
    return accepted
      ? {
          permissions: isRecord(params.permissions) ? params.permissions : {},
          scope: 'turn'
        }
      : {
          permissions: {},
          scope: 'turn'
        };
  }
  return {
    decision: accepted ? 'accept' : decision === 'canceled' ? 'cancel' : 'decline'
  };
}

function isApprovalRequest(
  method: string | undefined,
  params: Record<string, unknown>
): method is AppServerRequest['method'] {
  if (
    method === 'item/commandExecution/requestApproval'
    || method === 'item/fileChange/requestApproval'
    || method === 'item/permissions/requestApproval'
  ) {
    return true;
  }
  if (method !== 'mcpServer/elicitation/request') return false;
  const request = isRecord(params.request) ? params.request : undefined;
  const meta = [params._meta, params.meta, request?._meta, request?.meta]
    .find(isRecord);
  if (
    stringField(meta, 'codex_approval_kind') === 'mcp_tool_call'
    || stringField(meta, 'codex_request_type') === 'approval_request'
  ) {
    return true;
  }

  const mode = stringField(params, 'mode') ?? stringField(request, 'mode');
  const message = stringField(params, 'message') ?? stringField(request, 'message');
  const requestedSchema = isRecord(params.requestedSchema)
    ? params.requestedSchema
    : isRecord(request?.requestedSchema)
      ? request.requestedSchema
      : undefined;
  const properties = isRecord(requestedSchema?.properties)
    ? requestedSchema.properties
    : undefined;
  const required = requestedSchema?.required;
  return mode === 'form'
    && stringField(params, 'serverName') !== undefined
    && message !== undefined
    && /^Allow .+ to run tool "[^"]+"\?$/.test(message.trim())
    && properties !== undefined
    && Object.keys(properties).length === 0
    && (!Array.isArray(required) || required.length === 0);
}

function normalizeTurnStatus(
  value: string | undefined
): CodexAppServerResult['turnStatus'] | undefined {
  if (value === 'completed' || value === 'interrupted' || value === 'failed') {
    return value;
  }
  return undefined;
}

function normalizeReasoning(value: ReasoningEffort | undefined): string | null {
  if (value === undefined || value === 'default') return null;
  return value;
}

function normalizeProfile(profile: string): string {
  const normalized = profile.trim();
  return normalized.length === 0 || normalized === 'default'
    ? 'default'
    : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string
): string | undefined {
  const result = value?.[field];
  return typeof result === 'string' ? result : undefined;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
