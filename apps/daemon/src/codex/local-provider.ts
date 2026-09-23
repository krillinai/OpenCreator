import { parse } from '@iarna/toml';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type TomlValue = ReturnType<typeof parse>[string];

export type LocalCodexProvider = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export class LocalCodexProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalCodexProviderError';
  }
}

export async function readLocalCodexProvider(input: {
  codexHome: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LocalCodexProvider> {
  const env = input.env ?? process.env;
  const config = await readToml(join(input.codexHome, 'config.toml'));
  const providerId = readString(config.model_provider);
  const providers = readRecord(config.model_providers);
  const provider = providerId.length === 0
    ? undefined
    : readRecord(providers?.[providerId]);
  const baseUrl = readString(provider?.base_url) || readString(config.openai_base_url);
  const model = readString(config.model);
  const providerToken = readString(provider?.experimental_bearer_token);
  const envKey = readString(provider?.env_key);
  const envToken = envKey.length === 0 ? '' : (env[envKey]?.trim() ?? '');
  const auth = await readJson(join(input.codexHome, 'auth.json'));
  const authToken = readString(auth?.OPENAI_API_KEY);
  const apiKey = providerToken || envToken || authToken;

  if (!baseUrl) {
    throw new LocalCodexProviderError('本机 Codex 未配置可用于生图的 Base URL');
  }
  if (!apiKey) {
    throw new LocalCodexProviderError(
      '本机 Codex 当前只有 ChatGPT 登录态，未配置图像接口可用的 API Key'
    );
  }
  return {
    baseUrl,
    apiKey,
    model: imageModel(model)
  };
}

async function readToml(path: string): Promise<Record<string, TomlValue>> {
  try {
    return parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isNotFound(error)) {
      throw new LocalCodexProviderError('未找到本机 Codex 配置');
    }
    throw new LocalCodexProviderError('无法读取本机 Codex 配置');
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return readRecord(value);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    return undefined;
  }
}

function imageModel(textModel: string): string {
  return /^gpt-image-/i.test(textModel) ? textModel : 'gpt-image-1';
}

function readRecord(value: unknown): Record<string, TomlValue> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, TomlValue>
    : undefined;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}
