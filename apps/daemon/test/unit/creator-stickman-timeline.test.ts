import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import { createStickmanTimelineExecutor } from '../../src/creator/stickman/timeline-executor.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('stickman timeline executor', () => {
  it('builds a deterministic contiguous timeline from approved current artifacts', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-timeline-'));
    const workdir = join(tempDir, 'stage-timeline');
    mkdirSync(workdir, { recursive: true });
    const shotSpecPath = join(tempDir, 'shots.json');
    const scriptPath = join(tempDir, 'script.json');
    const timingPath = join(tempDir, 'audio-timing.json');
    writeFileSync(join(tempDir, 'one.png'), 'one');
    writeFileSync(join(tempDir, 'two.png'), 'two');
    writeFileSync(join(tempDir, 'old.png'), 'old');
    writeFileSync(join(tempDir, 'one.wav'), 'voice one');
    writeFileSync(join(tempDir, 'two.wav'), 'voice two');
    writeFileSync(scriptPath, JSON.stringify({
      contract: 'stickman-narration-script-v2',
      reviewStatus: 'approved',
      contentLocked: true,
      title: '测试脚本',
      language: 'zh-CN',
      targetDurationSeconds: 5,
      narrationBudget: { unit: 'characters', unitsPerMinute: 240, minUnits: 1, maxUnits: 10 },
      segmentCount: 2,
      totalNarrationUnits: 6,
      estimatedTotalDurationSeconds: 1.5,
      segments: [
        { id: 'segment-01', order: 1, narration: '第一段', claimIds: ['claim-001'], sourceSpanIds: ['source-001'], narrationUnits: 3, estimatedDurationSeconds: 0.75 },
        { id: 'segment-02', order: 2, narration: '第二段', claimIds: ['claim-002'], sourceSpanIds: ['source-002'], narrationUnits: 3, estimatedDurationSeconds: 0.75 }
      ]
    }));
    writeFileSync(shotSpecPath, JSON.stringify({
      scriptArtifactId: 'script-1',
      audioTimingArtifactId: 'audio-timing',
      timingSource: 'ffprobe_cumulative_tts_duration',
      shots: [
        { id: 'shot-01', sourceSegmentId: 'segment-01', semanticAnchor: '一', visualDescription: '人物展示第一段含义', compositionAndAction: '人物居中讲解', keyObjects: ['人物'], continuityReason: '', motion: 'static', motionReason: '静态说明', startSeconds: 0, endSeconds: 2, durationSeconds: 2 },
        { id: 'shot-02', sourceSegmentId: 'segment-02', semanticAnchor: '二', visualDescription: '人物展示第二段含义', compositionAndAction: '人物指向目标', keyObjects: ['人物', '目标'], continuityReason: '承接上一段', motion: 'push-in', motionReason: '聚焦目标', startSeconds: 2, endSeconds: 5, durationSeconds: 3 }
      ]
    }));
    writeFileSync(timingPath, JSON.stringify({
      scriptArtifactId: 'script-1',
      timingSource: 'ffprobe_cumulative_tts_duration',
      segments: [
        { segmentId: 'segment-01', startSeconds: 0, endSeconds: 2, durationSeconds: 2, audioArtifactId: 'narration-01', audioSha256: '3'.repeat(64) },
        { segmentId: 'segment-02', startSeconds: 2, endSeconds: 5, durationSeconds: 3, audioArtifactId: 'narration-02', audioSha256: '4'.repeat(64) }
      ],
      totalDurationSeconds: 5
    }));
    const artifacts: CreatorArtifact[] = [
      artifact('old-shot-01', 'shot_image', 'stale', join(tempDir, 'old.png'), 'shot-01', '0'.repeat(64)),
      artifact('shot-02-image', 'shot_image', 'completed', join(tempDir, 'two.png'), 'shot-02', '2'.repeat(64)),
      artifact('script-1', 'script_manifest', 'completed', scriptPath, null, '5'.repeat(64)),
      artifact('audio-timing', 'audio_timing', 'completed', timingPath, null, '6'.repeat(64)),
      artifact('narration-01', 'narration_audio', 'completed', join(tempDir, 'one.wav'), 'segment-01', '3'.repeat(64), { duration: 2 }),
      artifact('narration-02', 'narration_audio', 'completed', join(tempDir, 'two.wav'), 'segment-02', '4'.repeat(64), { duration: 3 }),
      artifact('shot-spec', 'shot_spec', 'completed', shotSpecPath, null, '4'.repeat(64)),
      artifact('shot-01-image', 'shot_image', 'completed', join(tempDir, 'one.png'), 'shot-01', '1'.repeat(64))
    ];
    const result = await createStickmanTimelineExecutor().run({
      stageRun: { stageId: 'timeline' },
      job: {},
      inputArtifacts: artifacts,
      workdir,
      signal: new AbortController().signal,
      reportProgress() {}
    } as never);

    const timeline = JSON.parse(readFileSync(result.outputs[0]!.path!, 'utf8'));
    expect(timeline).toMatchObject({
      fps: 30,
      width: 1280,
      height: 720,
      totalFrames: 150,
      shots: [
        { shotId: 'shot-01', startFrame: 0, endFrame: 60, imageArtifactId: 'shot-01-image' },
        { shotId: 'shot-02', startFrame: 60, endFrame: 150, imageArtifactId: 'shot-02-image' }
      ]
    });
    expect(readFileSync(result.outputs[1]!.path!, 'utf8')).toBe(
      '1\n00:00:00,000 --> 00:00:02,000\n第一段\n\n2\n00:00:02,000 --> 00:00:05,000\n第二段\n'
    );
  });
});

function artifact(
  id: string,
  kind: string,
  status: CreatorArtifact['status'],
  path: string,
  scopeKey: string | null,
  sha256: string,
  metadata: CreatorArtifact['metadata'] = {}
): CreatorArtifact {
  return {
    id,
    jobId: 'job-1',
    kind,
    version: 1,
    status,
    path,
    scopeKey,
    inputFingerprint: null,
    sha256,
    sourceArtifactIds: [],
    metadata,
    createdAt: '2026-08-31T00:00:00.000Z'
  };
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
