export type AppRoute =
  | { view: 'home' }
  | { view: 'thread'; threadId: string }
  | { view: 'schedules' }
  | { view: 'capabilities' }
  | { view: 'settings' };

export function parseRoute(hash: string): AppRoute {
  if (hash.startsWith('#/thread/')) {
    try {
      return { view: 'thread', threadId: decodeURIComponent(hash.slice('#/thread/'.length)) };
    } catch {
      return { view: 'home' };
    }
  }
  if (hash === '#/schedules') return { view: 'schedules' };
  if (hash === '#/capabilities') return { view: 'capabilities' };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'home' };
}
