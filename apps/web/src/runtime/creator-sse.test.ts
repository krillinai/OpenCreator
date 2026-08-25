import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorSnapshotSubscription } from './creator-sse.js';

describe('creator snapshot subscription', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads the latest snapshot before every reconnect subscription', async () => {
    vi.useFakeTimers();
    const snapshots = [{ revision: 1 }, { revision: 3 }];
    const loadSnapshot = vi.fn(async () => snapshots.shift()!);
    const subscribe = vi.fn((_onEvent: () => void, onDisconnect: () => void) => ({
      close: vi.fn(),
      disconnect: onDisconnect
    }));
    const received: number[] = [];
    const subscription = createCreatorSnapshotSubscription({
      loadSnapshot,
      subscribe,
      onSnapshot(snapshot) {
        received.push(snapshot.revision);
      }
    });

    await subscription.start();
    subscribe.mock.results[0]!.value.disconnect();
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    await subscription.whenIdle();

    expect(received).toEqual([1, 3]);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('reloads a snapshot for an event without replacing the live connection', async () => {
    const snapshots = [{ revision: 1 }, { revision: 2 }];
    const loadSnapshot = vi.fn(async () => snapshots.shift()!);
    let emit!: (event: unknown) => void;
    const subscribe = vi.fn((onEvent: (event: unknown) => void) => {
      emit = onEvent;
      return { close: vi.fn() };
    });
    const received: number[] = [];
    const subscription = createCreatorSnapshotSubscription({
      loadSnapshot,
      subscribe,
      onSnapshot(snapshot) {
        received.push(snapshot.revision);
      }
    });

    await subscription.start();
    emit({ id: 'activity:1' });
    await subscription.whenIdle();

    expect(received).toEqual([1, 2]);
    expect(subscribe).toHaveBeenCalledTimes(1);
    subscription.close();
  });

  it('coalesces dense events while a snapshot reload is in flight', async () => {
    const pending = deferred<{ revision: number }>();
    const loadSnapshot = vi.fn()
      .mockResolvedValueOnce({ revision: 1 })
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({ revision: 3 });
    let emit!: (event: unknown) => void;
    const subscription = createCreatorSnapshotSubscription({
      loadSnapshot,
      subscribe(onEvent) {
        emit = onEvent;
        return { close: vi.fn() };
      },
      onSnapshot: vi.fn()
    });

    await subscription.start();
    emit({ id: 'agent:1' });
    await waitForMicrotasks(() => loadSnapshot.mock.calls.length === 2);
    emit({ id: 'agent:2' });
    emit({ id: 'agent:3' });
    emit({ id: 'agent:4' });
    pending.resolve({ revision: 2 });
    await subscription.whenIdle();

    expect(loadSnapshot).toHaveBeenCalledTimes(3);
    subscription.close();
  });

  it('can consume an event without reloading the snapshot', async () => {
    const loadSnapshot = vi.fn(async () => ({ revision: 1 }));
    let emit!: (event: { kind: string }) => void;
    const onEvent = vi.fn();
    const subscription = createCreatorSnapshotSubscription({
      loadSnapshot,
      subscribe(receive) {
        emit = receive;
        return { close: vi.fn() };
      },
      onSnapshot: vi.fn(),
      onEvent,
      shouldReloadSnapshot: event => event.kind === 'snapshot_changed'
    });

    await subscription.start();
    emit({ kind: 'agent_item_changed' });
    await subscription.whenIdle();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    subscription.close();
  });

  it('backs off repeated disconnects and caps the reconnect delay', async () => {
    vi.useFakeTimers();
    const subscribe = vi.fn((_onEvent: () => void, onDisconnect: () => void) => {
      queueMicrotask(onDisconnect);
      return { close: vi.fn() };
    });
    const subscription = createCreatorSnapshotSubscription({
      loadSnapshot: vi.fn(async () => ({ revision: 1 })),
      subscribe,
      onSnapshot: vi.fn(),
      reconnectDelays: [10, 20]
    });

    await subscription.start();
    await Promise.resolve();
    expect(subscribe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await subscription.whenIdle();
    expect(subscribe).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(19);
    expect(subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await subscription.whenIdle();
    expect(subscribe).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(20);
    await subscription.whenIdle();
    expect(subscribe).toHaveBeenCalledTimes(4);
    subscription.close();
  });

  it('cancels a pending reconnect when closed', async () => {
    vi.useFakeTimers();
    let disconnect!: () => void;
    const subscribe = vi.fn((_onEvent: () => void, onDisconnect: () => void) => {
      disconnect = onDisconnect;
      return { close: vi.fn() };
    });
    const subscription = createCreatorSnapshotSubscription({
      loadSnapshot: vi.fn(async () => ({ revision: 1 })),
      subscribe,
      onSnapshot: vi.fn()
    });

    await subscription.start();
    disconnect();
    subscription.close();
    await vi.runAllTimersAsync();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitForMicrotasks(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition was not reached');
}
