import type { CreatorActivity, CreatorStageRun } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  creatorPanelAdapterFor,
  stickmanVideoPanelAdapter,
  type CreatorPanelLocalize
} from './creator-panel-adapters.js';

const zh: CreatorPanelLocalize = value => value;
const en: CreatorPanelLocalize = (_zh, value) => value;

const stages = [
  'ingest-text', 'source-transcript', 'source-brief', 'content-plan', 'script',
  'narration', 'audio-timing', 'storyboard', 'style-assets', 'prompt-pack',
  'images', 'visual-validation', 'timeline', 'render-clean', 'media-validation', 'package-validation'
];

describe('stickmanVideoPanelAdapter', () => {
  it('selects the stickman adapter and labels every production stage in both locales', () => {
    expect(creatorPanelAdapterFor('stickman-video')).toBe(stickmanVideoPanelAdapter);
    for (const stageId of stages) {
      expect(stickmanVideoPanelAdapter.stageLabel(stageId, zh)).not.toBe('火柴人视频任务');
      expect(stickmanVideoPanelAdapter.stageLabel(stageId, en)).not.toBe('Stickman video task');
    }
    for (const phase of ['validating', 'preparing_source', 'reading_platform_captions', 'processing_platform_captions', 'translating_subtitles', 'preparing_audio', 'transcribing_audio', 'collecting_outputs', 'transcribing', 'analyzing', 'planning', 'writing', 'reviewing', 'materializing', 'submitting', 'retrying_candidate', 'generating', 'synthesizing', 'measuring', 'validating_media', 'rendering', 'packaging', 'failed', 'completed']) {
      expect(stickmanVideoPanelAdapter.phaseLabel(phase, zh)).not.toBeNull();
      expect(stickmanVideoPanelAdapter.phaseLabel(phase, en)).not.toBeNull();
    }
  });

  it('labels production actions and filters draft setting noise', () => {
    for (const action of ['approve-script', 'continue-after-audio', 'continue-after-visuals', 'edit-script', 'edit-shot', 'regenerate-shot', 'generate-missing-shots', 'retry-stage', 'commit-version']) {
      const normalized = stickmanVideoPanelAdapter.normalizeActivity(activity(action), zh);
      expect(normalized?.label).toBeTruthy();
    }
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('create-job'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('approve-visuals'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('run-stage', {
      stageId: 'source-brief'
    }), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('update-settings'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('update-settings', {
      objectId: 'sourceType,sourceText,styleAsset'
    }), zh)).toMatchObject({ fields: ['内容来源', '文本来源', '视觉风格'] });
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('resolve-provider-request', {
      decision: 'confirm-resubmit'
    }), zh)?.label).toContain('重复计费');
  });

  it('collapses script preparation into one continuous progress card', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('ingest', '', 'succeeded', null, 'ingest-text', 100, 'completed'),
      stage('brief', '', 'succeeded', null, 'source-brief', 100, 'completed'),
      stage('plan', '', 'succeeded', null, 'content-plan', 100, 'completed'),
      stage('script', '', 'running', null, 'script', 15, 'writing')
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      id: 'script',
      stageId: 'script',
      status: 'running',
      progress: {
        phase: 'writing',
        percent: 79,
        completed: 3,
        failed: 0,
        total: 4
      }
    });
    const progress = stickmanVideoPanelAdapter.readStageProgress(aggregated![0]!);
    expect(stickmanVideoPanelAdapter.runningProgressText?.(aggregated![0]!, progress, zh))
      .toBe('生成创作内容');
  });

  it('keeps one completed script card after the validated script is generated', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('ingest', '', 'succeeded', null, 'ingest-text', 100, 'completed'),
      stage('brief', '', 'succeeded', null, 'source-brief', 100, 'completed'),
      stage('plan', '', 'succeeded', null, 'content-plan', 100, 'completed'),
      stage('script', '', 'succeeded', null, 'script', 100, 'completed')
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      stageId: 'script',
      status: 'succeeded',
      progress: { percent: 100, completed: 4, failed: 0, total: 4 }
    });
  });

  it('starts the aggregated URL workflow at the KrillinAI transcript stage', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('transcript', '', 'running', null, 'source-transcript', 20, 'reading_platform_captions')
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      stageId: 'script',
      status: 'running',
      progress: {
        phase: 'reading_platform_captions',
        percent: 5,
        completed: 0,
        failed: 0,
        total: 4
      }
    });
    expect(stickmanVideoPanelAdapter.phaseLabel('reading_platform_captions', zh))
      .toBe('获取平台字幕');
    const progress = stickmanVideoPanelAdapter.readStageProgress(aggregated![0]!);
    expect(stickmanVideoPanelAdapter.runningProgressText?.(aggregated![0]!, progress, zh))
      .toBe('获取平台字幕');
  });

  it('keeps only the current shot run instead of rendering repeated completion cards', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('shot-1-old', 'shot-1', 'failed', '1'.repeat(64)),
      stage('shot-1-new', 'shot-1', 'succeeded', '2'.repeat(64)),
      stage('shot-2', 'shot-2', 'succeeded', '3'.repeat(64)),
      stage('shot-3', 'shot-3', 'failed', '4'.repeat(64))
    ]);
    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      id: 'shot-3',
      stageId: 'images',
      status: 'failed'
    });
  });
});

function activity(action: string, details: CreatorActivity['details'] = {}): CreatorActivity {
  return {
    id: `activity-${action}`,
    jobId: 'job-1',
    revision: 1,
    actor: 'user',
    action,
    summary: action,
    details,
    createdAt: '2026-08-31T00:00:00.000Z'
  };
}

function stage(
  id: string,
  scopeKey: string,
  status: CreatorStageRun['status'],
  inputFingerprint: string | null,
  stageId = 'images',
  percent?: number,
  phase?: string
): CreatorStageRun {
  return {
    id,
    jobId: 'job-1',
    stageId,
    executor: 'stickman-image',
    status,
    dispatchStatus: 'finished',
    claimOwner: null,
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: id,
    scopeKey,
    inputFingerprint,
    progress: {
      ...(percent === undefined ? {} : { percent }),
      ...(phase === undefined ? {} : { phase })
    },
    errorCode: status === 'failed' ? 'image_failed' : null,
    errorMessage: status === 'failed' ? 'failed' : null,
    startedAt: `2026-08-31T00:00:0${id.includes('old') ? 1 : 2}.000Z`,
    finishedAt: '2026-08-31T00:00:03.000Z'
  };
}
