import {
  isOpenCreatorIssue,
  type OpenCreatorIssue,
  CreatorActionRequest,
  CreatorActivity,
  CreatorAgentApproval,
  CreatorAgentApprovalStatus,
  CreatorAgentItem,
  CreatorAgentSession,
  CreatorAgentTurn,
  CreatorAgentTurnRequest,
  CreatorArtifact,
  CreatorEventEnvelope,
  CreatorJob,
  CreatorJson,
  CreatorPreflightResponse,
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
import { normalizePageIssue } from '../issues/page-issue-state.js';
import { presentIssue } from '../issues/issue-catalog.js';

export type CreatorSessionContextValue = {
  job: CreatorJob;
  state: Record<string, CreatorJson>;
  conflictedFields: string[];
  error: CreatorSessionError | null;
  issues: OpenCreatorIssue[];
  focusedIssue: OpenCreatorIssue | null;
  preflight: CreatorPreflightResponse | null;
  runPreflight(stageId: string): Promise<CreatorPreflightResponse>;
  updateDraft(
    patch: Record<string, CreatorJson>,
    options?: { semantic?: boolean; persist?: boolean }
  ): void;
  flush(): Promise<void>;
  clearError(): void;
  captureCreatorFailure(
    operation: string,
    cause: unknown,
    fallbackMessage?: string,
    source?: 'upload' | 'preflight' | 'agent' | 'client'
  ): OpenCreatorIssue;
  repairIssue(issue: OpenCreatorIssue): Promise<void>;
  focusIssue(issue: OpenCreatorIssue | null): void;
  askPendingIssue(question: string, issue: OpenCreatorIssue): void;
  applyRemoteSnapshot(job: CreatorJob): void;
  applyAction(request: Omit<CreatorActionRequest, 'expectedRevision'>): Promise<CreatorJob>;
  cancelJob(): Promise<void>;
  resumeJob(): Promise<void>;
  uploadSourceVideo(file: File): Promise<void>;
  uploadReferenceImage(file: File): Promise<void>;
  uploadArticleImage(file: File): Promise<CreatorArtifact>;
  uploadSourceDocument(file: File): Promise<void>;
  openArtifact(artifactId: string): Promise<Response>;
  openArtifactJson<T = unknown>(artifactId: string): Promise<T>;
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

type CreatorClientFailureSession = Pick<
  CreatorSessionContextValue,
  'captureCreatorFailure' | 'openArtifact'
>;

export async function captureCreatorClientFailure<T>(
  session: Pick<CreatorSessionContextValue, 'captureCreatorFailure'> | null | undefined,
  operation: string,
  fallbackMessage: string,
  task: () => T | Promise<T>
): Promise<T> {
  try {
    return await task();
  } catch (cause) {
    session?.captureCreatorFailure(operation, cause, fallbackMessage, 'client');
    throw cause;
  }
}

export async function readCreatorArtifactText(
  session: CreatorClientFailureSession,
  artifactId: string,
  operation: string,
  fallbackMessage: string
): Promise<string> {
  const response = await session.openArtifact(artifactId);
  return captureCreatorClientFailure(session, operation, fallbackMessage, async () => {
    if (!response.ok) throw new Error(`Creator artifact request failed: ${response.status}`);
    return response.text();
  });
}

export async function createCreatorArtifactObjectUrl(
  session: CreatorClientFailureSession,
  artifactId: string,
  operation: string,
  fallbackMessage: string
): Promise<string> {
  const response = await session.openArtifact(artifactId);
  return captureCreatorClientFailure(session, operation, fallbackMessage, async () => {
    if (!response.ok) throw new Error(`Creator artifact request failed: ${response.status}`);
    return URL.createObjectURL(await response.blob());
  });
}

export type CreatorSessionError = {
  code: string;
  message: string;
};

export class CreatorPreflightBlockedError extends Error {
  constructor(readonly result: CreatorPreflightResponse) {
    super('Creator preflight blocked this stage');
    this.name = 'CreatorPreflightBlockedError';
  }
}

const CreatorSessionContext = createContext<CreatorSessionContextValue | null>(null);

export function CreatorSessionProvider(props: {
  initialJob: CreatorJob;
  ensureJob?: (state: Record<string, CreatorJson>) => Promise<CreatorJob>;
  onPreJobFailure?(operation: string, cause: unknown, fallbackMessage: string): void;
  onAskPendingIssue?(issue: OpenCreatorIssue, question: string): void;
  externalIssues?: OpenCreatorIssue[];
  service: Pick<CreatorWebService, 'applyAction' | 'runAgentTurn'> & Partial<Pick<CreatorWebService,
    | 'startAgentTurn'
    | 'steerAgentTurn'
    | 'interruptAgentTurn'
    | 'respondAgentApproval'
    | 'getAgentHistory'
    | 'getAgentTimeline'
    | 'getJob'
    | 'listIssues'
    | 'reportClientIssue'
    | 'openArtifact'
    | 'uploadReferenceImage'
    | 'uploadArticleImage'
    | 'uploadSourceVideo'
    | 'uploadSourceDocument'
    | 'cancelJob'
    | 'resumeJob'
    | 'preflight'
    | 'subscribeJobEvents'>>;
  children: ReactNode;
}) {
  const [confirmedJob, setConfirmedJob] = useState(props.initialJob);
  const [draft, setDraft] = useState<Record<string, CreatorJson>>({});
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set());
  const [conflictedFields, setConflictedFields] = useState<string[]>([]);
  const [error, setError] = useState<CreatorSessionError | null>(null);
  const [localIssues, setLocalIssues] = useState<OpenCreatorIssue[]>([]);
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<CreatorPreflightResponse | null>(null);
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
  const artifactJsonCacheRef = useRef(new Map<string, Promise<unknown>>());
  const localIssuesRef = useRef(localIssues);
  const capturedIssueByCauseRef = useRef(new WeakMap<object, OpenCreatorIssue>());
  const captureFailureRef = useRef<CreatorSessionContextValue['captureCreatorFailure'] | null>(null);
  confirmedRef.current = confirmedJob;
  draftRef.current = draft;
  dirtyRef.current = dirtyFields;
  localIssuesRef.current = localIssues;

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
      let requestRevision = confirmedRef.current.revision;
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
          requestRevision = confirmedRef.current.revision;
          const response = await props.service.applyAction(confirmedRef.current.id, {
            action: 'update-settings',
            expectedRevision: requestRevision,
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
        if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
          setError(toSessionError(cause));
          captureFailureRef.current?.('creator.update-settings', cause);
        }
        throw cause;
      }
    })().finally(() => {
      if (flushWorkRef.current === work) flushWorkRef.current = null;
    });
    flushWorkRef.current = work;
    return work;
  }, [ensurePersistedJob, props.service]);

  useEffect(() => () => {
    if (dirtyRef.current.size === 0) {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      return;
    }
    void flush().catch(() => undefined);
  }, [flush]);

  const artifactIdentity = confirmedJob.artifacts
    .map(artifact => `${artifact.id}:${artifact.status}`)
    .join('|');
  useEffect(() => {
    artifactJsonCacheRef.current.clear();
  }, [artifactIdentity, confirmedJob.id]);

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

  const acceptAuthoritativeIssue = useCallback((issue: OpenCreatorIssue) => {
    if (issue.scope.kind !== 'creator-job' || issue.scope.jobId !== confirmedRef.current.id) return;
    const replacedIds = new Set(localIssuesRef.current
      .filter(candidate => candidate.fingerprint === issue.fingerprint)
      .map(candidate => candidate.id));
    const next = mergeIssueIntoJob(confirmedRef.current, issue);
    confirmedRef.current = next;
    setConfirmedJob(next);
    setLocalIssues(current => current.filter(candidate => candidate.fingerprint !== issue.fingerprint));
    setFocusedIssueId(current => current !== null && replacedIds.has(current) ? issue.id : current);
  }, []);

  const reportLocalIssue = useCallback((issue: OpenCreatorIssue) => {
    if (
      props.service.reportClientIssue === undefined
      || isPendingCreatorJob(confirmedRef.current)
      || issue.scope.kind !== 'creator-job'
    ) return;
    void props.service.reportClientIssue(confirmedRef.current.id, {
      clientIssueId: issue.id,
      code: issue.code,
      source: issue.source === 'upload' || issue.source === 'preflight' || issue.source === 'agent'
        ? issue.source
        : 'client',
      ...(issue.operation === undefined ? {} : { operation: issue.operation }),
      ...(issue.stageId === undefined ? {} : { stageId: issue.stageId }),
      ...(issue.scopeKey === undefined ? {} : { scopeKey: issue.scopeKey }),
      fallbackMessage: issue.fallbackMessage
    }).then(response => {
      setLocalIssues(current => current.filter(candidate => candidate.id !== response.clientIssueId));
      setFocusedIssueId(current => current === response.clientIssueId ? response.issue.id : current);
      acceptAuthoritativeIssue(response.issue);
    }).catch(() => undefined);
  }, [acceptAuthoritativeIssue, props.service]);

  const captureCreatorFailure = useCallback((
    operation: string,
    cause: unknown,
    fallbackMessage = '操作未完成，请在 Agent 区域查看诊断。',
    source: 'upload' | 'preflight' | 'agent' | 'client' = 'client'
  ): OpenCreatorIssue => {
    const causeObject = typeof cause === 'object' && cause !== null ? cause : undefined;
    const captured = causeObject === undefined
      ? undefined
      : capturedIssueByCauseRef.current.get(causeObject);
    if (captured !== undefined) return captured;
    if (confirmedRef.current.id.startsWith('pending:')) {
      const pageIssue = normalizePageIssue('creator-launch', operation, cause, fallbackMessage);
      if (causeObject !== undefined) capturedIssueByCauseRef.current.set(causeObject, pageIssue);
      props.onPreJobFailure?.(operation, cause, fallbackMessage);
      return pageIssue;
    }
    const candidate = (cause as { issue?: unknown } | null)?.issue;
    if (
      isOpenCreatorIssue(candidate)
      && candidate.scope.kind === 'creator-job'
      && candidate.scope.jobId === confirmedRef.current.id
    ) {
      acceptAuthoritativeIssue(candidate);
      if (causeObject !== undefined) capturedIssueByCauseRef.current.set(causeObject, candidate);
      return candidate;
    }
    const pageIssue = normalizePageIssue(
      'creator-session',
      operation,
      isOpenCreatorIssue(candidate) && candidate.scope.kind === 'creator-job'
        ? new Error('Creator issue scope mismatch')
        : cause,
      fallbackMessage
    );
    const issue: OpenCreatorIssue = {
      ...pageIssue,
      id: pageIssue.id.replace(/^page:/, 'local:'),
      scope: { kind: 'creator-job', jobId: confirmedRef.current.id },
      source,
      repairActions: [{ kind: 'focus-agent' }]
    };
    if (causeObject !== undefined) capturedIssueByCauseRef.current.set(causeObject, issue);
    setLocalIssues(current => {
      const previous = current.find(item => item.fingerprint === issue.fingerprint);
      if (previous === undefined) return [...current, issue];
      return current.map(item => item.id === previous.id ? {
        ...issue,
        id: previous.id,
        diagnosticId: previous.diagnosticId,
        occurredAt: previous.occurredAt,
        occurrenceCount: previous.occurrenceCount + 1
      } : item);
    });
    reportLocalIssue(issue);
    return issue;
  }, [acceptAuthoritativeIssue, props.onPreJobFailure, reportLocalIssue]);
  captureFailureRef.current = captureCreatorFailure;

  const focusIssue = useCallback((issue: OpenCreatorIssue | null) => {
    setFocusedIssueId(issue?.id ?? '');
  }, []);

  const askPendingIssue = useCallback((question: string, issue: OpenCreatorIssue) => {
    if (props.onAskPendingIssue === undefined) throw new Error('Agent inquiry is unavailable before task creation');
    props.onAskPendingIssue(issue, question);
  }, [props.onAskPendingIssue]);

  const runPreflight = useCallback(async (stageId: string) => {
    if (props.service.preflight === undefined) {
      const cause = new Error('Creator preflight is unavailable');
      captureCreatorFailure('creator.preflight', cause, '启动条件检查暂不可用，请稍后重试。', 'preflight');
      throw cause;
    }
    await flush();
    await ensurePersistedJob();
    try {
      const result = await props.service.preflight(confirmedRef.current.id, stageId);
      setPreflight(result);
      if (!result.canStart) throw new CreatorPreflightBlockedError(result);
      return result;
    } catch (cause) {
      captureCreatorFailure('creator.preflight', cause, '启动条件检查未通过，请查看诊断并修正后重试。', 'preflight');
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, props.service]);

  const applyRemoteSnapshot = useCallback((next: CreatorJob) => {
    const conflicts = [...dirtyRef.current].filter(field => (
      JSON.stringify(next.state[field]) !== JSON.stringify(draftRef.current[field])
    ));
    confirmedRef.current = next;
    setConfirmedJob(next);
    const authoritativeByFingerprint = new Map(
      (next.issues ?? []).map(issue => [issue.fingerprint, issue] as const)
    );
    const replacedLocalIds = new Map(localIssuesRef.current.flatMap(issue => {
      const authoritative = authoritativeByFingerprint.get(issue.fingerprint);
      return authoritative === undefined ? [] : [[issue.id, authoritative.id] as const];
    }));
    setLocalIssues(current => current.filter(issue => !authoritativeByFingerprint.has(issue.fingerprint)));
    setFocusedIssueId(current => current === null ? null : replacedLocalIds.get(current) ?? current);
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
    if (event.kind === 'issue_changed' && isOpenCreatorIssue(event.payload.issue)) {
      acceptAuthoritativeIssue(event.payload.issue);
      return;
    }
    const next = mergeCreatorEvent(confirmedRef.current, event);
    if (next === confirmedRef.current) return;
    confirmedRef.current = next;
    setConfirmedJob(next);
  }, [acceptAuthoritativeIssue]);

  useEffect(() => {
    if (props.service.getJob === undefined || props.service.subscribeJobEvents === undefined) return;
    if (isPendingCreatorJob(confirmedJob)) return;
    const jobId = confirmedJob.id;
    const subscription = createCreatorSnapshotSubscription<CreatorJob, CreatorEventEnvelope>({
      loadSnapshot: async () => (await props.service.getJob!(jobId)).job,
      subscribe: (onEvent, onDisconnect) => (
        props.service.subscribeJobEvents!(jobId, onEvent, onDisconnect)
      ),
      onSnapshot(snapshot) {
        applyRemoteSnapshot(snapshot);
        const authoritativeFingerprints = new Set(
          (snapshot.issues ?? []).map(issue => issue.fingerprint)
        );
        for (const issue of localIssuesRef.current) {
          if (!authoritativeFingerprints.has(issue.fingerprint)) reportLocalIssue(issue);
        }
        // A reconnect can miss the Agent event that completed the active turn.
        // Reconcile the timeline whenever the authoritative job snapshot reloads.
        void reloadAgentTimeline().catch(() => undefined);
      },
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
  }, [applyLiveEvent, applyRemoteSnapshot, confirmedJob.id, props.service, reloadAgentTimeline, reportLocalIssue]);

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
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      if (request.action === 'run-stage' && props.service.preflight !== undefined) {
        const stageId = request.input.stageId;
        if (typeof stageId === 'string') await runPreflight(stageId);
      }
      const response = await props.service.applyAction(confirmedRef.current.id, {
        ...request,
        expectedRevision: requestRevision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
      return response.job;
    } catch (cause) {
      const nextError = toSessionError(cause);
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(nextError);
        captureCreatorFailure('creator.action', cause);
        if (
          nextError.code === 'creator_revision_conflict'
          && props.service.getJob !== undefined
        ) {
          const response = await props.service.getJob(confirmedRef.current.id).catch(() => undefined);
          if (response !== undefined) applyRemoteSnapshot(response.job);
        }
      }
      throw cause;
    }
  }, [applyRemoteSnapshot, captureCreatorFailure, ensurePersistedJob, flush, props.service, runPreflight]);

  const repairIssue = useCallback(async (issue: OpenCreatorIssue) => {
    const action = issue.repairActions.find(candidate => (
      candidate.kind === 'retry-operation'
      && candidate.operationId === 'creator.retry-stage'
    ));
    if (action === undefined || issue.stageId === undefined || issue.status !== 'open') return;
    await applyAction({
      action: 'run-stage',
      input: { stageId: issue.stageId },
      repairIssueId: issue.id
    });
  }, [applyAction]);

  const uploadSourceVideo = useCallback(async (file: File) => {
    if (props.service.uploadSourceVideo === undefined) {
      const cause = new Error('Creator source upload transport is unavailable');
      captureCreatorFailure('creator.upload-source-video', cause, '源视频上传暂不可用，请稍后重试。', 'upload');
      throw cause;
    }
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      const response = await props.service.uploadSourceVideo(confirmedRef.current.id, {
        file,
        expectedRevision: requestRevision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.upload-source-video', cause, '源视频上传未完成，请检查文件后重试。', 'upload');
      }
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, props.service]);

  const uploadReferenceImage = useCallback(async (file: File) => {
    if (props.service.uploadReferenceImage === undefined) {
      const cause = new Error('Creator reference upload transport is unavailable');
      captureCreatorFailure('creator.upload-reference-image', cause, '参考图上传暂不可用，请稍后重试。', 'upload');
      throw cause;
    }
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      const response = await props.service.uploadReferenceImage(confirmedRef.current.id, {
        file,
        expectedRevision: requestRevision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.upload-reference-image', cause, '参考图上传未完成，请检查文件后重试。', 'upload');
      }
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, props.service]);

  const uploadArticleImage = useCallback(async (file: File): Promise<CreatorArtifact> => {
    if (props.service.uploadArticleImage === undefined) {
      const cause = new Error('Creator article image upload transport is unavailable');
      captureCreatorFailure('creator.upload-article-image', cause, '文章图片上传暂不可用，请稍后重试。', 'upload');
      throw cause;
    }
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      const response = await props.service.uploadArticleImage(confirmedRef.current.id, {
        file,
        expectedRevision: requestRevision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
      return response.artifact;
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.upload-article-image', cause, '文章图片上传未完成，请检查文件后重试。', 'upload');
      }
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, props.service]);

  const uploadSourceDocument = useCallback(async (file: File) => {
    if (props.service.uploadSourceDocument === undefined) {
      const cause = new Error('Creator document upload transport is unavailable');
      captureCreatorFailure('creator.upload-source-document', cause, '源文档上传暂不可用，请稍后重试。', 'upload');
      throw cause;
    }
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      const response = await props.service.uploadSourceDocument(confirmedRef.current.id, {
        file,
        expectedRevision: requestRevision
      });
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.upload-source-document', cause, '源文档上传未完成，请检查文件后重试。', 'upload');
      }
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, props.service]);

  const cancelJob = useCallback(async () => {
    if (props.service.cancelJob === undefined) {
      const cause = new Error('Creator job cancellation is unavailable');
      captureCreatorFailure('creator.cancel-job', cause);
      throw cause;
    }
    try {
      await ensurePersistedJob();
      const response = await props.service.cancelJob(confirmedRef.current.id);
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      captureCreatorFailure('creator.cancel-job', cause);
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, props.service]);

  const resumeJob = useCallback(async () => {
    if (props.service.resumeJob === undefined) {
      const cause = new Error('Creator job resume is unavailable');
      captureCreatorFailure('creator.resume-job', cause);
      throw cause;
    }
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      const response = await props.service.resumeJob(confirmedRef.current.id);
      confirmedRef.current = response.job;
      setConfirmedJob(response.job);
      setError(null);
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.resume-job', cause);
      }
      throw cause;
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, props.service]);

  const openArtifact = useCallback(async (artifactId: string) => {
    if (props.service.openArtifact === undefined) {
      const cause = new Error('Creator artifact transport is unavailable');
      captureCreatorFailure('creator.open-artifact', cause, '无法打开创作产物，请稍后重试。');
      throw cause;
    }
    try {
      return await props.service.openArtifact(confirmedRef.current.id, artifactId);
    } catch (cause) {
      captureCreatorFailure('creator.open-artifact', cause, '无法打开创作产物，请稍后重试。');
      throw cause;
    }
  }, [captureCreatorFailure, props.service]);

  const openArtifactJson = useCallback(<T,>(artifactId: string): Promise<T> => {
    const cached = artifactJsonCacheRef.current.get(artifactId);
    if (cached !== undefined) return cached as Promise<T>;
    const request = openArtifact(artifactId).then(async response => {
      return captureCreatorClientFailure(
        { captureCreatorFailure },
        'creator.read-artifact-json',
        '无法读取创作产物内容，请稍后重试。',
        async () => {
          if (!response.ok) throw new Error(`Creator artifact request failed: ${response.status}`);
          return response.json() as Promise<T>;
        }
      );
    }).catch(error => {
      artifactJsonCacheRef.current.delete(artifactId);
      throw error;
    });
    artifactJsonCacheRef.current.set(artifactId, request);
    return request;
  }, [captureCreatorFailure, openArtifact]);

  const runAgentTurn = useCallback(async (
    message: string,
    sandbox?: CreatorAgentTurnRequest['sandbox']
  ) => {
    const content = message.trim();
    if (!content) return;
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      await ensurePersistedJob();
      requestRevision = confirmedRef.current.revision;
      const clientMessageId = createClientMessageId();
      const start = props.service.startAgentTurn ?? props.service.runAgentTurn;
      const openIssues = [...(confirmedRef.current.issues ?? []), ...localIssuesRef.current]
        .filter(issue => issue.status === 'open');
      const focused = openIssues.find(issue => issue.id === focusedIssueId)
        ?? (focusedIssueId === null ? openIssues.at(-1) : undefined);
      const authoritativeIssueId = focused?.scope.kind === 'creator-job'
        && confirmedRef.current.issues?.some(issue => issue.id === focused.id)
        ? focused.id
        : undefined;
      const contextualMessage = focused !== undefined && authoritativeIssueId === undefined
        ? `${content}\n\n相关错误：${presentIssue(focused).description}`
        : content;
      const response = await start(confirmedRef.current.id, {
        message: contextualMessage,
        clientMessageId,
        ...(sandbox === undefined ? {} : { sandbox }),
        ...(authoritativeIssueId === undefined ? {} : { focusedIssueId: authoritativeIssueId })
      });
      if (response.action !== undefined) {
        confirmedRef.current = response.action.job;
        setConfirmedJob(response.action.job);
      }
      setError(null);
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.agent-turn', cause, 'Agent 未能完成诊断，请查看问题详情后重试。', 'agent');
      }
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [captureCreatorFailure, ensurePersistedJob, flush, focusedIssueId, props.service, reloadAgentTimeline]);

  const steerAgentTurn = useCallback(async (message: string) => {
    const content = message.trim();
    if (!content) return;
    if (props.service.steerAgentTurn === undefined) {
      throw new Error('Creator Agent steering is unavailable');
    }
    let requestRevision = confirmedRef.current.revision;
    try {
      await flush();
      requestRevision = confirmedRef.current.revision;
      await props.service.steerAgentTurn(confirmedRef.current.id, {
        message: content,
        clientMessageId: createClientMessageId()
      });
      setError(null);
    } catch (cause) {
      if (!isSupersededRevisionConflict(cause, requestRevision, confirmedRef.current.revision)) {
        setError(toSessionError(cause));
        captureCreatorFailure('creator.agent-steer', cause, 'Agent 未能接收补充要求。', 'agent');
      }
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [captureCreatorFailure, flush, props.service, reloadAgentTimeline]);

  const interruptAgentTurn = useCallback(async () => {
    if (props.service.interruptAgentTurn === undefined) return;
    try {
      await props.service.interruptAgentTurn(confirmedRef.current.id);
      setError(null);
    } catch (cause) {
      setError(toSessionError(cause));
      captureCreatorFailure('creator.agent-interrupt', cause, 'Agent 对话未能停止。', 'agent');
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [captureCreatorFailure, props.service, reloadAgentTimeline]);

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
      captureCreatorFailure('creator.agent-approval', cause, 'Agent 审批操作未完成。', 'agent');
      throw cause;
    } finally {
      await reloadAgentTimeline().catch(() => undefined);
    }
  }, [captureCreatorFailure, props.service, reloadAgentTimeline]);

  const agentBusy = turns.some(turn => (
    turn.role === 'assistant'
    && ['queued', 'running', 'waiting_approval'].includes(turn.status)
  ));
  const issues = useMemo(() => mergeVisibleIssues(
    confirmedJob.issues ?? [],
    [...localIssues, ...(props.externalIssues ?? [])]
  ), [confirmedJob.issues, localIssues, props.externalIssues]);
  const focusedIssue = focusedIssueId === null
    ? issues.filter(issue => issue.status === 'open').at(-1) ?? null
    : issues.find(issue => issue.id === focusedIssueId) ?? null;

  const value = useMemo<CreatorSessionContextValue>(() => ({
    job: confirmedJob,
    state: { ...confirmedJob.state, ...draft },
    conflictedFields,
    error,
    issues,
    focusedIssue,
    preflight,
    runPreflight,
    updateDraft,
    flush,
    clearError,
    captureCreatorFailure,
    repairIssue,
    focusIssue,
    askPendingIssue,
    applyRemoteSnapshot,
    applyAction,
    cancelJob,
    resumeJob,
    uploadReferenceImage,
    uploadSourceDocument,
    uploadSourceVideo,
    uploadArticleImage,
    openArtifact,
    openArtifactJson,
    agentSession,
    turns,
    items,
    approvals,
    agentBusy,
    runAgentTurn,
    steerAgentTurn,
    interruptAgentTurn,
    respondAgentApproval
  }), [agentBusy, agentSession, askPendingIssue, applyAction, applyRemoteSnapshot, approvals, cancelJob, captureCreatorFailure, clearError, confirmedJob, conflictedFields, draft, error, flush, focusIssue, focusedIssue, interruptAgentTurn, issues, items, openArtifact, openArtifactJson, preflight, repairIssue, respondAgentApproval, resumeJob, runAgentTurn, runPreflight, steerAgentTurn, turns, updateDraft, uploadArticleImage, uploadReferenceImage, uploadSourceDocument, uploadSourceVideo]);

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
  if (event.kind === 'issue_changed') {
    const issue = event.payload.issue;
    if (!isOpenCreatorIssue(issue)) return job;
    if (issue.scope.kind !== 'creator-job' || issue.scope.jobId !== job.id) return job;
    return mergeIssueIntoJob(job, issue);
  }
  return job;
}

function mergeIssueIntoJob(job: CreatorJob, issue: OpenCreatorIssue): CreatorJob {
  const current = job.issues ?? [];
  return {
    ...job,
    issues: current.some(candidate => candidate.id === issue.id)
      ? current.map(candidate => candidate.id === issue.id ? issue : candidate)
      : [...current, issue],
    updatedAt: laterTimestamp(job.updatedAt, issue.lastOccurredAt)
  };
}

function mergeVisibleIssues(
  authoritative: OpenCreatorIssue[],
  local: OpenCreatorIssue[]
): OpenCreatorIssue[] {
  const unique = new Map<string, OpenCreatorIssue>();
  for (const issue of [...authoritative, ...local]) {
    if (!unique.has(issue.fingerprint)) unique.set(issue.fingerprint, issue);
  }
  return [...unique.values()].sort((left, right) => (
    left.lastOccurredAt.localeCompare(right.lastOccurredAt)
    || left.id.localeCompare(right.id)
  )).slice(-60);
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

function isSupersededRevisionConflict(
  cause: unknown,
  requestRevision: number,
  confirmedRevision: number
): boolean {
  const candidate = cause as { code?: unknown };
  return candidate?.code === 'creator_revision_conflict'
    && confirmedRevision > requestRevision;
}
