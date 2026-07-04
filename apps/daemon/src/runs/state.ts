export type InternalRunStatus =
  | 'created'
  | 'queued'
  | 'spawning'
  | 'running'
  | 'canceling'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'orphaned';
