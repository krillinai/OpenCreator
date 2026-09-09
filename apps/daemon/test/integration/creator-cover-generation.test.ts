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

describe('creator cover generation', () => {
  it('generates, previews, uploads a reference and uses the latest first candidate as project cover', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-cover-api-'));
    const config = createDefaultCreatorServicesConfig();
    config.image.openai.apiKey = 'image-key';
    config.image.openai.baseUrl = 'https://images.example.test/v1/images/generations';
    let requestIndex = 0;
    const generated = new Map<number, Buffer>();
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requestIndex += 1;
      const url = String(input);
      const image = png(`cover-${requestIndex}`);
      generated.set(requestIndex, image);
      expect(url).toMatch(/\/images\/(?:generations|edits)$/);
      return new Response(JSON.stringify({
        data: [{ b64_json: image.toString('base64') }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
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

    const created = await jsonRequest('POST', '/creator/jobs', {
      projectId: 'project_cover',
      templateId: 'cover',
      creationKey: 'cover-generation-flow',
      state: {
        prompt: 'A cinematic creator portrait',
        ratio: '16:9',
        candidateCount: 2
      }
    });
    expect(created.json().job.templateVersion).toBe(2);
    const started = await jsonRequest('POST', `/creator/jobs/${created.json().job.id}/actions`, {
      action: 'run-stage',
      expectedRevision: created.json().job.revision,
      input: { stageId: 'generate', workflow: true }
    });
    expect(started.statusCode).toBe(200);

    const first = await waitForCompletedJob(created.json().job.id, 1);
    expect(first.state.resultSnapshots).toMatchObject([{
      version: 1,
      description: '生成封面',
      artifactRefs: {
        cover_image: expect.arrayContaining([expect.any(String), expect.any(String)])
      }
    }]);
    expect(first.artifacts.filter((artifact: { kind: string }) => (
      artifact.kind === 'cover_image'
    ))).toHaveLength(2);

    const reference = png('reference');
    const uploaded = await server.inject({
      method: 'POST',
      url: `/creator/jobs/${first.id}/reference-image?expectedRevision=${first.revision}&fileName=reference.png&mime=image%2Fpng&lastModified=123`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.opencreator.creator-reference-image'
      },
      payload: reference
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      job: {
        state: { referenceImageArtifactId: expect.any(String) }
      },
      artifact: {
        kind: 'reference_image',
        metadata: {
          fileName: 'reference.png',
          source: 'local-upload'
        }
      }
    });

    const regenerated = await jsonRequest(
      'POST',
      `/creator/jobs/${first.id}/actions`,
      {
        action: 'run-stage',
        expectedRevision: uploaded.json().job.revision,
        input: { stageId: 'generate', workflow: true }
      }
    );
    expect(regenerated.statusCode).toBe(200);
    const second = await waitForCompletedJob(first.id, 2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.slice(2).every(call => (
      String(call[0]).endsWith('/images/edits')
    ))).toBe(true);
    const secondVersion = second.state.resultSnapshots[1];
    expect(secondVersion.artifactRefs.reference_image).toEqual([
      uploaded.json().artifact.id
    ]);
    const projectCoverId = secondVersion.artifactRefs.cover_image[0];
    expect(second.state).not.toHaveProperty('selectedCoverArtifactId');

    const artifactContent = await rawRequest(
      'GET',
      `/creator/jobs/${first.id}/artifacts/${projectCoverId}/content`
    );
    const projectCover = await rawRequest('GET', `/creator/jobs/${first.id}/cover`);
    expect(projectCover.statusCode).toBe(200);
    expect(projectCover.rawPayload).toEqual(artifactContent.rawPayload);
  });
});

async function waitForCompletedJob(jobId: string, version: number) {
  const deadline = Date.now() + 10_000;
  let lastJob: unknown;
  while (Date.now() < deadline) {
    const response = await jsonRequest('GET', `/creator/jobs/${jobId}`);
    const job = response.json().job;
    lastJob = job;
    if (job.status === 'completed' && job.state.latestResultVersion === version) return job;
    if (job.status === 'failed' || job.status === 'needs_input') {
      throw new Error(`Cover generation failed: ${JSON.stringify(job)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for cover generation: ${JSON.stringify(lastJob)}`);
}

async function jsonRequest(
  method: 'GET' | 'POST',
  url: string,
  payload?: object
) {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' },
    ...(payload === undefined ? {} : { payload })
  });
}

async function rawRequest(method: 'GET', url: string) {
  return await server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' }
  });
}

function png(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ]);
}
