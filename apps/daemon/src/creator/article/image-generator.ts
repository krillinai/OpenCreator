import type { ImageGenerationProvider } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  generateImageContents,
  ImageGenerationProviderError,
  type GeneratedImageContent,
  type CodexNativeImageRuntime
} from '../../image-generation/provider.js';
import { CreatorExecutorError } from '../executor.js';
import { resolveCreatorImageSettings } from '../image-settings.js';

export type ArticleImageGenerationResult = GeneratedImageContent & {
  provider: ImageGenerationProvider;
  model: string;
};

export function createArticleImageGenerator(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  generate?: typeof generateImageContents;
  codexNative?: CodexNativeImageRuntime;
}) {
  const generate = input.generate ?? generateImageContents;
  return {
    async generate(request: {
      prompt: string;
      signal: AbortSignal;
      cwd?: string;
    }): Promise<ArticleImageGenerationResult> {
      const config = await input.configStore.read();
      const { provider } = resolveCreatorImageSettings({
        config,
        fallbackCandidateCount: 1,
        maxCandidateCount: 1
      });
      try {
        const result = await generate({
          prompt: request.prompt,
          provider,
          size: '1536x1024',
          quality: 'medium',
          count: 1
        }, config, {
          signal: request.signal,
          ...(input.codexNative === undefined
            ? {}
            : { codexNative: input.codexNative })
        });
        const image = result.contents[0];
        if (image === undefined) {
          throw new ImageGenerationProviderError('upstream_error', 'The image provider returned no image');
        }
        return { ...image, provider, model: result.model };
      } catch (error) {
        if (error instanceof ImageGenerationProviderError) {
          throw error.code === 'config_missing'
            ? new CreatorExecutorError('creator_image_config_missing', error.message)
            : new CreatorExecutorError('image_generation_failed', error.message);
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        if (error instanceof CreatorExecutorError) throw error;
        throw new CreatorExecutorError(
          'image_generation_failed',
          error instanceof Error ? error.message : 'Article image generation failed'
        );
      }
    }
  };
}
