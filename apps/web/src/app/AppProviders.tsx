import type { PropsWithChildren } from 'react';
import { HashRouter } from 'react-router-dom';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {children}
    </HashRouter>
  );
}
