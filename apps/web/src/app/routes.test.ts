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
    expect(parseRoute('#/')).toEqual({ view: 'home' });
    expect(parseRoute('#/new')).toEqual({ view: 'home' });
    expect(parseRoute('#/chat')).toEqual({ view: 'chat' });
    expect(parseRoute('#/search')).toEqual({ view: 'search' });
    expect(parseRoute('#/projects')).toEqual({ view: 'projects' });
    expect(parseRoute('#/workbench')).toEqual({ view: 'workbench' });
    expect(parseRoute('#/workbench?module=image-generation')).toEqual({ view: 'workbench' });
    expect(parseRoute('#/workbench?module=unknown')).toEqual({ view: 'workbench' });
    expect(parseRoute('#/workbench?tool=video-translation')).toEqual({
      view: 'workbench',
      tool: 'video-translation'
    });
    expect(parseRoute('#/workbench?tool=video-translation&jobId=creator_job+1')).toEqual({
      view: 'workbench',
      tool: 'video-translation',
      jobId: 'creator_job 1'
    });
    expect(parseRoute('#/workbench?tool=cover-generator&jobId=cover_1&returnTo=projects')).toEqual({
      view: 'workbench',
      tool: 'cover-generator',
      jobId: 'cover_1',
      returnTo: 'projects'
    });
    expect(parseRoute('#/workbench?tool=image-generation&jobId=image_1&returnTo=home')).toEqual({
      view: 'workbench',
      tool: 'image-generation',
      jobId: 'image_1',
      returnTo: 'home'
    });
    expect(parseRoute('#/workbench?tool=cover-generator&returnTo=unknown')).toEqual({
      view: 'workbench',
      tool: 'cover-generator'
    });
    expect(parseRoute('#/workbench?tool=unknown&jobId=creator_job_1')).toEqual({ view: 'workbench' });
    expect(parseRoute('#/schedules')).toEqual({ view: 'schedules' });
    expect(parseRoute('#/tasks')).toEqual({ view: 'tasks' });
    expect(parseRoute('#/plugins')).toEqual({ view: 'plugins' });
    expect(parseRoute('#/connections')).toEqual({ view: 'plugins', tab: 'connections' });
    expect(parseRoute('#/settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#/settings?tab=ai-services')).toEqual({ view: 'settings', tab: 'ai-services' });
    expect(formatRoute({ view: 'settings', tab: 'ai-services' })).toBe('#/settings?tab=ai-services');
    expect(parseRoute('#/settings?tab=local-components')).toEqual({
      view: 'settings',
      tab: 'local-components'
    });
    expect(formatRoute({ view: 'settings', tab: 'local-components' }))
      .toBe('#/settings?tab=local-components');
    expect(parseRoute('#/settings?tab=ai-services&section=tts')).toEqual({
      view: 'settings',
      tab: 'ai-services',
      section: 'tts'
    });
    expect(formatRoute({
      view: 'settings',
      tab: 'ai-services',
      section: 'tts'
    })).toBe('#/settings?tab=ai-services&section=tts');
    expect(parseRoute('#/settings?tab=codex-agent')).toEqual({
      view: 'settings',
      tab: 'ai-services',
      section: 'text'
    });
    expect(parseRoute('#/capabilities')).toEqual({ view: 'capabilities' });
    expect(parseRoute('#/assets')).toEqual({ view: 'dashboard' });
    expect(parseRoute('#/knowledge')).toEqual({ view: 'dashboard' });
    expect(parseRoute('#/drive')).toEqual({ view: 'dashboard' });
    expect(parseRoute('#/account')).toEqual({ view: 'dashboard' });
    expect(parseRoute('#/activity')).toEqual({ view: 'dashboard' });
  });

  it('round-trips a schedule editor target', () => {
    const route = {
      view: 'schedules' as const,
      scheduleId: 'schedule 1'
    };

    expect(formatRoute(route)).toBe('#/schedules?scheduleId=schedule+1');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('round-trips the connector tab inside the plugin center', () => {
    const route = { view: 'plugins' as const, tab: 'connections' as const };
    expect(formatRoute(route)).toBe('#/plugins?tab=connections');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('ignores obsolete plugin source parameters', () => {
    expect(parseRoute('#/plugins?source=public')).toEqual({ view: 'plugins' });
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
    expect(formatRoute({ view: 'home' })).toBe('#/new');
    expect(formatRoute({ view: 'chat' })).toBe('#/chat');
    expect(formatRoute({ view: 'workbench' })).toBe('#/workbench');
    expect(formatRoute({
      view: 'workbench',
      tool: 'video-translation',
      jobId: 'creator/job 1'
    })).toBe('#/workbench?tool=video-translation&jobId=creator%2Fjob+1');
    expect(formatRoute({
      view: 'workbench',
      tool: 'cover-generator',
      jobId: 'cover/job 1',
      returnTo: 'projects'
    })).toBe('#/workbench?tool=cover-generator&jobId=cover%2Fjob+1&returnTo=projects');
    expect(formatRoute({
      view: 'workbench',
      tool: 'image-generation',
      jobId: 'image/job 1',
      returnTo: 'home'
    })).toBe('#/workbench?tool=image-generation&jobId=image%2Fjob+1&returnTo=home');
    expect(formatRoute({ view: 'projects' })).toBe('#/projects');
    expect(formatRoute({ view: 'thread', threadId: 'thread 1' })).toBe('#/thread/thread%201');
    expect(formatRoute({ view: 'search' })).toBe('#/search');
    expect(formatRoute({ view: 'schedules' })).toBe('#/schedules');
    expect(formatRoute({ view: 'tasks' })).toBe('#/tasks');
    expect(formatRoute({ view: 'plugins' })).toBe('#/plugins');
    expect(formatRoute({ view: 'plugins', tab: 'connections' })).toBe('#/plugins?tab=connections');
    expect(formatRoute({ view: 'settings' })).toBe('#/settings');
    expect(formatRoute({ view: 'capabilities' })).toBe('#/capabilities');
    expect(formatRoute({ view: 'files', path: 'docs/a b.html' }))
      .toBe('#/files?path=docs%2Fa+b.html');
  });

  it('falls back to the dashboard for malformed thread route encoding', () => {
    expect(() => parseRoute('#/thread/%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ view: 'dashboard' });
    expect(parseRoute('#/thread/%ZZ')).toEqual({ view: 'dashboard' });
  });

  it('ignores malformed optional file route fields', () => {
    expect(parseRoute('#/files?threadId=%E0%A4%A&path=docs%2Fok.html')).toEqual({
      view: 'files',
      path: 'docs/ok.html'
    });
  });
});
