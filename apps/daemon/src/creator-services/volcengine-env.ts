import type { CreatorServicesConfig } from '@opencreator/protocol';

export type VolcengineEnvironment = {
  VOLCENGINE_APP_ID?: string;
  VOLCENGINE_ACCESS_TOKEN?: string;
};

export function applyVolcengineEnvironmentOverrides(
  config: CreatorServicesConfig,
  env: VolcengineEnvironment = process.env
): CreatorServicesConfig {
  const appId = env.VOLCENGINE_APP_ID?.trim() ?? '';
  const accessToken = env.VOLCENGINE_ACCESS_TOKEN?.trim() ?? '';
  if (!appId && !accessToken) return config;

  const next = structuredClone(config);
  if (appId) {
    if (!next.transcription.volcengine.appId.trim()) {
      next.transcription.volcengine.appId = appId;
    }
    if (!next.tts.volcengine.appId.trim()) {
      next.tts.volcengine.appId = appId;
    }
  }
  if (accessToken) {
    if (!next.transcription.volcengine.accessToken.trim()) {
      next.transcription.volcengine.accessToken = accessToken;
    }
    if (!next.tts.volcengine.apiKey.trim()) {
      next.tts.volcengine.apiKey = accessToken;
    }
  }

  const configured = next.transcription.volcengine.appId.trim().length > 0
    && next.transcription.volcengine.accessToken.trim().length > 0;
  if (configured && shouldPreferVolcengineTranscription(next)) {
    next.transcription.provider = 'volcengine';
  }
  if (configured && shouldPreferVolcengineTts(next)) {
    next.tts.provider = 'volcengine';
  }
  return next;
}

function shouldPreferVolcengineTranscription(config: CreatorServicesConfig): boolean {
  return config.transcription.provider === 'openai'
    && config.transcription.openai.apiKey.trim().length === 0;
}

function shouldPreferVolcengineTts(config: CreatorServicesConfig): boolean {
  return config.tts.provider === 'openai'
    && config.tts.openai.apiKey.trim().length === 0;
}
