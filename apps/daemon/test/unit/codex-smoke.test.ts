import { describe, expect, it } from 'vitest';
import { execPath } from 'node:process';

import { runSmokeCommand } from '../../src/codex/smoke.js';

describe('codex smoke helpers', () => {
  it('reports timeout diagnostics from runSmokeCommand', () => {
    const result = runSmokeCommand([execPath, '-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 10 });

    expect(result.timedOut).toBe(true);
    expect(result.errorMessage).toContain('ETIMEDOUT');
    expect(result.stderr).toContain('[real-codex-smoke] timed out after 10ms');
  });
});
