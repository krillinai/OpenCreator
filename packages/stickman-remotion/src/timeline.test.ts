import { describe, expect, it } from 'vitest';
import { assertTimeline } from './timeline.js';

describe('stickman remotion timeline', () => {
  it('rejects gaps and accepts contiguous shots', () => {
    const base = {
      fps: 30,
      width: 1280 as const,
      height: 720 as const,
      totalFrames: 60,
      shots: [
        { shotId: 'shot-1', startFrame: 0, endFrame: 30, imageArtifactId: 'i1', audioArtifactId: 'a1', motion: 'static' as const, imageSha256: 'a'.repeat(64), audioSha256: 'b'.repeat(64), imagePath: 'a.png', audioPath: 'a.mp3' },
        { shotId: 'shot-2', startFrame: 30, endFrame: 60, imageArtifactId: 'i2', audioArtifactId: 'a1', motion: 'push-in' as const, imageSha256: 'c'.repeat(64), audioSha256: 'b'.repeat(64), imagePath: 'b.png', audioPath: 'a.mp3' }
      ]
    };
    expect(assertTimeline(base)).toBe(base);
    expect(() => assertTimeline({
      ...base,
      shots: [{ ...base.shots[0]!, startFrame: 1 }, base.shots[1]!]
    })).toThrow(/gap_or_overlap/);
  });
});
