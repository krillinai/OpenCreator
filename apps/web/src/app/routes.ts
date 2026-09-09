import {
  isCreatorWorkspace,
  type CreatorWorkspace
} from '../features/dashboard/creator-workspace.js';

export type AppRoute =
  | { view: 'home' }
  | { view: 'chat' }
  | { view: 'projects' }
  | {
      view: 'workbench';
      tool?: CreatorWorkspace;
      jobId?: string;
      returnTo?: 'home' | 'projects';
    }
  | { view: 'thread'; threadId: string; runId?: string; approvalId?: string }
  | { view: 'search' }
  | { view: 'schedules'; scheduleId?: string }
  | { view: 'tasks' }
  | { view: 'dashboard' }
  | {
      view: 'plugins';
      tab?: 'connections';
    }
  | { view: 'capabilities' }
  | {
      view: 'settings';
      tab?: SettingsRouteTab;
      section?: AiServicesSection;
    }
  | { view: 'files'; threadId?: string; path?: string };

export type AiServicesSection = 'text' | 'transcription' | 'tts' | 'image' | 'video';
export type SettingsRouteTab = 'ai-services' | 'local-components';

export function parseRoute(hash: string): AppRoute {
  const [path = '', query = ''] = hash.split('?', 2);
  if (path === '#/' || path === '#') return { view: 'home' };
  if (path === '#/new') return { view: 'home' };
  if (path === '#/chat') return { view: 'chat' };
  if (path.startsWith('#/thread/')) {
    const threadId = safeDecodeURIComponent(path.slice('#/thread/'.length));
    const fields = parseQuery(query);
    return threadId === undefined || threadId.length === 0
      ? { view: 'dashboard' }
      : {
          view: 'thread',
          threadId,
          ...(fields.runId === undefined ? {} : { runId: fields.runId }),
          ...(fields.approvalId === undefined ? {} : { approvalId: fields.approvalId })
        };
  }
  if (path === '#/search') return { view: 'search' };
  if (path === '#/projects') return { view: 'projects' };
  if (path === '#/workbench') {
    const params = new URLSearchParams(query);
    const tool = params.get('tool');
    const jobId = params.get('jobId');
    const returnTo = params.get('returnTo');
    if (tool === null || !isCreatorWorkspace(tool)) return { view: 'workbench' };
    return {
      view: 'workbench',
      tool,
      ...(jobId === null || jobId.length === 0 ? {} : { jobId }),
      ...(returnTo === 'home' || returnTo === 'projects' ? { returnTo } : {})
    };
  }
  if (path === '#/schedules') {
    const fields = parseQuery(query);
    return {
      view: 'schedules',
      ...(fields.scheduleId === undefined ? {} : { scheduleId: fields.scheduleId })
    };
  }
  if (path === '#/tasks') return { view: 'tasks' };
  if (path === '#/dashboard') return { view: 'dashboard' };
  if (path === '#/plugins') {
    const fields = parseQuery(query);
    return {
      view: 'plugins',
      ...(fields.pluginTab === undefined ? {} : { tab: fields.pluginTab })
    };
  }
  if (path === '#/connections') return { view: 'plugins', tab: 'connections' };
  if (path === '#/capabilities') return { view: 'capabilities' };
  if (path === '#/settings') {
    const params = new URLSearchParams(query);
    const tab = params.get('tab');
    const section = parseAiServicesSection(params.get('section'));
    if (tab === 'codex-agent') {
      return { view: 'settings', tab: 'ai-services', section: 'text' };
    }
    return {
      view: 'settings',
      ...(tab === 'local-components'
        ? { tab: 'local-components' as const }
        : tab === 'ai-services' || section !== undefined
          ? { tab: 'ai-services' as const }
          : {}),
      ...(section === undefined ? {} : { section })
    };
  }
  if (path === '#/files') {
    const fields = parseQuery(query);
    return {
      view: 'files',
      ...(fields.threadId === undefined ? {} : { threadId: fields.threadId }),
      ...(fields.path === undefined ? {} : { path: fields.path })
    };
  }
  return { view: 'dashboard' };
}

export function formatRoute(route: AppRoute): string {
  switch (route.view) {
    case 'home':
      return '#/new';
    case 'chat':
      return '#/chat';
    case 'projects':
      return '#/projects';
    case 'workbench': {
      if (route.tool === undefined) return '#/workbench';
      const query = new URLSearchParams({ tool: route.tool });
      if (route.jobId !== undefined) query.set('jobId', route.jobId);
      if (route.returnTo !== undefined) query.set('returnTo', route.returnTo);
      return `#/workbench?${query.toString()}`;
    }
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
    case 'dashboard':
      return '#/dashboard';
    case 'plugins': {
      const query = new URLSearchParams();
      if (route.tab === 'connections') query.set('tab', route.tab);
      const suffix = query.toString();
      return suffix.length === 0 ? '#/plugins' : `#/plugins?${suffix}`;
    }
    case 'capabilities':
      return '#/capabilities';
    case 'settings': {
      if (route.tab === undefined) return '#/settings';
      const query = new URLSearchParams({ tab: route.tab });
      if (route.section !== undefined) query.set('section', route.section);
      return `#/settings?${query.toString()}`;
    }
    case 'files': {
      const query = new URLSearchParams();
      if (route.threadId !== undefined) query.set('threadId', route.threadId);
      if (route.path !== undefined) query.set('path', route.path);
      const suffix = query.toString();
      return suffix.length === 0 ? '#/files' : `#/files?${suffix}`;
    }
  }
}

function parseAiServicesSection(value: string | null): AiServicesSection | undefined {
  return value === 'text'
    || value === 'transcription'
    || value === 'tts'
    || value === 'image'
    || value === 'video'
    ? value
    : undefined;
}

function parseQuery(query: string): {
  threadId?: string;
  path?: string;
  runId?: string;
  approvalId?: string;
  scheduleId?: string;
  pluginTab?: 'connections';
} {
  const fields: {
    threadId?: string;
    path?: string;
    runId?: string;
    approvalId?: string;
    scheduleId?: string;
    pluginTab?: 'connections';
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
    if (key === 'tab' && value === 'connections') fields.pluginTab = value;
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
