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

  it('captures codex exec resume help', () => {
    const result = runSmokeCommand(['codex', 'exec', 'resume', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--json');
  });

  it('captures codex mcp help', () => {
    const result = runSmokeCommand(['codex', 'mcp', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('add');
  });

  it('captures codex mcp add help', () => {
    const result = runSmokeCommand(['codex', 'mcp', 'add', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toContain('--env');
  });

  it('captures a minimal codex exec jsonl fixture', () => {
    const result = runSmokeCommand([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      'Reply with OK only.'
    ]);

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('captures a command execution jsonl fixture', () => {
    const result = runSmokeCommand([
      'codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      'Run the shell command `pwd` exactly once, then reply DONE.'
    ]);

    expect(result.exitCode).toBe(0);
    const events = result.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type?: string; item?: { type?: string } });
    expect(events.some(event => event.item?.type === 'command_execution')).toBe(true);
  });
});
