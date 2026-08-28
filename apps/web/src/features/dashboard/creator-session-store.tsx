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
  updateDraft(
    patch: Record<string, CreatorJson>,
    options?: { semantic?: boolean; persist?: boolean }
  ): void;
  flush(): Promise<void>;
  clearError(): void;
  applyRemoteSnapshot(job: CreatorJob): void;
  applyAction(request: Omit<CreatorActionRequest, 'expectedRevision'>): Promise<void>;
  cancelJob(): Promise<void>;
  resumeJob(): Promise<void>;
  uploadSourceVideo(file: File): Promise<void>;
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
  ensureJob?: (state: Record<string, CreatorJson>) => Promise<CreatorJob>;
  service: Pick<CreatorWebService, 'applyAction' | 'runAgentTurn'> & Partial<Pick<CreatorWebService,
    | 'startAgentTurn'
    | 'steerAgentTurn'
    | 'interruptAgentTurn'
    | 'respondAgentApproval'
    | 'getAgentHistory'
    | 'getAgentTimeline'
    | 'getJob'
    | 'openArtifact'
    | 'uploadSourceVideo'
    | 'cancelJob'
    | 'resumeJob'
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
  const ensureJobWorkRef = useRef<Promise<CreatorJob> | null>(null);
  const flushWorkRef = useRef<Promise<void> | null>(null);
  const confirmedRef = useRef(confirmedJob);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(dirtyFields);
  const timelineReloadWorkRef = useRef<Promise<void> | null>(null);
  const timelineReloadRequestedRef = useRef(false);
  confirmedRef.current = confirmedJob;
  draftRef.current = draft;
  dirtyRef.current = dirtyFields;

  const ensurePersistedJob = useCallback((): Promise<CreatorJob> => {
    if (!isPendingCreatorJob(confirmedRef.current)) {
      return Promise.resolve(confirmedRef.current);
    }
    if (ensureJobWorkRef.current !== null) return ensureJobWorkRef.current;
    if (props.ensureJob === undefined) {
      return Promise.reject(new Error('Creator job persistence is unavailable'));
    }

    const capturedDraft = { ...draftRef.current };
    const creationState = { ...confirmedRef.current.state, ...capturedDraft };
    const work = props.ensureJob(creationState).then(next => {
      confirmedRef.current = next;
      setConfirmedJob(next);

      const currentDraft = draftRef.current;
      const remainingDraft = Object.fromEntries(Object.entries(currentDraft).filter(([field, value]) => (
        !(field in capturedDraft) || !sameCreatorJson(value, capturedDraft[field])
      ))) as Record<string, CreatorJson>;
      const remainingDirty = new Set([...dirtyRef.current].filter(field => (
        !(field in capturedDraft)
        || !sameCreatorJson(currentDraft[field], capturedDraft[field])
      )));
      draftRef.current = remainingDraft;
      dirtyRef.current = remainingDirty;
      setDraft(remainingDraft);
      setDirtyFields(remainingDirty);
      setConflictedFields([]);
      setError(null);
      return next;
    }).finally(() => {
      if (ensureJobWorkRef.current === work) ensureJobWorkRef.current = null;
    });
    ensureJobWorkRef.current = work;
    return work;
  }, [props.ensureJob]);

  const flush = useCallback((): Promise<void> => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (flushWorkRef.current !== null) return flushWorkRef.current;

    const work = (async () => {
      try {
        while (dirtyRef.current.size > 0) {
          if (isPendingCreatorJob(confirmedRef.current)) {
            await ensurePersistedJob();
            continue;
          }
          if (typeof props.service.applyAction !== 'function') return;

          const fields = [...dirtyRef.current];
          const capturedDraft = Object.fromEntries(
            fields.map(field => [field, draftRef.current[field]])
          ) as Record<string, CreatorJson>;
          const response = await props.service.applyAction(confirmedRef.current.id, {
            action: 'update-settings',
            expectedRevision: confirmedRef.current.revision,
            input: {
              patch: capturedDraft,
              activityMode: 'draft',
              objectId: [...fields].sort().join(',')
            }
          });
          confirmedRef.current = response.job;
          setConfirmedJob(response.job);

          const currentDraft = draftRef.current;
          const remainingDraft = Object.fromEntries(Object.entries(currentDraft).filter(([field, value]) => (
            !(field in capturedDraft) || !sameCreatorJson(value, capturedDraft[field])
          ))) as Record<string, CreatorJson>;
          const remainingDirty = new Set([...dirtyRef.current].filter(field => (
            !(field in capturedDraft)
            || !sameCreatorJson(currentDraft[field], capturedDraft[field])
          )));
          draftRef.current = remainingDraft;
          dirtyRef.current = remainingDirty;
          setDraft(remainingDraft);
          setDirtyFields(remainingDirty);
          setConflictedFields(current => current.filter(field => remainingDirty.has(field)));
        }
        setError(null);
      } catch (cause) {
        setError(toSessionError(cause));
        throw cause;
      }
    })().finally(() => {
      if (flushWorkRef.current === work) flushWorkRef.current = null;
    });
    flushWorkRef.current = work;
    return work;
  }, [ensurePersistedJob, props.service]);

  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
  }, []);

  const updateDraft = useCallback((
    patch: Record<string, CreatorJson>,
    options: { semantic?: boolean; persist?: boolean } = {}
  ) => {
    const currentState = { ...confirmedRef.current.state, ...draftRef.current };
    const changedPatch = Object.fromEntries(Object.entries(patch).filter(([field, value]) => (
      !sameCreatorJson(currentState[field], value)
    ))) as Record<string, CreatorJson>;
    const changedFields = Object.keys(changedPatch);
    if (changedFields.length === 0) return;

    const nextDraft = { ...draftRef.current, ...changedPatch };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    if (options.persist === false) return;

    const nextDirty = new Set([...dirtyRef.current, ...changedFields]);
    dirtyRef.current = nextDirty;
    setDirtyFields(nextDirty);
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
    if (isPendingCreatorJob(confirmedRef.current)) return;
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
    if (isPendingCreatorJob(confirmedJob)) return;
    const jobId = confirmedJob.id;
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
  }, [applyLiveEvent, applyRemoteSnapshot, confirmedJob.id, props.service, reloadAgentTimeline]);

  useEffect(() => {
    if (
      props.service.getAgentTimeline === undefined
      && props.service.getAgentHistory === undefined
    ) return;
    if (isPendingCreatorJob(confirmedJob)) return;
    void reloadAgentTimeline().catch(() => undefined);
  }, [confirmedJob.id, props.service, reloadAgentTimeline]);

  const applyAction = useCallback(async (
    request: Omit<CreatorActionRequest, 'expectedRevision'>
  ) => {
    try {
      await flush();
      await ensurePersistedJob();
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
  }, [ensurePersistedJob, flush, props.service]);

  const uploadSourceVideo = useCallback(async (file: File) => {
    if (props.service.uploadSourceVideo === undefined) {
      throw new Error('Creator source upload transport is unavailable');
    }
    try {
      await flush();
      await ensurePersistedJob();
      const response = await props.service.uploadSourceVideo(confirmedRef.current.id, {
        file,
        expectedRevision: confirmedRef.current.revision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    }
  }, [ensurePersistedJob, flush, props.service]);

  const cancelJob = useCallback(async () => {
    if (props.service.cancelJob === undefined) {
      throw new Error('Creator job cancellation is unavailable');
    }
    try {
      await ensurePersistedJob();
      const response = await props.service.cancelJob(confirmedRef.current.id);
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    }
  }, [ensurePersistedJob, props.service]);

  const resumeJob = useCallback(async () => {
    if (props.service.resumeJob === undefined) {
      throw new Error('Creator job resume is unavailable');
    }
    try {
      await flush();
      await ensurePersistedJob();
      const response = await props.service.resumeJob(confirmedRef.current.id);
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      throw cause;
    }
  }, [ensurePersistedJob, flush, props.service]);

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
      await ensurePersistedJob();
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
  }, [ensurePersistedJob, flush, props.service, reloadAgentTimeline]);

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
    cancelJob,
    resumeJob,
    uploadSourceVideo,
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
  }), [agentBusy, agentSession, applyAction, applyRemoteSnapshot, approvals, cancelJob, clearError, confirmedJob, conflictedFields, draft, error, flush, interruptAgentTurn, items, openArtifact, respondAgentApproval, resumeJob, runAgentTurn, steerAgentTurn, turns, updateDraft, uploadSourceVideo]);

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

function isPendingCreatorJob(job: CreatorJob): boolean {
  return job.id.startsWith('pending:');
}

function sameCreatorJson(left: CreatorJson | undefined, right: CreatorJson | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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
