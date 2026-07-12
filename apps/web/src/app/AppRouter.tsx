import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppProps } from './App.js';
import { AppController } from './AppController.js';
import { formatRoute, parseRoute, type AppRoute } from './routes.js';

export function AppRouter(props: AppProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(
    () => parseRoute(`#${location.pathname}${location.search}`),
    [location.pathname, location.search]
  );
  const handleNavigate = useCallback((
    nextRoute: AppRoute,
    options?: { replace?: boolean }
  ) => {
    navigate(formatRoute(nextRoute).slice(1), { replace: options?.replace });
  }, [navigate]);

  return <AppController {...props} route={route} onNavigate={handleNavigate} />;
}
