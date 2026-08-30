import { createHash } from 'node:crypto';
import type {
  CreatorActionResponse,
  CreatorActor,
  CreatorCommandReceipt,
  CreatorCommandRequest,
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
        const actionResponse = input.service.applyAction(jobId, {
          actor,
          action: request.action,
          expectedRevision: request.expectedRevision,
          input: request.input
        });
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
          stageRunId = input.repository.createStageRun({
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
              ...resultVersionProgress(request.input)
            }
          }).id;
        }
        const receipt = input.receipts.createReceipt({
          jobId,
          actor,
          command: request.action,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          expectedRevision: request.expectedRevision,
          committedRevision: actionResponse.job.revision,
          status: 'committed',
          result: serializeResult(actionResponse),
          errorCode: null,
          errorMessage: null,
          stageRunId
        });
        return { ...actionResponse, commandReceipt: receipt };
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
