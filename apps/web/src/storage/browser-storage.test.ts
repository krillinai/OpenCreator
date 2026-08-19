import { afterEach, describe, expect, it } from 'vitest';
import { readJsonFromStorage } from './browser-storage.js';

describe('browser storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns null and removes corrupt JSON values', () => {
    window.localStorage.setItem('opencreator.web.connection.v1', '{bad json');

    expect(readJsonFromStorage('opencreator.web.connection.v1')).toBeNull();
    expect(window.localStorage.getItem('opencreator.web.connection.v1')).toBeNull();
  });
});
