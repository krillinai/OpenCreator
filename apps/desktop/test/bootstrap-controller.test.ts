import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapController } from '../src/main/bootstrap-controller.js';
import type { DaemonManager } from '../src/main/daemon-manager.js';
import type { DesktopLogger } from '../src/main/logger.js';
import type { SettingsStore } from '../src/main/settings-store.js';

vi.mock('../src/main/codex-resolver.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/main/codex-resolver.js')>(),
  resolveCodexEnvironment: vi.fn(async () => ({
    codexBin: '/test/codex', codexHome: '/test/home', defaultCwd: '/test/project',
    env: {}, source: 'bundled', version: '1.0', commit: null, runtimeRoot: '/test/runtime'
  }))
}));

afterEach(() => vi.useRealTimers());

function fixture() {
  const daemon = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  daemon.start = vi.fn(async () => undefined);
  daemon.restart = vi.fn(async () => undefined);
  daemon.stop = vi.fn(async () => undefined);
  const controller = new BootstrapController({
    daemon: daemon as unknown as DaemonManager,
    logger: { info: vi.fn(), error: vi.fn() } as unknown as DesktopLogger,
    settings: { read: () => ({}), update: vi.fn() } as unknown as SettingsStore,
    daemonEntryPath: '/test/daemon', appHome: '/test', dataDir: '/test/data',
    codexRuntimeRoot: '/test/codex', creatorRuntimeRoot: '/test/creator', creatorPresetAssetsRoot: '/test/web/creator-presets', stickmanRuntimeRoot: '/test/stickman',
    defaultProjectRoot: '/test/projects', development: false, automaticRestartDelays: [10, 20, 30]
  });
  controller.on('ready', () => controller.markWorkspaceReady());
  const crash = () => daemon.emit('exit', { reason: 'unexpected', code: 1 });
  return { daemon, controller, crash };
}

describe('Desktop Runtime recovery', () => {
  it('bounds automatic recovery, backs off, and resets the budget after manual restart', async () => {
    vi.useFakeTimers();
    const input = fixture();
    await input.controller.start();
    expect(input.daemon.start).toHaveBeenCalledWith(expect.objectContaining({
      creatorPresetAssetsRoot: '/test/web/creator-presets'
    }));
    for (const delay of [10, 20, 30]) {
      input.crash();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(input.controller.currentState.phase).toBe('starting_daemon');
      await vi.advanceTimersByTimeAsync(1);
      expect(input.controller.currentState.phase).toBe('ready');
    }
    input.crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(input.controller.currentState).toMatchObject({ phase: 'failed', error: { code: 'DAEMON_RESTART_EXHAUSTED' } });
    expect(input.daemon.start).toHaveBeenCalledTimes(4);
    await input.controller.restartRuntime();
    input.crash();
    await vi.advanceTimersByTimeAsync(10);
    expect(input.controller.currentState.phase).toBe('ready');
    expect(input.daemon.start).toHaveBeenCalledTimes(6);
    expect(input.daemon.start.mock.calls.slice(1).every(call => call[0].requireProbe === false)).toBe(true);
    await input.controller.stop();
  });

  it('retries failed recovery starts and cancels queued recovery on shutdown', async () => {
    vi.useFakeTimers();
    const input = fixture();
    await input.controller.start();
    input.daemon.start.mockRejectedValueOnce(new Error('temporary start failure'));
    input.crash();
    await vi.advanceTimersByTimeAsync(10);
    expect(input.controller.currentState.phase).toBe('starting_daemon');
    await vi.advanceTimersByTimeAsync(20);
    expect(input.controller.currentState.phase).toBe('ready');
    input.crash();
    await input.controller.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(input.daemon.start).toHaveBeenCalledTimes(3);
  });

  it('cancels a pending automatic restart before manually restarting and reports a real failure', async () => {
    vi.useFakeTimers();
    const input = fixture();
    await input.controller.start();
    input.crash();
    await input.controller.restartRuntime();
    await vi.advanceTimersByTimeAsync(100);
    expect(input.daemon.start).toHaveBeenCalledTimes(2);
    input.daemon.start.mockRejectedValueOnce(new Error('cannot start'));
    await expect(input.controller.restartRuntime()).rejects.toThrow('cannot start');
    expect(input.controller.currentState.phase).toBe('failed');
    await input.controller.stop();
  });

  it.each(['stop', 'restartRuntime'] as const)('cancels an in-flight recovery start before waiting for %s', async operation => {
    vi.useFakeTimers();
    const input = fixture();
    await input.controller.start();
    let rejectStart: ((error: Error) => void) | undefined;
    input.daemon.start.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStart = reject; }));
    input.daemon.stop.mockImplementation(async () => { rejectStart?.(new Error('stopped')); });
    input.crash();
    await vi.advanceTimersByTimeAsync(10);
    expect(rejectStart).toBeDefined();
    await input.controller[operation]();
    expect(input.daemon.stop).toHaveBeenCalled();
    if (operation === 'restartRuntime') expect(input.controller.currentState.phase).toBe('ready');
    await input.controller.stop();
  });
});
