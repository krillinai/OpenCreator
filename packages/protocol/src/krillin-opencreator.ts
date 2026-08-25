export const krillinTaskStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'interrupted'
] as const;

export const krillinStageTypes = [
  'download',
  'subtitle',
  'tts',
  'render-horizontal',
  'render-vertical'
] as const;

export type KrillinTaskStatus = typeof krillinTaskStatuses[number];
export type KrillinStageType = typeof krillinStageTypes[number];

export type CreateKrillinTaskRequest = {
  protocolVersion: 1;
  jobId: string;
  stageRunId: string;
  stageType: KrillinStageType;
  idempotencyKey: string;
  requestHash: string;
  inputArtifactIds: string[];
  options: Record<string, unknown>;
  providerConfig?: Record<string, unknown>;
};

export type KrillinTaskError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type KrillinTask = {
  id: string;
  jobId: string;
  stageRunId: string;
  stageType: KrillinStageType;
  status: KrillinTaskStatus;
  lastEventSeq: number;
  resultManifestId?: string;
  error?: KrillinTaskError;
  createdAt: string;
  updatedAt: string;
};

export type KrillinTaskEvent = {
  taskId: string;
  seq: number;
  type: 'status' | 'progress' | 'artifact' | 'result' | 'error';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type KrillinResultArtifact = {
  id: string;
  kind: string;
  relativePath: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
};

export type KrillinResultManifest = {
  protocolVersion: 1;
  id: string;
  taskId: string;
  jobId: string;
  stageRunId: string;
  artifacts: KrillinResultArtifact[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type KrillinTaskEventsResponse = {
  events: KrillinTaskEvent[];
  nextSeq: number;
};

export type KrillinCapabilitiesResponse = {
  protocolVersion: 1;
  serviceVersion: string;
  generation: number;
  stages: KrillinStageType[];
};
