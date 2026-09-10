import { createHash } from 'node:crypto';
import type { CreatorArtifact, CreatorJob, CreatorJson } from '@opencreator/protocol';
import type { CreatorRepository } from '../repository.js';
import type { StickmanShot, StickmanShotSpec } from './contracts.js';
import {
  STICKMAN_CHARACTER_REFERENCE_PREPARATION,
  STICKMAN_IMAGE_PROMPT_CONTRACT,
  shouldUsePreviousShotReference
} from './image-prompt.js';
import {
  DEFAULT_STICKMAN_CHARACTER_ASSET,
  DEFAULT_STICKMAN_STYLE_ASSET,
  readVisualAssetRef
} from './visual-assets.js';

export type StickmanImageSettings = {
  provider: string;
  model: string;
  quality: string;
};

export type StickmanTtsSettings = {
  provider: string;
  model: string;
  voiceId: string;
};

export function stickmanNarrationFingerprint(input: {
  segment: { id: string; narration: string };
  script: CreatorArtifact;
  settings: StickmanTtsSettings;
}): string {
  return createHash('sha256').update(canonicalJson({
    segmentId: input.segment.id,
    narration: input.segment.narration,
    scriptSha256: input.script.sha256,
    provider: input.settings.provider,
    model: input.settings.model,
    voiceId: input.settings.voiceId,
    format: 'wav'
  })).digest('hex');
}

export function currentNarrationAudio(
  job: CreatorJob,
  scopeKey: string,
  inputFingerprint: string
): CreatorArtifact | undefined {
  return [...job.artifacts].reverse().find(artifact => (
    artifact.kind === 'narration_audio'
    && artifact.scopeKey === scopeKey
    && artifact.inputFingerprint === inputFingerprint
    && artifact.status === 'completed'
  ));
}

export function stickmanShotFingerprint(input: {
  shot: StickmanShot;
  job: CreatorJob;
  shotSpec: CreatorArtifact;
  characterReference?: CreatorArtifact;
  styleReference?: CreatorArtifact;
  styleContract?: CreatorArtifact;
  promptPack?: CreatorArtifact;
  previousShotImage?: CreatorArtifact;
  settings: StickmanImageSettings;
}): string {
  return createHash('sha256').update(canonicalJson({
    shot: input.shot as unknown as CreatorJson,
    characterAsset: readVisualAssetRef(
      input.job.state.characterAsset,
      DEFAULT_STICKMAN_CHARACTER_ASSET
    ) as unknown as CreatorJson,
    styleAsset: readVisualAssetRef(
      input.job.state.styleAsset,
      DEFAULT_STICKMAN_STYLE_ASSET
    ) as unknown as CreatorJson,
    ratio: input.job.state.ratio ?? '16:9',
    provider: input.settings.provider,
    model: input.settings.model,
    quality: input.settings.quality,
    characterReferencePreparation: STICKMAN_CHARACTER_REFERENCE_PREPARATION,
    imagePromptContract: STICKMAN_IMAGE_PROMPT_CONTRACT,
    shotSpecSha256: input.shotSpec.sha256,
    characterReferenceSha256: input.characterReference?.sha256 ?? null,
    styleReferenceSha256: input.styleReference?.sha256 ?? null,
    styleContractSha256: input.styleContract?.sha256 ?? null,
    promptPackSha256: input.promptPack?.sha256 ?? null,
    previousShotImageSha256: input.previousShotImage?.sha256 ?? null
  })).digest('hex');
}

export function previousStickmanShotImage(input: {
  artifacts: CreatorArtifact[];
  shotSpec: StickmanShotSpec;
  shotIndex: number;
}): CreatorArtifact | undefined {
  const shot = input.shotSpec.shots[input.shotIndex];
  const previousShot = input.shotSpec.shots[input.shotIndex - 1];
  if (
    shot === undefined
    || previousShot === undefined
    || !shouldUsePreviousShotReference(shot, input.shotIndex)
  ) return undefined;
  return [...input.artifacts].reverse().find(artifact => (
    artifact.kind === 'shot_image'
    && artifact.scopeKey === previousShot.id
    && artifact.status === 'completed'
  ));
}

export function currentShotImage(
  job: CreatorJob,
  scopeKey: string,
  inputFingerprint: string
): CreatorArtifact | undefined {
  return [...job.artifacts].reverse().find(artifact => (
    artifact.kind === 'shot_image'
    && artifact.scopeKey === scopeKey
    && artifact.inputFingerprint === inputFingerprint
    && artifact.status === 'completed'
  ));
}

export function currentStickmanScopedArtifacts(
  job: CreatorJob,
  kind: 'shot_image' | 'narration_audio'
): CreatorArtifact[] {
  const stageId = kind === 'shot_image' ? 'images' : 'narration';
  const completedByScope = new Map<string, CreatorArtifact[]>();
  for (const artifact of job.artifacts) {
    if (artifact.kind !== kind || artifact.status !== 'completed' || artifact.scopeKey === null) continue;
    completedByScope.set(artifact.scopeKey, [
      ...(completedByScope.get(artifact.scopeKey) ?? []),
      artifact
    ]);
  }

  const current: CreatorArtifact[] = [];
  for (const [scopeKey, artifacts] of completedByScope) {
    const latestSucceededStage = [...job.stages].reverse().find(stage => (
      stage.stageId === stageId
      && stage.scopeKey === scopeKey
      && stage.inputFingerprint !== null
      && stage.status === 'succeeded'
    ));
    const selected = latestSucceededStage === undefined
      ? artifacts.at(-1)
      : [...artifacts].reverse().find(artifact => (
          artifact.inputFingerprint === latestSucceededStage.inputFingerprint
        ));
    if (selected !== undefined) current.push(selected);
  }
  return current;
}

export function staleSupersededStickmanScopedArtifacts(input: {
  repository: CreatorRepository;
  job: CreatorJob;
  kind: 'shot_image' | 'narration_audio';
}): string[] {
  const currentByScope = new Map(
    currentStickmanScopedArtifacts(input.job, input.kind)
      .map(artifact => [artifact.scopeKey!, artifact.id])
  );
  const roots = input.job.artifacts.filter(artifact => (
    artifact.kind === input.kind
    && artifact.status === 'completed'
    && artifact.scopeKey !== null
    && currentByScope.has(artifact.scopeKey)
    && currentByScope.get(artifact.scopeKey) !== artifact.id
  ));
  return staleArtifactsAndDependents(input.repository, input.job, roots);
}

export function staleStickmanShotScope(input: {
  repository: CreatorRepository;
  job: CreatorJob;
  scopeKey: string;
}): string[] {
  const roots = input.job.artifacts.filter(artifact => (
    artifact.kind === 'shot_image'
    && artifact.scopeKey === input.scopeKey
    && artifact.status !== 'stale'
  ));
  return staleArtifactsAndDependents(input.repository, input.job, roots);
}

function staleArtifactsAndDependents(
  repository: CreatorRepository,
  job: CreatorJob,
  roots: CreatorArtifact[]
): string[] {
  const stale = new Set(roots.map(artifact => artifact.id));
  const queue = [...stale];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const artifact of job.artifacts) {
      if (artifact.status === 'stale' || !artifact.sourceArtifactIds.includes(current)) continue;
      if (!stale.has(artifact.id)) {
        stale.add(artifact.id);
        queue.push(artifact.id);
      }
    }
  }
  for (const id of stale) repository.setArtifactStatus(id, 'stale');
  return [...stale];
}

export function missingCurrentShots(input: {
  job: CreatorJob;
  shotSpec: StickmanShotSpec;
  shotSpecArtifact: CreatorArtifact;
  characterReference?: CreatorArtifact;
  styleReference?: CreatorArtifact;
  styleContract?: CreatorArtifact;
  settings: StickmanImageSettings;
}): Array<{ shot: StickmanShot; fingerprint: string }> {
  return input.shotSpec.shots.flatMap((shot, shotIndex) => {
    const previousShotImage = previousStickmanShotImage({
      artifacts: input.job.artifacts,
      shotSpec: input.shotSpec,
      shotIndex
    });
    const fingerprint = stickmanShotFingerprint({
      shot,
      job: input.job,
      shotSpec: input.shotSpecArtifact,
      characterReference: input.characterReference,
      styleReference: input.styleReference,
      styleContract: input.styleContract,
      previousShotImage,
      settings: input.settings
    });
    return currentShotImage(input.job, shot.id, fingerprint) === undefined
      ? [{ shot, fingerprint }]
      : [];
  });
}

function canonicalJson(value: CreatorJson): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: CreatorJson): CreatorJson {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}
