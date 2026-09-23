import { stringify } from '@iarna/toml';
import type { CreatorServicesConfig } from '@opencreator/protocol';

export function createKrillinConfigToml(
  config: CreatorServicesConfig,
  llmOverride?: { baseUrl: string; apiKey: string; model: string }
): string {
  const llm = llmOverride ?? config.llm;
  const document = compact({
    app: { proxy: config.proxy },
    llm: {
      base_url: llm.baseUrl,
      api_key: llm.apiKey,
      model: llm.model,
      json: config.llm.jsonMode
    },
    transcribe: {
      provider: normalizeTranscriptionProvider(config.transcription.provider),
      enable_gpu_acceleration: config.transcription.enableGpuAcceleration,
      openai: openAi(config.transcription.openai),
      fasterwhisper: config.transcription.fasterWhisper,
      whisperkit: config.transcription.whisperKit,
      whispercpp: {
        ...config.transcription.whisperCpp,
        // Preserve the KrillinAI 2.1 compatibility bridge for legacy models,
        // while large-v3-turbo is supported by name end to end.
        model: config.transcription.provider === 'whisper.cpp'
          && config.transcription.whisperCpp.model !== 'large-v3-turbo'
          ? 'large-v2'
          : config.transcription.whisperCpp.model
      },
      aliyun: {
        oss: snakeAliyunOss(config.transcription.aliyun.oss),
        speech: snakeAliyunSpeech(config.transcription.aliyun.speech)
      },
      volcengine: {
        app_id: config.transcription.volcengine.appId,
        access_token: config.transcription.volcengine.accessToken,
        resource_id: config.transcription.volcengine.resourceId,
        base_url: config.transcription.volcengine.baseUrl
      }
    },
    tts: {
      provider: config.tts.provider,
      openai: ttsProvider(config.tts.openai),
      minimax: ttsProvider(config.tts.minimax),
      aliyun: ttsProvider(config.tts.aliyun),
      volcengine: {
        app_id: config.tts.volcengine.appId,
        access_token: config.tts.volcengine.accessToken,
        cluster: config.tts.volcengine.model,
        default_voice_id: config.tts.volcengine.defaultVoiceId,
        base_url: config.tts.volcengine.baseUrl
      }
    },
    image: {
      provider: config.image.provider,
      openai: openAi(config.image.openai)
    }
  });
  return stringify(document as never);
}

function openAi(value: { baseUrl: string; apiKey: string; model: string }) {
  return { base_url: value.baseUrl, api_key: value.apiKey, model: value.model };
}

function ttsProvider(value: { baseUrl: string; apiKey: string; model: string; defaultVoiceId: string }) {
  return {
    ...openAi(value),
    default_voice_id: value.defaultVoiceId
  };
}

function snakeAliyunOss(value: { accessKeyId: string; accessKeySecret: string; bucket: string }) {
  return { access_key_id: value.accessKeyId, access_key_secret: value.accessKeySecret, bucket: value.bucket };
}

function snakeAliyunSpeech(value: { accessKeyId: string; accessKeySecret: string; appKey: string }) {
  return { access_key_id: value.accessKeyId, access_key_secret: value.accessKeySecret, app_key: value.appKey };
}

function normalizeTranscriptionProvider(value: CreatorServicesConfig['transcription']['provider']): string {
  if (value === 'faster-whisper') return 'fasterwhisper';
  if (value === 'whisper.cpp') return 'whispercpp';
  return value;
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== '' && entry !== undefined)
    .map(([key, entry]) => [key, compact(entry)]));
}
