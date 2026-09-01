import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanImageExecutor } from '../../src/creator/stickman/image-executor.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-images-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  return { db, repository, templates, service };
}

function shotSpecValue() {
  return {
    scriptArtifactId: 'script-1',
    shots: [
      { id: 'shot-01', sourceSegmentId: 'segment-01', narration: '一', imagePrompt: 'success one', motion: 'static', durationSeconds: 4 },
      { id: 'shot-02', sourceSegmentId: 'segment-02', narration: '二', imagePrompt: 'fail two', motion: 'push-in', durationSeconds: 4 },
      { id: 'shot-03', sourceSegmentId: 'segment-03', narration: '三', imagePrompt: 'success three', motion: 'pan-left', durationSeconds: 4 }
    ]
  } as const;
}

describe('stickman scoped images', () => {
  it('generates a manifest-tracked 1280x720 YouTube cover', async () => {
    const { db, repository, templates, service } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const planPath = join(tempDir, 'content-plan.json');
    const cleanPath = join(tempDir, 'landscape-clean.mp4');
    writeFileSync(planPath, JSON.stringify({
      title: 'Cover title',
      audience: 'Developers',
      objective: 'Explain the idea',
      outline: ['Problem', 'Solution']
    }));
    writeFileSync(cleanPath, 'video');
    repository.insertArtifact({
      jobId: job.id,
      kind: 'content_plan',
      status: 'completed',
      path: planPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    repository.insertArtifact({
      jobId: job.id,
      kind: 'clean_video',
      status: 'completed',
      path: cleanPath,
      sha256: 'b'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const sourceImage = await sharp({
      create: { width: 640, height: 640, channels: 4, background: '#fefefe' }
    }).png().toBuffer();
    const config = createDefaultCreatorServicesConfig();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      executors: [createStickmanImageExecutor({
        configStore: { read: async () => config },
        ledger: new CreatorProviderRequestLedger(repository),
        generate: async request => ({
          model: 'cover-model',
          contents: [{ mime: 'image/png', content: sourceImage }],
          request
        } as never)
      })]
    });

    const stage = await runner.run(job.id, 'cover');
    expect(stage.status).toBe('succeeded');
    const cover = service.getJob(job.id)!.artifacts.find(artifact => artifact.kind === 'cover_image')!;
    expect(cover.metadata).toMatchObject({
      fileName: 'youtube-cover.png',
      width: 1280,
      height: 720,
      model: 'cover-model'
    });
    expect(await sharp(cover.path!).metadata()).toMatchObject({ width: 1280, height: 720, format: 'png' });
    expect(service.getJob(job.id)!.providerRequests).toHaveLength(1);
    await runner.close();
    db.close();
  });

  it('keeps successful shot artifacts when another scope fails', async () => {
    const { db, repository, templates, service } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const shotSpecPath = join(tempDir, 'shot-spec.json');
    writeFileSync(shotSpecPath, JSON.stringify(shotSpecValue()));
    repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpecPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const runs = shotSpecValue().shots.map((shot, index) => repository.createStageRun({
      jobId: job.id,
      stageId: 'images',
      executor: 'stickman-image',
      status: 'queued',
      scopeKey: shot.id,
      inputFingerprint: String(index + 1).repeat(64)
    }));
    const config = createDefaultCreatorServicesConfig();
    const runner = createCreatorStageRunner({
      repository,
      templates,
      workRoot: join(tempDir, 'jobs'),
      maxConcurrency: 3,
      executors: [createStickmanImageExecutor({
        configStore: { read: async () => config },
        ledger: new CreatorProviderRequestLedger(repository),
        async generate(request) {
          if (request.prompt.includes('fail two')) throw new Error('injected provider failure');
          return {
            model: 'test-image',
            contents: [{
              mime: 'image/png',
              content: Buffer.concat([
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
                Buffer.alloc(24, 1)
              ])
            }]
          };
        }
      })]
    });

    const results = await Promise.all(runs.map(run => runner.runStageRun(run.id)));
    const completed = service.getJob(job.id)!;

    expect(results.map(run => run.status).sort()).toEqual(['failed', 'succeeded', 'succeeded']);
    expect(completed.artifacts
      .filter(artifact => artifact.kind === 'shot_image')
      .sort((left, right) => (left.scopeKey ?? '').localeCompare(right.scopeKey ?? ''))).toMatchObject([
      { scopeKey: 'shot-01', status: 'completed', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { scopeKey: 'shot-03', status: 'completed', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
    ]);
    expect(completed).toMatchObject({
      status: 'needs_input',
      state: { needsInput: { scopeKey: 'shot-02' } }
    });
    expect(completed.providerRequests).toHaveLength(3);
    await runner.close();
    db.close();
  });

  it('regenerates one shot and stales only its transitive dependents', () => {
    const { db, repository, service } = setup();
    const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video' });
    const shotSpecPath = join(tempDir, 'shot-spec.json');
    writeFileSync(shotSpecPath, JSON.stringify(shotSpecValue()));
    const shotSpec = repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpecPath,
      sha256: 'a'.repeat(64),
      sourceArtifactIds: [],
      metadata: {}
    });
    const images = ['shot-01', 'shot-02', 'shot-03'].map((scopeKey, index) => repository.insertArtifact({
      jobId: job.id,
      kind: 'shot_image',
      status: 'completed',
      path: null,
      scopeKey,
      inputFingerprint: String(index + 1).repeat(64),
      sha256: String.fromCharCode(98 + index).repeat(64),
      sourceArtifactIds: [shotSpec.id],
      metadata: {}
    }));
    const validation = repository.insertArtifact({ jobId: job.id, kind: 'visual_validation', status: 'completed', path: null, sourceArtifactIds: images.map(image => image.id), metadata: {} });
    const timeline = repository.insertArtifact({ jobId: job.id, kind: 'timeline_manifest', status: 'completed', path: null, sourceArtifactIds: [validation.id, ...images.map(image => image.id)], metadata: {} });
    const clean = repository.insertArtifact({ jobId: job.id, kind: 'clean_video', status: 'completed', path: null, sourceArtifactIds: [timeline.id], metadata: {} });

    const response = service.applyAction(job.id, {
      actor: 'user',
      action: 'edit-shot',
      expectedRevision: 0,
      input: {
        artifactId: shotSpec.id,
        scopeKey: 'shot-02',
        patch: { imagePrompt: 'updated shot two' },
        revision: 0
      }
    });

    expect(response.job.artifacts.find(item => item.id === images[0]!.id)?.status).toBe('completed');
    expect(response.job.artifacts.find(item => item.id === images[2]!.id)?.status).toBe('completed');
    expect(response.job.artifacts.find(item => item.id === images[1]!.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === validation.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === timeline.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === clean.id)?.status).toBe('stale');
    expect(response.job.artifacts.find(item => item.id === images[0]!.id)?.sha256).toBe('b'.repeat(64));
    expect(response.job.artifacts.find(item => item.id === images[2]!.id)?.sha256).toBe('d'.repeat(64));
    db.close();
  });
});
