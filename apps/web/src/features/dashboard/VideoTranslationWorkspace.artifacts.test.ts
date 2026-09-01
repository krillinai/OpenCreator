import { describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import {
  latestArtifactForResultVersion,
  resultVersionsFromArtifacts,
  subtitleArtifactsForResultVersion,
  subtitleCuesFromArtifact,
  videoTranslationRegenerationStage,
  videoArtifactsForResultVersion
} from './VideoTranslationWorkspace.js';

describe('video translation result artifact selection', () => {
  it('starts a new render from existing subtitles when video composition is enabled', () => {
    const version = resultVersion({
      settings: { composeVideo: false, videoFormat: 'horizontal' }
    });

    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, composeVideo: true },
      version.source,
      false
    )).toBe('render-horizontal');
  });

  it('chooses the earliest stage affected by each translation setting change', () => {
    const version = resultVersion();
    const subtitleOnlyVersion = resultVersion({
      settings: { composeVideo: false, videoFormat: 'horizontal' }
    });

    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, targetLanguage: 'ja' },
      version.source,
      false
    )).toBe('subtitle');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, dubbing: true },
      version.source,
      false
    )).toBe('tts');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, composeVideo: true, videoFormat: 'vertical' },
      version.source,
      false
    )).toBe('render-vertical');
    expect(videoTranslationRegenerationStage(
      subtitleOnlyVersion,
      subtitleOnlyVersion.settings,
      subtitleOnlyVersion.source,
      true
    )).toBeUndefined();
  });

  it('restarts subtitles for source, language, bilingual, and subtitle order changes', () => {
    const version = resultVersion();
    const changedFile = new File(['next'], 'next.mp4', { type: 'video/mp4' });

    expect(videoTranslationRegenerationStage(
      version,
      version.settings,
      {
        sourceType: 'url',
        videoUrl: 'https://example.com/next',
        videoFile: null,
        videoFileName: null,
        videoFileSize: null,
        videoFileLastModified: null
      },
      false
    )).toBe('subtitle');
    expect(videoTranslationRegenerationStage(
      version,
      version.settings,
      {
        sourceType: 'file',
        videoUrl: '',
        videoFile: changedFile,
        videoFileName: changedFile.name,
        videoFileSize: changedFile.size,
        videoFileLastModified: changedFile.lastModified
      },
      false
    )).toBe('subtitle');
    for (const settings of [
      { ...version.settings, sourceLanguage: 'ja' },
      { ...version.settings, targetLanguage: 'ja' },
      { ...version.settings, preferPlatformCaptions: false },
      { ...version.settings, bilingual: false },
      { ...version.settings, subtitlePosition: 'bottom' as const }
    ]) {
      expect(videoTranslationRegenerationStage(
        version,
        settings,
        version.source,
        false
      )).toBe('subtitle');
    }
  });

  it('plans dubbing and render stages without retranscribing reusable subtitles', () => {
    const version = resultVersion();
    const dubbed = resultVersion({
      settings: { dubbing: true }
    });

    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, subtitleFont: 'serif' },
      version.source,
      false
    )).toBe('render-horizontal');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, subtitleSize: 'large' },
      version.source,
      false
    )).toBe('render-horizontal');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, subtitleColor: '#FFE45C' },
      version.source,
      false
    )).toBe('render-horizontal');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, dubbing: true },
      version.source,
      false
    )).toBe('tts');
    expect(videoTranslationRegenerationStage(
      dubbed,
      { ...dubbed.settings, voiceCode: 'nova', voiceName: 'Nova' },
      dubbed.source,
      false
    )).toBe('tts');
    expect(videoTranslationRegenerationStage(
      dubbed,
      { ...dubbed.settings, dubbing: false },
      dubbed.source,
      false
    )).toBe('render-horizontal');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, videoFormat: 'vertical' },
      version.source,
      false
    )).toBe('render-vertical');
    expect(videoTranslationRegenerationStage(
      version,
      { ...version.settings, videoFormat: 'all' },
      version.source,
      false
    )).toBe('render-horizontal');
  });

  it('commits settings-only changes and starts downstream work for manual subtitles', () => {
    const subtitleOnly = resultVersion({
      settings: { composeVideo: false, videoFormat: 'horizontal' }
    });
    const dubbedSubtitleOnly = resultVersion({
      settings: { composeVideo: false, videoFormat: 'horizontal', dubbing: true }
    });

    expect(videoTranslationRegenerationStage(
      subtitleOnly,
      { ...subtitleOnly.settings, subtitleColor: '#FFE45C' },
      subtitleOnly.source,
      false
    )).toBeUndefined();
    expect(videoTranslationRegenerationStage(
      subtitleOnly,
      subtitleOnly.settings,
      subtitleOnly.source,
      true
    )).toBeUndefined();
    expect(videoTranslationRegenerationStage(
      dubbedSubtitleOnly,
      dubbedSubtitleOnly.settings,
      dubbedSubtitleOnly.source,
      true
    )).toBe('tts');
    expect(videoTranslationRegenerationStage(
      resultVersion(),
      resultVersion().settings,
      resultVersion().source,
      true
    )).toBe('render-horizontal');
    expect(videoTranslationRegenerationStage(
      resultVersion(),
      { ...resultVersion().settings, composeVideo: false },
      resultVersion().source,
      false
    )).toBeUndefined();
  });

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

  it('restores the local source fingerprint from a project snapshot', () => {
    const source = artifact({
      id: 'source-local-v1',
      kind: 'source_video',
      version: 1,
      metadata: {
        source: 'local-upload',
        fileName: 'interview.mp4',
        size: 2048,
        lastModified: 1_777_777
      }
    });
    const subtitle = artifact({
      id: 'subtitle-local-v1',
      kind: 'target_subtitle',
      version: 1,
      sourceArtifactIds: [source.id],
      metadata: { cues: [] }
    });
    const state = {
      ...fallbackState(),
      sourceType: 'file',
      sourceUrl: '',
      resultSnapshots: [{
        ...snapshot(1, {
          source_video: [source.id],
          target_subtitle: [subtitle.id]
        }, [source.id, subtitle.id]),
        state: {
          ...fallbackState(),
          sourceType: 'file',
          sourceUrl: '',
          sourceFileName: 'interview.mp4',
          sourceFileSize: 2048,
          sourceFileLastModified: 1_777_777
        }
      }]
    };

    expect(resultVersionsFromArtifacts([source, subtitle], state)[0]?.source).toMatchObject({
      sourceType: 'file',
      videoFileName: 'interview.mp4',
      videoFileSize: 2048,
      videoFileLastModified: 1_777_777
    });
  });

  it('selects horizontal and vertical videos from the same project snapshot', () => {
    const horizontal = artifact({
      id: 'horizontal-v2',
      kind: 'horizontal_video',
      version: 2
    });
    const vertical = artifact({
      id: 'vertical-v2',
      kind: 'vertical_video',
      version: 2
    });
    const resultSnapshots = [snapshot(5, {
      horizontal_video: [horizontal.id],
      vertical_video: [vertical.id]
    }, [vertical.id])];

    const variants = videoArtifactsForResultVersion(
      [horizontal, vertical],
      5,
      resultSnapshots
    );

    expect(variants.horizontal?.id).toBe(horizontal.id);
    expect(variants.vertical?.id).toBe(vertical.id);
  });

  it('selects horizontal and vertical subtitle artifacts from one project snapshot', () => {
    const horizontal = artifact({
      id: 'horizontal-subtitle-v1',
      kind: 'target_subtitle',
      version: 1,
      metadata: {
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '横屏字幕' }]
      }
    });
    const vertical = artifact({
      id: 'vertical-subtitle-v1',
      kind: 'vertical_subtitle',
      version: 1,
      metadata: {
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '竖屏短字幕' }]
      }
    });
    const resultSnapshots = [snapshot(5, {
      target_subtitle: [horizontal.id],
      vertical_subtitle: [vertical.id]
    }, [horizontal.id, vertical.id])];

    const variants = subtitleArtifactsForResultVersion(
      [horizontal, vertical],
      5,
      resultSnapshots
    );

    expect(variants.horizontal?.id).toBe(horizontal.id);
    expect(variants.vertical?.id).toBe(vertical.id);
    expect(subtitleCuesFromArtifact(variants.vertical)).toEqual([{
      id: 1,
      start: '00:00:00,000',
      end: '00:00:01,000',
      text: '竖屏短字幕'
    }]);
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
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
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

function resultVersion(input: {
  settings?: {
    composeVideo?: boolean;
    videoFormat?: 'horizontal' | 'vertical' | 'all';
    dubbing?: boolean;
  };
} = {}) {
  const settings = { ...fallbackState(), ...input.settings };
  return {
    value: 1,
    description: '初次生成',
    source: {
      sourceType: 'url' as const,
      videoUrl: settings.sourceUrl,
      videoFile: null,
      videoFileName: null,
      videoFileSize: null,
      videoFileLastModified: null
    },
    settings: {
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      bilingual: settings.bilingual,
      subtitlePosition: settings.subtitlePosition,
      preferPlatformCaptions: settings.preferPlatformCaptions,
      subtitleFont: 'system' as const,
      subtitleSize: 'medium' as const,
      subtitleColor: '#FFFFFF',
      dubbing: settings.dubbing,
      ttsProvider: 'openai' as const,
      ttsModel: 'gpt-4o-mini-tts',
      voiceCode: settings.voiceCode,
      voiceName: '',
      composeVideo: settings.composeVideo,
      videoFormat: settings.videoFormat,
      verticalTitle: settings.verticalTitle,
      verticalSubtitle: settings.verticalSubtitle
    },
    subtitleCues: [],
    savedSubtitleSnapshot: '[]',
    generatedSubtitleSnapshot: '[]',
    artifactRefs: {},
    changedArtifactIds: [],
    staleArtifactIds: []
  };
}
