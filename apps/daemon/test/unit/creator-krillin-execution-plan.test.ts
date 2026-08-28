import { describe, expect, it } from 'vitest';
import {
  createKrillinCliExecutionPlan,
  isYouTubeSource
} from '../../src/creator/krillin/execution-plan.js';

describe('KrillinAI CLI execution plan', () => {
  it('tries platform captions before speech recognition for YouTube', () => {
    const plan = createKrillinCliExecutionPlan(
      'subtitle',
      'https://www.youtube.com/watch?v=demo',
      { captionSource: 'any' }
    );

    expect(plan).toEqual([
      {
        options: { captionSource: 'platform' },
        continueOnErrorCode: 'platform_caption_failed'
      },
      {
        options: { captionSource: 'whisper' }
      }
    ]);
  });

  it('keeps one attempt for local media or forced speech recognition', () => {
    expect(createKrillinCliExecutionPlan(
      'subtitle',
      'local:/tmp/video.mp4',
      { captionSource: 'any' }
    )).toEqual([{
      options: { captionSource: 'any' }
    }]);

    expect(createKrillinCliExecutionPlan(
      'subtitle',
      'https://youtu.be/demo',
      { captionSource: 'whisper' }
    )).toEqual([{
      options: { captionSource: 'whisper' }
    }]);
  });

  it('keeps non-subtitle stages unchanged', () => {
    expect(createKrillinCliExecutionPlan(
      'render-horizontal',
      undefined,
      {}
    )).toEqual([{ options: {} }]);
  });

  it('recognizes supported YouTube hosts without accepting lookalike domains', () => {
    expect(isYouTubeSource('https://youtu.be/demo')).toBe(true);
    expect(isYouTubeSource('https://m.youtube.com/watch?v=demo')).toBe(true);
    expect(isYouTubeSource('https://www.youtube-nocookie.com/embed/demo')).toBe(true);
    expect(isYouTubeSource('https://youtube.com.example.test/watch?v=demo')).toBe(false);
    expect(isYouTubeSource('not-a-url')).toBe(false);
  });
});
