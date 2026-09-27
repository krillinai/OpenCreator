import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  CreatorActivity,
  CreatorActor,
  CreatorArtifact,
  CreatorArtifactStatus,
  CreatorJob,
  CreatorJobStatus,
  CreatorIssueEvent,
  CreatorIssueStatsResponse,
  CreatorJson,
  CreatorProviderRequest,
  CreatorProviderRequestStatus,
  CreatorPresetOrigin,
  CreatorRepairAction,
  CreatorStageRun,
  CreatorStageDispatchStatus,
  CreatorStageRunStatus,
  IssueRetryResult,
  OpenCreatorIssue
} from '@opencreator/protocol';
import { isOpenCreatorIssue, isPublicErrorFacts } from '@opencreator/protocol';
import type {
  CreatorIssueAssociationKind,
  NormalizedCreatorIssueInput
} from './issues.js';
import { parseSrt } from './validators/srt.js';

type RepositoryOptions = {
  idFactory?(prefix: string): string;
  now?(): string;
};

export const CREATOR_ISSUE_UPSERT_SQL = `
  INSERT INTO creator_issues (
    id, job_id, diagnostic_id, code, source, category, severity, status,
    operation, stage_id, stage_run_id, scope_key, summary_key,
    summary_params_json, fallback_message, public_facts_json, technical_detail, retryable,
    repair_actions_json, fingerprint, occurrence_count,
    resolution_attempt_id, association_kind, association_id,
    last_retry_result, last_event_kind,
    occurred_at, last_occurred_at, resolved_at, updated_at
  ) VALUES (
    @id, @jobId, @diagnosticId, @code, @source, @category, @severity, 'open',
    @operation, @stageId, @stageRunId, @scopeKey, @summaryKey,
    @summaryParamsJson, @fallbackMessage, @publicFactsJson, @technicalDetail, @retryable,
    @repairActionsJson, @fingerprint, 1,
    NULL, NULL, NULL, 'none', 'occurrence',
    @timestamp, @timestamp, NULL, @timestamp
  )
  ON CONFLICT(job_id, fingerprint) DO UPDATE SET
    code = excluded.code,
    source = excluded.source,
    category = excluded.category,
    severity = excluded.severity,
    status = 'open',
    operation = excluded.operation,
    stage_id = excluded.stage_id,
    stage_run_id = COALESCE(excluded.stage_run_id, creator_issues.stage_run_id),
    scope_key = excluded.scope_key,
    summary_key = excluded.summary_key,
    summary_params_json = excluded.summary_params_json,
    fallback_message = excluded.fallback_message,
    public_facts_json = excluded.public_facts_json,
    technical_detail = excluded.technical_detail,
    retryable = excluded.retryable,
    repair_actions_json = excluded.repair_actions_json,
    occurrence_count = creator_issues.occurrence_count + 1,
    resolution_attempt_id = NULL,
    association_kind = NULL,
    association_id = NULL,
    last_retry_result = CASE
      WHEN creator_issues.status = 'resolving' THEN 'failed'
      ELSE creator_issues.last_retry_result
    END,
    last_event_kind = CASE
      WHEN creator_issues.status = 'resolved' THEN 'reopened'
      ELSE 'occurrence'
    END,
    last_occurred_at = excluded.last_occurred_at,
    resolved_at = NULL,
    updated_at = excluded.updated_at
  RETURNING *
`;

type CreateJobInput = {
  creationKey?: string;
  creationFingerprint?: string | null;
  presetOrigin?: CreatorPresetOrigin | null;
  projectId: string;
  templateId: string;
  templateVersion: number;
  status: CreatorJobStatus;
  state: Record<string, CreatorJson>;
  agentThreadId?: string | null;
};

type InsertArtifactInput = {
  jobId: string;
  kind: string;
  status: CreatorArtifactStatus;
  path: string | null;
  scopeKey?: string | null;
  inputFingerprint?: string | null;
  sha256?: string | null;
  sourceArtifactIds: string[];
  metadata: Record<string, CreatorJson>;
};

type InsertActivityInput = {
  jobId: string;
  revision: number;
  actor: CreatorActor;
  action: string;
  summary: string;
  details: Record<string, CreatorJson>;
};

type CreateStageRunInput = {
  jobId: string;
  stageId: string;
  executor: string;
  status: CreatorStageRunStatus;
  progress?: Record<string, CreatorJson>;
  dispatchStatus?: CreatorStageDispatchStatus;
  idempotencyKey?: string | null;
  scopeKey?: string | null;
  inputFingerprint?: string | null;
};

type CreateProviderRequestInput = {
  jobId: string;
  provider: string;
  stageRunId: string;
  scopeKey?: string | null;
  requestKey: string;
  requestHash: string;
  billingSideEffect?: boolean;
  status?: CreatorProviderRequestStatus;
  generation?: number;
  resubmissionOf?: string | null;
};

export type CreatorRepository = {
  transaction<T>(operation: () => T): T;
  createJob(input: CreateJobInput): CreatorJob;
  getJob(id: string): CreatorJob | undefined;
  getJobByCreationKey(creationKey: string): CreatorJob | undefined;
  getCreationFingerprint(id: string): string | null;
  listJobs(projectId?: string): CreatorJob[];
  deleteJob(id: string): boolean;
  updateJob(input: {
    id: string;
    status: CreatorJobStatus;
    revision: number;
    state: Record<string, CreatorJson>;
    agentThreadId?: string | null;
  }): void;
  setArtifactStatus(id: string, status: CreatorArtifactStatus): void;
  insertArtifact(input: InsertArtifactInput): CreatorArtifact;
  insertActivity(input: InsertActivityInput): CreatorActivity;
  updateActivity(input: {
    id: string;
    revision: number;
    summary: string;
    details: Record<string, CreatorJson>;
  }): void;
  createStageRun(input: CreateStageRunInput): CreatorStageRun;
  getStageRun(id: string): CreatorStageRun | undefined;
  updateStageRun(input: {
    id: string;
    status: CreatorStageRunStatus;
    progress?: Record<string, CreatorJson>;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): void;
  listStageRuns(jobId: string): CreatorStageRun[];
  listDispatchableStageRuns(now: string, limit: number): CreatorStageRun[];
  claimStageRun(input: {
    id: string;
    owner: string;
    now: string;
    expiresAt: string;
  }): CreatorStageRun | undefined;
  renewStageRunClaim(input: { id: string; owner: string; expiresAt: string }): boolean;
  finishStageRunDispatch(id: string, owner: string): boolean;
  createProviderRequest(input: CreateProviderRequestInput): CreatorProviderRequest;
  getProviderRequest(id: string): CreatorProviderRequest | undefined;
  getLatestProviderRequest(provider: string, requestKey: string): CreatorProviderRequest | undefined;
  listProviderRequests(jobId: string): CreatorProviderRequest[];
  updateProviderRequest(input: {
    id: string;
    status: CreatorProviderRequestStatus;
    remoteTaskId?: string | null;
    resultArtifactId?: string | null;
  }): CreatorProviderRequest;
  listArtifacts(jobId: string): CreatorArtifact[];
  listActivities(jobId: string): CreatorActivity[];
  captureIssue(input: NormalizedCreatorIssueInput): OpenCreatorIssue;
  getIssue(jobId: string, issueId: string): OpenCreatorIssue | undefined;
  listIssues(jobId: string): OpenCreatorIssue[];
  listIssueEvents(jobId: string, input?: {
    cursor?: string;
    limit?: number;
  }): { events: CreatorIssueEvent[]; nextCursor?: string };
  beginIssueResolution(input: {
    jobId: string;
    issueId: string;
    resolutionAttemptId: string;
    associationKind: CreatorIssueAssociationKind;
    associationId: string;
    stageRunId?: string;
  }): OpenCreatorIssue;
  finishIssueResolution(input: {
    jobId: string;
    issueId: string;
    resolutionAttemptId: string;
    result: Exclude<IssueRetryResult, 'none'>;
    publicFacts?: OpenCreatorIssue['publicFacts'];
    technicalDetail?: string;
  }): OpenCreatorIssue;
  aggregateIssueStats(
    jobId: string,
    range: { from: string; to: string }
  ): CreatorIssueStatsResponse['rows'];
};

export function createCreatorRepository(
  db: Database.Database,
  options: RepositoryOptions = {}
): CreatorRepository {
  const idFactory = options.idFactory ?? (prefix => `${prefix}_${nanoid()}`);
  const now = options.now ?? (() => new Date().toISOString());
  repairLeadingResultSnapshotGaps(db);
  repairLegacyVerticalSubtitleArtifacts(db);
  recoverInterruptedStageRuns(db, now());
  recoverInterruptedIssues(db, now(), idFactory);

  const getJob = (id: string): CreatorJob | undefined => {
    const row = db.prepare(`
      SELECT id, project_id, template_id, template_version, status, revision,
             state_json, preset_origin_json, creation_fingerprint,
             agent_thread_id, created_at, updated_at
      FROM creator_jobs
      WHERE id = ?
    `).get(id) as JobRow | undefined;
    return row === undefined ? undefined : hydrateJob(row);
  };

  const hydrateJob = (row: JobRow): CreatorJob => {
    validateCreationFingerprint(row.id, row.creation_fingerprint);
    return {
      id: row.id,
      projectId: row.project_id,
      templateId: row.template_id,
      templateVersion: row.template_version,
      status: row.status,
      revision: row.revision,
      state: parseJsonRecord(row.state_json),
      presetOrigin: parsePresetOrigin(row.preset_origin_json),
      agentThreadId: row.agent_thread_id,
      stages: listStageRuns(row.id),
      artifacts: listArtifacts(row.id),
      providerRequests: listProviderRequests(row.id),
      activities: listActivities(row.id),
      issues: listIssues(row.id),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at)
    };
  };

  const listStageRuns = (jobId: string): CreatorStageRun[] => (
    db.prepare(`
      SELECT id, job_id, stage_id, executor, status, dispatch_status,
             claim_owner, claim_expires_at, attempt, idempotency_key,
             scope_key, input_fingerprint,
             progress_json, error_code, error_message, started_at, finished_at
      FROM creator_stage_runs
      WHERE job_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(jobId) as StageRow[]
  ).map(row => ({
    id: row.id,
    jobId: row.job_id,
    stageId: row.stage_id,
    executor: row.executor,
    status: row.status,
    dispatchStatus: row.dispatch_status,
    claimOwner: row.claim_owner,
    claimExpiresAt: nullableIso(row.claim_expires_at),
    attempt: row.attempt,
    idempotencyKey: row.idempotency_key,
    scopeKey: row.scope_key,
    inputFingerprint: row.input_fingerprint,
    progress: parseJsonRecord(row.progress_json),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at)
  }));

  const listArtifacts = (jobId: string): CreatorArtifact[] => (
    db.prepare(`
      SELECT id, job_id, kind, version, status, path,
             scope_key, input_fingerprint, sha256,
             source_artifact_ids_json, metadata_json, created_at
      FROM creator_artifacts
      WHERE job_id = ?
      ORDER BY kind ASC, version ASC, id ASC
    `).all(jobId) as ArtifactRow[]
  ).map(row => ({
    id: row.id,
    jobId: row.job_id,
    kind: row.kind,
    version: row.version,
    status: row.status,
    path: row.path,
    scopeKey: row.scope_key,
    inputFingerprint: row.input_fingerprint,
    sha256: row.sha256,
    sourceArtifactIds: parseStringArray(row.source_artifact_ids_json),
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: toIso(row.created_at)
  }));

  const listActivities = (jobId: string): CreatorActivity[] => (
    db.prepare(`
      SELECT id, job_id, revision, actor, action, summary, details_json, created_at
      FROM creator_activities
      WHERE job_id = ?
      ORDER BY revision ASC, created_at ASC, id ASC
    `).all(jobId) as ActivityRow[]
  ).map(row => ({
    id: row.id,
    jobId: row.job_id,
    revision: row.revision,
    actor: row.actor,
    action: row.action,
    summary: row.summary,
    details: parseJsonRecord(row.details_json),
    createdAt: toIso(row.created_at)
  }));

  const listProviderRequests = (jobId: string): CreatorProviderRequest[] => (
    db.prepare(`
      SELECT id, job_id, provider, stage_run_id, scope_key, request_key, request_hash,
             remote_task_id, billing_side_effect, status, result_artifact_id,
             generation, resubmission_of, created_at, updated_at
      FROM creator_provider_requests
      WHERE job_id = ?
      ORDER BY created_at ASC, generation ASC, id ASC
    `).all(jobId) as ProviderRequestRow[]
  ).map(hydrateProviderRequest);

  const getIssue = (jobId: string, issueId: string): OpenCreatorIssue | undefined => {
    const row = db.prepare(`
      SELECT * FROM creator_issues WHERE job_id = ? AND id = ?
    `).get(jobId, issueId) as IssueRow | undefined;
    if (row !== undefined) return hydrateIssue(row);
    return deriveLegacyStageIssues(jobId, listStageRuns(jobId))
      .find(issue => issue.id === issueId);
  };

  const listIssues = (jobId: string): OpenCreatorIssue[] => {
    const active = db.prepare(`
      SELECT * FROM creator_issues
      WHERE job_id = ? AND status IN ('open', 'resolving')
      ORDER BY last_occurred_at DESC, id DESC
    `).all(jobId) as IssueRow[];
    const resolved = db.prepare(`
      SELECT * FROM creator_issues
      WHERE job_id = ? AND status = 'resolved'
      ORDER BY resolved_at DESC, id DESC
      LIMIT 5
    `).all(jobId) as IssueRow[];
    const persisted = [...active, ...resolved].map(hydrateIssue);
    return persisted.length > 0
      ? persisted
      : deriveLegacyStageIssues(jobId, listStageRuns(jobId));
  };

  const appendIssueEvent = (
    issueId: string,
    kind: CreatorIssueEvent['kind'],
    retryResult: IssueRetryResult,
    timestamp: string
  ): void => {
    db.prepare(`
      INSERT INTO creator_issue_events (id, issue_id, kind, retry_result, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(idFactory('creator_issue_event'), issueId, kind, retryResult, timestamp);
  };

  const insertArtifact = (input: InsertArtifactInput): CreatorArtifact => {
    const id = idFactory('creator_artifact');
    const versionRow = db.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM creator_artifacts
      WHERE job_id = ? AND kind = ?
    `).get(input.jobId, input.kind) as { version: number };
    const createdAt = now();
    db.prepare(`
      INSERT INTO creator_artifacts (
        id, job_id, kind, version, status, path,
        scope_key, input_fingerprint, sha256,
        source_artifact_ids_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.kind,
      versionRow.version,
      input.status,
      input.path,
      input.scopeKey ?? null,
      input.inputFingerprint ?? null,
      input.sha256 ?? null,
      JSON.stringify(input.sourceArtifactIds),
      JSON.stringify(input.metadata),
      createdAt
    );
    return listArtifacts(input.jobId).find(artifact => artifact.id === id)!;
  };

  const insertActivity = (input: InsertActivityInput): CreatorActivity => {
    const id = idFactory('creator_activity');
    const createdAt = now();
    db.prepare(`
      INSERT INTO creator_activities (
        id, job_id, revision, actor, action, summary, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.revision,
      input.actor,
      input.action,
      input.summary,
      JSON.stringify(input.details),
      createdAt
    );
    return listActivities(input.jobId).find(activity => activity.id === id)!;
  };

  return {
    transaction<T>(operation: () => T): T {
      return db.transaction(operation)();
    },
    createJob(input: CreateJobInput): CreatorJob {
      const id = idFactory('creator_job');
      const timestamp = now();
      db.prepare(`
        INSERT INTO creator_jobs (
          id, creation_key, creation_fingerprint, project_id, template_id,
          template_version, status, revision, state_json, preset_origin_json,
          agent_thread_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.creationKey ?? null,
        input.creationFingerprint ?? null,
        input.projectId,
        input.templateId,
        input.templateVersion,
        input.status,
        JSON.stringify(input.state),
        input.presetOrigin === undefined || input.presetOrigin === null
          ? null
          : JSON.stringify(input.presetOrigin),
        input.agentThreadId ?? null,
        timestamp,
        timestamp
      );
      return getJob(id)!;
    },
    getJob,
    getJobByCreationKey(creationKey: string): CreatorJob | undefined {
      const row = db.prepare(`
        SELECT id
        FROM creator_jobs
        WHERE creation_key = ?
      `).get(creationKey) as { id: string } | undefined;
      return row === undefined ? undefined : getJob(row.id);
    },
    getCreationFingerprint(id: string): string | null {
      const row = db.prepare(`
        SELECT creation_fingerprint AS fingerprint
        FROM creator_jobs
        WHERE id = ?
      `).get(id) as { fingerprint: string | null } | undefined;
      if (row === undefined) return null;
      validateCreationFingerprint(id, row.fingerprint);
      return row.fingerprint;
    },
    listJobs(projectId?: string): CreatorJob[] {
      const rows = projectId === undefined
        ? db.prepare(`
            SELECT id, project_id, template_id, template_version, status, revision,
                   state_json, preset_origin_json, creation_fingerprint,
                   agent_thread_id, created_at, updated_at
            FROM creator_jobs
            ORDER BY updated_at DESC, id DESC
          `).all()
        : db.prepare(`
            SELECT id, project_id, template_id, template_version, status, revision,
                   state_json, preset_origin_json, creation_fingerprint,
                   agent_thread_id, created_at, updated_at
            FROM creator_jobs
            WHERE project_id = ?
            ORDER BY updated_at DESC, id DESC
          `).all(projectId);
      return (rows as JobRow[]).map(hydrateJob);
    },
    deleteJob(id: string): boolean {
      return db.prepare('DELETE FROM creator_jobs WHERE id = ?').run(id).changes === 1;
    },
    updateJob(input: {
      id: string;
      status: CreatorJobStatus;
      revision: number;
      state: Record<string, CreatorJson>;
      agentThreadId?: string | null;
    }): void {
      db.prepare(`
        UPDATE creator_jobs
        SET status = ?, revision = ?, state_json = ?,
            agent_thread_id = COALESCE(?, agent_thread_id), updated_at = ?
        WHERE id = ?
      `).run(
        input.status,
        input.revision,
        JSON.stringify(input.state),
        input.agentThreadId ?? null,
        now(),
        input.id
      );
    },
    setArtifactStatus(id: string, status: CreatorArtifactStatus): void {
      db.prepare('UPDATE creator_artifacts SET status = ? WHERE id = ?').run(status, id);
    },
    insertArtifact,
    insertActivity,
    updateActivity(input): void {
      db.prepare(`
        UPDATE creator_activities
        SET revision = ?, summary = ?, details_json = ?, created_at = ?
        WHERE id = ?
      `).run(
        input.revision,
        input.summary,
        JSON.stringify(input.details),
        now(),
        input.id
      );
    },
    createStageRun(input: CreateStageRunInput): CreatorStageRun {
      const id = idFactory('creator_stage_run');
      const timestamp = now();
      db.prepare(`
        INSERT INTO creator_stage_runs (
          id, job_id, stage_id, executor, status, dispatch_status,
          claim_owner, claim_expires_at, attempt, idempotency_key,
          scope_key, input_fingerprint, progress_json,
          started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.jobId,
        input.stageId,
        input.executor,
        input.status,
        input.dispatchStatus ?? (isTerminalStage(input.status) ? 'finished' : 'queued'),
        input.idempotencyKey ?? null,
        input.scopeKey ?? null,
        input.inputFingerprint ?? null,
        JSON.stringify(input.progress ?? {}),
        input.status === 'running' ? timestamp : null,
        timestamp
      );
      return listStageRuns(input.jobId).find(stage => stage.id === id)!;
    },
    getStageRun(id: string): CreatorStageRun | undefined {
      const row = db.prepare(`
        SELECT id, job_id, stage_id, executor, status, dispatch_status,
               claim_owner, claim_expires_at, attempt, idempotency_key,
               scope_key, input_fingerprint,
               progress_json, error_code, error_message, started_at, finished_at
        FROM creator_stage_runs WHERE id = ?
      `).get(id) as StageRow | undefined;
      if (row === undefined) return undefined;
      return {
        id: row.id,
        jobId: row.job_id,
        stageId: row.stage_id,
        executor: row.executor,
        status: row.status,
        dispatchStatus: row.dispatch_status,
        claimOwner: row.claim_owner,
        claimExpiresAt: nullableIso(row.claim_expires_at),
        attempt: row.attempt,
        idempotencyKey: row.idempotency_key,
        scopeKey: row.scope_key,
        inputFingerprint: row.input_fingerprint,
        progress: parseJsonRecord(row.progress_json),
        errorCode: row.error_code,
        errorMessage: row.error_message,
        startedAt: nullableIso(row.started_at),
        finishedAt: nullableIso(row.finished_at)
      };
    },
    updateStageRun(input: {
      id: string;
      status: CreatorStageRunStatus;
      progress?: Record<string, CreatorJson>;
      errorCode?: string | null;
      errorMessage?: string | null;
    }): void {
      db.prepare(`
        UPDATE creator_stage_runs
        SET status = ?, progress_json = COALESCE(?, progress_json),
            error_code = ?, error_message = ?,
            dispatch_status = CASE
              WHEN ? IN ('succeeded','failed','canceled','interrupted') THEN 'finished'
              ELSE dispatch_status
            END,
            started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, ?) ELSE started_at END,
            finished_at = CASE WHEN ? IN ('succeeded','failed','canceled','interrupted') THEN ? ELSE finished_at END
        WHERE id = ?
      `).run(
        input.status,
        input.progress === undefined ? null : JSON.stringify(input.progress),
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.status,
        input.status,
        now(),
        input.status,
        now(),
        input.id
      );
    },
    listStageRuns,
    listDispatchableStageRuns(timestamp: string, limit: number): CreatorStageRun[] {
      return (db.prepare(`
        SELECT id, job_id, stage_id, executor, status, dispatch_status,
               claim_owner, claim_expires_at, attempt, idempotency_key,
               scope_key, input_fingerprint,
               progress_json, error_code, error_message, started_at, finished_at
        FROM creator_stage_runs
        WHERE dispatch_status = 'queued'
           OR (dispatch_status = 'claimed' AND claim_expires_at <= ?)
        ORDER BY created_at ASC, rowid ASC
        LIMIT ?
      `).all(timestamp, limit) as StageRow[]).map(hydrateStageRun);
    },
    claimStageRun(input): CreatorStageRun | undefined {
      const result = db.prepare(`
        UPDATE creator_stage_runs
        SET dispatch_status = 'claimed', claim_owner = ?, claim_expires_at = ?,
            attempt = attempt + 1
        WHERE id = ? AND (
          dispatch_status = 'queued'
          OR (dispatch_status = 'claimed' AND claim_expires_at <= ?)
        )
      `).run(input.owner, input.expiresAt, input.id, input.now);
      if (result.changes === 0) return undefined;
      const row = db.prepare(`
        SELECT id, job_id, stage_id, executor, status, dispatch_status,
               claim_owner, claim_expires_at, attempt, idempotency_key,
               scope_key, input_fingerprint,
               progress_json, error_code, error_message, started_at, finished_at
        FROM creator_stage_runs WHERE id = ?
      `).get(input.id) as StageRow;
      return hydrateStageRun(row);
    },
    renewStageRunClaim(input): boolean {
      return db.prepare(`
        UPDATE creator_stage_runs SET claim_expires_at = ?
        WHERE id = ? AND dispatch_status = 'claimed' AND claim_owner = ?
      `).run(input.expiresAt, input.id, input.owner).changes === 1;
    },
    finishStageRunDispatch(id: string, owner: string): boolean {
      return db.prepare(`
        UPDATE creator_stage_runs
        SET dispatch_status = 'finished', claim_expires_at = NULL
        WHERE id = ? AND dispatch_status = 'claimed' AND claim_owner = ?
      `).run(id, owner).changes === 1;
    },
    createProviderRequest(providerInput): CreatorProviderRequest {
      const id = idFactory('creator_provider_request');
      const timestamp = now();
      db.prepare(`
        INSERT INTO creator_provider_requests (
          id, job_id, provider, stage_run_id, scope_key, request_key, request_hash,
          remote_task_id, billing_side_effect, status, result_artifact_id,
          generation, resubmission_of, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)
      `).run(
        id,
        providerInput.jobId,
        providerInput.provider,
        providerInput.stageRunId,
        providerInput.scopeKey ?? null,
        providerInput.requestKey,
        providerInput.requestHash,
        providerInput.billingSideEffect === false ? 0 : 1,
        providerInput.status ?? 'registered',
        providerInput.generation ?? 1,
        providerInput.resubmissionOf ?? null,
        timestamp,
        timestamp
      );
      return listProviderRequests(providerInput.jobId).find(item => item.id === id)!;
    },
    getProviderRequest(id): CreatorProviderRequest | undefined {
      const row = db.prepare(`
        SELECT id, job_id, provider, stage_run_id, scope_key, request_key, request_hash,
               remote_task_id, billing_side_effect, status, result_artifact_id,
               generation, resubmission_of, created_at, updated_at
        FROM creator_provider_requests
        WHERE id = ?
      `).get(id) as ProviderRequestRow | undefined;
      return row === undefined ? undefined : hydrateProviderRequest(row);
    },
    getLatestProviderRequest(provider, requestKey): CreatorProviderRequest | undefined {
      const row = db.prepare(`
        SELECT id, job_id, provider, stage_run_id, scope_key, request_key, request_hash,
               remote_task_id, billing_side_effect, status, result_artifact_id,
               generation, resubmission_of, created_at, updated_at
        FROM creator_provider_requests
        WHERE provider = ? AND request_key = ?
        ORDER BY generation DESC
        LIMIT 1
      `).get(provider, requestKey) as ProviderRequestRow | undefined;
      return row === undefined ? undefined : hydrateProviderRequest(row);
    },
    listProviderRequests,
    updateProviderRequest(providerInput): CreatorProviderRequest {
      const current = this.getProviderRequest(providerInput.id);
      if (current === undefined) throw new Error('Creator provider request not found');
      db.prepare(`
        UPDATE creator_provider_requests
        SET status = ?, remote_task_id = ?, result_artifact_id = ?, updated_at = ?
        WHERE id = ?
      `).run(
        providerInput.status,
        providerInput.remoteTaskId === undefined ? current.remoteTaskId : providerInput.remoteTaskId,
        providerInput.resultArtifactId === undefined
          ? current.resultArtifactId
          : providerInput.resultArtifactId,
        now(),
        providerInput.id
      );
      return this.getProviderRequest(providerInput.id)!;
    },
    captureIssue(input): OpenCreatorIssue {
      return db.transaction(() => {
        const timestamp = now();
        const candidateId = idFactory('creator_issue');
        const row = db.prepare(CREATOR_ISSUE_UPSERT_SQL).get({
          id: candidateId,
          jobId: input.scope.jobId,
          diagnosticId: diagnosticId(candidateId),
          code: input.code,
          source: input.source,
          category: input.category,
          severity: input.severity,
          operation: input.operation ?? null,
          stageId: input.stageId ?? null,
          stageRunId: input.stageRunId ?? null,
          scopeKey: input.scopeKey ?? null,
          summaryKey: input.summaryKey,
          summaryParamsJson: JSON.stringify(input.summaryParams),
          fallbackMessage: input.fallbackMessage,
          publicFactsJson: input.publicFacts === undefined ? null : JSON.stringify(input.publicFacts),
          technicalDetail: input.technicalDetail ?? null,
          retryable: input.retryable ? 1 : 0,
          repairActionsJson: JSON.stringify(input.repairActions),
          fingerprint: input.fingerprint,
          timestamp
        }) as IssueRow;
        appendIssueEvent(row.id, row.last_event_kind, row.last_retry_result, timestamp);
        return hydrateIssue(row);
      })();
    },
    getIssue,
    listIssues,
    listIssueEvents(jobId, input = {}) {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
      const cursor = decodeIssueCursor(input.cursor);
      const rows = db.prepare(`
        SELECT event.rowid AS sequence, event.id, event.issue_id,
               event.kind, event.retry_result, event.created_at
        FROM creator_issue_events event
        JOIN creator_issues issue ON issue.id = event.issue_id
        WHERE issue.job_id = ?
          AND (? IS NULL OR event.rowid > ?)
        ORDER BY event.rowid ASC
        LIMIT ?
      `).all(
        jobId,
        cursor ?? null,
        cursor ?? null,
        limit + 1
      ) as IssueEventRow[];
      const page = rows.slice(0, limit);
      const events = page.map(hydrateIssueEvent);
      const tail = page.at(-1);
      return {
        events,
        ...(rows.length > limit && tail !== undefined
          ? { nextCursor: encodeIssueCursor(tail.sequence) }
          : {})
      };
    },
    beginIssueResolution(input): OpenCreatorIssue {
      return db.transaction(() => {
        const current = getIssue(input.jobId, input.issueId);
        if (current === undefined) throw new Error('Creator issue not found');
        const row = db.prepare('SELECT * FROM creator_issues WHERE id = ?').get(input.issueId) as IssueRow;
        if (row.resolution_attempt_id === input.resolutionAttemptId) return hydrateIssue(row);
        if (row.status !== 'open') throw new Error('Creator issue is not open');
        const timestamp = now();
        const result = db.prepare(`
          UPDATE creator_issues
          SET status = 'resolving', resolution_attempt_id = ?,
              association_kind = ?, association_id = ?,
              stage_run_id = COALESCE(?, stage_run_id), updated_at = ?
          WHERE id = ? AND job_id = ? AND status = 'open'
        `).run(
          input.resolutionAttemptId,
          input.associationKind,
          input.associationId,
          input.stageRunId ?? null,
          timestamp,
          input.issueId,
          input.jobId
        );
        if (result.changes !== 1) throw new Error('Creator issue resolution conflict');
        appendIssueEvent(input.issueId, 'resolving', 'none', timestamp);
        return getIssue(input.jobId, input.issueId)!;
      })();
    },
    finishIssueResolution(input): OpenCreatorIssue {
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM creator_issues WHERE id = ? AND job_id = ?')
          .get(input.issueId, input.jobId) as IssueRow | undefined;
        if (row === undefined) throw new Error('Creator issue not found');
        if (row.resolution_attempt_id !== input.resolutionAttemptId) {
          throw new Error('Creator issue resolution attempt mismatch');
        }
        if (row.status !== 'resolving') {
          if (row.last_retry_result === input.result) return hydrateIssue(row);
          throw new Error('Creator issue is not resolving');
        }
        const timestamp = now();
        const succeeded = input.result === 'succeeded';
        const failedOccurrence = input.result === 'failed';
        const actions = input.result === 'unknown'
          ? safeRepairActions(row.repair_actions_json).filter(action => (
              action.kind !== 'retry-operation' || action.risk === 'normal'
            ))
          : safeRepairActions(row.repair_actions_json);
        db.prepare(`
          UPDATE creator_issues
          SET status = ?, last_retry_result = ?, repair_actions_json = ?,
              public_facts_json = COALESCE(?, public_facts_json),
              technical_detail = COALESCE(?, technical_detail),
              occurrence_count = occurrence_count + ?,
              last_occurred_at = CASE WHEN ? = 1 THEN ? ELSE last_occurred_at END,
              resolved_at = ?, updated_at = ?
          WHERE id = ? AND job_id = ? AND status = 'resolving'
        `).run(
          succeeded ? 'resolved' : 'open',
          input.result,
          JSON.stringify(actions),
          input.publicFacts === undefined ? null : JSON.stringify(input.publicFacts),
          input.technicalDetail ?? null,
          failedOccurrence ? 1 : 0,
          failedOccurrence ? 1 : 0,
          timestamp,
          succeeded ? timestamp : null,
          timestamp,
          input.issueId,
          input.jobId
        );
        appendIssueEvent(
          input.issueId,
          `attempt_${input.result}` as CreatorIssueEvent['kind'],
          input.result,
          timestamp
        );
        if (succeeded) appendIssueEvent(input.issueId, 'resolved', input.result, timestamp);
        return getIssue(input.jobId, input.issueId)!;
      })();
    },
    aggregateIssueStats(jobId, range) {
      return db.prepare(`
        SELECT code, source, status, last_retry_result AS retryResult, COUNT(id) AS count
        FROM creator_issues
        WHERE job_id = ? AND last_occurred_at >= ? AND last_occurred_at < ?
        GROUP BY code, source, status, last_retry_result
        ORDER BY code ASC, source ASC, status ASC, last_retry_result ASC
      `).all(jobId, range.from, range.to) as CreatorIssueStatsResponse['rows'];
    },
    listArtifacts,
    listActivities
  };
}

function repairLegacyVerticalSubtitleArtifacts(db: Database.Database): void {
  const jobs = db.prepare(`
    SELECT id, state_json
    FROM creator_jobs
    WHERE template_id = 'video-translation'
  `).all() as Array<{ id: string; state_json: string }>;
  if (jobs.length === 0) return;

  const targetRows = db.prepare(`
    SELECT id, job_id, status, path, source_artifact_ids_json, metadata_json, created_at
    FROM creator_artifacts
    WHERE job_id = ? AND kind = 'target_subtitle' AND path IS NOT NULL
    ORDER BY version ASC, id ASC
  `);
  const existingVerticalPath = db.prepare(`
    SELECT id
    FROM creator_artifacts
    WHERE job_id = ? AND kind = 'vertical_subtitle' AND path = ?
  `);
  const nextVerticalVersion = db.prepare(`
    SELECT COALESCE(MAX(version), 0) + 1 AS version
    FROM creator_artifacts
    WHERE job_id = ? AND kind = 'vertical_subtitle'
  `);
  const insertVertical = db.prepare(`
    INSERT INTO creator_artifacts (
      id, job_id, kind, version, status, path,
      source_artifact_ids_json, metadata_json, created_at
    ) VALUES (?, ?, 'vertical_subtitle', ?, ?, ?, ?, ?, ?)
  `);
  const updateJobState = db.prepare('UPDATE creator_jobs SET state_json = ? WHERE id = ?');

  db.transaction(() => {
    for (const job of jobs) {
      const state = JSON.parse(job.state_json) as Record<string, unknown>;
      let stateChanged = false;
      for (const target of targetRows.all(job.id) as LegacyTargetSubtitleRow[]) {
        const shortPath = join(dirname(target.path), 'short_origin_mixed_srt.srt');
        if (!existsSync(shortPath)) continue;
        const existing = existingVerticalPath.get(job.id, shortPath) as { id: string } | undefined;
        if (existing !== undefined) {
          stateChanged = patchLegacyVerticalSubtitleRefs(state, target.id, existing.id) || stateChanged;
          continue;
        }
        let cues;
        try {
          cues = parseSrt(readFileSync(shortPath, 'utf8'), { allowOverlaps: true });
        } catch {
          continue;
        }
        const metadata = JSON.parse(target.metadata_json) as Record<string, unknown>;
        const artifactId = `creator_artifact_legacy_vertical_${target.id}`;
        const version = (nextVerticalVersion.get(job.id) as { version: number }).version;
        insertVertical.run(
          artifactId,
          job.id,
          version,
          target.status,
          shortPath,
          JSON.stringify([target.id]),
          JSON.stringify({
            ...metadata,
            fileName: basename(shortPath),
            cueCount: cues.length,
            cues: cues.map(cue => ({
              id: cue.index,
              start: formatSrtTimestamp(cue.startMs),
              end: formatSrtTimestamp(cue.endMs),
              text: cue.text
            })),
            legacyBackfillFromArtifactId: target.id
          }),
          target.created_at
        );
        stateChanged = patchLegacyVerticalSubtitleRefs(state, target.id, artifactId) || stateChanged;
      }
      if (stateChanged) updateJobState.run(JSON.stringify(state), job.id);
    }
  })();
}

function patchLegacyVerticalSubtitleRefs(
  state: Record<string, unknown>,
  targetArtifactId: string,
  verticalArtifactId: string
): boolean {
  let changed = false;
  for (const collectionName of ['resultSnapshots', 'resultVersions']) {
    const collection = state[collectionName];
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!isUnknownRecord(item) || !isUnknownRecord(item.artifactRefs)) continue;
      const targetRefs = item.artifactRefs.target_subtitle;
      if (!Array.isArray(targetRefs) || !targetRefs.includes(targetArtifactId)) continue;
      if (Array.isArray(item.artifactRefs.vertical_subtitle)
        && item.artifactRefs.vertical_subtitle.includes(verticalArtifactId)) continue;
      item.artifactRefs.vertical_subtitle = [verticalArtifactId];
      changed = true;
    }
  }
  return changed;
}

function formatSrtTimestamp(value: number): string {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const milliseconds = value % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function repairLeadingResultSnapshotGaps(db: Database.Database): void {
  const jobs = db.prepare(`
    SELECT id, state_json
    FROM creator_jobs
    WHERE state_json LIKE '%"resultSnapshots"%'
  `).all() as Array<{ id: string; state_json: string }>;
  if (jobs.length === 0) return;

  const artifactRows = db.prepare(`
    SELECT id, metadata_json
    FROM creator_artifacts
    WHERE job_id = ?
  `);
  const updateJob = db.prepare('UPDATE creator_jobs SET state_json = ? WHERE id = ?');
  const updateArtifact = db.prepare('UPDATE creator_artifacts SET metadata_json = ? WHERE id = ?');
  db.transaction(() => {
    for (const job of jobs) {
      const state = JSON.parse(job.state_json) as Record<string, unknown>;
      const snapshots = Array.isArray(state.resultSnapshots)
        ? state.resultSnapshots.filter(isUnknownRecord)
        : [];
      if (snapshots.length === 0) continue;
      const snapshotVersions = snapshots
        .map(snapshot => readPositiveUnknownInteger(snapshot.version))
        .filter((version): version is number => version !== undefined);
      if (snapshotVersions.length !== snapshots.length) continue;

      const artifacts = (artifactRows.all(job.id) as Array<{ id: string; metadata_json: string }>).map(row => ({
        id: row.id,
        metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
      }));
      const artifactVersions = artifacts
        .map(artifact => readPositiveUnknownInteger(artifact.metadata.resultVersion))
        .filter((version): version is number => version !== undefined);
      const firstVersion = Math.min(...snapshotVersions, ...artifactVersions);
      if (!Number.isFinite(firstVersion) || firstVersion <= 1) continue;
      const offset = firstVersion - 1;

      for (const snapshot of snapshots) {
        snapshot.version = readPositiveUnknownInteger(snapshot.version)! - offset;
      }
      shiftStateVersion(state, 'resultVersion', offset);
      shiftStateVersion(state, 'latestResultVersion', offset);
      if (Array.isArray(state.resultVersions)) {
        for (const version of state.resultVersions) {
          if (!isUnknownRecord(version)) continue;
          const value = readPositiveUnknownInteger(version.value);
          if (value !== undefined) version.value = value - offset;
        }
      }
      updateJob.run(JSON.stringify(state), job.id);

      for (const artifact of artifacts) {
        const version = readPositiveUnknownInteger(artifact.metadata.resultVersion);
        if (version === undefined) continue;
        artifact.metadata.resultVersion = version - offset;
        updateArtifact.run(JSON.stringify(artifact.metadata), artifact.id);
      }
    }
  })();
}

function shiftStateVersion(state: Record<string, unknown>, key: string, offset: number): void {
  const value = readPositiveUnknownInteger(state[key]);
  if (value !== undefined) state[key] = value - offset;
}

function readPositiveUnknownInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function recoverInterruptedStageRuns(db: Database.Database, timestamp: string): void {
  db.transaction(() => {
    const affectedJobs = db.prepare(`
      SELECT DISTINCT job_id
      FROM creator_stage_runs
      WHERE status IN ('queued', 'running')
    `).all() as Array<{ job_id: string }>;
    if (affectedJobs.length === 0) return;

    db.prepare(`
      UPDATE creator_stage_runs
      SET status = 'interrupted',
          dispatch_status = 'finished',
          claim_owner = NULL,
          claim_expires_at = NULL,
          error_code = COALESCE(error_code, 'creator_stage_interrupted_on_restart'),
          error_message = COALESCE(error_message, 'Creator stage was interrupted by a runtime restart'),
          finished_at = COALESCE(finished_at, ?)
      WHERE status IN ('queued', 'running')
    `).run(timestamp);

    const updateJob = db.prepare(`
      UPDATE creator_jobs
      SET status = 'needs_input', updated_at = ?
      WHERE id = ? AND status = 'running'
    `);
    for (const row of affectedJobs) updateJob.run(timestamp, row.job_id);
  })();
}

function recoverInterruptedIssues(
  db: Database.Database,
  timestamp: string,
  idFactory: (prefix: string) => string
): void {
  db.transaction(() => {
    const rows = db.prepare(`
      SELECT * FROM creator_issues WHERE status = 'resolving'
    `).all() as IssueRow[];
    const update = db.prepare(`
      UPDATE creator_issues
      SET status = ?, last_retry_result = ?, resolved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'resolving'
    `);
    const insertEvent = db.prepare(`
      INSERT INTO creator_issue_events (id, issue_id, kind, retry_result, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      const result = recoveredIssueResult(db, row);
      const succeeded = result === 'succeeded';
      update.run(succeeded ? 'resolved' : 'open', result, succeeded ? timestamp : null, timestamp, row.id);
      insertEvent.run(
        idFactory('creator_issue_event'),
        row.id,
        `attempt_${result}`,
        result,
        timestamp
      );
      if (succeeded) {
        insertEvent.run(idFactory('creator_issue_event'), row.id, 'resolved', result, timestamp);
      }
    }
  })();
}

function recoveredIssueResult(db: Database.Database, row: IssueRow): Exclude<IssueRetryResult, 'none'> {
  if (row.association_kind === 'stage-run') {
    const stage = db.prepare('SELECT status FROM creator_stage_runs WHERE id = ?')
      .get(row.association_id) as { status: CreatorStageRunStatus } | undefined;
    if (stage?.status === 'succeeded') return 'succeeded';
    if (stage?.status === 'failed') return 'failed';
    if (stage?.status === 'canceled') return 'canceled';
    return 'interrupted';
  }
  if (row.association_kind === 'provider-request') {
    const provider = db.prepare('SELECT status FROM creator_provider_requests WHERE id = ?')
      .get(row.association_id) as { status: CreatorProviderRequestStatus } | undefined;
    if (provider?.status === 'succeeded') return 'succeeded';
    if (provider?.status === 'failed') return 'failed';
    if (provider?.status === 'canceled') return 'canceled';
    if (provider?.status === 'unknown_remote_acceptance') return 'unknown';
    return 'interrupted';
  }
  if (row.association_kind === 'command-receipt') {
    const receipt = db.prepare('SELECT status FROM creator_command_receipts WHERE id = ?')
      .get(row.association_id) as { status: string } | undefined;
    if (receipt?.status === 'committed' || receipt?.status === 'replayed') return 'succeeded';
    if (receipt?.status === 'failed' || receipt?.status === 'rejected') return 'failed';
    return 'interrupted';
  }
  return 'interrupted';
}

function hydrateIssue(row: IssueRow): OpenCreatorIssue {
  const candidate: OpenCreatorIssue = {
    id: row.id,
    diagnosticId: row.diagnostic_id,
    code: row.code,
    scope: { kind: 'creator-job', jobId: row.job_id },
    source: row.source,
    category: row.category,
    severity: row.severity,
    status: row.status,
    ...(row.operation === null ? {} : { operation: row.operation }),
    ...(row.stage_id === null ? {} : { stageId: row.stage_id }),
    ...(row.stage_run_id === null ? {} : { stageRunId: row.stage_run_id }),
    ...(row.scope_key === null ? {} : { scopeKey: row.scope_key }),
    summaryKey: row.summary_key,
    summaryParams: parseIssueSummaryParams(row.summary_params_json),
    fallbackMessage: row.fallback_message,
    ...(row.public_facts_json === null ? {} : { publicFacts: parseIssuePublicFacts(row.public_facts_json) }),
    ...(row.technical_detail === null ? {} : { technicalDetail: row.technical_detail }),
    retryable: row.retryable === 1,
    repairActions: safeRepairActions(row.repair_actions_json),
    fingerprint: row.fingerprint,
    occurrenceCount: row.occurrence_count,
    occurredAt: toIso(row.occurred_at),
    lastOccurredAt: toIso(row.last_occurred_at),
    ...(row.resolved_at === null ? {} : { resolvedAt: toIso(row.resolved_at) })
  };
  if (!isOpenCreatorIssue(candidate)) {
    throw new CreatorRepositoryDataError(`Creator issue ${row.id} is corrupt`);
  }
  return candidate;
}

function hydrateIssueEvent(row: IssueEventRow): CreatorIssueEvent {
  return {
    id: row.id,
    issueId: row.issue_id,
    kind: row.kind,
    retryResult: row.retry_result,
    createdAt: toIso(row.created_at)
  };
}

function parseIssueSummaryParams(value: string): Record<string, string | number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CreatorRepositoryDataError('Creator issue summary params are invalid JSON');
  }
  if (!isUnknownRecord(parsed)) {
    throw new CreatorRepositoryDataError('Creator issue summary params must be an object');
  }
  const entries = Object.entries(parsed);
  if (entries.length > 12 || entries.some(([, item]) => (
    typeof item !== 'string' && typeof item !== 'number'
  ))) {
    throw new CreatorRepositoryDataError('Creator issue summary params are invalid');
  }
  return parsed as Record<string, string | number>;
}

function parseIssuePublicFacts(value: string): NonNullable<OpenCreatorIssue['publicFacts']> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CreatorRepositoryDataError('Creator issue public facts are invalid JSON');
  }
  if (!isPublicErrorFacts(parsed)) {
    throw new CreatorRepositoryDataError('Creator issue public facts are invalid');
  }
  return parsed;
}

function safeRepairActions(value: string): CreatorRepairAction[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CreatorRepositoryDataError('Creator issue repair actions are invalid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new CreatorRepositoryDataError('Creator issue repair actions are invalid');
  }
  return parsed.flatMap(item => {
    if (!isUnknownRecord(item) || typeof item.kind !== 'string') return [];
    if (
      item.kind === 'retry-operation'
      && typeof item.operationId === 'string'
      && typeof item.requiresConfirmation === 'boolean'
      && ['normal', 'paid', 'overwrite'].includes(String(item.risk))
    ) {
      return [item as CreatorRepairAction];
    }
    if (item.kind === 'open-settings' && typeof item.settingsRouteId === 'string') {
      return [item as CreatorRepairAction];
    }
    if (item.kind === 'select-input' && typeof item.inputField === 'string') {
      return [item as CreatorRepairAction];
    }
    if (item.kind === 'focus-agent') return [{ kind: 'focus-agent' as const }];
    return [];
  });
}

function diagnosticId(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '').slice(-8).padStart(8, '0').toUpperCase();
  return `OC-${compact}`;
}

function deriveLegacyStageIssues(
  jobId: string,
  stages: CreatorStageRun[]
): OpenCreatorIssue[] {
  const latestByScope = new Map<string, CreatorStageRun>();
  for (const stage of stages) {
    latestByScope.set(`${stage.stageId}\u0000${stage.scopeKey ?? ''}`, stage);
  }
  return [...latestByScope.values()].flatMap(stage => {
    if (stage.status !== 'failed') return [];
    const code = stage.errorCode?.trim() || 'creator_stage_failed';
    const digest = createHash('sha256')
      .update(JSON.stringify([jobId, stage.stageId, stage.scopeKey, stage.id, code]))
      .digest('hex');
    const id = `legacy_${digest.slice(0, 32)}`;
    const providerFailure = code.startsWith('creator_provider_');
    const outputFailure = code === 'creator_translation_output_language_mismatch'
      || code.startsWith('creator_output_');
    const retryable = code !== 'creator_provider_resolution_required';
    const repairActions: CreatorRepairAction[] = [
      ...(retryable
        ? [{
            kind: 'retry-operation' as const,
            operationId: 'creator.retry-stage',
            requiresConfirmation: false,
            risk: 'normal' as const
          }]
        : []),
      { kind: 'focus-agent' as const }
    ];
    const occurredAt = stage.finishedAt ?? stage.startedAt ?? new Date(0).toISOString();
    return [{
      id,
      diagnosticId: diagnosticId(id),
      code,
      scope: { kind: 'creator-job' as const, jobId },
      source: providerFailure
        ? 'provider' as const
        : outputFailure
          ? 'output-validator' as const
          : 'stage' as const,
      category: providerFailure
        ? 'provider' as const
        : outputFailure
          ? 'output-validation' as const
          : 'execution' as const,
      severity: 'error' as const,
      status: 'open' as const,
      operation: 'creator.retry-stage',
      stageId: stage.stageId,
      stageRunId: stage.id,
      ...(stage.scopeKey === null ? {} : { scopeKey: stage.scopeKey }),
      summaryKey: outputFailure
        ? 'issue.translation_language_mismatch'
        : providerFailure
          ? 'issue.provider'
          : 'issue.execution',
      summaryParams: {},
      fallbackMessage: outputFailure
        ? '翻译结果未通过目标语言检查，请修正后重试。'
        : providerFailure
          ? '外部服务调用失败，请先确认请求状态后再继续。'
          : '创作步骤执行失败，可以重试或询问 Agent。',
      retryable,
      repairActions,
      fingerprint: digest,
      occurrenceCount: 1,
      occurredAt,
      lastOccurredAt: occurredAt
    }];
  });
}

function encodeIssueCursor(sequence: number): string {
  return Buffer.from(String(sequence), 'utf8').toString('base64url');
}

function decodeIssueCursor(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = Number(Buffer.from(value, 'base64url').toString('utf8'));
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  } catch {
    // Invalid cursors produce an empty page boundary; the API rejects them before this layer.
  }
  return undefined;
}

type JobRow = {
  id: string;
  project_id: string;
  template_id: string;
  template_version: number;
  status: CreatorJobStatus;
  revision: number;
  state_json: string;
  preset_origin_json: string | null;
  creation_fingerprint: string | null;
  agent_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

type IssueRow = {
  id: string;
  job_id: string;
  diagnostic_id: string;
  code: string;
  source: OpenCreatorIssue['source'];
  category: OpenCreatorIssue['category'];
  severity: OpenCreatorIssue['severity'];
  status: OpenCreatorIssue['status'];
  operation: string | null;
  stage_id: string | null;
  stage_run_id: string | null;
  scope_key: string | null;
  summary_key: string;
  summary_params_json: string;
  fallback_message: string;
  public_facts_json: string | null;
  technical_detail: string | null;
  retryable: 0 | 1;
  repair_actions_json: string;
  fingerprint: string;
  occurrence_count: number;
  resolution_attempt_id: string | null;
  association_kind: CreatorIssueAssociationKind | null;
  association_id: string | null;
  last_retry_result: IssueRetryResult;
  last_event_kind: Extract<CreatorIssueEvent['kind'], 'occurrence' | 'reopened'>;
  occurred_at: string;
  last_occurred_at: string;
  resolved_at: string | null;
  updated_at: string;
};

type IssueEventRow = {
  sequence: number;
  id: string;
  issue_id: string;
  kind: CreatorIssueEvent['kind'];
  retry_result: IssueRetryResult;
  created_at: string;
};

export class CreatorRepositoryDataError extends Error {
  readonly code = 'creator_data_corrupt';

  constructor(message: string) {
    super(message);
    this.name = 'CreatorRepositoryDataError';
  }
}

type StageRow = {
  id: string;
  job_id: string;
  stage_id: string;
  executor: string;
  status: CreatorStageRunStatus;
  dispatch_status: CreatorStageDispatchStatus;
  claim_owner: string | null;
  claim_expires_at: string | null;
  attempt: number;
  idempotency_key: string | null;
  scope_key: string | null;
  input_fingerprint: string | null;
  progress_json: string;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

function hydrateStageRun(row: StageRow): CreatorStageRun {
  return {
    id: row.id,
    jobId: row.job_id,
    stageId: row.stage_id,
    executor: row.executor,
    status: row.status,
    dispatchStatus: row.dispatch_status,
    claimOwner: row.claim_owner,
    claimExpiresAt: nullableIso(row.claim_expires_at),
    attempt: row.attempt,
    idempotencyKey: row.idempotency_key,
    scopeKey: row.scope_key,
    inputFingerprint: row.input_fingerprint,
    progress: parseJsonRecord(row.progress_json),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at)
  };
}

function isTerminalStage(status: CreatorStageRunStatus): boolean {
  return ['succeeded', 'failed', 'canceled', 'interrupted'].includes(status);
}

type ArtifactRow = {
  id: string;
  job_id: string;
  kind: string;
  version: number;
  status: CreatorArtifactStatus;
  path: string | null;
  scope_key: string | null;
  input_fingerprint: string | null;
  sha256: string | null;
  source_artifact_ids_json: string;
  metadata_json: string;
  created_at: string;
};

type ProviderRequestRow = {
  id: string;
  job_id: string;
  provider: string;
  stage_run_id: string;
  scope_key: string | null;
  request_key: string;
  request_hash: string;
  remote_task_id: string | null;
  billing_side_effect: 0 | 1;
  status: CreatorProviderRequestStatus;
  result_artifact_id: string | null;
  generation: number;
  resubmission_of: string | null;
  created_at: string;
  updated_at: string;
};

function hydrateProviderRequest(row: ProviderRequestRow): CreatorProviderRequest {
  return {
    id: row.id,
    jobId: row.job_id,
    provider: row.provider,
    stageRunId: row.stage_run_id,
    scopeKey: row.scope_key,
    requestKey: row.request_key,
    requestHash: row.request_hash,
    remoteTaskId: row.remote_task_id,
    billingSideEffect: row.billing_side_effect === 1,
    status: row.status,
    resultArtifactId: row.result_artifact_id,
    generation: row.generation,
    resubmissionOf: row.resubmission_of,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

type LegacyTargetSubtitleRow = {
  id: string;
  job_id: string;
  status: CreatorArtifactStatus;
  path: string;
  source_artifact_ids_json: string;
  metadata_json: string;
  created_at: string;
};

type ActivityRow = {
  id: string;
  job_id: string;
  revision: number;
  actor: CreatorActor;
  action: string;
  summary: string;
  details_json: string;
  created_at: string;
};

function parseJsonRecord(value: string): Record<string, CreatorJson> {
  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Invalid creator JSON record');
  }
  return parsed as Record<string, CreatorJson>;
}

function parsePresetOrigin(value: string | null): CreatorPresetOrigin | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CreatorRepositoryDataError('Creator preset origin contains invalid JSON');
  }
  if (
    !isRecord(parsed)
    || !hasExactKeys(parsed, [
      'module',
      'id',
      'version',
      'locale',
      'title',
      'contentHash'
    ])
    || ![
      'video-translation',
      'video-download',
      'image-generation',
      'video-generation',
      'cover-generator',
      'smart-dubbing'
    ].includes(String(parsed.module))
    || typeof parsed.id !== 'string'
    || parsed.id.trim() === ''
    || typeof parsed.version !== 'number'
    || !Number.isInteger(parsed.version)
    || parsed.version < 1
    || (parsed.locale !== 'zh-CN' && parsed.locale !== 'en-US')
    || typeof parsed.title !== 'string'
    || typeof parsed.contentHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(parsed.contentHash)
  ) {
    throw new CreatorRepositoryDataError('Creator preset origin is invalid');
  }
  return parsed as unknown as CreatorPresetOrigin;
}

function validateCreationFingerprint(id: string, value: string | null): void {
  if (value !== null && !/^[a-f0-9]{64}$/.test(value)) {
    throw new CreatorRepositoryDataError(
      `Creator job ${id} has an invalid creation fingerprint`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('Invalid creator string array');
  }
  return parsed;
}

function nullableIso(value: string | null): string | null {
  return value === null ? null : toIso(value);
}

function toIso(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(normalized).toISOString();
}
