import React from 'react';
import { Composition } from 'remotion';
import { StickmanLandscape } from './StickmanLandscape.js';
import type { StickmanTimelineProps } from './timeline.js';

const defaultProps: StickmanTimelineProps = {
  fps: 30,
  width: 1280,
  height: 720,
  totalFrames: 30,
  shots: []
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="StickmanLandscape"
    component={StickmanLandscape}
    width={1280}
    height={720}
    fps={30}
    durationInFrames={30}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.totalFrames,
      fps: props.fps,
      width: props.width,
      height: props.height
    })}
  />
);
