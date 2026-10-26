import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  readCreatorResultSnapshots,
  publicErrorKindForCode,
  publicErrorCodeFromFailure,
  publicErrorMessageFromFailure,
  type CreatorArtifact,
  type CreatorJob,
  type CreatorJson,
  type CreatorStageRun
} from '@opencreator/protocol';
import type { CreatorExecutor } from './executor.js';
import { CreatorExecutorError } from './executor.js';
import type { CreatorRepository } from './repository.js';
import type { CreatorIssueService } from './issues.js';
import { CreatorProviderRequestError, CreatorProviderRequestLedger } from './provider-requests.js';
import { publicFactsFromFailure } from './public-error-facts.js';
import { sha256CreatorFile } from './file-hash.js';
import {
  appendCreatorResultSnapshot,
  attachCreatorResultArtifacts,
  creatorResultSnapshotForVersion,
  nextCreatorResultVersion
} from './result-snapshots.js';
import { currentStickmanScopedArtifacts } from './stickman/lineage.js';
import type { CreatorTemplateRegistry, CreatorTemplateStage } from './templates/types.js';
import { attachDownloadedTranslationSource, isBackgroundSourceDownload } from './templates/video-translation-source.js';
import { videoTranslationArtifactRefsPatch } from './templates/video-translation-results.js';
import { downloadWorkdirStageId } from './download/resume.js';
import { createCreatorProcessControl, type CreatorProcessControl } from './process-tree.js';
import {
  CreatorOutputValidationError,
  validateCreatorStageOutputs
} from './output-validation.js';
import type { CreatorTelemetrySink } from '../telemetry/creator.js';
import { creatorStageTelemetryOutcome } from '../telemetry/creator.js';

export type CreatorStageRunner = ReturnType<typeof createCreatorStageRunner>;

export function createCreatorStageRunner(input: {
  repository: CreatorRepository;
  issueService?: CreatorIssueService;
  templates: CreatorTemplateRegistry;
  executors: CreatorExecutor[];
  workRoot: string;
  maxConcurrency?: number;
  telemetry?: CreatorTelemetrySink;
  beforeRun?(job: CreatorJob, stageId: string): void | Promise<void>;
  onJobChanged?(job: CreatorJob): void;
  onStageChanged?(stage: CreatorStageRun): void;
  onStageSucceeded?(stage: CreatorStageRun): void;
}) {
  const executors = new Map(input.executors.map(executor => [executor.id, executor]));
  const providerLedger = new CreatorProviderRequestLedger(input.repository, input.issueService);
  const active = new Map<string, AbortController>();
  const processControls = new Map<string, CreatorProcessControl>();
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
    const laneKey = isBackgroundSourceDownload(queued)
      ? `${jobId}:source-download`
      : queued.scopeKey === null
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
      if (stage.resultVersionPolicy === 'attach' && inputSnapshot === undefined) {
        throw new CreatorExecutorError('creator_result_version_not_found', 'A saved result version is required to prepare preview media');
      }
      if (inputResultVersion !== undefined && inputSnapshot === undefined) {
        throw new CreatorExecutorError(
          'creator_result_version_not_found',
          `Creator result version ${inputResultVersion} was not found`
        );
      }
      const pinnedDownloadProbe = job.templateId === 'video-download' && stageId === 'download'
        && typeof stageRun.progress.probeArtifactId === 'string' ? stageRun.progress.probeArtifactId : undefined;
      const resolved = resolveCreatorStageInputs(job, stage.inputArtifacts,
        pinnedDownloadProbe === undefined ? inputSnapshot?.artifactRefs : { download_probe: [pinnedDownloadProbe] }, inputSnapshot?.state);
      updateStageRun({
        id: stageRun.id,
        status: resolved.missing.length === 0 ? 'queued' : 'failed',
        progress: {
          inputArtifactIds: resolved.artifacts.map(artifact => artifact.id),
          ...(resolved.missing.length === 0 ? {} : { missingArtifactKinds: resolved.missing })
        }
      });
      if (resolved.missing.length > 0) {
        input.repository.transaction(() => {
          updateStageRun({
            id: stageRun!.id,
            status: 'failed',
            errorCode: 'creator_stage_input_missing',
            errorMessage: `Missing completed inputs: ${resolved.missing.join(', ')}`
          });
          updateJob(input.repository, job, stage.jobCompletionPolicy === 'preserve' ? job.status : 'needs_input', { currentStage: stageId }, input.onJobChanged);
          const resolution = finishStageIssueResolution(jobId, stageRun!.id, 'failed');
          if (resolution === undefined) {
            input.issueService?.capture({
              jobId,
              code: 'creator_stage_input_missing',
              source: 'stage',
              category: 'input',
              operation: 'creator.run-stage',
              stageId,
              stageRunId: stageRun!.id,
              scopeKey: stageRun!.scopeKey ?? undefined,
              fallbackMessage: 'Required input for this step is missing. Add it and try again.',
              repairActions: [{ kind: 'select-input', inputField: 'source' }, { kind: 'focus-agent' }]
            });
          }
        });
        emitStageFinished(stageRun.id);
        return input.repository.listStageRuns(jobId).find(candidate => candidate.id === stageRun!.id)!;
      }
      await input.beforeRun?.(input.repository.getJob(jobId)!, stageId);
      const beforeStart = input.repository.getStageRun(stageRun.id);
      if (beforeStart && ['succeeded', 'failed', 'canceled', 'interrupted'].includes(beforeStart.status)) return beforeStart;
      const controller = new AbortController();
      active.set(stageRun.id, controller);
      const processControl = job.templateId === 'video-download' && stageId === 'download' && executor.supportsProcessPause
        ? createCreatorProcessControl(controller.signal) : undefined;
      if (processControl) processControls.set(stageRun.id, processControl);
      const workdirStageId = downloadWorkdirStageId(job, stageRun);
      const workdir = join(input.workRoot, jobId, workdirStageId);
      await mkdir(workdir, { recursive: true });
      if (controller.signal.aborted) {
        throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      }
      updateStageRun({ id: stageRun.id, status: 'running',
        ...(job.templateId === 'video-download' && stageId === 'download'
          ? { progress: { downloadWorkdirStageRunId: workdirStageId } } : {}) });
      const startedJob = requireJob(input.repository, jobId);
      updateJob(input.repository, startedJob, stage.jobCompletionPolicy === 'preserve' ? startedJob.status : 'running',
        isBackgroundSourceDownload(stageRun) ? {} : { currentStage: stageId }, input.onJobChanged);
      input.telemetry?.stageStarted(
        startedJob,
        input.repository.getStageRun(stageRun.id) ?? stageRun,
        template.id
      );
      const result = await executor.run({
        stageRun: input.repository.listStageRuns(jobId).find(candidate => candidate.id === stageRun!.id)!,
        job: input.repository.getJob(jobId)!,
        inputArtifacts: resolved.artifacts,
        workdir,
        signal: controller.signal,
        processControl,
        reportProgress(progress) {
          if (!controller.signal.aborted && !processControl?.isPaused) updateStageRun({ id: stageRun!.id, status: 'running', progress });
        }
      });
      await processControl?.waitUntilResumed();
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
      const validationFindings = await validateCreatorStageOutputs({
        job: input.repository.getJob(jobId)!,
        stage,
        stageRun: input.repository.getStageRun(stageRun.id)!,
        inputArtifacts: resolved.artifacts,
        candidateOutputs: result.outputs
      });
      const blockingFinding = validationFindings.find(finding => finding.severity === 'blocking');
      if (blockingFinding !== undefined) {
        throw new CreatorOutputValidationError(blockingFinding);
      }
      const outputHashes = await Promise.all(result.outputs.map(async output => (
        output.path === null ? null : sha256CreatorFile(output.path, controller.signal)
      )));
      await processControl?.waitUntilResumed();
      if (controller.signal.aborted) throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
      input.repository.transaction(() => {
        const beforeOutputs = requireJob(input.repository, jobId);
        const createsResultVersion = stage.resultVersionPolicy !== 'none';
        const targetResultVersion = readPositiveInteger(stageRun!.progress.targetResultVersion);
        const resultVersion = stage.resultVersionPolicy === 'attach'
          ? inputResultVersion
          : createsResultVersion ? targetResultVersion ?? nextStageResultVersion(beforeOutputs, stageId)
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
            sourceArtifactIds: output.sourceArtifactIds ?? (
              job.templateId === 'video-translation' && stageId === 'subtitle'
                ? subtitleOutputSources(output.kind, insertedArtifacts, resolved.artifacts)
                : resolved.artifacts.map(artifact => artifact.id)
            ),
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
          ...(job.templateId === 'auto-clip' && stageId === 'analyze'
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
          : stage.resultVersionPolicy === 'attach'
            ? attachCreatorResultArtifacts(latest, resultVersion, insertedArtifacts)
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
          stage.jobCompletionPolicy === 'preserve'
            ? latest.status
            : unresolvedScopedFailure
            ? 'needs_input'
            : stage.jobCompletionPolicy === 'continue'
              ? 'running'
              : stage.completesJob === false
                ? 'draft'
                : 'completed',
          {
            ...(isBackgroundSourceDownload(stageRun!) ? {} : { currentStage: stageId }),
            ...snapshotPatch,
            ...attachDownloadedTranslationSource({ ...latest, state: { ...latest.state, ...snapshotPatch } }),
            ...(!unresolvedScopedFailure && stageRun!.scopeKey !== null
              ? { needsInput: null }
              : {})
          },
          input.onJobChanged
        );
        finishStageIssueResolution(jobId, stageRun!.id, 'succeeded');
        providerLedger.finishStage(stageRun!.id, 'succeeded');
      });
      const completed = input.repository.getStageRun(stageRun.id);
      if (completed !== undefined) {
        emitStageFinished(completed.id);
        try {
          input.onStageSucceeded?.(completed);
        } catch {
          // The completed stage is authoritative; workflow recovery can enqueue the next stage.
        }
      }
    } catch (error) {
      if (stageRun !== undefined) {
        const canceled = active.get(stageRun.id)?.signal.aborted === true;
        const downloadControl = input.repository.getStageRun(stageRun.id)?.progress.downloadControl;
        const paused = canceled && downloadControl === 'paused';
        const failureCode = paused ? 'creator_download_paused' : canceled ? 'creator_stage_canceled' : errorCode(error);
        const failureMessage = canceled
          ? paused ? 'Download was paused' : 'Creator stage was canceled'
          : publicErrorMessageFromFailure(error) ?? 'Creator stage failed';
        const configurationInput = creatorConfigurationInput(
          error,
          failureCode,
          failureMessage
        );
        const providerRequests = providerLedger.requestsForStage(stageRun.id);
        const unknownProviderAcceptance = providerRequests.some(request => (
          request.status === 'unknown_remote_acceptance'
        ));
        const providerFailure = error instanceof CreatorProviderRequestError
          || providerRequests.some(request => (
            request.stageRunId === stageRun!.id && request.status === 'failed'
            || request.status === 'unknown_remote_acceptance'
          ));
        input.repository.transaction(() => {
          updateStageRun({
            id: stageRun!.id,
            status: paused ? 'interrupted' : canceled ? 'canceled' : 'failed',
            errorCode: failureCode,
            errorMessage: failureMessage
          });
          const job = input.repository.getJob(jobId);
          if (job !== undefined) {
            const preserveJob = input.templates.get(job.templateId, job.templateVersion).stages
              .find(candidate => candidate.id === stageId)?.jobCompletionPolicy === 'preserve';
            const outputValidation = error instanceof CreatorOutputValidationError;
            const scopedFailure = stageRun!.scopeKey !== null && !canceled;
            updateJob(
              input.repository,
              job,
              preserveJob ? job.status : canceled
                ? downloadControlJobStatus(job, stageRun!.id, paused)
                : outputValidation || scopedFailure || configurationInput !== null
                  ? 'needs_input'
                  : 'failed',
              {
                currentStage: stageId,
                ...(!preserveJob && outputValidation
                  ? {
                      needsInput: {
                        code: failureCode,
                        message: failureMessage,
                        stageId
                      }
                    }
                  : !preserveJob && configurationInput !== null
                  ? { needsInput: configurationInput }
                  : !preserveJob && scopedFailure
                    ? {
                        needsInput: {
                          code: failureCode,
                          message: failureMessage,
                          stageId,
                          scopeKey: stageRun!.scopeKey
                        }
                      }
                    : {})
              },
              input.onJobChanged
            );
            if (!outputValidation && configurationInput === null) {
              providerLedger.finishStage(stageRun!.id, canceled ? 'canceled' : 'failed', error);
            }
            const resolution = finishStageIssueResolution(
              jobId,
              stageRun!.id,
              canceled ? 'canceled' : 'failed'
            );
            const existingProviderIssue = providerFailure
              ? input.issueService?.list(jobId).find(issue => (
                  issue.source === 'provider'
                  && issue.stageRunId === stageRun!.id
                  && issue.status !== 'resolved'
                ))
              : undefined;
            if (!canceled && resolution === undefined && existingProviderIssue === undefined) {
              input.issueService?.capture({
                jobId,
                code: failureCode,
                source: outputValidation
                  ? 'output-validator'
                  : providerFailure
                    ? 'provider'
                    : 'stage',
                category: outputValidation
                  ? 'output-validation'
                  : configurationInput !== null
                    ? 'configuration'
                  : providerFailure
                    ? 'provider'
                    : undefined,
                operation: 'creator.retry-stage',
                stageId,
                stageRunId: stageRun!.id,
                scopeKey: stageRun!.scopeKey ?? undefined,
                summaryKey: outputValidation
                  ? 'issue.translation_language_mismatch'
                  : undefined,
                fallbackMessage: outputValidation
                  ? failureMessage
                  : configurationInput !== null
                    ? 'Required service configuration is missing for this step. Check the relevant service settings.'
                  : unknownProviderAcceptance
                    ? 'It is unclear whether the external service accepted the request. Check its status or confirm before continuing.'
                    : error instanceof CreatorExecutorError
                      && error.publicFacts?.provider === 'yt-dlp'
                      ? failureMessage
                    : providerFailure
                      ? 'The external service request failed. Try again or ask the Agent.'
                      : 'The creator step failed. Try again or ask the Agent.',
                technicalDetail: failureMessage,
                publicFacts: configurationInput !== null
                  ? { ...stageFailureFacts(error, failureCode), kind: 'configuration' }
                  : stageFailureFacts(error, failureCode),
                retryable: !unknownProviderAcceptance,
                repairActions: [
                  ...(!unknownProviderAcceptance
                    ? [{
                        kind: 'retry-operation' as const,
                        operationId: 'creator.retry-stage',
                        requiresConfirmation: false,
                        risk: 'normal' as const
                      }]
                    : []),
                  { kind: 'focus-agent' }
                ]
              });
            }
          }
        });
        emitStageFinished(stageRun.id);
      }
      if (stageRun === undefined) throw error;
    } finally {
      if (stageRun !== undefined) active.delete(stageRun.id);
      if (stageRun !== undefined) processControls.delete(stageRun.id);
      release();
    }
    return input.repository.listStageRuns(jobId).find(candidate => candidate.id === stageRun!.id)!;
  }

  function emitStageFinished(stageRunId: string): void {
    if (input.telemetry === undefined) return;
    const stage = input.repository.getStageRun(stageRunId);
    const job = stage === undefined ? undefined : input.repository.getJob(stage.jobId);
    if (stage === undefined || job === undefined) return;
    const template = input.templates.get(job.templateId, job.templateVersion);
    const unknownRemoteAcceptance = providerLedger.requestsForStage(stageRunId)
      .some(request => request.status === 'unknown_remote_acceptance');
    const issue = (job.issues ?? []).find(candidate => (
      candidate.stageRunId === stageRunId && candidate.status !== 'resolved'
    ));
    input.telemetry.stageFinished(
      job,
      stage,
      template.id,
      creatorStageTelemetryOutcome(job, stage, unknownRemoteAcceptance),
      issue
    );
  }

  function updateStageRun(
    update: Parameters<CreatorRepository['updateStageRun']>[0]
  ): CreatorStageRun {
    const current = input.repository.getStageRun(update.id);
    const download = current?.stageId === 'download' && current.executor === 'download';
    input.repository.updateStageRun({
      ...update,
      ...(update.progress === undefined && !download
        ? {}
        : { progress: { ...(current?.progress ?? {}), ...update.progress,
          ...(download ? { downloadProgressSequence: (Number(current.progress.downloadProgressSequence) || 0) + 1 } : {}) } })
    });
    const stage = input.repository.getStageRun(update.id);
    if (stage === undefined) {
      throw new CreatorExecutorError('creator_stage_not_found', 'Creator stage run was not found');
    }
    input.onStageChanged?.(stage);
    return stage;
  }

  function finishStageIssueResolution(
    jobId: string,
    stageRunId: string,
    result: 'succeeded' | 'failed' | 'canceled'
  ) {
    const issue = input.issueService?.list(jobId).find(candidate => (
      candidate.status === 'resolving' && candidate.stageRunId === stageRunId
      && !(result === 'succeeded' && candidate.source === 'provider'
        && ['creator_provider_request_failed', 'creator_provider_resolution_required'].includes(candidate.code)
        && candidate.publicFacts?.provider?.startsWith('opencreator-gateway-'))
      && input.repository.getIssueResolutionAttemptId(jobId, candidate.id) === stageRunId
    ));
    if (issue === undefined) return undefined;
    return input.issueService?.finishResolution({
      jobId,
      issueId: issue.id,
      resolutionAttemptId: stageRunId,
      result
    });
  }

  return {
    run,
    runStageRun,
    pauseDownload(stageRunId: string): CreatorStageRun | undefined {
      const stage = input.repository.getStageRun(stageRunId);
      const control = processControls.get(stageRunId);
      if (!control || stage?.status !== 'running' || stage.progress.cancelRequested === true) {
        return cancelStage(stageRunId, { downloadControl: 'paused' });
      }
      control.pause();
      return updateStageRun({ id: stageRunId, status: 'running',
        progress: { downloadControl: 'paused', cancelRequested: false, bytesPerSecond: null } });
    },
    resumeDownload(stageRunId: string): CreatorStageRun | undefined {
      const stage = input.repository.getStageRun(stageRunId);
      const control = processControls.get(stageRunId);
      if (!control || stage?.status !== 'running' || stage.progress.cancelRequested === true) return undefined;
      control.resume();
      return updateStageRun({ id: stageRunId, status: 'running',
        progress: { downloadControl: null, cancelRequested: false, bytesPerSecond: null } });
    },
    cancelJob(jobId: string): CreatorStageRun[] {
      return input.repository.listStageRuns(jobId)
        .filter(stage => stage.status === 'queued' || stage.status === 'running')
        .map(stage => cancelStage(stage.id))
        .filter((stage): stage is CreatorStageRun => stage !== undefined);
    },
    cancel(stageRunId: string, options?: { downloadControl: 'paused' | 'canceled' }): CreatorStageRun | undefined {
      return cancelStage(stageRunId, options);
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

  function cancelStage(stageRunId: string, options?: { downloadControl: 'paused' | 'canceled' }): CreatorStageRun | undefined {
      const stage = input.repository.getStageRun(stageRunId);
      if (stage === undefined) return undefined;
      if (options && (input.repository.getJob(stage.jobId)?.templateId !== 'video-download' || stage.stageId !== 'download')) {
        throw new CreatorExecutorError('creator_action_invalid', 'Download controls require a download stage');
      }
      if (options?.downloadControl === 'canceled' && ['canceled', 'interrupted'].includes(stage.status)) {
        const canceled = updateStageRun({ id: stage.id, status: 'canceled', progress: { downloadControl: 'canceled', cancelRequested: false },
          errorCode: 'creator_stage_canceled', errorMessage: 'Download was canceled' });
        const job = input.repository.getJob(stage.jobId);
        if (job) updateJob(input.repository, job, downloadControlJobStatus(job, stage.id, false), {}, input.onJobChanged);
        return canceled;
      }
      if (['succeeded', 'failed', 'canceled', 'interrupted'].includes(stage.status)) {
        return stage;
      }
      const controller = active.get(stageRunId);
      if (controller !== undefined) {
        const canceling = updateStageRun({
          id: stageRunId,
          status: stage.status,
          progress: { cancelRequested: true, downloadControl: null, ...(options ?? {}) }
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
          status: options?.downloadControl === 'paused' ? 'interrupted' : 'canceled',
          progress: { cancelRequested: true, ...(options ?? {}) },
          errorCode: options?.downloadControl === 'paused' ? 'creator_download_paused' : 'creator_stage_canceled',
          errorMessage: options?.downloadControl === 'paused' ? 'Download was paused' : 'Creator stage was canceled'
        });
        const job = input.repository.getJob(current.jobId);
        if (job !== undefined) {
          const preserveJob = input.templates.get(job.templateId, job.templateVersion).stages
            .find(candidate => candidate.id === current.stageId)?.jobCompletionPolicy === 'preserve';
          updateJob(
            input.repository,
            job,
            preserveJob ? job.status : downloadControlJobStatus(job, current.id, options?.downloadControl === 'paused'),
            { currentStage: current.stageId },
            input.onJobChanged
          );
        }
      });
      if (canceled !== undefined) emitStageFinished(canceled.id);
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

function downloadControlJobStatus(job: CreatorJob, stageRunId: string, paused: boolean): CreatorJob['status'] {
  if (job.templateId === 'video-download' && job.stages.some(stage => stage.id !== stageRunId
    && (stage.status === 'queued' || stage.status === 'running'))) return 'running';
  return paused ? 'needs_input' : 'canceled';
}

function subtitleOutputSources(kind: string, outputs: CreatorArtifact[], inputs: CreatorArtifact[]): string[] {
  if (kind === 'source_video') return inputs.filter(artifact => artifact.kind === 'source_video').map(artifact => artifact.id);
  const imported = inputs.find(artifact => artifact.kind === kind);
  if (imported !== undefined) return [imported.id];
  const sourceKinds = kind === 'source_subtitle' ? ['source_video']
    : kind === 'target_subtitle' ? ['source_subtitle']
    : ['source_subtitle', 'target_subtitle'];
  return outputs.filter(artifact => sourceKinds.includes(artifact.kind)).map(artifact => artifact.id);
}

export function resolveCreatorStageInputs(
  job: CreatorJob,
  requirements: CreatorTemplateStage['inputArtifacts'],
  explicitArtifactRefs?: Record<string, string[]>,
  snapshotState?: Record<string, CreatorJson>
): { artifacts: CreatorArtifact[]; missing: string[] } {
  const artifacts: CreatorArtifact[] = [];
  const missing: string[] = [];
  for (const requirement of requirements) {
    if (!creatorInputArtifactEnabled(job, requirement.kind)) continue;
    const importedSubtitle = requirement.stateKey === 'importedSourceSubtitleId'
      || requirement.stateKey === 'importedTargetSubtitleId';
    if (explicitArtifactRefs !== undefined && !importedSubtitle) {
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
      ? (importedSubtitle ? snapshotState ?? job.state : job.state)[requirement.stateKey]
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
  if (job.state.sourceType === 'subtitle' && (kind === 'source_video' || kind === 'target_subtitle')) return false;
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
  return error instanceof CreatorExecutorError
    || error instanceof CreatorProviderRequestError
    || error instanceof CreatorOutputValidationError
    ? error.code
    : publicErrorCodeFromFailure(error) ?? 'creator_stage_failed';
}

function resultSnapshotDescription(stageId: string, templateId: string): string {
  if (templateId === 'wechat-article') {
    if (stageId === 'sources') return 'Parsed inspiration sources';
    if (stageId === 'topics') return 'Generated topic candidates';
    if (stageId === 'outline') return 'Generated article outline';
    if (stageId === 'article') return 'Wrote WeChat article';
    if (stageId === 'images') return 'Generated article images';
  }
  if (templateId === 'auto-clip') {
    if (stageId === 'analyze') return 'Identified video highlights';
    if (stageId === 'render') return 'Exported video clips';
  }
  if (stageId === 'subtitle') return 'Generated subtitles';
  if (stageId === 'tts') return 'Generated dubbing';
  if (stageId === 'render-horizontal') return 'Rendered horizontal video';
  if (stageId === 'render-vertical') return 'Rendered vertical video';
  if (stageId === 'generate') {
    if (templateId === 'cover') return 'Generated thumbnail';
    if (templateId === 'video-generation') return 'Generated video';
    if (templateId === 'xiaohongshu-post') return 'Generated Xiaohongshu post';
    if (templateId === 'short-video-script') return 'Generated short video script';
    return 'Generated image';
  }
  return `Completed ${stageId}`;
}

function nextStageResultVersion(job: CreatorJob, stageId: string): number {
  if (job.templateId !== 'auto-clip' || stageId !== 'analyze') {
    return nextCreatorResultVersion(job);
  }
  const snapshotVersion = readCreatorResultSnapshots(job.state.resultSnapshots)
    .reduce((highest, snapshot) => Math.max(highest, snapshot.version), 0);
  const stateVersion = readPositiveInteger(job.state.latestResultVersion) ?? 0;
  return Math.max(snapshotVersion, stateVersion) + 1;
}

function creatorConfigurationInput(
  error: unknown,
  code: string,
  message: string
): Record<string, CreatorJson> | null {
  const presetService = error instanceof CreatorExecutorError
    && error.code === 'creator_preset_requirement_missing'
    && (
      error.details.service === 'tts'
      || error.details.service === 'image'
      || error.details.service === 'video'
    )
    ? error.details.service
    : undefined;
  const section = code === 'creator_llm_config_missing'
    ? 'llm'
    : ['creator_transcription_config_missing', 'creator_transcription_language_unsupported', 'creator_transcription_timestamps_unavailable'].includes(code)
      ? 'transcription'
      : code === 'creator_tts_config_missing'
        ? 'tts'
      : code === 'creator_image_config_missing'
          ? 'image'
        : code === 'creator_video_config_missing'
          ? 'video'
        : presetService ?? null;
  return section === null ? null : {
    code,
    message,
    deepLink: `#/settings?tab=ai-services&section=${section === 'llm' ? 'text' : section}`
  };
}

function stageFailureFacts(error: unknown, code: string) {
  const facts = publicFactsFromFailure(error);
  const codeKind = publicErrorKindForCode(code);
  const message = publicErrorMessageFromFailure(error);
  return {
    ...facts,
    ...(facts.kind === 'unknown' && codeKind !== undefined ? { kind: codeKind } : {}),
    ...(facts.upstreamMessage === undefined && message !== undefined ? { upstreamMessage: message } : {})
  };
}
