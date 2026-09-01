import { createHash } from 'node:crypto';
import type { CreatorArtifact, CreatorJob, CreatorJson } from '@opencreator/protocol';
import type { CreatorRepository } from '../repository.js';
import type { StickmanShot, StickmanShotSpec } from './contracts.js';

export type StickmanImageSettings = {
  provider: string;
  model: string;
  quality: string;
};

export function stickmanShotFingerprint(input: {
  shot: StickmanShot;
  job: CreatorJob;
  shotSpec: CreatorArtifact;
  characterReference?: CreatorArtifact;
  settings: StickmanImageSettings;
}): string {
  return createHash('sha256').update(canonicalJson({
    shot: input.shot as unknown as CreatorJson,
    style: input.job.state.style ?? null,
    ratio: input.job.state.ratio ?? '16:9',
    provider: input.settings.provider,
    model: input.settings.model,
    quality: input.settings.quality,
    shotSpecSha256: input.shotSpec.sha256,
    characterReferenceSha256: input.characterReference?.sha256 ?? null
  })).digest('hex');
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
  const stale = new Set(roots.map(artifact => artifact.id));
  const queue = [...stale];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const artifact of input.job.artifacts) {
      if (artifact.status === 'stale' || !artifact.sourceArtifactIds.includes(current)) continue;
      if (!stale.has(artifact.id)) {
        stale.add(artifact.id);
        queue.push(artifact.id);
      }
    }
  }
  for (const id of stale) input.repository.setArtifactStatus(id, 'stale');
  return [...stale];
}

export function missingCurrentShots(input: {
  job: CreatorJob;
  shotSpec: StickmanShotSpec;
  shotSpecArtifact: CreatorArtifact;
  characterReference?: CreatorArtifact;
  settings: StickmanImageSettings;
}): Array<{ shot: StickmanShot; fingerprint: string }> {
  return input.shotSpec.shots.flatMap(shot => {
    const fingerprint = stickmanShotFingerprint({
      shot,
      job: input.job,
      shotSpec: input.shotSpecArtifact,
      characterReference: input.characterReference,
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
