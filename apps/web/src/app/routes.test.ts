import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from './routes.js';

describe('app routes', () => {
  it('decodes thread route ids', () => {
    expect(parseRoute('#/thread/thread%201')).toEqual({ view: 'thread', threadId: 'thread 1' });
  });

  it('parses every primary page route', () => {
    expect(parseRoute('#/search')).toEqual({ view: 'search' });
    expect(parseRoute('#/schedules')).toEqual({ view: 'schedules' });
    expect(parseRoute('#/tasks')).toEqual({ view: 'tasks' });
    expect(parseRoute('#/plugins')).toEqual({ view: 'plugins' });
    expect(parseRoute('#/settings')).toEqual({ view: 'settings' });
    expect(parseRoute('#/capabilities')).toEqual({ view: 'capabilities' });
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
    expect(formatRoute({ view: 'thread', threadId: 'thread 1' })).toBe('#/thread/thread%201');
    expect(formatRoute({ view: 'search' })).toBe('#/search');
    expect(formatRoute({ view: 'schedules' })).toBe('#/schedules');
    expect(formatRoute({ view: 'tasks' })).toBe('#/tasks');
    expect(formatRoute({ view: 'plugins' })).toBe('#/plugins');
    expect(formatRoute({ view: 'settings' })).toBe('#/settings');
    expect(formatRoute({ view: 'capabilities' })).toBe('#/capabilities');
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
