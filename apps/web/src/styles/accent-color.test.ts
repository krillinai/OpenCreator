import { beforeEach, describe, expect, it } from 'vitest';
import {
  accentColorStorageKey,
  applyAccentColor,
  customAccentColorStorageKey,
  defaultAccentColor,
  defaultCustomAccentColor,
  normalizeHexColor,
  readAccentColorPreference,
  readCustomAccentColorPreference,
  writeCustomAccentColorPreference,
  writeAccentColorPreference
} from './accent-color.js';

describe('accent color preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.accent;
    document.documentElement.style.removeProperty('--custom-accent-value');
    document.documentElement.style.removeProperty('--custom-on-accent');
  });

  it('defaults to neutral and ignores invalid stored values', () => {
    expect(readAccentColorPreference()).toBe(defaultAccentColor);

    window.localStorage.setItem(accentColorStorageKey, 'green');
    expect(readAccentColorPreference()).toBe('neutral');
  });

  it('persists and applies a supported accent color', () => {
    writeAccentColorPreference('purple');
    applyAccentColor(readAccentColorPreference());

    expect(window.localStorage.getItem(accentColorStorageKey)).toBe('purple');
    expect(document.documentElement).toHaveAttribute('data-accent', 'purple');
  });

  it('normalizes, persists, and applies a custom accent color', () => {
    expect(normalizeHexColor(' 09f ')).toBe('#0099ff');
    expect(normalizeHexColor('#12abEF')).toBe('#12abef');
    expect(normalizeHexColor('tomato')).toBeUndefined();

    writeAccentColorPreference('custom');
    writeCustomAccentColorPreference('#f5a');
    applyAccentColor(
      readAccentColorPreference(),
      readCustomAccentColorPreference()
    );

    expect(window.localStorage.getItem(accentColorStorageKey)).toBe('custom');
    expect(window.localStorage.getItem(customAccentColorStorageKey)).toBe('#ff55aa');
    expect(document.documentElement).toHaveAttribute('data-accent', 'custom');
    expect(document.documentElement).toHaveStyle({
      '--custom-accent-value': '#ff55aa'
    });
    expect(document.documentElement.style.getPropertyValue('--custom-on-accent')).not.toBe('');
  });

  it('uses the default custom color when the stored value is invalid', () => {
    window.localStorage.setItem(customAccentColorStorageKey, '#nope');
    expect(readCustomAccentColorPreference()).toBe(defaultCustomAccentColor);
  });
});
