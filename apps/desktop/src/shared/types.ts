export type DesktopBootstrapPhase =
  | 'idle'
  | 'resolving_codex'
  | 'starting_daemon'
  | 'probing_codex'
  | 'starting_runtime'
  | 'ready'
  | 'workspace_failed'
  | 'failed';

export type DesktopStartupMetrics = {
  appEntryAt: number;
  appReadyAt?: number;
  windowCreatedAt?: number;
  bootstrapDomReadyAt?: number;
  bootstrapDidFinishLoadAt?: number;
};

export type DesktopProbeTimings = {
  homePreparationMs: number;
  firstEventMs?: number;
  responseReceivedMs?: number;
  processExitMs: number;
};

export type DesktopBootstrapError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type DesktopBootstrapState = {
  phase: DesktopBootstrapPhase;
  startedAt: string;
  updatedAt: string;
  attempt: number;
  revision: number;
  codexBin?: string;
  codexHome?: string;
  durationMs?: number;
  probeTimings?: DesktopProbeTimings;
  startupMetrics?: DesktopStartupMetrics;
  error?: DesktopBootstrapError;
};

export type DesktopConnectionConfig = {
  baseUrl: string;
  token?: string;
};

export type DesktopSettings = {
  codexBin?: string;
  successfulCodexBin?: string;
  codexRuntimeMode?: 'bundled' | 'external';
  externalCodexBin?: string;
  closeBehavior: 'hide' | 'quit';
  notificationsEnabled: boolean;
  telemetryEnabled: boolean;
  telemetryInstallId?: string;
  window?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    maximized?: boolean;
  };
};

export type DesktopPreferences = {
  closeBehavior: DesktopSettings['closeBehavior'];
  telemetryEnabled: boolean;
};

export const DESKTOP_TITLE_BAR_HEIGHT = 38;
export const DESKTOP_TRAFFIC_LIGHT_INSET = 76;

export type DesktopWindowChrome =
  | {
      integratedTitleBar: false;
    }
  | {
      integratedTitleBar: true;
      titleBarHeight: number;
      trafficLightInset: number;
    };

export type DesktopWindowColorMode = 'light' | 'dark';
export type DesktopWindowAction = 'close' | 'minimize' | 'zoom';

export type DesktopHostResult =
  | { ok: true }
  | { ok: false; code: 'UNSUPPORTED' | 'FAILED'; message: string };

export type DesktopHostNotification = {
  title: string;
  body: string;
  threadId?: string;
  runId?: string;
  approvalId?: string;
};

export type DirectorySelectionPurpose = 'project' | 'default-project-root' | 'output-root';

export type DesktopApi = {
  kind: 'desktop';
  windowChrome?: DesktopWindowChrome;
  readAppVersion(): Promise<string>;
  readConnectionConfig(): Promise<DesktopConnectionConfig | null>;
  subscribeConnectionConfig(
    listener: (connection: DesktopConnectionConfig | null) => void
  ): () => void;
  readBootstrapState(): Promise<DesktopBootstrapState>;
  subscribeBootstrapState(listener: (state: DesktopBootstrapState) => void): () => void;
  retryBootstrap(): Promise<DesktopHostResult>;
  selectCodexPath(): Promise<DesktopHostResult>;
  selectProjectDirectory(purpose?: DirectorySelectionPurpose): Promise<string | null>;
  resolveDroppedFilePath(file: File): string | null;
  restartRuntime(): Promise<DesktopHostResult>;
  reloadWorkspace(): Promise<DesktopHostResult>;
  workspaceReady(): void;
  readDesktopPreferences(): Promise<DesktopPreferences>;
  updateDesktopPreferences(
    preferences: Partial<DesktopPreferences>
  ): Promise<DesktopPreferences>;
  setWindowColorMode?(mode: DesktopWindowColorMode): Promise<void>;
  controlWindow?(action: DesktopWindowAction): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<DesktopHostResult>;
  notify(message: DesktopHostNotification): Promise<void>;
  configureBackgroundNotifications(configuration: { enabled: boolean }): Promise<DesktopHostResult>;
  subscribeNavigation(listener: (route: string) => void): () => void;
  exportDiagnostics(): Promise<DesktopHostResult>;
  quit(): Promise<void>;
};

export type DaemonConnection = {
  address: string;
  token: string;
};

export type DaemonBootstrapEvent =
  | {
      type: 'opencreator_daemon_bootstrap';
      phase: 'probing_codex' | 'probe_succeeded' | 'starting_runtime';
      at: string;
      durationMs?: number;
      responseReceived?: boolean;
      markerMatched?: boolean;
      probeTimings?: DesktopProbeTimings;
    }
  | {
      type: 'opencreator_daemon_bootstrap_error';
      code: string;
      message: string;
      at?: string;
      durationMs?: number;
      details?: Record<string, unknown>;
    };
