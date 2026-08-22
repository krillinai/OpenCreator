export const imageGenerationSizes = ['1024x1024', '1536x1024', '1024x1536'] as const;
export type ImageGenerationSize = typeof imageGenerationSizes[number];
export type ImageGenerationQuality = 'low' | 'medium' | 'high';
export type ImageGenerationProvider = 'openai' | 'jimeng' | 'kling' | 'gemini';

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

export type VideoGenerationReferenceImage = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
};

export type CreateVideoGenerationRequest = {
  prompt: string;
  provider: VideoGenerationProvider;
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
