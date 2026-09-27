import type {
  CreatorArtifactStatus,
  CreatorJobStatus,
  CreatorJson
} from '@opencreator/protocol';
import type { ZodType } from 'zod';
import type { CreatorArtifact, CreatorJob, CreatorStageRun } from '@opencreator/protocol';
import type { CreatorExecutorOutput } from '../executor.js';

export type CreatorOutputValidationFinding = {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
  evidence: Record<string, CreatorJson>;
};

export type CreatorStageOutputValidator = (input: {
  job: CreatorJob;
  stage: CreatorTemplateStage;
  stageRun: CreatorStageRun;
  inputArtifacts: CreatorArtifact[];
  candidateOutputs: CreatorExecutorOutput[];
}) => CreatorOutputValidationFinding[] | Promise<CreatorOutputValidationFinding[]>;

export type CreatorTemplateStage = {
  id: string;
  executor: string;
  dependsOn?: string[];
  optional?: boolean;
  completesJob?: boolean;
  resultVersionPolicy?: 'snapshot' | 'none';
  jobCompletionPolicy?: 'complete' | 'continue';
  invalidateDependentArtifacts?: boolean;
  replaceOutputArtifactsInScope?: boolean;
  outputValidators?: CreatorStageOutputValidator[];
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
