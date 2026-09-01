import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import { createStickmanDeliveryExecutor } from '../../src/creator/stickman/delivery-executor.js';

let tempRoot = '';

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('stickman delivery executor', () => {
  it('materializes and validates the exact five delivery files', async () => {
    const fixture = await createFixture();
    const result = await run(fixture.artifacts, fixture.workdir);
    expect(result.outputs.map(output => output.kind)).toEqual([
      'clean_video',
      'cover_image',
      'publish_copy',
      'bilingual_video',
      'bilingual_subtitle',
      'delivery_manifest'
    ]);
    const manifest = JSON.parse(readFileSync(result.outputs.at(-1)!.path!, 'utf8'));
    expect(manifest.files.map((file: { name: string }) => file.name)).toEqual([
      'landscape-clean.mp4',
      'youtube-cover.png',
      'publish-copy-youtube.md',
      'horizontal_bilingual.mp4',
      'bilingual_srt.srt'
    ]);
  });

  it('rejects extra, stale, hash-mismatched, and wrong-size inputs', async () => {
    let fixture = await createFixture();
    mkdirSync(join(fixture.workdir, 'delivery'), { recursive: true });
    writeFileSync(join(fixture.workdir, 'delivery', 'extra.txt'), 'extra');
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_extra_file'
    });

    fixture = await createFixture();
    fixture.artifacts[0] = { ...fixture.artifacts[0]!, status: 'stale' };
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_artifact_ambiguous'
    });

    fixture = await createFixture();
    fixture.artifacts[0] = { ...fixture.artifacts[0]!, sha256: '0'.repeat(64) };
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_hash_mismatch'
    });

    fixture = await createFixture();
    const cover = fixture.artifacts.find(artifact => artifact.kind === 'cover_image')!;
    await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ffffff' } })
      .png()
      .toFile(cover.path!);
    cover.sha256 = hashFile(cover.path!);
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_cover_invalid'
    });
  });
});

async function createFixture(): Promise<{ artifacts: CreatorArtifact[]; workdir: string }> {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = mkdtempSync(join(tmpdir(), 'creator-stickman-delivery-'));
  const jobRoot = join(tempRoot, 'job-1');
  const sourceRoot = join(jobRoot, 'source');
  const workdir = join(jobRoot, 'stage-delivery');
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(workdir, { recursive: true });
  const files = {
    clean_video: join(sourceRoot, 'clean.mp4'),
    cover_image: join(sourceRoot, 'cover.png'),
    publish_copy: join(sourceRoot, 'copy.md'),
    bilingual_video: join(sourceRoot, 'bilingual.mp4'),
    bilingual_subtitle: join(sourceRoot, 'bilingual.srt')
  };
  writeFileSync(files.clean_video, 'clean-video');
  writeFileSync(files.bilingual_video, 'bilingual-video');
  writeFileSync(files.publish_copy, '# Title\n\nDescription\n\n## Tags\n\n- tag\n');
  writeFileSync(files.bilingual_subtitle, '1\n00:00:00,000 --> 00:00:01,000\nHello / 浣犲ソ\n');
  await sharp({ create: { width: 1280, height: 720, channels: 4, background: '#ffffff' } })
    .png()
    .toFile(files.cover_image);
  return {
    workdir,
    artifacts: Object.entries(files).map(([kind, path], index) => ({
      id: `artifact-${index}`,
      jobId: 'job-1',
      kind,
      version: 1,
      status: 'completed',
      path,
      scopeKey: null,
      inputFingerprint: null,
      sha256: hashFile(path),
      sourceArtifactIds: [],
      metadata: {},
      createdAt: '2026-08-31T00:00:00.000Z'
    }))
  };
}

function run(artifacts: CreatorArtifact[], workdir: string) {
  return createStickmanDeliveryExecutor({
    ffprobePath: 'unused',
    validateVideo: async () => ({
      duration: 1,
      width: 1280,
      height: 720,
      hasVideo: true,
      hasAudio: true
    })
  }).run({
    stageRun: { id: 'stage-delivery', stageId: 'package-validation' },
    job: { id: 'job-1' },
    inputArtifacts: artifacts,
    workdir,
    signal: new AbortController().signal,
    reportProgress() {}
  } as never);
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
