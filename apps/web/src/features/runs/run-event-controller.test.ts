import type { AgentEventEnvelope } from '@opencreator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubscribeRunEventsInput } from '../../runtime/sse.js';
import { createRunEventController } from './run-event-controller.js';

describe('run event controller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects from the latest sequence and ignores duplicate events', async () => {
    vi.useFakeTimers();
    const subscriptions: SubscribeRunEventsInput[] = [];
    const received: number[] = [];
    const states: string[] = [];
    const subscribe = vi.fn(async (input: SubscribeRunEventsInput) => {
      subscriptions.push(input);
      if (subscriptions.length === 1) {
        input.onEvent(createEvent(2));
        input.onEvent(createEvent(2));
        return;
      }
      input.onEvent(createEvent(3));
      input.onEvent(createDoneEvent(4));
    });
    const controller = createRunEventController({
      subscribe,
      reconnectDelays: [500, 1_000]
    });

    controller.start({
      baseUrl: 'https://runtime.test',
      token: 'token',
      runId: 'run_1',
      fromSeq: 1,
      onEvent: event => received.push(event.seq),
      onStateChange: state => states.push(state),
      onError: error => {
        throw error;
      }
    });

    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));
    expect(subscriptions[0]?.fromSeq).toBe(1);
    expect(received).toEqual([2]);

    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(subscriptions).toHaveLength(2));

    expect(subscriptions[1]?.fromSeq).toBe(2);
    expect(received).toEqual([2, 3, 4]);
    expect(states).toEqual(['connecting', 'connected', 'reconnecting', 'connected', 'idle']);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(subscriptions).toHaveLength(2);
  });

  it('stops after the configured reconnect attempts and reports one final error', async () => {
    vi.useFakeTimers();
    const errors: Error[] = [];
    const states: string[] = [];
    const subscribe = vi.fn(async () => {
      throw new Error('connection lost');
    });
    const controller = createRunEventController({
      subscribe,
      reconnectDelays: [500, 1_000]
    });

    controller.start({
      baseUrl: 'https://runtime.test',
      token: 'token',
      runId: 'run_1',
      onEvent: () => undefined,
      onStateChange: state => states.push(state),
      onError: error => errors.push(error)
    });

    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(3));

    expect(errors.map(error => error.message)).toEqual(['connection lost']);
    expect(states).toEqual([
      'connecting',
      'reconnecting',
      'disconnected'
    ]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(subscribe).toHaveBeenCalledTimes(3);
  });

  it('does not reconnect after an active stop', async () => {
    vi.useFakeTimers();
    let subscription: SubscribeRunEventsInput | undefined;
    const subscribe = vi.fn(async (input: SubscribeRunEventsInput) => {
      subscription = input;
      await new Promise<void>(resolve => {
        input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    const controller = createRunEventController({
      subscribe,
      reconnectDelays: [500]
    });

    controller.start({
      baseUrl: 'https://runtime.test',
      token: 'token',
      runId: 'run_1',
      onEvent: () => undefined,
      onStateChange: () => undefined,
      onError: error => {
        throw error;
      }
    });

    await vi.waitFor(() => expect(subscription).toBeDefined());
    controller.stop();

    expect(subscription?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores callbacks from a replaced subscription generation', async () => {
    const subscriptions: SubscribeRunEventsInput[] = [];
    const received: string[] = [];
    const subscribe = vi.fn(async (input: SubscribeRunEventsInput) => {
      subscriptions.push(input);
      await new Promise<void>(resolve => {
        input.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
    });
    const controller = createRunEventController({ subscribe });
    const start = (runId: string) => controller.start({
      baseUrl: 'https://runtime.test',
      token: 'token',
      runId,
      onEvent: event => received.push(event.runId),
      onStateChange: () => undefined,
      onError: error => {
        throw error;
      }
    });

    start('run_1');
    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));
    start('run_2');
    await vi.waitFor(() => expect(subscriptions).toHaveLength(2));

    subscriptions[0]?.onEvent(createEvent(1, 'run_1'));
    subscriptions[1]?.onEvent(createEvent(1, 'run_2'));

    expect(received).toEqual(['run_2']);
    controller.stop();
  });
});

function createEvent(seq: number, runId = 'run_1'): AgentEventEnvelope {
  return {
    id: `event_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date(0).toISOString(),
    type: 'assistant_message',
    payload: {
      type: 'assistant_message',
      text: `message ${seq}`,
      format: 'plain_text',
      delivery: 'message'
    },
    normalizerVersion: 1
  };
}

function createDoneEvent(seq: number, runId = 'run_1'): AgentEventEnvelope {
  return {
    id: `event_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date(0).toISOString(),
    type: 'done',
    payload: {
      type: 'done',
      status: 'succeeded',
      terminationReason: 'completed'
    },
    normalizerVersion: 1
  };
}
