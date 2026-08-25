import type { CreatorServicesConfig } from '@opencreator/protocol';
import {
  readKrillinRuntimeManifest,
  requirePackagedProvider,
  verifyKrillinRuntimeManifest
} from './manifest.js';

export function preflightKrillinDependencies(
  resourceRoot: string,
  config: CreatorServicesConfig
) {
  const manifest = readKrillinRuntimeManifest(resourceRoot);
  verifyKrillinRuntimeManifest(resourceRoot, manifest);
  const effectiveConfig = resolveKrillinTranscriptionConfig(config, manifest);
  const { provider, model } = normalizedProvider(effectiveConfig);
  requirePackagedProvider(manifest, provider, model);
  return { manifest, config: effectiveConfig };
}

export function resolveKrillinTranscriptionConfig(
  config: CreatorServicesConfig,
  manifest: ReturnType<typeof readKrillinRuntimeManifest>
): CreatorServicesConfig {
  const selected = normalizedProvider(config);
  if (isLocalProvider(selected.provider)) {
    requirePackagedProvider(manifest, selected.provider, selected.model);
    return config;
  }
  if (hasSelectedCloudCredentials(config)) return config;

  const local = findPackagedLocalProvider(manifest, config);
  if (local === undefined) return config;
  const effective = structuredClone(config);
  if (local.provider === 'fasterwhisper') {
    effective.transcription.provider = 'faster-whisper';
    effective.transcription.fasterWhisper.model = local.model as 'tiny' | 'medium' | 'large-v2';
  } else if (local.provider === 'whispercpp') {
    effective.transcription.provider = 'whisper.cpp';
    effective.transcription.whisperCpp.model = local.model as 'tiny' | 'medium' | 'large-v2';
  } else {
    effective.transcription.provider = 'whisperkit';
  }
  return effective;
}

function normalizedProvider(config: CreatorServicesConfig): { provider: string; model?: string } {
  const provider = config.transcription.provider === 'faster-whisper'
    ? 'fasterwhisper'
    : config.transcription.provider === 'whisper.cpp'
      ? 'whispercpp'
      : config.transcription.provider;
  const model = provider === 'fasterwhisper'
    ? config.transcription.fasterWhisper.model
    : provider === 'whispercpp'
      ? config.transcription.whisperCpp.model
      : provider === 'whisperkit'
        ? config.transcription.whisperKit.model
        : undefined;
  return { provider, model };
}

function isLocalProvider(provider: string): boolean {
  return provider === 'fasterwhisper' || provider === 'whispercpp' || provider === 'whisperkit';
}

function hasSelectedCloudCredentials(config: CreatorServicesConfig): boolean {
  if (config.transcription.provider === 'openai') {
    return config.transcription.openai.apiKey.trim().length > 0;
  }
  if (config.transcription.provider !== 'aliyun') return false;
  return [
    config.transcription.aliyun.oss.accessKeyId,
    config.transcription.aliyun.oss.accessKeySecret,
    config.transcription.aliyun.oss.bucket,
    config.transcription.aliyun.speech.accessKeyId,
    config.transcription.aliyun.speech.accessKeySecret,
    config.transcription.aliyun.speech.appKey
  ].every(value => value.trim().length > 0);
}

function findPackagedLocalProvider(
  manifest: ReturnType<typeof readKrillinRuntimeManifest>,
  config: CreatorServicesConfig
): { provider: 'fasterwhisper' | 'whispercpp' | 'whisperkit'; model: string } | undefined {
  const preferred = [
    { provider: 'fasterwhisper' as const, model: config.transcription.fasterWhisper.model },
    { provider: 'whisperkit' as const, model: config.transcription.whisperKit.model },
    { provider: 'whispercpp' as const, model: config.transcription.whisperCpp.model }
  ];
  for (const candidate of preferred) {
    if (manifest.resources.some(resource => (
      resource.provider === candidate.provider && resource.model === candidate.model
    ))) return candidate;
  }
  const fallback = manifest.resources.find(resource => (
    isLocalProvider(resource.provider ?? '') && typeof resource.model === 'string'
  ));
  if (fallback?.provider === 'fasterwhisper'
    || fallback?.provider === 'whispercpp'
    || fallback?.provider === 'whisperkit') {
    return { provider: fallback.provider, model: fallback.model! };
  }
  return undefined;
}
