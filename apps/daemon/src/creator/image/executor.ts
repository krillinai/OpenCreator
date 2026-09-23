import type {
  CoverStyleId,
  CoverTextLanguage,
  CreateImageGenerationRequest,
  ImageGenerationQuality,
  ImageGenerationSize
} from '@opencreator/protocol';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  generateImageContents,
  ImageGenerationProviderError,
  type CodexNativeImageRuntime
} from '../../image-generation/provider.js';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateImageFile } from '../validators/image.js';
import { resolveCreatorImageSettings } from '../image-settings.js';
import {
  coverLanguageLabel,
  coverStyleInstructions,
  readCoverStyle,
  readCoverTextLanguage
} from '../cover/styles.js';

type GenerateImageContents = typeof generateImageContents;
type CoverRatio = '16:9' | '1:1' | '9:16';
type GenerationReferenceKind = 'reference_image' | 'source_keyframe';
type GenerationReferenceImage = {
  artifactId: string;
  kind: GenerationReferenceKind;
  content: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
};
type CoverGenerationDetails = {
  style: CoverStyleId;
  language: CoverTextLanguage;
  headline: string;
  subheadline: string;
  emphasisTerms: string[];
};
type ImageRequestContext = {
  request: CreateImageGenerationRequest;
  cover?: CoverGenerationDetails;
};
type CoverImageNormalizer = (input: {
  sourcePath: string;
  outputPath: string;
  ratio: CoverRatio;
  signal: AbortSignal;
}) => Promise<{ width: number; height: number }>;

export function createImageExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  generate?: GenerateImageContents;
  codexNative?: CodexNativeImageRuntime;
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
      const referenceImage = await readReferenceImage(stage);
      if (
        stage.job.templateId === 'cover'
        && stage.job.state.sourceType === 'youtube'
        && referenceImage === undefined
      ) {
        throw new CreatorExecutorError(
          'creator_cover_reference_missing',
          'The YouTube thumbnail reference is unavailable'
        );
      }
      const requestContext = imageRequest(stage, config, referenceImage?.kind);
      const { request } = requestContext;
      if (!request.prompt) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Image prompt is required');
      }
      if (request.provider === 'codex-native' && request.count !== 1) {
        throw new CreatorExecutorError(
          'unsupported_capability',
          'Codex subscription image generation supports exactly one candidate per task'
        );
      }

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
              ...(referenceImage === undefined
                ? {}
                : {
                    referenceImage: {
                      content: referenceImage.content,
                      mime: referenceImage.mime
                    }
                  }),
              ...(input.codexNative === undefined
                ? {}
                : { codexNative: input.codexNative })
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
                  ...(referenceImage === undefined
                    ? {}
                    : {
                        referenceArtifactId: referenceImage.artifactId,
                        referenceArtifactKind: referenceImage.kind
                      }),
                  ...(requestContext.cover === undefined
                    ? {}
                    : {
                        coverStyle: requestContext.cover.style,
                        coverTextLanguage: requestContext.cover.language,
                        headline: requestContext.cover.headline,
                        subheadline: requestContext.cover.subheadline,
                        emphasisTerms: requestContext.cover.emphasisTerms
                      }),
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
  config: Awaited<ReturnType<CreatorServicesConfigStore['read']>>,
  referenceKind?: GenerationReferenceKind
): ImageRequestContext {
  const maxCount = stage.job.templateId === 'image-generation' ? 4 : 8;
  const fallbackCount = stage.job.templateId === 'image-generation' ? 2 : 3;
  const settings = resolveCreatorImageSettings({
    config,
    provider: stage.job.state.provider,
    candidateCount: stage.job.state.candidateCount,
    fallbackCandidateCount: fallbackCount,
    maxCandidateCount: maxCount
  });
  const size = stage.job.templateId === 'image-generation'
    ? readImageSize(stage.job.state.size)
    : sizeForCoverRatio(readCoverRatio(stage));
  const quality = readQuality(stage.job.state.quality);
  const cover = stage.job.templateId === 'cover'
    ? coverGenerationPrompt(stage, referenceKind)
    : undefined;
  return {
    request: {
      prompt: cover?.prompt ?? readString(stage.job.state.prompt),
      provider: settings.provider,
      size,
      quality,
      count: settings.candidateCount
    },
    ...(cover === undefined ? {} : { cover: cover.details })
  };
}

function coverGenerationPrompt(
  stage: CreatorExecutorInput,
  referenceKind?: GenerationReferenceKind
): { prompt: string; details: CoverGenerationDetails } {
  const userPrompt = readString(stage.job.state.prompt);
  const brief = [...stage.inputArtifacts].reverse().find(artifact => (
    artifact.kind === 'cover_brief' && artifact.status === 'completed'
  ));
  const headline = readString(stage.job.state.coverHeadline)
    || readMetadataString(brief, 'headline');
  const subheadline = readString(stage.job.state.coverSubheadline)
    || readMetadataString(brief, 'subheadline');
  const language = readCoverTextLanguage(
    readMetadataString(brief, 'language') || stage.job.state.resolvedCoverTextLanguage
  );
  const style = readCoverStyle(stage.job.state.coverStyle);
  const customStyle = readString(stage.job.state.customStylePrompt);
  const emphasisTerms = readMetadataStringArray(brief, 'emphasisTerms');
  if (stage.job.state.sourceType === 'youtube' && !headline) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'The analyzed YouTube cover headline is unavailable'
    );
  }

  const referenceInstructions = referenceKind === 'source_keyframe'
    ? [
        'REFERENCE IMAGE:',
        'The attached image is the original YouTube thumbnail and is the primary visual reference.',
        'Keep its recognizable core subject, important objects, subject relationships, and visual connection to the source video.',
        'You may redesign layout, lighting, color treatment, and typography for the selected style, but do not replace it with unrelated people, objects, or scenes.'
      ].join('\n')
    : referenceKind === 'reference_image'
      ? [
          'REFERENCE IMAGE:',
          'Use the attached user-provided image as the primary subject and composition reference.',
          'Preserve its recognizable subject and important visual relationships while adapting the complete thumbnail to the selected style.'
        ].join('\n')
      : [
          'REFERENCE IMAGE:',
          'No reference image is attached. Follow the supplied content direction without adding unsupported claims.'
        ].join('\n');
  const exactText = headline
    ? [
        'EXACT COVER TEXT:',
        `Language: ${coverLanguageLabel(language)} (${language})`,
        `Headline: ${JSON.stringify(headline)}`,
        ...(subheadline ? [`Subheadline: ${JSON.stringify(subheadline)}`] : []),
        ...(emphasisTerms.length > 0
          ? [`Visually emphasize these exact terms when they appear: ${JSON.stringify(emphasisTerms)}`]
          : []),
        'Render the supplied characters accurately and legibly as part of the image.',
        'Do not translate, rewrite, omit, misspell, duplicate, or add any other visible words.'
      ].join('\n')
    : [
        'COVER TEXT:',
        `Use ${coverLanguageLabel(language)} (${language}) for any visible cover text.`,
        'Only add text that is directly supported by the user content direction.'
      ].join('\n');
  const additional = userPrompt
    ? [
        'ADDITIONAL USER REQUIREMENTS:',
        userPrompt
      ].join('\n')
    : '';
  return {
    prompt: [
      'Create a finished, publication-ready video thumbnail in one image-generation pass.',
      'The returned image must already contain the complete visual design and all required text. Do not return a text-free background or a separate typography layer.',
      referenceInstructions,
      exactText,
      'SELECTED VISUAL STYLE:',
      coverStyleInstructions(style, customStyle),
      'COMPOSITION AND OUTPUT:',
      'Make the headline the first visual priority and readable at small thumbnail size.',
      style === 'custom' && customStyle
        ? 'Keep text clear of the main subject, preserve any headline line layout explicitly requested in the custom style, otherwise use at most two headline lines, and make any subheadline visibly secondary.'
        : 'Keep text clear of the main subject, use at most two headline lines, and make any subheadline visibly secondary.',
      'Integrate typography, reference subject, color, lighting, and composition into one coherent final image.',
      additional
    ].filter(Boolean).join('\n\n'),
    details: {
      style,
      language,
      headline,
      subheadline,
      emphasisTerms
    }
  };
}

async function readReferenceImage(
  stage: CreatorExecutorInput
): Promise<GenerationReferenceImage | undefined> {
  const artifact = stage.inputArtifacts.find(candidate => candidate.kind === 'reference_image')
    ?? (stage.job.templateId === 'cover' && stage.job.state.sourceType === 'youtube'
      ? stage.inputArtifacts.find(candidate => candidate.kind === 'source_keyframe')
      : undefined);
  if (artifact === undefined) return undefined;
  if (artifact.path === null) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'Reference image content is unavailable'
    );
  }
  const validated = await validateImageFile(artifact.path);
  return {
    artifactId: artifact.id,
    kind: artifact.kind as GenerationReferenceKind,
    content: await readFile(artifact.path),
    mime: validated.format === 'jpeg'
      ? 'image/jpeg'
      : validated.format === 'webp'
        ? 'image/webp'
        : 'image/png'
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMetadataString(
  artifact: CreatorExecutorInput['inputArtifacts'][number] | undefined,
  key: string
): string {
  return readString(artifact?.metadata[key]);
}

function readMetadataStringArray(
  artifact: CreatorExecutorInput['inputArtifacts'][number] | undefined,
  key: string
): string[] {
  const value = artifact?.metadata[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => typeof item === 'string' && item.trim() ? [item.trim()] : []);
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
