import type {
  CreatorServicesConfig,
  ImageGenerationProvider,
  ImageGenerationQuality
} from '@opencreator/protocol';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import { generateImageContents } from '../../image-generation/provider.js';
import type { CreatorExecutor, CreatorExecutorInput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { CreatorProviderRequestLedger } from '../provider-requests.js';
import { validateImageFile } from '../validators/image.js';
import { stickmanContentPlanSchema, stickmanShotSpecSchema } from './contracts.js';

export class CreatorProviderAcceptanceUnknownError extends Error {
  constructor(message = 'Provider acceptance is unknown') {
    super(message);
    this.name = 'CreatorProviderAcceptanceUnknownError';
  }
}

export function createStickmanImageExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ledger: CreatorProviderRequestLedger;
  generate?: typeof generateImageContents;
}): CreatorExecutor {
  const generate = input.generate ?? generateImageContents;
  return {
    id: 'stickman-image',
    async run(stage) {
      if (stage.stageRun.stageId === 'cover') {
        return renderCover(stage, input, generate);
      }
      if (stage.stageRun.stageId !== 'images') {
        throw new CreatorExecutorError('creator_stage_not_supported', 'Unsupported stickman image stage');
      }
      const scopeKey = stage.stageRun.scopeKey;
      const inputFingerprint = stage.stageRun.inputFingerprint;
      if (scopeKey === null || inputFingerprint === null) {
        throw new CreatorExecutorError('creator_stage_scope_missing', 'Shot scope and fingerprint are required');
      }
      const shotSpecArtifact = stage.inputArtifacts.find(artifact => artifact.kind === 'shot_spec');
      if (shotSpecArtifact?.path === null || shotSpecArtifact?.path === undefined) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Approved shot spec is required');
      }
      const shotSpec = stickmanShotSpecSchema.parse(JSON.parse(
        await readFile(shotSpecArtifact.path, 'utf8')
      ));
      const shot = shotSpec.shots.find(candidate => candidate.id === scopeKey);
      if (shot === undefined) throw new CreatorExecutorError('creator_shot_not_found', 'Shot was not found');
      const config = await input.configStore.read();
      const provider = readProvider(stage.job.state.provider, config);
      const quality = readQuality(stage.job.state.quality);
      const model = config.image[provider].model;
      const requestKey = `${stage.job.id}:images:${scopeKey}:${inputFingerprint}`;
      const request = {
        prompt: [stage.job.state.style, stage.job.state.characterPrompt, shot.imagePrompt]
          .filter(value => typeof value === 'string' && value.trim().length > 0)
          .join('\n'),
        provider,
        size: '1536x1024' as const,
        quality,
        count: 1
      };
      const ledger = input.ledger.registerBeforeSubmit({
        jobId: stage.job.id,
        provider,
        stageRunId: stage.stageRun.id,
        scopeKey,
        requestKey,
        request
      });
      input.ledger.markSubmitting(ledger.id);
      stage.reportProgress({ phase: 'submitting', percent: 10, completed: 0, failed: 0, total: 1, ledgerId: ledger.id });
      try {
        const result = await generate(request, config, { signal: stage.signal });
        const image = result.contents[0];
        if (image === undefined) throw new CreatorExecutorError('image_generation_failed', 'Provider returned no image');
        const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime === 'image/webp' ? 'webp' : 'png';
        const path = join(stage.workdir, `${scopeKey}.${extension}`);
        await writeFile(path, image.content);
        const metadata = await validateImageFile(path);
        input.ledger.markSucceeded(ledger.id);
        return {
          outputs: [{
            kind: 'shot_image',
            status: 'completed',
            path,
            sourceArtifactIds: stage.inputArtifacts.map(artifact => artifact.id),
            metadata: {
              ...metadata,
              shotId: scopeKey,
              prompt: request.prompt,
              provider,
              model: result.model,
              quality,
              ledgerId: ledger.id
            }
          }],
          progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1, ledgerId: ledger.id }
        };
      } catch (error) {
        if (error instanceof CreatorProviderAcceptanceUnknownError) {
          input.ledger.markUnknownRemoteAcceptance(ledger.id);
          throw new CreatorExecutorError('creator_provider_resolution_required', error.message);
        }
        input.ledger.markFailed(ledger.id);
        throw error;
      }
    }
  };
}

async function renderCover(
  stage: CreatorExecutorInput,
  input: {
    configStore: Pick<CreatorServicesConfigStore, 'read'>;
    ledger: CreatorProviderRequestLedger;
  },
  generate: typeof generateImageContents
) {
  const planArtifact = stage.inputArtifacts.find(artifact => artifact.kind === 'content_plan');
  const cleanVideo = stage.inputArtifacts.find(artifact => artifact.kind === 'clean_video');
  if (planArtifact?.path === null || planArtifact?.path === undefined || cleanVideo === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Content plan and clean video are required');
  }
  const plan = stickmanContentPlanSchema.parse(JSON.parse(await readFile(planArtifact.path, 'utf8')));
  const config = await input.configStore.read();
  const provider = readProvider(stage.job.state.provider, config);
  const quality = readQuality(stage.job.state.quality);
  const request = {
    prompt: [
      'Create a clear 16:9 YouTube cover for a stickman knowledge video.',
      'Use a bold focal composition, high contrast, no logos, and safe space for a short title.',
      `Title: ${plan.title}`,
      `Audience: ${plan.audience}`,
      `Objective: ${plan.objective}`,
      `Outline: ${plan.outline.join('; ')}`,
      typeof stage.job.state.style === 'string' ? `Style: ${stage.job.state.style}` : ''
    ].filter(Boolean).join('\n'),
    provider,
    size: '1536x1024' as const,
    quality,
    count: 1
  };
  const requestKey = `${stage.job.id}:cover:${planArtifact.sha256 ?? planArtifact.id}:${cleanVideo.sha256 ?? cleanVideo.id}`;
  const ledger = input.ledger.registerBeforeSubmit({
    jobId: stage.job.id,
    provider,
    stageRunId: stage.stageRun.id,
    scopeKey: null,
    requestKey,
    request
  });
  input.ledger.markSubmitting(ledger.id);
  try {
    const generated = await generate(request, config, { signal: stage.signal });
    const image = generated.contents[0];
    if (image === undefined) {
      throw new CreatorExecutorError('image_generation_failed', 'Provider returned no cover image');
    }
    const path = join(stage.workdir, 'youtube-cover.png');
    await sharp(image.content)
      .resize(1280, 720, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toFile(path);
    const metadata = await validateImageFile(path);
    const dimensions = await sharp(path).metadata();
    if (dimensions.width !== 1280 || dimensions.height !== 720) {
      throw new CreatorExecutorError('creator_cover_invalid', 'Cover must be normalized to 1280x720');
    }
    input.ledger.markSucceeded(ledger.id);
    return {
      outputs: [{
        kind: 'cover_image',
        status: 'completed' as const,
        path,
        sourceArtifactIds: [planArtifact.id, cleanVideo.id],
        metadata: {
          ...metadata,
          width: 1280,
          height: 720,
          mimeType: 'image/png',
          fileName: 'youtube-cover.png',
          provider,
          model: generated.model,
          quality,
          prompt: request.prompt,
          ledgerId: ledger.id
        }
      }],
      progress: { phase: 'completed', percent: 100, ledgerId: ledger.id }
    };
  } catch (error) {
    if (error instanceof CreatorProviderAcceptanceUnknownError) {
      input.ledger.markUnknownRemoteAcceptance(ledger.id);
      throw new CreatorExecutorError('creator_provider_resolution_required', error.message);
    }
    input.ledger.markFailed(ledger.id);
    throw error;
  }
}

function readProvider(value: unknown, config: CreatorServicesConfig): ImageGenerationProvider {
  return value === 'openai' || value === 'jimeng' || value === 'kling' || value === 'gemini'
    ? value
    : config.image.provider;
}

function readQuality(value: unknown): ImageGenerationQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}
