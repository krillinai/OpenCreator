import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import { createStickmanValidationExecutor } from '../../src/creator/stickman/validation-executor.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('stickman visual validation', () => {
  it('records hash-bound decode, ratio, readability, and OCR evidence for every shot', async () => {
    const fixture = await createFixture();
    const result = await run(fixture.artifacts, async () => ({ available: true, detectedText: [] }));
    const report = JSON.parse(readFileSync(result.outputs[0]!.path!, 'utf8'));

    expect(report).toMatchObject({
      ok: true,
      validation: 'automated_decode_aspect_nonblank_hash_and_ocr',
      shotCount: 2,
      ocrStatus: 'passed',
      publishable: true,
      warnings: [],
      shots: [
        { shotId: 'shot-01', width: 320, height: 180, ocrStatus: 'passed' },
        { shotId: 'shot-02', width: 320, height: 180, ocrStatus: 'passed' }
      ]
    });
    expect(report.shots.every((shot: { contrastStddev: number }) => shot.contrastStddev >= 8))
      .toBe(true);
  });

  it('keeps OCR-unavailable visuals as non-publishable technical evidence', async () => {
    const fixture = await createFixture();
    const result = await run(fixture.artifacts, async () => ({ available: false, detectedText: [] }));
    const report = JSON.parse(readFileSync(result.outputs[0]!.path!, 'utf8'));

    expect(report).toMatchObject({
      ocrStatus: 'unavailable',
      publishable: false,
      warnings: ['visual_ocr_unavailable']
    });
  });

  it('rejects blank, duplicate, and OCR-positive images instead of promoting them', async () => {
    let fixture = await createFixture();
    const first = fixture.artifacts.find(artifact => artifact.scopeKey === 'shot-01')!;
    await sharp({ create: { width: 320, height: 180, channels: 3, background: '#ffffff' } })
      .png()
      .toFile(first.path!);
    first.sha256 = hashFile(first.path!);
    await expect(run(fixture.artifacts, async () => ({ available: true, detectedText: [] })))
      .rejects.toMatchObject({ code: 'creator_shot_image_unreadable' });

    fixture = await createFixture();
    const [one, two] = fixture.artifacts.filter(artifact => artifact.kind === 'shot_image');
    writeFileSync(two!.path!, readFileSync(one!.path!));
    two!.sha256 = hashFile(two!.path!);
    await expect(run(fixture.artifacts, async () => ({ available: true, detectedText: [] })))
      .rejects.toMatchObject({ code: 'creator_shot_images_duplicate' });

    fixture = await createFixture();
    await expect(run(fixture.artifacts, async path => ({
      available: true,
      detectedText: path.endsWith('shot-02.png') ? ['WATERMARK'] : []
    }))).rejects.toMatchObject({ code: 'creator_visual_text_detected' });
  });
});

async function createFixture(): Promise<{ artifacts: CreatorArtifact[] }> {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-validation-'));
  mkdirSync(join(tempDir, 'stage-validation'), { recursive: true });
  const shotSpecPath = join(tempDir, 'shot-spec.json');
  writeFileSync(shotSpecPath, JSON.stringify({
    scriptArtifactId: 'script-1',
    audioTimingArtifactId: 'audio-timing-1',
    timingSource: 'ffprobe_cumulative_tts_duration',
    shots: [
      { id: 'shot-01', sourceSegmentId: 'segment-01', semanticAnchor: '一', visualDescription: '第一幅画面', compositionAndAction: '人物居中', keyObjects: ['人物'], continuityReason: '', motion: 'static', motionReason: '静态说明', startSeconds: 0, endSeconds: 1, durationSeconds: 1 },
      { id: 'shot-02', sourceSegmentId: 'segment-02', semanticAnchor: '二', visualDescription: '第二幅画面', compositionAndAction: '人物向右', keyObjects: ['人物'], continuityReason: '延续动作', motion: 'push-in', motionReason: '聚焦人物', startSeconds: 1, endSeconds: 2, durationSeconds: 1 }
    ]
  }));
  const one = join(tempDir, 'shot-01.png');
  const two = join(tempDir, 'shot-02.png');
  await writeCheckerboard(one, 0);
  await writeCheckerboard(two, 1);
  return {
    artifacts: [
      artifact('shot-spec', 'shot_spec', shotSpecPath, null),
      artifact('image-1', 'shot_image', one, 'shot-01'),
      artifact('image-2', 'shot_image', two, 'shot-02')
    ]
  };
}

function run(
  artifacts: CreatorArtifact[],
  runOcr: (path: string) => Promise<{ available: boolean; detectedText: string[] }>
) {
  return createStickmanValidationExecutor({ runOcr }).run({
    stageRun: { id: 'stage-validation', stageId: 'visual-validation' },
    job: { id: 'job-1' },
    inputArtifacts: artifacts,
    workdir: join(tempDir, 'stage-validation'),
    signal: new AbortController().signal,
    reportProgress() {}
  } as never);
}

async function writeCheckerboard(path: string, offset: number): Promise<void> {
  const width = 320;
  const height = 180;
  const content = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = ((Math.floor(x / 20) + Math.floor(y / 20) + offset) % 2 === 0) ? 24 : 232;
      const index = (y * width + x) * 3;
      content[index] = value;
      content[index + 1] = value;
      content[index + 2] = value;
    }
  }
  await sharp(content, { raw: { width, height, channels: 3 } }).png().toFile(path);
}

function artifact(id: string, kind: string, path: string, scopeKey: string | null): CreatorArtifact {
  return {
    id,
    jobId: 'job-1',
    kind,
    version: 1,
    status: 'completed',
    path,
    scopeKey,
    inputFingerprint: null,
    sha256: hashFile(path),
    sourceArtifactIds: [],
    metadata: {},
    createdAt: '2026-09-03T00:00:00.000Z'
  };
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
