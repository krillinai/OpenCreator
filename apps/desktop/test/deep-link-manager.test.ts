import { describe, expect, it } from 'vitest';
import { deepLinkToRoute } from '../src/main/deep-link-manager.js';

describe('Desktop deep-link validation', () => {
  it('rejects any malformed path or query encoding as one invalid link', () => {
    for (const value of [
      'clawee://thread/%',
      'clawee://thread/%E0%A4%A',
      'clawee://thread/ok?runId=%',
      'clawee://thread/ok?unused=%E0%A4%A',
      'clawee://thread/%00hidden',
      'clawee://thread/%EF%BF%BD'
    ]) {
      expect(deepLinkToRoute(value), value).toBeUndefined();
    }
  });

  it('accepts valid Unicode, spaces, and encoded slashes', () => {
    expect(deepLinkToRoute(
      'clawee://thread/thread%2F%E4%B8%AD%E6%96%87?runId=run+one'
    )).toBe(
      '#/thread/thread%2F%E4%B8%AD%E6%96%87?runId=run+one'
    );
  });

  it('rejects empty and overlong UTF-8 identifiers', () => {
    expect(deepLinkToRoute('clawee://thread/ok?runId=')).toBeUndefined();
    expect(deepLinkToRoute(
      `clawee://thread/${encodeURIComponent('中'.repeat(200))}`
    )).toBeUndefined();
  });
});
