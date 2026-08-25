import type {
  CreatorArtifact,
  CreatorArtifactStatus,
  CreatorJson,
  CreatorStageRun,
  CreatorJob
} from '@opencreator/protocol';

export type CreatorExecutorOutput = {
  kind: string;
  status: CreatorArtifactStatus;
  path: string | null;
  sourceArtifactIds?: string[];
  metadata?: Record<string, CreatorJson>;
};

export type CreatorExecutorResult = {
  outputs: CreatorExecutorOutput[];
  progress?: Record<string, CreatorJson>;
};

export type CreatorExecutorInput = {
  stageRun: CreatorStageRun;
  job: CreatorJob;
  inputArtifacts: CreatorArtifact[];
  workdir: string;
  signal: AbortSignal;
  reportProgress(progress: Record<string, CreatorJson>): void;
};

export interface CreatorExecutor {
  readonly id: string;
  run(input: CreatorExecutorInput): Promise<CreatorExecutorResult>;
}

export class CreatorExecutorError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CreatorExecutorError';
  }
}
