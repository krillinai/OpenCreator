import type {
  CreateImageGenerationRequest,
  CreatorServicesConfig,
  ImageGenerationProvider,
  ImageGenerationQuality,
  ImageGenerationSize
} from '@opencreator/protocol';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  generateImageContents,
  ImageGenerationProviderError
} from '../../image-generation/provider.js';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateImageFile } from '../validators/image.js';

type GenerateImageContents = typeof generateImageContents;
type CoverRatio = '16:9' | '1:1' | '9:16';
type CoverImageNormalizer = (input: {
  sourcePath: string;
  outputPath: string;
  ratio: CoverRatio;
  signal: AbortSignal;
}) => Promise<{ width: number; height: number }>;

export function createImageExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  generate?: GenerateImageContents;
  normalizeCoverImage?: CoverImageNormalizer;
}): CreatorExecutor {
  const generate = input.generate ?? generateImageContents;
  return {
    id: 'image',
    async run(stage) {
      stage.reportProgress({
        status: 'running',
        phase: 'validating',
        percent: 5
      });
      const config = await input.configStore.read();
      const request = imageRequest(stage, config);
      if (!request.prompt) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Image prompt is required');
      }
      const referenceImage = await readReferenceImage(stage);

      const outputKind = stage.job.templateId === 'image-generation'
        ? 'generated_image'
        : 'cover_image';
      let completed = 0;
      let failed = 0;
      stage.reportProgress({
        status: 'running',
        phase: 'generating_candidates',
        percent: 10,
        completed,
        failed,
        total: request.count
      });
      const settled = await Promise.allSettled(
        Array.from({ length: request.count }, (_, index) => (
          generate(
            { ...request, count: 1 },
            config,
            {
              signal: stage.signal,
              ...(referenceImage === undefined ? {} : { referenceImage })
            }
          )
            .then(async result => {
              const image = result.contents[0];
              if (image === undefined) {
                throw new ImageGenerationProviderError(
                  'upstream_error',
                  'The image provider returned no images'
                );
              }
              const candidate = index + 1;
              const extension = extensionForMime(image.mime);
              const fileName = `OpenCreator-image-${candidate}.${extension}`;
              const path = join(stage.workdir, fileName);
              const coverRatio = stage.job.templateId === 'cover'
                ? readCoverRatio(stage)
                : undefined;
              const sourcePath = coverRatio !== undefined && input.normalizeCoverImage !== undefined
                ? join(stage.workdir, `OpenCreator-image-${candidate}-source.${extension}`)
                : path;
              await writeFile(sourcePath, image.content);
              let normalized: { width: number; height: number } | undefined;
              try {
                if (coverRatio !== undefined && input.normalizeCoverImage !== undefined) {
                  normalized = await input.normalizeCoverImage({
                    sourcePath,
                    outputPath: path,
                    ratio: coverRatio,
                    signal: stage.signal
                  });
                }
              } finally {
                if (sourcePath !== path) await rm(sourcePath, { force: true });
              }
              const metadata = await validateImageFile(path);
              completed += 1;
              stage.reportProgress({
                status: 'running',
                phase: 'generating_candidates',
                percent: candidateProgress(completed, failed, request.count),
                completed,
                failed,
                total: request.count
              });
              return {
                kind: outputKind,
                status: 'completed' as const,
                path,
                metadata: {
                  ...metadata,
                  provider: request.provider,
                  model: result.model,
                  candidate,
                  imageSize: request.size,
                  quality: request.quality,
                  mimeType: image.mime,
                  fileName,
                  ...(coverRatio === undefined
                    ? {}
                    : {
                        ratio: coverRatio,
                        normalizedToRatio: normalized !== undefined,
                        ...(normalized === undefined
                          ? {}
                          : {
                              width: normalized.width,
                              height: normalized.height
                            })
                      })
                }
              } satisfies CreatorExecutorOutput;
            })
            .catch(error => {
              failed += 1;
              stage.reportProgress({
                status: 'running',
                phase: 'generating_candidates',
                percent: candidateProgress(completed, failed, request.count),
                completed,
                failed,
                total: request.count
              });
              throw error;
            })
        ))
      );
      const outputs = settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
      const failures = settled.flatMap((item, index) => item.status === 'rejected'
        ? [{
            candidate: index + 1,
            message: item.reason instanceof Error ? item.reason.message : 'Image generation failed'
          }]
        : []);
      if (outputs.length === 0) {
        throw creatorImageError(settled.find(item => item.status === 'rejected')?.reason);
      }
      stage.reportProgress({
        status: failures.length > 0 ? 'partial_success' : 'succeeded',
        phase: 'completed',
        percent: 100,
        completed: outputs.length,
        failed: failures.length,
        total: request.count
      });
      return {
        outputs,
        progress: {
          status: failures.length > 0 ? 'partial_success' : 'succeeded',
          phase: 'completed',
          percent: 100,
          completed: outputs.length,
          failed: failures.length,
          total: request.count,
          failures
        }
      };
    }
  };
}

function candidateProgress(completed: number, failed: number, total: number): number {
  return 10 + Math.round(((completed + failed) / Math.max(1, total)) * 85);
}

export function createFfmpegCoverImageNormalizer(
  ffmpegPath: string
): CoverImageNormalizer {
  return async input => {
    const target = coverDimensions(input.ratio);
    await runProcess(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', input.sourcePath,
      '-vf',
      `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase,crop=${target.width}:${target.height}`,
      '-frames:v', '1',
      '-map_metadata', '-1',
      input.outputPath
    ], input.signal);
    return target;
  };
}

function imageRequest(
  stage: CreatorExecutorInput,
  config: CreatorServicesConfig
): CreateImageGenerationRequest {
  const provider = readProvider(stage.job.state.provider, config.image.provider);
  const size = stage.job.templateId === 'image-generation'
    ? readImageSize(stage.job.state.size)
    : sizeForCoverRatio(readCoverRatio(stage));
  const quality = readQuality(stage.job.state.quality);
  const maxCount = stage.job.templateId === 'image-generation' ? 4 : 8;
  const fallbackCount = stage.job.templateId === 'image-generation' ? 2 : 3;
  const candidateCount = typeof stage.job.state.candidateCount === 'number'
    ? Math.min(maxCount, Math.max(1, Math.floor(stage.job.state.candidateCount)))
    : fallbackCount;
  return {
    prompt: imagePrompt(stage),
    provider,
    size,
    quality,
    count: candidateCount
  };
}

function imagePrompt(stage: CreatorExecutorInput): string {
  const prompt = typeof stage.job.state.prompt === 'string'
    ? stage.job.state.prompt.trim()
    : '';
  if (stage.job.templateId !== 'cover') return prompt;
  const brief = [...stage.inputArtifacts].reverse().find(artifact => (
    artifact.kind === 'cover_brief'
    && typeof artifact.metadata.imagePrompt === 'string'
  ));
  const analyzed = typeof brief?.metadata.imagePrompt === 'string'
    ? brief.metadata.imagePrompt.trim()
    : '';
  if (!analyzed) return prompt;
  if (!prompt) return analyzed;
  return `${analyzed}\nAdditional user requirements: ${prompt}`;
}

async function readReferenceImage(stage: CreatorExecutorInput): Promise<{
  content: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
} | undefined> {
  const artifact = stage.inputArtifacts.find(candidate => (
    candidate.kind === 'reference_image'
  ));
  if (artifact === undefined) return undefined;
  if (artifact.path === null) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'Reference image content is unavailable'
    );
  }
  const validated = await validateImageFile(artifact.path);
  return {
    content: await readFile(artifact.path),
    mime: validated.format === 'jpeg'
      ? 'image/jpeg'
      : validated.format === 'webp'
        ? 'image/webp'
        : 'image/png'
  };
}

function readProvider(
  value: unknown,
  fallback: CreatorServicesConfig['image']['provider']
): ImageGenerationProvider {
  return value === 'openai' || value === 'jimeng' || value === 'kling' || value === 'gemini'
    ? value
    : fallback;
}

function readImageSize(value: unknown): ImageGenerationSize {
  return value === '1536x1024' || value === '1024x1536' ? value : '1024x1024';
}

function readQuality(value: unknown): ImageGenerationQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function readCoverRatio(stage: CreatorExecutorInput): CoverRatio {
  const ratio = stage.job.state.ratio;
  return ratio === '1:1' || ratio === '9:16' ? ratio : '16:9';
}

function sizeForCoverRatio(ratio: CoverRatio): ImageGenerationSize {
  if (ratio === '16:9') return '1536x1024';
  if (ratio === '9:16') return '1024x1536';
  return '1024x1024';
}

function coverDimensions(ratio: CoverRatio): { width: number; height: number } {
  if (ratio === '16:9') return { width: 1536, height: 864 };
  if (ratio === '9:16') return { width: 864, height: 1536 };
  return { width: 1024, height: 1024 };
}

function extensionForMime(mime: 'image/png' | 'image/jpeg' | 'image/webp') {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function creatorImageError(error: unknown): CreatorExecutorError {
  if (error instanceof ImageGenerationProviderError) {
    return error.code === 'config_missing'
      ? new CreatorExecutorError('creator_image_config_missing', error.message)
      : error.code === 'unsupported_capability'
        ? new CreatorExecutorError('unsupported_capability', error.message)
      : new CreatorExecutorError('image_generation_failed', error.message);
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
  }
  return new CreatorExecutorError(
    'image_generation_failed',
    error instanceof Error ? error.message : 'Image generation failed'
  );
}

function runProcess(
  command: string,
  args: string[],
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnCreatorProcess(
      command,
      args,
      { stdio: ['ignore', 'ignore', 'pipe'] },
      signal
    );
    let stderr = '';
    child.stderr?.on('data', chunk => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-2_000) || 'Cover image normalization failed'));
    });
  });
}
