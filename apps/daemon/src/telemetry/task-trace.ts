import { createHash, randomUUID } from 'node:crypto';
import { supportedVideoSourcePlatform, type CreatorJob, type DownloadPlatform } from '@opencreator/protocol';
import type { CreatorTelemetryFailure } from './events.js';

const taskTraceFeatures = new Set([
  'video-translation', 'video-download', 'transcription', 'image-generation', 'video-generation', 'smart-dubbing', 'auto-clip'
]);

export function supportsCreatorTaskTrace(feature: string): boolean {
  return taskTraceFeatures.has(feature);
}

export type CreatorTaskTrace = {
  event_id: string;
  event_type: 'task_started' | 'task_state' | 'preflight_rejected' | 'stage_started' | 'stage_finished' | 'request_started' | 'request_finished';
  occurred_at: string;
  task_id: string;
  feature: string;
  auth_state?: 'signed_in' | 'signed_out';
  account_id?: string;
  payment_state?: 'recharged' | 'not_recharged' | 'pending';
  translation_source?: DownloadPlatform | 'upload' | 'subtitle' | 'other_link';
  execution_mode?: 'local';
  stage_id?: string;
  attempt_id?: string;
  revision?: number;
  outcome?: string;
  code?: string;
  operation?: string;
  call_id?: string;
  gateway_request_id?: string;
  http_status?: number;
  duration_ms?: number;
  failure?: CreatorTelemetryFailure;
};

export function translationSourceAtLaunch(job: CreatorJob): CreatorTaskTrace['translation_source'] {
  if (job.templateId !== 'video-translation') return undefined;
  const { sourceType, sourceUrl } = job.state ?? {};
  if (sourceType === 'file') return 'upload';
  if (sourceType === 'subtitle') return 'subtitle';
  if (sourceType !== 'url' || typeof sourceUrl !== 'string') return undefined;
  const platform = supportedVideoSourcePlatform(sourceUrl);
  if (platform) return platform;
  try {
    const { protocol } = new URL(sourceUrl);
    if (protocol === 'https:' || protocol === 'http:') return 'other_link';
  } catch {
    return undefined;
  }
  return undefined;
}

export function traceEventId(key?: string): string {
  if (key === undefined) return randomUUID();
  const value = createHash('sha256').update(`opencreator-task-trace:${key}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export function traceToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:\/-]{0,127}$/.test(value)
    && !/(?:https?:|\/\/|(?:^|[/:])\.|sk[-_]|bearer|gh[pousr]_)/i.test(value) ? value : undefined;
}
