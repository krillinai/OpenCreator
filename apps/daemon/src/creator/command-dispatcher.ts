import { createHash } from 'node:crypto';
import type {
  CreatorActionResponse,
  CreatorActor,
  CreatorCommandReceipt,
  CreatorCommandRequest,
  CreatorJob,
  CreatorJson
} from '@opencreator/protocol';
import type { CreatorAgentRepository } from './agent/repository.js';
import type { CreatorRepository } from './repository.js';
import {
  CreatorServiceError,
  type CreatorService
} from './service.js';

export type CreatorCommandDispatchResult = CreatorActionResponse & {
  commandReceipt: CreatorCommandReceipt;
};

export type CreatorCommandDispatcher = ReturnType<typeof createCreatorCommandDispatcher>;

export class CreatorCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly latestRevision?: number
  ) {
    super(message);
    this.name = 'CreatorCommandError';
  }
}

export function createCreatorCommandDispatcher(input: {
  service: CreatorService;
  repository: CreatorRepository;
  receipts: CreatorAgentRepository;
  onQueuedStage?(): void;
  onCommitted?(result: CreatorCommandDispatchResult): void;
}) {
  function dispatch(
    jobId: string,
    request: CreatorCommandRequest,
    actor: CreatorActor
  ): CreatorCommandDispatchResult {
    const normalized = {
      action: request.action,
      expectedRevision: request.expectedRevision,
      actor,
      input: normalizeJson(request.input)
    };
    const requestHash = createHash('sha256')
      .update(stableStringify(normalized))
      .digest('hex');
    const existing = input.receipts.getReceiptByKey(jobId, request.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestHash !== requestHash) {
        throw new CreatorCommandError(
          'creator_idempotency_key_reused',
          'Creator idempotency key was already used with a different request'
        );
      }
      if (existing.status === 'rejected' || existing.status === 'failed') {
        throw new CreatorCommandError(
          existing.errorCode ?? 'creator_command_failed',
          existing.errorMessage ?? 'Creator command failed'
        );
      }
      const replayed = input.receipts.updateReceipt({
        id: existing.id,
        status: 'replayed'
      });
      return restoreResult(replayed);
    }

    try {
      const result = input.repository.transaction(() => {
        const current = input.service.getJob(jobId);
        const expectedRevision = canRebaseVideoDownloadQueue(current, request)
          ? current!.revision
          : request.expectedRevision;
        const actionResponse = input.service.applyAction(jobId, {
          actor,
          action: request.action,
          expectedRevision,
          input: request.input
        });
        let response = actionResponse;
        let stageRunId: string | null = null;
        if (request.action === 'run-stage') {
          const stageId = readStageId(request.input.stageId);
          const template = input.service.templates.get(
            actionResponse.job.templateId,
            actionResponse.job.templateVersion
          );
          const stage = template.stages.find(candidate => candidate.id === stageId);
          if (stage === undefined) {
            throw new CreatorCommandError(
              'creator_stage_not_found',
              'Creator stage was not found'
            );
          }
          const stageRun = input.repository.createStageRun({
            jobId,
            stageId,
            executor: stage.executor,
            status: 'queued',
            dispatchStatus: 'queued',
            idempotencyKey: `${request.idempotencyKey}:stage`,
            progress: {
              commandIdempotencyKey: request.idempotencyKey,
              ...(request.input.workflow === true ? { workflow: true } : {}),
              ...(typeof request.input.workflowParentStageRunId === 'string'
                ? { workflowParentStageRunId: request.input.workflowParentStageRunId }
                : {}),
              ...(typeof request.input.resumedFromStageRunId === 'string'
                ? { resumedFromStageRunId: request.input.resumedFromStageRunId }
                : {}),
              ...stageRequestProgress(actionResponse.job, stageId, request.input),
              ...resultVersionProgress(request.input)
            }
          });
          stageRunId = stageRun.id;
          response = {
            ...actionResponse,
            job: input.repository.getJob(jobId) ?? actionResponse.job
          };
        }
        const receipt = input.receipts.createReceipt({
          jobId,
          actor,
          command: request.action,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          expectedRevision: request.expectedRevision,
          committedRevision: response.job.revision,
          status: 'committed',
          result: serializeResult(response),
          errorCode: null,
          errorMessage: null,
          stageRunId
        });
        return { ...response, commandReceipt: receipt };
      });
      if (result.commandReceipt.stageRunId !== null) {
        try {
          input.onQueuedStage?.();
        } catch {
          // The persisted queue is authoritative; polling will recover a missed wake-up.
        }
      }
      try {
        input.onCommitted?.(result);
      } catch {
        // The database commit is authoritative; clients can recover through replay.
      }
      return result;
    } catch (error) {
      const normalizedError = normalizeError(error);
      if (input.receipts.getReceiptByKey(jobId, request.idempotencyKey) === undefined) {
        input.receipts.createReceipt({
          jobId,
          actor,
          command: request.action,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          expectedRevision: request.expectedRevision,
          committedRevision: null,
          status: 'rejected',
          result: null,
          errorCode: normalizedError.code,
          errorMessage: normalizedError.message,
          stageRunId: null
        });
      }
      throw normalizedError;
    }
  }

  return { dispatch };
}

function serializeResult(result: CreatorActionResponse): Record<string, CreatorJson> {
  return JSON.parse(JSON.stringify({ response: result })) as Record<string, CreatorJson>;
}

function restoreResult(receipt: CreatorCommandReceipt): CreatorCommandDispatchResult {
  const response = receipt.result?.response;
  if (response === null || Array.isArray(response) || typeof response !== 'object') {
    throw new CreatorCommandError(
      'creator_receipt_corrupt',
      'Creator command receipt does not contain a valid response'
    );
  }
  const parsed = response as unknown as CreatorActionResponse;
  return { ...parsed, commandReceipt: receipt };
}

function normalizeError(error: unknown): CreatorCommandError {
  if (error instanceof CreatorCommandError) return error;
  if (error instanceof CreatorServiceError) {
    return new CreatorCommandError(error.code, error.message, error.latestRevision);
  }
  if (error instanceof Error) {
    return new CreatorCommandError('creator_command_failed', error.message);
  }
  return new CreatorCommandError('creator_command_failed', 'Creator command failed');
}

function readStageId(value: CreatorJson | undefined): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CreatorCommandError(
      'creator_action_invalid',
      'stageId must be a non-empty string'
    );
  }
  return value;
}

function resultVersionProgress(
  input: Record<string, CreatorJson>
): Record<string, CreatorJson> {
  const progress: Record<string, CreatorJson> = {};
  for (const field of ['baseResultVersion', 'inputResultVersion', 'targetResultVersion'] as const) {
    const value = input[field];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      progress[field] = value;
    }
  }
  return progress;
}

function stageRequestProgress(
  job: CreatorJob,
  stageId: string,
  input: Record<string, CreatorJson>
): Record<string, CreatorJson> {
  if (
    job.templateId !== 'video-download'
    || job.templateVersion < 2
    || stageId !== 'download'
  ) {
    return {};
  }
  const optionId = readOptionalString(input.optionId)
    ?? readOptionalString(job.state.selectedOptionId);
  const requestedMediaType = readOptionalString(input.mediaType)
    ?? readOptionalString(job.state.mediaType);
  const sourceUrl = readOptionalString(job.state.sourceUrl);
  const submittedSourceUrl = readOptionalString(input.sourceUrl);
  if (optionId === undefined || sourceUrl === undefined) {
    throw new CreatorCommandError(
      'creator_action_invalid',
      'A probed download option is required'
    );
  }
  if (
    submittedSourceUrl !== undefined
    && submittedSourceUrl.trim() !== sourceUrl.trim()
  ) {
    throw new CreatorCommandError(
      'creator_revision_conflict',
      'The video URL changed before the download could be queued',
      job.revision
    );
  }
  const probeArtifact = [...job.artifacts].reverse().find(artifact => (
    artifact.kind === 'download_probe'
    && artifact.status === 'completed'
    && readOptionalString(artifact.metadata.requestedUrl)?.trim() === sourceUrl.trim()
  ));
  const options = Array.isArray(probeArtifact?.metadata.options)
    ? probeArtifact.metadata.options
    : [];
  const selectedOption = options.find(candidate => (
    isJsonRecord(candidate)
    && candidate.id === optionId
    && (candidate.mediaType === 'video' || candidate.mediaType === 'audio')
  ));
  const selectedMediaType = isJsonRecord(selectedOption)
    && (selectedOption.mediaType === 'video' || selectedOption.mediaType === 'audio')
    ? selectedOption.mediaType
    : undefined;
  if (
    probeArtifact === undefined
    || selectedMediaType === undefined
    || (
      requestedMediaType !== undefined
      && selectedMediaType !== requestedMediaType
    )
  ) {
    throw new CreatorCommandError(
      'creator_action_invalid',
      'The selected download option is not available in the latest analysis'
    );
  }
  const sameSource = (value: CreatorJson | undefined) => (
    readOptionalString(value)?.trim() === sourceUrl.trim()
  );
  const alreadyQueued = job.stages.some(stage => (
    stage.stageId === 'download'
    && (stage.status === 'queued' || stage.status === 'running')
    && stage.progress.optionId === optionId
    && sameSource(stage.progress.sourceUrl)
  ));
  if (alreadyQueued) {
    throw new CreatorCommandError(
      'creator_action_invalid',
      'This download option is already queued or running'
    );
  }
  const alreadyDownloaded = job.artifacts.some(artifact => (
    artifact.status === 'completed'
    && (artifact.kind === 'source_video' || artifact.kind === 'source_audio')
    && artifact.metadata.optionId === optionId
    && (
      sameSource(artifact.metadata.requestedUrl)
      || sameSource(artifact.metadata.sourceUrl)
      || artifact.sourceArtifactIds.includes(probeArtifact.id)
    )
  ));
  if (alreadyDownloaded) {
    throw new CreatorCommandError(
      'creator_action_invalid',
      'This download option has already been downloaded'
    );
  }
  return {
    optionId,
    mediaType: selectedMediaType,
    sourceUrl,
    probeArtifactId: probeArtifact.id
  };
}

function canRebaseVideoDownloadQueue(
  job: CreatorJob | undefined,
  request: CreatorCommandRequest
): boolean {
  return job?.templateId === 'video-download'
    && job.templateVersion >= 2
    && request.action === 'run-stage'
    && request.input.stageId === 'download'
    && readOptionalString(request.input.optionId) !== undefined
    && readOptionalString(request.input.sourceUrl)?.trim()
      === readOptionalString(job.state.sourceUrl)?.trim();
}

function readOptionalString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isJsonRecord(value: CreatorJson | undefined): value is Record<string, CreatorJson> {
  return value !== null
    && value !== undefined
    && typeof value === 'object'
    && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}

function normalizeJson(value: Record<string, CreatorJson>): Record<string, CreatorJson> {
  return sortValue(value) as Record<string, CreatorJson>;
}
