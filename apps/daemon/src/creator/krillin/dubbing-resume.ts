import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { CreatorServicesConfig } from '@opencreator/protocol';
import type { GatewayCreatorBinding } from '../../gateway/creator-service-source.js';
import type { CreatorExecutorInput } from '../executor.js';

export function dubbingSegmentCacheDir(input: {
  stage: CreatorExecutorInput;
  config: CreatorServicesConfig;
  options: Record<string, unknown>;
  artifacts: ReadonlyArray<{ id: string; kind: string }>;
  binding?: GatewayCreatorBinding;
}): string | undefined {
  const { stage, config, options, artifacts, binding } = input;
  if (stage.job.templateId !== 'video-translation' || stage.stageRun.stageId !== 'tts') return undefined;
  const { provider } = config.tts;
  const speech = provider === 'edge-tts' ? undefined : config.tts[provider];
  const gateway = provider === 'openai' && binding?.baseUrl === speech?.baseUrl ? binding : undefined;
  const key = createHash('sha256').update(JSON.stringify({
    version: 1,
    templateVersion: stage.job.templateVersion,
    subtitles: artifacts.filter(artifact => ['target_subtitle', 'source_subtitle', 'bilingual_subtitle'].includes(artifact.kind))
      .map(artifact => [artifact.kind, artifact.id]).sort(),
    targetLanguage: options.targetLanguage,
    bilingualTop: options.bilingualTop,
    provider,
    endpoint: gateway ? [gateway.accountId, gateway.bindingVersion] : speech?.baseUrl,
    model: speech?.model,
    defaultVoice: speech?.defaultVoiceId,
    voice: options.voiceCode,
    appId: provider === 'volcengine' ? config.tts.volcengine.appId : undefined
  })).digest('hex');
  const stages = (stage.job.stages ?? []).filter(candidate => candidate.id !== stage.stageRun.id
    && candidate.stageId === 'tts' && candidate.progress.dubbingResumeKey === key);
  const latest = stages.at(-1);
  const previous = latest && ['failed', 'interrupted'].includes(latest.status) ? latest : undefined;
  const previousOwner = previous?.progress.dubbingCacheOwnerStageRunId;
  const owner = typeof previousOwner === 'string' && stages.some(candidate => candidate.id === previousOwner)
    ? previousOwner : previous?.id ?? stage.stageRun.id;
  stage.reportProgress({ dubbingResumeKey: key, dubbingCacheOwnerStageRunId: owner });
  return join(dirname(stage.workdir), owner, 'dubbing', 'segment-checkpoints');
}
