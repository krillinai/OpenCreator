import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyColorMode,
  colorModeStorageKey,
  defaultColorMode,
  readColorModePreference,
  writeColorModePreference,
} from './color-mode.js';

describe('color mode preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('defaults to dark and ignores invalid stored values', () => {
    expect(readColorModePreference()).toBe(defaultColorMode);

    window.localStorage.setItem(colorModeStorageKey, 'sepia');
    expect(readColorModePreference()).toBe('dark');
  });

  it('persists and applies either supported mode', () => {
    writeColorModePreference('light');
    applyColorMode(readColorModePreference());

    expect(window.localStorage.getItem(colorModeStorageKey)).toBe('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    writeColorModePreference('dark');
    applyColorMode(readColorModePreference());
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
