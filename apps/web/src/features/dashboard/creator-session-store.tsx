import type {
  CreatorActionRequest,
  CreatorActivity,
  CreatorAgentApproval,
  CreatorAgentApprovalStatus,
  CreatorAgentItem,
  CreatorAgentSession,
  CreatorAgentTurn,
  CreatorAgentTurnRequest,
  CreatorEventEnvelope,
  CreatorJob,
  CreatorJson,
  CreatorStageRun
} from '@opencreator/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { CreatorWebService } from '../../services/creator-service.js';
import { createCreatorSnapshotSubscription } from '../../runtime/creator-sse.js';

type CreatorSessionContextValue = {
  job: CreatorJob;
  state: Record<string, CreatorJson>;
  conflictedFields: string[];
  error: CreatorSessionError | null;
  updateDraft(patch: Record<string, CreatorJson>, options?: { semantic?: boolean }): void;
  flush(): Promise<void>;
  clearError(): void;
  applyRemoteSnapshot(job: CreatorJob): void;
  applyAction(request: Omit<CreatorActionRequest, 'expectedRevision'>): Promise<void>;
  openArtifact(artifactId: string): Promise<Response>;
  agentSession: CreatorAgentSession | null;
  turns: CreatorAgentTurn[];
  items: CreatorAgentItem[];
  approvals: CreatorAgentApproval[];
  agentBusy: boolean;
  runAgentTurn(message: string, sandbox?: CreatorAgentTurnRequest['sandbox']): Promise<void>;
  steerAgentTurn(message: string): Promise<void>;
  interruptAgentTurn(): Promise<void>;
  respondAgentApproval(
    approvalId: string,
    decision: Extract<CreatorAgentApprovalStatus, 'approved' | 'rejected' | 'canceled'>,
    processGeneration: number
  ): Promise<void>;
};

export type CreatorSessionError = {
  code: string;
  message: string;
};

const CreatorSessionContext = createContext<CreatorSessionContextValue | null>(null);

export function CreatorSessionProvider(props: {
  initialJob: CreatorJob;
  service: Pick<CreatorWebService, 'applyAction' | 'runAgentTurn'> & Partial<Pick<CreatorWebService,
    | 'startAgentTurn'
    | 'steerAgentTurn'
    | 'interruptAgentTurn'
    | 'respondAgentApproval'
    | 'getAgentHistory'
    | 'getAgentTimeline'
    | 'getJob'
    | 'openArtifact'
    | 'subscribeJobEvents'>>;
  children: ReactNode;
}) {
  const [confirmedJob, setConfirmedJob] = useState(props.initialJob);
  const [draft, setDraft] = useState<Record<string, CreatorJson>>({});
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set());
  const [conflictedFields, setConflictedFields] = useState<string[]>([]);
  const [error, setError] = useState<CreatorSessionError | null>(null);
  const [agentSession, setAgentSession] = useState<CreatorAgentSession | null>(null);
  const [turns, setTurns] = useState<CreatorAgentTurn[]>([]);
  const [items, setItems] = useState<CreatorAgentItem[]>([]);
  const [approvals, setApprovals] = useState<CreatorAgentApproval[]>([]);
  const timerRef = useRef<number>();
  const confirmedRef = useRef(confirmedJob);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(dirtyFields);
  const timelineReloadWorkRef = useRef<Promise<void> | null>(null);
  const timelineReloadRequestedRef = useRef(false);
  confirmedRef.current = confirmedJob;
  draftRef.current = draft;
  dirtyRef.current = dirtyFields;

  const flush = useCallback(async () => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const fields = [...dirtyRef.current];
    if (fields.length === 0 || typeof props.service.applyAction !== 'function') return;
    const patch = Object.fromEntries(fields.map(field => [field, draftRef.current[field]])) as Record<string, CreatorJson>;
    try {
      const response = await props.service.applyAction(confirmedRef.current.id, {
        action: 'update-settings',
        expectedRevision: confirmedRef.current.revision,
        input: {
          patch,
          activityMode: 'draft',
          objectId: fields.sort().join(',')
        }
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setDraft(current => Object.fromEntries(
        Object.entries(current).filter(([field]) => !fields.includes(field))
      ) as Record<string, CreatorJson>);
      setDirtyFields(current => new Set([...current].filter(field => !fields.includes(field))));
      setConflictedFields(current => current.filter(field => !fields.includes(field)));
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    }
  }, [props.service]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  const updateDraft = useCallback((
    patch: Record<string, CreatorJson>,
    options: { semantic?: boolean } = {}
  ) => {
    setDraft(current => ({ ...current, ...patch }));
    setDirtyFields(current => new Set([...current, ...Object.keys(patch)]));
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void flush().catch(() => undefined);
    }, options.semantic === true ? 0 : 350);
  }, [flush]);

  const clearError = useCallback(() => setError(null), []);

  const applyRemoteSnapshot = useCallback((next: CreatorJob) => {
    const conflicts = [...dirtyRef.current].filter(field => (
      JSON.stringify(next.state[field]) !== JSON.stringify(draftRef.current[field])
    ));
    confirmedRef.current = next;
    setConfirmedJob(next);
    setConflictedFields(conflicts);
    setError(null);
  }, []);

  const loadAgentTimeline = useCallback(async () => {
    const jobId = confirmedRef.current.id;
    const response = props.service.getAgentTimeline !== undefined
      ? await props.service.getAgentTimeline(jobId)
      : props.service.getAgentHistory !== undefined
        ? await props.service.getAgentHistory(jobId)
        : undefined;
    if (response === undefined) return;
    setAgentSession(response.session);
    setTurns(response.turns);
    setItems(response.items);
    setApprovals(response.approvals);
  }, [props.service]);

  const reloadAgentTimeline = useCallback((): Promise<void> => {
    timelineReloadRequestedRef.current = true;
    if (timelineReloadWorkRef.current !== null) return timelineReloadWorkRef.current;
    const work = (async () => {
      try {
        while (timelineReloadRequestedRef.current) {
          timelineReloadRequestedRef.current = false;
          await loadAgentTimeline();
        }
      } finally {
        timelineReloadWorkRef.current = null;
      }
    })();
    timelineReloadWorkRef.current = work;
    return work;
  }, [loadAgentTimeline]);

  const applyLiveEvent = useCallback((event: CreatorEventEnvelope) => {
    const next = mergeCreatorEvent(confirmedRef.current, event);
    if (next === confirmedRef.current) return;
    confirmedRef.current = next;
    setConfirmedJob(next);
  }, []);

  useEffect(() => {
    if (props.service.getJob === undefined || props.service.subscribeJobEvents === undefined) return;
    const jobId = confirmedRef.current.id;
    const subscription = createCreatorSnapshotSubscription<CreatorJob, CreatorEventEnvelope>({
      loadSnapshot: async () => (await props.service.getJob!(jobId)).job,
      subscribe: (onEvent, onDisconnect) => (
        props.service.subscribeJobEvents!(jobId, onEvent, onDisconnect)
      ),
      onSnapshot: applyRemoteSnapshot,
      onEvent(event) {
        applyLiveEvent(event);
        if (event.kind.startsWith('agent_')) {
          void reloadAgentTimeline().catch(() => undefined);
        }
      },
      shouldReloadSnapshot(event) {
        return event.kind === 'snapshot_changed';
      }
    });
    void subscription.start().catch(() => undefined);
    return () => {
      subscription.close();
    };
  }, [applyLiveEvent, applyRemoteSnapshot, props.service, reloadAgentTimeline]);

  useEffect(() => {
    if (
      props.service.getAgentTimeline === undefined
      && props.service.getAgentHistory === undefined
    ) return;
    let closed = false;
    void reloadAgentTimeline().catch(() => undefined);
    return () => { closed = true; };
  }, [props.service, reloadAgentTimeline]);

  const applyAction = useCallback(async (
    request: Omit<CreatorActionRequest, 'expectedRevision'>
  ) => {
    try {
      await flush();
      const response = await props.service.applyAction(confirmedRef.current.id, {
        ...request,
        expectedRevision: confirmedRef.current.revision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    }
  }, [flush, props.service]);

  const openArtifact = useCallback((artifactId: string) => {
    if (props.service.openArtifact === undefined) {
      return Promise.reject(new Error('Creator artifact transport is unavailable'));
    }
    return props.service.openArtifact(confirmedRef.current.id, artifactId);
  }, [props.service]);

  const runAgentTurn = useCallback(async (
    message: string,
    sandbox?: CreatorAgentTurnRequest['sandbox']
  ) => {
    const content = message.trim();
    if (!content) return;
    try {
      await flush();
      const clientMessageId = createClientMessageId();
      const start = props.service.startAgentTurn ?? props.service.runAgentTurn;
      const response = await start(confirmedRef.current.id, {
        message: content,
        clientMessageId,
        ...(sandbox === undefined ? {} : { sandbox })
      });
      if (response.action !== undefined) {
        confirmedRef.current = response.action.job;
        setConfirmedJob(response.action.job);
      }
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [flush, props.service, reloadAgentTimeline]);

  const steerAgentTurn = useCallback(async (message: string) => {
    const content = message.trim();
    if (!content) return;
    if (props.service.steerAgentTurn === undefined) {
      throw new Error('Creator Agent steering is unavailable');
    }
    try {
      await flush();
      await props.service.steerAgentTurn(confirmedRef.current.id, {
        message: content,
        clientMessageId: createClientMessageId()
      });
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [flush, props.service, reloadAgentTimeline]);

  const interruptAgentTurn = useCallback(async () => {
    if (props.service.interruptAgentTurn === undefined) return;
    try {
      await props.service.interruptAgentTurn(confirmedRef.current.id);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [props.service, reloadAgentTimeline]);

  const respondAgentApproval = useCallback(async (
    approvalId: string,
    decision: Extract<CreatorAgentApprovalStatus, 'approved' | 'rejected' | 'canceled'>,
    processGeneration: number
  ) => {
    if (props.service.respondAgentApproval === undefined) return;
    try {
      await props.service.respondAgentApproval(
        confirmedRef.current.id,
        approvalId,
        { decision, processGeneration }
      );
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [props.service, reloadAgentTimeline]);

  const agentBusy = turns.some(turn => (
    turn.role === 'assistant'
    && ['queued', 'running', 'waiting_approval'].includes(turn.status)
  ));

  const value = useMemo<CreatorSessionContextValue>(() => ({
    job: confirmedJob,
    state: { ...confirmedJob.state, ...draft },
    conflictedFields,
    error,
    updateDraft,
    flush,
    clearError,
    applyRemoteSnapshot,
    applyAction,
    openArtifact,
    agentSession,
    turns,
    items,
    approvals,
    agentBusy,
    runAgentTurn,
    steerAgentTurn,
    interruptAgentTurn,
    respondAgentApproval
  }), [agentBusy, agentSession, applyAction, applyRemoteSnapshot, approvals, clearError, confirmedJob, conflictedFields, draft, error, flush, interruptAgentTurn, items, openArtifact, respondAgentApproval, runAgentTurn, steerAgentTurn, turns, updateDraft]);

  return (
    <CreatorSessionContext.Provider value={value}>
      {props.children}
    </CreatorSessionContext.Provider>
  );
}

function createClientMessageId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `creator-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mergeCreatorEvent(job: CreatorJob, event: CreatorEventEnvelope): CreatorJob {
  if (event.jobId !== job.id) return job;
  if (event.kind === 'stage_progress') {
    const stage = readCreatorStage(event.payload.stage, job.id);
    if (stage === null) return job;
    const index = job.stages.findIndex(candidate => candidate.id === stage.id);
    const stages = index < 0
      ? [...job.stages, stage]
      : job.stages.map(candidate => candidate.id === stage.id ? stage : candidate);
    return {
      ...job,
      stages,
      updatedAt: laterTimestamp(job.updatedAt, event.createdAt)
    };
  }
  if (event.kind === 'activity_changed') {
    const activity = readCreatorActivity(event.payload.activity, job.id);
    if (activity === null) return job;
    const activities = job.activities.some(candidate => candidate.id === activity.id)
      ? job.activities.map(candidate => candidate.id === activity.id ? activity : candidate)
      : [...job.activities, activity];
    return {
      ...job,
      activities,
      updatedAt: laterTimestamp(job.updatedAt, event.createdAt)
    };
  }
  return job;
}

function readCreatorStage(value: CreatorJson | undefined, jobId: string): CreatorStageRun | null {
  if (!isRecord(value) || value.jobId !== jobId || typeof value.id !== 'string') return null;
  if (typeof value.stageId !== 'string' || typeof value.status !== 'string') return null;
  return value as unknown as CreatorStageRun;
}

function readCreatorActivity(value: CreatorJson | undefined, jobId: string): CreatorActivity | null {
  if (!isRecord(value) || value.jobId !== jobId || typeof value.id !== 'string') return null;
  if (typeof value.action !== 'string' || typeof value.createdAt !== 'string') return null;
  return value as unknown as CreatorActivity;
}

function laterTimestamp(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function isRecord(value: CreatorJson | undefined): value is Record<string, CreatorJson> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

export function useCreatorSession(): CreatorSessionContextValue {
  const value = useContext(CreatorSessionContext);
  if (value === null) throw new Error('CreatorSessionProvider is required');
  return value;
}

export function useOptionalCreatorSession(): CreatorSessionContextValue | null {
  return useContext(CreatorSessionContext);
}

function toSessionError(cause: unknown): CreatorSessionError {
  const candidate = cause as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate?.code === 'string' ? candidate.code : 'creator_request_failed',
    message: typeof candidate?.message === 'string' ? candidate.message : 'Creator request failed'
  };
}
