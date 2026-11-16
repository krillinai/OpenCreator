import { afterEach, expect, it, vi } from 'vitest';
import { readDesktopHostBridge, subscribeDesktopNavigation } from './desktop-bridge.js';

afterEach(() => vi.unstubAllGlobals());

it('keeps the current desktop workspace when authorization returns', () => {
  let navigate: (route: string) => void = () => undefined;
  vi.stubGlobal('opencreatorDesktop', {
    kind: 'desktop',
    subscribeNavigation: vi.fn(listener => {
      navigate = listener;
      return () => undefined;
    })
  });
  const onAuthorizationReturn = vi.fn();
  const onNavigate = vi.fn();
  const unsubscribeAuthorization = readDesktopHostBridge()!.subscribeAuthorizationReturn!(onAuthorizationReturn);
  const unsubscribeNavigation = subscribeDesktopNavigation(onNavigate);

  navigate('#/account?login=complete');
  expect(onAuthorizationReturn).toHaveBeenCalledOnce();
  expect(onNavigate).not.toHaveBeenCalled();

  navigate('#/projects');
  expect(onNavigate).toHaveBeenCalledWith('#/projects');
  unsubscribeAuthorization();
  unsubscribeNavigation();
});
