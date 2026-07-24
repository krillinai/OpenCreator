import { describe, expect, it } from 'vitest';
import { isWorkspaceUrl } from '../src/main/window-manager.js';

describe('Workspace Ready sender validation', () => {
  it('accepts only the packaged workspace origin in production', () => {
    expect(isWorkspaceUrl('clawee-app://app/index.html', false)).toBe(true);
    expect(isWorkspaceUrl('clawee-app://bootstrap/index.html', false)).toBe(false);
    expect(isWorkspaceUrl('https://example.com', false)).toBe(false);
  });

  it('accepts only the fixed Vite origin in development', () => {
    expect(isWorkspaceUrl('http://127.0.0.1:9000/', true)).toBe(true);
    expect(isWorkspaceUrl('http://localhost:9000/', true)).toBe(false);
    expect(isWorkspaceUrl('http://127.0.0.1:9001/', true)).toBe(false);
  });
});
