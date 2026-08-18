import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useAppLanguage } from './LanguageProvider.js';

describe('LanguageProvider', () => {
  afterEach(() => {
    setNavigatorLanguages(['zh-CN']);
  });

  it('updates the display language when the system language changes', () => {
    setNavigatorLanguages(['zh-CN']);
    render(
      <LanguageProvider initialPreference="system">
        <LanguageProbe />
      </LanguageProvider>
    );

    expect(screen.getByText('zh-CN')).toBeInTheDocument();

    setNavigatorLanguages(['en-US']);
    act(() => window.dispatchEvent(new Event('languagechange')));

    expect(screen.getByText('en-US')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en-US');
  });
});

function LanguageProbe() {
  const { language } = useAppLanguage();
  return <span>{language}</span>;
}

function setNavigatorLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: languages[0] ?? 'en-US'
  });
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: languages
  });
}
