import { describe, expect, it } from 'vitest';
import { parseRoute } from './routes.js';

describe('app routes', () => {
  it('decodes thread route ids', () => {
    expect(parseRoute('#/thread/thread%201')).toEqual({ view: 'thread', threadId: 'thread 1' });
  });

  it('falls back home for malformed thread route encoding', () => {
    expect(() => parseRoute('#/thread/%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ view: 'home' });
    expect(parseRoute('#/thread/%ZZ')).toEqual({ view: 'home' });
  });
});
