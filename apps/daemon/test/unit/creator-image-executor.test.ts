import {
  createDefaultCreatorServicesConfig,
  type CreatorJob,
  type CreatorStageRun,
  type ImageGenerationProvider
} from '@opencreator/protocol';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageExecutor } from '../../src/creator/image/executor.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator image executor', () => {
  it.each(['openai', 'jimeng', 'kling', 'gemini'] as const)(
    'creates generated_image artifacts with %s metadata',
    async provider => {
      tempDir = await mkdtemp(join(tmpdir(), 'creator-image-executor-'));
      const config = createDefaultCreatorServicesConfig();
      const generate = vi.fn(async (request: { provider: ImageGenerationProvider }) => ({
        model: `${request.provider}-model`,
        contents: [{ content: png(`image-${request.provider}`), mime: 'image/png' as const }]
      }));
      const executor = createImageExecutor({
        configStore: { read: async () => config },
        generate: generate as never
      });

      const result = await executor.run(stageInput({
        provider,
        candidateCount: 2,
        size: '1536x1024',
        quality: 'high'
      }));

      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ provider, count: 1 }),
        config,
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result.outputs).toHaveLength(2);
      expect(result.outputs[0]).toMatchObject({
        kind: 'generated_image',
        status: 'completed',
        metadata: {
          provider,
          model: `${provider}-model`,
          candidate: 1,
          imageSize: '1536x1024',
          quality: 'high',
          mimeType: 'image/png'
        }
      });
      expect(result.progress).toMatchObject({
        status: 'succeeded',
        completed: 2,
        failed: 0,
        total: 2
      });
    }
  );

  it('keeps successful candidates when another candidate fails', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-image-executor-partial-'));
    let candidate = 0;
    const executor = createImageExecutor({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      generate: vi.fn(async () => {
        candidate += 1;
        if (candidate === 2) throw new Error('candidate failed');
        return {
          model: 'gpt-image-test',
          contents: [{ content: png(`candidate-${candidate}`), mime: 'image/png' as const }]
        };
      }) as never
    });

    const result = await executor.run(stageInput({ candidateCount: 2 }));

    expect(result.outputs).toHaveLength(1);
    expect(result.progress).toMatchObject({
      status: 'partial_success',
      completed: 1,
      failed: 1,
      failures: [{ candidate: 2, message: 'candidate failed' }]
    });
  });
});

function stageInput(state: Record<string, string | number>) {
  const createdAt = '2026-08-26T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'image_job',
    projectId: 'project_1',
    templateId: 'image-generation',
    templateVersion: 1,
    status: 'running',
    revision: 1,
    state: {
      prompt: 'A bright creative studio',
      provider: 'openai',
      size: '1024x1024',
      quality: 'medium',
      candidateCount: 1,
      currentStage: 'generate',
      ...state
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
  const stageRun: CreatorStageRun = {
    id: 'image_stage',
    jobId: job.id,
    stageId: 'generate',
    executor: 'image',
    status: 'running',
    dispatchStatus: 'claimed',
    claimOwner: 'test',
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: null,
    progress: {},
    errorCode: null,
    errorMessage: null,
    startedAt: createdAt,
    finishedAt: null
  };
  return {
    stageRun,
    job,
    inputArtifacts: [],
    workdir: tempDir,
    signal: new AbortController().signal,
    reportProgress: vi.fn()
  };
}

function png(label: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(16, '.'))
  ]);
}
