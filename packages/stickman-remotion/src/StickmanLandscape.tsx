import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame
} from 'remotion';
import { assertTimeline, type StickmanTimelineProps } from './timeline.js';
import notoSansBold from '../assets/fonts/NotoSans-Bold.woff2';
import notoSansScBold from '../assets/fonts/NotoSansSC-Bold.woff2';

const localFontFaces = `
@font-face {
  font-family: "OpenCreator Noto Sans";
  src: url("${notoSansBold}") format("woff2");
  font-style: normal;
  font-weight: 700;
  font-display: block;
}
@font-face {
  font-family: "OpenCreator Noto Sans SC";
  src: url("${notoSansScBold}") format("woff2");
  font-style: normal;
  font-weight: 700;
  font-display: block;
}
`;

export const StickmanLandscape: React.FC<StickmanTimelineProps> = props => {
  const timeline = assertTimeline(props);
  const audioPath = timeline.shots[0]?.audioPath;
  return (
    <AbsoluteFill style={{
      backgroundColor: '#f7f7f5',
      fontFamily: '"OpenCreator Noto Sans SC", "OpenCreator Noto Sans", sans-serif'
    }}>
      <style>{localFontFaces}</style>
      {audioPath ? <Audio src={fileUrl(audioPath)} /> : null}
      {timeline.shots.map(shot => (
        <Sequence
          key={shot.shotId}
          from={shot.startFrame}
          durationInFrames={shot.endFrame - shot.startFrame}
        >
          <Shot shot={shot} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Shot: React.FC<{ shot: StickmanTimelineProps['shots'][number] }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const duration = shot.endFrame - shot.startFrame;
  const progress = interpolate(frame, [0, Math.max(1, duration - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
  const transform = motionTransform(shot.motion, progress);
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#ffffff' }}>
      <Img
        src={fileUrl(shot.imagePath)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform }}
      />
      <div style={{ position: 'absolute', inset: 24, border: '3px solid rgba(15,23,42,0.12)' }} />
    </AbsoluteFill>
  );
};

function motionTransform(motion: StickmanTimelineProps['shots'][number]['motion'], progress: number): string {
  if (motion === 'push-in') return `scale(${1 + progress * 0.08})`;
  if (motion === 'zoom-out') return `scale(${1.08 - progress * 0.08})`;
  if (motion === 'pan-left') return `scale(1.06) translateX(${3 - progress * 6}%)`;
  if (motion === 'pan-right') return `scale(1.06) translateX(${-3 + progress * 6}%)`;
  return 'scale(1)';
}

function fileUrl(path: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}
