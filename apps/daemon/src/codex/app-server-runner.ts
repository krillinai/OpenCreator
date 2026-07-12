import type { ReasoningEffort, SandboxMode } from '@clawee/protocol';
import { spawn } from 'node:child_process';

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
    | 'item/permissions/requestApproval';
  params: Record<string, unknown>;
};

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
  onNotification?: (notification: Record<string, unknown>) => Promise<void> | void;
  onThreadStarted?: (threadId: string) => Promise<void> | void;
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
};

export type CodexAppServerProcess = {
  cancel(): void;
  result: Promise<CodexAppServerResult>;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

export function startCodexAppServer(
  input: StartCodexAppServerInput
): CodexAppServerProcess {
  const args = [
    ...(input.profile === 'default' ? [] : ['--profile', input.profile]),
    'app-server',
    '--stdio'
  ];
  const child = spawn(input.codexBin, args, {
    cwd: input.cwd,
    env: { ...process.env, CODEX_HOME: input.codexHome },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map<string | number, PendingRequest>();
  let requestSequence = 0;
  let stdoutBuffer = '';
  let stderr = '';
  let threadId: string | undefined;
  let turnId: string | undefined;
  let cancelRequested = false;
  let settled = false;
  let finalResult: CodexAppServerResult | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let spawnTimeout: NodeJS.Timeout | undefined;
  let inactivityTimeout: NodeJS.Timeout | undefined;
  let forceKillTimeout: NodeJS.Timeout | undefined;
  let stdoutWork = Promise.resolve();
  let stderrWork = Promise.resolve();

  let resolveResult!: (result: CodexAppServerResult) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<CodexAppServerResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  function clearTimers(): void {
    if (timeout !== undefined) clearTimeout(timeout);
    if (spawnTimeout !== undefined) clearTimeout(spawnTimeout);
    if (inactivityTimeout !== undefined) clearTimeout(inactivityTimeout);
    if (forceKillTimeout !== undefined) clearTimeout(forceKillTimeout);
    timeout = undefined;
    spawnTimeout = undefined;
    inactivityTimeout = undefined;
    forceKillTimeout = undefined;
  }

  function kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (child.killed) return;
    child.kill(signal);
    if (forceKillTimeout === undefined) {
      forceKillTimeout = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, input.forceKillGraceMs ?? 2_000);
    }
  }

  function fail(error: Error): void {
    if (settled) return;
    settled = true;
    clearTimers();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    kill();
    rejectResult(error);
  }

  function resetInactivityTimeout(): void {
    if (input.inactivityTimeoutMs === undefined) return;
    if (inactivityTimeout !== undefined) clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
      fail(new Error(`Codex app-server inactivity timeout after ${input.inactivityTimeoutMs}ms`));
    }, input.inactivityTimeoutMs);
  }

  function markActivity(): void {
    if (spawnTimeout !== undefined) {
      clearTimeout(spawnTimeout);
      spawnTimeout = undefined;
    }
    resetInactivityTimeout();
  }

  function send(message: Record<string, unknown>): void {
    if (settled || child.stdin.destroyed) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = `clawee_${++requestSequence}`;
    send({ id, method, params });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  async function respondToServerRequest(message: AppServerRequest): Promise<void> {
    if (input.onApprovalRequest === undefined) {
      send({
        id: message.id,
        result: approvalResponse(message.method, 'rejected', message.params)
      });
      return;
    }
    try {
      const decision = await input.onApprovalRequest(message);
      send({
        id: message.id,
        result: approvalResponse(message.method, decision, message.params)
      });
    } catch (error) {
      send({
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  async function handleMessage(message: unknown): Promise<void> {
    if (!isRecord(message)) return;
    const id = message.id;
    if ((typeof id === 'string' || typeof id === 'number') && ('result' in message || 'error' in message)) {
      const request = pending.get(id);
      if (request === undefined) return;
      pending.delete(id);
      if (isRecord(message.error)) {
        request.reject(new Error(stringField(message.error, 'message') ?? 'Codex app-server request failed'));
      } else {
        request.resolve(message.result);
      }
      return;
    }

    const method = stringField(message, 'method');
    if (
      (typeof id === 'string' || typeof id === 'number')
      && isApprovalMethod(method)
      && isRecord(message.params)
    ) {
      void respondToServerRequest({ id, method, params: message.params });
      return;
    }

    if (method === undefined) return;
    await input.onNotification?.(message);
    if (method !== 'turn/completed' || !isRecord(message.params)) return;
    const turn = isRecord(message.params.turn) ? message.params.turn : undefined;
    const status = normalizeTurnStatus(stringField(turn, 'status'));
    if (status === undefined || threadId === undefined || turnId === undefined) return;
    finalResult = {
      threadId,
      turnId,
      turnStatus: status,
      stderr,
      terminationReason: cancelRequested || status === 'interrupted' ? 'canceled' : 'completed'
    };
    kill();
  }

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    markActivity();
    child.stdout.pause();
    stdoutWork = stdoutWork
      .then(async () => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            throw new Error('Codex app-server emitted invalid JSON');
          }
          await handleMessage(message);
        }
      })
      .catch(error => fail(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        if (!settled) child.stdout.resume();
      });
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    markActivity();
    child.stderr.pause();
    stderrWork = stderrWork
      .then(async () => {
        stderr += chunk;
        await input.onStderrChunk?.(chunk);
      })
      .catch(error => fail(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        if (!settled) child.stderr.resume();
      });
  });

  child.on('error', error => fail(error));
  child.on('close', () => {
    void Promise.allSettled([stdoutWork, stderrWork]).then(() => {
      if (settled) return;
      settled = true;
      clearTimers();
      for (const request of pending.values()) {
        request.reject(new Error('Codex app-server closed before responding'));
      }
      pending.clear();
      if (finalResult !== undefined) {
        resolveResult(finalResult);
      } else {
        rejectResult(new Error('Codex app-server closed before turn completion'));
      }
    });
  });

  if (input.timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      fail(new Error(`Codex app-server timeout after ${input.timeoutMs}ms`));
    }, input.timeoutMs);
  }
  if (input.spawnTimeoutMs !== undefined) {
    spawnTimeout = setTimeout(() => {
      fail(new Error(`Codex app-server spawn timeout after ${input.spawnTimeoutMs}ms`));
    }, input.spawnTimeoutMs);
  }
  resetInactivityTimeout();

  void (async () => {
    await request('initialize', {
      clientInfo: {
        name: 'clawee-agent',
        title: 'Clawee Agent',
        version: '0.1.0'
      },
      capabilities: {
        experimentalApi: false,
        requestAttestation: false
      }
    });
    send({ method: 'initialized' });
    const threadResponse = await request(
      input.codexThreadId === undefined ? 'thread/start' : 'thread/resume',
      input.codexThreadId === undefined
        ? {
            cwd: input.cwd,
            model: input.model ?? null,
            sandbox: input.sandbox,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            serviceName: 'clawee-agent'
          }
        : {
            threadId: input.codexThreadId,
            cwd: input.cwd,
            model: input.model ?? null,
            sandbox: input.sandbox,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user'
          }
    );
    const thread = isRecord(threadResponse) && isRecord(threadResponse.thread)
      ? threadResponse.thread
      : undefined;
    threadId = stringField(thread, 'id');
    if (threadId === undefined) throw new Error('Codex app-server response is missing thread.id');
    await input.onThreadStarted?.(threadId);
    const inputItems: Array<Record<string, unknown>> = [
      { type: 'text', text: input.prompt, text_elements: [] },
      ...(input.imagePaths ?? []).map(path => ({ type: 'localImage', path }))
    ];
    const turnResponse = await request('turn/start', {
      threadId,
      input: inputItems,
      cwd: input.cwd,
      model: input.model ?? null,
      effort: normalizeReasoning(input.reasoning),
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user'
    });
    const turn = isRecord(turnResponse) && isRecord(turnResponse.turn)
      ? turnResponse.turn
      : undefined;
    turnId = stringField(turn, 'id');
    if (turnId === undefined) throw new Error('Codex app-server response is missing turn.id');
  })().catch(error => fail(error instanceof Error ? error : new Error(String(error))));

  return {
    cancel() {
      if (settled || cancelRequested) return;
      cancelRequested = true;
      if (threadId !== undefined && turnId !== undefined) {
        void request('turn/interrupt', { threadId, turnId }).catch(() => kill());
      } else {
        kill();
      }
    },
    result
  };
}

function approvalResponse(
  method: AppServerRequest['method'],
  decision: AppServerApprovalDecision,
  params: Record<string, unknown>
): Record<string, unknown> {
  const accepted = decision === 'approved';
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

function isApprovalMethod(method: string | undefined): method is AppServerRequest['method'] {
  return method === 'item/commandExecution/requestApproval'
    || method === 'item/fileChange/requestApproval'
    || method === 'item/permissions/requestApproval';
}

function normalizeTurnStatus(
  value: string | undefined
): CodexAppServerResult['turnStatus'] | undefined {
  if (value === 'completed' || value === 'interrupted' || value === 'failed') return value;
  return undefined;
}

function normalizeReasoning(value: ReasoningEffort | undefined): string | null {
  if (value === undefined || value === 'default') return null;
  return value;
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
