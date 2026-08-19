import type {
  CodexModelInputModality,
  CodexModelListResponse,
  CodexModelReasoningEffortOption,
  CodexModelResponse,
  ReasoningEffort
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';
import {
  readJsonFromStorage,
  writeJsonToStorage
} from '../storage/browser-storage.js';

type ClientLike = Pick<RuntimeClient, 'get'>;

type StoredModelCatalog = {
  version: 1;
  updatedAt: string;
  catalog: CodexModelListResponse;
};

export type RecentModelConfig = {
  model: string | null;
  reasoning: ReasoningEffort | null;
};

export const MODEL_CATALOG_STORAGE_KEY = 'opencreator.models.catalog.v1';
export const RECENT_MODEL_CONFIG_STORAGE_KEY = 'opencreator.models.recent-config.v1';

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'default',
  'low',
  'medium',
  'high',
  'xhigh'
]);
const INPUT_MODALITIES = new Set<CodexModelInputModality>(['text', 'image']);

export function createModelService(client: ClientLike) {
  return {
    async listModels(): Promise<CodexModelListResponse> {
      const response = parseModelCatalog(await client.get<unknown>('/codex/models'));
      writeCachedModelCatalog(response);
      return response;
    }
  };
}

export function readCachedModelCatalog(): CodexModelListResponse | undefined {
  const stored = readJsonFromStorage<unknown>(MODEL_CATALOG_STORAGE_KEY);
  if (!isRecord(stored) || stored.version !== 1 || typeof stored.updatedAt !== 'string') {
    removeStorageValue(MODEL_CATALOG_STORAGE_KEY);
    return undefined;
  }
  try {
    return parseModelCatalog(stored.catalog);
  } catch {
    removeStorageValue(MODEL_CATALOG_STORAGE_KEY);
    return undefined;
  }
}

export function writeCachedModelCatalog(
  catalog: CodexModelListResponse,
  updatedAt = new Date().toISOString()
): void {
  try {
    writeJsonToStorage<StoredModelCatalog>(MODEL_CATALOG_STORAGE_KEY, {
      version: 1,
      updatedAt,
      catalog
    });
  } catch {
    return;
  }
}

export function readRecentModelConfig(): RecentModelConfig | null {
  const stored = readJsonFromStorage<unknown>(RECENT_MODEL_CONFIG_STORAGE_KEY);
  if (!isRecord(stored) || stored.version !== 1) {
    removeStorageValue(RECENT_MODEL_CONFIG_STORAGE_KEY);
    return null;
  }
  const model = stored.model;
  const reasoning = stored.reasoning;
  if (
    !(
      model === null
      || (typeof model === 'string' && model.trim().length > 0)
    )
    || !(reasoning === null || isReasoningEffort(reasoning))
  ) {
    removeStorageValue(RECENT_MODEL_CONFIG_STORAGE_KEY);
    return null;
  }
  return {
    model,
    reasoning
  };
}

export function writeRecentModelConfig(config: RecentModelConfig): void {
  try {
    writeJsonToStorage(RECENT_MODEL_CONFIG_STORAGE_KEY, {
      version: 1,
      model: config.model,
      reasoning: config.reasoning
    });
  } catch {
    return;
  }
}

function parseModelCatalog(value: unknown): CodexModelListResponse {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw new Error('Runtime returned an invalid model catalog');
  }
  return {
    models: value.models.map(parseModel)
  };
}

function parseModel(value: unknown): CodexModelResponse {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.model !== 'string'
    || value.model.length === 0
    || typeof value.displayName !== 'string'
    || value.displayName.length === 0
    || typeof value.description !== 'string'
    || !Array.isArray(value.supportedReasoningEfforts)
    || !Array.isArray(value.inputModalities)
    || typeof value.isDefault !== 'boolean'
  ) {
    throw new Error('Runtime returned an invalid model');
  }
  const defaultReasoningEffort = value.defaultReasoningEffort;
  if (!(defaultReasoningEffort === null || isReasoningEffort(defaultReasoningEffort))) {
    throw new Error('Runtime returned an invalid default reasoning effort');
  }
  return {
    id: value.id,
    model: value.model,
    displayName: value.displayName,
    description: value.description,
    supportedReasoningEfforts: value.supportedReasoningEfforts.map(
      parseReasoningEffortOption
    ),
    defaultReasoningEffort,
    inputModalities: value.inputModalities.map(parseInputModality),
    isDefault: value.isDefault
  };
}

function parseReasoningEffortOption(
  value: unknown
): CodexModelReasoningEffortOption {
  if (
    !isRecord(value)
    || !isReasoningEffort(value.reasoningEffort)
    || typeof value.description !== 'string'
  ) {
    throw new Error('Runtime returned an invalid reasoning effort');
  }
  return {
    reasoningEffort: value.reasoningEffort,
    description: value.description
  };
}

function parseInputModality(value: unknown): CodexModelInputModality {
  if (
    typeof value !== 'string'
    || !INPUT_MODALITIES.has(value as CodexModelInputModality)
  ) {
    throw new Error('Runtime returned an invalid model input modality');
  }
  return value as CodexModelInputModality;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string'
    && REASONING_EFFORTS.has(value as ReasoningEffort);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function removeStorageValue(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    return;
  }
}
