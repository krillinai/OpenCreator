import { describe, expect, it } from 'vitest';
import {
  stickmanCanvasForRatio,
  stickmanImageSizeForRatio,
  stickmanOutputPresetDefaults
} from '../src/stickman.js';

describe('stickman rendering contract', () => {
  it('maps both supported ratios to the canonical canvas', () => {
    expect(stickmanCanvasForRatio('16:9')).toEqual({ ratio: '16:9', width: 1280, height: 720 });
    expect(stickmanCanvasForRatio('9:16')).toEqual({ ratio: '9:16', width: 720, height: 1280 });
  });

  it('maps each ratio to an image generation size', () => {
    expect(stickmanImageSizeForRatio('16:9')).toBe('1536x1024');
    expect(stickmanImageSizeForRatio('9:16')).toBe('1024x1536');
  });

  it('defines a cost-free Shorts preset without changing the landscape default', () => {
    expect(stickmanOutputPresetDefaults('youtube-shorts')).toMatchObject({
      outputPreset: 'youtube-shorts',
      ratio: '9:16',
      targetDurationSeconds: 30,
      targetLanguage: 'en-US',
      ttsProvider: 'edge-tts'
    });
    expect(stickmanOutputPresetDefaults('landscape')).toMatchObject({
      outputPreset: 'landscape',
      ratio: '16:9',
      sourceLanguage: 'auto',
      targetDurationSeconds: 30,
      targetLanguage: 'zh-CN'
    });
  });
});
