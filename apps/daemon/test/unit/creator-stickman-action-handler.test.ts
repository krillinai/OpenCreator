import { describe, expect, it } from 'vitest';
import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import type { CreatorRepository } from '../../src/creator/repository.js';
import { handleStickmanAction } from '../../src/creator/stickman/action-handler.js';

describe('stickman action handler', () => {
  it('stales the content pipeline when a Shorts preset changes duration, language, and TTS', () => {
    const artifacts = [
      'content_plan',
      'script_manifest',
      'narration_audio',
      'audio_timing',
      'shot_spec',
      'character_reference',
      'style_reference',
      'style_contract',
      'image_prompt_pack',
      'shot_image',
      'visual_validation',
      'timeline_manifest',
      'narration_subtitle',
      'clean_video',
      'media_validation',
      'thumbnail',
      'publish_copy',
      'delivery_manifest'
    ].map((kind, index): CreatorArtifact => ({
      id: `artifact-${index + 1}`,
      jobId: 'job-1',
      kind,
      version: 1,
      status: 'completed',
      path: null,
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: {},
      createdAt: '2026-09-20T00:00:00.000Z'
    }));
    const job = {
      id: 'job-1',
      projectId: 'project-1',
      templateId: 'stickman-video',
      templateVersion: 2,
      status: 'running',
      revision: 1,
      state: {
        outputPreset: 'landscape',
        ratio: '16:9',
        targetDurationSeconds: 60,
        targetLanguage: 'zh-CN',
        ttsProvider: 'openai'
      },
      stages: [],
      artifacts,
      providerRequests: [],
      activities: [],
      agentThreadId: null,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z'
    } as CreatorJob;
    const staleIds: string[] = [];
    const repository = {
      setArtifactStatus(id: string, status: string) {
        if (status === 'stale') staleIds.push(id);
      }
    } as unknown as CreatorRepository;

    const result = handleStickmanAction({
      repository,
      current: job,
      action: 'update-settings',
      parsedInput: { patch: { outputPreset: 'youtube-shorts' } },
      actor: 'user',
      newRevision: 2
    });

    expect(result.handled).toBe(true);
    expect(result.state).toMatchObject({
      outputPreset: 'youtube-shorts',
      ratio: '9:16',
      targetDurationSeconds: 30,
      targetLanguage: 'en-US',
      ttsProvider: 'edge-tts'
    });
    expect(result.affectedArtifactIds).toHaveLength(artifacts.length);
    expect(new Set(staleIds)).toHaveLength(artifacts.length);
  });

  it('restores landscape defaults and global TTS selection when leaving Shorts', () => {
    const artifacts: CreatorArtifact[] = ['script_manifest', 'clean_video'].map((kind, index) => ({
      id: `artifact-${index + 1}`,
      jobId: 'job-1',
      kind,
      version: 1,
      status: 'completed',
      path: null,
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: {},
      createdAt: '2026-09-20T00:00:00.000Z'
    }));
    const job = {
      id: 'job-1',
      projectId: 'project-1',
      templateId: 'stickman-video',
      templateVersion: 2,
      status: 'running',
      revision: 1,
      state: {
        outputPreset: 'youtube-shorts',
        ratio: '9:16',
        sourceLanguage: 'auto',
        targetDurationSeconds: 30,
        targetLanguage: 'en-US',
        ttsProvider: 'edge-tts',
        ttsModel: '',
        voiceCode: 'en-US-AriaNeural',
        voiceName: 'Aria'
      },
      stages: [],
      artifacts,
      providerRequests: [],
      activities: [],
      agentThreadId: null,
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z'
    } as CreatorJob;
    const repository = {
      setArtifactStatus() {}
    } as unknown as CreatorRepository;

    const result = handleStickmanAction({
      repository,
      current: job,
      action: 'update-settings',
      parsedInput: { patch: { outputPreset: 'landscape' } },
      actor: 'user',
      newRevision: 2
    });

    expect(result.state).toMatchObject({
      outputPreset: 'landscape',
      ratio: '16:9',
      sourceLanguage: 'auto',
      targetDurationSeconds: 30,
      targetLanguage: 'zh-CN'
    });
    expect(result.state).not.toHaveProperty('ttsProvider');
    expect(result.state).not.toHaveProperty('voiceCode');
  });
});
