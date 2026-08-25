import { nanoid } from 'nanoid';
import type { CreatorRepository } from './repository.js';
import type { CreatorStageRunner } from './stage-runner.js';

export type CreatorStageScheduler = ReturnType<typeof createCreatorStageScheduler>;

export function createCreatorStageScheduler(input: {
  repository: CreatorRepository;
  runner: Pick<CreatorStageRunner, 'runStageRun'>;
  owner?: string;
  leaseMs?: number;
  pollIntervalMs?: number;
  batchSize?: number;
  now?(): number;
  setInterval?(callback: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
}) {
  const owner = input.owner ?? `creator_scheduler_${nanoid()}`;
  const leaseMs = input.leaseMs ?? 30_000;
  const batchSize = input.batchSize ?? 8;
  const now = input.now ?? (() => Date.now());
  const setTimer = input.setInterval ?? ((callback, ms) => setInterval(callback, ms));
  const clearTimer = input.clearInterval ?? (handle => clearInterval(handle as NodeJS.Timeout));
  const active = new Map<string, Promise<void>>();
  let draining = false;
  let closed = false;
  let closeWork: Promise<void> | undefined;
  const timer = setTimer(() => wake(), input.pollIntervalMs ?? 1_000);
  unrefTimer(timer);

  function wake(): void {
    if (closed || draining) return;
    draining = true;
    void drain().finally(() => {
      draining = false;
      if (!closed && input.repository.listDispatchableStageRuns(
        new Date(now()).toISOString(),
        1
      ).length) wake();
    });
  }

  async function drain(): Promise<void> {
    const timestamp = new Date(now()).toISOString();
    const candidates = input.repository.listDispatchableStageRuns(timestamp, batchSize);
    for (const candidate of candidates) {
      if (closed || active.has(candidate.id)) continue;
      const claimed = input.repository.claimStageRun({
        id: candidate.id,
        owner,
        now: timestamp,
        expiresAt: new Date(now() + leaseMs).toISOString()
      });
      if (claimed === undefined) continue;
      const work = execute(claimed.id).finally(() => active.delete(claimed.id));
      active.set(claimed.id, work);
    }
  }

  async function execute(stageRunId: string): Promise<void> {
    const renewTimer = setTimer(() => {
      input.repository.renewStageRunClaim({
        id: stageRunId,
        owner,
        expiresAt: new Date(now() + leaseMs).toISOString()
      });
    }, Math.max(250, Math.floor(leaseMs / 3)));
    unrefTimer(renewTimer);
    try {
      await input.runner.runStageRun(stageRunId);
    } finally {
      clearTimer(renewTimer);
      input.repository.finishStageRunDispatch(stageRunId, owner);
    }
  }

  wake();
  return {
    owner,
    wake,
    async close() {
      if (closeWork !== undefined) return closeWork;
      closed = true;
      clearTimer(timer);
      closeWork = Promise.allSettled([...active.values()]).then(() => undefined);
      await closeWork;
    }
  };
}

function unrefTimer(handle: unknown): void {
  if (
    typeof handle === 'object'
    && handle !== null
    && 'unref' in handle
    && typeof handle.unref === 'function'
  ) {
    handle.unref();
  }
}
