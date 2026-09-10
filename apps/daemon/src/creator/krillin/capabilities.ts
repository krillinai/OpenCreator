import type {
  CreatorServicesCapabilitiesResponse,
  CreatorTranscriptionProviderCapability
} from '@opencreator/protocol';

export function createKrillinCreatorServicesCapabilities(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): CreatorServicesCapabilitiesResponse {
  const whisperKitAvailable = platform === 'darwin' && arch === 'arm64';
  const whisperCppAvailable = platform === 'win32' && arch === 'x64';
  return {
    platform,
    arch,
    transcription: {
      providers: [
        cloudProvider('openai', ['whisper-1']),
        localProvider(
          'faster-whisper',
          ['tiny', 'medium', 'large-v2'],
          false,
          true,
          platform === 'win32' || platform === 'linux'
            ? 'installer_unavailable'
            : 'unsupported_platform'
        ),
        localProvider(
          'whisperkit',
          ['large-v2'],
          whisperKitAvailable,
          false,
          whisperKitAvailable ? undefined : 'unsupported_platform'
        ),
        localProvider(
          'whisper.cpp',
          ['tiny', 'medium', 'large-v2'],
          whisperCppAvailable,
          false,
          whisperCppAvailable ? undefined : 'unsupported_platform'
        ),
        cloudProvider('aliyun', [])
      ]
    }
  };
}

function cloudProvider(
  provider: 'openai' | 'aliyun',
  models: string[]
): CreatorTranscriptionProviderCapability {
  return {
    provider,
    kind: 'cloud',
    available: true,
    models,
    gpuAcceleration: false
  };
}

function localProvider(
  provider: 'faster-whisper' | 'whisperkit' | 'whisper.cpp',
  models: string[],
  available: boolean,
  gpuAcceleration: boolean,
  unavailableReason: CreatorTranscriptionProviderCapability['unavailableReason']
): CreatorTranscriptionProviderCapability {
  return {
    provider,
    kind: 'local',
    available,
    models,
    gpuAcceleration,
    ...(unavailableReason === undefined ? {} : { unavailableReason })
  };
}
