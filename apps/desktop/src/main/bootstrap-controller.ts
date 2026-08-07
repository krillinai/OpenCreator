import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  DesktopBootstrapState,
  DesktopConnectionConfig
} from '../shared/types.js';
import {
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

  constructor(private readonly input: {
    daemon: DaemonManager;
    settings: SettingsStore;
    logger: DesktopLogger;
    daemonEntryPath: string;
    dataDir: string;
    defaultProjectRoot: string;
    development: boolean;
    enterpriseConfigPath: string;
    enterpriseE2ERunId?: string;
  }) {
    super();
    input.daemon.on('bootstrap', event => {
      if (event.type === 'clawee_daemon_bootstrap_error') {
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
      if (event.reason !== 'unexpected' || this.state.phase === 'failed') return;
      void this.recoverUnexpectedExit();
    });
  }

  get currentState(): DesktopBootstrapState {
    return structuredClone(this.state);
  }

  rendererConnection(): DesktopConnectionConfig | null {
    const connection = this.input.daemon.currentConnection;
    if (connection === undefined) return null;
    return { baseUrl: '/.clawee/runtime' };
  }

  start(
    selectedCodexBin?: string,
    loginShellTask?: LoginShellEnvironmentTask
  ): Promise<void> {
    if (this.runWork !== undefined) return this.runWork;
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
          message: '请选择 ChatGPT.app、Codex.app，或可执行的 codex 文件'
        }
      });
      return;
    }
    this.input.settings.update({ codexBin: validated });
    await this.input.daemon.stop();
    await this.start(validated);
  }

  async restartRuntime(): Promise<void> {
    if (this.resolvedEnvironment === undefined) {
      await this.start();
      return;
    }
    await this.input.daemon.restart(this.daemonStartInput(
      this.resolvedEnvironment,
      false,
      true
    ));
    this.updateState({ phase: 'starting_runtime', error: undefined });
    this.emit('ready');
  }

  markMigratingData(): void {
    this.updateState({ phase: 'migrating_data', error: undefined });
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
    if (this.stableTimer !== undefined) clearTimeout(this.stableTimer);
    await this.input.daemon.stop();
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
      startupMetrics: this.state.startupMetrics
    };
    this.emit('state', this.currentState);
    const settings = this.input.settings.read();
    let resolutionDiagnostics: CodexResolutionDiagnostics | undefined;
    const resolvedEnvironment = await resolveCodexEnvironment({
      selectedCodexBin,
      successfulCodexBin: settings.successfulCodexBin,
      savedCodexBin: settings.codexBin,
      loginShellTask,
      onDiagnostics: diagnostics => {
        resolutionDiagnostics = diagnostics;
      }
    });
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
          message: '未能自动找到 Codex CLI。请确认终端中可以运行 codex，或手动选择 Codex 路径',
          ...(resolutionDiagnostics === undefined
            ? {}
            : { details: { ...resolutionDiagnostics } })
        }
      });
      return;
    }
    this.input.logger.info('Resolved Codex CLI', {
      codexBin: resolvedEnvironment.codexBin,
      source: resolvedEnvironment.source
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
      this.input.settings.update({
        codexBin: resolvedEnvironment.codexBin,
        successfulCodexBin: resolvedEnvironment.codexBin
      });
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

  private async recoverUnexpectedExit(): Promise<void> {
    const environment = this.resolvedEnvironment;
    if (environment === undefined || this.automaticRestarts >= 1) {
      this.updateState({
        phase: 'failed',
        error: {
          code: 'DAEMON_RESTART_EXHAUSTED',
          message: '本地运行服务连续退出，请导出诊断后重新检测'
        }
      });
      return;
    }
    this.automaticRestarts += 1;
    this.updateState({
      phase: 'starting_daemon',
      error: undefined
    });
    try {
      await this.input.daemon.start(this.daemonStartInput(environment, false, true));
      this.updateState({ phase: 'starting_runtime' });
      this.emit('ready');
      this.armStableTimer();
    } catch (error) {
      this.updateState({
        phase: 'failed',
        error: parseBootstrapError(error)
      });
    }
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
      codexBin: environment.codexBin,
      codexHome: environment.codexHome,
      dataDir: this.input.dataDir,
      defaultCwd: environment.defaultCwd,
      defaultProjectRoot: this.input.defaultProjectRoot,
      requireProbe,
      probeVerified,
      enterpriseConfigPath: this.input.enterpriseConfigPath,
      ...(this.input.enterpriseE2ERunId === undefined
        ? {}
        : { enterpriseE2ERunId: this.input.enterpriseE2ERunId })
    };
  }

  private updateState(patch: Partial<DesktopBootstrapState>): void {
    this.state = {
      ...this.state,
      ...patch,
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
    attempt: 0
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
} {
  if (error instanceof DaemonStartError) {
    return {
      code: error.code,
      message: error.message
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'DAEMON_START_FAILED',
    message
  };
}
