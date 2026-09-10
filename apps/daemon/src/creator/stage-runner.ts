import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorArtifact, CreatorJob, CreatorJson, CreatorStageRun } from '@opencreator/protocol';
import type { CreatorExecutor } from './executor.js';
import { CreatorExecutorError } from './executor.js';
import type { CreatorRepository } from './repository.js';
import { CreatorProviderRequestError } from './provider-requests.js';
import {
  appendCreatorResultSnapshot,
  creatorResultSnapshotForVersion,
  nextCreatorResultVersion
} from './result-snapshots.js';
import { currentStickmanScopedArtifacts } from './stickman/lineage.js';
import type { CreatorTemplateRegistry } from './templates/types.js';
import { videoTranslationArtifactRefsPatch } from './templates/video-translation-results.js';

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
  const laneTails = new Map<string, Promise<unknown>>();
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
    const laneKey = queued.scopeKey === null
      ? jobId
      : `${jobId}:${queued.stageId}:${queued.scopeKey}`;
    const previous = laneTails.get(laneKey) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => execute(stageRunId));
    laneTails.set(laneKey, work);
    try {
      return await work;
    } finally {
      if (laneTails.get(laneKey) === work) laneTails.delete(laneKey);
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
      const inputResultVersion = readPositiveInteger(stageRun.progress.inputResultVersion);
      const inputSnapshot = inputResultVersion === undefined
        ? undefined
        : creatorResultSnapshotForVersion(job, inputResultVersion);
      if (inputResultVersion !== undefined && inputSnapshot === undefined) {
        throw new CreatorExecutorError(
          'creator_result_version_not_found',
          `Creator result version ${inputResultVersion} was not found`
        );
      }
      const resolved = resolveInputs(job, stage.inputArtifacts, inputSnapshot?.artifactRefs);
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
        if (
          (output.scopeKey !== undefined && output.scopeKey !== stageRun.scopeKey)
          || (output.inputFingerprint !== undefined
            && output.inputFingerprint !== stageRun.inputFingerprint)
        ) {
          throw new CreatorExecutorError(
            'creator_artifact_scope_mismatch',
            'Executor output scope does not match the current stage run'
          );
        }
      }
      const outputHashes = await Promise.all(result.outputs.map(async output => (
        output.path === null ? null : sha256File(output.path)
      )));
      input.repository.transaction(() => {
        const beforeOutputs = requireJob(input.repository, jobId);
        const createsResultVersion = stage.resultVersionPolicy !== 'none';
        const targetResultVersion = readPositiveInteger(stageRun!.progress.targetResultVersion);
        const resultVersion = createsResultVersion
          ? targetResultVersion ?? nextCreatorResultVersion(beforeOutputs)
          : undefined;
        const insertedArtifacts: CreatorArtifact[] = [];
        const changedKinds = new Set(result.outputs.map(output => output.kind));
        const scopedReplacementIds = stage.replaceOutputArtifactsInScope === true
          && stageRun!.scopeKey !== null
          ? artifactIdsAndDependents(
              beforeOutputs,
              beforeOutputs.artifacts
                .filter(artifact => (
                  artifact.status === 'completed'
                  && artifact.scopeKey === stageRun!.scopeKey
                  && changedKinds.has(artifact.kind)
                ))
                .map(artifact => artifact.id)
            )
          : [];
        const staleArtifactIds = [...new Set([
          ...(stage.invalidateDependentArtifacts === false
            ? []
            : dependentArtifactIdsForChangedKinds(beforeOutputs, changedKinds)),
          ...scopedReplacementIds
        ])];
        for (const artifactId of staleArtifactIds) {
          input.repository.setArtifactStatus(artifactId, 'stale');
        }
        for (const [outputIndex, output] of result.outputs.entries()) {
          insertedArtifacts.push(input.repository.insertArtifact({
            jobId,
            kind: output.kind,
            status: output.status,
            path: output.path,
            scopeKey: stageRun!.scopeKey,
            inputFingerprint: stageRun!.inputFingerprint,
            sha256: outputHashes[outputIndex] ?? null,
            sourceArtifactIds: output.sourceArtifactIds ?? resolved.artifacts.map(artifact => artifact.id),
            metadata: {
              ...(output.metadata ?? {}),
              ...(resultVersion === undefined ? {} : { resultVersion })
            }
          }));
        }
        updateStageRun({
          id: stageRun!.id,
          status: 'succeeded',
          progress: {
            ...(result.progress ?? {}),
            ...(resultVersion === undefined ? {} : { resultVersion })
          }
        });
        const latest = requireJob(input.repository, jobId);
        const artifactRefsPatch = {
          ...(job.templateId === 'cover'
            ? artifactRefsByKind(resolved.artifacts)
            : {}),
          ...(job.templateId === 'video-translation'
            ? videoTranslationArtifactRefsPatch(job.state, stageId)
            : {}),
          ...(job.templateId === 'stickman-video' && stageId === 'package-validation'
            ? exactArtifactRefsPatch(latest, insertedArtifacts)
            : {})
        };
        const baseResultVersion = readPositiveInteger(stageRun!.progress.baseResultVersion);
        const snapshotPatch = insertedArtifacts.length === 0 || resultVersion === undefined
          ? {}
          : appendCreatorResultSnapshot({
              job: latest,
              version: resultVersion,
              ...(baseResultVersion === undefined ? {} : { baseResultVersion }),
              changedArtifacts: insertedArtifacts,
              ...(Object.keys(artifactRefsPatch).length === 0 ? {} : { artifactRefsPatch }),
              staleArtifactIds,
              action: 'stage-succeeded',
              stageId,
              description: resultSnapshotDescription(stageId, job.templateId),
              state: job.state
            });
        const unresolvedScopedFailure = stageRun!.scopeKey !== null
          && hasUnresolvedScopedFailure(latest, stageId);
        updateJob(
          input.repository,
          latest,
          unresolvedScopedFailure
            ? 'needs_input'
            : stage.jobCompletionPolicy === 'continue'
              ? 'running'
              : stage.completesJob === false
                ? 'draft'
                : 'completed',
          {
            currentStage: stageId,
            ...snapshotPatch,
            ...(!unresolvedScopedFailure && stageRun!.scopeKey !== null
              ? { needsInput: null }
              : {})
          },
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
          const scopedFailure = stageRun.scopeKey !== null && !canceled;
          updateJob(
            input.repository,
            job,
            canceled
              ? 'canceled'
              : scopedFailure || configurationInput !== null
                ? 'needs_input'
                : 'failed',
            {
              currentStage: stageId,
              ...(configurationInput !== null
                ? { needsInput: configurationInput }
                : scopedFailure
                  ? {
                      needsInput: {
                        code: failureCode,
                        message: failureMessage,
                        stageId,
                        scopeKey: stageRun.scopeKey
                      }
                    }
                  : {})
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
    cancelJob(jobId: string): CreatorStageRun[] {
      return input.repository.listStageRuns(jobId)
        .filter(stage => stage.status === 'queued' || stage.status === 'running')
        .map(stage => cancelStage(stage.id))
        .filter((stage): stage is CreatorStageRun => stage !== undefined);
    },
    cancel(stageRunId: string): CreatorStageRun | undefined {
      return cancelStage(stageRunId);
    },
    retry(stageRunId: string): Promise<CreatorStageRun> {
      const stage = input.repository.getStageRun(stageRunId);
      if (stage !== undefined) return run(stage.jobId, stage.stageId);
      throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage run was not found');
    },
    async close() {
      closed = true;
      for (const controller of active.values()) controller.abort();
      await Promise.allSettled([...laneTails.values()]);
    }
  };

  function cancelStage(stageRunId: string): CreatorStageRun | undefined {
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
  }

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

async function sha256File(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

function resolveInputs(
  job: CreatorJob,
  requirements: Array<{
    kind: string;
    selector?: 'latest-completed' | 'explicit-version' | 'state-artifact-id';
    stateKey?: string;
    optional?: boolean;
  }>,
  explicitArtifactRefs?: Record<string, string[]>
): { artifacts: CreatorArtifact[]; missing: string[] } {
  const artifacts: CreatorArtifact[] = [];
  const missing: string[] = [];
  for (const requirement of requirements) {
    if (!creatorInputArtifactEnabled(job, requirement.kind)) continue;
    if (explicitArtifactRefs !== undefined) {
      const explicitIds = explicitArtifactRefs[requirement.kind] ?? [];
      const artifact = [...explicitIds].reverse().flatMap(id => {
        const candidate = job.artifacts.find(item => (
          item.id === id
          && item.kind === requirement.kind
          && (item.status === 'completed' || item.status === 'stale')
        ));
        return candidate === undefined ? [] : [candidate];
      }).at(0);
      if (artifact !== undefined) artifacts.push(artifact);
      else if (requirement.optional !== true) missing.push(requirement.kind);
      continue;
    }
    const selectedId = requirement.selector === 'state-artifact-id'
      && requirement.stateKey !== undefined
      ? job.state[requirement.stateKey]
      : undefined;
    if (
      job.templateId === 'stickman-video'
      && requirement.selector === 'latest-completed'
      && (requirement.kind === 'shot_image' || requirement.kind === 'narration_audio')
    ) {
      const scoped = currentStickmanScopedArtifacts(job, requirement.kind);
      if (scoped.length > 0) artifacts.push(...scoped);
      else if (requirement.optional !== true) missing.push(requirement.kind);
      continue;
    }
    const artifact = requirement.selector === 'state-artifact-id'
      ? typeof selectedId === 'string'
        ? job.artifacts.find(candidate => (
            candidate.id === selectedId
            && candidate.kind === requirement.kind
            && candidate.status === 'completed'
          ))
        : undefined
      : [...job.artifacts].reverse().find(candidate => (
          candidate.kind === requirement.kind && candidate.status === 'completed'
        ));
    if (artifact !== undefined) artifacts.push(artifact);
    else if (
      requirement.optional !== true
      || (requirement.selector === 'state-artifact-id' && selectedId !== null && selectedId !== undefined)
    ) {
      missing.push(requirement.kind);
    }
  }
  return { artifacts, missing };
}

function creatorInputArtifactEnabled(job: CreatorJob, kind: string): boolean {
  if (job.templateId !== 'video-translation') return true;
  if (
    (kind === 'dubbed_audio' || kind === 'dubbed_video')
    && job.state.dubbing !== true
  ) {
    return false;
  }
  if (kind === 'bilingual_subtitle' && job.state.bilingual !== true) {
    return false;
  }
  return true;
}

function dependentArtifactIdsForChangedKinds(job: CreatorJob, changedKinds: Set<string>): string[] {
  const queue = job.artifacts
    .filter(artifact => artifact.status === 'completed' && changedKinds.has(artifact.kind))
    .map(artifact => artifact.id);
  return dependentArtifactIds(job, queue);
}

function artifactIdsAndDependents(job: CreatorJob, rootIds: string[]): string[] {
  return [...new Set([...rootIds, ...dependentArtifactIds(job, rootIds)])];
}

function dependentArtifactIds(job: CreatorJob, rootIds: string[]): string[] {
  const queue = [...rootIds];
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

function artifactRefsByKind(artifacts: CreatorArtifact[]): Record<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const artifact of artifacts) {
    refs.set(artifact.kind, [...(refs.get(artifact.kind) ?? []), artifact.id]);
  }
  return Object.fromEntries(refs);
}

function exactArtifactRefsPatch(
  job: CreatorJob,
  artifacts: CreatorArtifact[]
): Record<string, string[]> {
  return {
    ...Object.fromEntries(
      [...new Set(job.artifacts.map(artifact => artifact.kind))].map(kind => [kind, []])
    ),
    ...artifactRefsByKind(artifacts)
  };
}

function hasUnresolvedScopedFailure(job: CreatorJob, stageId: string): boolean {
  return job.stages.some(stage => (
    stage.stageId === stageId
    && stage.scopeKey !== null
    && stage.inputFingerprint !== null
    && (stage.status === 'failed' || stage.status === 'interrupted')
    && !job.artifacts.some(artifact => (
      artifact.status === 'completed'
      && artifact.scopeKey === stage.scopeKey
      && artifact.inputFingerprint === stage.inputFingerprint
    ))
  ));
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
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
  return error instanceof CreatorExecutorError || error instanceof CreatorProviderRequestError
    ? error.code
    : 'creator_stage_failed';
}

function resultSnapshotDescription(stageId: string, templateId: string): string {
  if (stageId === 'subtitle') return '生成字幕';
  if (stageId === 'tts') return '生成配音';
  if (stageId === 'render-horizontal') return '合成横屏视频';
  if (stageId === 'render-vertical') return '合成竖屏视频';
  if (stageId === 'generate') return templateId === 'cover' ? '生成封面' : '生成图片';
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
    deepLink: `#/settings?tab=ai-services&section=${section === 'llm' ? 'text' : section}`
  };
}
