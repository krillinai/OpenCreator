import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAppLanguage,
  defaultLanguagePreference,
  languagePreferenceStorageKey,
  readLanguagePreference,
  resolveAppLanguage,
  resolveSystemLanguage,
  writeLanguagePreference
} from './language.js';

describe('display language preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
    delete document.documentElement.dataset.locale;
  });

  it('follows Chinese system locales and uses English for other system locales', () => {
    expect(resolveSystemLanguage(['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveSystemLanguage(['en-GB', 'fr-FR'])).toBe('en-US');
    expect(resolveAppLanguage('system', ['zh-TW'])).toBe('zh-CN');
  });

  it('defaults to the system and ignores invalid stored values', () => {
    expect(readLanguagePreference()).toBe(defaultLanguagePreference);

    window.localStorage.setItem(languagePreferenceStorageKey, 'fr-FR');
    expect(readLanguagePreference()).toBe('system');
  });

  it('persists explicit choices and applies the resolved document language', () => {
    writeLanguagePreference('en-US');
    const language = resolveAppLanguage(readLanguagePreference(), ['zh-CN']);
    applyAppLanguage(language);

    expect(window.localStorage.getItem(languagePreferenceStorageKey)).toBe('en-US');
    expect(document.documentElement).toHaveAttribute('lang', 'en-US');
    expect(document.documentElement).toHaveAttribute('data-locale', 'en-US');
  });
});
