import { beforeEach, describe, expect, it } from 'vitest';
import { openCreatorLanguages } from '@opencreator/protocol';
import {
  applyAppLanguage,
  appLanguageOptions,
  defaultLanguagePreference,
  languagePreferenceStorageKey,
  readLanguagePreference,
  resolveAppLanguage,
  resolveSystemLanguage,
  writeLanguagePreference
} from './language.js';

describe('display language preference', () => {
  it('offers every supported language exactly once', () => {
    expect(appLanguageOptions.map(option => option.value).sort()).toEqual([...openCreatorLanguages].sort());
  });

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
    delete document.documentElement.dataset.locale;
  });

  it('follows Chinese system locales and uses English for other system locales', () => {
    expect(resolveSystemLanguage(['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveSystemLanguage(['zh-SG'])).toBe('zh-CN');
    expect(resolveSystemLanguage(['zh'])).toBe('zh-CN');
    expect(resolveSystemLanguage(['en-GB', 'fr-FR'])).toBe('en-US');
  });

  it('uses Traditional Chinese for Hant scripts and Taiwan, Hong Kong and Macau', () => {
    expect(resolveAppLanguage('system', ['zh-TW'])).toBe('zh-TW');
    expect(resolveSystemLanguage(['zh-HK'])).toBe('zh-TW');
    expect(resolveSystemLanguage(['zh-MO'])).toBe('zh-TW');
    expect(resolveSystemLanguage(['zh-Hant'])).toBe('zh-TW');
    expect(resolveSystemLanguage(['zh_Hant_HK'])).toBe('zh-TW');
    expect(resolveSystemLanguage(['zh-Hans-HK'])).toBe('zh-CN');
  });

  it('uses the Malay catalog and recognizes Norwegian Bokmål aliases', () => {
    expect(resolveSystemLanguage(['ms-MY'])).toBe('ms-MY');
    expect(resolveSystemLanguage(['ms-SG'])).toBe('ms-MY');
    expect(resolveSystemLanguage(['no-NO'])).toBe('nb-NO');
    expect(resolveSystemLanguage(['nb-NO'])).toBe('nb-NO');
    expect(resolveSystemLanguage(['no_NO'])).toBe('nb-NO');
  });

  it('maps Tagalog and regional variants to the closest supported language', () => {
    expect(resolveSystemLanguage(['tl-PH'])).toBe('fil-PH');
    expect(resolveSystemLanguage(['fil'])).toBe('fil-PH');
    expect(resolveSystemLanguage(['bn-IN'])).toBe('bn-BD');
    expect(resolveSystemLanguage(['nl-BE'])).toBe('nl-NL');
  });

  it('recognizes the new South Asian and European system locales', () => {
    expect(resolveSystemLanguage(['ta-LK'])).toBe('ta-IN');
    expect(resolveSystemLanguage(['te'])).toBe('te-IN');
    expect(resolveSystemLanguage(['bg'])).toBe('bg-BG');
    expect(resolveSystemLanguage(['sk'])).toBe('sk-SK');
    expect(resolveSystemLanguage(['hr-BA'])).toBe('hr-HR');
    expect(resolveSystemLanguage(['sr-Cyrl-RS'])).toBe('sr-RS');
  });

  it('respects browser language preference order', () => {
    expect(resolveSystemLanguage(['en-US', 'sv-SE'])).toBe('en-US');
    expect(resolveSystemLanguage(['sv-SE', 'zh-CN'])).toBe('sv-SE');
  });

  it('recognizes Middle Eastern and South Asian regional locales', () => {
    for (const [system, expected] of [
      ['ar-EG', 'ar-SA'], ['fa', 'fa-IR'], ['ur-IN', 'ur-PK'], ['he', 'he-IL'],
      ['iw-IL', 'he-IL'], ['mr', 'mr-IN'], ['gu', 'gu-IN'], ['pa-Guru-IN', 'pa-IN']
    ]) expect(resolveSystemLanguage([system!])).toBe(expected);
    expect(resolveSystemLanguage(['pa-Arab-PK', 'en-US'])).toBe('en-US');
  });

  it('switches direction with the display language and resets it when leaving RTL', () => {
    for (const language of ['ar-SA', 'fa-IR', 'ur-PK', 'he-IL'] as const) {
      applyAppLanguage(language);
      expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    }
    for (const language of ['en-US', 'zh-CN', 'mr-IN', 'gu-IN', 'pa-IN'] as const) {
      applyAppLanguage(language);
      expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    }
  });

  it('defaults to English and ignores invalid stored values', () => {
    expect(readLanguagePreference()).toBe(defaultLanguagePreference);
    expect(resolveAppLanguage(readLanguagePreference(), ['zh-CN'])).toBe('en-US');

    window.localStorage.setItem(languagePreferenceStorageKey, 'xx-XX');
    expect(readLanguagePreference()).toBe('en-US');
  });

  it('keeps an existing system preference working on Chinese systems', () => {
    writeLanguagePreference('system');
    expect(resolveAppLanguage(readLanguagePreference(), ['zh-CN'])).toBe('zh-CN');
  });

  it('persists explicit choices and applies the resolved document language', () => {
    writeLanguagePreference('en-US');
    const language = resolveAppLanguage(readLanguagePreference(), ['zh-CN']);
    applyAppLanguage(language);

    expect(window.localStorage.getItem(languagePreferenceStorageKey)).toBe('en-US');
    expect(document.documentElement).toHaveAttribute('lang', 'en-US');
    expect(document.documentElement).toHaveAttribute('data-locale', 'en-US');
  });

  it.each(openCreatorLanguages)('resolves and persists %s', language => {
    writeLanguagePreference(language);
    expect(readLanguagePreference()).toBe(language);
    expect(resolveSystemLanguage([language])).toBe(language);
    expect(resolveAppLanguage(language, ['en-US'])).toBe(language);
  });

  it('matches regional variants and skips unsupported languages', () => {
    expect(resolveSystemLanguage(['xx-XX', 'pt-PT', 'fr-FR'])).toBe('pt-BR');
    expect(resolveSystemLanguage(['fr-CA', 'en-US'])).toBe('fr-FR');
    expect(resolveSystemLanguage(['xx-XX'])).toBe('en-US');
  });
});
