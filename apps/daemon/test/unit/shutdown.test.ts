import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installGracefulShutdown } from '../../src/shutdown.js';

describe('graceful shutdown', () => {
  it('shares one server close across repeated shutdown signals', async () => {
    const signals = new EventEmitter();
    let releaseClose!: () => void;
    const closeBlocked = new Promise<void>(resolve => {
      releaseClose = resolve;
    });
    const close = vi.fn(() => closeBlocked);
    const onError = vi.fn();

    const uninstall = installGracefulShutdown({
      close,
      onError,
      signalSource: signals
    });

    signals.emit('SIGTERM');
    signals.emit('SIGINT');

    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    releaseClose();
    await closeBlocked;
    uninstall();
  });

  it('reports server close failures', async () => {
    const signals = new EventEmitter();
    const error = new Error('close failed');
    const onError = vi.fn();

    installGracefulShutdown({
      close: async () => {
        throw error;
      },
      onError,
      signalSource: signals
    });

    signals.emit('SIGTERM');
    await expect.poll(() => onError).toHaveBeenCalledWith(error);
  });
});
