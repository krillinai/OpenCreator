import base from './playwright.config.js';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...base,
  testMatch: 'real-codex.smoke.ts',
  outputDir: '../../test-results/desktop-real-codex-playwright',
  reporter: [['line']],
  timeout: 120_000
});
