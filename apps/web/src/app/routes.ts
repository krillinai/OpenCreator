export type AppRoute =
  | { view: 'home' }
  | { view: 'thread'; threadId: string }
  | { view: 'search' }
  | { view: 'schedules' }
  | { view: 'plugins' }
  | { view: 'capabilities' }
  | { view: 'settings' }
  | { view: 'files'; threadId?: string; path?: string };

export function parseRoute(hash: string): AppRoute {
  const [path = '', query = ''] = hash.split('?', 2);
  if (path.startsWith('#/thread/')) {
    const threadId = safeDecodeURIComponent(path.slice('#/thread/'.length));
    return threadId === undefined || threadId.length === 0
      ? { view: 'home' }
      : { view: 'thread', threadId };
  }
  if (path === '#/search') return { view: 'search' };
  if (path === '#/schedules') return { view: 'schedules' };
  if (path === '#/plugins') return { view: 'plugins' };
  if (path === '#/capabilities') return { view: 'capabilities' };
  if (path === '#/settings') return { view: 'settings' };
  if (path === '#/files') {
    const fields = parseQuery(query);
    return {
      view: 'files',
      ...(fields.threadId === undefined ? {} : { threadId: fields.threadId }),
      ...(fields.path === undefined ? {} : { path: fields.path })
    };
  }
  return { view: 'home' };
}

export function formatRoute(route: AppRoute): string {
  switch (route.view) {
    case 'home':
      return '#/';
    case 'thread':
      return `#/thread/${encodeURIComponent(route.threadId)}`;
    case 'search':
      return '#/search';
    case 'schedules':
      return '#/schedules';
    case 'plugins':
      return '#/plugins';
    case 'capabilities':
      return '#/capabilities';
    case 'settings':
      return '#/settings';
    case 'files': {
      const query = new URLSearchParams();
      if (route.threadId !== undefined) query.set('threadId', route.threadId);
      if (route.path !== undefined) query.set('path', route.path);
      const suffix = query.toString();
      return suffix.length === 0 ? '#/files' : `#/files?${suffix}`;
    }
  }
}

function parseQuery(query: string): { threadId?: string; path?: string } {
  const fields: { threadId?: string; path?: string } = {};
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue;
    const [rawKey = '', rawValue = ''] = pair.split('=', 2);
    const key = safeDecodeURIComponent(rawKey.replace(/\+/g, ' '));
    const value = safeDecodeURIComponent(rawValue.replace(/\+/g, ' '));
    if (key === undefined || value === undefined || value.length === 0) continue;
    if (key === 'threadId') fields.threadId = value;
    if (key === 'path') fields.path = value;
  }
  return fields;
}

function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}
