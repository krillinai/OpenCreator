import {
  StrictMode,
  useEffect
} from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import {
  readDesktopHostBridge,
  signalDesktopWorkspaceReady,
  subscribeDesktopNavigation
} from './host/desktop-bridge.js';
import {
  applyAccentColor,
  readAccentColorPreference,
  readCustomAccentColorPreference
} from './styles/accent-color.js';
import { applyColorMode, readColorModePreference } from './styles/color-mode.js';
import {
  applyAppLanguage,
  readLanguagePreference,
  resolveAppLanguage
} from './i18n/language.js';
import { installAutoHidingScrollbars } from './styles/scrollbar-visibility.js';
import { installWindowResizeStability } from './styles/window-resize-stability.js';
import './styles/app.css';

const desktopHostBridge = readDesktopHostBridge();

applyColorMode(readColorModePreference());
applyAppLanguage(resolveAppLanguage(readLanguagePreference()));
applyAccentColor(
  readAccentColorPreference(),
  readCustomAccentColorPreference()
);
installAutoHidingScrollbars();
installWindowResizeStability();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <App {...(desktopHostBridge === undefined ? {} : { hostBridge: desktopHostBridge })} />
      {desktopHostBridge === undefined ? null : <WorkspaceReadySignal />}
    </>
  </StrictMode>
);

if (desktopHostBridge !== undefined) {
  subscribeDesktopNavigation(route => {
    if (route.startsWith('#/')) window.location.hash = route;
  });
}

function WorkspaceReadySignal() {
  useEffect(() => {
    signalDesktopWorkspaceReady();
  }, []);
  return null;
}
