import type { CodexModelListResponse } from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import {
  createModelService,
  MODEL_CATALOG_STORAGE_KEY,
  readCachedModelCatalog,
  readRecentModelConfig,
  RECENT_MODEL_CONFIG_STORAGE_KEY,
  writeRecentModelConfig
} from './model-service-2026-08-05.js';

describe('ModelService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('loads the Runtime Codex model catalog', async () => {
    const catalog = createModelCatalog();
    const get = vi.fn(async (_path: string) => catalog);
    const service = createModelService({
      get<T>(path: string): Promise<T> {
        return get(path) as Promise<T>;
      }
    } satisfies Pick<RuntimeClient, 'get'>);

    await expect(service.listModels()).resolves.toEqual(catalog);
    expect(get).toHaveBeenCalledWith('/codex/models');
    expect(readCachedModelCatalog()).toEqual(catalog);
  });

  it('drops an invalid cached catalog instead of exposing corrupt data', () => {
    window.localStorage.setItem(MODEL_CATALOG_STORAGE_KEY, JSON.stringify({
      version: 1,
      updatedAt: '2026-08-05T08:00:00.000Z',
      catalog: {
        models: [{ id: 'gpt-5.6-sol' }]
      }
    }));

    expect(readCachedModelCatalog()).toBeUndefined();
    expect(window.localStorage.getItem(MODEL_CATALOG_STORAGE_KEY)).toBeNull();
  });

  it('persists and validates the most recently selected model config', () => {
    writeRecentModelConfig({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });

    expect(readRecentModelConfig()).toEqual({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });

    window.localStorage.setItem(RECENT_MODEL_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      model: 'gpt-5.5',
      reasoning: 'future'
    }));
    expect(readRecentModelConfig()).toBeNull();
    expect(window.localStorage.getItem(RECENT_MODEL_CONFIG_STORAGE_KEY)).toBeNull();
  });
});

function createModelCatalog(): CodexModelListResponse {
  return {
    models: [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        description: 'Latest model',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium', description: 'Balanced' },
          { reasoningEffort: 'xhigh', description: 'Deepest' }
        ],
        defaultReasoningEffort: 'medium',
        inputModalities: ['text', 'image'],
        isDefault: true
      }
    ]
  };
}
