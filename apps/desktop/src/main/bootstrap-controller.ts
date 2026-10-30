import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type {
  DesktopBootstrapState,
  DesktopConnectionConfig,
  DaemonConnection
} from '../shared/types.js';
import {
  CodexResolutionError,
  resolveCodexEnvironment,
  validateManualCodexPath,
  type CodexResolutionDiagnostics,
  type LoginShellEnvironmentTask,
  type ResolvedCodexEnvironment
} from './codex-resolver.js';
import {
  DaemonStartError,
  DaemonManager,
  type DaemonStartInput
} from './daemon-manager.js';
import { fetchDesktopRequest } from './desktop-network.js';
import type { DesktopLogger } from './logger.js';
import type { SettingsStore } from './settings-store.js';

type BootstrapControllerEvents = {
  state: [DesktopBootstrapState];
  connection: [DesktopConnectionConfig | null];
  ready: [];
};

export class BootstrapController extends EventEmitter<BootstrapControllerEvents> {
  private state: DesktopBootstrapState = initialState();
  private runWork: Promise<void> | undefined;
  private resolvedEnvironment: ResolvedCodexEnvironment | undefined;
  private verifiedFingerprint: string | undefined;
  private automaticRestarts = 0;
  private stableTimer: NodeJS.Timeout | undefined;
  private healthCheckWork: Promise<void> | undefined;
  private recoveryWork: Promise<void> | undefined;
  private recoveryController: AbortController | undefined;
  private stopping = false;

  constructor(private readonly input: {
    daemon: DaemonManager;
    settings: SettingsStore;
    logger: DesktopLogger;
    daemonEntryPath: string;
    appHome: string;
    dataDir: string;
    codexRuntimeRoot: string;
    creatorRuntimeRoot: string;
    creatorPresetAssetsRoot?: string;
    stickmanRuntimeRoot: string;
    defaultProjectRoot: string;
    development: boolean;
    probeHealth?(connection: DaemonConnection): Promise<boolean>;
    automaticRestartDelays?: readonly number[];
  }) {
    super();
    input.daemon.on('bootstrap', event => {
      if (event.type === 'opencreator_daemon_bootstrap_error') {
        this.updateState({
          phase: 'failed',
          durationMs: event.durationMs,
          error: {
            code: event.code,
            message: event.message,
            details: event.details
          }
        });
        return;
      }
      if (event.phase === 'probing_codex') this.updateState({ phase: 'probing_codex' });
      if (event.phase === 'probe_succeeded') {
        this.updateState({
          phase: 'starting_runtime',
          durationMs: event.durationMs,
          probeTimings: event.probeTimings
        });
      }
      if (event.phase === 'starting_runtime') this.updateState({ phase: 'starting_runtime' });
    });
    input.daemon.on('connection', connection => {
      this.emit('connection', connection === null ? null : this.rendererConnection());
    });
    input.daemon.on('exit', event => {
      if (
        event.reason !== 'unexpected'
        || this.stopping
        || this.runWork !== undefined
        || this.recoveryWork !== undefined
        || this.state.phase === 'failed'
      ) return;
      void this.recoverRuntime('exit');
    });
  }

  get currentState(): DesktopBootstrapState {
    return structuredClone(this.state);
  }

  rendererConnection(): DesktopConnectionConfig | null {
    const connection = this.input.daemon.currentConnection;
    if (connection === undefined) return null;
    return { baseUrl: '/.opencreator/runtime' };
  }

  start(
    selectedCodexBin?: string,
    loginShellTask?: LoginShellEnvironmentTask
  ): Promise<void> {
    if (this.runWork !== undefined) return this.runWork;
    this.stopping = false;
    this.runWork = this.startInternal(selectedCodexBin, loginShellTask).finally(() => {
      this.runWork = undefined;
    });
    return this.runWork;
  }

  async selectCodexPath(path: string): Promise<void> {
    const validated = validateManualCodexPath(path);
    if (validated === undefined) {
      this.updateState({
        phase: 'failed',
        error: {
          code: 'CODEX_PATH_INVALID',
          message: 'Select ChatGPT.app, Codex.app, or a codex executable'
        }
      });
      return;
    }
    this.input.settings.update({
      codexRuntimeMode: 'external',
      externalCodexBin: validated
    });
    await this.input.daemon.stop();
    await this.start(validated);
  }

  async restartRuntime(): Promise<void> {
    if (this.runWork !== undefined) return this.runWork;
    this.recoveryController?.abort();
    if (this.recoveryWork !== undefined) await this.input.daemon.stop();
    await this.recoveryWork;
    if (this.runWork !== undefined) return this.runWork;
    this.stopping = false;
    if (this.resolvedEnvironment === undefined) {
      await this.start();
      if (this.state.phase === 'failed') throw new Error(this.state.error?.message ?? 'Failed to start the local Runtime');
      return;
    }
    await this.recoverRuntime('manual');
  }

  reportProxyFailure(connection: DaemonConnection): void {
    if (
      this.stopping
      || this.state.phase !== 'ready'
      || this.input.daemon.currentConnection !== connection
      || this.healthCheckWork !== undefined
      || this.recoveryWork !== undefined
    ) return;
    this.healthCheckWork = this.checkRuntimeHealth(connection).finally(() => {
      this.healthCheckWork = undefined;
    });
  }

  markWorkspaceReady(): void {
    this.updateState({ phase: 'ready', error: undefined });
  }

  markWorkspaceFailed(error: unknown): void {
    this.updateState({
      phase: 'workspace_failed',
      error: {
        code: error instanceof DaemonStartError
          ? error.code
          : isWorkspaceError(error)
            ? error.code
            : 'WORKSPACE_LOAD_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }

  setStartupMetrics(
    startupMetrics: DesktopBootstrapState['startupMetrics']
  ): void {
    this.updateState({ startupMetrics });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.recoveryController?.abort();
    if (this.stableTimer !== undefined) clearTimeout(this.stableTimer);
    await this.input.daemon.stop();
    await this.recoveryWork;
  }

  private async startInternal(
    selectedCodexBin?: string,
    loginShellTask?: LoginShellEnvironmentTask
  ): Promise<void> {
    const attempt = this.state.attempt + 1;
    const startedAt = new Date().toISOString();
    this.state = {
      phase: 'resolving_codex',
      startedAt,
      updatedAt: startedAt,
      attempt,
      revision: this.state.revision + 1,
      startupMetrics: this.state.startupMetrics
    };
    this.emit('state', this.currentState);
    const settings = this.input.settings.read();
    const resolutionStartedAt = Date.now();
    let resolutionDiagnostics: CodexResolutionDiagnostics | undefined;
    let resolvedEnvironment: ResolvedCodexEnvironment | undefined;
    try {
      resolvedEnvironment = await resolveCodexEnvironment({
        mode: selectedCodexBin === undefined
          ? settings.codexRuntimeMode ?? 'bundled'
          : 'external',
        runtimeRoot: this.input.codexRuntimeRoot,
        userDataDir: resolve(this.input.dataDir, '..'),
        externalCodexBin: selectedCodexBin ?? settings.externalCodexBin,
        loginShellTask,
        onDiagnostics: diagnostics => {
          resolutionDiagnostics = diagnostics;
        }
      });
    } catch (error) {
      const resolutionError = error instanceof CodexResolutionError ? error : undefined;
      this.input.logger.error('Codex Runtime resolution failed', {
        message: error instanceof Error ? error.message : String(error),
        ...(resolutionDiagnostics ?? {})
      });
      this.updateState({
        phase: 'failed',
        error: {
          code: resolutionError?.code ?? 'codex_runtime_missing',
          message: error instanceof Error ? error.message : String(error),
          ...(resolutionDiagnostics === undefined ? {} : { details: { ...resolutionDiagnostics } })
        }
      });
      return;
    }
    if (resolvedEnvironment === undefined) {
      this.input.logger.warn('Codex CLI executable was not found', {
        ...(resolutionDiagnostics ?? {
          shell: process.env.SHELL ?? '',
          pathConfigured: (process.env.PATH ?? '').length > 0
        })
      });
      this.updateState({
        phase: 'failed',
        error: {
          code: 'CODEX_NOT_FOUND',
          message: 'Codex CLI could not be located automatically. Make sure codex runs in your terminal, or select its path manually.',
          ...(resolutionDiagnostics === undefined
            ? {}
            : { details: { ...resolutionDiagnostics } })
        }
      });
      return;
    }
    this.input.logger.info('Resolved Codex CLI', {
      codexBin: resolvedEnvironment.codexBin,
      source: resolvedEnvironment.source,
      durationMs: Date.now() - resolutionStartedAt
    });
    this.resolvedEnvironment = resolvedEnvironment;
    const fingerprint = environmentFingerprint(resolvedEnvironment);
    const requireProbe = this.verifiedFingerprint !== fingerprint;
    this.updateState({
      phase: 'starting_daemon',
      codexBin: resolvedEnvironment.codexBin,
      codexHome: resolvedEnvironment.codexHome,
      error: undefined
    });
    try {
      await this.input.daemon.start(this.daemonStartInput(
        resolvedEnvironment,
        requireProbe,
        !requireProbe
      ));
      this.verifiedFingerprint = fingerprint;
      this.automaticRestarts = 0;
      if (resolvedEnvironment.source === 'external') {
        this.input.settings.update({
          codexRuntimeMode: 'external',
          externalCodexBin: resolvedEnvironment.codexBin
        });
      }
      this.updateState({ phase: 'starting_runtime', error: undefined });
      this.emit('ready');
      this.armStableTimer();
    } catch (error) {
      if (this.state.phase === 'failed') return;
      this.input.logger.error('Desktop bootstrap failed', {
        message: error instanceof Error ? error.message : String(error)
      });
      this.updateState({
        phase: 'failed',
        error: parseBootstrapError(error)
      });
    }
  }

  private async checkRuntimeHealth(connection: DaemonConnection): Promise<void> {
    const probe = this.input.probeHealth ?? probeDaemonHealth;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.stopping || this.input.daemon.currentConnection !== connection) return;
      const healthy = await probe(connection).catch(() => false);
      if (healthy) {
        this.input.logger.info('Runtime proxy failure health probe succeeded', { attempt: attempt + 1 });
        return;
      }
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 750));
    }
    if (this.stopping || this.input.daemon.currentConnection !== connection) return;
    this.input.logger.warn('Runtime health probes failed', { pid: this.input.daemon.pid });
    await this.recoverRuntime('health');
  }

  private recoverRuntime(reason: 'exit' | 'health' | 'manual'): Promise<void> {
    if (this.recoveryWork !== undefined) return this.recoveryWork;
    this.recoveryWork = this.recoverRuntimeInternal(reason).finally(() => {
      this.recoveryWork = undefined;
    });
    return this.recoveryWork;
  }

  private async recoverRuntimeInternal(reason: 'exit' | 'health' | 'manual'): Promise<void> {
    if (this.stopping) return;
    const environment = this.resolvedEnvironment;
    if (reason === 'manual') this.automaticRestarts = 0;
    const delays = this.input.automaticRestartDelays ?? [500, 1_500, 3_000];
    const controller = new AbortController();
    this.recoveryController = controller;
    if (this.stableTimer !== undefined) clearTimeout(this.stableTimer);
    let manualAttempted = false;
    while (
      environment !== undefined
      && !this.stopping
      && (reason === 'manual' ? !manualAttempted : this.automaticRestarts < delays.length)
    ) {
      const delay = reason === 'manual' ? 0 : delays[this.automaticRestarts] ?? 3_000;
      if (reason === 'manual') manualAttempted = true;
      else this.automaticRestarts += 1;
      this.updateState({ phase: 'starting_daemon', error: undefined });
      this.input.logger.info('Recovering local Runtime', { reason, attempt: this.automaticRestarts, delayMs: delay });
      if (reason !== 'manual') await waitForRecovery(delay, controller.signal);
      if (controller.signal.aborted || this.stopping) return;
      try {
        if (reason !== 'exit') {
          await this.input.daemon.stop();
          if (controller.signal.aborted || this.stopping) return;
        }
        await this.input.daemon.start(this.daemonStartInput(environment, false, true));
        if (controller.signal.aborted || this.stopping) {
          await this.input.daemon.stop();
          return;
        }
        this.updateState({ phase: 'starting_runtime', error: undefined });
        this.emit('ready');
        this.armStableTimer();
        return;
      } catch (error) {
        if (controller.signal.aborted || this.stopping) return;
        this.input.logger.error('Local Runtime recovery failed', { message: error instanceof Error ? error.message : String(error) });
        if (reason === 'manual') {
          this.updateState({ phase: 'failed', error: parseBootstrapError(error) });
          throw error;
        }
      }
    }
    if (controller.signal.aborted || this.stopping) return;
    this.updateState({
      phase: 'failed',
      error: { code: 'DAEMON_RESTART_EXHAUSTED', message: 'Runtime recovery failed repeatedly. Restart the local Runtime from the connection notice or Settings > Diagnostics.' }
    });
  }

  private daemonStartInput(
    environment: ResolvedCodexEnvironment,
    requireProbe: boolean,
    probeVerified: boolean
  ): DaemonStartInput {
    return {
      entryPath: this.input.daemonEntryPath,
      cwd: environment.defaultCwd,
      env: environment.env,
      appHome: this.input.appHome,
      codexBin: environment.codexBin,
      codexHome: environment.codexHome,
      codexVersion: environment.version,
      codexCommit: environment.commit,
      dataDir: this.input.dataDir,
      creatorRuntimeRoot: this.input.creatorRuntimeRoot,
      creatorPresetAssetsRoot: this.input.creatorPresetAssetsRoot,
      stickmanRuntimeRoot: this.input.stickmanRuntimeRoot,
      codexRuntimeRoot: this.input.codexRuntimeRoot,
      codexRuntimeMode: environment.source,
      defaultCwd: environment.defaultCwd,
      defaultProjectRoot: this.input.defaultProjectRoot,
      requireProbe,
      probeVerified
    };
  }

  private updateState(patch: Partial<DesktopBootstrapState>): void {
    this.state = {
      ...this.state,
      ...patch,
      revision: this.state.revision + 1,
      updatedAt: new Date().toISOString()
    };
    this.emit('state', this.currentState);
  }

  private armStableTimer(): void {
    if (this.stableTimer !== undefined) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.automaticRestarts = 0;
    }, 5 * 60 * 1_000);
    this.stableTimer.unref();
  }
}

async function probeDaemonHealth(connection: DaemonConnection): Promise<boolean> {
  try {
    const response = await fetchDesktopRequest(`${connection.address}/healthz`, {
      signal: AbortSignal.timeout(1_500),
      cache: 'no-store'
    });
    if (!response.ok) return false;
    const payload: unknown = await response.json();
    return typeof payload === 'object'
      && payload !== null
      && 'ok' in payload
      && payload.ok === true;
  } catch {
    return false;
  }
}

function waitForRecovery(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function isWorkspaceError(
  error: unknown
): error is Error & { code: string } {
  return error instanceof Error
    && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string';
}

function initialState(): DesktopBootstrapState {
  const now = new Date().toISOString();
  return {
    phase: 'idle',
    startedAt: now,
    updatedAt: now,
    attempt: 0,
    revision: 0
  };
}

function environmentFingerprint(environment: ResolvedCodexEnvironment): string {
  return createHash('sha256')
    .update(environment.codexBin)
    .update('\0')
    .update(environment.codexHome)
    .update('\0')
    .update(environment.env.PATH ?? '')
    .digest('hex');
}

function parseBootstrapError(error: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof DaemonStartError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'DAEMON_START_FAILED',
    message
  };
}
