import { describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import {
  latestArtifactForResultVersion,
  resultVersionsFromArtifacts
} from './VideoTranslationWorkspace.js';

describe('video translation result artifact selection', () => {
  it('keeps each real render as its own user-visible result version', () => {
    const subtitle = artifact({ id: 'subtitle-v1', kind: 'target_subtitle', version: 1 });
    const oldVideo = artifact({
      id: 'video-v1',
      kind: 'horizontal_video',
      version: 1,
      sourceArtifactIds: ['subtitle-v1']
    });
    const latestVideo = artifact({
      id: 'video-v5',
      kind: 'horizontal_video',
      version: 5,
      sourceArtifactIds: ['subtitle-v1']
    });

    expect(latestArtifactForResultVersion(
      [subtitle, oldVideo, latestVideo],
      1,
      ['horizontal_video']
    )?.id).toBe('video-v1');
    expect(latestArtifactForResultVersion(
      [subtitle, oldVideo, latestVideo],
      5,
      ['horizontal_video']
    )?.id).toBe('video-v5');
    expect(latestArtifactForResultVersion(
      [subtitle, oldVideo, latestVideo],
      5,
      ['target_subtitle']
    )?.id).toBe('subtitle-v1');
  });

  it('uses the subtitle dependency attached to the selected render version', () => {
    const subtitleV1 = artifact({ id: 'subtitle-v1', kind: 'target_subtitle', version: 1 });
    const subtitleV2 = artifact({ id: 'subtitle-v2', kind: 'target_subtitle', version: 2 });
    const videoV1 = artifact({
      id: 'video-v4',
      kind: 'horizontal_video',
      version: 4,
      sourceArtifactIds: ['subtitle-v1']
    });
    const videoV2 = artifact({
      id: 'video-v5',
      kind: 'horizontal_video',
      version: 5,
      sourceArtifactIds: ['subtitle-v2']
    });

    expect(latestArtifactForResultVersion(
      [subtitleV1, subtitleV2, videoV1, videoV2],
      5,
      ['target_subtitle']
    )?.id).toBe('subtitle-v2');
  });

  it('builds V1 through V4 from four completed renders that reuse one subtitle', () => {
    const subtitle = artifact({
      id: 'subtitle-v1',
      kind: 'target_subtitle',
      version: 1,
      metadata: {
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '你好' }]
      }
    });
    const renders = [1, 2, 3, 4].map(version => artifact({
      id: `video-v${version}`,
      kind: 'horizontal_video',
      version,
      sourceArtifactIds: ['subtitle-v1']
    }));

    const versions = resultVersionsFromArtifacts([subtitle, ...renders], fallbackState());

    expect(versions.map(version => version.value)).toEqual([1, 2, 3, 4]);
    expect(versions[3]).toMatchObject({
      value: 4,
      description: '成片版本 V4',
      settings: { composeVideo: true, videoFormat: 'horizontal' },
      subtitleCues: [{ text: '你好' }]
    });
  });

  it('uses project snapshots while reusing the same subtitle artifact across project versions', () => {
    const subtitle = artifact({
      id: 'subtitle-v1',
      kind: 'target_subtitle',
      version: 1,
      metadata: {
        resultVersion: 1,
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '你好' }]
      }
    });
    const video = artifact({
      id: 'horizontal-v1',
      kind: 'horizontal_video',
      version: 1,
      sourceArtifactIds: [subtitle.id],
      metadata: { resultVersion: 2 }
    });
    const state = {
      ...fallbackState(),
      resultVersion: 2,
      latestResultVersion: 2,
      resultSnapshots: [
        snapshot(1, { target_subtitle: [subtitle.id] }, [subtitle.id]),
        snapshot(2, {
          target_subtitle: [subtitle.id],
          horizontal_video: [video.id]
        }, [video.id])
      ]
    };

    const versions = resultVersionsFromArtifacts([subtitle, video], state);

    expect(versions.map(version => version.value)).toEqual([1, 2]);
    expect(versions[0]?.artifactRefs.target_subtitle).toEqual([subtitle.id]);
    expect(versions[1]).toMatchObject({
      artifactRefs: {
        target_subtitle: [subtitle.id],
        horizontal_video: [video.id]
      },
      settings: { composeVideo: true, videoFormat: 'horizontal' }
    });
    expect(latestArtifactForResultVersion(
      [subtitle, video],
      1,
      ['horizontal_video'],
      state.resultSnapshots
    )).toBeUndefined();
    expect(latestArtifactForResultVersion(
      [subtitle, video],
      2,
      ['target_subtitle'],
      state.resultSnapshots
    )?.id).toBe(subtitle.id);
  });
});

function snapshot(
  version: number,
  artifactRefs: Record<string, string[]>,
  changedArtifactIds: string[]
) {
  return {
    version,
    createdAt: `2026-08-24T00:00:0${version}.000Z`,
    action: 'stage-succeeded',
    stageId: version === 1 ? 'subtitle' : 'render-horizontal',
    description: version === 1 ? '生成字幕' : '合成横屏视频',
    artifactRefs,
    changedArtifactIds,
    staleArtifactIds: [],
    state: fallbackState()
  };
}

function artifact(input: Partial<CreatorArtifact> & Pick<CreatorArtifact, 'id' | 'kind' | 'version'>): CreatorArtifact {
  return {
    jobId: 'job-1',
    status: 'completed',
    path: null,
    sourceArtifactIds: [],
    metadata: {},
    createdAt: `2026-08-24T00:00:0${input.version}.000Z`,
    ...input
  };
}

function fallbackState() {
  return {
    sourceType: 'url',
    sourceUrl: 'https://www.youtube.com/watch?v=test',
    sourceLanguage: 'en',
    targetLanguage: 'zh_cn',
    bilingual: true,
    subtitlePosition: 'top',
    preferPlatformCaptions: true,
    dubbing: false,
    voiceCode: '',
    composeVideo: true,
    videoFormat: 'horizontal',
    verticalTitle: '',
    verticalSubtitle: ''
  } as const;
}
