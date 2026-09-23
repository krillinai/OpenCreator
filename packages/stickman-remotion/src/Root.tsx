import React from 'react';
import { Composition } from 'remotion';
import { StickmanLandscape, StickmanPortrait } from './StickmanLandscape.js';
import type { StickmanTimelineProps } from './timeline.js';

const defaultProps: StickmanTimelineProps = {
  ratio: '16:9',
  fps: 30,
  width: 1280,
  height: 720,
  totalFrames: 30,
  shots: [],
  captions: []
};

const portraitDefaultProps: StickmanTimelineProps = {
  ...defaultProps,
  ratio: '9:16',
  width: 720,
  height: 1280
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="StickmanLandscape"
      component={StickmanLandscape}
      width={1280}
      height={720}
      fps={30}
      durationInFrames={30}
      defaultProps={defaultProps}
      calculateMetadata={({ props }: { props: StickmanTimelineProps }) => ({
        durationInFrames: props.totalFrames,
        fps: props.fps,
        width: props.width,
        height: props.height
      })}
    />
    <Composition
      id="StickmanPortrait"
      component={StickmanPortrait}
      width={720}
      height={1280}
      fps={30}
      durationInFrames={30}
      defaultProps={portraitDefaultProps}
      calculateMetadata={({ props }: { props: StickmanTimelineProps }) => ({
        durationInFrames: props.totalFrames,
        fps: props.fps,
        width: props.width,
        height: props.height
      })}
    />
  </>
);
