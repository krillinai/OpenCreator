import type { CreatorServicesConfigResponse, CreatorTtsProvider } from '@opencreator/protocol';

const key = 'opencreator.video-translation.pending-composition';
export type TranslationEditorContext = { panel?: 'language' | 'style' | 'voice' | 'output'; time: number; cueId?: number };
export type PendingTranslationComposition = {
  jobId: string; version: number; type: 'video' | 'voice'; returnPath: string;
  status: 'configure' | 'ready'; createdAt: number; editor?: TranslationEditorContext;
};
export function readTranslationContinuation(): PendingTranslationComposition | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as PendingTranslationComposition | null;
    if (!value || typeof value.jobId !== 'string' || !Number.isInteger(value.version)
      || !['video', 'voice'].includes(value.type) || !['configure', 'ready'].includes(value.status)
      || Date.now() - value.createdAt > 24 * 60 * 60 * 1000) return undefined;
    return value;
  } catch { return undefined; }
}
export function saveTranslationContinuation(value: PendingTranslationComposition): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}
export function clearTranslationContinuation(): void { sessionStorage.removeItem(key); }
export function ttsServiceConfigured(response: CreatorServicesConfigResponse, provider: CreatorTtsProvider): boolean {
  if (provider === 'omnivoice' || provider === 'edge-tts') return true;
  const credentials = new Set<string>(response.configuredCredentials);
  if (provider === 'volcengine') return ['appId', 'accessToken'].every(field => (
    credentials.has(`tts.volcengine.${field}`) || Boolean(response.config.tts.volcengine[field as 'appId' | 'accessToken'].trim())
  ));
  return credentials.has(`tts.${provider}.apiKey`) || Boolean(response.config.tts[provider].apiKey.trim());
}
