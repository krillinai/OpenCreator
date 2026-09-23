export const stickmanRatios = ['16:9', '9:16'] as const;
export type StickmanRatio = typeof stickmanRatios[number];

export const stickmanOutputPresets = ['landscape', 'youtube-shorts'] as const;
export type StickmanOutputPreset = typeof stickmanOutputPresets[number];

export type StickmanCanvas = {
  ratio: StickmanRatio;
  width: 1280 | 720;
  height: 720 | 1280;
};

const canvases: Record<StickmanRatio, StickmanCanvas> = {
  '16:9': { ratio: '16:9', width: 1280, height: 720 },
  '9:16': { ratio: '9:16', width: 720, height: 1280 }
};

export function stickmanCanvasForRatio(ratio: StickmanRatio): StickmanCanvas {
  return { ...canvases[ratio] };
}

export function readStickmanRatio(value: unknown): StickmanRatio {
  return value === '9:16' ? '9:16' : '16:9';
}

export type StickmanImageSize = '1536x1024' | '1024x1536';

export function stickmanImageSizeForRatio(ratio: StickmanRatio): StickmanImageSize {
  return ratio === '9:16' ? '1024x1536' : '1536x1024';
}

export type StickmanOutputPresetDefaults = {
  outputPreset: StickmanOutputPreset;
  ratio: StickmanRatio;
  sourceLanguage?: string;
  targetDurationSeconds?: number;
  targetLanguage?: string;
  ttsProvider?: 'edge-tts';
};

export function stickmanOutputPresetDefaults(
  outputPreset: StickmanOutputPreset
): StickmanOutputPresetDefaults {
  if (outputPreset === 'youtube-shorts') {
    return {
      outputPreset,
      ratio: '9:16',
      sourceLanguage: 'auto',
      targetDurationSeconds: 30,
      targetLanguage: 'en-US',
      ttsProvider: 'edge-tts'
    };
  }
  return {
    outputPreset,
    ratio: '16:9',
    sourceLanguage: 'auto',
    targetDurationSeconds: 30,
    targetLanguage: 'zh-CN'
  };
}
