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
  'acquire-source', 'source-transcript', 'source-brief', 'content-plan', 'script',
  'storyboard', 'images', 'narration', 'visual-validation', 'timeline', 'render-clean',
  'cover', 'subtitles', 'publish-copy', 'bilingual-render', 'package-validation'
];

describe('stickmanVideoPanelAdapter', () => {
  it('selects the stickman adapter and labels every production stage in both locales', () => {
    expect(creatorPanelAdapterFor('stickman-video')).toBe(stickmanVideoPanelAdapter);
    for (const stageId of stages) {
      expect(stickmanVideoPanelAdapter.stageLabel(stageId, zh)).not.toBe('火柴人视频任务');
      expect(stickmanVideoPanelAdapter.stageLabel(stageId, en)).not.toBe('Stickman video task');
    }
    for (const phase of ['validating', 'downloading', 'transcribing', 'analyzing', 'planning', 'writing', 'submitting', 'generating', 'synthesizing', 'rendering', 'packaging', 'failed', 'completed']) {
      expect(stickmanVideoPanelAdapter.phaseLabel(phase, zh)).not.toBeNull();
      expect(stickmanVideoPanelAdapter.phaseLabel(phase, en)).not.toBeNull();
    }
  });

  it('labels production actions and filters draft setting noise', () => {
    for (const action of ['approve-script', 'edit-script', 'edit-shot', 'approve-storyboard', 'regenerate-shot', 'approve-visuals', 'retry-stage', 'commit-version']) {
      const normalized = stickmanVideoPanelAdapter.normalizeActivity(activity(action), zh);
      expect(normalized?.label).toBeTruthy();
    }
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('create-job'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('update-settings'), zh)).toBeNull();
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('update-settings', {
      objectId: 'sourceUrl,style'
    }), zh)).toMatchObject({ fields: ['YouTube 来源', '视觉风格'] });
    expect(stickmanVideoPanelAdapter.normalizeActivity(activity('resolve-provider-request', {
      decision: 'confirm-resubmit'
    }), zh)?.label).toContain('重复计费');
  });

  it('aggregates current shot runs into completed failed and total progress', () => {
    const aggregated = stickmanVideoPanelAdapter.aggregateStages?.([
      stage('shot-1-old', 'shot-1', 'failed', '1'.repeat(64)),
      stage('shot-1-new', 'shot-1', 'succeeded', '2'.repeat(64)),
      stage('shot-2', 'shot-2', 'succeeded', '3'.repeat(64)),
      stage('shot-3', 'shot-3', 'failed', '4'.repeat(64))
    ]);
    expect(aggregated).toHaveLength(1);
    expect(aggregated?.[0]).toMatchObject({
      stageId: 'images',
      status: 'failed',
      progress: { completed: 2, failed: 1, total: 3 }
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
  inputFingerprint: string
): CreatorStageRun {
  return {
    id,
    jobId: 'job-1',
    stageId: 'images',
    executor: 'stickman-image',
    status,
    dispatchStatus: 'finished',
    claimOwner: null,
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: id,
    scopeKey,
    inputFingerprint,
    progress: {},
    errorCode: status === 'failed' ? 'image_failed' : null,
    errorMessage: status === 'failed' ? 'failed' : null,
    startedAt: `2026-08-31T00:00:0${id.includes('old') ? 1 : 2}.000Z`,
    finishedAt: '2026-08-31T00:00:03.000Z'
  };
}
