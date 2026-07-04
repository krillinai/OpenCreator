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
    expect(result.path).toBe('/Users/tester/custom-codex');
  });

  it('falls back to ~/.codex', () => {
    const result = resolveCodexHome({
      env: {},
      homeDir: '/Users/tester'
    });
    expect(result.path).toBe('/Users/tester/.codex');
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
      source: 'isolated'
    });
  });

  it('expands only leading tilde', () => {
    expect(expandHome('~/x', '/home/a')).toBe('/home/a/x');
    expect(expandHome('/tmp/~/x', '/home/a')).toBe('/tmp/~/x');
  });
});
