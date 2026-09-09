import type {
  CreateCreatorJobRequest,
  CreatorActionReceipt,
  CreatorActionRequest,
  CreatorActionResponse,
  CreatorActor,
  CreatorArtifact,
  CreatorJob,
  CreatorJobStatus,
  CreatorJson,
  CreatorPresetOrigin
} from '@opencreator/protocol';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { writeFileSync } from 'node:fs';
import { basename, extname, join, dirname } from 'node:path';
import type { CreatorRepository } from './repository.js';
import {
  appendCreatorResultSnapshot,
  creatorResultSnapshotForVersion,
  nextCreatorResultVersion
} from './result-snapshots.js';
import type { CreatorTemplateRegistry } from './templates/types.js';
import { videoTranslationArtifactRefsPatch } from './templates/video-translation-results.js';
import {
  createBlankCreationFingerprint,
  createPresetCreationFingerprint
} from './creation-fingerprint.js';
import { getCreatorPresetModuleDefinition } from './presets/module-schemas.js';
import { mergeCreatorPresetState } from './presets/requirements.js';
import type { CreatorPresetRegistry } from './presets/types.js';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';

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
  presets?: CreatorPresetRegistry;
  creatorServicesConfig?: Pick<CreatorServicesConfigStore, 'read'>;
}) {
  const { repository, templates } = input;

  const getJob = (id: string): CreatorJob | undefined => repository.getJob(id);

  type PresetCreateRequest = Extract<CreateCreatorJobRequest, { preset: unknown }>;
  type BlankCreateRequest = Omit<
    Extract<CreateCreatorJobRequest, { templateId: string }>,
    'creationKey'
  > & { creationKey?: string };

  function createJob(request: PresetCreateRequest): Promise<CreatorJob>;
  function createJob(request: BlankCreateRequest): CreatorJob;
  function createJob(request: CreateCreatorJobRequest): CreatorJob | Promise<CreatorJob>;
  function createJob(
    request: PresetCreateRequest | BlankCreateRequest
  ): CreatorJob | Promise<CreatorJob> {
    if ('preset' in request) return createPresetJob(request);
    const template = templates.get(request.templateId, request.templateVersion);
    const state = template.inputSchema.parse(request.state ?? {}) as Record<string, CreatorJson>;
    const fingerprint = request.creationKey === undefined
      ? null
      : createBlankCreationFingerprint({
          projectId: request.projectId,
          templateId: template.id,
          templateVersion: template.version,
          state
        });
    return persistCreatedJob({
      creationKey: request.creationKey,
      creationFingerprint: fingerprint,
      projectId: request.projectId,
      templateId: template.id,
      templateVersion: template.version,
      state,
      presetOrigin: null,
      activityDetails: {
        templateId: template.id,
        templateVersion: template.version
      }
    });
  }

  async function createPresetJob(request: PresetCreateRequest): Promise<CreatorJob> {
    if (input.presets === undefined) {
      throw new CreatorServiceError(
        'creator_preset_not_found',
        'Creator preset catalog is unavailable'
      );
    }
    let preset;
    try {
      preset = input.presets.get(request.preset);
    } catch {
      throw new CreatorServiceError(
        'creator_preset_not_found',
        'Creator preset was not found'
      );
    }
    const definition = getCreatorPresetModuleDefinition(preset.module);
    if (
      preset.runtimeTemplate.id !== definition.runtimeTemplate.id
      || preset.runtimeTemplate.version !== definition.runtimeTemplate.version
    ) {
      throw new CreatorServiceError(
        'creator_preset_incompatible',
        'Creator preset runtime binding is incompatible'
      );
    }
    const services = input.creatorServicesConfig === undefined
      ? createDefaultCreatorServicesConfig()
      : await input.creatorServicesConfig.read();
    let state: Record<string, CreatorJson>;
    let template;
    try {
      const merged = mergeCreatorPresetState({
        definition,
        defaults: preset.defaults,
        defaultsByLocale: preset.defaultsByLocale,
        locale: request.locale,
        requirement: preset.requirements,
        services
      });
      template = templates.get(
        preset.runtimeTemplate.id,
        preset.runtimeTemplate.version
      );
      state = template.inputSchema.parse(merged) as Record<string, CreatorJson>;
    } catch (error) {
      throw new CreatorServiceError(
        'creator_preset_invalid',
        error instanceof Error ? error.message : 'Creator preset state is invalid'
      );
    }
    const origin: CreatorPresetOrigin = {
      module: preset.module,
      id: preset.id,
      version: preset.version,
      locale: request.locale,
      title: preset.title[request.locale],
      contentHash: preset.contentHash
    };
    const fingerprint = createPresetCreationFingerprint({
      projectId: request.projectId,
      preset: {
        module: preset.module,
        id: preset.id,
        version: preset.version,
        contentHash: preset.contentHash
      },
      locale: request.locale,
      templateId: template.id,
      templateVersion: template.version,
      state
    });
    return persistCreatedJob({
      creationKey: request.creationKey,
      creationFingerprint: fingerprint,
      projectId: request.projectId,
      templateId: template.id,
      templateVersion: template.version,
      state,
      presetOrigin: origin,
      activityDetails: {
        templateId: template.id,
        templateVersion: template.version,
        presetModule: preset.module,
        presetId: preset.id,
        presetVersion: preset.version,
        presetLocale: request.locale,
        presetContentHash: preset.contentHash,
        ...(preset.requirements === undefined
          ? {}
          : {
              requirementService: preset.requirements.service,
              requirementProvider: preset.requirements.provider,
              ...(preset.requirements.model === undefined
                ? {}
                : { requirementModel: preset.requirements.model })
            })
      }
    });
  }

  function persistCreatedJob(input: {
    creationKey?: string;
    creationFingerprint: string | null;
    projectId: string;
    templateId: string;
    templateVersion: number;
    state: Record<string, CreatorJson>;
    presetOrigin: CreatorPresetOrigin | null;
    activityDetails: Record<string, CreatorJson>;
  }): CreatorJob {
    return repository.transaction(() => {
      if (input.creationKey !== undefined) {
        const existing = repository.getJobByCreationKey(input.creationKey);
        if (existing !== undefined) {
          const existingFingerprint = repository.getCreationFingerprint(existing.id);
          if (
            input.creationFingerprint === null
            || existingFingerprint !== input.creationFingerprint
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
        ...(input.creationKey === undefined ? {} : { creationKey: input.creationKey }),
        creationFingerprint: input.creationFingerprint,
        presetOrigin: input.presetOrigin,
        projectId: input.projectId,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        status: 'draft',
        state: input.state
      });
      repository.insertActivity({
        jobId: job.id,
        revision: 0,
        actor: 'user',
        action: 'create-job',
        summary: '创建创作任务',
        details: input.activityDetails
      });
      return repository.getJob(job.id)!;
    });
  }

  return {
    templates,
    createJob,
    getJob,
    listJobs(projectId?: string): CreatorJob[] {
      return repository.listJobs(projectId);
    },
    deleteJob(jobId: string): void {
      repository.transaction(() => {
        const current = repository.getJob(jobId);
        if (current === undefined) {
          throw new CreatorServiceError('creator_job_not_found', 'Creator job not found');
        }
        if (
          current.status === 'running'
          || current.stages.some(stage => stage.status === 'queued' || stage.status === 'running')
        ) {
          throw new CreatorServiceError(
            'creator_job_has_active_run',
            'Creator job has an active run'
          );
        }
        repository.deleteJob(jobId);
      });
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
    registerImportedSourceVideo(jobId: string, input: {
      expectedRevision: number;
      sourceJobId: string;
      sourceArtifactId: string;
      path: string;
      metadata: Record<string, CreatorJson>;
    }): {
      job: CreatorJob;
      artifact: CreatorArtifact;
      deduplicated: boolean;
    } {
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
        if (
          current.templateId !== 'video-translation'
          && current.templateId !== 'auto-clip'
        ) {
          throw new CreatorServiceError(
            'creator_artifact_import_unsupported',
            'Video artifacts can only be imported into video translation or auto clip jobs'
          );
        }
        const duplicate = [...current.artifacts].reverse().find(artifact => (
          artifact.kind === 'source_video'
          && artifact.status === 'completed'
          && artifact.metadata.importedFromArtifactId === input.sourceArtifactId
        ));
        if (
          duplicate !== undefined
          && current.state.sourceArtifactId === duplicate.id
        ) {
          return { job: current, artifact: duplicate, deduplicated: true };
        }

        const artifact = duplicate ?? repository.insertArtifact({
          jobId,
          kind: 'source_video',
          status: 'completed',
          path: input.path,
          sourceArtifactIds: [input.sourceArtifactId],
          metadata: {
            ...input.metadata,
            source: 'artifact-import',
            importedFromJobId: input.sourceJobId,
            importedFromArtifactId: input.sourceArtifactId
          }
        });
        const fileName = typeof artifact.metadata.fileName === 'string'
          ? artifact.metadata.fileName
          : 'OpenCreator-video.mp4';
        const size = typeof artifact.metadata.size === 'number'
          ? artifact.metadata.size
          : typeof artifact.metadata.bytes === 'number'
            ? artifact.metadata.bytes
            : null;
        const sha256 = typeof artifact.metadata.sha256 === 'string'
          ? artifact.metadata.sha256
          : null;
        const revision = current.revision + 1;
        const template = templates.get(current.templateId, current.templateVersion);
        repository.updateJob({
          id: jobId,
          status: 'draft',
          revision,
          state: template.inputSchema.parse({
            ...current.state,
            sourceType: 'file',
            sourceUrl: '',
            sourceArtifactId: artifact.id,
            sourceFileName: fileName,
            sourceFileSize: size,
            sourceFileLastModified: null,
            sourceFileSha256: sha256,
            currentStage: null
          }) as Record<string, CreatorJson>
        });
        repository.insertActivity({
          jobId,
          revision,
          actor: 'user',
          action: 'import-source-video',
          summary: '从项目文件导入视频',
          details: {
            objectId: fileName,
            sourceJobId: input.sourceJobId,
            sourceArtifactId: input.sourceArtifactId,
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
        const supportsReferenceImage = (
          current.templateVersion >= 2
          && (current.templateId === 'cover' || current.templateId === 'image-generation')
        ) || current.templateId === 'video-generation';
        if (!supportsReferenceImage) {
          throw new CreatorServiceError(
            'creator_reference_upload_unsupported',
            'Reference image upload is only supported for current cover, image generation, and video generation jobs'
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
        const referenceImageLabel = current.templateId === 'cover'
          ? '封面参考图'
          : current.templateId === 'video-generation'
            ? '视频生成参考图'
            : '图像生成参考图';
        repository.insertActivity({
          jobId,
          revision,
          actor: 'user',
          action: 'register-reference-image',
          summary: `${duplicate === undefined ? '上传' : '重新选择'}${referenceImageLabel}`,
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
          const preserveResultVersion = readOptionalBoolean(
            parsedInput.preserveResultVersion,
            'preserveResultVersion'
          ) ?? false;
          const baseResultVersion = readResultVersion(
            current,
            parsedInput.baseResultVersion,
            'baseResultVersion',
            preserveResultVersion
          );
          const source = current.artifacts.find(artifact => artifact.id === artifactId);
          if (
            source === undefined
            || (source.kind !== 'target_subtitle' && source.kind !== 'vertical_subtitle')
            || source.path === null
          ) {
            throw new CreatorServiceError(
              'creator_artifact_not_found',
              'Editable subtitle artifact was not found'
            );
          }
          const cues = readEditableSubtitleCues(parsedInput.cues);
          const invalidKinds = new Set(
            templates.resolveInvalidatedArtifactKinds(
              current.templateId,
              current.templateVersion,
              request.action
            )
          );
          const resultVersion = preserveResultVersion
            ? baseResultVersion!
            : nextCreatorResultVersion(current);
          const baseSnapshot = baseResultVersion === undefined
            ? undefined
            : creatorResultSnapshotForVersion(current, baseResultVersion);
          if (
            preserveResultVersion
            && !baseSnapshot?.artifactRefs[source.kind]?.includes(source.id)
          ) {
            throw new CreatorServiceError(
              'creator_artifact_not_found',
              'Editable subtitle artifact was not found in the selected result version'
            );
          }
          const baseBilingualArtifact = source.kind === 'target_subtitle'
            ? artifactFromSnapshot(
                current.artifacts,
                baseSnapshot?.artifactRefs.bilingual_subtitle,
                'bilingual_subtitle'
              )
            : undefined;
          const invalidationSourceIds = [
            source.id,
            ...(baseBilingualArtifact === undefined ? [] : [baseBilingualArtifact.id])
          ];
          const invalidatedIds = new Set<string>();
          for (const invalidationSourceId of invalidationSourceIds) {
            for (const artifact of dependentArtifacts(current.artifacts, invalidationSourceId)) {
              if (
                invalidatedIds.has(artifact.id)
                || !invalidKinds.has(artifact.kind)
                || artifact.status === 'stale'
              ) continue;
              repository.setArtifactStatus(artifact.id, 'stale');
              invalidatedIds.add(artifact.id);
              affectedArtifactIds.push(artifact.id);
            }
          }
          const nextSubtitlePath = writeEditedSubtitleFile(
            source.path,
            source.kind,
            resultVersion,
            cues
          );
          const nextSubtitle = repository.insertArtifact({
            jobId,
            kind: source.kind,
            status: 'completed',
            path: nextSubtitlePath,
            sourceArtifactIds: source.sourceArtifactIds,
            metadata: {
              ...source.metadata,
              fileName: basename(nextSubtitlePath),
              cues: subtitleMetadataCues(cues),
              editedFromArtifactId: source.id,
              resultVersion
            }
          });
          affectedArtifactIds.push(nextSubtitle.id);
          const changedArtifacts = [nextSubtitle];
          const artifactRefsPatch: Record<string, string[]> = preserveResultVersion
            ? {}
            : source.kind === 'vertical_subtitle'
              ? { vertical_video: [] }
              : videoTranslationArtifactRefsPatch(nextState, 'subtitle');
          if (source.kind === 'target_subtitle') {
            const baseSourceArtifact = artifactFromSnapshot(
              current.artifacts, baseSnapshot?.artifactRefs.source_subtitle, 'source_subtitle'
            );
            if (cues.every(cue => cue.sourceText !== undefined)) {
              const sourceCues = cues.map(cue => ({ ...cue, text: cue.sourceText! }));
              const sourcePath = writeEditedSubtitleFile(
                baseSourceArtifact?.path ?? source.path, 'source_subtitle', resultVersion, sourceCues
              );
              const sourceArtifact = repository.insertArtifact({
                jobId, kind: 'source_subtitle', status: 'completed', path: sourcePath,
                sourceArtifactIds: baseSourceArtifact?.sourceArtifactIds ?? source.sourceArtifactIds,
                metadata: {
                  ...(baseSourceArtifact?.metadata ?? {}),
                  fileName: basename(sourcePath), cues: subtitleMetadataCues(sourceCues),
                  editedFromArtifactId: baseSourceArtifact?.id ?? source.id, resultVersion
                }
              });
              changedArtifacts.push(sourceArtifact);
              affectedArtifactIds.push(sourceArtifact.id);
            }
            const bilingualCues = bilingualSubtitleCues(cues, nextState.subtitlePosition);
            if (bilingualCues !== undefined) {
              const bilingualPath = writeEditedSubtitleFile(
                baseBilingualArtifact?.path ?? source.path,
                'bilingual_subtitle',
                resultVersion,
                bilingualCues
              );
              const bilingualArtifact = repository.insertArtifact({
                jobId,
                kind: 'bilingual_subtitle',
                status: 'completed',
                path: bilingualPath,
                sourceArtifactIds: [nextSubtitle.id],
                metadata: {
                  ...(baseBilingualArtifact?.metadata ?? source.metadata),
                  fileName: basename(bilingualPath),
                  cues: bilingualCues,
                  editedFromArtifactId: baseBilingualArtifact?.id ?? source.id,
                  resultVersion
                }
              });
              changedArtifacts.push(bilingualArtifact);
              affectedArtifactIds.push(bilingualArtifact.id);
            } else {
              artifactRefsPatch.bilingual_subtitle = [];
            }
          }
          nextState = {
            ...nextState,
            ...(source.kind === 'target_subtitle'
              ? { subtitleArtifactId: nextSubtitle.id }
              : { verticalSubtitleArtifactId: nextSubtitle.id }),
            ...appendCreatorResultSnapshot({
              job: current,
              version: resultVersion,
              ...(
                baseResultVersion === undefined || preserveResultVersion
                  ? {}
                  : { baseResultVersion }
              ),
              changedArtifacts,
              artifactRefsPatch,
              staleArtifactIds: affectedArtifactIds.filter(id => (
                !changedArtifacts.some(artifact => artifact.id === id)
              )),
              action: request.action,
              description: source.kind === 'target_subtitle'
                ? '保存横屏字幕修改'
                : '保存竖屏字幕修改',
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

type EditableSubtitleCue = {
  id: string | number;
  start: string;
  end: string;
  text: string;
  sourceText?: string;
};

function readEditableSubtitleCues(value: CreatorJson | undefined): EditableSubtitleCue[] {
  if (!Array.isArray(value)) {
    throw new CreatorServiceError('creator_action_invalid', 'cues must be an array');
  }
  const cues = value.flatMap((item, index) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') {
      throw new CreatorServiceError('creator_action_invalid', `cues[${index}] must be an object`);
    }
    const cue = item as Record<string, CreatorJson>;
    if (
      (typeof cue.id !== 'string' && typeof cue.id !== 'number')
      || typeof cue.start !== 'string'
      || typeof cue.end !== 'string'
      || typeof cue.text !== 'string'
      || !validSrtTimestamp(cue.start)
      || !validSrtTimestamp(cue.end)
    ) {
      throw new CreatorServiceError('creator_action_invalid', `cues[${index}] is invalid`);
    }
    const text = cue.text.trim();
    if (!text) return [];
    return [{
      id: cue.id,
      start: normalizedSrtTimestamp(cue.start),
      end: normalizedSrtTimestamp(cue.end),
      text,
      ...(typeof cue.sourceText === 'string' && cue.sourceText.trim().length > 0
        ? { sourceText: cue.sourceText.trim() }
        : {})
    }];
  });
  if (cues.length === 0) {
    throw new CreatorServiceError('creator_action_invalid', 'At least one subtitle cue is required');
  }
  return cues;
}

function subtitleMetadataCues(cues: EditableSubtitleCue[]): Array<{
  id: string | number;
  start: string;
  end: string;
  text: string;
}> {
  return cues.map(cue => ({
    id: cue.id,
    start: cue.start,
    end: cue.end,
    text: cue.text
  }));
}

function bilingualSubtitleCues(
  cues: EditableSubtitleCue[],
  subtitlePosition: CreatorJson | undefined
): EditableSubtitleCue[] | undefined {
  if (!cues.some(cue => cue.sourceText !== undefined)) return undefined;
  return cues.map(cue => ({
    id: cue.id,
    start: cue.start,
    end: cue.end,
    text: cue.sourceText === undefined
      ? cue.text
      : subtitlePosition === 'bottom'
        ? `${cue.sourceText}\n${cue.text}`
        : `${cue.text}\n${cue.sourceText}`
  }));
}

function writeEditedSubtitleFile(
  sourcePath: string,
  kind: 'source_subtitle' | 'target_subtitle' | 'vertical_subtitle' | 'bilingual_subtitle',
  resultVersion: number,
  cues: EditableSubtitleCue[]
): string {
  const extension = extname(sourcePath) || '.srt';
  const stem = basename(sourcePath, extname(sourcePath));
  const label = kind === 'target_subtitle'
    ? 'horizontal'
    : kind === 'vertical_subtitle'
      ? 'vertical'
      : 'bilingual';
  const outputPath = join(
    dirname(sourcePath),
    `${stem}.opencreator-${label}-v${resultVersion}${extension}`
  );
  const content = cues.map((cue, index) => [
    String(index + 1),
    `${cue.start} --> ${cue.end}`,
    cue.text
  ].join('\n')).join('\n\n');
  writeFileSync(outputPath, `${content}\n`, { encoding: 'utf8', mode: 0o600 });
  return outputPath;
}

function validSrtTimestamp(value: string): boolean {
  return /^\d{2}:\d{2}:\d{2}[,.]\d{3}$/.test(value.trim());
}

function normalizedSrtTimestamp(value: string): string {
  return value.trim().replace('.', ',');
}

function artifactFromSnapshot(
  artifacts: CreatorArtifact[],
  ids: string[] | undefined,
  kind: string
): CreatorArtifact | undefined {
  if (ids === undefined) return undefined;
  const allowed = new Set(ids);
  return [...artifacts].reverse().find(artifact => (
    artifact.kind === kind
    && allowed.has(artifact.id)
    && ['completed', 'stale'].includes(artifact.status)
  ));
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

function readOptionalBoolean(
  value: CreatorJson | undefined,
  field: string
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new CreatorServiceError(
      'creator_action_invalid',
      `${field} must be a boolean`
    );
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
