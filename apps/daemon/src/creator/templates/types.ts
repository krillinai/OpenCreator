import type {
  CreatorArtifactStatus,
  CreatorJobStatus,
  CreatorJson
} from '@opencreator/protocol';
import type { ZodType } from 'zod';

export type CreatorTemplateStage = {
  id: string;
  executor: string;
  dependsOn?: string[];
  optional?: boolean;
  completesJob?: boolean;
  resultVersionPolicy?: 'snapshot' | 'none';
  invalidateDependentArtifacts?: boolean;
  allowedJobStatuses: CreatorJobStatus[];
  inputArtifacts: Array<{
    kind: string;
    selector: 'latest-completed' | 'explicit-version' | 'state-artifact-id';
    stateKey?: string;
    optional?: boolean;
  }>;
  outputArtifacts: Array<{
    kind: string;
    status: Extract<CreatorArtifactStatus, 'technical_preview' | 'completed'>;
  }>;
};

export type CreatorTemplateAction = {
  id: string;
  inputSchema: ZodType<Record<string, CreatorJson>>;
  allowedStages: string[];
  invalidates?: Array<{
    sourceArtifactKind: string;
    propagateThroughStageGraph: boolean;
  }>;
};

export type CreatorTemplateDefinition = {
  id: string;
  version: number;
  renderer: string;
  inputSchema: ZodType<Record<string, CreatorJson>>;
  stages: CreatorTemplateStage[];
  actions: CreatorTemplateAction[];
  outputs: Array<{ kind: string; required: boolean }>;
  agentGuidance: string;
};

export type CreatorTemplateRegistry = {
  list(): CreatorTemplateDefinition[];
  get(id: string, version?: number): CreatorTemplateDefinition;
  resolveInvalidatedArtifactKinds(
    id: string,
    version: number,
    actionId: string
  ): string[];
};
