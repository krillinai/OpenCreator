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
    writeFileSync(join(tempDir, 'one.png'), 'one');
    writeFileSync(join(tempDir, 'two.png'), 'two');
    writeFileSync(join(tempDir, 'old.png'), 'old');
    writeFileSync(join(tempDir, 'voice.mp3'), 'voice');
    writeFileSync(shotSpecPath, JSON.stringify({
      scriptArtifactId: 'script-1',
      shots: [
        { id: 'shot-01', sourceSegmentId: 'segment-01', narration: '一', imagePrompt: '一', motion: 'static', durationSeconds: 2 },
        { id: 'shot-02', sourceSegmentId: 'segment-02', narration: '二', imagePrompt: '二', motion: 'push-in', durationSeconds: 3 }
      ]
    }));
    const artifacts: CreatorArtifact[] = [
      artifact('old-shot-01', 'shot_image', 'stale', join(tempDir, 'old.png'), 'shot-01', '0'.repeat(64)),
      artifact('shot-02-image', 'shot_image', 'completed', join(tempDir, 'two.png'), 'shot-02', '2'.repeat(64)),
      artifact('narration', 'narration_audio', 'completed', join(tempDir, 'voice.mp3'), null, '3'.repeat(64), { duration: 5 }),
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
