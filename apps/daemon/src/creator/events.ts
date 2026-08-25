import type {
  CreatorAgentEvent,
  CreatorEventEnvelope,
  CreatorEventKind,
  CreatorJson,
  CreatorStageRun
} from '@opencreator/protocol';
import { createHash } from 'node:crypto';

export type CreatorEventHub = ReturnType<typeof createCreatorEventHub>;

export function createCreatorEventHub() {
  const subscribers = new Map<string, Set<(event: CreatorEventEnvelope) => void>>();
  return {
    publish(input: {
      id?: string;
      jobId: string;
      revision: number;
      kind: CreatorEventKind;
      payload?: Record<string, CreatorJson>;
      createdAt?: string;
    }): CreatorEventEnvelope {
      const event: CreatorEventEnvelope = {
        id: input.id ?? `${input.kind}:${input.revision}`,
        jobId: input.jobId,
        revision: input.revision,
        kind: input.kind,
        payload: input.payload ?? {},
        createdAt: input.createdAt ?? new Date().toISOString()
      };
      for (const subscriber of subscribers.get(input.jobId) ?? []) subscriber(event);
      return event;
    },
    subscribe(jobId: string, subscriber: (event: CreatorEventEnvelope) => void): () => void {
      const listeners = subscribers.get(jobId) ?? new Set();
      listeners.add(subscriber);
      subscribers.set(jobId, listeners);
      return () => {
        listeners.delete(subscriber);
        if (listeners.size === 0) subscribers.delete(jobId);
      };
    }
  };
}

export function creatorStageEventId(stage: CreatorStageRun): string {
  const digest = createHash('sha256').update(JSON.stringify({
    status: stage.status,
    dispatchStatus: stage.dispatchStatus,
    attempt: stage.attempt,
    progress: stage.progress,
    errorCode: stage.errorCode,
    startedAt: stage.startedAt,
    finishedAt: stage.finishedAt
  })).digest('hex').slice(0, 16);
  return `stage:${stage.id}:${digest}`;
}

export function creatorAgentEventKind(event: CreatorAgentEvent): CreatorEventKind {
  if (event.type === 'approval') return 'agent_approval_changed';
  if (event.type === 'item') return 'agent_item_changed';
  return 'agent_turn_changed';
}
