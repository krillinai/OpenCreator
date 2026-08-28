export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type CreatorTtsProvider = 'openai' | 'aliyun' | 'edge-tts' | 'minimax';

export type CreatorTtsProviderConfig = OpenAiCompatibleConfig & {
  defaultVoiceId: string;
};

export type CreatorTtsVoice = {
  id: string;
  name: string;
  provider: CreatorTtsProvider;
  language?: string;
  gender?: string;
  scenario?: string;
  kind?: 'builtin' | 'custom' | 'designed';
  supportedModels?: string[];
  recommended?: boolean;
};

export type CreatorTtsVoicesResponse = {
  provider: CreatorTtsProvider;
  model: string;
  voices: CreatorTtsVoice[];
};

export type CreatorTtsPreviewRequest = {
  provider: CreatorTtsProvider;
  model?: string;
  voiceId: string;
  text?: string;
};

export type KlingAiConfig = {
  baseUrl: string;
  accessKey: string;
  secretKey: string;
  model: string;
};

export type AliyunOssConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
};

export type AliyunSpeechConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  appKey: string;
};

export type CreatorTranscriptionProvider =
  | 'openai'
  | 'faster-whisper'
  | 'whisperkit'
  | 'whisper.cpp'
  | 'aliyun';

export type CreatorServicesConfig = {
  proxy: string;
  llm: OpenAiCompatibleConfig & {
    jsonMode: boolean;
    source: 'codex' | 'custom';
  };
  transcription: {
    provider: CreatorTranscriptionProvider;
    enableGpuAcceleration: boolean;
    openai: OpenAiCompatibleConfig;
    fasterWhisper: { model: 'tiny' | 'medium' | 'large-v2' };
    whisperKit: { model: 'large-v2' };
    whisperCpp: { model: 'tiny' | 'medium' | 'large-v2' };
    aliyun: {
      oss: AliyunOssConfig;
      speech: AliyunSpeechConfig;
    };
  };
  tts: {
    provider: CreatorTtsProvider;
    openai: CreatorTtsProviderConfig;
    minimax: CreatorTtsProviderConfig;
    aliyun: CreatorTtsProviderConfig;
  };
  image: {
    provider: 'openai' | 'jimeng' | 'kling' | 'gemini';
    openai: OpenAiCompatibleConfig;
    jimeng: OpenAiCompatibleConfig;
    kling: KlingAiConfig;
    gemini: OpenAiCompatibleConfig;
  };
  video: {
    provider: 'seedance' | 'kling' | 'veo';
    seedance: OpenAiCompatibleConfig;
    kling: KlingAiConfig;
    veo: OpenAiCompatibleConfig;
  };
};

export type CreatorServicesConfigResponse = {
  config: CreatorServicesConfig;
  configuredCredentials: CreatorServicesCredentialField[];
};

export type CreatorTranscriptionProviderCapability = {
  provider: CreatorTranscriptionProvider;
  kind: 'cloud' | 'local';
  available: boolean;
  models: string[];
  gpuAcceleration: boolean;
  unavailableReason?: 'unsupported_platform' | 'installer_unavailable';
};

export type CreatorServicesCapabilitiesResponse = {
  platform: string;
  arch: string;
  transcription: {
    providers: CreatorTranscriptionProviderCapability[];
  };
};

export type CreatorServicesCredentialField =
  | 'llm.apiKey'
  | 'transcription.openai.apiKey'
  | 'transcription.aliyun.oss.accessKeyId'
  | 'transcription.aliyun.oss.accessKeySecret'
  | 'transcription.aliyun.speech.accessKeyId'
  | 'transcription.aliyun.speech.accessKeySecret'
  | 'transcription.aliyun.speech.appKey'
  | 'tts.openai.apiKey'
  | 'tts.minimax.apiKey'
  | 'tts.aliyun.apiKey'
  | 'image.openai.apiKey'
  | 'image.jimeng.apiKey'
  | 'image.kling.accessKey'
  | 'image.kling.secretKey'
  | 'image.gemini.apiKey'
  | 'video.seedance.apiKey'
  | 'video.kling.accessKey'
  | 'video.kling.secretKey'
  | 'video.veo.apiKey';

export function createDefaultCreatorServicesConfig(): CreatorServicesConfig {
  return {
    proxy: '',
    llm: {
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      jsonMode: false,
      source: 'codex'
    },
    transcription: {
      provider: 'openai',
      enableGpuAcceleration: false,
      openai: {
        baseUrl: '',
        apiKey: '',
        model: 'whisper-1'
      },
      fasterWhisper: { model: 'medium' },
      whisperKit: { model: 'large-v2' },
      whisperCpp: { model: 'tiny' },
      aliyun: {
        oss: { accessKeyId: '', accessKeySecret: '', bucket: '' },
        speech: { accessKeyId: '', accessKeySecret: '', appKey: '' }
      }
    },
    tts: {
      provider: 'openai',
      openai: {
        baseUrl: '',
        apiKey: '',
        model: 'gpt-4o-mini-tts',
        defaultVoiceId: 'marin'
      },
      minimax: {
        baseUrl: 'https://api.minimax.io',
        apiKey: '',
        model: 'speech-2.8-hd',
        defaultVoiceId: 'English_Graceful_Lady'
      },
      aliyun: {
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        apiKey: '',
        model: 'qwen3-tts-flash',
        defaultVoiceId: 'Cherry'
      }
    },
    image: {
      provider: 'openai',
      openai: {
        baseUrl: '',
        apiKey: '',
        model: 'gpt-image-1'
      },
      jimeng: {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: '',
        model: 'doubao-seedream-4-0-250828'
      },
      kling: {
        baseUrl: 'https://api-beijing.klingai.com',
        accessKey: '',
        secretKey: '',
        model: 'kling-v2-1'
      },
      gemini: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: '',
        model: 'gemini-2.5-flash-image'
      }
    },
    video: {
      provider: 'seedance',
      seedance: {
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: '',
        model: 'doubao-seedance-1-0-pro-250528'
      },
      kling: {
        baseUrl: 'https://api-beijing.klingai.com',
        accessKey: '',
        secretKey: '',
        model: 'kling-v2-1-master'
      },
      veo: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: '',
        model: 'veo-3.1-generate-preview'
      }
    }
  };
}
