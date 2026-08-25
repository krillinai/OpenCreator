import { describe, expect, it } from 'vitest';
import type { CreatorJob } from '@opencreator/protocol';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';

describe('creator agent context', () => {
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
      availableStageIds: ['subtitle', 'tts', 'render-horizontal', 'render-vertical'],
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
    state: {
      sourceLanguage: 'en',
      targetLanguage: 'zh_cn',
      bilingual: true,
      subtitlePosition: 'top',
      composeVideo: true,
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
        progress: {
          percent: 100,
          krillinStatus: 'succeeded',
          krillinEventPayload: { phase: 'finalizing' }
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
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
}
