import { describe, expect, it } from 'vitest';
import {
  createKrillinCliExecutionPlan,
  isYouTubeSource
} from '../../src/creator/krillin/execution-plan.js';

describe('KrillinAI CLI execution plan', () => {
  it('delegates platform-caption fallback to KrillinAI in one attempt', () => {
    const plan = createKrillinCliExecutionPlan(
      'subtitle',
      { captionSource: 'any' }
    );

    expect(plan).toEqual([{ options: { captionSource: 'any' } }]);
  });

  it('defaults subtitles to KrillinAI any-source mode', () => {
    expect(createKrillinCliExecutionPlan(
      'subtitle',
      {}
    )).toEqual([{
      options: { captionSource: 'any' }
    }]);

    expect(createKrillinCliExecutionPlan(
      'subtitle',
      { captionSource: 'whisper' }
    )).toEqual([{
      options: { captionSource: 'whisper' }
    }]);
  });

  it('keeps non-subtitle stages unchanged', () => {
    expect(createKrillinCliExecutionPlan(
      'render-horizontal',
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
