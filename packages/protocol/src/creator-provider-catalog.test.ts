import { describe, expect, it } from 'vitest';
import {
  creatorProviderCatalog,
  creatorProviderCatalogById
} from './creator-provider-catalog.js';

describe('creator provider catalog', () => {
  it('provides selectable LLM providers with defaults', () => {
    expect(creatorProviderCatalogById.llm.openai).toMatchObject({
      models: [expect.objectContaining({ id: 'gpt-5.6-sol', recommended: true })]
    });
    expect(creatorProviderCatalogById.llm.deepseek).toMatchObject({
      label: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com',
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'deepseek-v4-pro' }),
        expect.objectContaining({ id: 'deepseek-v4-flash' }),
        expect.objectContaining({ id: 'deepseek-flash' })
      ])
    });
    expect(creatorProviderCatalogById.llm.minimax).toMatchObject({
      label: 'MiniMax',
      defaultBaseUrl: 'https://api.minimax.io',
      models: expect.arrayContaining([
        expect.objectContaining({ id: 'MiniMax-M2.7' }),
        expect.objectContaining({ id: 'MiniMax-M2.7-highspeed' })
      ])
    });
    expect(creatorProviderCatalogById.llm.minimax?.models).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'MiniMax-Text-01' })])
    );
  });

  it('marks only implemented providers as supported', () => {
    expect(creatorProviderCatalog
      .filter(entry => entry.id !== 'codex-native')
      .every(entry => entry.status === 'supported')).toBe(true);
    expect(creatorProviderCatalogById.image.gemini?.status).toBe('supported');
  });

  it('describes Codex native image generation as credential-free and experimental', () => {
    expect(creatorProviderCatalogById.image['codex-native']).toMatchObject({
      label: 'Local Codex image generation',
      protocol: 'local',
      credentials: [],
      capabilities: ['text-to-image', 'image-edit', 'reference-image'],
      status: 'experimental'
    });
  });
});
