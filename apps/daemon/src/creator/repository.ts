import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  CreatorActivity,
  CreatorActor,
  CreatorArtifact,
  CreatorArtifactStatus,
  CreatorJob,
  CreatorJobStatus,
  CreatorJson,
  CreatorStageRun,
  CreatorStageDispatchStatus,
  CreatorStageRunStatus
} from '@opencreator/protocol';
import { parseSrt } from './validators/srt.js';

type RepositoryOptions = {
  idFactory?(prefix: string): string;
  now?(): string;
};

type CreateJobInput = {
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
};

export type CreatorRepository = {
  transaction<T>(operation: () => T): T;
  createJob(input: CreateJobInput): CreatorJob;
  getJob(id: string): CreatorJob | undefined;
  listJobs(projectId?: string): CreatorJob[];
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
  listArtifacts(jobId: string): CreatorArtifact[];
  listActivities(jobId: string): CreatorActivity[];
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

  const getJob = (id: string): CreatorJob | undefined => {
    const row = db.prepare(`
      SELECT id, project_id, template_id, template_version, status, revision,
             state_json, agent_thread_id, created_at, updated_at
      FROM creator_jobs
      WHERE id = ?
    `).get(id) as JobRow | undefined;
    return row === undefined ? undefined : hydrateJob(row);
  };

  const hydrateJob = (row: JobRow): CreatorJob => ({
    id: row.id,
    projectId: row.project_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    status: row.status,
    revision: row.revision,
    state: parseJsonRecord(row.state_json),
    agentThreadId: row.agent_thread_id,
    stages: listStageRuns(row.id),
    artifacts: listArtifacts(row.id),
    activities: listActivities(row.id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });

  const listStageRuns = (jobId: string): CreatorStageRun[] => (
    db.prepare(`
      SELECT id, job_id, stage_id, executor, status, dispatch_status,
             claim_owner, claim_expires_at, attempt, idempotency_key,
             progress_json, error_code, error_message, started_at, finished_at
      FROM creator_stage_runs
      WHERE job_id = ?
      ORDER BY created_at ASC, id ASC
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
    progress: parseJsonRecord(row.progress_json),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: nullableIso(row.started_at),
    finishedAt: nullableIso(row.finished_at)
  }));

  const listArtifacts = (jobId: string): CreatorArtifact[] => (
    db.prepare(`
      SELECT id, job_id, kind, version, status, path,
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
        source_artifact_ids_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.jobId,
      input.kind,
      versionRow.version,
      input.status,
      input.path,
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
          id, project_id, template_id, template_version, status, revision,
          state_json, agent_thread_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.templateId,
        input.templateVersion,
        input.status,
        JSON.stringify(input.state),
        input.agentThreadId ?? null,
        timestamp,
        timestamp
      );
      return getJob(id)!;
    },
    getJob,
    listJobs(projectId?: string): CreatorJob[] {
      const rows = projectId === undefined
        ? db.prepare(`
            SELECT id, project_id, template_id, template_version, status, revision,
                   state_json, agent_thread_id, created_at, updated_at
            FROM creator_jobs
            ORDER BY updated_at DESC, id DESC
          `).all()
        : db.prepare(`
            SELECT id, project_id, template_id, template_version, status, revision,
                   state_json, agent_thread_id, created_at, updated_at
            FROM creator_jobs
            WHERE project_id = ?
            ORDER BY updated_at DESC, id DESC
          `).all(projectId);
      return (rows as JobRow[]).map(hydrateJob);
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
          claim_owner, claim_expires_at, attempt, idempotency_key, progress_json,
          started_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?)
      `).run(
        id,
        input.jobId,
        input.stageId,
        input.executor,
        input.status,
        input.dispatchStatus ?? (isTerminalStage(input.status) ? 'finished' : 'queued'),
        input.idempotencyKey ?? null,
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
               progress_json, error_code, error_message, started_at, finished_at
        FROM creator_stage_runs
        WHERE dispatch_status = 'queued'
           OR (dispatch_status = 'claimed' AND claim_expires_at <= ?)
        ORDER BY created_at ASC, id ASC
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

type JobRow = {
  id: string;
  project_id: string;
  template_id: string;
  template_version: number;
  status: CreatorJobStatus;
  revision: number;
  state_json: string;
  agent_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

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
  source_artifact_ids_json: string;
  metadata_json: string;
  created_at: string;
};

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
