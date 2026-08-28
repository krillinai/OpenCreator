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

  it('does not advertise local providers without a controlled installer', () => {
    const capabilities = createKrillinCreatorServicesCapabilities('win32', 'x64');
    const localProviders = capabilities.transcription.providers.filter(
      provider => provider.kind === 'local'
    );

    expect(localProviders.every(provider => !provider.available)).toBe(true);
    expect(localProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'faster-whisper',
        unavailableReason: 'installer_unavailable'
      }),
      expect.objectContaining({
        provider: 'whisper.cpp',
        unavailableReason: 'installer_unavailable'
      }),
      expect.objectContaining({
        provider: 'whisperkit',
        unavailableReason: 'unsupported_platform'
      })
    ]));
  });
});
