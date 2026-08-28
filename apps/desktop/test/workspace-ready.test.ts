import { describe, expect, it } from 'vitest';
import { isWorkspaceUrl } from '../src/main/window-manager.js';

describe('Workspace Ready sender validation', () => {
  it('accepts only the packaged workspace origin in production', () => {
    expect(isWorkspaceUrl('opencreator-app://app/index.html', false)).toBe(true);
    expect(isWorkspaceUrl('opencreator-app://bootstrap/index.html', false)).toBe(false);
    expect(isWorkspaceUrl('https://example.com', false)).toBe(false);
  });

  it('accepts only the fixed Vite origin in development', () => {
    expect(isWorkspaceUrl('http://127.0.0.1:19861/', true)).toBe(true);
    expect(isWorkspaceUrl('http://localhost:19861/', true)).toBe(false);
    expect(isWorkspaceUrl('http://127.0.0.1:19862/', true)).toBe(false);
  });
});
