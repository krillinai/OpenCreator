import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCodex } from '../helpers/fake-codex.js';
import { CodexExecError, runCodexExec, startCodexExec } from '../../src/codex/runner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('codex runner', () => {
  it('writes prompt to stdin and captures stdout/stderr separately', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const codexHome = join(tempDir, 'codex-home');
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'thread.started', thread_id: 'codex_thread_1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { type: 'agent_message', text: 'ok' } },
        { type: 'turn.completed' }
      ],
      stderrLines: ['diagnostic warning']
    });

    const result = await runCodexExec({
      codexBin: fake.bin,
      codexHome,
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutLines).toHaveLength(4);
    expect(result.stderr).toContain('diagnostic warning');
    expect(fake.readPrompt()).toBe('hello');
    expect(fake.readCodexHome()).toBe(codexHome);
  });

  it('resolves with the exit code when codex exits non-zero', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.completed' }],
      exitCode: 42
    });

    const result = await runCodexExec({
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000
    });

    expect(result.exitCode).toBe(42);
    expect(result.signal).toBeNull();
    expect(result.stdoutLines).toEqual(['{"type":"turn.completed"}']);
  });

  it('rejects with timeout when codex hangs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });

    await expect(
      runCodexExec({
        codexBin: fake.bin,
        codexHome: join(tempDir, 'codex-home'),
        cwd: tempDir,
        args: ['exec', '--json'],
        prompt: 'hello',
        timeoutMs: 50,
        inactivityTimeoutMs: 5000
      })
    ).rejects.toMatchObject({ terminationReason: 'timeout' });
  });

  it('can cancel a running codex process', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });

    const process = startCodexExec({
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000
    });

    process.cancel();
    await expect(process.result).resolves.toMatchObject({ terminationReason: 'canceled' });
  });

  it('does not hang when canceling a process that ignores SIGTERM', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true,
      ignoreSigterm: true
    });

    const process = startCodexExec({
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000,
      forceKillGraceMs: 50
    });

    process.cancel();
    await expect(process.result).resolves.toMatchObject({
      terminationReason: 'canceled'
    });
  });

  it('rejects with inactivity timeout when codex is silent', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [],
      hang: true
    });

    await expect(
      runCodexExec({
        codexBin: fake.bin,
        codexHome: join(tempDir, 'codex-home'),
        cwd: tempDir,
        args: ['exec', '--json'],
        prompt: 'hello',
        timeoutMs: 5000,
        inactivityTimeoutMs: 50
      })
    ).rejects.toMatchObject({ terminationReason: 'inactivity_timeout' });
  });

  it('rejects with spawn timeout before codex emits any activity', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [{ type: 'turn.started' }],
      initialDelayMs: 500,
      hang: true
    });

    await expect(
      runCodexExec({
        codexBin: fake.bin,
        codexHome: join(tempDir, 'codex-home'),
        cwd: tempDir,
        args: ['exec', '--json'],
        prompt: 'hello',
        timeoutMs: 5000,
        spawnTimeoutMs: 50,
        inactivityTimeoutMs: 5000
      })
    ).rejects.toMatchObject({ terminationReason: 'spawn_timeout' });
  });

  it('surfaces spawn failures as classified errors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-runner-'));

    await expect(
      runCodexExec({
        codexBin: join(tempDir, 'missing-codex'),
        codexHome: join(tempDir, 'codex-home'),
        cwd: tempDir,
        args: ['exec', '--json'],
        prompt: 'hello',
        timeoutMs: 5000,
        inactivityTimeoutMs: 5000
      })
    ).rejects.toBeInstanceOf(CodexExecError);
  });
});
