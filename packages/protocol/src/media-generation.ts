export const imageGenerationSizes = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type ImageGenerationSize = typeof imageGenerationSizes[number];
export type ImageGenerationQuality = 'low' | 'medium' | 'high';
export type ImageGenerationProvider = 'openai' | 'jimeng' | 'kling' | 'gemini' | 'codex-native';

export const coverStyleIds = [
  'personal-growth',
  'psychology',
  'wealth-platinum-red',
  'bilibili-red-blue-white',
  'custom'
] as const;
export type CoverStyleId = typeof coverStyleIds[number];

export const coverTextLanguages = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR'
] as const;
export type CoverTextLanguage = typeof coverTextLanguages[number];
export type CoverTextLanguagePreference = 'auto' | CoverTextLanguage;

export type CreateImageGenerationRequest = {
  prompt: string;
  provider: ImageGenerationProvider;
  size: ImageGenerationSize;
  quality: ImageGenerationQuality;
  count: number;
};

export type ImageGenerationAsset = {
  index: number;
  fileName: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  size: number;
};

export type ImageGenerationResult = {
  id: string;
  prompt: string;
  provider: ImageGenerationProvider;
  model: string;
  imageSize: ImageGenerationSize;
  quality: ImageGenerationQuality;
  count: number;
  images: ImageGenerationAsset[];
  createdAt: string;
};

export type ImageGenerationResultResponse = {
  result: ImageGenerationResult;
};

export const videoGenerationSizes = ['1280x720', '720x1280', '1024x1024'] as const;
export const videoGenerationDurations = [4, 5, 6, 8, 10] as const;
export type VideoGenerationSize = typeof videoGenerationSizes[number];
export type VideoGenerationDuration = typeof videoGenerationDurations[number];
export type VideoGenerationStatus = 'queued' | 'in_progress' | 'completed' | 'failed';
export type VideoGenerationProvider = 'seedance' | 'kling' | 'veo';

export const videoGenerationModelIds = {
  seedance: [
    'doubao-seedance-2-5-260628',
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-2-0-mini-260615',
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1-0-pro-fast-251015',
    'doubao-seedance-1-0-pro-250528'
  ],
  kling: ['kling-v2-1-master'],
  veo: ['veo-3.1-generate-preview']
} as const;

export const defaultVideoGenerationModels = {
  seedance: videoGenerationModelIds.seedance[0],
  kling: videoGenerationModelIds.kling[0],
  veo: videoGenerationModelIds.veo[0]
} satisfies Record<VideoGenerationProvider, string>;

export type VideoGenerationReferenceImage = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
};

export type CreateVideoGenerationRequest = {
  prompt: string;
  provider: VideoGenerationProvider;
  model?: string;
  size: VideoGenerationSize;
  duration: VideoGenerationDuration;
  referenceImage?: VideoGenerationReferenceImage;
};

export type VideoGenerationResult = {
  id: string;
  prompt: string;
  provider: VideoGenerationProvider;
  model: string;
  videoSize: VideoGenerationSize;
  duration: VideoGenerationDuration;
  status: VideoGenerationStatus;
  progress: number;
  progressKnown?: boolean;
  fileName?: string;
  mime?: 'video/mp4';
  size?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type VideoGenerationResultResponse = {
  result: VideoGenerationResult;
};
