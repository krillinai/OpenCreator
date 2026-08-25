import { basename } from 'node:path';
import {
  readCreatorResultSnapshots,
  type AgentContextEnvelope,
  type CreatorJob,
  type CreatorSelection
} from '@opencreator/protocol';
import type { CreatorTemplateRegistry } from '../templates/types.js';

export type AgentContextBuilder = ReturnType<typeof createAgentContextBuilder>;

export function createAgentContextBuilder(input: {
  templates: CreatorTemplateRegistry;
  maxRecentChanges?: number;
  maxRecentBytes?: number;
  maxStateBytes?: number;
}) {
  const maxRecentChanges = input.maxRecentChanges ?? 12;
  const maxRecentBytes = input.maxRecentBytes ?? 8 * 1024;
  const maxStateBytes = input.maxStateBytes ?? 16 * 1024;
  return {
    build(job: CreatorJob, selection: CreatorSelection | null = null): AgentContextEnvelope {
      const candidates = job.activities.slice(-maxRecentChanges).map(activity => ({
        revision: activity.revision,
        actor: activity.actor,
        action: activity.action,
        summary: activity.summary,
        createdAt: activity.createdAt
      }));
      const recentChanges = [] as typeof candidates;
      let bytes = 0;
      for (const candidate of candidates.reverse()) {
        const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
        if (recentChanges.length > 0 && bytes + candidateBytes > maxRecentBytes) break;
        recentChanges.unshift(candidate);
        bytes += candidateBytes;
      }
      const stateProjection = projectState(job.state, maxStateBytes);
      const template = input.templates.get(job.templateId, job.templateVersion);
      const resultSnapshots = readCreatorResultSnapshots(job.state.resultSnapshots);
      const latestResultVersion = readNumber(job.state.latestResultVersion)
        ?? resultSnapshots.at(-1)?.version
        ?? null;
      const selectedResultVersion = readNumber(job.state.resultVersion) ?? latestResultVersion;
      const selectedSnapshot = resultSnapshots.find(snapshot => snapshot.version === selectedResultVersion)
        ?? null;
      return {
        contractVersion: 1,
        jobId: job.id,
        projectId: job.projectId,
        templateId: job.templateId,
        templateVersion: job.templateVersion,
        jobStatus: job.status,
        revision: job.revision,
        selectedResultVersion,
        latestResultVersion,
        selectedResultSnapshot: selectedSnapshot === null ? null : {
          version: selectedSnapshot.version,
          description: selectedSnapshot.description,
          artifactRefs: selectedSnapshot.artifactRefs,
          staleArtifactIds: selectedSnapshot.staleArtifactIds
        },
        currentStage: typeof job.state.currentStage === 'string' ? job.state.currentStage : null,
        state: stateProjection.state,
        stateTruncated: stateProjection.truncated,
        templateGuidance: template.agentGuidance,
        availableStageIds: template.stages.map(stage => stage.id),
        stages: job.stages.map(stage => ({
          stageId: stage.stageId,
          status: stage.status,
          dispatchStatus: stage.dispatchStatus,
          attempt: stage.attempt,
          progress: projectStageProgress(stage.progress),
          errorCode: stage.errorCode,
          errorMessage: stage.errorMessage,
          startedAt: stage.startedAt,
          finishedAt: stage.finishedAt
        })),
        artifacts: job.artifacts.map(artifact => ({
          id: artifact.id,
          kind: artifact.kind,
          version: artifact.version,
          projectVersion: readNumber(artifact.metadata.resultVersion),
          status: artifact.status,
          fileName: readString(artifact.metadata.fileName)
            ?? (artifact.path === null ? null : basename(artifact.path)),
          cueCount: readNumber(artifact.metadata.cueCount),
          duration: readNumber(artifact.metadata.duration),
          width: readNumber(artifact.metadata.width),
          height: readNumber(artifact.metadata.height)
        })),
        selection,
        recentChanges,
        allowedActions: template.actions.map(action => action.id)
      };
    }
  };
}

function projectState(
  state: CreatorJob['state'],
  maxBytes: number
): { state: CreatorJob['state']; truncated: boolean } {
  const projected: CreatorJob['state'] = {};
  let bytes = Buffer.byteLength('{}', 'utf8');
  let truncated = false;
  for (const [key, value] of Object.entries(state)) {
    const candidateBytes = Buffer.byteLength(JSON.stringify({ [key]: value }), 'utf8');
    if (bytes + candidateBytes > maxBytes) {
      truncated = true;
      continue;
    }
    projected[key] = value;
    bytes += candidateBytes;
  }
  return { state: projected, truncated };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectStageProgress(progress: CreatorJob['stages'][number]['progress']): {
  percent: number | null;
  providerStatus: string | null;
  phase: string | null;
} {
  const eventPayload = readRecord(progress.krillinEventPayload);
  return {
    percent: readNumber(progress.percent) ?? readNumber(eventPayload?.percent),
    providerStatus: readString(progress.krillinStatus) ?? readString(eventPayload?.status),
    phase: readString(progress.phase) ?? readString(eventPayload?.phase)
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
