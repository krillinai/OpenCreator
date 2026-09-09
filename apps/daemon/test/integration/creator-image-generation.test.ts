import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
  vi.unstubAllGlobals();
});

describe('creator image generation', () => {
  it('runs image generation through Creator Job, Stage, Artifact and ResultSnapshot', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-image-api-'));
    const config = createDefaultCreatorServicesConfig();
    config.image.openai.apiKey = 'image-test-key';
    config.image.openai.baseUrl = 'https://images.example.test/v1';
    const image = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('creator-runtime-image')
    ]);
    const fetchImpl = vi.fn(async (_input: string | URL | Request) => new Response(JSON.stringify({
      data: [{ b64_json: image.toString('base64') }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchImpl);
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      creatorServicesConfigStore: {
        async read() { return structuredClone(config); },
        async write(next) { return structuredClone(next); },
        async reset() { return structuredClone(config); }
      },
      codexProviderCredentialStore: {
        async readApiKey() { return undefined; },
        async writeApiKey() {}
      }
    });

    const templates = await request('GET', '/creator/templates');
    expect(templates.json().templates).toContainEqual(expect.objectContaining({
      id: 'image-generation',
      outputs: [{ kind: 'generated_image', required: true }]
    }));
    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_image',
      templateId: 'image-generation',
      creationKey: 'image-generation-flow'
    });
    const initial = created.json().job;
    expect(initial.templateVersion).toBe(2);
    const updated = await request('POST', `/creator/jobs/${initial.id}/actions`, {
      action: 'update-settings',
      expectedRevision: initial.revision,
      input: {
        patch: {
          prompt: 'A bright creative studio',
          provider: 'openai',
          size: '1536x1024',
          quality: 'high',
          candidateCount: 2
        }
      }
    });
    const reference = png('image-reference');
    const uploaded = await server.inject({
      method: 'POST',
      url: `/creator/jobs/${initial.id}/reference-image?expectedRevision=${updated.json().job.revision}&fileName=reference.png&mime=image%2Fpng&lastModified=123`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.opencreator.creator-reference-image'
      },
      payload: reference
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      job: { state: { referenceImageArtifactId: expect.any(String) } },
      artifact: { kind: 'reference_image' }
    });
    const started = await request('POST', `/creator/jobs/${initial.id}/actions`, {
      action: 'run-stage',
      expectedRevision: uploaded.json().job.revision,
      input: { stageId: 'generate' }
    });
    expect(started.statusCode).toBe(200);

    const completed = await waitForCompletedJob(initial.id);
    expect(completed).toMatchObject({
      status: 'completed',
      state: {
        latestResultVersion: 1,
        resultSnapshots: [{
          version: 1,
          artifactRefs: {
            generated_image: expect.arrayContaining([
              expect.any(String),
              expect.any(String)
            ]),
            reference_image: [uploaded.json().artifact.id]
          }
        }]
      },
      stages: [{
        stageId: 'generate',
        status: 'succeeded',
        progress: {
          status: 'succeeded',
          completed: 2,
          failed: 0
        }
      }]
    });
    const generatedImages = completed.artifacts.filter((artifact: { kind: string }) => (
      artifact.kind === 'generated_image'
    ));
    expect(generatedImages).toHaveLength(2);
    expect(generatedImages[0]).toMatchObject({
      kind: 'generated_image',
      status: 'completed',
      metadata: {
        provider: 'openai',
        model: 'gpt-image-1',
        imageSize: '1536x1024',
        quality: 'high',
        resultVersion: 1
      }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(call => String(call[0]).endsWith('/images/edits')))
      .toBe(true);

    const content = await request(
      'GET',
      `/creator/jobs/${initial.id}/artifacts/${generatedImages[0].id}/content`
    );
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload).toEqual(image);
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
      throw new Error(`Image generation failed: ${JSON.stringify(job)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for image generation: ${JSON.stringify(lastJob)}`);
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
): Promise<{ statusCode: number; json(): any; rawPayload: Buffer }> {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' },
    ...(payload === undefined ? {} : { payload })
  }) as never;
}
