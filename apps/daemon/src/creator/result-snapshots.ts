import type {
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  CreatorResultSnapshot
} from '@opencreator/protocol';
import { readCreatorResultSnapshots } from '@opencreator/protocol';

const snapshotStateExcludedKeys = new Set([
  'currentStage',
  'needsInput',
  'resultSnapshots',
  'resultVersions',
  'resultVersion',
  'latestResultVersion',
  'resultTab',
  'workspacePhase',
  'currentStep',
  'furthestStep',
  'draftBaseVersion'
]);

const legacyResultArtifactKinds = new Set([
  'target_subtitle',
  'vertical_subtitle',
  'dubbed_audio',
  'dubbed_video',
  'horizontal_video',
  'vertical_video',
  'cover_image',
  'clip_video',
  'stickman_video'
]);

export function nextCreatorResultVersion(job: CreatorJob): number {
  const snapshotVersion = readCreatorResultSnapshots(job.state.resultSnapshots)
    .reduce((highest, snapshot) => Math.max(highest, snapshot.version), 0);
  const stateVersion = readPositiveInteger(job.state.latestResultVersion) ?? 0;
  const artifactVersion = job.artifacts.reduce((highest, artifact) => (
    Math.max(
      highest,
      readPositiveInteger(artifact.metadata.resultVersion)
        ?? (legacyResultArtifactKinds.has(artifact.kind) ? artifact.version : 0)
    )
  ), 0);
  return Math.max(snapshotVersion, stateVersion, artifactVersion) + 1;
}

export function appendCreatorResultSnapshot(input: {
  job: CreatorJob;
  version: number;
  changedArtifacts: CreatorArtifact[];
  staleArtifactIds?: string[];
  action: string;
  stageId?: string | null;
  description: string;
  createdAt?: string;
  state?: Record<string, CreatorJson>;
}): Record<string, CreatorJson> {
  const snapshots = readCreatorResultSnapshots(input.job.state.resultSnapshots);
  const previous = snapshots.at(-1);
  const artifactRefs = previous === undefined
    ? legacyArtifactRefs(input.job.artifacts, new Set(input.changedArtifacts.map(artifact => artifact.id)))
    : cloneArtifactRefs(previous.artifactRefs);
  const changedByKind = new Map<string, string[]>();
  for (const artifact of input.changedArtifacts) {
    const ids = changedByKind.get(artifact.kind) ?? [];
    ids.push(artifact.id);
    changedByKind.set(artifact.kind, ids);
  }
  for (const [kind, ids] of changedByKind) artifactRefs[kind] = ids;

  const referencedIds = new Set(Object.values(artifactRefs).flat());
  const staleArtifactIds = [...new Set([
    ...(previous?.staleArtifactIds ?? []),
    ...(input.staleArtifactIds ?? [])
  ])].filter(id => referencedIds.has(id) && !input.changedArtifacts.some(artifact => artifact.id === id));
  const snapshot: CreatorResultSnapshot = {
    version: input.version,
    createdAt: input.createdAt ?? input.changedArtifacts.at(-1)?.createdAt ?? input.job.updatedAt,
    action: input.action,
    stageId: input.stageId ?? null,
    description: input.description,
    artifactRefs,
    changedArtifactIds: input.changedArtifacts.map(artifact => artifact.id),
    staleArtifactIds,
    state: snapshotState(input.state ?? input.job.state)
  };
  return {
    resultVersion: input.version,
    latestResultVersion: input.version,
    resultSnapshots: [...snapshots, snapshot] as CreatorJson
  };
}

function legacyArtifactRefs(artifacts: CreatorArtifact[], excludedIds: Set<string>): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  for (const artifact of artifacts) {
    if (excludedIds.has(artifact.id) || !['completed', 'stale'].includes(artifact.status)) continue;
    refs[artifact.kind] = [artifact.id];
  }
  return refs;
}

function cloneArtifactRefs(refs: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(refs).map(([kind, ids]) => [kind, [...ids]]));
}

function snapshotState(state: CreatorJob['state']): Record<string, CreatorJson> {
  return Object.fromEntries(Object.entries(state).filter(([key]) => !snapshotStateExcludedKeys.has(key)));
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
