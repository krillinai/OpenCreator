import type { PropsWithChildren } from 'react';
import { HashRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '../components/dialogs/ConfirmDialogProvider.js';
import { LanguageProvider } from '../i18n/LanguageProvider.js';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <LanguageProvider>
      <ConfirmDialogProvider>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          {children}
        </HashRouter>
      </ConfirmDialogProvider>
    </LanguageProvider>
  );
}
