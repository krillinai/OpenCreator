import { describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { applyVolcengineEnvironmentOverrides } from '../../src/creator-services/volcengine-env.js';

describe('volcengine environment overrides', () => {
  it('fills empty volcengine speech credentials and prefers that provider', () => {
    const config = applyVolcengineEnvironmentOverrides(
      createDefaultCreatorServicesConfig(),
      {
        VOLCENGINE_APP_ID: 'env-app-id',
        VOLCENGINE_ACCESS_TOKEN: 'env-access-token'
      }
    );

    expect(config.transcription.provider).toBe('volcengine');
    expect(config.transcription.volcengine.appId).toBe('env-app-id');
    expect(config.transcription.volcengine.accessToken).toBe('env-access-token');
    expect(config.tts.provider).toBe('volcengine');
    expect(config.tts.volcengine.appId).toBe('env-app-id');
    expect(config.tts.volcengine.accessToken).toBe('env-access-token');
  });

  it('selects ASR and TTS independently based on their own credentials', () => {
    const asrOnly = createDefaultCreatorServicesConfig();
    asrOnly.transcription.volcengine.appId = 'asr-app';
    asrOnly.transcription.volcengine.accessToken = 'asr-token';

    const asrConfig = applyVolcengineEnvironmentOverrides(asrOnly, {
      VOLCENGINE_APP_ID: 'env-app-id'
    });
    expect(asrConfig.transcription.provider).toBe('volcengine');
    expect(asrConfig.transcription.volcengine.appId).toBe('asr-app');
    expect(asrConfig.tts.provider).toBe('openai');
    expect(asrConfig.tts.volcengine.appId).toBe('env-app-id');
    expect(asrConfig.tts.volcengine.accessToken).toBe('');

    const ttsOnly = createDefaultCreatorServicesConfig();
    ttsOnly.tts.volcengine.appId = 'tts-app';
    ttsOnly.tts.volcengine.accessToken = 'tts-token';

    const ttsConfig = applyVolcengineEnvironmentOverrides(ttsOnly, {
      VOLCENGINE_APP_ID: 'env-app-id'
    });
    expect(ttsConfig.transcription.provider).toBe('openai');
    expect(ttsConfig.transcription.volcengine.appId).toBe('env-app-id');
    expect(ttsConfig.transcription.volcengine.accessToken).toBe('');
    expect(ttsConfig.tts.provider).toBe('volcengine');
    expect(ttsConfig.tts.volcengine.appId).toBe('tts-app');
  });

  it('does not replace saved credentials or a non-default provider', () => {
    const current = createDefaultCreatorServicesConfig();
    current.transcription.provider = 'aliyun';
    current.transcription.volcengine.appId = 'saved-app-id';
    current.transcription.volcengine.accessToken = 'saved-token';
    current.tts.provider = 'minimax';
    current.tts.volcengine.appId = 'saved-app-id';
    current.tts.volcengine.accessToken = 'saved-token';

    const config = applyVolcengineEnvironmentOverrides(current, {
      VOLCENGINE_APP_ID: 'env-app-id',
      VOLCENGINE_ACCESS_TOKEN: 'env-access-token'
    });

    expect(config.transcription.provider).toBe('aliyun');
    expect(config.transcription.volcengine.appId).toBe('saved-app-id');
    expect(config.transcription.volcengine.accessToken).toBe('saved-token');
    expect(config.tts.provider).toBe('minimax');
    expect(config.tts.volcengine.appId).toBe('saved-app-id');
    expect(config.tts.volcengine.accessToken).toBe('saved-token');
  });
});
