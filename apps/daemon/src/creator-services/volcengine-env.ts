import type { CreatorServicesConfig } from '@opencreator/protocol';
import {
  loadVolcengineEnvironment,
  type VolcengineEnvironment
} from '../env-local.js';

export type { VolcengineEnvironment };

export function applyVolcengineEnvironmentOverrides(
  config: CreatorServicesConfig,
  env: VolcengineEnvironment = loadVolcengineEnvironment()
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
    if (!next.tts.volcengine.accessToken.trim()) {
      next.tts.volcengine.accessToken = accessToken;
    }
  }

  const asr = next.transcription.volcengine;
  const tts = next.tts.volcengine;
  const asrConfigured = Boolean(asr.appId.trim() && asr.accessToken.trim());
  const ttsConfigured = Boolean(tts.appId.trim() && tts.accessToken.trim());
  if (asrConfigured && shouldPreferVolcengineTranscription(next)) {
    next.transcription.provider = 'volcengine';
  }
  if (ttsConfigured && shouldPreferVolcengineTts(next)) {
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
