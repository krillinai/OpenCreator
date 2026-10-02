import { creatorProviderCatalogById } from '@opencreator/protocol';

export const llmProviderOptions = Object.values(creatorProviderCatalogById.llm);

export function inferLlmProviderId(baseUrl: string, model: string): string {
  const normalizedUrl = baseUrl.toLowerCase();
  const normalizedModel = model.toLowerCase();
  if (normalizedModel.includes('hy-mt2')) return 'hy-mt2';
  if (normalizedUrl.includes('deepseek') || normalizedModel.startsWith('deepseek-')) return 'deepseek';
  if (normalizedUrl.includes('minimax') || normalizedModel.startsWith('minimax-')) return 'minimax';
  if (normalizedUrl.includes('openai.com')) return 'openai';
  return 'custom';
}
