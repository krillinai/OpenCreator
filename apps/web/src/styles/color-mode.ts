export type ColorMode = 'light' | 'dark';

export const colorModeStorageKey = 'opencreator.preferences.colorMode';
export const defaultColorMode: ColorMode = 'dark';

export function readColorModePreference(): ColorMode {
  try {
    const value = window.localStorage.getItem(colorModeStorageKey);
    return value === 'light' || value === 'dark' ? value : defaultColorMode;
  } catch {
    return defaultColorMode;
  }
}

export function writeColorModePreference(mode: ColorMode): void {
  try {
    window.localStorage.setItem(colorModeStorageKey, mode);
  } catch {
    return;
  }
}

export function applyColorMode(mode: ColorMode): void {
  document.documentElement.dataset.theme = mode;
}
