export type AppRoute =
  | { view: 'home' }
  | { view: 'thread'; threadId: string; runId?: string; approvalId?: string }
  | { view: 'search' }
  | { view: 'schedules'; scheduleId?: string }
  | { view: 'tasks' }
  | { view: 'plugins' }
  | { view: 'capabilities' }
  | { view: 'settings' }
  | { view: 'files'; threadId?: string; path?: string };

export function parseRoute(hash: string): AppRoute {
  const [path = '', query = ''] = hash.split('?', 2);
  if (path.startsWith('#/thread/')) {
    const threadId = safeDecodeURIComponent(path.slice('#/thread/'.length));
    const fields = parseQuery(query);
    return threadId === undefined || threadId.length === 0
      ? { view: 'home' }
      : {
          view: 'thread',
          threadId,
          ...(fields.runId === undefined ? {} : { runId: fields.runId }),
          ...(fields.approvalId === undefined ? {} : { approvalId: fields.approvalId })
        };
  }
  if (path === '#/search') return { view: 'search' };
  if (path === '#/schedules') {
    const fields = parseQuery(query);
    return {
      view: 'schedules',
      ...(fields.scheduleId === undefined ? {} : { scheduleId: fields.scheduleId })
    };
  }
  if (path === '#/tasks') return { view: 'tasks' };
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
    case 'thread': {
      const query = new URLSearchParams();
      if (route.runId !== undefined) query.set('runId', route.runId);
      if (route.approvalId !== undefined) query.set('approvalId', route.approvalId);
      const suffix = query.toString();
      const path = `#/thread/${encodeURIComponent(route.threadId)}`;
      return suffix.length === 0 ? path : `${path}?${suffix}`;
    }
    case 'search':
      return '#/search';
    case 'schedules': {
      const query = new URLSearchParams();
      if (route.scheduleId !== undefined) query.set('scheduleId', route.scheduleId);
      const suffix = query.toString();
      return suffix.length === 0 ? '#/schedules' : `#/schedules?${suffix}`;
    }
    case 'tasks':
      return '#/tasks';
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

function parseQuery(query: string): {
  threadId?: string;
  path?: string;
  runId?: string;
  approvalId?: string;
  scheduleId?: string;
} {
  const fields: {
    threadId?: string;
    path?: string;
    runId?: string;
    approvalId?: string;
    scheduleId?: string;
  } = {};
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue;
    const [rawKey = '', rawValue = ''] = pair.split('=', 2);
    const key = safeDecodeURIComponent(rawKey.replace(/\+/g, ' '));
    const value = safeDecodeURIComponent(rawValue.replace(/\+/g, ' '));
    if (key === undefined || value === undefined || value.length === 0) continue;
    if (key === 'threadId') fields.threadId = value;
    if (key === 'path') fields.path = value;
    if (key === 'runId') fields.runId = value;
    if (key === 'approvalId') fields.approvalId = value;
    if (key === 'scheduleId') fields.scheduleId = value;
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
