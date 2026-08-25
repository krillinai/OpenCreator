import type {
  CreateCreatorJobRequest,
  CreatorActionReceipt,
  CreatorActionRequest,
  CreatorActionResponse,
  CreatorActor,
  CreatorArtifact,
  CreatorJob,
  CreatorJobStatus,
  CreatorJson
} from '@opencreator/protocol';
import type { CreatorRepository } from './repository.js';
import {
  appendCreatorResultSnapshot,
  nextCreatorResultVersion
} from './result-snapshots.js';
import type { CreatorTemplateRegistry } from './templates/types.js';

export type CreatorService = ReturnType<typeof createCreatorService>;

export class CreatorServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly latestRevision?: number
  ) {
    super(message);
    this.name = 'CreatorServiceError';
  }
}

export function createCreatorService(input: {
  repository: CreatorRepository;
  templates: CreatorTemplateRegistry;
}) {
  const { repository, templates } = input;

  const getJob = (id: string): CreatorJob | undefined => repository.getJob(id);

  return {
    templates,
    createJob(request: CreateCreatorJobRequest): CreatorJob {
      const template = templates.get(request.templateId, request.templateVersion);
      const state = template.inputSchema.parse(request.state ?? {}) as Record<string, CreatorJson>;
      return repository.transaction(() => {
        const job = repository.createJob({
          projectId: request.projectId,
          templateId: template.id,
          templateVersion: template.version,
          status: 'draft',
          state
        });
        repository.insertActivity({
          jobId: job.id,
          revision: 0,
          actor: 'user',
          action: 'create-job',
          summary: '创建创作任务',
          details: { templateId: template.id, templateVersion: template.version }
        });
        return repository.getJob(job.id)!;
      });
    },
    getJob,
    listJobs(projectId?: string): CreatorJob[] {
      return repository.listJobs(projectId);
    },
    bindAgentThread(jobId: string, threadId: string): CreatorJob {
      return repository.transaction(() => {
        const current = repository.getJob(jobId);
        if (current === undefined) throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
        repository.updateJob({
          id: jobId,
          status: current.status,
          revision: current.revision,
          state: current.state,
          agentThreadId: threadId
        });
        return repository.getJob(jobId)!;
      });
    },
    setNeedsInput(jobId: string, input: { code: string; message: string; deepLink?: string }): CreatorJob {
      return repository.transaction(() => {
        const current = repository.getJob(jobId);
        if (current === undefined) throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
        const revision = current.revision + 1;
        repository.updateJob({
          id: jobId,
          status: 'needs_input',
          revision,
          state: {
            ...current.state,
            needsInput: {
              code: input.code,
              message: input.message,
              ...(input.deepLink === undefined ? {} : { deepLink: input.deepLink })
            }
          }
        });
        repository.insertActivity({
          jobId,
          revision,
          actor: 'system',
          action: 'needs-input',
          summary: input.message,
          details: { code: input.code, deepLink: input.deepLink ?? '' }
        });
        return repository.getJob(jobId)!;
      });
    },
    applyAction(jobId: string, request: CreatorActionRequest): CreatorActionResponse {
      return repository.transaction(() => {
        const current = repository.getJob(jobId);
        if (current === undefined) {
          throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
        }
        if (current.revision !== request.expectedRevision) {
          throw new CreatorServiceError(
            'creator_revision_conflict',
            'Creator job revision changed',
            current.revision
          );
        }
        const template = templates.get(current.templateId, current.templateVersion);
        const action = template.actions.find(candidate => candidate.id === request.action);
        if (action === undefined) {
          throw new CreatorServiceError('creator_action_not_allowed', 'Creator action is not allowed');
        }
        const parsedInput = action.inputSchema.parse(request.input) as Record<string, CreatorJson>;
        const actor = request.actor ?? 'user';
        const newRevision = current.revision + 1;
        let nextState = { ...current.state };
        let nextStatus: CreatorJobStatus = current.status;
        const affectedArtifactIds: string[] = [];

        if (request.action === 'update-settings' || request.action === 'undo-action') {
          const patch = readNonEmptyRecord(parsedInput.patch, 'patch');
          nextState = { ...nextState, ...patch };
        } else if (request.action === 'edit-subtitle') {
          const artifactId = readString(parsedInput.artifactId, 'artifactId');
          const source = current.artifacts.find(artifact => artifact.id === artifactId);
          if (source === undefined || source.kind !== 'target_subtitle') {
            throw new CreatorServiceError(
              'creator_artifact_not_found',
              'Target subtitle artifact was not found'
            );
          }
          const invalidKinds = new Set(
            templates.resolveInvalidatedArtifactKinds(
              current.templateId,
              current.templateVersion,
              request.action
            )
          );
          const resultVersion = nextCreatorResultVersion(current);
          for (const artifact of dependentArtifacts(current.artifacts, artifactId)) {
            if (!invalidKinds.has(artifact.kind) || artifact.status === 'stale') continue;
            repository.setArtifactStatus(artifact.id, 'stale');
            affectedArtifactIds.push(artifact.id);
          }
          const nextSubtitle = repository.insertArtifact({
            jobId,
            kind: 'target_subtitle',
            status: 'completed',
            path: source.path,
            sourceArtifactIds: source.sourceArtifactIds,
            metadata: {
              ...source.metadata,
              cues: parsedInput.cues ?? [],
              editedFromArtifactId: source.id,
              resultVersion
            }
          });
          affectedArtifactIds.push(nextSubtitle.id);
          nextState = {
            ...nextState,
            subtitleArtifactId: nextSubtitle.id,
            ...appendCreatorResultSnapshot({
              job: current,
              version: resultVersion,
              changedArtifacts: [nextSubtitle],
              staleArtifactIds: affectedArtifactIds.filter(id => id !== nextSubtitle.id),
              action: request.action,
              description: '保存字幕修改'
            })
          };
        } else if (request.action === 'edit-script-segment') {
          const artifactId = readString(parsedInput.artifactId, 'artifactId');
          const source = current.artifacts.find(artifact => artifact.id === artifactId);
          if (source === undefined || source.kind !== 'script_segment') {
            throw new CreatorServiceError('creator_artifact_not_found', 'Script segment artifact was not found');
          }
          const invalidKinds = new Set(
            templates.resolveInvalidatedArtifactKinds(
              current.templateId,
              current.templateVersion,
              request.action
            )
          );
          const resultVersion = nextCreatorResultVersion(current);
          for (const artifact of dependentArtifacts(current.artifacts, artifactId)) {
            if (!invalidKinds.has(artifact.kind) || artifact.status === 'stale') continue;
            repository.setArtifactStatus(artifact.id, 'stale');
            affectedArtifactIds.push(artifact.id);
          }
          const nextSegment = repository.insertArtifact({
            jobId,
            kind: 'script_segment',
            status: 'completed',
            path: source.path,
            sourceArtifactIds: source.sourceArtifactIds,
            metadata: {
              ...source.metadata,
              narration: readString(parsedInput.narration, 'narration'),
              ...(typeof parsedInput.visualPrompt === 'string'
                ? { visualPrompt: parsedInput.visualPrompt }
                : {}),
              editedFromArtifactId: source.id,
              resultVersion
            }
          });
          affectedArtifactIds.push(nextSegment.id);
          nextState = {
            ...nextState,
            ...appendCreatorResultSnapshot({
              job: current,
              version: resultVersion,
              changedArtifacts: [nextSegment],
              staleArtifactIds: affectedArtifactIds.filter(id => id !== nextSegment.id),
              action: request.action,
              description: '保存脚本修改'
            })
          };
        } else if (request.action === 'run-stage') {
          const stageId = readString(parsedInput.stageId, 'stageId');
          if (!template.stages.some(stage => stage.id === stageId)) {
            throw new CreatorServiceError('creator_stage_not_found', 'Creator stage was not found');
          }
          nextState = { ...nextState, currentStage: stageId };
          delete nextState.needsInput;
          nextStatus = 'running';
        }

        repository.updateJob({
          id: jobId,
          status: nextStatus,
          revision: newRevision,
          state: template.inputSchema.parse(nextState) as Record<string, CreatorJson>
        });
        const summary = summarizeAction(request.action, parsedInput);
        writeActivity({
          repository,
          current,
          actor,
          action: request.action,
          input: parsedInput,
          revision: newRevision,
          summary,
          affectedArtifactIds
        });
        const job = repository.getJob(jobId)!;
        const receipt: CreatorActionReceipt = {
          actor,
          action: request.action,
          summary,
          affectedArtifacts: affectedArtifactIds,
          newRevision,
          createdAt: job.updatedAt
        };
        return { job, receipt };
      });
    }
  };
}

function writeActivity(input: {
  repository: CreatorRepository;
  current: CreatorJob;
  actor: CreatorActor;
  action: string;
  input: Record<string, CreatorJson>;
  revision: number;
  summary: string;
  affectedArtifactIds: string[];
}): void {
  const activityMode = input.input.activityMode;
  const objectId = input.input.objectId;
  const details: Record<string, CreatorJson> = {
    objectId: typeof objectId === 'string' ? objectId : '',
    affectedArtifactIds: input.affectedArtifactIds
  };
  if (activityMode === 'draft') {
    const previous = [...input.current.activities].reverse().find(activity => (
      activity.actor === input.actor
      && activity.action === `${input.action}:draft`
      && activity.details.objectId === details.objectId
    ));
    if (previous !== undefined) {
      input.repository.updateActivity({
        id: previous.id,
        revision: input.revision,
        summary: input.summary,
        details
      });
      return;
    }
  }
  input.repository.insertActivity({
    jobId: input.current.id,
    revision: input.revision,
    actor: input.actor,
    action: activityMode === 'draft' ? `${input.action}:draft` : input.action,
    summary: input.summary,
    details
  });
}

function dependentArtifacts(artifacts: CreatorArtifact[], sourceId: string): CreatorArtifact[] {
  const result: CreatorArtifact[] = [];
  const queue = [sourceId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const artifact of artifacts) {
      if (!artifact.sourceArtifactIds.includes(current)) continue;
      result.push(artifact);
      queue.push(artifact.id);
    }
  }
  return result;
}

function summarizeAction(action: string, input: Record<string, CreatorJson>): string {
  if (action === 'edit-subtitle') return '更新字幕并保留下游旧版本';
  if (action === 'run-stage') return `启动阶段 ${String(input.stageId ?? '')}`.trim();
  if (action === 'undo-action') return '撤销上一次创作修改';
  return '更新创作设置';
}

function readNonEmptyRecord(value: CreatorJson | undefined, field: string): Record<string, CreatorJson> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new CreatorServiceError(
      'creator_action_input_invalid',
      `${field} must be a non-empty object`
    );
  }
  if (Object.keys(value).length === 0) {
    throw new CreatorServiceError(
      'creator_action_input_invalid',
      `${field} must be a non-empty object`
    );
  }
  return value;
}

function readString(value: CreatorJson | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CreatorServiceError('creator_action_invalid', `${field} must be a non-empty string`);
  }
  return value;
}
