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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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

  it('waits for asynchronous stdout handlers before resolving the process result', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
    const fake = createFakeCodex(tempDir, {
      stdoutLines: [
        { type: 'turn.started' },
        { type: 'turn.completed' }
      ]
    });
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const handled: string[] = [];
    let resultSettled = false;

    const result = runCodexExec({
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 5000,
      inactivityTimeoutMs: 5000,
      async onStdoutLine(line) {
        handled.push(line);
        if (handled.length === 1) await firstBlocked;
      }
    }).finally(() => {
      resultSettled = true;
    });

    await expect.poll(() => handled, { timeout: 5_000 }).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(handled).toHaveLength(1);
    expect(resultSettled).toBe(false);

    releaseFirst();
    await result;

    expect(handled).toEqual([
      '{"type":"turn.started"}',
      '{"type":"turn.completed"}'
    ]);
  }, 10_000);

  it('rejects with timeout when codex hangs', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));

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

  it('bounds diagnostic output while preserving final assistant and terminal events', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-runner-'));
    const fake = createFakeCodex(tempDir, {
      rawStdoutLines: [
        'x'.repeat(1024 * 1024 + 64),
        ...Array.from({ length: 10_050 }, (_, index) =>
          JSON.stringify({ type: 'diagnostic', index }))
      ],
      stdoutLines: [
        {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'final answer' }
        },
        { type: 'turn.completed' }
      ],
      stderrLines: ['e'.repeat(1024 * 1024 + 64)],
      delayMs: 100
    });

    const result = await runCodexExec({
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      cwd: tempDir,
      args: ['exec', '--json'],
      prompt: 'hello',
      timeoutMs: 10_000,
      inactivityTimeoutMs: 10_000
    });

    expect(result.stdoutLines.length).toBeLessThanOrEqual(10_000);
    expect(result.stdoutLines.at(-2)).toContain('final answer');
    expect(result.stdoutLines.at(-1)).toContain('turn.completed');
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(1024 * 1024 + 3);
    expect(result.outputTruncation.stdout.truncated).toBe(true);
    expect(result.outputTruncation.stderr.truncated).toBe(true);
    expect(result.outputTruncation.frames.truncated).toBe(true);
  }, 20_000);
});
