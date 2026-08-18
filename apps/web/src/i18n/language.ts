export type AppLanguagePreference = 'system' | 'zh-CN' | 'en-US';
export type AppLanguage = Exclude<AppLanguagePreference, 'system'>;

export const languagePreferenceStorageKey = 'opencreator.preferences.language';
export const defaultLanguagePreference: AppLanguagePreference = 'system';

export function readLanguagePreference(): AppLanguagePreference {
  try {
    const value = window.localStorage.getItem(languagePreferenceStorageKey);
    return isLanguagePreference(value) ? value : defaultLanguagePreference;
  } catch {
    return defaultLanguagePreference;
  }
}

export function writeLanguagePreference(preference: AppLanguagePreference): void {
  try {
    window.localStorage.setItem(languagePreferenceStorageKey, preference);
  } catch {
    return;
  }
}

export function resolveSystemLanguage(languages?: readonly string[]): AppLanguage {
  const candidates = languages ?? readBrowserLanguages();
  return candidates.some(language => language.toLocaleLowerCase().startsWith('zh'))
    ? 'zh-CN'
    : 'en-US';
}

export function resolveAppLanguage(
  preference: AppLanguagePreference,
  languages?: readonly string[]
): AppLanguage {
  return preference === 'system' ? resolveSystemLanguage(languages) : preference;
}

export function applyAppLanguage(language: AppLanguage): void {
  document.documentElement.lang = language;
  document.documentElement.dataset.locale = language;
}

function readBrowserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return ['en-US'];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : ['en-US'];
}

function isLanguagePreference(value: string | null): value is AppLanguagePreference {
  return value === 'system' || value === 'zh-CN' || value === 'en-US';
}
