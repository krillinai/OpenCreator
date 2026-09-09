import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { createVideoExecutor } from '../../src/creator/video/executor.js';
import { createVideoGenerationService } from '../../src/video-generation/service.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator video generation', () => {
  it('runs video generation through Creator Job, Stage, Artifact and ResultSnapshot', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-video-generation-api-'));
    const config = createDefaultCreatorServicesConfig();
    config.video.seedance.apiKey = 'seedance-test-key';
    config.video.seedance.baseUrl = 'https://video.example.test/api/v3';
    const video = Buffer.from('creator-generated-video');
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (
        value === 'https://video.example.test/api/v3/contents/generations/tasks'
        && init?.method === 'POST'
      ) {
        return new Response(JSON.stringify({
          id: 'upstream_video_1',
          status: 'queued'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (
        value
        === 'https://video.example.test/api/v3/contents/generations/tasks/upstream_video_1'
      ) {
        return new Response(JSON.stringify({
          id: 'upstream_video_1',
          status: 'completed',
          progress: 100,
          content: { video_url: 'https://cdn.example.test/generated.mp4' }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (value === 'https://cdn.example.test/generated.mp4') {
        return new Response(video, {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' }
        });
      }
      return new Response('not found', { status: 404 });
    });
    const configStore = createConfigStore(config);
    const generationService = createVideoGenerationService({
      dataDir: tempDir,
      configStore,
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'video_result_creator_1'
    });
    const executor = createVideoExecutor({
      service: generationService,
      pollIntervalMs: 250,
      sleep: vi.fn(async () => undefined),
      probeVideo: vi.fn(async path => {
        expect(await readFile(path)).toEqual(video);
        return {
          duration: 5,
          width: 1280,
          height: 720,
          hasVideo: true,
          hasAudio: true
        };
      })
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      creatorServicesConfigStore: configStore,
      codexProviderCredentialStore: {
        async readApiKey() { return undefined; },
        async writeApiKey() {}
      },
      creatorExecutors: [executor]
    });

    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_video',
      templateId: 'video-generation',
      creationKey: 'video-generation-flow',
      state: {
        prompt: 'A cinematic coastal road',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        size: '1280x720',
        duration: 5
      }
    });
    const initial = created.json().job;
    expect(initial.templateVersion).toBe(1);

    const reference = png('video-reference');
    const uploaded = await server.inject({
      method: 'POST',
      url: `/creator/jobs/${initial.id}/reference-image`
        + `?expectedRevision=${initial.revision}`
        + '&fileName=reference.png&mime=image%2Fpng&lastModified=123',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.opencreator.creator-reference-image'
      },
      payload: reference
    });
    expect(uploaded.statusCode).toBe(201);

    const started = await request(
      'POST',
      `/creator/jobs/${initial.id}/actions`,
      {
        action: 'run-stage',
        expectedRevision: uploaded.json().job.revision,
        input: { stageId: 'generate' }
      }
    );
    expect(started.statusCode).toBe(200);

    const completed = await waitForCompletedJob(initial.id);
    expect(completed).toMatchObject({
      status: 'completed',
      state: {
        latestResultVersion: 1,
        resultSnapshots: [{
          version: 1,
          description: '生成视频',
          state: {
            model: 'doubao-seedance-2-0-260128'
          },
          artifactRefs: {
            generated_video: [expect.any(String)]
          }
        }]
      },
      stages: [{
        stageId: 'generate',
        status: 'succeeded',
        progress: {
          phase: 'completed',
          percent: 100,
          videoGenerationResultId: 'video_result_creator_1'
        }
      }]
    });
    const generatedVideo = completed.artifacts.find(
      (artifact: { kind: string }) => artifact.kind === 'generated_video'
    );
    expect(generatedVideo).toMatchObject({
      kind: 'generated_video',
      status: 'completed',
      sourceArtifactIds: [uploaded.json().artifact.id],
      metadata: {
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        videoSize: '1280x720',
        requestedDuration: 5,
        duration: 5,
        width: 1280,
        height: 720,
        hasAudio: true,
        generationMode: 'image-to-video',
        referenceArtifactId: uploaded.json().artifact.id,
        videoGenerationResultId: 'video_result_creator_1',
        resultVersion: 1
      }
    });

    const createBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(createBody.model).toBe('doubao-seedance-2-0-260128');
    expect(createBody.content).toEqual([
      { type: 'text', text: 'A cinematic coastal road' },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${reference.toString('base64')}`
        }
      }
    ]);

    const content = await request(
      'GET',
      `/creator/jobs/${initial.id}/artifacts/${generatedVideo.id}/content`
    );
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('video/mp4');
    expect(content.rawPayload).toEqual(video);
  });
});

async function waitForCompletedJob(jobId: string) {
  const deadline = Date.now() + 10_000;
  let lastJob: unknown;
  while (Date.now() < deadline) {
    const response = await request('GET', `/creator/jobs/${jobId}`);
    const job = response.json().job;
    lastJob = job;
    if (job.status === 'completed') return job;
    if (job.status === 'failed' || job.status === 'needs_input') {
      throw new Error(`Video generation failed: ${JSON.stringify(job)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for video generation: ${JSON.stringify(lastJob)}`);
}

function createConfigStore(
  config: ReturnType<typeof createDefaultCreatorServicesConfig>
): CreatorServicesConfigStore {
  return {
    async read() { return structuredClone(config); },
    async write(next) { return structuredClone(next); },
    async reset() { return structuredClone(config); }
  };
}

function png(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ]);
}

async function request(
  method: 'GET' | 'POST',
  url: string,
  payload?: object
): Promise<{ statusCode: number; json(): any; rawPayload: Buffer; headers: Record<string, string | string[] | undefined> }> {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' },
    ...(payload === undefined ? {} : { payload })
  }) as never;
}
