import type {
  CreateImageGenerationRequest,
  CreatorServicesConfig,
  ImageGenerationProvider,
  ImageGenerationQuality,
  ImageGenerationSize
} from '@opencreator/protocol';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  generateImageContents,
  ImageGenerationProviderError
} from '../../image-generation/provider.js';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateImageFile } from '../validators/image.js';

type GenerateImageContents = typeof generateImageContents;

export function createImageExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  generate?: GenerateImageContents;
}): CreatorExecutor {
  const generate = input.generate ?? generateImageContents;
  return {
    id: 'image',
    async run(stage) {
      const config = await input.configStore.read();
      const request = imageRequest(stage, config);
      if (!request.prompt) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Image prompt is required');
      }
      if (stage.inputArtifacts.some(artifact => artifact.kind === 'reference_image')) {
        throw new CreatorExecutorError(
          'unsupported_capability',
          'Selected image provider cannot edit a reference image'
        );
      }

      const outputKind = stage.job.templateId === 'image-generation'
        ? 'generated_image'
        : 'cover_image';
      let completed = 0;
      let failed = 0;
      const settled = await Promise.allSettled(
        Array.from({ length: request.count }, (_, index) => (
          generate({ ...request, count: 1 }, config, { signal: stage.signal })
            .then(async result => {
              const image = result.contents[0];
              if (image === undefined) {
                throw new ImageGenerationProviderError(
                  'upstream_error',
                  'The image provider returned no images'
                );
              }
              const candidate = index + 1;
              const fileName = `OpenCreator-image-${candidate}.${extensionForMime(image.mime)}`;
              const path = join(stage.workdir, fileName);
              await writeFile(path, image.content);
              const metadata = await validateImageFile(path);
              completed += 1;
              stage.reportProgress({
                status: 'running',
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
                  bytes: image.content.length,
                  fileName,
                  ...(stage.job.templateId === 'cover'
                    ? { ratio: readCoverRatio(stage) }
                    : {})
                }
              } satisfies CreatorExecutorOutput;
            })
            .catch(error => {
              failed += 1;
              stage.reportProgress({
                status: 'running',
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
      return {
        outputs,
        progress: {
          status: failures.length > 0 ? 'partial_success' : 'succeeded',
          completed: outputs.length,
          failed: failures.length,
          total: request.count,
          failures
        }
      };
    }
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
    prompt: typeof stage.job.state.prompt === 'string' ? stage.job.state.prompt.trim() : '',
    provider,
    size,
    quality,
    count: candidateCount
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

function readCoverRatio(stage: CreatorExecutorInput): '16:9' | '1:1' | '9:16' {
  const ratio = stage.job.state.ratio;
  return ratio === '1:1' || ratio === '9:16' ? ratio : '16:9';
}

function sizeForCoverRatio(ratio: '16:9' | '1:1' | '9:16'): ImageGenerationSize {
  if (ratio === '16:9') return '1536x1024';
  if (ratio === '9:16') return '1024x1536';
  return '1024x1024';
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
