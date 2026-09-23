export type CreatorProviderKind = 'llm' | 'image' | 'video' | 'tts' | 'transcription';
export type CreatorProviderProtocol = 'openai-compatible' | 'gemini' | 'kling' | 'custom' | 'local';
export type CreatorProviderStatus = 'supported' | 'experimental' | 'planned';
export type CreatorProviderCredential = 'apiKey' | 'accessKey' | 'secretKey' | 'region';

export type CreatorProviderModel = {
  id: string;
  label: string;
  recommended?: boolean;
  capabilities?: readonly string[];
};

export type CreatorProviderCatalogEntry = {
  id: string;
  kind: CreatorProviderKind;
  label: string;
  protocol: CreatorProviderProtocol;
  defaultBaseUrl?: string;
  models: readonly CreatorProviderModel[];
  credentials: readonly CreatorProviderCredential[];
  capabilities?: readonly string[];
  status: CreatorProviderStatus;
};

const entry = (value: CreatorProviderCatalogEntry) => value;

export const creatorProviderCatalog = [
  entry({ id: 'openai', kind: 'llm', label: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', recommended: true }], credentials: ['apiKey'], status: 'supported' }),
  entry({ id: 'deepseek', kind: 'llm', label: 'DeepSeek', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.deepseek.com', models: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', recommended: true }, { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' }, { id: 'deepseek-flash', label: 'DeepSeek Flash' }], credentials: ['apiKey'], status: 'supported' }),
  entry({ id: 'minimax', kind: 'llm', label: 'MiniMax', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.minimax.io', models: [{ id: 'MiniMax-M2.7', label: 'MiniMax M2.7', recommended: true }, { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed' }, { id: 'MiniMax-M2.5', label: 'MiniMax M2.5' }, { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 Highspeed' }], credentials: ['apiKey'], status: 'supported' }),
  entry({ id: 'custom', kind: 'llm', label: 'Custom OpenAI-compatible', protocol: 'custom', models: [], credentials: ['apiKey'], status: 'supported' }),
  entry({ id: 'openai', kind: 'image', label: 'OpenAI', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-image-1', label: 'GPT Image', recommended: true }], credentials: ['apiKey'], capabilities: ['text-to-image', 'image-edit', 'reference-image'], status: 'supported' }),
  entry({ id: 'jimeng', kind: 'image', label: '即梦 / Seedream', protocol: 'openai-compatible', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [{ id: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0', recommended: true }], credentials: ['apiKey'], capabilities: ['text-to-image'], status: 'supported' }),
  entry({ id: 'kling', kind: 'image', label: '可灵 / Kling', protocol: 'kling', defaultBaseUrl: 'https://api-beijing.klingai.com', models: [{ id: 'kling-v2-1', label: 'Kling v2.1', recommended: true }], credentials: ['accessKey', 'secretKey'], capabilities: ['text-to-image'], status: 'supported' }),
  entry({ id: 'gemini', kind: 'image', label: 'Nano Banana / Gemini', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [{ id: 'gemini-2.5-flash-image', label: 'Nano Banana', recommended: true }], credentials: ['apiKey'], capabilities: ['text-to-image', 'reference-image'], status: 'supported' }),
  entry({ id: 'codex-native', kind: 'image', label: 'Local Codex image generation', protocol: 'local', models: [], credentials: [], capabilities: ['text-to-image', 'image-edit', 'reference-image'], status: 'experimental' }),
  entry({ id: 'seedance', kind: 'video', label: 'Seedance', protocol: 'openai-compatible', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [{ id: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', recommended: true }], credentials: ['apiKey'], capabilities: ['text-to-video', 'image-to-video'], status: 'supported' }),
  entry({ id: 'kling-video', kind: 'video', label: '可灵 / Kling', protocol: 'kling', defaultBaseUrl: 'https://api-beijing.klingai.com', models: [{ id: 'kling-v2-1-master', label: 'Kling v2.1 Master', recommended: true }], credentials: ['accessKey', 'secretKey'], capabilities: ['text-to-video', 'image-to-video'], status: 'supported' }),
  entry({ id: 'veo', kind: 'video', label: 'Veo', protocol: 'gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [{ id: 'veo-3.1-generate-preview', label: 'Veo 3.1', recommended: true }], credentials: ['apiKey'], capabilities: ['text-to-video', 'image-to-video'], status: 'supported' }),
  entry({ id: 'openai-tts', kind: 'tts', label: 'OpenAI Voice', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS', recommended: true }], credentials: ['apiKey'], capabilities: ['speech-generation', 'voice-preview'], status: 'supported' }),
  entry({ id: 'minimax-tts', kind: 'tts', label: 'MiniMax Voice', protocol: 'openai-compatible', defaultBaseUrl: 'https://api.minimax.io', models: [{ id: 'speech-2.8-hd', label: 'Speech 2.8 HD', recommended: true }], credentials: ['apiKey'], capabilities: ['speech-generation', 'voice-preview'], status: 'supported' }),
  entry({ id: 'aliyun-tts', kind: 'tts', label: '阿里云 Voice', protocol: 'openai-compatible', defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1', models: [{ id: 'qwen3-tts-flash', label: 'Qwen3 TTS Flash', recommended: true }], credentials: ['apiKey'], capabilities: ['speech-generation', 'voice-preview'], status: 'supported' }),
  entry({ id: 'edge-tts', kind: 'tts', label: 'Edge TTS', protocol: 'custom', models: [], credentials: [], capabilities: ['speech-generation'], status: 'supported' })
] as const;

export const creatorProviderCatalogById = {
  llm: Object.fromEntries(creatorProviderCatalog.filter(item => item.kind === 'llm').map(item => [item.id, item])),
  image: Object.fromEntries(creatorProviderCatalog.filter(item => item.kind === 'image').map(item => [item.id, item]))
} as Record<'llm' | 'image', Record<string, CreatorProviderCatalogEntry>>;

export function creatorProvidersOfKind(kind: CreatorProviderKind): readonly CreatorProviderCatalogEntry[] {
  return creatorProviderCatalog.filter(provider => provider.kind === kind);
}

export function creatorProviderOfKind(
  kind: CreatorProviderKind,
  id: string
): CreatorProviderCatalogEntry | undefined {
  return creatorProviderCatalog.find(provider => provider.kind === kind && provider.id === id);
}
