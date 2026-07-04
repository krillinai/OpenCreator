import { describe, expect, it } from 'vitest';

import { runSmokeCommand } from '../../src/codex/smoke.js';

const runRealCodex = process.env.CLAWEE_RUN_REAL_CODEX_SMOKE === '1';

describe.runIf(runRealCodex)('real codex smoke', () => {
  it('captures codex version', () => {
    const result = runSmokeCommand(['codex', '--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('codex');
  });

  it('captures codex exec help', () => {
    const result = runSmokeCommand(['codex', 'exec', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--json');
  });
});
