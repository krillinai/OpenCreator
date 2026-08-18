import type { CreatorServicesConfig } from '@clawee/protocol';
import { createDefaultCreatorServicesConfig } from '@clawee/protocol';
import { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod';

const SERVICE = 'com.opencreator.ai-services';
const ACCOUNT = 'default';

const boundedString = (maximum: number) => z.string().max(maximum);
const openAiCompatibleSchema = z.object({
  baseUrl: boundedString(2048),
  apiKey: boundedString(4096),
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
const videoConfigDefault = createDefaultCreatorServicesConfig().video;

export const creatorServicesConfigSchema = z.object({
  proxy: boundedString(2048),
  llm: openAiCompatibleSchema.extend({ jsonMode: z.boolean() }).strict(),
  transcription: z.object({
    provider: z.enum(['openai', 'faster-whisper', 'whisperkit', 'whisper.cpp', 'aliyun']),
    enableGpuAcceleration: z.boolean(),
    openai: openAiCompatibleSchema,
    fasterWhisper: z.object({ model: z.enum(['tiny', 'medium', 'large-v2']) }).strict(),
    whisperKit: z.object({ model: z.literal('large-v2') }).strict(),
    whisperCpp: z.object({ model: z.literal('large-v2') }).strict(),
    aliyun: aliyunSchema
  }).strict(),
  tts: z.object({
    provider: z.enum(['openai', 'aliyun', 'edge-tts', 'minimax']),
    openai: openAiCompatibleSchema,
    minimax: openAiCompatibleSchema,
    aliyun: aliyunSchema
  }).strict(),
  image: z.object({
    provider: z.literal('openai-compatible'),
    openai: openAiCompatibleSchema
  }).strict(),
  video: z.object({
    provider: z.literal('openai-compatible'),
    openai: openAiCompatibleSchema
  }).strict().default(videoConfigDefault)
}).strict();

export type CreatorServicesConfigStore = {
  read(): Promise<CreatorServicesConfig>;
  write(config: CreatorServicesConfig): Promise<CreatorServicesConfig>;
  reset(): Promise<CreatorServicesConfig>;
};

type CredentialEntry = {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<unknown>;
};

export class CreatorServicesConfigStoreError extends Error {
  readonly code = 'CREATOR_SERVICES_SECURE_STORAGE_UNAVAILABLE';

  constructor(stage: 'read' | 'write' | 'reset' | 'decode') {
    super(`CREATOR_SERVICES_SECURE_STORAGE_UNAVAILABLE: creator services ${stage} failed`);
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

export function createSystemCreatorServicesConfigStore(): CreatorServicesConfigStore {
  return createCreatorServicesConfigStore(new AsyncEntry(SERVICE, ACCOUNT));
}

export function parseCreatorServicesConfig(value: unknown): CreatorServicesConfig {
  return creatorServicesConfigSchema.parse(value) as CreatorServicesConfig;
}
