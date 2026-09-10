import { describe, expect, it } from 'vitest';
import { createKrillinCreatorServicesCapabilities } from '../../src/creator/krillin/capabilities.js';

describe('KrillinAI transcription capabilities', () => {
  it('offers WhisperKit only on Apple Silicon macOS', () => {
    const capabilities = createKrillinCreatorServicesCapabilities('darwin', 'arm64');

    expect(capabilities.transcription.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'whisperkit',
        kind: 'local',
        available: true,
        models: ['large-v2']
      }),
      expect.objectContaining({
        provider: 'faster-whisper',
        available: false
      }),
      expect.objectContaining({
        provider: 'whisper.cpp',
        available: false
      })
    ]));
  });

  it('offers Whisper.cpp on Windows x64 while keeping unsupported local providers disabled', () => {
    const capabilities = createKrillinCreatorServicesCapabilities('win32', 'x64');
    const localProviders = capabilities.transcription.providers.filter(
      provider => provider.kind === 'local'
    );

    expect(localProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'faster-whisper',
        available: false,
        unavailableReason: 'installer_unavailable'
      }),
      expect.objectContaining({
        provider: 'whisper.cpp',
        available: true,
        models: ['tiny', 'medium', 'large-v2']
      }),
      expect.objectContaining({
        provider: 'whisperkit',
        available: false,
        unavailableReason: 'unsupported_platform'
      })
    ]));
  });

  it('keeps Whisper.cpp unavailable on unsupported Windows architectures', () => {
    const provider = createKrillinCreatorServicesCapabilities('win32', 'arm64')
      .transcription.providers.find(candidate => candidate.provider === 'whisper.cpp');

    expect(provider).toMatchObject({
      available: false,
      unavailableReason: 'unsupported_platform'
    });
  });
});
