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
          ['tiny', 'medium', 'large-v2', 'large-v3-turbo'],
          whisperCppAvailable,
          false,
          whisperCppAvailable ? undefined : 'unsupported_platform',
          {
            tiny: { diskBytes: 77691713 },
            medium: { diskBytes: 1533763059 },
            'large-v2': { diskBytes: 3094623691 },
            'large-v3-turbo': { diskBytes: 1624555275 }
          }
        ),
        cloudProvider('aliyun', []),
        cloudProvider('volcengine', [])
      ]
    }
  };
}

function cloudProvider(
  provider: 'openai' | 'aliyun' | 'volcengine',
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
  unavailableReason: CreatorTranscriptionProviderCapability['unavailableReason'],
  modelDetails?: CreatorTranscriptionProviderCapability['modelDetails']
): CreatorTranscriptionProviderCapability {
  return {
    provider,
    kind: 'local',
    available,
    models,
    gpuAcceleration,
    ...(modelDetails === undefined ? {} : { modelDetails }),
    ...(unavailableReason === undefined ? {} : { unavailableReason })
  };
}
