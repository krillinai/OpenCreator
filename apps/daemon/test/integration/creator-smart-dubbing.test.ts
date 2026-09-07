import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { createSmartDubbingExecutor } from '../../src/creator/smart-dubbing/executor.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator smart dubbing', () => {
  it('runs TTS through Creator Job, Stage, Artifact and ResultSnapshot', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-smart-dubbing-'));
    const config = createDefaultCreatorServicesConfig();
    const audio = Buffer.from('creator-smart-dubbing-audio');
    const synthesize = vi.fn(async () => ({
      content: audio,
      mime: 'audio/mpeg' as const,
      provider: 'openai' as const,
      model: 'gpt-4o-mini-tts',
      voiceId: 'nova',
      format: 'mp3' as const
    }));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      creatorExecutors: [createSmartDubbingExecutor({ ttsService: { synthesize } })],
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
      id: 'smart-dubbing',
      outputs: [{ kind: 'dubbed_audio', required: true }]
    }));

    const created = await request('POST', '/creator/jobs', {
      projectId: 'project_dubbing',
      templateId: 'smart-dubbing'
    });
    const initial = created.json().job;
    const updated = await request('POST', `/creator/jobs/${initial.id}/actions`, {
      action: 'update-settings',
      expectedRevision: initial.revision,
      input: {
        patch: {
          text: '这是一段独立的智能配音文案。',
          ttsProvider: 'openai',
          ttsModel: 'gpt-4o-mini-tts',
          voiceCode: 'nova',
          voiceName: 'Nova',
          style: 'warm',
          speed: 1.05,
          format: 'mp3'
        }
      }
    });
    const started = await request('POST', `/creator/jobs/${initial.id}/actions`, {
      action: 'run-stage',
      expectedRevision: updated.json().job.revision,
      input: { stageId: 'tts' }
    });
    expect(started.statusCode).toBe(200);

    const completed = await waitForCompletedJob(initial.id);
    expect(completed).toMatchObject({
      status: 'completed',
      state: {
        latestResultVersion: 1,
        resultSnapshots: [{
          version: 1,
          stageId: 'tts',
          artifactRefs: { dubbed_audio: [expect.any(String)] }
        }]
      },
      stages: [{
        stageId: 'tts',
        executor: 'smart-dubbing',
        status: 'succeeded',
        progress: {
          phase: 'completed',
          percent: 100,
          completed: 1,
          failed: 0,
          total: 1
        }
      }]
    });
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      text: '这是一段独立的智能配音文案。',
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voiceId: 'nova',
      format: 'mp3',
      speed: 1.05,
      instructions: expect.stringContaining('warm'),
      signal: expect.any(AbortSignal)
    }));

    const artifact = completed.artifacts.find((item: { kind: string }) => (
      item.kind === 'dubbed_audio'
    ));
    expect(artifact).toMatchObject({
      status: 'completed',
      metadata: {
        fileName: 'OpenCreator-dubbing.mp3',
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voiceCode: 'nova',
        voiceName: 'Nova',
        style: 'warm',
        speed: 1.05,
        format: 'mp3',
        resultVersion: 1
      }
    });

    const content = await request(
      'GET',
      `/creator/jobs/${initial.id}/artifacts/${artifact.id}/content`
    );
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload).toEqual(audio);
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
      throw new Error(`Smart dubbing failed: ${JSON.stringify(job)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for smart dubbing: ${JSON.stringify(lastJob)}`);
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
