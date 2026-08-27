import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { utilityProcess, type UtilityProcess } from 'electron';
import type {
  DaemonBootstrapEvent,
  DaemonConnection
} from '../shared/types.js';
import type { DesktopLogger } from './logger.js';

export const DEFAULT_DAEMON_START_TIMEOUT_MS = 60_000;
const MAX_DAEMON_OUTPUT_FRAME_BYTES = 1024 * 1024;

export class DaemonStartError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DaemonStartError';
  }
}

export type DaemonStartInput = {
  entryPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  codexBin: string;
  codexHome: string;
  dataDir: string;
  creatorRuntimeRoot?: string;
  codexRuntimeRoot?: string;
  codexRuntimeMode?: 'bundled' | 'external';
  defaultCwd: string;
  defaultProjectRoot: string;
  requireProbe: boolean;
  probeVerified: boolean;
  enterpriseConfigPath: string;
  enterpriseE2ERunId?: string;
  startupTimeoutMs?: number;
};

type DaemonManagerEvents = {
  bootstrap: [DaemonBootstrapEvent];
  connection: [DaemonConnection | null];
  exit: [{ code: number | null; reason: string }];
};

export class DaemonManager extends EventEmitter<DaemonManagerEvents> {
  private child: UtilityProcess | undefined;
  private connection: DaemonConnection | undefined;
  private startWork: Promise<DaemonConnection> | undefined;
  private stopWork: Promise<void> | undefined;
  private intentionalStop = false;
  private readonly codexPids = new Set<number>();

  constructor(private readonly logger: DesktopLogger) {
    super();
  }

  get currentConnection(): DaemonConnection | undefined {
    return this.connection;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(input: DaemonStartInput): Promise<DaemonConnection> {
    if (this.startWork !== undefined) return this.startWork;
    this.intentionalStop = false;
    this.stopWork = undefined;
    this.startWork = this.startInternal(input).finally(() => {
      this.startWork = undefined;
    });
    return this.startWork;
  }

  async stop(timeoutMs = 5_000): Promise<void> {
    if (this.stopWork !== undefined) return await this.stopWork;
    this.stopWork = this.stopInternal(timeoutMs).finally(() => {
      this.stopWork = undefined;
    });
    return await this.stopWork;
  }

  async restart(input: DaemonStartInput): Promise<DaemonConnection> {
    await this.stop();
    return await this.start(input);
  }

  private startInternal(input: DaemonStartInput): Promise<DaemonConnection> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdoutState: DaemonOutputState = {
        buffer: '',
        droppingFrame: false
      };
      const child = utilityProcess.fork(input.entryPath, buildDaemonArguments(input), {
        cwd: input.cwd,
        env: buildDaemonEnvironment(input),
        serviceName: 'OpenCreator Runtime',
        stdio: 'pipe'
      });
      this.child = child;
      this.logger.info('Daemon Utility Process starting', {
        entryPath: input.entryPath,
        codexBin: input.codexBin,
        codexHome: input.codexHome,
        dataDir: input.dataDir,
        pid: child.pid
      });

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const succeed = (connection: DaemonConnection) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.connection = connection;
        this.emit('connection', connection);
        resolve(connection);
      };

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        const consumed = consumeDaemonOutputChunk(
          stdoutState,
          chunk,
          MAX_DAEMON_OUTPUT_FRAME_BYTES
        );
        stdoutState = consumed.state;
        if (consumed.truncated) {
          this.logger.warn('Daemon stdout frame truncated', {
            limitBytes: MAX_DAEMON_OUTPUT_FRAME_BYTES
          });
        }
        for (const line of consumed.lines) {
          const parsed = parseDaemonOutputLine(line);
          if (parsed.kind === 'ignored') continue;
          if (parsed.kind === 'bootstrap') {
            this.emit('bootstrap', parsed.event);
            if (parsed.event.type === 'opencreator_daemon_bootstrap_error') {
              fail(new DaemonStartError(
                parsed.event.code,
                parsed.event.message,
                parsed.event.details
              ));
            }
            continue;
          }
          succeed(parsed.connection);
        }
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        this.logger.warnRateLimited(
          'daemon-stderr',
          'Daemon stderr',
          { message: chunk.slice(-8 * 1024) },
          1_000
        );
      });
      child.on('message', message => {
        const parsed = parseDaemonProcessMessage(message);
        if (parsed === undefined) return;
        if (parsed.type === 'codex_child_started') this.codexPids.add(parsed.pid);
        else this.codexPids.delete(parsed.pid);
      });
      child.once('error', (type, location, report) => {
        const error = new Error(`Daemon Utility Process ${type} at ${location}`);
        this.logger.error('Daemon Utility Process failed', {
          type,
          location,
          report: report.slice(-8 * 1024)
        });
        fail(error);
      });
      child.once('exit', code => {
        clearTimeout(timeout);
        const wasIntentional = this.intentionalStop;
        this.child = undefined;
        if (this.connection !== undefined) {
          this.connection = undefined;
          this.emit('connection', null);
        }
        this.logger.warn('Daemon Utility Process exited', {
          code,
          intentional: wasIntentional
        });
        void this.terminateKnownCodexProcesses(true);
        if (!settled) {
          settled = true;
          reject(new DaemonStartError(
            'DAEMON_START_FAILED',
            `Daemon exited before ready with code ${String(code)}`
          ));
        }
        this.emit('exit', {
          code,
          reason: wasIntentional ? 'intentional' : 'unexpected'
        });
      });

      const timeout = setTimeout(() => {
        const timeoutMs = input.startupTimeoutMs ?? DEFAULT_DAEMON_START_TIMEOUT_MS;
        fail(new DaemonStartError(
          'DAEMON_START_FAILED',
          `Daemon did not become ready within ${timeoutMs}ms`
        ));
        child.kill();
        void this.terminateKnownCodexProcesses(true);
      }, input.startupTimeoutMs ?? DEFAULT_DAEMON_START_TIMEOUT_MS);
      timeout.unref();
    });
  }

  private async stopInternal(timeoutMs: number): Promise<void> {
    const child = this.child;
    if (child === undefined) {
      this.connection = undefined;
      return;
    }
    this.intentionalStop = true;
    const exited = waitForExit(child);
    try {
      child.postMessage({ type: 'shutdown' });
    } catch {
      child.kill();
    }
    if (await settlesWithin(exited, timeoutMs)) return;
    child.kill();
    await this.terminateKnownCodexProcesses(false);
    if (await settlesWithin(exited, 2_000)) return;
    if (child.pid !== undefined && process.platform !== 'win32') {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // The process may already have exited between checks.
      }
    }
    await this.terminateKnownCodexProcesses(true);
    await settlesWithin(exited, 1_000);
  }

  private async terminateKnownCodexProcesses(force: boolean): Promise<void> {
    await Promise.all([...this.codexPids].map(async pid => {
      if (process.platform === 'win32') {
        await terminateWindowsProcessTree(pid, force);
        return;
      }
      try {
        process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        try {
          process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
        } catch {
          // The process has already exited.
        }
      }
    }));
    if (force) this.codexPids.clear();
  }
}

export function buildDaemonEnvironment(
  input: DaemonStartInput
): NodeJS.ProcessEnv {
  const env = { ...input.env };
  const enterpriseKeys = new Set([
    'OPENCREATOR_ENTERPRISE_ORIGIN',
    'OPENCREATOR_ENTERPRISE_E2E_RUN_ID',
    'OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED'
  ]);
  for (const key of Object.keys(env)) {
    if (enterpriseKeys.has(key.toUpperCase())) delete env[key];
  }

  Object.assign(env, {
    OPENCREATOR_CODEX_BIN: input.codexBin,
    CODEX_HOME: input.codexHome,
    OPENCREATOR_DATA_DIR: input.dataDir,
    ...(input.creatorRuntimeRoot === undefined
      ? {}
      : { OPENCREATOR_CREATOR_RUNTIME_ROOT: input.creatorRuntimeRoot }),
    ...(input.codexRuntimeRoot === undefined
      ? {}
      : { OPENCREATOR_CODEX_RUNTIME_ROOT: input.codexRuntimeRoot }),
    ...(input.codexRuntimeMode === undefined
      ? {}
      : { OPENCREATOR_CODEX_RUNTIME_MODE: input.codexRuntimeMode }),
    OPENCREATOR_DEFAULT_CWD: input.defaultCwd,
    OPENCREATOR_DEFAULT_PROJECT_ROOT: input.defaultProjectRoot,
    OPENCREATOR_REQUIRE_CODEX_PROBE: input.requireProbe ? '1' : '0',
    OPENCREATOR_CODEX_PROBE_VERIFIED: input.probeVerified ? '1' : '0'
  });
  return env;
}

export function buildDaemonArguments(input: DaemonStartInput): string[] {
  return [
    `--opencreator-enterprise-config=${input.enterpriseConfigPath}`,
    ...(input.enterpriseE2ERunId === undefined
      ? []
      : [
          `--opencreator-enterprise-e2e-run-id=${input.enterpriseE2ERunId}`,
          '--opencreator-enterprise-e2e-authorized=packaged-app'
        ])
  ];
}

export type DaemonOutputState = {
  buffer: string;
  droppingFrame: boolean;
};

export function consumeDaemonOutputChunk(
  previous: DaemonOutputState,
  chunk: string,
  maxFrameBytes: number
): {
  lines: string[];
  state: DaemonOutputState;
  truncated: boolean;
} {
  let input = chunk;
  let droppingFrame = previous.droppingFrame;
  let truncated = false;
  const lines: string[] = [];

  if (droppingFrame) {
    const newline = input.indexOf('\n');
    if (newline < 0) {
      return {
        lines,
        state: { buffer: '', droppingFrame: true },
        truncated
      };
    }
    input = input.slice(newline + 1);
    droppingFrame = false;
  }

  const frames = `${previous.buffer}${input}`.split('\n');
  let buffer = frames.pop() ?? '';
  for (const frame of frames) {
    const line = frame.endsWith('\r') ? frame.slice(0, -1) : frame;
    if (Buffer.byteLength(line) > maxFrameBytes) {
      truncated = true;
      continue;
    }
    lines.push(line);
  }
  if (Buffer.byteLength(buffer) > maxFrameBytes) {
    buffer = '';
    droppingFrame = true;
    truncated = true;
  }

  return {
    lines,
    state: { buffer, droppingFrame },
    truncated
  };
}

export type ParsedDaemonLine =
  | { kind: 'ignored' }
  | { kind: 'bootstrap'; event: DaemonBootstrapEvent }
  | { kind: 'connection'; connection: DaemonConnection };

export function parseDaemonOutputLine(line: string): ParsedDaemonLine {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return { kind: 'ignored' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { kind: 'ignored' };
  }
  if (!isRecord(parsed)) return { kind: 'ignored' };
  if (
    parsed.type === 'opencreator_daemon_bootstrap'
    && typeof parsed.phase === 'string'
    && typeof parsed.at === 'string'
  ) {
    return { kind: 'bootstrap', event: parsed as DaemonBootstrapEvent };
  }
  if (
    parsed.type === 'opencreator_daemon_bootstrap_error'
    && typeof parsed.code === 'string'
    && typeof parsed.message === 'string'
  ) {
    return { kind: 'bootstrap', event: parsed as DaemonBootstrapEvent };
  }
  if (typeof parsed.address === 'string' && typeof parsed.token === 'string') {
    return {
      kind: 'connection',
      connection: {
        address: normalizeAddress(parsed.address),
        token: parsed.token
      }
    };
  }
  return { kind: 'ignored' };
}

export type DaemonProcessMessage = {
  type: 'codex_child_started' | 'codex_child_exited';
  pid: number;
};

export function parseDaemonProcessMessage(
  value: unknown
): DaemonProcessMessage | undefined {
  const payload = isRecord(value) && 'data' in value ? value.data : value;
  if (
    !isRecord(payload)
    || (payload.type !== 'codex_child_started' && payload.type !== 'codex_child_exited')
    || typeof payload.pid !== 'number'
    || !Number.isInteger(payload.pid)
    || payload.pid <= 0
  ) {
    return undefined;
  }
  return {
    type: payload.type,
    pid: payload.pid
  };
}

function normalizeAddress(value: string): string {
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `http://${value}`;
}

function waitForExit(child: UtilityProcess): Promise<void> {
  return new Promise(resolve => {
    child.once('exit', () => resolve());
  });
}

async function settlesWithin(work: Promise<void>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([
    work.then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs))
  ]);
}

async function terminateWindowsProcessTree(
  pid: number,
  force: boolean
): Promise<void> {
  await new Promise<void>(resolve => {
    const child = spawn(
      'taskkill.exe',
      ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
      {
        stdio: 'ignore',
        windowsHide: true
      }
    );
    const timeout = setTimeout(() => {
      child.kill();
      resolve();
    }, 2_000);
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once('error', done);
    child.once('close', done);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
