import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireRuntimeLock } from '../../src/runtime-lock.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Runtime data lock', () => {
  it('prevents two Runtime owners and releases cleanly', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runtime-lock-'));
    const release = acquireRuntimeLock(tempDir);
    expect(() => acquireRuntimeLock(tempDir)).toThrow(/already used/);
    release();
    const releaseAgain = acquireRuntimeLock(tempDir);
    releaseAgain();
  });

  it('removes a stale lock', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runtime-lock-'));
    writeFileSync(join(tempDir, 'clawee-runtime.lock'), '99999999\n');
    const release = acquireRuntimeLock(tempDir);
    release();
  });
});
