import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { applyColorMode, readColorModePreference } from './styles/color-mode.js';
import { installAutoHidingScrollbars } from './styles/scrollbar-visibility.js';
import { installWindowResizeStability } from './styles/window-resize-stability.js';
import './styles/app.css';

applyColorMode(readColorModePreference());
installAutoHidingScrollbars();
installWindowResizeStability();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
