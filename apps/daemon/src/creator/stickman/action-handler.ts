import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CreatorActor,
  CreatorArtifact,
  CreatorJob,
  CreatorJobStatus,
  CreatorJson
} from '@opencreator/protocol';
import type { CreatorRepository } from '../repository.js';
import { CreatorServiceError } from '../service.js';
import {
  stickmanScriptManifestSchema,
  stickmanShotSpecSchema
} from './contracts.js';
import {
  staleStickmanShotScope,
  staleSupersededStickmanScopedArtifacts
} from './lineage.js';
import {
  DEFAULT_STICKMAN_CHARACTER_ASSET,
  DEFAULT_STICKMAN_STYLE_ASSET,
  readVisualAssetRef
} from './visual-assets.js';

export type StickmanActionResult = {
  handled: boolean;
  state: Record<string, CreatorJson>;
  status: CreatorJobStatus;
  affectedArtifactIds: string[];
};

export function handleStickmanAction(input: {
  repository: CreatorRepository;
  current: CreatorJob;
  action: string;
  parsedInput: Record<string, CreatorJson>;
  actor: CreatorActor;
  newRevision: number;
}): StickmanActionResult {
  const { current, parsedInput, repository } = input;
  if (current.templateId !== 'stickman-video' || current.templateVersion !== 2) {
    return {
      handled: false,
      state: current.state,
      status: current.status,
      affectedArtifactIds: []
    };
  }

  if (input.action === 'update-settings') {
    const patch = readRecord(parsedInput.patch, 'patch');
    if (patch.characterAsset === undefined && patch.styleAsset === undefined) {
      return {
        handled: false,
        state: current.state,
        status: current.status,
        affectedArtifactIds: []
      };
    }
    const nextCharacter = patch.characterAsset === undefined
      ? readVisualAssetRef(current.state.characterAsset, DEFAULT_STICKMAN_CHARACTER_ASSET)
      : requireVisualAssetRef(patch.characterAsset, 'characterAsset');
    const nextStyle = patch.styleAsset === undefined
      ? readVisualAssetRef(current.state.styleAsset, DEFAULT_STICKMAN_STYLE_ASSET)
      : requireVisualAssetRef(patch.styleAsset, 'styleAsset');
    const previousCharacter = readVisualAssetRef(
      current.state.characterAsset,
      DEFAULT_STICKMAN_CHARACTER_ASSET
    );
    const previousStyle = readVisualAssetRef(
      current.state.styleAsset,
      DEFAULT_STICKMAN_STYLE_ASSET
    );
    const visualProfileChanged = !sameAssetRef(previousCharacter, nextCharacter)
      || !sameAssetRef(previousStyle, nextStyle);
    const affectedArtifactIds = visualProfileChanged
      ? staleVisualPipeline(repository, current)
      : [];
    return {
      handled: true,
      state: {
        ...current.state,
        ...patch,
        characterAsset: nextCharacter,
        styleAsset: nextStyle
      },
      status: current.status,
      affectedArtifactIds
    };
  }

  if (input.action === 'approve-script') {
    const source = requireCurrentArtifact(current, parsedInput, 'script_manifest');
    requireApprovalRevision(current, parsedInput);
    if (source.path === null) {
      throw new CreatorServiceError('creator_artifact_not_found', 'Script file is unavailable');
    }
    const script = stickmanScriptManifestSchema.parse(JSON.parse(readFileSync(source.path, 'utf8')));
    const locked = stickmanScriptManifestSchema.parse({
      ...script,
      reviewStatus: 'approved',
      contentLocked: true
    });
    repository.setArtifactStatus(source.id, 'stale');
    const path = writeEditedJson(source, `script-manifest-approved-${input.newRevision}.json`, locked);
    const artifact = repository.insertArtifact({
      jobId: current.id,
      kind: 'script_manifest',
      status: 'completed',
      path,
      sha256: sha256File(path),
      sourceArtifactIds: [...new Set([...source.sourceArtifactIds, source.id])],
      metadata: {
        contract: locked.contract,
        contentLocked: true,
        approvedFromArtifactId: source.id,
        approvedBy: input.actor
      }
    });
    const state: Record<string, CreatorJson> = {
      ...current.state,
      approvedScriptArtifactId: artifact.id,
      workflowTarget: 'audio_ready',
      currentStage: 'narration'
    };
    delete state.needsInput;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds: [source.id, artifact.id]
    };
  }
  if (input.action === 'continue-after-audio') {
    const source = requireCurrentArtifact(current, parsedInput, 'audio_timing');
    requireApprovalRevision(current, parsedInput);
    const state: Record<string, CreatorJson> = {
      ...current.state,
      workflowTarget: 'visuals_ready',
      currentStage: 'storyboard'
    };
    delete state.needsInput;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds: [source.id]
    };
  }
  if (input.action === 'continue-after-visuals') {
    const source = requireCurrentArtifact(current, parsedInput, 'visual_validation');
    requireApprovalRevision(current, parsedInput);
    const state: Record<string, CreatorJson> = {
      ...current.state,
      workflowTarget: 'delivery_ready',
      currentStage: 'timeline'
    };
    delete state.needsInput;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds: [source.id]
    };
  }
  if (input.action === 'edit-script') {
    const source = requireCurrentArtifact(current, parsedInput, 'script_manifest');
    const content = typeof parsedInput.content === 'string' ? parsedInput.content : '';
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new CreatorServiceError('creator_action_input_invalid', 'Script content must be valid JSON');
    }
    const script = normalizeEditedScript(stickmanScriptManifestSchema.parse(value));
    const affectedArtifactIds = [
      ...staleFrom(repository, current, source, true),
      ...current.artifacts
        .filter(artifact => artifact.kind === 'narration_subtitle')
        .flatMap(artifact => staleFrom(repository, current, artifact, true))
    ];
    const path = writeEditedJson(source, `script-manifest-edit-${input.newRevision}.json`, script);
    const artifact = repository.insertArtifact({
      jobId: current.id,
      kind: 'script_manifest',
      status: 'completed',
      path,
      sha256: sha256File(path),
      sourceArtifactIds: source.sourceArtifactIds,
      metadata: { contract: script.contract, contentLocked: false, editedFromArtifactId: source.id }
    });
    affectedArtifactIds.push(artifact.id);
    const state: Record<string, CreatorJson> = {
      ...current.state,
      workflowTarget: 'script_ready',
      currentStage: 'script'
    };
    delete state.needsInput;
    delete state.approvedScriptArtifactId;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds: [...new Set(affectedArtifactIds)]
    };
  }
  if (input.action === 'edit-shot') {
    const source = requireCurrentArtifact(current, parsedInput, 'shot_spec');
    if (source.path === null) throw new CreatorServiceError('creator_artifact_not_found', 'Shot spec file is unavailable');
    const shotSpec = stickmanShotSpecSchema.parse(JSON.parse(readFileSync(source.path, 'utf8')));
    const targetScope = readString(parsedInput.scopeKey, 'scopeKey');
    const patch = readRecord(parsedInput.patch, 'patch');
    const targetIndex = shotSpec.shots.findIndex(shot => shot.id === targetScope);
    if (targetIndex < 0) throw new CreatorServiceError('creator_shot_not_found', 'Shot was not found');
    const visualDescription = typeof patch.visualDescription === 'string'
      ? patch.visualDescription.trim()
      : undefined;
    const motion = typeof patch.motion === 'string' ? patch.motion : undefined;
    if (visualDescription === undefined && motion === undefined) {
      throw new CreatorServiceError(
        'creator_action_input_invalid',
        '画面描述或运镜至少需要修改一项'
      );
    }
    const shots = shotSpec.shots.map((shot, index) => index === targetIndex
      ? {
          ...shot,
          ...(visualDescription === undefined ? {} : { visualDescription }),
          ...(motion === undefined ? {} : { motion })
        }
      : shot);
    const next = stickmanShotSpecSchema.parse({ ...shotSpec, shots });
    repository.setArtifactStatus(source.id, 'stale');
    const affectedArtifactIds = [
      source.id,
      ...staleStickmanShotScope({ repository, job: current, scopeKey: targetScope })
    ];
    const path = writeEditedJson(source, `shot-spec-edit-${input.newRevision}.json`, next);
    const artifact = repository.insertArtifact({
      jobId: current.id,
      kind: 'shot_spec',
      status: 'completed',
      path,
      sha256: sha256File(path),
      sourceArtifactIds: source.sourceArtifactIds,
      metadata: {
        contract: 'stickman-semantic-storyboard-v3',
        shotCount: next.shots.length,
        editedScopeKey: targetScope,
        editedFromArtifactId: source.id
      }
    });
    affectedArtifactIds.push(artifact.id);
    const state: Record<string, CreatorJson> = {
      ...current.state,
      workflowTarget: 'visuals_ready',
      currentStage: 'images'
    };
    delete state.needsInput;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds: [...new Set(affectedArtifactIds)]
    };
  }
  if (input.action === 'regenerate-shot') {
    const targetScope = readString(parsedInput.scopeKey, 'scopeKey');
    requireNoPendingShotProviderRequest(current, targetScope);
    const affectedArtifactIds = staleStickmanShotScope({
      repository,
      job: current,
      scopeKey: targetScope
    });
    const state: Record<string, CreatorJson> = {
      ...current.state,
      workflowTarget: 'visuals_ready',
      currentStage: 'images'
    };
    delete state.needsInput;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds: [...new Set(affectedArtifactIds)]
    };
  }
  if (input.action === 'generate-missing-shots') {
    requireApprovalRevision(current, parsedInput);
    requireNoPendingImageProviderRequest(current);
    const affectedArtifactIds = staleSupersededStickmanScopedArtifacts({
      repository,
      job: current,
      kind: 'shot_image'
    });
    const state: Record<string, CreatorJson> = {
      ...current.state,
      workflowTarget: 'visuals_ready',
      currentStage: 'images'
    };
    delete state.needsInput;
    return {
      handled: true,
      state,
      status: 'running',
      affectedArtifactIds
    };
  }
  return {
    handled: false,
    state: current.state,
    status: current.status,
    affectedArtifactIds: []
  };
}

function requireNoPendingShotProviderRequest(job: CreatorJob, scopeKey: string): void {
  const stageRunIds = new Set(job.stages.filter(stage => (
    stage.stageId === 'images' && stage.scopeKey === scopeKey
  )).map(stage => stage.id));
  const pending = job.providerRequests.some(request => (
    stageRunIds.has(request.stageRunId)
    && (
      request.status === 'submitting'
      || request.status === 'waiting_remote'
      || request.status === 'unknown_remote_acceptance'
    )
  ));
  if (pending) {
    throw new CreatorServiceError(
      'creator_provider_resolution_required',
      'Provider request acceptance must be resolved before regenerating this shot'
    );
  }
}

function requireNoPendingImageProviderRequest(job: CreatorJob): void {
  const imageStageRunIds = new Set(job.stages.filter(stage => (
    stage.stageId === 'images'
  )).map(stage => stage.id));
  const pending = job.providerRequests.some(request => (
    imageStageRunIds.has(request.stageRunId)
    && (
      request.status === 'submitting'
      || request.status === 'waiting_remote'
      || request.status === 'unknown_remote_acceptance'
    )
  ));
  if (pending) {
    throw new CreatorServiceError(
      'creator_provider_resolution_required',
      '必须先确认状态未明的画面生成请求，才能继续批量生成'
    );
  }
}

function normalizeEditedScript(
  value: ReturnType<typeof stickmanScriptManifestSchema.parse>
): ReturnType<typeof stickmanScriptManifestSchema.parse> {
  const unit = value.narrationBudget.unit;
  const segments = value.segments.map((segment, index) => {
    const narration = segment.narration.trim();
    const narrationUnits = unit === 'words'
      ? narration.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
      : narration.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    const estimatedDurationSeconds = roundSeconds(
      narrationUnits / value.narrationBudget.unitsPerMinute * 60
    );
    return {
      ...segment,
      id: `segment-${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      narration,
      narrationUnits,
      estimatedDurationSeconds
    };
  });
  const overlongSegment = segments.find(segment => segment.estimatedDurationSeconds > 5);
  if (overlongSegment !== undefined) {
    throw new CreatorServiceError(
      'creator_script_segment_duration_invalid',
      `${overlongSegment.id} 的预计配音时长超过 5 秒，请按完整语义拆成多个旁白单元`
    );
  }
  const totalNarrationUnits = segments.reduce((total, segment) => total + segment.narrationUnits, 0);
  if (
    totalNarrationUnits < value.narrationBudget.minUnits
    || totalNarrationUnits > value.narrationBudget.maxUnits
  ) {
    throw new CreatorServiceError(
      'creator_script_duration_budget_invalid',
      `旁白长度必须保持在 ${value.narrationBudget.minUnits}-${value.narrationBudget.maxUnits} ${unit === 'words' ? '词' : '字符'}内`
    );
  }
  return stickmanScriptManifestSchema.parse({
    ...value,
    reviewStatus: 'needs_review',
    contentLocked: false,
    segmentCount: segments.length,
    totalNarrationUnits,
    estimatedTotalDurationSeconds: roundSeconds(
      totalNarrationUnits / value.narrationBudget.unitsPerMinute * 60
    ),
    segments
  });
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function requireCurrentArtifact(
  job: CreatorJob,
  input: Record<string, CreatorJson>,
  kind: string
): CreatorArtifact {
  const artifactId = readString(input.artifactId, 'artifactId');
  const current = [...job.artifacts].reverse().find(artifact => (
    artifact.kind === kind && artifact.status === 'completed'
  ));
  if (current === undefined || current.id !== artifactId) {
    throw new CreatorServiceError('creator_stale_approval', `Current ${kind} artifact does not match`);
  }
  return current;
}

function requireApprovalRevision(job: CreatorJob, input: Record<string, CreatorJson>): void {
  if (input.revision !== job.revision) {
    throw new CreatorServiceError(
      'creator_revision_conflict',
      'Creator job revision changed',
      job.revision
    );
  }
}

function staleFrom(
  repository: CreatorRepository,
  job: CreatorJob,
  source: CreatorArtifact,
  includeSource: boolean
): string[] {
  const result = includeSource ? [source.id] : [];
  const queue = [source.id];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const artifact of job.artifacts) {
      if (!artifact.sourceArtifactIds.includes(id)) continue;
      result.push(artifact.id);
      queue.push(artifact.id);
    }
  }
  for (const id of new Set(result)) repository.setArtifactStatus(id, 'stale');
  return [...new Set(result)];
}

function staleVisualPipeline(repository: CreatorRepository, job: CreatorJob): string[] {
  const rootKinds = new Set([
    'character_reference',
    'style_reference',
    'style_contract',
    'image_prompt_pack'
  ]);
  const roots = job.artifacts.filter(artifact => (
    artifact.status !== 'stale' && rootKinds.has(artifact.kind)
  ));
  const affected = new Set<string>();
  for (const root of roots) {
    for (const artifactId of staleFrom(repository, job, root, true)) {
      affected.add(artifactId);
    }
  }
  return [...affected];
}

function requireVisualAssetRef(
  value: CreatorJson,
  field: string
): { assetId: string; revision: number } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new CreatorServiceError('creator_action_input_invalid', `${field} must be an asset reference`);
  }
  const assetId = value.assetId;
  const revision = value.revision;
  if (
    typeof assetId !== 'string'
    || assetId.trim().length === 0
    || typeof revision !== 'number'
    || !Number.isSafeInteger(revision)
    || revision <= 0
  ) {
    throw new CreatorServiceError('creator_action_input_invalid', `${field} must include assetId and revision`);
  }
  return { assetId: assetId.trim(), revision };
}

function sameAssetRef(
  left: { assetId: string; revision: number },
  right: { assetId: string; revision: number }
): boolean {
  return left.assetId === right.assetId && left.revision === right.revision;
}

function writeEditedJson(source: CreatorArtifact, fileName: string, value: unknown): string {
  return writeEditedFile(source, fileName, `${JSON.stringify(value, null, 2)}\n`);
}

function writeEditedFile(source: CreatorArtifact, fileName: string, content: string): string {
  if (source.path === null) throw new CreatorServiceError('creator_artifact_not_found', 'Artifact file is unavailable');
  const path = join(dirname(source.path), fileName);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
  return path;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readString(value: CreatorJson | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CreatorServiceError('creator_action_input_invalid', `${field} is required`);
  }
  return value;
}

function readRecord(value: CreatorJson | undefined, field: string): Record<string, CreatorJson> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    throw new CreatorServiceError('creator_action_input_invalid', `${field} must be an object`);
  }
  return value;
}
