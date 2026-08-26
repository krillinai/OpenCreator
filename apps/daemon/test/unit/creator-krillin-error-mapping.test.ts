import { describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { normalizeKrillinFailure } from '../../src/creator/krillin/adapter.js';
import { resolveKrillinTranscriptionConfig } from '../../src/creator/krillin/dependency-preflight.js';

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

describe('KrillinAI transcription provider resolution', () => {
  it('uses a configured transcription API before packaged local Whisper', () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.openai.apiKey = 'configured';
    const resolved = resolveKrillinTranscriptionConfig(config, manifestWithLocal('fasterwhisper', 'medium'));

    expect(resolved.transcription.provider).toBe('openai');
  });

  it('falls back to packaged local Whisper when the selected API is not configured', () => {
    const config = createDefaultCreatorServicesConfig();
    const resolved = resolveKrillinTranscriptionConfig(config, manifestWithLocal('fasterwhisper', 'tiny'));

    expect(resolved).not.toBe(config);
    expect(resolved.transcription.provider).toBe('faster-whisper');
    expect(resolved.transcription.fasterWhisper.model).toBe('tiny');
  });

  it('does not claim a local fallback when the runtime did not package one', () => {
    const config = createDefaultCreatorServicesConfig();
    const resolved = resolveKrillinTranscriptionConfig(config, manifestWithLocal());

    expect(resolved).toBe(config);
    expect(resolved.transcription.provider).toBe('openai');
  });

  it('uses the packaged whisper.cpp model in the effective KrillinAI config', () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.whisperCpp.model = 'large-v2';
    const resolved = resolveKrillinTranscriptionConfig(config, manifestWithLocal('whispercpp', 'tiny'));

    expect(resolved.transcription.provider).toBe('whisper.cpp');
    expect(resolved.transcription.whisperCpp.model).toBe('tiny');
  });

  it('uses packaged WhisperKit on macOS when cloud transcription is not configured', () => {
    const config = createDefaultCreatorServicesConfig();
    const resolved = resolveKrillinTranscriptionConfig(config, manifestWithLocal('whisperkit', 'large-v2'));

    expect(resolved.transcription.provider).toBe('whisperkit');
    expect(resolved.transcription.whisperKit.model).toBe('large-v2');
  });
});

function manifestWithLocal(provider?: string, model?: string) {
  return {
    version: 1,
    platform: process.platform,
    arch: process.arch,
    resources: provider === undefined ? [] : [{
      path: 'models/local/model.bin',
      sha256: 'a'.repeat(64),
      kind: 'model' as const,
      provider,
      model
    }]
  };
}
