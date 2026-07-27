import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { desktopIpc } from '../shared/ipc.js';
import type {
  DesktopApi,
  DesktopBootstrapState,
  DesktopConnectionConfig
} from '../shared/types.js';

const api: DesktopApi = {
  kind: 'desktop',
  readConnectionConfig: () => ipcRenderer.invoke(desktopIpc.readConnection),
  subscribeConnectionConfig(listener) {
    return subscribe(desktopIpc.connectionChanged, listener);
  },
  readBootstrapState: () => ipcRenderer.invoke(desktopIpc.readBootstrap),
  subscribeBootstrapState(listener) {
    return subscribe(desktopIpc.bootstrapChanged, listener);
  },
  retryBootstrap: () => ipcRenderer.invoke(desktopIpc.bootstrapRetry),
  selectCodexPath: () => ipcRenderer.invoke(desktopIpc.selectCodex),
  selectProjectDirectory: () => ipcRenderer.invoke(desktopIpc.selectProjectDirectory),
  resolveDroppedFilePath: file => {
    const path = webUtils.getPathForFile(file);
    return path.length > 0 ? path : null;
  },
  restartRuntime: () => ipcRenderer.invoke(desktopIpc.restartRuntime),
  reloadWorkspace: () => ipcRenderer.invoke(desktopIpc.reloadWorkspace),
  workspaceReady: () => ipcRenderer.send(desktopIpc.workspaceReady),
  readDesktopPreferences: () => ipcRenderer.invoke(desktopIpc.readPreferences),
  updateDesktopPreferences: preferences =>
    ipcRenderer.invoke(desktopIpc.updatePreferences, preferences),
  openExternal: url => ipcRenderer.invoke(desktopIpc.openExternal, url),
  revealPath: path => ipcRenderer.invoke(desktopIpc.revealPath, path),
  notify: message => ipcRenderer.invoke(desktopIpc.notify, message),
  configureBackgroundNotifications: configuration =>
    ipcRenderer.invoke(desktopIpc.configureNotifications, configuration),
  subscribeNavigation(listener) {
    return subscribe(desktopIpc.navigate, listener);
  },
  exportDiagnostics: () => ipcRenderer.invoke(desktopIpc.exportDiagnostics),
  quit: () => ipcRenderer.invoke(desktopIpc.quit)
};

contextBridge.exposeInMainWorld('claweeDesktop', api);

function subscribe<T>(
  channel: string,
  listener: (value: T) => void
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: unknown) => {
    listener(value as T);
  };
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

type _ConnectionTypecheck = DesktopConnectionConfig;
type _BootstrapTypecheck = DesktopBootstrapState;
