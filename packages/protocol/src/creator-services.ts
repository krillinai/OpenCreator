export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
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

export type CreatorServicesConfig = {
  proxy: string;
  llm: OpenAiCompatibleConfig & {
    jsonMode: boolean;
  };
  transcription: {
    provider: 'openai' | 'faster-whisper' | 'whisperkit' | 'whisper.cpp' | 'aliyun';
    enableGpuAcceleration: boolean;
    openai: OpenAiCompatibleConfig;
    fasterWhisper: { model: 'tiny' | 'medium' | 'large-v2' };
    whisperKit: { model: 'large-v2' };
    whisperCpp: { model: 'large-v2' };
    aliyun: {
      oss: AliyunOssConfig;
      speech: AliyunSpeechConfig;
    };
  };
  tts: {
    provider: 'openai' | 'aliyun' | 'edge-tts' | 'minimax';
    openai: OpenAiCompatibleConfig;
    minimax: OpenAiCompatibleConfig;
    aliyun: {
      oss: AliyunOssConfig;
      speech: AliyunSpeechConfig;
    };
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
};

export function createDefaultCreatorServicesConfig(): CreatorServicesConfig {
  return {
    proxy: '',
    llm: {
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      jsonMode: false
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
      whisperCpp: { model: 'large-v2' },
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
        model: 'gpt-4o-mini-tts'
      },
      minimax: {
        baseUrl: 'https://api.minimax.io',
        apiKey: '',
        model: 'speech-2.8-hd'
      },
      aliyun: {
        oss: { accessKeyId: '', accessKeySecret: '', bucket: '' },
        speech: { accessKeyId: '', accessKeySecret: '', appKey: '' }
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
