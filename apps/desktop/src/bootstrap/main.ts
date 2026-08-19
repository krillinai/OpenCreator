type BootstrapState = {
  phase:
    | 'idle'
    | 'migrating_data'
    | 'resolving_codex'
    | 'starting_daemon'
    | 'probing_codex'
    | 'starting_runtime'
    | 'ready'
    | 'workspace_failed'
    | 'failed';
  startedAt: string;
  codexBin?: string;
  codexHome?: string;
  error?: { code: string; message: string };
};

type BootstrapApi = {
  windowChrome?: {
    integratedTitleBar: boolean;
    titleBarHeight?: number;
    trafficLightInset?: number;
  };
  readBootstrapState(): Promise<BootstrapState>;
  subscribeBootstrapState(listener: (state: BootstrapState) => void): () => void;
  retryBootstrap(): Promise<unknown>;
  selectCodexPath(): Promise<unknown>;
  reloadWorkspace(): Promise<unknown>;
  restartRuntime(): Promise<unknown>;
  exportDiagnostics(): Promise<unknown>;
  quit(): Promise<void>;
};

declare global {
  interface Window {
    opencreatorDesktop?: BootstrapApi;
  }
}

const api = window.opencreatorDesktop;
if (api === undefined) throw new Error('OpenCreator Desktop bridge is unavailable');
if (
  api.windowChrome?.integratedTitleBar === true
  && typeof api.windowChrome.titleBarHeight === 'number'
  && typeof api.windowChrome.trafficLightInset === 'number'
) {
  document.documentElement.dataset.integratedTitleBar = 'true';
  document.documentElement.style.setProperty(
    '--opencreator-titlebar-height',
    `${api.windowChrome.titleBarHeight}px`
  );
  document.documentElement.style.setProperty(
    '--opencreator-traffic-light-inset',
    `${api.windowChrome.trafficLightInset}px`
  );
}

const title = element('status-title');
const detail = element('status-detail');
const elapsed = element('elapsed');
const statusMark = element('status-mark');
const actions = element('failure-actions');
const workspaceActions = element('workspace-actions');
const technicalDetails = element('technical-details');
const codexPath = element('codex-path');
const codexHome = element('codex-home');
const errorCode = element('error-code');
const errorMessage = element('error-message');
let currentState: BootstrapState | undefined;

const labels: Record<BootstrapState['phase'], [string, string]> = {
  idle: ['正在准备 OpenCreator', '正在初始化桌面环境'],
  migrating_data: ['正在迁移本地数据', '正在校验并复制现有 OpenCreator Runtime 数据'],
  resolving_codex: ['正在查找本机 Codex', '正在读取终端环境和已保存路径'],
  starting_daemon: ['正在启动本地运行服务', '正在创建独立的 OpenCreator Runtime'],
  probing_codex: ['正在验证 Codex 是否可用', '正在检查本机 Codex 进程'],
  starting_runtime: ['正在打开 OpenCreator', '正在加载本地数据和 Codex 能力信息'],
  ready: ['正在打开 OpenCreator', '本地运行环境已就绪'],
  workspace_failed: ['Dashboard 加载失败', '本地 Runtime 仍在运行，可以直接重载 Dashboard 或重启 Runtime'],
  failed: ['Codex CLI 暂时无法完成调用', 'OpenCreator 没有收到有效响应，请检查诊断后重试']
};

void api.readBootstrapState().then(render);
api.subscribeBootstrapState(render);

element('retry').addEventListener('click', () => void api.retryBootstrap());
element('select-codex').addEventListener('click', () => void api.selectCodexPath());
element('diagnostics').addEventListener('click', () => void api.exportDiagnostics());
element('quit').addEventListener('click', () => void api.quit());
element('reload-workspace').addEventListener('click', () => void api.reloadWorkspace());
element('restart-runtime').addEventListener('click', () => void api.restartRuntime());
element('workspace-diagnostics').addEventListener('click', () => void api.exportDiagnostics());
element('workspace-quit').addEventListener('click', () => void api.quit());

window.setInterval(() => {
  if (
    currentState === undefined
    || currentState.phase === 'ready'
    || currentState.phase === 'failed'
    || currentState.phase === 'workspace_failed'
  ) {
    elapsed.hidden = true;
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(currentState.startedAt)) / 1000));
  elapsed.hidden = seconds < 3;
  elapsed.textContent = `已等待 ${seconds} 秒`;
}, 500);

function render(state: BootstrapState): void {
  currentState = state;
  const [nextTitle, nextDetail] = state.phase === 'failed'
    ? failureLabel(state)
    : labels[state.phase];
  title.textContent = nextTitle;
  detail.textContent = nextDetail;
  const failed = state.phase === 'failed';
  const workspaceFailed = state.phase === 'workspace_failed';
  statusMark.dataset.failed = failed || workspaceFailed ? 'true' : 'false';
  actions.hidden = !failed;
  workspaceActions.hidden = !workspaceFailed;
  technicalDetails.hidden = !failed && !workspaceFailed;
  codexPath.textContent = state.codexBin ?? '-';
  codexHome.textContent = state.codexHome ?? '-';
  errorCode.textContent = state.error?.code ?? '-';
  errorMessage.textContent = state.error?.message ?? '';
}

function failureLabel(state: BootstrapState): [string, string] {
  if (state.error?.code === 'CODEX_NOT_FOUND') {
    return [
      '未找到本机 Codex CLI',
      '请确认终端中可以运行 codex，或直接选择 ChatGPT/Codex 应用'
    ];
  }
  if (state.error?.code === 'CODEX_PATH_INVALID') {
    return ['所选 Codex 路径不可用', state.error.message];
  }
  return labels.failed;
}

function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing bootstrap element: ${id}`);
  return value;
}

export {};
