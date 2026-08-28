import { stringify } from '@iarna/toml';
import type { CreatorServicesConfig } from '@opencreator/protocol';

export function createKrillinConfigToml(config: CreatorServicesConfig): string {
  const document = compact({
    app: { proxy: config.proxy },
    llm: {
      base_url: config.llm.baseUrl,
      api_key: config.llm.apiKey,
      model: config.llm.model,
      json: config.llm.jsonMode
    },
    transcribe: {
      provider: normalizeTranscriptionProvider(config.transcription.provider),
      enable_gpu_acceleration: config.transcription.enableGpuAcceleration,
      openai: openAi(config.transcription.openai),
      fasterwhisper: config.transcription.fasterWhisper,
      whisperkit: config.transcription.whisperKit,
      whispercpp: config.transcription.whisperCpp,
      aliyun: {
        oss: snakeAliyunOss(config.transcription.aliyun.oss),
        speech: snakeAliyunSpeech(config.transcription.aliyun.speech)
      }
    },
    tts: {
      provider: config.tts.provider,
      openai: ttsProvider(config.tts.openai),
      minimax: ttsProvider(config.tts.minimax),
      aliyun: ttsProvider(config.tts.aliyun)
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
