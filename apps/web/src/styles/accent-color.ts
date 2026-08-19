export const accentColors = [
  'neutral',
  'blue',
  'cyan',
  'purple',
  'orange',
  'red',
  'custom'
] as const;

export type AccentColor = typeof accentColors[number];

export const accentColorStorageKey = 'opencreator.preferences.accentColor';
export const customAccentColorStorageKey = 'opencreator.preferences.customAccentColor';
export const defaultAccentColor: AccentColor = 'neutral';
export const defaultCustomAccentColor = '#3b82f6';

export function readAccentColorPreference(): AccentColor {
  try {
    const value = window.localStorage.getItem(accentColorStorageKey);
    return accentColors.includes(value as AccentColor)
      ? value as AccentColor
      : defaultAccentColor;
  } catch {
    return defaultAccentColor;
  }
}

export function writeAccentColorPreference(color: AccentColor): void {
  try {
    window.localStorage.setItem(accentColorStorageKey, color);
  } catch {
    return;
  }
}

export function readCustomAccentColorPreference(): string {
  try {
    return normalizeHexColor(window.localStorage.getItem(customAccentColorStorageKey) ?? '')
      ?? defaultCustomAccentColor;
  } catch {
    return defaultCustomAccentColor;
  }
}

export function writeCustomAccentColorPreference(color: string): void {
  const normalized = normalizeHexColor(color);
  if (normalized === undefined) return;
  try {
    window.localStorage.setItem(customAccentColorStorageKey, normalized);
  } catch {
    return;
  }
}

export function applyAccentColor(
  color: AccentColor,
  customColor = defaultCustomAccentColor
): void {
  const normalizedCustomColor = normalizeHexColor(customColor) ?? defaultCustomAccentColor;
  document.documentElement.dataset.accent = color;
  document.documentElement.style.setProperty('--custom-accent-value', normalizedCustomColor);
  document.documentElement.style.setProperty(
    '--custom-on-accent',
    contrastColor(normalizedCustomColor)
  );
}

export function normalizeHexColor(value: string): string | undefined {
  const match = value.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
  if (match === null) return undefined;
  const hex = match[1]!.toLowerCase();
  return hex.length === 3
    ? `#${hex.split('').map(channel => channel.repeat(2)).join('')}`
    : `#${hex}`;
}

function contrastColor(color: string): '#111113' | '#f8fafc' {
  const channels = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
  const luminance = channels
    .map(channel => channel / 255)
    .map(channel => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) =>
      total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const darkContrast = (luminance + 0.05) / 0.055;
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? '#111113' : '#f8fafc';
}
