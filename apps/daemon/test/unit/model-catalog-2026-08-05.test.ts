import type { CodexModelResponse } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { CodexAppServerRequestClient } from '../../src/codex/app-server-client.js';
import {
  createCodexModelCatalog,
  selectLatestGptModelFamilies
} from '../../src/codex/model-catalog-2026-08-05.js';

describe('Codex model catalog', () => {
  it('keeps every visible variant from the latest two numeric GPT families', () => {
    const models = [
      model('gpt-5.9'),
      model('gpt-5.10-sol'),
      model('gpt-5.10-terra'),
      model('o4-mini'),
      model('gpt-5.8'),
      model('gpt-5.9-luna'),
      model('gpt-5.10-hidden', { hidden: true })
    ];

    expect(
      selectLatestGptModelFamilies(models, 2).map(item => item.model)
    ).toEqual([
      'gpt-5.9',
      'gpt-5.10-sol',
      'gpt-5.10-terra',
      'gpt-5.9-luna'
    ]);
  });

  it('loads every page before applying the rolling family limit', async () => {
    const request = vi.fn(async (_method: string, params: unknown) => {
      const cursor = (params as { cursor?: string }).cursor;
      if (cursor === undefined) {
        return {
          data: [rawModel('gpt-5.5')],
          nextCursor: 'page-2'
        };
      }
      return {
        data: [
          rawModel('gpt-5.6-sol', { isDefault: true }),
          rawModel('gpt-5.4')
        ],
        nextCursor: null
      };
    });
    const close = vi.fn(async () => undefined);
    const catalog = createCodexModelCatalog({
      client: { request, close } as CodexAppServerRequestClient,
      pageLimit: 50
    });

    await expect(catalog.listModels()).resolves.toEqual({
      models: [
        model('gpt-5.5'),
        model('gpt-5.6-sol', { isDefault: true })
      ]
    });
    expect(request).toHaveBeenNthCalledWith(1, 'model/list', { limit: 50 });
    expect(request).toHaveBeenNthCalledWith(2, 'model/list', {
      limit: 50,
      cursor: 'page-2'
    });
    await catalog.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects repeated cursors instead of looping forever', async () => {
    const request = vi.fn(async () => ({
      data: [rawModel('gpt-5.6-sol')],
      nextCursor: 'same'
    }));
    const catalog = createCodexModelCatalog({
      client: {
        request,
        close: async () => undefined
      } as CodexAppServerRequestClient
    });

    await expect(catalog.listModels()).rejects.toThrow(
      'Codex app-server returned a repeated model cursor'
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});

function rawModel(
  name: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    id: name,
    model: name,
    displayName: displayName(name),
    description: `${name} description`,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'future', description: 'Unknown future value' }
    ],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image', 'audio'],
    isDefault: false,
    ...overrides
  };
}

function model(
  name: string,
  overrides: Partial<CodexModelResponse> & { hidden?: boolean } = {}
): CodexModelResponse {
  return {
    id: name,
    model: name,
    displayName: displayName(name),
    description: `${name} description`,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' }
    ],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image'],
    isDefault: false,
    ...overrides
  } as CodexModelResponse;
}

function displayName(name: string): string {
  return name.replace(/^gpt-/, 'GPT-');
}
