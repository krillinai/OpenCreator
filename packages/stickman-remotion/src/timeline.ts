import {
  stickmanCanvasForRatio,
  type StickmanRatio
} from '@opencreator/protocol';

export type StickmanTimelineProps = {
  ratio: StickmanRatio;
  fps: number;
  width: number;
  height: number;
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
  captions: Array<{
    segmentId: string;
    startFrame: number;
    endFrame: number;
    text: string;
  }>;
};

export function assertTimeline(value: StickmanTimelineProps): StickmanTimelineProps {
  const canvas = stickmanCanvasForRatio(value.ratio);
  if (
    value.width !== canvas.width
    || value.height !== canvas.height
    || value.fps <= 0
    || value.totalFrames <= 0
  ) {
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
  cursor = 0;
  for (const caption of value.captions) {
    if (caption.startFrame !== cursor || caption.endFrame <= caption.startFrame) {
      throw new Error(`stickman_timeline_caption_gap_or_overlap:${caption.segmentId}`);
    }
    if (!caption.text.trim()) throw new Error(`stickman_timeline_caption_empty:${caption.segmentId}`);
    cursor = caption.endFrame;
  }
  if (cursor !== value.totalFrames) throw new Error('stickman_timeline_caption_total_mismatch');
  return value;
}

export function buildNarrationTrack(timeline: StickmanTimelineProps): Array<{
  shotId: string;
  from: number;
  durationInFrames: number;
  audioPath: string;
}> {
  return timeline.shots.map(shot => ({
    shotId: shot.shotId,
    from: shot.startFrame,
    durationInFrames: shot.endFrame - shot.startFrame,
    audioPath: shot.audioPath
  }));
}

export function motionTransform(
  motion: StickmanTimelineProps['shots'][number]['motion'],
  progress: number
): string {
  if (motion === 'push-in') return `scale(${1 + progress * 0.08})`;
  if (motion === 'zoom-out') return `scale(${1.08 - progress * 0.08})`;
  if (motion === 'pan-left') return `scale(1.06) translateX(${3 - progress * 6}%)`;
  if (motion === 'pan-right') return `scale(1.06) translateX(${-3 + progress * 6}%)`;
  return 'scale(1)';
}
