export type AppRoute =
  | { view: 'home' }
  | { view: 'thread'; threadId: string; runId?: string; approvalId?: string }
  | { view: 'search' }
  | { view: 'schedules'; scheduleId?: string }
  | { view: 'tasks' }
  | { view: 'activity'; range: ActivityRange }
  | { view: 'activity-agent'; collectorId: string; agentId: string; range: ActivityRange }
  | { view: 'plugins'; source?: 'enterprise' }
  | { view: 'knowledge' }
  | { view: 'account' }
  | { view: 'capabilities' }
  | { view: 'settings' }
  | { view: 'files'; threadId?: string; path?: string };

export function parseRoute(hash: string): AppRoute {
  const [path = '', query = ''] = hash.split('?', 2);
  if (path.startsWith('#/activity/agent/')) {
    const parts = path.slice('#/activity/agent/'.length).split('/');
    const collectorId = safeDecodeURIComponent(parts[0] ?? '');
    const agentId = safeDecodeURIComponent(parts[1] ?? '');
    if (collectorId === undefined || agentId === undefined || !collectorId || !agentId || parts.length !== 2) {
      return { view: 'home' };
    }
    return { view: 'activity-agent', collectorId, agentId, range: parseActivityRange(query) };
  }
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
  if (path === '#/activity') return { view: 'activity', range: parseActivityRange(query) };
  if (path === '#/plugins') {
    const fields = parseQuery(query);
    return fields.source === 'enterprise'
      ? { view: 'plugins', source: 'enterprise' }
      : { view: 'plugins' };
  }
  if (path === '#/knowledge') return { view: 'knowledge' };
  if (path === '#/account') return { view: 'account' };
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
    case 'activity':
      return `#/activity?range=${route.range}`;
    case 'activity-agent':
      return `#/activity/agent/${encodeURIComponent(route.collectorId)}/${encodeURIComponent(route.agentId)}?range=${route.range}`;
    case 'plugins':
      return route.source === 'enterprise'
        ? '#/plugins?source=enterprise'
        : '#/plugins';
    case 'knowledge':
      return '#/knowledge';
    case 'account':
      return '#/account';
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

export type ActivityRange = 'today' | '7d' | '30d';

function parseActivityRange(query: string): ActivityRange {
  const value = new URLSearchParams(query).get('range');
  return value === 'today' || value === '30d' ? value : '7d';
}

function parseQuery(query: string): {
  threadId?: string;
  path?: string;
  runId?: string;
  approvalId?: string;
  scheduleId?: string;
  source?: 'enterprise';
} {
  const fields: {
    threadId?: string;
    path?: string;
    runId?: string;
    approvalId?: string;
    scheduleId?: string;
    source?: 'enterprise';
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
    if (key === 'source' && value === 'enterprise') fields.source = value;
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
