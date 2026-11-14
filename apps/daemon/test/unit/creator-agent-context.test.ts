import { describe, expect, it } from 'vitest';
import type { CreatorJob } from '@opencreator/protocol';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';

describe('creator agent context', () => {
  it('tells the video download Agent to handle video and audio across supported platforms', () => {
    const builder = createAgentContextBuilder({
      templates: createDefaultCreatorTemplateRegistry()
    });
    const context = builder.build({
      ...job(),
      templateId: 'video-download',
      templateVersion: 2
    });

    for (const platform of [
      'YouTube', 'Bilibili', 'X', 'TikTok', 'Instagram',
      '抖音', 'Facebook', '小红书', 'Pinterest'
    ]) {
      expect(context.templateGuidance).toContain(platform);
    }
    expect(context.templateGuidance).toContain('可下载视频、提取音频或下载来源提供的 SRT 字幕');
    expect(context.templateGuidance).toContain('download_probe.options');
    expect(context.templateGuidance).not.toContain('仅支持公开的 YouTube 和 Bilibili');
  });

  it('projects settings, stage state and safe artifact summaries without paths or large subtitle content', () => {
    const builder = createAgentContextBuilder({
      templates: createDefaultCreatorTemplateRegistry(),
      maxStateBytes: 1024
    });
    const context = builder.build(job());

    expect(context).toMatchObject({
      jobStatus: 'completed',
      selectedResultVersion: 4,
      latestResultVersion: 4,
      selectedResultSnapshot: {
        version: 4,
        artifactRefs: { horizontal_video: ['artifact-video'] }
      },
      state: {
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn',
        bilingual: true,
        subtitlePosition: 'top',
        composeVideo: true
      },
      stateTruncated: true,
      templateGuidance: expect.stringContaining('input.patch'),
      availableStageIds: ['subtitle', 'tts', 'render-horizontal', 'render-vertical', 'preview-source-video', 'prepare-source-video'],
      stages: [
        {
          stageId: 'subtitle',
          status: 'succeeded',
          progress: { percent: 100, providerStatus: 'succeeded', phase: 'finalizing' }
        },
        { stageId: 'render-horizontal', status: 'succeeded' }
      ],
      artifacts: [{
        id: 'artifact-video',
        kind: 'horizontal_video',
        projectVersion: 4,
        status: 'completed',
        fileName: 'translated.mp4',
        duration: 19.06,
        width: 320,
        height: 240
      }]
    });
    const serialized = JSON.stringify(context);
    expect(context.state).not.toHaveProperty('__creatorUserEdited');
    expect(serialized).not.toContain('D:\\private\\jobs');
    expect(serialized).not.toContain('完整字幕正文');
  });
});

function job(): CreatorJob {
  const createdAt = '2026-08-21T00:00:00.000Z';
  return {
    id: 'job-1',
    projectId: 'project-1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: 'completed',
    revision: 4,
    presetOrigin: null,
    state: {
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      bilingual: true,
      subtitlePosition: 'top',
      composeVideo: true,
      __creatorUserEdited: true,
      resultVersion: 4,
      latestResultVersion: 4,
      resultSnapshots: [{
        version: 4,
        createdAt,
        action: 'stage-succeeded',
        stageId: 'render-horizontal',
        description: '合成横屏视频',
        artifactRefs: { horizontal_video: ['artifact-video'] },
        changedArtifactIds: ['artifact-video'],
        staleArtifactIds: [],
        state: { composeVideo: true }
      }],
      subtitleCues: [{ text: `完整字幕正文${'x'.repeat(2048)}` }]
    },
    agentThreadId: null,
    stages: [
      {
        id: 'stage-1',
        jobId: 'job-1',
        stageId: 'subtitle',
        executor: 'krillinai',
        status: 'succeeded',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          percent: 100,
          providerStatus: 'succeeded',
          phase: 'finalizing'
        },
        errorCode: null,
        errorMessage: null,
        startedAt: createdAt,
        finishedAt: createdAt
      },
      {
        id: 'stage-2',
        jobId: 'job-1',
        stageId: 'render-horizontal',
        executor: 'krillinai',
        status: 'succeeded',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {},
        errorCode: null,
        errorMessage: null,
        startedAt: createdAt,
        finishedAt: createdAt
      }
    ],
    artifacts: [{
      id: 'artifact-video',
      jobId: 'job-1',
      kind: 'horizontal_video',
      version: 1,
      status: 'completed',
      path: 'D:\\private\\jobs\\translated.mp4',
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: {
        fileName: 'translated.mp4',
        resultVersion: 4,
        duration: 19.06,
        width: 320,
        height: 240
      },
      createdAt
    }],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
}
