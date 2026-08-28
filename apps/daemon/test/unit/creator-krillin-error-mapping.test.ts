import { describe, expect, it } from 'vitest';
import { normalizeKrillinFailure } from '../../src/creator/krillin/adapter.js';

describe('KrillinAI error mapping', () => {
  it('maps generic CLI usage errors to actionable creator configuration codes', () => {
    expect(normalizeKrillinFailure({
      code: 'usage',
      message: '使用OpenAI转录服务需要配置 OpenAI API Key'
    })).toEqual({
      code: 'creator_transcription_config_missing',
      message: '使用OpenAI转录服务需要配置 OpenAI API Key'
    });

    expect(normalizeKrillinFailure({
      code: 'usage',
      message: 'TTS 服务配置不完整'
    }).code).toBe('creator_tts_config_missing');
  });

  it('maps a deferred transcription failure after platform caption fallback', () => {
    expect(normalizeKrillinFailure({
      code: 'audio_transcription_failed',
      message: '使用OpenAI转录服务需要配置 OpenAI API Key'
    }).code).toBe('creator_transcription_config_missing');
  });
});
