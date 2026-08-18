import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from './routes.js';

describe('app routes', () => {
  it('decodes thread route ids', () => {
    expect(parseRoute('#/thread/thread%201')).toEqual({ view: 'thread', threadId: 'thread 1' });
  });

  it('round-trips optional run and approval targets on thread routes', () => {
    const route = {
      view: 'thread' as const,
      threadId: 'thread/task',
      runId: 'run 1',
      approvalId: 'approval 1'
    };

    expect(formatRoute(route)).toBe(
      '#/thread/thread%2Ftask?runId=run+1&approvalId=approval+1'
    );
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('parses every primary page route', () => {
    expect(parseRoute('#/search')).toEqual({ view: 'search' });
    expect(parseRoute('#/projects')).toEqual({ view: 'projects' });
    expect(parseRoute('#/workbench')).toEqual({ view: 'workbench' });
    expect(parseRoute('#/schedules')).toEqual({ view: 'schedules' });
    expect(parseRoute('#/tasks')).toEqual({ view: 'tasks' });
    expect(parseRoute('#/dashboard')).toEqual({ view: 'dashboard' });
    expect(parseRoute('#/plugins')).toEqual({ view: 'plugins' });
    expect(parseRoute('#/connections')).toEqual({ view: 'plugins', tab: 'connections' });
    expect(parseRoute('#/assets')).toEqual({ view: 'assets' });
    expect(parseRoute('#/knowledge')).toEqual({ view: 'assets' });
    expect(parseRoute('#/drive')).toEqual({ view: 'assets', tab: 'materials' });
    expect(parseRoute('#/account')).toEqual({ view: 'account' });
    expect(parseRoute('#/settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#/capabilities')).toEqual({ view: 'capabilities' });
    expect(parseRoute('#/activity')).toEqual({ view: 'activity', range: '7d' });
    expect(parseRoute('#/activity?range=today')).toEqual({ view: 'activity', range: 'today' });
    expect(parseRoute('#/activity/agent/collector%2Fone/agent%201?range=30d')).toEqual({
      view: 'activity-agent',
      collectorId: 'collector/one',
      agentId: 'agent 1',
      range: '30d'
    });
  });

  it('round-trips a schedule editor target', () => {
    const route = {
      view: 'schedules' as const,
      scheduleId: 'schedule 1'
    };

    expect(formatRoute(route)).toBe('#/schedules?scheduleId=schedule+1');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('round-trips the enterprise plugin source', () => {
    const route = {
      view: 'plugins' as const,
      source: 'enterprise' as const
    };

    expect(formatRoute(route)).toBe('#/plugins?source=enterprise');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('round-trips the public plugin source', () => {
    const route = { view: 'plugins' as const, source: 'public' as const };
    expect(formatRoute(route)).toBe('#/plugins?source=public');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('round-trips the connector tab inside the plugin center', () => {
    const route = { view: 'plugins' as const, tab: 'connections' as const };
    expect(formatRoute(route)).toBe('#/plugins?tab=connections');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('round-trips the material center tab inside my assets', () => {
    const route = { view: 'assets' as const, tab: 'materials' as const };
    expect(formatRoute(route)).toBe('#/assets?tab=materials');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('falls back to the public market for unsupported plugin sources', () => {
    expect(parseRoute('#/plugins?source=private')).toEqual({ view: 'plugins' });
    expect(parseRoute('#/plugins?source=%E0%A4%A')).toEqual({ view: 'plugins' });
  });

  it('round-trips file routes with thread and workspace paths', () => {
    const route = {
      view: 'files' as const,
      threadId: 'thread/中文',
      path: 'docs/设计方案 1.html'
    };

    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('formats stable copyable hashes for every route', () => {
    expect(formatRoute({ view: 'home' })).toBe('#/');
    expect(formatRoute({ view: 'workbench' })).toBe('#/workbench');
    expect(formatRoute({ view: 'projects' })).toBe('#/projects');
    expect(formatRoute({ view: 'thread', threadId: 'thread 1' })).toBe('#/thread/thread%201');
    expect(formatRoute({ view: 'search' })).toBe('#/search');
    expect(formatRoute({ view: 'schedules' })).toBe('#/schedules');
    expect(formatRoute({ view: 'tasks' })).toBe('#/tasks');
    expect(formatRoute({ view: 'dashboard' })).toBe('#/dashboard');
    expect(formatRoute({ view: 'plugins' })).toBe('#/plugins');
    expect(formatRoute({ view: 'plugins', tab: 'connections' })).toBe('#/plugins?tab=connections');
    expect(formatRoute({ view: 'assets' })).toBe('#/assets');
    expect(formatRoute({ view: 'assets', tab: 'materials' })).toBe('#/assets?tab=materials');
    expect(formatRoute({ view: 'account' })).toBe('#/account');
    expect(formatRoute({ view: 'settings' })).toBe('#/settings');
    expect(formatRoute({ view: 'capabilities' })).toBe('#/capabilities');
    expect(formatRoute({ view: 'activity', range: '7d' })).toBe('#/activity?range=7d');
    expect(formatRoute({
      view: 'activity-agent',
      collectorId: 'collector/one',
      agentId: 'agent 1',
      range: 'today'
    })).toBe('#/activity/agent/collector%2Fone/agent%201?range=today');
    expect(formatRoute({ view: 'files', path: 'docs/a b.html' }))
      .toBe('#/files?path=docs%2Fa+b.html');
  });

  it('falls back home for malformed thread route encoding', () => {
    expect(() => parseRoute('#/thread/%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ view: 'home' });
    expect(parseRoute('#/thread/%ZZ')).toEqual({ view: 'home' });
  });

  it('ignores malformed optional file route fields', () => {
    expect(parseRoute('#/files?threadId=%E0%A4%A&path=docs%2Fok.html')).toEqual({
      view: 'files',
      path: 'docs/ok.html'
    });
  });
});
