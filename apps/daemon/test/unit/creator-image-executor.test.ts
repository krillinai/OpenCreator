import {
  createDefaultCreatorServicesConfig,
  type CreatorJob,
  type CreatorStageRun,
  type ImageGenerationProvider
} from '@opencreator/protocol';
import { access, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';
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

      const stage = stageInput({
        provider,
        candidateCount: 2,
        size: '1536x1024',
        quality: 'high'
      });
      const result = await executor.run(stage);

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
        phase: 'completed',
        percent: 100,
        completed: 2,
        failed: 0,
        total: 2
      });
      expect(stage.reportProgress).toHaveBeenNthCalledWith(1, {
        status: 'running',
        phase: 'validating',
        percent: 5
      });
      expect(stage.reportProgress).toHaveBeenNthCalledWith(2, {
        status: 'running',
        phase: 'generating_candidates',
        percent: 10,
        completed: 0,
        failed: 0,
        total: 2
      });
      expect(stage.reportProgress).toHaveBeenLastCalledWith({
        status: 'succeeded',
        phase: 'completed',
        percent: 100,
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
      phase: 'completed',
      percent: 100,
      completed: 1,
      failed: 1,
      failures: [{ candidate: 2, message: 'candidate failed' }]
    });
  });

  it('normalizes cover artifacts to the exact selected ratio', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-cover-normalize-'));
    const normalizeCoverImage = vi.fn(async (input: {
      sourcePath: string;
      outputPath: string;
      ratio: string;
    }) => {
      await copyFile(input.sourcePath, input.outputPath);
      return { width: 1536, height: 864 };
    });
    const executor = createImageExecutor({
      configStore: { read: async () => createDefaultCreatorServicesConfig() },
      generate: vi.fn(async () => ({
        model: 'gpt-image-test',
        contents: [{ content: png('cover'), mime: 'image/png' as const }]
      })) as never,
      normalizeCoverImage
    });

    const result = await executor.run(stageInput({ ratio: '16:9' }, {
      templateId: 'cover',
      templateVersion: 2
    }));

    expect(normalizeCoverImage).toHaveBeenCalledWith(expect.objectContaining({
      ratio: '16:9',
      sourcePath: expect.stringContaining('-source.png'),
      outputPath: expect.stringMatching(/OpenCreator-image-1\.png$/),
      signal: expect.any(AbortSignal)
    }));
    expect(result.outputs[0]).toMatchObject({
      kind: 'cover_image',
      metadata: {
        ratio: '16:9',
        normalizedToRatio: true,
        width: 1536,
        height: 864
      }
    });
    await expect(access(normalizeCoverImage.mock.calls[0]![0].sourcePath))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('passes a registered reference image to supported cover generation', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'creator-cover-reference-'));
    const referencePath = join(tempDir, 'reference.png');
    await writeFile(referencePath, png('reference'));
    const config = createDefaultCreatorServicesConfig();
    const generate = vi.fn(async () => ({
      model: 'gpt-image-test',
      contents: [{ content: png('cover'), mime: 'image/png' as const }]
    }));
    const executor = createImageExecutor({
      configStore: { read: async () => config },
      generate: generate as never
    });
    const input = stageInput({}, {
      templateId: 'cover',
      templateVersion: 2,
      artifacts: [{
        id: 'reference_1',
        jobId: 'image_job',
        kind: 'reference_image',
        version: 1,
        status: 'completed',
        path: referencePath,
        sourceArtifactIds: [],
        metadata: {},
        createdAt: '2026-08-26T00:00:00.000Z'
      }]
    });
    input.inputArtifacts = input.job.artifacts;

    await executor.run(input);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'A bright creative studio' }),
      config,
      expect.objectContaining({
        referenceImage: {
          content: png('reference'),
          mime: 'image/png'
        }
      })
    );
  });
});

function stageInput(
  state: Record<string, string | number>,
  jobPatch: Partial<CreatorJob> = {}
): CreatorExecutorInput {
  const createdAt = '2026-08-26T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'image_job',
    projectId: 'project_1',
    templateId: jobPatch.templateId ?? 'image-generation',
    templateVersion: jobPatch.templateVersion ?? 1,
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
    artifacts: jobPatch.artifacts ?? [],
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
