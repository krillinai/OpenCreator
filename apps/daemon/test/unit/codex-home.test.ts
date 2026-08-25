import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCodexHome } from '../../src/codex/home.js';
import { expandHome } from '../../src/platform/paths.js';

describe('codex home resolution', () => {
  it('uses CODEX_HOME when present', () => {
    const result = resolveCodexHome({
      env: { CODEX_HOME: '~/custom-codex' },
      homeDir: '/Users/tester'
    });
    expect(result.mode).toBe('global');
    expect(result.path).toBe(join('/Users/tester', 'custom-codex'));
  });

  it('falls back to ~/.codex', () => {
    const result = resolveCodexHome({
      env: {},
      homeDir: '/Users/tester'
    });
    expect(result.path).toBe(join('/Users/tester', '.codex'));
  });

  it('uses isolated home when explicitly provided as an empty string', () => {
    const result = resolveCodexHome({
      env: { CODEX_HOME: '~/custom-codex' },
      homeDir: '/Users/tester',
      isolatedHome: ''
    });
    expect(result).toEqual({
      path: '',
      mode: 'isolated',
      source: 'isolated',
      writable: true
    });
  });

  it('marks global codex homes read-only and isolated homes writable', () => {
    expect(resolveCodexHome({ env: {}, homeDir: '/Users/tester' })).toMatchObject({
      path: join('/Users/tester', '.codex'),
      mode: 'global',
      source: 'default',
      writable: false
    });

    expect(
      resolveCodexHome({
        env: { CODEX_HOME: '~/custom-codex' },
        homeDir: '/Users/tester'
      })
    ).toMatchObject({
      path: join('/Users/tester', 'custom-codex'),
      mode: 'global',
      source: 'env',
      writable: false
    });

    expect(
      resolveCodexHome({
        env: { CODEX_HOME: '~/custom-codex' },
        homeDir: '/Users/tester',
        isolatedHome: '~/isolated-codex'
      })
    ).toMatchObject({
      path: join('/Users/tester', 'isolated-codex'),
      mode: 'isolated',
      source: 'isolated',
      writable: true
    });
  });

  it('expands only leading tilde', () => {
    expect(expandHome('~/x', '/home/a')).toBe(join('/home/a', 'x'));
    expect(expandHome('/tmp/~/x', '/home/a')).toBe('/tmp/~/x');
  });
});
