import type {
  CreatorJob,
  CreatorJson,
  CreatorPresetRequirements,
  CreatorRuntimeWorkspace,
  CreatorServicesConfig
} from '@opencreator/protocol';
import { creatorProviderOfKind } from '@opencreator/protocol';
import { imageProviderConfigured } from '../image-settings.js';
import { videoGenerationModelIds } from '@opencreator/protocol';
import { CreatorExecutorError } from '../executor.js';
import type { CreatorPresetModuleDefinition, CreatorPresetLocale } from './types.js';

export function mergeCreatorPresetState(input: {
  definition: CreatorPresetModuleDefinition;
  defaults: Record<string, CreatorJson>;
  defaultsByLocale?: Partial<Record<CreatorPresetLocale, Record<string, CreatorJson>>>;
  locale: CreatorPresetLocale;
  requirement?: CreatorPresetRequirements;
  services: CreatorServicesConfig;
}): Record<string, CreatorJson> {
  const base = input.definition.defaultsSchema.parse(input.defaults);
  const localized = input.definition.localeDefaultsSchema.parse(
    input.defaultsByLocale?.[input.locale] ?? {}
  );
  const merged = deepMerge(base, localized);
  const requirementPatch = resolveCreatorPresetRequirement({
    module: input.definition.module,
    requirement: input.requirement,
    services: input.services
  });
  return input.definition.applyFixedFields(deepMerge(merged, requirementPatch));
}

export function resolveCreatorPresetRequirement(input: {
  module: CreatorRuntimeWorkspace;
  requirement?: CreatorPresetRequirements;
  services: CreatorServicesConfig;
}): Record<string, CreatorJson> {
  if (input.module === 'image-generation' || input.module === 'cover-generator') {
    return { provider: input.services.image.provider };
  }
  if (input.module === 'video-generation') {
    const provider = input.services.video.provider;
    const providerConfig = input.services.video[
      provider as keyof CreatorServicesConfig['video']
    ];
    const configuredModel = (
      providerConfig !== null
      && typeof providerConfig === 'object'
      && 'model' in providerConfig
      && typeof providerConfig.model === 'string'
    ) ? providerConfig.model : '';
    return {
      provider,
      model: configuredModel
    };
  }
  if (input.module === 'smart-dubbing' || input.module === 'video-translation') {
    const provider = input.services.tts.provider;
    const providerConfig = input.services.tts[
      provider as keyof CreatorServicesConfig['tts']
    ];
    if (providerConfig === undefined || typeof providerConfig === 'string') {
      return { ttsProvider: provider };
    }
    return {
      ttsProvider: provider,
      ttsModel: providerConfig.model,
      voiceCode: providerConfig.defaultVoiceId,
      voiceName: providerConfig.defaultVoiceId
    };
  }
  return {};
}

export function deepMergeCreatorJson(
  base: Record<string, CreatorJson>,
  patch: Record<string, CreatorJson>
): Record<string, CreatorJson> {
  return deepMerge(base, patch);
}

export function assertCreatorPresetStageRequirement(input: {
  job: CreatorJob;
  stageId: string;
  services: CreatorServicesConfig;
}): void {
  if (input.job.presetOrigin == null) return;
  const service = requiredServiceForStage(input.job, input.stageId);
  if (service === undefined) return;
  const capabilities = readRequirementCapabilities(input.job, service);
  if (service === 'image') {
    const provider = requiredProvider(service, input.job.state.provider);
    if (!hasImageCredentials(input.services, provider)) {
      missingRequirement(service, provider);
    }
    assertProviderCapabilities(service, provider, capabilities);
    return;
  }
  if (service === 'video') {
    const provider = requiredProvider(service, input.job.state.provider);
    const model = readString(input.job.state.model);
    const allowedModels = videoGenerationModelIds[
      provider as keyof typeof videoGenerationModelIds
    ] as readonly string[] | undefined;
    if (
      !hasVideoCredentials(input.services, provider)
      || model === undefined
      || allowedModels === undefined
      || !allowedModels.includes(model)
    ) {
      missingRequirement(service, provider, model);
    }
    assertProviderCapabilities(service, provider, capabilities);
    return;
  }
  const provider = requiredProvider(service, input.job.state.ttsProvider);
  const model = readString(input.job.state.ttsModel);
  if (
    !hasTtsCredentials(input.services, provider)
    || model === undefined
  ) {
    missingRequirement(service, provider, model);
  }
  assertProviderCapabilities(service, provider, capabilities);
}

function deepMerge(
  base: Record<string, CreatorJson>,
  patch: Record<string, CreatorJson>
): Record<string, CreatorJson> {
  const result: Record<string, CreatorJson> = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isRecord(current) && isRecord(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = structuredClone(value);
    }
  }
  return result;
}

function isRecord(value: CreatorJson | undefined): value is Record<string, CreatorJson> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

function requiredServiceForStage(
  job: CreatorJob,
  stageId: string
): CreatorPresetRequirements['service'] | undefined {
  if (
    stageId === 'generate'
    && (job.templateId === 'image-generation' || job.templateId === 'cover')
  ) {
    return 'image';
  }
  if (stageId === 'generate' && job.templateId === 'video-generation') {
    return 'video';
  }
  if (
    stageId === 'tts'
    && (
      job.templateId === 'smart-dubbing'
      || (job.templateId === 'video-translation' && job.state.dubbing === true)
    )
  ) {
    return 'tts';
  }
  return undefined;
}

function readRequirementCapabilities(
  job: CreatorJob,
  service: CreatorPresetRequirements['service']
): string[] {
  const details = job.activities.find(activity => activity.action === 'create-job')?.details;
  if (details?.requirementService !== service || !Array.isArray(details.requirementCapabilities)) {
    return [];
  }
  return details.requirementCapabilities.filter(value => typeof value === 'string');
}

function requiredProvider(
  service: CreatorPresetRequirements['service'],
  value: CreatorJson | undefined
): string {
  const provider = readString(value);
  if (provider === undefined) missingRequirement(service, 'unknown');
  return provider;
}

function assertProviderCapabilities(
  service: CreatorPresetRequirements['service'],
  provider: string,
  required: readonly string[]
): void {
  const catalogId = service === 'video' && provider === 'kling'
    ? 'kling-video'
    : service === 'tts' ? `${provider}-tts` : provider;
  const entry = creatorProviderOfKind(service, catalogId);
  const supported = new Set(entry?.capabilities ?? []);
  const missing = required.find(capability => !supported.has(capability));
  if (missing !== undefined) {
    throw new CreatorExecutorError(
      'creator_preset_requirement_missing',
      `The selected ${service} provider does not support the required capability: ${missing}`,
      { service, provider, capability: missing }
    );
  }
}

function readString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hasImageCredentials(
  services: CreatorServicesConfig,
  provider: string
): boolean {
  if (
    provider !== 'openai'
    && provider !== 'jimeng'
    && provider !== 'kling'
    && provider !== 'gemini'
    && provider !== 'codex-native'
  ) return false;
  return imageProviderConfigured(services, provider);
}

function hasVideoCredentials(
  services: CreatorServicesConfig,
  provider: string
): boolean {
  if (provider === 'kling') {
    return services.video.kling.accessKey.trim() !== ''
      && services.video.kling.secretKey.trim() !== '';
  }
  if (provider === 'seedance' || provider === 'veo') {
    return services.video[provider].apiKey.trim() !== '';
  }
  return false;
}

function hasTtsCredentials(
  services: CreatorServicesConfig,
  provider: string
): boolean {
  return (provider === 'openai' || provider === 'aliyun' || provider === 'minimax')
    && services.tts[provider].apiKey.trim() !== '';
}

function missingRequirement(
  service: CreatorPresetRequirements['service'],
  provider: string,
  model?: string
): never {
  throw new CreatorExecutorError(
    'creator_preset_requirement_missing',
    `Configure the required ${service} provider before running this preset: `
      + `${provider}${model === undefined ? '' : ` / ${model}`}`,
    { service, provider, ...(model === undefined ? {} : { model }) }
  );
}
