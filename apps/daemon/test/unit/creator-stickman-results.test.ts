import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { readCreatorResultSnapshots } from '@opencreator/protocol';
import { registerCreatorRoutes } from '../../src/api/routes.creator.js';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorEventHub } from '../../src/creator/events.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanDeliveryExecutor } from '../../src/creator/stickman/delivery-executor.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempRoot = '';
let database: ReturnType<typeof openRuntimeDatabase> | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('stickman result snapshots', () => {
  it('creates a snapshot only after package validation and keeps the previous stale result readable', async () => {
    const context = setup();
    const job = context.service.createJob({
      projectId: 'project-1',
      templateId: 'stickman-video',
      state: { topic: 'snapshot test' }
    });
    await insertInputs(context.repository, job.id, 'v1');
    expect(readCreatorResultSnapshots(context.service.getJob(job.id)!.state.resultSnapshots)).toEqual([]);

    const firstRun = await context.runner.run(job.id, 'package-validation');
    expect(firstRun.status).toBe('succeeded');
    const afterFirst = context.service.getJob(job.id)!;
    const firstSnapshots = readCreatorResultSnapshots(afterFirst.state.resultSnapshots);
    expect(firstSnapshots).toHaveLength(1);
    expect(Object.keys(firstSnapshots[0]!.artifactRefs).sort()).toEqual([
      'bilingual_subtitle',
      'bilingual_video',
      'clean_video',
      'cover_image',
      'delivery_manifest',
      'publish_copy'
    ]);
    const firstCleanId = firstSnapshots[0]!.artifactRefs.clean_video![0]!;

    await insertInputs(context.repository, job.id, 'v2');
    const secondRun = await context.runner.run(job.id, 'package-validation');
    expect(secondRun.status).toBe('succeeded');
    const afterSecond = context.service.getJob(job.id)!;
    const snapshots = readCreatorResultSnapshots(afterSecond.state.resultSnapshots);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.artifactRefs.clean_video).toEqual([firstCleanId]);
    expect(snapshots[1]!.artifactRefs.clean_video).not.toEqual([firstCleanId]);
    expect(afterSecond.artifacts.find(artifact => artifact.id === firstCleanId)?.status).toBe('stale');

    const app = Fastify();
    await registerCreatorRoutes(app, context.service, createCreatorEventHub(), {
      dispatcher: context.dispatcher,
      stageRunner: context.runner
    });
    const response = await app.inject({
      method: 'GET',
      url: `/creator/jobs/${job.id}/artifacts/${firstCleanId}/content`
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.toString()).toBe('clean-v1');
    await app.close();
  });

  it('does not create a snapshot or completed job when package validation fails', async () => {
    const context = setup();
    const job = context.service.createJob({
      projectId: 'project-1',
      templateId: 'stickman-video'
    });
    const inserted = await insertInputs(context.repository, job.id, 'bad');
    writeFileSync(inserted.clean_video.path!, 'tampered-after-hash');
    const run = await context.runner.run(job.id, 'package-validation');
    expect(run.status).toBe('failed');
    const failed = context.service.getJob(job.id)!;
    expect(failed.status).toBe('failed');
    expect(readCreatorResultSnapshots(failed.state.resultSnapshots)).toEqual([]);
  });
});

function setup() {
  tempRoot = mkdtempSync(join(tmpdir(), 'creator-stickman-results-'));
  database = openRuntimeDatabase(join(tempRoot, 'runtime.sqlite'));
  const repository = createCreatorRepository(database);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const receipts = createCreatorAgentRepository(database);
  const dispatcher = createCreatorCommandDispatcher({ service, repository, receipts });
  const runner = createCreatorStageRunner({
    repository,
    templates,
    executors: [createStickmanDeliveryExecutor({
      ffprobePath: 'unused',
      validateVideo: async () => ({
        duration: 1,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true
      })
    })],
    workRoot: join(tempRoot, 'jobs')
  });
  return { repository, service, dispatcher, runner };
}

async function insertInputs(
  repository: ReturnType<typeof createCreatorRepository>,
  jobId: string,
  label: string
) {
  const sourceRoot = join(tempRoot, 'jobs', jobId, `source-${label}`);
  mkdirSync(sourceRoot, { recursive: true });
  const files = {
    clean_video: join(sourceRoot, 'clean.mp4'),
    cover_image: join(sourceRoot, 'cover.png'),
    publish_copy: join(sourceRoot, 'copy.md'),
    bilingual_video: join(sourceRoot, 'bilingual.mp4'),
    bilingual_subtitle: join(sourceRoot, 'bilingual.srt')
  };
  writeFileSync(files.clean_video, `clean-${label}`);
  writeFileSync(files.bilingual_video, `bilingual-${label}`);
  writeFileSync(files.publish_copy, `# ${label}\n\nDescription\n\n## Tags\n\n- tag\n`);
  writeFileSync(files.bilingual_subtitle, `1\n00:00:00,000 --> 00:00:01,000\n${label}\n`);
  await sharp({ create: { width: 1280, height: 720, channels: 4, background: '#ffffff' } })
    .png()
    .toFile(files.cover_image);
  return Object.fromEntries(Object.entries(files).map(([kind, path]) => [
    kind,
    repository.insertArtifact({
      jobId,
      kind,
      status: 'completed',
      path,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      sourceArtifactIds: [],
      metadata: { fileName: path.split(/[\\/]/).at(-1) ?? kind }
    })
  ])) as Record<keyof typeof files, ReturnType<typeof repository.insertArtifact>>;
}
