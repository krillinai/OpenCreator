import { describe, expect, it } from 'vitest';
import { videoTranslationArtifactRefsPatch } from '../../src/creator/templates/video-translation-results.js';

describe('video translation result artifact refs', () => {
  it('preserves the sibling video when only one format is rendered', () => {
    expect(videoTranslationArtifactRefsPatch({
      composeVideo: true,
      videoFormat: 'vertical',
      dubbing: false
    }, 'render-vertical')).not.toHaveProperty('horizontal_video');
    expect(videoTranslationArtifactRefsPatch({
      composeVideo: true,
      videoFormat: 'horizontal',
      dubbing: false
    }, 'render-horizontal')).not.toHaveProperty('vertical_video');
  });

  it('clears outputs that are invalidated by settings or an earlier workflow stage', () => {
    expect(videoTranslationArtifactRefsPatch({
      composeVideo: true,
      videoFormat: 'all',
      dubbing: false
    }, 'render-horizontal')).toMatchObject({
      vertical_video: []
    });
    expect(videoTranslationArtifactRefsPatch({
      composeVideo: false,
      videoFormat: 'vertical',
      dubbing: false
    })).toMatchObject({
      horizontal_video: [],
      vertical_video: []
    });
    expect(videoTranslationArtifactRefsPatch({
      composeVideo: true,
      videoFormat: 'vertical',
      dubbing: false
    }, 'subtitle')).toMatchObject({
      horizontal_video: [],
      vertical_video: []
    });
  });
});
