import type {
  CreatorServicesConfig,
  CreatorServicesConfigResponse,
  CreatorServicesCredentialField
} from '@opencreator/protocol';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { z } from 'zod';
import { createPrivateJsonDocumentEntry } from '../config/private-json-file.js';


const boundedString = (maximum: number) => z.string().max(maximum);
const openAiCompatibleSchema = z.object({
  baseUrl: boundedString(2048),
  apiKey: boundedString(4096),
  model: boundedString(128)
}).strict();
const ttsProviderSchema = (defaultVoiceId: string) => openAiCompatibleSchema.extend({
  defaultVoiceId: boundedString(256).default(defaultVoiceId)
}).strict();
const klingAiSchema = z.object({
  baseUrl: boundedString(2048),
  accessKey: boundedString(4096),
  secretKey: boundedString(4096),
  model: boundedString(128)
}).strict();
const aliyunOssSchema = z.object({
  accessKeyId: boundedString(256),
  accessKeySecret: boundedString(4096),
  bucket: boundedString(255)
}).strict();
const aliyunSpeechSchema = z.object({
  accessKeyId: boundedString(256),
  accessKeySecret: boundedString(4096),
  appKey: boundedString(256)
}).strict();
const aliyunSchema = z.object({
  oss: aliyunOssSchema,
  speech: aliyunSpeechSchema
}).strict();
const creatorServicesDefaults = createDefaultCreatorServicesConfig();
const imageConfigDefault = creatorServicesDefaults.image;
const videoConfigDefault = creatorServicesDefaults.video;
const llmConfigSchema = openAiCompatibleSchema.extend({
  jsonMode: z.boolean(),
  source: z.enum(['codex', 'custom']).optional()
}).strict().transform(value => ({
  ...value,
  source: value.source ?? inferLegacyTextModelSource(value)
}));
const imageConfigSchema = z.object({
  provider: z.enum(['openai', 'jimeng', 'kling', 'gemini']),
  openai: openAiCompatibleSchema,
  jimeng: openAiCompatibleSchema,
  kling: klingAiSchema,
  gemini: openAiCompatibleSchema
}).strict();
const legacyImageConfigSchema = z.object({
  provider: z.literal('openai-compatible'),
  openai: openAiCompatibleSchema
}).strict().transform(value => ({
  ...structuredClone(imageConfigDefault),
  provider: 'openai' as const,
  openai: value.openai
}));
const videoConfigSchema = z.object({
  provider: z.enum(['seedance', 'kling', 'veo']),
  seedance: openAiCompatibleSchema,
  kling: klingAiSchema,
  veo: openAiCompatibleSchema
}).strict();
const legacyVideoConfigSchema = z.object({
  provider: z.literal('openai-compatible'),
  openai: openAiCompatibleSchema
}).strict().transform(() => ({
  ...structuredClone(videoConfigDefault),
  provider: 'seedance' as const
}));
const legacyAliyunTtsSchema = aliyunSchema.transform(() => (
  structuredClone(creatorServicesDefaults.tts.aliyun)
));
const ttsConfigSchema = z.object({
  provider: z.enum(['openai', 'aliyun', 'edge-tts', 'minimax']),
  openai: ttsProviderSchema(creatorServicesDefaults.tts.openai.defaultVoiceId),
  minimax: ttsProviderSchema(creatorServicesDefaults.tts.minimax.defaultVoiceId),
  aliyun: z.union([
    ttsProviderSchema(creatorServicesDefaults.tts.aliyun.defaultVoiceId),
    legacyAliyunTtsSchema
  ])
}).strict();

export const creatorServicesConfigSchema = z.object({
  proxy: boundedString(2048),
  llm: llmConfigSchema,
  transcription: z.object({
    provider: z.enum(['openai', 'faster-whisper', 'whisperkit', 'whisper.cpp', 'aliyun']),
    enableGpuAcceleration: z.boolean(),
    openai: openAiCompatibleSchema,
    fasterWhisper: z.object({ model: z.enum(['tiny', 'medium', 'large-v2']) }).strict(),
    whisperKit: z.object({ model: z.literal('large-v2') }).strict(),
    whisperCpp: z.object({ model: z.enum(['tiny', 'medium', 'large-v2']) }).strict(),
    aliyun: aliyunSchema
  }).strict(),
  tts: ttsConfigSchema,
  image: z.union([imageConfigSchema, legacyImageConfigSchema]),
  video: z.union([videoConfigSchema, legacyVideoConfigSchema]).default(videoConfigDefault)
}).strict();

export type CreatorServicesConfigStore = {
  read(): Promise<CreatorServicesConfig>;
  write(config: CreatorServicesConfig): Promise<CreatorServicesConfig>;
  reset(): Promise<CreatorServicesConfig>;
};

export type TextModelFallbackConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

export type CreatorTextModelFallbackProvider = {
  read(): Promise<TextModelFallbackConfig>;
};

type CredentialEntry = {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<unknown>;
};

export class CreatorServicesConfigStoreError extends Error {
  readonly code = 'CREATOR_SERVICES_CONFIG_FILE_UNAVAILABLE';

  constructor(stage: 'read' | 'write' | 'reset' | 'decode') {
    super(`CREATOR_SERVICES_CONFIG_FILE_UNAVAILABLE: creator services ${stage} failed`);
    this.name = 'CreatorServicesConfigStoreError';
  }
}

export function createCreatorServicesConfigStore(
  entry: CredentialEntry
): CreatorServicesConfigStore {
  return {
    async read() {
      let serialized: string | null | undefined;
      try {
        serialized = await entry.getPassword();
      } catch {
        throw new CreatorServicesConfigStoreError('read');
      }
      if (serialized === null || serialized === undefined) {
        return createDefaultCreatorServicesConfig();
      }
      try {
        return parseCreatorServicesConfig(JSON.parse(serialized) as unknown);
      } catch {
        throw new CreatorServicesConfigStoreError('decode');
      }
    },
    async write(config) {
      const normalized = parseCreatorServicesConfig(config);
      try {
        await entry.setPassword(JSON.stringify(normalized));
      } catch {
        throw new CreatorServicesConfigStoreError('write');
      }
      return structuredClone(normalized);
    },
    async reset() {
      try {
        await entry.deletePassword();
      } catch {
        throw new CreatorServicesConfigStoreError('reset');
      }
      return createDefaultCreatorServicesConfig();
    }
  };
}

export function createFileCreatorServicesConfigStore(
  path: string
): CreatorServicesConfigStore {
  return createCreatorServicesConfigStore(createPrivateJsonDocumentEntry(path));
}

export function createCreatorServicesConfigStoreWithTextModelFallback(
  store: CreatorServicesConfigStore,
  fallback: CreatorTextModelFallbackProvider
): CreatorServicesConfigStore {
  return {
    async read() {
      return resolveTextModelFallback(await store.read(), fallback);
    },
    async write(config) {
      const persisted = structuredClone(config);
      if (persisted.llm.source === 'codex') persisted.llm.apiKey = '';
      const saved = await store.write(persisted);
      return resolveTextModelFallback(saved, fallback);
    },
    async reset() {
      return resolveTextModelFallback(await store.reset(), fallback);
    }
  };
}

export function parseCreatorServicesConfig(value: unknown): CreatorServicesConfig {
  return creatorServicesConfigSchema.parse(value) as CreatorServicesConfig;
}

export function presentCreatorServicesConfig(
  config: CreatorServicesConfig
): CreatorServicesConfigResponse {
  const redacted = structuredClone(config);
  const configuredCredentials: CreatorServicesCredentialField[] = [];
  const redact = (field: CreatorServicesCredentialField, value: string, clear: () => void) => {
    if (value.length > 0) configuredCredentials.push(field);
    clear();
  };

  redact('llm.apiKey', redacted.llm.apiKey, () => { redacted.llm.apiKey = ''; });
  redact('transcription.openai.apiKey', redacted.transcription.openai.apiKey, () => {
    redacted.transcription.openai.apiKey = '';
  });
  redactAliyunCredentials('transcription.aliyun', redacted.transcription.aliyun, configuredCredentials);
  redact('tts.openai.apiKey', redacted.tts.openai.apiKey, () => { redacted.tts.openai.apiKey = ''; });
  redact('tts.minimax.apiKey', redacted.tts.minimax.apiKey, () => { redacted.tts.minimax.apiKey = ''; });
  redact('tts.aliyun.apiKey', redacted.tts.aliyun.apiKey, () => { redacted.tts.aliyun.apiKey = ''; });
  redact('image.openai.apiKey', redacted.image.openai.apiKey, () => { redacted.image.openai.apiKey = ''; });
  redact('image.jimeng.apiKey', redacted.image.jimeng.apiKey, () => { redacted.image.jimeng.apiKey = ''; });
  redact('image.kling.accessKey', redacted.image.kling.accessKey, () => { redacted.image.kling.accessKey = ''; });
  redact('image.kling.secretKey', redacted.image.kling.secretKey, () => { redacted.image.kling.secretKey = ''; });
  redact('image.gemini.apiKey', redacted.image.gemini.apiKey, () => { redacted.image.gemini.apiKey = ''; });
  redact('video.seedance.apiKey', redacted.video.seedance.apiKey, () => { redacted.video.seedance.apiKey = ''; });
  redact('video.kling.accessKey', redacted.video.kling.accessKey, () => { redacted.video.kling.accessKey = ''; });
  redact('video.kling.secretKey', redacted.video.kling.secretKey, () => { redacted.video.kling.secretKey = ''; });
  redact('video.veo.apiKey', redacted.video.veo.apiKey, () => { redacted.video.veo.apiKey = ''; });

  return { config: redacted, configuredCredentials };
}

export function retainCreatorServicesCredentials(
  next: CreatorServicesConfig,
  current: CreatorServicesConfig
): CreatorServicesConfig {
  const merged = structuredClone(next);
  retainBlank(() => merged.llm.apiKey, value => { merged.llm.apiKey = value; }, current.llm.apiKey);
  retainBlank(
    () => merged.transcription.openai.apiKey,
    value => { merged.transcription.openai.apiKey = value; },
    current.transcription.openai.apiKey
  );
  retainAliyunCredentials(merged.transcription.aliyun, current.transcription.aliyun);
  retainBlank(() => merged.tts.openai.apiKey, value => { merged.tts.openai.apiKey = value; }, current.tts.openai.apiKey);
  retainBlank(() => merged.tts.minimax.apiKey, value => { merged.tts.minimax.apiKey = value; }, current.tts.minimax.apiKey);
  retainBlank(() => merged.tts.aliyun.apiKey, value => { merged.tts.aliyun.apiKey = value; }, current.tts.aliyun.apiKey);
  retainBlank(() => merged.image.openai.apiKey, value => { merged.image.openai.apiKey = value; }, current.image.openai.apiKey);
  retainBlank(() => merged.image.jimeng.apiKey, value => { merged.image.jimeng.apiKey = value; }, current.image.jimeng.apiKey);
  retainBlank(() => merged.image.kling.accessKey, value => { merged.image.kling.accessKey = value; }, current.image.kling.accessKey);
  retainBlank(() => merged.image.kling.secretKey, value => { merged.image.kling.secretKey = value; }, current.image.kling.secretKey);
  retainBlank(() => merged.image.gemini.apiKey, value => { merged.image.gemini.apiKey = value; }, current.image.gemini.apiKey);
  retainBlank(() => merged.video.seedance.apiKey, value => { merged.video.seedance.apiKey = value; }, current.video.seedance.apiKey);
  retainBlank(() => merged.video.kling.accessKey, value => { merged.video.kling.accessKey = value; }, current.video.kling.accessKey);
  retainBlank(() => merged.video.kling.secretKey, value => { merged.video.kling.secretKey = value; }, current.video.kling.secretKey);
  retainBlank(() => merged.video.veo.apiKey, value => { merged.video.veo.apiKey = value; }, current.video.veo.apiKey);
  return merged;
}

type AliyunCredentials = CreatorServicesConfig['transcription']['aliyun'];

async function resolveTextModelFallback(
  config: CreatorServicesConfig,
  fallback: CreatorTextModelFallbackProvider
): Promise<CreatorServicesConfig> {
  if (config.llm.source === 'custom') return config;
  let resolved: TextModelFallbackConfig;
  try {
    resolved = await fallback.read();
  } catch {
    return config;
  }
  const next = structuredClone(config);
  next.llm.baseUrl = resolved.baseUrl;
  next.llm.model = resolved.model || next.llm.model;
  next.llm.apiKey = resolved.apiKey ?? '';
  return next;
}

function inferLegacyTextModelSource(value: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): 'codex' | 'custom' {
  return (
    value.baseUrl.length > 0
    || value.apiKey.length > 0
    || value.model !== creatorServicesDefaults.llm.model
  )
    ? 'custom'
    : 'codex';
}

function redactAliyunCredentials(
  prefix: 'transcription.aliyun',
  config: AliyunCredentials,
  configured: CreatorServicesCredentialField[]
): void {
  redactAliyunField(prefix, 'oss.accessKeyId', config.oss.accessKeyId, value => {
    config.oss.accessKeyId = value;
  }, configured);
  redactAliyunField(prefix, 'oss.accessKeySecret', config.oss.accessKeySecret, value => {
    config.oss.accessKeySecret = value;
  }, configured);
  redactAliyunField(prefix, 'speech.accessKeyId', config.speech.accessKeyId, value => {
    config.speech.accessKeyId = value;
  }, configured);
  redactAliyunField(prefix, 'speech.accessKeySecret', config.speech.accessKeySecret, value => {
    config.speech.accessKeySecret = value;
  }, configured);
  redactAliyunField(prefix, 'speech.appKey', config.speech.appKey, value => {
    config.speech.appKey = value;
  }, configured);
}

function redactAliyunField(
  prefix: 'transcription.aliyun',
  suffix: 'oss.accessKeyId' | 'oss.accessKeySecret' | 'speech.accessKeyId' | 'speech.accessKeySecret' | 'speech.appKey',
  value: string,
  write: (value: string) => void,
  configured: CreatorServicesCredentialField[]
): void {
  if (value.length > 0) configured.push(`${prefix}.${suffix}` as CreatorServicesCredentialField);
  write('');
}

function retainAliyunCredentials(next: AliyunCredentials, current: AliyunCredentials): void {
  retainBlank(() => next.oss.accessKeyId, value => { next.oss.accessKeyId = value; }, current.oss.accessKeyId);
  retainBlank(() => next.oss.accessKeySecret, value => { next.oss.accessKeySecret = value; }, current.oss.accessKeySecret);
  retainBlank(() => next.speech.accessKeyId, value => { next.speech.accessKeyId = value; }, current.speech.accessKeyId);
  retainBlank(() => next.speech.accessKeySecret, value => { next.speech.accessKeySecret = value; }, current.speech.accessKeySecret);
  retainBlank(() => next.speech.appKey, value => { next.speech.appKey = value; }, current.speech.appKey);
}

function retainBlank(read: () => string, write: (value: string) => void, current: string): void {
  if (read().length === 0) write(current);
}
