import type { AppControllerProps } from './AppController.js';
import { AppProviders } from './AppProviders.js';
import { AppRouter } from './AppRouter.js';

export type AppProps = Omit<AppControllerProps, 'route' | 'onNavigate'>;

export function App(props: AppProps = {}) {
  return (
    <AppProviders>
      <AppRouter {...props} />
    </AppProviders>
  );
}
