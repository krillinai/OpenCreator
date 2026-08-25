export function createCreatorSnapshotSubscription<T, Event = unknown>(input: {
  loadSnapshot(): Promise<T>;
  subscribe(onEvent: (event: Event) => void, onDisconnect: () => void): { close(): void };
  onSnapshot(snapshot: T): void;
  onEvent?(event: Event): void;
  shouldReloadSnapshot?(event: Event): boolean;
  onError?(error: unknown): void;
  reconnectDelays?: readonly number[];
}) {
  const reconnectDelays = input.reconnectDelays ?? [250, 500, 1_000, 2_000, 5_000];
  let closed = false;
  let connection: { close(): void } | undefined;
  let work: Promise<void> = Promise.resolve();
  let reloadRequested = false;
  let reloadScheduled = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const reloadSnapshot = async () => {
    if (closed) return;
    const snapshot = await input.loadSnapshot();
    if (closed) return;
    input.onSnapshot(snapshot);
  };

  const connect = async () => {
    await reloadSnapshot();
    if (closed) return;
    connection?.close();
    connection = input.subscribe(
      event => {
        reconnectAttempt = 0;
        input.onEvent?.(event);
        if (input.shouldReloadSnapshot?.(event) ?? true) scheduleReload();
      },
      () => scheduleReconnect()
    );
  };

  const scheduleReload = () => {
    if (closed) return;
    reloadRequested = true;
    if (reloadScheduled) return;
    reloadScheduled = true;
    work = work
      .then(async () => {
        try {
          while (!closed && reloadRequested) {
            reloadRequested = false;
            await reloadSnapshot();
          }
        } finally {
          reloadScheduled = false;
        }
      })
      .catch(error => {
        input.onError?.(error);
        if (reloadRequested) scheduleReload();
      });
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== undefined) return;
    connection?.close();
    connection = undefined;
    const delayIndex = Math.min(reconnectAttempt, Math.max(0, reconnectDelays.length - 1));
    const delay = reconnectDelays[delayIndex] ?? 5_000;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      if (closed) return;
      work = work
        .then(connect)
        .catch(error => {
          input.onError?.(error);
          scheduleReconnect();
        });
    }, delay);
  };

  return {
    async start(): Promise<void> {
      work = connect();
      await work;
    },
    async whenIdle(): Promise<void> {
      await work;
    },
    close(): void {
      closed = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      connection?.close();
      connection = undefined;
    }
  };
}
