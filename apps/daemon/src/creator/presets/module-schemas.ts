import {
  coverStyleIds,
  coverTextLanguages,
  creatorRuntimeWorkspaces,
  imageGenerationSizes,
  videoGenerationDurations,
  videoGenerationModelIds,
  videoGenerationSizes,
  type CreatorJson,
  type CreatorPresetRequirements,
  type CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import { z } from 'zod';
import type { CreatorPresetModuleDefinition } from './types.js';

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const promptSchema = z.string().max(4000);
const shortTextSchema = z.string().max(256);

export const creatorSubtitleStyleSchema = z.object({
  fontPreset: z.enum(['system', 'sans', 'serif', 'rounded']).default('sans'),
  fontWeight: z.enum(['regular', 'medium', 'bold']).default('bold'),
  fontSize: z.enum(['small', 'medium', 'large']).default('medium'),
  primaryColor: colorSchema.default('#FFFFFF'),
  secondaryColor: colorSchema.default('#D1D5DB'),
  outlineColor: colorSchema.default('#000000'),
  outlineWidth: z.number().min(0).max(8).default(2.5),
  shadow: z.object({
    enabled: z.boolean().default(true),
    color: colorSchema.default('#000000'),
    opacity: z.number().min(0).max(1).default(0.6),
    offsetX: z.number().min(-20).max(20).default(1.5),
    offsetY: z.number().min(-20).max(20).default(1.5),
    blur: z.number().min(0).max(10).default(0.5)
  }).strict().default({})
}).strict().default({});

const videoTranslationDefaultsSchema = z.object({
  sourceLanguage: z.string().min(2).max(32).default('en'),
  targetLanguage: z.string().min(2).max(32).default('zh_cn'),
  preferPlatformCaptions: z.boolean().default(true),
  bilingual: z.boolean().default(true),
  subtitlePosition: z.enum(['top', 'bottom']).default('top'),
  subtitleStyle: creatorSubtitleStyleSchema,
  dubbing: z.boolean().default(false),
  voiceCode: shortTextSchema.default(''),
  voiceName: shortTextSchema.default(''),
  composeVideo: z.boolean().default(false),
  videoFormat: z.enum(['horizontal', 'vertical', 'all']).default('horizontal'),
  verticalTitle: z.string().max(80).default(''),
  verticalSubtitle: z.string().max(140).default('')
}).strict().refine(
  value => value.sourceLanguage !== value.targetLanguage,
  { message: 'sourceLanguage and targetLanguage must differ', path: ['targetLanguage'] }
);

const videoTranslationLocaleSchema = z.object({
  sourceLanguage: z.string().min(2).max(32).optional(),
  targetLanguage: z.string().min(2).max(32).optional(),
  verticalTitle: z.string().max(80).optional(),
  verticalSubtitle: z.string().max(140).optional()
}).strict();

const videoDownloadDefaultsSchema = z.object({
  mediaType: z.enum(['video', 'audio']).default('video')
}).strict();

const imageGenerationDefaultsSchema = z.object({
  prompt: promptSchema.default(''),
  size: z.enum(imageGenerationSizes).default('1024x1024'),
  quality: z.enum(['low', 'medium', 'high']).default('medium'),
  candidateCount: z.number().int().min(1).max(4).default(2)
}).strict();

const imageGenerationLocaleSchema = z.object({
  prompt: promptSchema.optional()
}).strict();

const videoGenerationDefaultsSchema = z.object({
  prompt: promptSchema.default(''),
  size: z.enum(videoGenerationSizes).default('1280x720'),
  duration: z.union(videoGenerationDurations.map(value => z.literal(value)) as [
    z.ZodLiteral<4>,
    z.ZodLiteral<5>,
    ...z.ZodLiteral<6 | 8 | 10>[]
  ]).default(5)
}).strict();

const videoGenerationLocaleSchema = z.object({
  prompt: promptSchema.optional()
}).strict();

const coverGeneratorDefaultsSchema = z.object({
  prompt: promptSchema.default(''),
  coverStyle: z.enum(coverStyleIds).default('bilibili-red-blue-white'),
  coverTextLanguage: z.enum(['auto', ...coverTextLanguages]).default('auto'),
  customStylePrompt: z.string().max(1000).default(''),
  coverHeadline: z.string().max(80).default(''),
  coverSubheadline: z.string().max(140).default(''),
  ratio: z.enum(['16:9', '1:1', '9:16']).default('16:9'),
  candidateCount: z.number().int().min(1).max(4).default(2),
  quality: z.enum(['low', 'medium', 'high']).default('medium')
}).strict();

const coverGeneratorLocaleSchema = z.object({
  prompt: promptSchema.optional(),
  coverTextLanguage: z.enum(['auto', ...coverTextLanguages]).optional(),
  customStylePrompt: z.string().max(1000).optional(),
  coverHeadline: z.string().max(80).optional(),
  coverSubheadline: z.string().max(140).optional()
}).strict();

const smartDubbingDefaultsSchema = z.object({
  text: z.string().max(5000).default(''),
  voiceCode: shortTextSchema.default(''),
  voiceName: shortTextSchema.default(''),
  style: z.enum(['natural', 'professional', 'warm', 'energetic', 'calm', 'storytelling']).default('natural'),
  speed: z.number().min(0.75).max(1.25).default(1),
  format: z.enum(['mp3', 'wav']).default('mp3')
}).strict();

const smartDubbingLocaleSchema = z.object({
  text: z.string().max(5000).optional()
}).strict();

const emptyLocaleSchema = z.object({}).strict();

const bindingByModule: Record<CreatorRuntimeWorkspace, { id: string; version: number }> = {
  'video-translation': { id: 'video-translation', version: 2 },
  'video-download': { id: 'video-download', version: 2 },
  'image-generation': { id: 'image-generation', version: 2 },
  'video-generation': { id: 'video-generation', version: 1 },
  'cover-generator': { id: 'cover', version: 2 },
  'smart-dubbing': { id: 'smart-dubbing', version: 1 }
};

export const creatorPresetModuleDefinitions: readonly CreatorPresetModuleDefinition[] = [
  createDefinition('video-translation', videoTranslationDefaultsSchema, videoTranslationLocaleSchema),
  createDefinition('video-download', videoDownloadDefaultsSchema, emptyLocaleSchema),
  createDefinition('image-generation', imageGenerationDefaultsSchema, imageGenerationLocaleSchema),
  createDefinition('video-generation', videoGenerationDefaultsSchema, videoGenerationLocaleSchema),
  createDefinition('cover-generator', coverGeneratorDefaultsSchema, coverGeneratorLocaleSchema, state => ({
    ...state,
    sourceType: 'prompt'
  })),
  createDefinition('smart-dubbing', smartDubbingDefaultsSchema, smartDubbingLocaleSchema)
];

export function getCreatorPresetModuleDefinition(
  module: CreatorRuntimeWorkspace,
  definitions: readonly CreatorPresetModuleDefinition[] = creatorPresetModuleDefinitions
): CreatorPresetModuleDefinition {
  const definition = definitions.find(candidate => candidate.module === module);
  if (definition === undefined) {
    throw new Error(`Unknown creator preset module: ${module}`);
  }
  return definition;
}

function createDefinition(
  module: CreatorRuntimeWorkspace,
  defaultsSchema: z.ZodType<Record<string, CreatorJson>>,
  localeDefaultsSchema: z.ZodType<Record<string, CreatorJson>>,
  applyFixedFields: (state: Record<string, CreatorJson>) => Record<string, CreatorJson> = state => state
): CreatorPresetModuleDefinition {
  return {
    module,
    runtimeTemplate: bindingByModule[module],
    defaultsSchema,
    localeDefaultsSchema,
    validateRequirement: requirement => validateModuleRequirement(module, requirement),
    applyFixedFields
  };
}

function validateModuleRequirement(
  module: CreatorRuntimeWorkspace,
  requirement: CreatorPresetRequirements | undefined
): void {
  if (requirement === undefined) return;
  if (module === 'image-generation' || module === 'cover-generator') {
    if (requirement.service !== 'image') {
      throw new Error(`${module}: requirement service must be image`);
    }
    if (!['openai', 'jimeng', 'kling', 'gemini'].includes(requirement.provider)) {
      throw new Error(`${module}: unsupported image provider ${requirement.provider}`);
    }
    if (requirement.model !== undefined) {
      throw new Error(`${module}: image requirements cannot select a model`);
    }
    return;
  }
  if (module === 'video-generation') {
    if (requirement.service !== 'video') {
      throw new Error(`${module}: requirement service must be video`);
    }
    const models = videoGenerationModelIds[
      requirement.provider as keyof typeof videoGenerationModelIds
    ] as readonly string[] | undefined;
    if (models === undefined || requirement.model === undefined || !models.includes(requirement.model)) {
      throw new Error(`${module}: unsupported video provider or model`);
    }
    return;
  }
  if (module === 'smart-dubbing' || module === 'video-translation') {
    if (requirement.service !== 'tts') {
      throw new Error(`${module}: requirement service must be tts`);
    }
    if (!['openai', 'aliyun', 'minimax'].includes(requirement.provider)) {
      throw new Error(`${module}: unsupported tts provider ${requirement.provider}`);
    }
    return;
  }
  throw new Error(`${module}: requirements are not supported`);
}

export function isCreatorPresetModule(value: string): value is CreatorRuntimeWorkspace {
  return (creatorRuntimeWorkspaces as readonly string[]).includes(value);
}
