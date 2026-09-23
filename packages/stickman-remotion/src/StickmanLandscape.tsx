import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame
} from 'remotion';
import { assertTimeline, buildNarrationTrack, motionTransform, type StickmanTimelineProps } from './timeline.js';
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

export const StickmanLandscape: React.FC<StickmanTimelineProps> = props => (
  <StickmanVideo {...props} />
);

export const StickmanPortrait: React.FC<StickmanTimelineProps> = props => (
  <StickmanVideo {...props} />
);

const StickmanVideo: React.FC<StickmanTimelineProps> = props => {
  const timeline = assertTimeline(props);
  const narrationTrack = buildNarrationTrack(timeline);
  return (
    <AbsoluteFill style={{
      backgroundColor: '#f7f7f5',
      fontFamily: '"OpenCreator Noto Sans SC", "OpenCreator Noto Sans", sans-serif'
    }}>
      <style>{localFontFaces}</style>
      {narrationTrack.map(clip => (
        <Sequence
          key={`audio-${clip.shotId}`}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
        >
          <Audio src={fileUrl(clip.audioPath)} />
        </Sequence>
      ))}
      {timeline.shots.map(shot => (
        <Sequence
          key={shot.shotId}
          from={shot.startFrame}
          durationInFrames={shot.endFrame - shot.startFrame}
        >
          <Shot shot={shot} />
        </Sequence>
      ))}
      {timeline.captions.map(caption => (
        <Sequence
          key={`caption-${caption.segmentId}`}
          from={caption.startFrame}
          durationInFrames={caption.endFrame - caption.startFrame}
        >
          <Caption ratio={timeline.ratio} text={caption.text} />
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
  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#ffffff' }}>
      <Img
        src={fileUrl(shot.imagePath)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: motionTransform(shot.motion, progress)
        }}
      />
      <div style={{ position: 'absolute', inset: 24, border: '3px solid rgba(15,23,42,0.12)' }} />
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ ratio: StickmanTimelineProps['ratio']; text: string }> = ({ ratio, text }) => (
  <div style={{
    position: 'absolute',
    left: ratio === '9:16' ? 32 : 48,
    right: ratio === '9:16' ? 32 : 48,
    bottom: ratio === '9:16' ? 112 : 48,
    padding: ratio === '9:16' ? '18px 22px' : '14px 20px',
    borderRadius: ratio === '9:16' ? 18 : 14,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    color: '#ffffff',
    fontSize: ratio === '9:16' ? 46 : 32,
    fontWeight: 700,
    lineHeight: 1.12,
    textAlign: 'center',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  }}>
    {text}
  </div>
);

function fileUrl(path: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}
