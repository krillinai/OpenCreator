import { useCallback } from 'react';
import { useAppLanguage } from './LanguageProvider.js';

export type LocalizeCopy = (chinese: string, english: string) => string;

export function useLocalizedCopy(): LocalizeCopy {
  const { language } = useAppLanguage();
  return useCallback(
    (chinese: string, english: string) => language === 'en-US' ? english : chinese,
    [language]
  );
}
