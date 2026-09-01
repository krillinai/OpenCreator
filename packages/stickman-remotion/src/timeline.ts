export type StickmanTimelineProps = {
  fps: number;
  width: 1280;
  height: 720;
  totalFrames: number;
  shots: Array<{
    shotId: string;
    startFrame: number;
    endFrame: number;
    imageArtifactId: string;
    audioArtifactId: string;
    motion: 'static' | 'push-in' | 'pan-left' | 'pan-right' | 'zoom-out';
    imageSha256: string;
    audioSha256: string;
    imagePath: string;
    audioPath: string;
  }>;
};

export function assertTimeline(value: StickmanTimelineProps): StickmanTimelineProps {
  if (value.width !== 1280 || value.height !== 720 || value.fps <= 0 || value.totalFrames <= 0) {
    throw new Error('stickman_timeline_invalid');
  }
  let cursor = 0;
  for (const shot of value.shots) {
    if (shot.startFrame !== cursor || shot.endFrame <= shot.startFrame) {
      throw new Error(`stickman_timeline_gap_or_overlap:${shot.shotId}`);
    }
    if (!shot.imagePath || !shot.audioPath) throw new Error(`stickman_timeline_path_missing:${shot.shotId}`);
    cursor = shot.endFrame;
  }
  if (cursor !== value.totalFrames) throw new Error('stickman_timeline_total_mismatch');
  return value;
}
