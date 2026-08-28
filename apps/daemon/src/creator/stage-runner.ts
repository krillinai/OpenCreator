import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorArtifact, CreatorJob, CreatorJson, CreatorStageRun } from '@opencreator/protocol';
import type { CreatorExecutor } from './executor.js';
import { CreatorExecutorError } from './executor.js';
import type { CreatorRepository } from './repository.js';
import {
  appendCreatorResultSnapshot,
  nextCreatorResultVersion
} from './result-snapshots.js';
import type { CreatorTemplateRegistry } from './templates/types.js';

export type CreatorStageRunner = ReturnType<typeof createCreatorStageRunner>;

export function createCreatorStageRunner(input: {
  repository: CreatorRepository;
  templates: CreatorTemplateRegistry;
  executors: CreatorExecutor[];
  workRoot: string;
  maxConcurrency?: number;
  onJobChanged?(job: CreatorJob): void;
  onStageChanged?(stage: CreatorStageRun): void;
  onStageSucceeded?(stage: CreatorStageRun): void;
}) {
  const executors = new Map(input.executors.map(executor => [executor.id, executor]));
  const active = new Map<string, AbortController>();
  const jobTails = new Map<string, Promise<unknown>>();
  const waiters: Array<() => void> = [];
  let running = 0;
  let closed = false;
  const maxConcurrency = Math.max(1, input.maxConcurrency ?? 2);

  async function run(jobId: string, stageId: string): Promise<CreatorStageRun> {
    if (closed) throw new CreatorExecutorError('creator_runner_closed', 'Creator stage runner is closed');
    const job = requireJob(input.repository, jobId);
    const template = input.templates.get(job.templateId, job.templateVersion);
    const stage = template.stages.find(candidate => candidate.id === stageId);
    if (stage === undefined) {
      throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage was not found');
    }
    const stageRun = input.repository.createStageRun({
      jobId,
      stageId,
      executor: stage.executor,
      status: 'queued'
    });
    return runStageRun(stageRun.id);
  }

  async function runStageRun(stageRunId: string): Promise<CreatorStageRun> {
    if (closed) throw new CreatorExecutorError('creator_runner_closed', 'Creator stage runner is closed');
    const queued = input.repository.getStageRun(stageRunId);
    if (queued === undefined) {
      throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage run was not found');
    }
    const jobId = queued.jobId;
    const previous = jobTails.get(jobId) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => execute(stageRunId));
    jobTails.set(jobId, work);
    try {
      return await work;
    } finally {
      if (jobTails.get(jobId) === work) jobTails.delete(jobId);
    }
  }

  async function execute(stageRunId: string): Promise<CreatorStageRun> {
    await acquire();
    let stageRun = input.repository.getStageRun(stageRunId);
    const jobId = stageRun?.jobId ?? '';
    const stageId = stageRun?.stageId ?? '';
    try {
      if (closed) throw new CreatorExecutorError('creator_runner_closed', 'Creator stage runner is closed');
      if (stageRun === undefined) {
        throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage run was not found');
      }
      if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(stageRun.status)) {
        return stageRun;
      }
      const job = requireJob(input.repository, jobId);
      const template = input.templates.get(job.templateId, job.templateVersion);
      const stage = template.stages.find(candidate => candidate.id === stageId);
      if (stage === undefined) throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage was not found');
      if (!stage.allowedJobStatuses.includes(job.status)) {
        throw new CreatorExecutorError('creator_stage_status_forbidden', `Stage ${stageId} cannot run while job is ${job.status}`);
      }
      const executor = executors.get(stage.executor);
      if (executor === undefined) throw new CreatorExecutorError('creator_executor_unavailable', `Creator executor ${stage.executor} is unavailable`);
      const resolved = resolveInputs(job, stage.inputArtifacts);
      updateStageRun({
        id: stageRun.id,
        status: resolved.missing.length === 0 ? 'queued' : 'failed',
        progress: {
          inputArtifactIds: resolved.artifacts.map(artifact => artifact.id),
          ...(resolved.missing.length === 0 ? {} : { missingArtifactKinds: resolved.missing })
        }
      });
      if (resolved.missing.length > 0) {
        updateStageRun({
          id: stageRun.id,
          status: 'failed',
          errorCode: 'creator_stage_input_missing',
          errorMessage: `Missing completed inputs: ${resolved.missing.join(', ')}`
        });
        updateJob(input.repository, job, 'needs_input', { currentStage: stageId }, input.onJobChanged);
        return input.repository.listStageRuns(jobId).find(candidate => candidate.id === stageRun!.id)!;
      }
      const controller = new AbortController();
      active.set(stageRun.id, controller);
      const workdir = join(input.workRoot, jobId, stageRun.id);
      await mkdir(workdir, { recursive: true });
      if (controller.signal.aborted) {
        throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      }
      updateStageRun({ id: stageRun.id, status: 'running' });
      updateJob(input.repository, job, 'running', { currentStage: stageId }, input.onJobChanged);
      const result = await executor.run({
        stageRun: input.repository.listStageRuns(jobId).find(candidate => candidate.id === stageRun!.id)!,
        job: input.repository.getJob(jobId)!,
        inputArtifacts: resolved.artifacts,
        workdir,
        signal: controller.signal,
        reportProgress(progress) {
          if (!controller.signal.aborted) updateStageRun({ id: stageRun!.id, status: 'running', progress });
        }
      });
      if (controller.signal.aborted) throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      const declaredOutputs = new Map(stage.outputArtifacts.map(output => [output.kind, output.status]));
      for (const output of result.outputs) {
        if (declaredOutputs.get(output.kind) !== output.status) {
          throw new CreatorExecutorError('creator_executor_output_invalid', `Executor returned undeclared output ${output.kind}/${output.status}`);
        }
      }
      input.repository.transaction(() => {
        const beforeOutputs = requireJob(input.repository, jobId);
        const resultVersion = nextCreatorResultVersion(beforeOutputs);
        const insertedArtifacts: CreatorArtifact[] = [];
        const staleArtifactIds = dependentArtifactIdsForChangedKinds(
          beforeOutputs,
          new Set(result.outputs.map(output => output.kind))
        );
        for (const artifactId of staleArtifactIds) {
          input.repository.setArtifactStatus(artifactId, 'stale');
        }
        for (const output of result.outputs) {
          insertedArtifacts.push(input.repository.insertArtifact({
            jobId,
            kind: output.kind,
            status: output.status,
            path: output.path,
            sourceArtifactIds: output.sourceArtifactIds ?? resolved.artifacts.map(artifact => artifact.id),
            metadata: { ...(output.metadata ?? {}), resultVersion }
          }));
        }
        updateStageRun({ id: stageRun!.id, status: 'succeeded', progress: result.progress });
        const latest = requireJob(input.repository, jobId);
        const snapshotPatch = insertedArtifacts.length === 0
          ? {}
          : appendCreatorResultSnapshot({
              job: latest,
              version: resultVersion,
              changedArtifacts: insertedArtifacts,
              staleArtifactIds,
              action: 'stage-succeeded',
              stageId,
              description: resultSnapshotDescription(stageId),
              state: job.state
            });
        updateJob(
          input.repository,
          latest,
          'completed',
          { currentStage: stageId, ...snapshotPatch },
          input.onJobChanged
        );
      });
      const completed = input.repository.getStageRun(stageRun.id);
      if (completed !== undefined) {
        try {
          input.onStageSucceeded?.(completed);
        } catch {
          // The completed stage is authoritative; workflow recovery can enqueue the next stage.
        }
      }
    } catch (error) {
      if (stageRun !== undefined) {
        const canceled = active.get(stageRun.id)?.signal.aborted === true;
        const failureCode = canceled ? 'creator_stage_canceled' : errorCode(error);
        const failureMessage = canceled
          ? 'Creator stage was canceled'
          : error instanceof Error
            ? error.message
            : 'Creator stage failed';
        const configurationInput = creatorConfigurationInput(failureCode, failureMessage);
        updateStageRun({
          id: stageRun.id,
          status: canceled ? 'canceled' : 'failed',
          errorCode: failureCode,
          errorMessage: failureMessage
        });
        const job = input.repository.getJob(jobId);
        if (job !== undefined) {
          updateJob(
            input.repository,
            job,
            canceled ? 'canceled' : configurationInput === null ? 'failed' : 'needs_input',
            {
              currentStage: stageId,
              ...(configurationInput === null ? {} : { needsInput: configurationInput })
            },
            input.onJobChanged
          );
        }
      }
      if (stageRun === undefined) throw error;
    } finally {
      if (stageRun !== undefined) active.delete(stageRun.id);
      release();
    }
    return input.repository.listStageRuns(jobId).find(candidate => candidate.id === stageRun!.id)!;
  }

  function updateStageRun(
    update: Parameters<CreatorRepository['updateStageRun']>[0]
  ): CreatorStageRun {
    const current = input.repository.getStageRun(update.id);
    input.repository.updateStageRun({
      ...update,
      ...(update.progress === undefined
        ? {}
        : { progress: { ...(current?.progress ?? {}), ...update.progress } })
    });
    const stage = input.repository.getStageRun(update.id);
    if (stage === undefined) {
      throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage run was not found');
    }
    input.onStageChanged?.(stage);
    return stage;
  }

  return {
    run,
    runStageRun,
    cancel(stageRunId: string): CreatorStageRun | undefined {
      const stage = input.repository.getStageRun(stageRunId);
      if (stage === undefined) return undefined;
      if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(stage.status)) {
        return stage;
      }
      const controller = active.get(stageRunId);
      if (controller !== undefined) {
        const canceling = updateStageRun({
          id: stageRunId,
          status: stage.status,
          progress: { cancelRequested: true }
        });
        controller.abort();
        return canceling;
      }
      let canceled: CreatorStageRun | undefined;
      input.repository.transaction(() => {
        const current = input.repository.getStageRun(stageRunId);
        if (current === undefined) return;
        if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(current.status)) {
          canceled = current;
          return;
        }
        canceled = updateStageRun({
          id: stageRunId,
          status: 'canceled',
          progress: { cancelRequested: true },
          errorCode: 'creator_stage_canceled',
          errorMessage: 'Creator stage was canceled'
        });
        const job = input.repository.getJob(current.jobId);
        if (job !== undefined) {
          updateJob(
            input.repository,
            job,
            'canceled',
            { currentStage: current.stageId },
            input.onJobChanged
          );
        }
      });
      return canceled;
    },
    retry(stageRunId: string): Promise<CreatorStageRun> {
      const stage = input.repository.getStageRun(stageRunId);
      if (stage !== undefined) return run(stage.jobId, stage.stageId);
      throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage run was not found');
    },
    async close() {
      closed = true;
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled([...jobTails.values()]);
    }
  };

  async function acquire(): Promise<void> {
    if (running < maxConcurrency) {
      running += 1;
      return;
    }
    await new Promise<void>(resolve => waiters.push(resolve));
    running += 1;
  }

  function release(): void {
    running -= 1;
    waiters.shift()?.();
  }
}

function resolveInputs(
  job: CreatorJob,
  requirements: Array<{ kind: string; optional?: boolean }>
): { artifacts: CreatorArtifact[]; missing: string[] } {
  const artifacts: CreatorArtifact[] = [];
  const missing: string[] = [];
  for (const requirement of requirements) {
    const artifact = [...job.artifacts].reverse().find(candidate => (
      candidate.kind === requirement.kind && candidate.status === 'completed'
    ));
    if (artifact !== undefined) artifacts.push(artifact);
    else if (requirement.optional !== true) missing.push(requirement.kind);
  }
  return { artifacts, missing };
}

function dependentArtifactIdsForChangedKinds(job: CreatorJob, changedKinds: Set<string>): string[] {
  const queue = job.artifacts
    .filter(artifact => artifact.status === 'completed' && changedKinds.has(artifact.kind))
    .map(artifact => artifact.id);
  const visited = new Set<string>();
  const stale = new Set<string>();
  while (queue.length > 0) {
    const sourceId = queue.shift()!;
    if (visited.has(sourceId)) continue;
    visited.add(sourceId);
    for (const artifact of job.artifacts) {
      if (artifact.status !== 'completed' || !artifact.sourceArtifactIds.includes(sourceId)) continue;
      stale.add(artifact.id);
      queue.push(artifact.id);
    }
  }
  return [...stale];
}

function updateJob(
  repository: CreatorRepository,
  job: CreatorJob,
  status: CreatorJob['status'],
  statePatch: Record<string, CreatorJson>,
  onJobChanged?: (job: CreatorJob) => void
): void {
  repository.updateJob({
    id: job.id,
    status,
    revision: job.revision + 1,
    state: { ...job.state, ...statePatch }
  });
  const updated = repository.getJob(job.id);
  if (updated !== undefined) onJobChanged?.(updated);
}

function requireJob(repository: CreatorRepository, jobId: string): CreatorJob {
  const job = repository.getJob(jobId);
  if (job === undefined) throw new CreatorExecutorError('creator_job_not_found', 'Creator job was not found');
  return job;
}

function errorCode(error: unknown): string {
  return error instanceof CreatorExecutorError ? error.code : 'creator_stage_failed';
}

function resultSnapshotDescription(stageId: string): string {
  if (stageId === 'subtitle') return '生成字幕';
  if (stageId === 'tts') return '生成配音';
  if (stageId === 'render-horizontal') return '合成横屏视频';
  if (stageId === 'render-vertical') return '合成竖屏视频';
  if (stageId === 'generate') return '生成图片';
  return `完成 ${stageId}`;
}

function creatorConfigurationInput(code: string, message: string): Record<string, CreatorJson> | null {
  const section = code === 'creator_llm_config_missing'
    ? 'llm'
    : code === 'creator_transcription_config_missing'
      ? 'transcription'
      : code === 'creator_tts_config_missing'
        ? 'tts'
        : code === 'creator_image_config_missing'
          ? 'image'
        : null;
  return section === null ? null : {
    code,
    message,
    deepLink: `/settings/ai-services?section=${section}`
  };
}
