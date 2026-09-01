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
import { stickmanScriptManifestSchema, stickmanShotSpecSchema } from './contracts.js';
import { staleStickmanShotScope } from './lineage.js';

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

  if (input.action === 'approve-script') {
    const artifact = requireCurrentArtifact(current, parsedInput, 'script_manifest');
    requireApprovalRevision(current, parsedInput);
    return approved(current, 'approvedScriptArtifactId', artifact.id, 'storyboard');
  }
  if (input.action === 'approve-storyboard') {
    const artifact = requireCurrentArtifact(current, parsedInput, 'shot_spec');
    requireApprovalRevision(current, parsedInput);
    return approved(current, 'approvedShotSpecArtifactId', artifact.id, 'images');
  }
  if (input.action === 'approve-visuals') {
    const artifact = requireCurrentArtifact(current, parsedInput, 'visual_validation');
    requireApprovalRevision(current, parsedInput);
    return approved(current, 'approvedVisualValidationArtifactId', artifact.id, 'timeline');
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
    const script = stickmanScriptManifestSchema.parse(value);
    const affectedArtifactIds = staleFrom(repository, current, source, true);
    const path = writeEditedJson(source, `script-manifest-edit-${input.newRevision}.json`, script);
    const artifact = repository.insertArtifact({
      jobId: current.id,
      kind: 'script_manifest',
      status: 'completed',
      path,
      sourceArtifactIds: source.sourceArtifactIds,
      metadata: { contract: 'script_manifest-v1', editedFromArtifactId: source.id }
    });
    affectedArtifactIds.push(artifact.id);
    return reviewGate(current, artifact.id, 'approve-script', affectedArtifactIds);
  }
  if (input.action === 'edit-shot') {
    const source = requireCurrentArtifact(current, parsedInput, 'shot_spec');
    if (source.path === null) throw new CreatorServiceError('creator_artifact_not_found', 'Shot spec file is unavailable');
    const shotSpec = stickmanShotSpecSchema.parse(JSON.parse(readFileSync(source.path, 'utf8')));
    const targetScope = readString(parsedInput.scopeKey, 'scopeKey');
    const patch = readRecord(parsedInput.patch, 'patch');
    const targetIndex = shotSpec.shots.findIndex(shot => shot.id === targetScope);
    if (targetIndex < 0) throw new CreatorServiceError('creator_shot_not_found', 'Shot was not found');
    const shots = shotSpec.shots.map((shot, index) => index === targetIndex ? { ...shot, ...patch } : shot);
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
      sourceArtifactIds: source.sourceArtifactIds,
      metadata: {
        contract: 'stickman-shot-spec-v1',
        shotCount: next.shots.length,
        editedScopeKey: targetScope,
        editedFromArtifactId: source.id
      }
    });
    affectedArtifactIds.push(artifact.id);
    return reviewGate(current, artifact.id, 'approve-storyboard', affectedArtifactIds);
  }
  if (input.action === 'regenerate-shot') {
    const targetScope = readString(parsedInput.scopeKey, 'scopeKey');
    const affectedArtifactIds = staleStickmanShotScope({
      repository,
      job: current,
      scopeKey: targetScope
    });
    return {
      handled: true,
      state: { ...current.state, currentStage: 'images' },
      status: 'running',
      affectedArtifactIds: [...new Set(affectedArtifactIds)]
    };
  }
  return {
    handled: false,
    state: current.state,
    status: current.status,
    affectedArtifactIds: []
  };
}

function approved(
  job: CreatorJob,
  stateKey: string,
  artifactId: string,
  nextStage: string
): StickmanActionResult {
  const state = { ...job.state, [stateKey]: artifactId, currentStage: nextStage };
  delete state.needsInput;
  return { handled: true, state, status: 'running', affectedArtifactIds: [artifactId] };
}

function reviewGate(
  job: CreatorJob,
  artifactId: string,
  kind: 'approve-script' | 'approve-storyboard',
  affectedArtifactIds: string[]
): StickmanActionResult {
  return {
    handled: true,
    state: {
      ...job.state,
      currentStage: kind === 'approve-script' ? 'script' : 'storyboard',
      needsInput: { code: 'creator_review_required', kind, artifactId }
    },
    status: 'needs_input',
    affectedArtifactIds
  };
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

function writeEditedJson(source: CreatorArtifact, fileName: string, value: unknown): string {
  if (source.path === null) throw new CreatorServiceError('creator_artifact_not_found', 'Artifact file is unavailable');
  const path = join(dirname(source.path), fileName);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
  return path;
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
