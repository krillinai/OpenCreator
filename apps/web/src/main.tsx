import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { applyColorMode, readColorModePreference } from './styles/color-mode.js';
import './styles/app.css';

applyColorMode(readColorModePreference());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
