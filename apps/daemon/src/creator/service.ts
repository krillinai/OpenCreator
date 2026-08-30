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
  creatorResultSnapshotForVersion,
  nextCreatorResultVersion
} from './result-snapshots.js';
import type { CreatorTemplateRegistry } from './templates/types.js';
import { videoTranslationArtifactRefsPatch } from './templates/video-translation-results.js';

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
        if (request.creationKey !== undefined) {
          const existing = repository.getJobByCreationKey(request.creationKey);
          if (existing !== undefined) {
            if (
              existing.projectId !== request.projectId
              || existing.templateId !== template.id
              || existing.templateVersion !== template.version
            ) {
              throw new CreatorServiceError(
                'creator_idempotency_key_reused',
                'Creator creation key was already used with a different request'
              );
            }
            return existing;
          }
        }
        const job = repository.createJob({
          ...(request.creationKey === undefined ? {} : { creationKey: request.creationKey }),
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
    registerSourceVideo(jobId: string, input: {
      expectedRevision: number;
      path: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
      lastModified: number | null;
      media: {
        duration: number;
        width?: number;
        height?: number;
        hasVideo: boolean;
        hasAudio: boolean;
      };
    }): { job: CreatorJob; artifact: CreatorArtifact; deduplicated: boolean } {
      return repository.transaction(() => {
        const current = repository.getJob(jobId);
        if (current === undefined) {
          throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
        }
        if (current.revision !== input.expectedRevision) {
          throw new CreatorServiceError(
            'creator_revision_conflict',
            'Creator job revision changed',
            current.revision
          );
        }
        if (current.templateId !== 'video-translation') {
          throw new CreatorServiceError(
            'creator_source_upload_unsupported',
            'Local source upload is only supported for video translation jobs'
          );
        }
        const duplicate = [...current.artifacts].reverse().find(artifact => (
          artifact.kind === 'source_video'
          && artifact.status === 'completed'
          && artifact.metadata.sha256 === input.sha256
        ));
        if (duplicate !== undefined) {
          return { job: current, artifact: duplicate, deduplicated: true };
        }

        const artifact = repository.insertArtifact({
          jobId,
          kind: 'source_video',
          status: 'completed',
          path: input.path,
          sourceArtifactIds: [],
          metadata: {
            fileName: input.fileName,
            mimeType: input.mimeType,
            size: input.size,
            sha256: input.sha256,
            lastModified: input.lastModified,
            duration: input.media.duration,
            width: input.media.width ?? null,
            height: input.media.height ?? null,
            hasVideo: input.media.hasVideo,
            hasAudio: input.media.hasAudio,
            source: 'local-upload'
          }
        });
        const revision = current.revision + 1;
        const template = templates.get(current.templateId, current.templateVersion);
        const nextState = {
          ...current.state,
          sourceType: 'file',
          sourceUrl: '',
          sourceArtifactId: artifact.id,
          sourceFileName: input.fileName,
          sourceFileSize: input.size,
          sourceFileLastModified: input.lastModified,
          sourceFileSha256: input.sha256,
          currentStage: null
        };
        repository.updateJob({
          id: jobId,
          status: 'draft',
          revision,
          state: template.inputSchema.parse(nextState) as Record<string, CreatorJson>
        });
        repository.insertActivity({
          jobId,
          revision,
          actor: 'user',
          action: 'register-source-video',
          summary: '上传本地视频',
          details: {
            objectId: input.fileName,
            affectedArtifactIds: [artifact.id]
          }
        });
        return {
          job: repository.getJob(jobId)!,
          artifact,
          deduplicated: false
        };
      });
    },
    registerReferenceImage(jobId: string, input: {
      expectedRevision: number;
      path: string;
      fileName: string;
      mimeType: string;
      size: number;
      sha256: string;
      lastModified: number | null;
      format: 'png' | 'jpeg' | 'webp';
    }): { job: CreatorJob; artifact: CreatorArtifact; deduplicated: boolean } {
      return repository.transaction(() => {
        const current = repository.getJob(jobId);
        if (current === undefined) {
          throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
        }
        if (current.revision !== input.expectedRevision) {
          throw new CreatorServiceError(
            'creator_revision_conflict',
            'Creator job revision changed',
            current.revision
          );
        }
        if (current.templateId !== 'cover' || current.templateVersion < 2) {
          throw new CreatorServiceError(
            'creator_reference_upload_unsupported',
            'Reference image upload is only supported for current cover jobs'
          );
        }
        const duplicate = [...current.artifacts].reverse().find(artifact => (
          artifact.kind === 'reference_image'
          && artifact.status === 'completed'
          && artifact.metadata.sha256 === input.sha256
        ));
        if (
          duplicate !== undefined
          && current.state.referenceImageArtifactId === duplicate.id
        ) {
          return { job: current, artifact: duplicate, deduplicated: true };
        }

        const artifact = duplicate ?? repository.insertArtifact({
          jobId,
          kind: 'reference_image',
          status: 'completed',
          path: input.path,
          sourceArtifactIds: [],
          metadata: {
            fileName: input.fileName,
            mimeType: input.mimeType,
            size: input.size,
            bytes: input.size,
            sha256: input.sha256,
            lastModified: input.lastModified,
            format: input.format,
            source: 'local-upload'
          }
        });
        const revision = current.revision + 1;
        const template = templates.get(current.templateId, current.templateVersion);
        repository.updateJob({
          id: jobId,
          status: current.status,
          revision,
          state: template.inputSchema.parse({
            ...current.state,
            referenceImageArtifactId: artifact.id,
            referenceImageFileName: input.fileName
          }) as Record<string, CreatorJson>
        });
        repository.insertActivity({
          jobId,
          revision,
          actor: 'user',
          action: 'register-reference-image',
          summary: duplicate === undefined ? '上传封面参考图' : '重新选择封面参考图',
          details: {
            objectId: input.fileName,
            affectedArtifactIds: [artifact.id]
          }
        });
        return {
          job: repository.getJob(jobId)!,
          artifact,
          deduplicated: duplicate !== undefined
        };
      });
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
    setNeedsInput(jobId: string, input: {
      code: string;
      message: string;
      deepLink?: string;
      resumeStageId?: string;
      workflow?: boolean;
    }): CreatorJob {
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
              ...(input.deepLink === undefined ? {} : { deepLink: input.deepLink }),
              ...(input.resumeStageId === undefined
                ? {}
                : { resumeStageId: input.resumeStageId }),
              ...(input.workflow === undefined ? {} : { workflow: input.workflow })
            }
          }
        });
        repository.insertActivity({
          jobId,
          revision,
          actor: 'system',
          action: 'needs-input',
          summary: input.message,
          details: {
            code: input.code,
            deepLink: input.deepLink ?? '',
            resumeStageId: input.resumeStageId ?? ''
          }
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
          if (current.templateId === 'video-translation' && nextState.sourceType === 'url') {
            nextState.sourceArtifactId = null;
          }
          if (shouldClearTtsConfigurationRequest(current, nextState)) {
            delete nextState.needsInput;
            if (current.status === 'needs_input') {
              nextStatus = current.stages.some(stage => stage.status === 'succeeded')
                ? 'completed'
                : 'draft';
            }
          }
        } else if (request.action === 'edit-subtitle') {
          const artifactId = readString(parsedInput.artifactId, 'artifactId');
          const baseResultVersion = readResultVersion(
            current,
            parsedInput.baseResultVersion,
            'baseResultVersion'
          );
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
              ...(baseResultVersion === undefined ? {} : { baseResultVersion }),
              changedArtifacts: [nextSubtitle],
              ...(current.templateId === 'video-translation'
                ? { artifactRefsPatch: videoTranslationArtifactRefsPatch(nextState) }
                : {}),
              staleArtifactIds: affectedArtifactIds.filter(id => id !== nextSubtitle.id),
              action: request.action,
              description: '保存字幕修改',
              state: nextState
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
        } else if (request.action === 'commit-version') {
          const baseResultVersion = readResultVersion(
            current,
            parsedInput.baseResultVersion,
            'baseResultVersion',
            true
          )!;
          const resultVersion = nextCreatorResultVersion(current);
          nextState = {
            ...nextState,
            ...appendCreatorResultSnapshot({
              job: current,
              version: resultVersion,
              baseResultVersion,
              changedArtifacts: [],
              artifactRefsPatch: videoTranslationArtifactRefsPatch(nextState),
              action: request.action,
              description: '保存版本设置',
              state: nextState
            })
          };
          nextStatus = 'completed';
        } else if (request.action === 'run-stage') {
          const stageId = readString(parsedInput.stageId, 'stageId');
          if (!template.stages.some(stage => stage.id === stageId)) {
            throw new CreatorServiceError('creator_stage_not_found', 'Creator stage was not found');
          }
          for (const field of ['baseResultVersion', 'inputResultVersion', 'targetResultVersion'] as const) {
            readResultVersion(current, parsedInput[field], field);
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
        const activityInput = activityInputFor(request.action, parsedInput);
        const summary = summarizeAction(request.action, activityInput);
        writeActivity({
          repository,
          current,
          actor,
          action: request.action,
          input: activityInput,
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

function shouldClearTtsConfigurationRequest(
  job: CreatorJob,
  nextState: Record<string, CreatorJson>
): boolean {
  if (job.templateId !== 'video-translation' || nextState.dubbing === true) return false;
  const needsInput = job.state.needsInput;
  return (
    needsInput !== null
    && typeof needsInput === 'object'
    && !Array.isArray(needsInput)
    && needsInput.code === 'creator_tts_config_missing'
  );
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
  if (input.action === 'run-stage' && typeof input.input.stageId === 'string') {
    details.stageId = input.input.stageId;
  }
  if (
    input.action === 'update-settings'
    && details.objectId === ''
  ) {
    return;
  }
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

const creatorUiOnlyStateFields = new Set([
  'currentStep',
  'furthestStep',
  'workspacePhase',
  'resultTab',
  'draftBaseVersion',
  'resultVersion',
  'resultVersions'
]);

function activityInputFor(
  action: string,
  input: Record<string, CreatorJson>
): Record<string, CreatorJson> {
  if (action !== 'update-settings') return input;
  const patch = input.patch;
  if (patch === null || Array.isArray(patch) || typeof patch !== 'object') return input;
  const visibleFields = Object.keys(patch).filter(field => !creatorUiOnlyStateFields.has(field));
  return {
    ...input,
    objectId: visibleFields.sort().join(',')
  };
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
  if (action === 'commit-version') return '保存项目版本设置';
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

function readResultVersion(
  job: CreatorJob,
  value: CreatorJson | undefined,
  field: string,
  required = false
): number | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw new CreatorServiceError(
        'creator_action_invalid',
        `${field} must be a positive integer`
      );
    }
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new CreatorServiceError(
      'creator_action_invalid',
      `${field} must be a positive integer`
    );
  }
  if (creatorResultSnapshotForVersion(job, value) === undefined) {
    throw new CreatorServiceError(
      'creator_result_version_not_found',
      `Creator result version ${value} was not found`
    );
  }
  return value;
}
