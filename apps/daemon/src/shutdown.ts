type ShutdownSignal = 'SIGINT' | 'SIGTERM';

type SignalSource = {
  once(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

type ParentPortSource = {
  on(event: 'message', listener: (event: unknown) => void): unknown;
};

export function installGracefulShutdown(input: {
  close(): Promise<void>;
  onError(error: unknown): void;
  signalSource?: SignalSource;
}): () => void {
  const signalSource = input.signalSource ?? process;
  let closeWork: Promise<void> | undefined;
  const close = () => {
    if (closeWork !== undefined) return;
    const keepAlive = setInterval(() => undefined, 1_000);
    closeWork = input.close()
      .catch(error => {
        input.onError(error);
      })
      .finally(() => {
        clearInterval(keepAlive);
      });
  };

  signalSource.once('SIGINT', close);
  signalSource.once('SIGTERM', close);

  return () => {
    signalSource.off('SIGINT', close);
    signalSource.off('SIGTERM', close);
  };
}

export function installParentPortShutdown(input: {
  close(): Promise<void>;
  exit(code: number): void;
  onError(error: unknown): void;
  parentPort?: ParentPortSource;
}): void {
  const parentPort = input.parentPort ?? (
    process as NodeJS.Process & { parentPort?: ParentPortSource }
  ).parentPort;
  let closeWork: Promise<void> | undefined;
  parentPort?.on('message', event => {
    const payload = isRecord(event) && 'data' in event ? event.data : event;
    if (!isRecord(payload) || payload.type !== 'shutdown' || closeWork !== undefined) {
      return;
    }
    closeWork = input.close().then(
      () => input.exit(0),
      error => {
        input.onError(error);
        input.exit(1);
      }
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
