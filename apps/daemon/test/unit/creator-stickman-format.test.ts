import { describe, expect, it } from 'vitest';
import { createStickmanVideoTemplate } from '../../src/creator/templates/stickman-video.js';
import {
  stickmanDeliveryManifestSchema,
  stickmanMediaValidationSchema,
  stickmanStyleContractSchema,
  stickmanTimelineSchema
} from '../../src/creator/stickman/contracts.js';

describe('stickman format contracts', () => {
  it('normalizes the YouTube Shorts preset without changing the landscape default', () => {
    const template = createStickmanVideoTemplate();
    const shorts = template.inputSchema.parse({
      sourceType: 'text',
      outputPreset: 'youtube-shorts'
    }) as Record<string, unknown>;
    const landscape = template.inputSchema.parse({}) as Record<string, unknown>;

    expect(shorts).toMatchObject({
      outputPreset: 'youtube-shorts',
      ratio: '9:16',
      targetDurationSeconds: 30,
      targetLanguage: 'en-US',
      ttsProvider: 'edge-tts'
    });
    expect(landscape).toMatchObject({ outputPreset: 'landscape', ratio: '16:9' });
  });

  it('accepts vertical visual, timeline, media, and four-file delivery contracts', () => {
    expect(stickmanStyleContractSchema.parse({
      contract: 'stickman-visual-profile-v2',
      ratio: '9:16',
      character: {
        assetId: 'character',
        revision: 1,
        identity: { preserve: 'same protagonist', prohibit: 'identity changes' },
        references: [{ role: 'character', sha256: 'a'.repeat(64), bytes: 10, mimeType: 'image/png' }]
      },
      style: {
        assetId: 'style',
        revision: 1,
        rendering: {
          medium: 'ink',
          surface: 'paper',
          linework: 'bold',
          shading: 'flat',
          palette: 'monochrome',
          sceneDensity: 'low',
          composition: 'clear',
          characterRendering: 'stick figure'
        },
        semanticRenderingRules: { color: 'palette', light: 'soft', complexEnvironment: 'simplify' },
        forbiddenDirections: ['text'],
        references: []
      }
    })).toMatchObject({ ratio: '9:16' });

    expect(stickmanTimelineSchema.parse({
      ratio: '9:16',
      fps: 30,
      width: 720,
      height: 1280,
      totalFrames: 30,
      shots: [{
        shotId: 'shot-01',
        startFrame: 0,
        endFrame: 30,
        imageArtifactId: 'image-01',
        audioArtifactId: 'audio-01',
        motion: 'static',
        imageSha256: 'b'.repeat(64),
        audioSha256: 'c'.repeat(64),
        imagePath: 'image.png',
        audioPath: 'audio.mp3'
      }],
      captions: [{ segmentId: 'segment-01', startFrame: 0, endFrame: 30, text: 'A clear hook.' }]
    })).toMatchObject({ ratio: '9:16', width: 720, height: 1280 });

    expect(stickmanMediaValidationSchema.parse({
      ok: true,
      validation: 'ffprobe_and_three_frame_sampling',
      ratio: '9:16',
      cleanVideoArtifactId: 'video-01',
      cleanVideoSha256: 'd'.repeat(64),
      timelineArtifactId: 'timeline-01',
      duration: 1,
      expectedDuration: 1,
      durationTolerance: 0.15,
      width: 720,
      height: 1280,
      hasVideo: true,
      hasAudio: true,
      sampledFrames: [1, 2, 3].map(index => ({
        index,
        timestampSeconds: index / 10,
        sha256: String(index).repeat(64),
        width: 720,
        height: 1280,
        brightnessMean: 100,
        contrastStddev: 20
      }))
    })).toMatchObject({ ratio: '9:16', width: 720, height: 1280 });

    const manifest = stickmanDeliveryManifestSchema.parse({
      packageStatus: 'publishable',
      ratio: '9:16',
      width: 720,
      height: 1280,
      duration: 30,
      providers: { image: 'codex-native', video: 'remotion', voice: 'edge-tts' },
      placeholderAssets: [],
      blockingChecks: [],
      files: [
        ['short.mp4', 'video/mp4'],
        ['subtitles.srt', 'application/x-subrip'],
        ['thumbnail.png', 'image/png'],
        ['publish-copy.md', 'text/markdown']
      ].map(([name, mime], index) => ({
        name,
        relativePath: `delivery/${name}`,
        sha256: String(index + 1).repeat(64),
        bytes: 10,
        mime,
        sourceArtifactId: `artifact-${index}`
      }))
    });
    expect(manifest).toMatchObject({ ratio: '9:16', width: 720, height: 1280 });
    expect(manifest.files.map(file => file.name)).toEqual([
      'short.mp4',
      'subtitles.srt',
      'thumbnail.png',
      'publish-copy.md'
    ]);
  });
});
