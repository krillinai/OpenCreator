import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('thread manager', () => {
  it('creates a managed thread with fixed workspace', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const manager = createThreadManager({ dataDir: tempDir });
    const thread = manager.createThread({
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only'
    });
    expect(thread.workspaceMode).toBe('managed');
    expect(thread.id).toMatch(/^thread_/);
    expect(thread.cwd).toContain(join('workspaces', thread.id));
  });
});
