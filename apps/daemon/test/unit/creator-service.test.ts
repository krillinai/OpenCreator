import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorRepository } from '../../src/creator/repository.js';
import {
  CreatorServiceError,
  createCreatorService
} from '../../src/creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-service-'));
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  return { db, repository, service };
}

describe('creator service', () => {
  it('rejects a stale expectedRevision without overwriting state', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: { targetLanguage: 'en' }
    });
    const updated = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { targetLanguage: 'ja' } }
    });

    expect(() => service.applyAction(job.id, {
      actor: 'agent',
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { targetLanguage: 'fr' } }
    })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
      code: 'creator_revision_conflict',
      latestRevision: 1
    }));
    expect(service.getJob(job.id)?.state.targetLanguage).toBe('ja');
    expect(updated.job.revision).toBe(1);
    db.close();
  });

  it('coalesces draft edits and preserves semantic actions', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: {
        dubbing: true,
        composeVideo: true,
        videoFormat: 'horizontal'
      }
    });
    const first = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: 0,
      input: { patch: { verticalTitle: 'A' }, activityMode: 'draft', objectId: 'title' }
    });
    const second = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: first.job.revision,
      input: { patch: { verticalTitle: 'AB' }, activityMode: 'draft', objectId: 'title' }
    });
    service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: second.job.revision,
      input: { patch: { verticalTitle: 'AB' }, activityMode: 'semantic', objectId: 'title' }
    });

    const activities = service.getJob(job.id)!.activities;
    expect(activities.map(activity => activity.action)).toEqual([
      'create-job',
      'update-settings:draft',
      'update-settings'
    ]);
    expect(activities[1]?.revision).toBe(2);
    db.close();
  });

  it('persists UI-only state without exposing it as creator activity', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'cover',
      state: {}
    });
    const uiOnly = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: 0,
      input: {
        patch: {
          currentStep: 1,
          furthestStep: 1,
          workspacePhase: 'configure'
        },
        activityMode: 'draft',
        objectId: 'currentStep,furthestStep,workspacePhase'
      }
    });

    expect(uiOnly.job.revision).toBe(1);
    expect(uiOnly.job.state.currentStep).toBe(1);
    expect(uiOnly.job.activities.map(activity => activity.action)).toEqual(['create-job']);

    const mixed = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: uiOnly.job.revision,
      input: {
        patch: {
          prompt: '高对比电影感人物封面',
          currentStep: 2,
          workspacePhase: 'result'
        },
        activityMode: 'draft',
        objectId: 'currentStep,prompt,workspacePhase'
      }
    });

    expect(mixed.job.activities.at(-1)).toMatchObject({
      action: 'update-settings:draft',
      details: { objectId: 'prompt' }
    });
    db.close();
  });

  it('records the structured stage id for run-stage activity', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'cover',
      state: { prompt: '电影感人物封面' }
    });

    const started = service.applyAction(job.id, {
      actor: 'user',
      action: 'run-stage',
      expectedRevision: 0,
      input: { stageId: 'generate' }
    });

    expect(started.job.activities.at(-1)).toMatchObject({
      action: 'run-stage',
      details: { stageId: 'generate' }
    });
    db.close();
  });

  it('rejects missing or empty setting patches without advancing revision or activity', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: { targetLanguage: 'en' }
    });

    const invalidInputs: Array<Record<string, import('@opencreator/protocol').CreatorJson>> = [
      { objectId: 'targetLanguage' },
      { patch: {} }
    ];
    for (const input of invalidInputs) {
      expect(() => service.applyAction(job.id, {
        actor: 'agent',
        action: 'update-settings',
        expectedRevision: 0,
        input
      })).toThrowError(expect.objectContaining<Partial<CreatorServiceError>>({
        code: 'creator_action_input_invalid'
      }));
      const unchanged = service.getJob(job.id)!;
      expect(unchanged.revision).toBe(0);
      expect(unchanged.state.targetLanguage).toBe('en');
      expect(unchanged.activities).toHaveLength(1);
    }
    db.close();
  });

  it('persists a structured subtitle style patch and records its object id', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: {}
    });

    const response = service.applyAction(job.id, {
      actor: 'agent',
      action: 'update-settings',
      expectedRevision: 0,
      input: {
        patch: {
          subtitleStyle: { primaryColor: '#F6C453' }
        },
        objectId: 'subtitleStyle'
      }
    });

    expect(response.job.revision).toBe(1);
    expect(response.job.state.subtitleStyle).toEqual({ primaryColor: '#F6C453' });
    expect(response.job.activities.at(-1)?.details.objectId).toBe('subtitleStyle');
    db.close();
  });

  it('clears a persisted configuration request when a stage can start', () => {
    const { db, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=test'
      }
    });
    const waiting = service.setNeedsInput(job.id, {
      code: 'creator_llm_config_missing',
      message: '请先完成文本翻译模型配置'
    });

    const started = service.applyAction(job.id, {
      actor: 'user',
      action: 'run-stage',
      expectedRevision: waiting.revision,
      input: { stageId: 'subtitle' }
    });

    expect(started.job.status).toBe('running');
    expect(started.job.state).not.toHaveProperty('needsInput');
    db.close();
  });

  it('clears an obsolete TTS request when dubbing is turned off', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=test',
        dubbing: true
      }
    });
    repository.createStageRun({
      jobId: job.id,
      stageId: 'subtitle',
      executor: 'krillinai',
      status: 'succeeded',
      progress: { workflow: true }
    });
    const waiting = service.setNeedsInput(job.id, {
      code: 'creator_tts_config_missing',
      message: '请先完成目标语言配音服务配置'
    });

    const updated = service.applyAction(job.id, {
      actor: 'user',
      action: 'update-settings',
      expectedRevision: waiting.revision,
      input: { patch: { dubbing: false } }
    });

    expect(updated.job.status).toBe('completed');
    expect(updated.job.state.dubbing).toBe(false);
    expect(updated.job.state).not.toHaveProperty('needsInput');
    db.close();
  });

  it('stales only artifacts linked to the edited subtitle version', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: {}
    });
    const subtitleV1 = repository.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'v1.srt'),
      sourceArtifactIds: [],
      metadata: {}
    });
    const audioV1 = repository.insertArtifact({
      jobId: job.id,
      kind: 'dubbed_audio',
      status: 'completed',
      path: join(tempDir, 'v1.mp3'),
      sourceArtifactIds: [subtitleV1.id],
      metadata: {}
    });
    const subtitleV2 = repository.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'v2.srt'),
      sourceArtifactIds: [],
      metadata: {}
    });
    const audioV2 = repository.insertArtifact({
      jobId: job.id,
      kind: 'dubbed_audio',
      status: 'completed',
      path: join(tempDir, 'v2.mp3'),
      sourceArtifactIds: [subtitleV2.id],
      metadata: {}
    });
    const videoV2 = repository.insertArtifact({
      jobId: job.id,
      kind: 'horizontal_video',
      status: 'completed',
      path: join(tempDir, 'v2.mp4'),
      sourceArtifactIds: [audioV2.id, subtitleV2.id],
      metadata: {}
    });

    const response = service.applyAction(job.id, {
      actor: 'user',
      action: 'edit-subtitle',
      expectedRevision: 0,
      input: { artifactId: subtitleV2.id, cues: [] }
    });

    const artifacts = service.getJob(job.id)!.artifacts;
    expect(artifacts.find(item => item.id === audioV1.id)?.status).toBe('completed');
    expect(artifacts.find(item => item.id === audioV2.id)?.status).toBe('stale');
    expect(artifacts.find(item => item.id === videoV2.id)?.status).toBe('stale');
    const editedSubtitle = response.job.artifacts
      .filter(item => item.kind === 'target_subtitle')
      .at(-1)!;
    expect(response.job.state.resultVersion).toBe(3);
    expect(response.job.state.resultSnapshots).toMatchObject([{
      version: 3,
      artifactRefs: {
        target_subtitle: [editedSubtitle.id]
      },
      staleArtifactIds: []
    }]);
    db.close();
  });

  it('commits a settings-only project version from the selected base snapshot', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      state: {
        composeVideo: false,
        videoFormat: 'horizontal'
      }
    });
    const subtitle = repository.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'subtitle-v1.srt'),
      sourceArtifactIds: [],
      metadata: { resultVersion: 1 }
    });
    const video = repository.insertArtifact({
      jobId: job.id,
      kind: 'horizontal_video',
      status: 'completed',
      path: join(tempDir, 'video-v1.mp4'),
      sourceArtifactIds: [subtitle.id],
      metadata: { resultVersion: 1 }
    });
    repository.updateJob({
      id: job.id,
      status: 'completed',
      revision: 0,
      state: {
        ...job.state,
        resultVersion: 1,
        latestResultVersion: 1,
        resultSnapshots: [{
          version: 1,
          createdAt: '2026-08-30T00:00:00.000Z',
          action: 'stage-succeeded',
          stageId: 'render-horizontal',
          description: '合成横屏视频',
          artifactRefs: {
            target_subtitle: [subtitle.id],
            horizontal_video: [video.id]
          },
          changedArtifactIds: [subtitle.id, video.id],
          staleArtifactIds: [],
          state: {
            composeVideo: true,
            videoFormat: 'horizontal'
          }
        }]
      }
    });

    const response = service.applyAction(job.id, {
      actor: 'user',
      action: 'commit-version',
      expectedRevision: 0,
      input: { baseResultVersion: 1 }
    });

    expect(response.job.state.resultVersion).toBe(2);
    expect(response.job.state.resultSnapshots).toMatchObject([
      { version: 1 },
      {
        version: 2,
        action: 'commit-version',
        artifactRefs: {
          target_subtitle: [subtitle.id]
        },
        state: {
          composeVideo: false,
          videoFormat: 'horizontal'
        }
      }
    ]);
    expect(response.job.state.resultSnapshots).not.toMatchObject([
      {},
      { artifactRefs: { horizontal_video: expect.anything() } }
    ]);
    db.close();
  });
});
