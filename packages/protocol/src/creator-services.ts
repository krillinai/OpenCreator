export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
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
    provider: 'openai-compatible';
    openai: OpenAiCompatibleConfig;
  };
  video: {
    provider: 'openai-compatible';
    openai: OpenAiCompatibleConfig;
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
      provider: 'openai-compatible',
      openai: {
        baseUrl: '',
        apiKey: '',
        model: 'gpt-image-1'
      }
    },
    video: {
      provider: 'openai-compatible',
      openai: {
        baseUrl: '',
        apiKey: '',
        model: 'sora-2'
      }
    }
  };
}
