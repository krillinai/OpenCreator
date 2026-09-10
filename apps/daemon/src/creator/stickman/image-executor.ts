import type { ImageGenerationProvider, ImageGenerationQuality } from '@opencreator/protocol';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import {
  generateImageContents,
  imageGenerationCapabilities
} from '../../image-generation/provider.js';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { CreatorProviderRequestLedger } from '../provider-requests.js';
import { validateImageFile } from '../validators/image.js';
import {
  stickmanImagePromptPackSchema,
  stickmanShotSpecSchema,
  stickmanStyleContractSchema
} from './contracts.js';
import {
  STICKMAN_CHARACTER_REFERENCE_PREPARATION,
  STICKMAN_IMAGE_PROMPT_CONTRACT,
  shouldUsePreviousShotReference
} from './image-prompt.js';
import { previousStickmanShotImage } from './lineage.js';
import {
  DEFAULT_STICKMAN_CHARACTER_ASSET,
  DEFAULT_STICKMAN_STYLE_ASSET,
  readVisualAssetRef
} from './visual-assets.js';

export function createStickmanImageExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ledger: CreatorProviderRequestLedger;
  generate?: typeof generateImageContents;
  tesseractPath?: string;
  validateCandidate?: (path: string) => Promise<StickmanImageCandidateQuality>;
}): CreatorExecutor {
  const generate = input.generate ?? generateImageContents;
  const validateCandidate = input.validateCandidate
    ?? (path => inspectStickmanImageCandidate(path, input.tesseractPath));
  return {
    id: 'stickman-image',
    async run(stage) {
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
      const shotIndex = shotSpec.shots.findIndex(candidate => candidate.id === scopeKey);
      const shotCount = shotSpec.shots.length;
      const promptPackArtifact = stage.inputArtifacts.find(artifact => (
        artifact.kind === 'image_prompt_pack' && artifact.status === 'completed'
      ));
      if (promptPackArtifact?.path === null || promptPackArtifact?.path === undefined) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Approved image prompt pack is required');
      }
      const promptPack = stickmanImagePromptPackSchema.parse(JSON.parse(
        await readFile(promptPackArtifact.path, 'utf8')
      ));
      const shotPrompt = promptPack.prompts.find(candidate => candidate.shotId === scopeKey);
      if (shotPrompt === undefined) {
        throw new CreatorExecutorError('creator_image_prompt_missing', `Image prompt for ${scopeKey} was not found`);
      }
      const characterReference = stage.inputArtifacts.find(artifact => (
        artifact.kind === 'character_reference' && artifact.status === 'completed'
      ));
      if (characterReference?.path === null || characterReference?.path === undefined || characterReference.sha256 === null) {
        throw new CreatorExecutorError(
          'creator_character_reference_missing',
          'A materialized character reference is required for every shot'
        );
      }
      const selectedCharacter = readVisualAssetRef(
        stage.job.state.characterAsset,
        DEFAULT_STICKMAN_CHARACTER_ASSET
      );
      const selectedStyle = readVisualAssetRef(
        stage.job.state.styleAsset,
        DEFAULT_STICKMAN_STYLE_ASSET
      );
      if (
        characterReference.metadata.assetId !== selectedCharacter.assetId
        || characterReference.metadata.revision !== selectedCharacter.revision
      ) {
        throw new CreatorExecutorError(
          'creator_character_reference_changed',
          'The materialized character does not match the selected preset'
        );
      }
      const styleContractArtifact = stage.inputArtifacts.find(artifact => (
        artifact.kind === 'style_contract' && artifact.status === 'completed'
      ));
      if (styleContractArtifact?.path === null || styleContractArtifact?.path === undefined) {
        throw new CreatorExecutorError('creator_style_contract_missing', 'Character style contract is required');
      }
      const styleContract = stickmanStyleContractSchema.parse(JSON.parse(
        await readFile(styleContractArtifact.path, 'utf8')
      ));
      if (
        styleContract.character.assetId !== selectedCharacter.assetId
        || styleContract.character.revision !== selectedCharacter.revision
        || styleContract.character.references[0]?.sha256 !== characterReference.sha256
        || styleContract.style.assetId !== selectedStyle.assetId
        || styleContract.style.revision !== selectedStyle.revision
      ) {
        throw new CreatorExecutorError(
          'creator_style_contract_stale',
          'Character reference or visual style changed after the image prompt was prepared'
        );
      }
      const sourceReferenceContent = await readFile(characterReference.path);
      const characterReferenceSha256 = createHash('sha256')
        .update(sourceReferenceContent)
        .digest('hex');
      if (characterReferenceSha256 !== characterReference.sha256) {
        throw new CreatorExecutorError(
          'creator_character_reference_changed',
          'The selected character reference no longer matches its artifact hash'
        );
      }
      const characterReferenceMime = readReferenceMime(
        characterReference.path,
        characterReference.metadata.mimeType
      );
      const styleReference = stage.inputArtifacts.find(artifact => (
        artifact.kind === 'style_reference' && artifact.status === 'completed'
      ));
      const primaryStyleReference = styleContract.style.references[0];
      if (
        (primaryStyleReference === undefined) !== (styleReference === undefined)
        || (styleReference !== undefined && (
          styleReference.path === null
          || styleReference.sha256 === null
          || styleReference.metadata.assetId !== selectedStyle.assetId
          || styleReference.metadata.revision !== selectedStyle.revision
          || styleReference.sha256 !== primaryStyleReference?.sha256
        ))
      ) {
        throw new CreatorExecutorError(
          'creator_style_contract_stale',
          'The materialized style reference does not match the selected visual style'
        );
      }
      const expectsPreviousShotReference = shouldUsePreviousShotReference(shot, shotIndex);
      const previousShotImage = previousStickmanShotImage({
        artifacts: stage.inputArtifacts,
        shotSpec,
        shotIndex
      });
      if (
        expectsPreviousShotReference
        && (
          previousShotImage?.path === null
          || previousShotImage?.path === undefined
          || previousShotImage.sha256 === null
        )
      ) {
        throw new CreatorExecutorError(
          'creator_previous_shot_reference_missing',
          `Previous shot image is required to preserve visual continuity for ${scopeKey}`
        );
      }
      const referenceImages = [{
        role: 'character_identity',
        content: sourceReferenceContent,
        mime: characterReferenceMime,
        sha256: characterReferenceSha256,
        artifactId: characterReference.id
      }];
      if (styleReference?.path !== null && styleReference?.path !== undefined) {
        const content = await readFile(styleReference.path);
        const sha256 = createHash('sha256').update(content).digest('hex');
        if (sha256 !== styleReference.sha256) {
          throw new CreatorExecutorError(
            'creator_style_reference_changed',
            'The visual style reference no longer matches its artifact hash'
          );
        }
        referenceImages.push({
          role: 'visual_style',
          content,
          mime: readReferenceMime(styleReference.path, styleReference.metadata.mimeType),
          sha256,
          artifactId: styleReference.id
        });
      }
      if (previousShotImage?.path !== null && previousShotImage?.path !== undefined) {
        const content = await readFile(previousShotImage.path);
        const sha256 = createHash('sha256').update(content).digest('hex');
        if (sha256 !== previousShotImage.sha256) {
          throw new CreatorExecutorError(
            'creator_previous_shot_reference_changed',
            'The previous shot image no longer matches its artifact hash'
          );
        }
        referenceImages.push({
          role: 'previous_shot',
          content,
          mime: readReferenceMime(previousShotImage.path, previousShotImage.metadata.mimeType),
          sha256,
          artifactId: previousShotImage.id
        });
      }
      const requestReferenceSha256 = createHash('sha256')
        .update(referenceImages.map(reference => `${reference.role}:${reference.sha256}`).join('\n'))
        .digest('hex');
      const sourceArtifactIds = [...new Set([
        ...stage.inputArtifacts
          .filter(artifact => artifact.kind !== 'shot_image')
          .map(artifact => artifact.id),
        ...(previousShotImage === undefined ? [] : [previousShotImage.id])
      ])];
      const config = await input.configStore.read();
      const provider = config.image.provider;
      const quality = readQuality(stage.job.state.quality);
      assertReferenceImageSupport(provider, referenceImages.length);
      const model = config.image[provider].model;
      if (
        promptPackArtifact.metadata.contract !== STICKMAN_IMAGE_PROMPT_CONTRACT
        || promptPack.characterReferenceArtifactId !== characterReference.id
        || promptPack.styleContractArtifactId !== styleContractArtifact.id
        || promptPack.styleReferenceArtifactId !== styleReference?.id
      ) {
        throw new CreatorExecutorError(
          'creator_image_prompt_stale',
          'The image prompt pack does not match the current visual profile'
        );
      }
      const generationPrompt = shotPrompt.prompt;
      const request = {
        prompt: generationPrompt,
        provider,
        size: '1536x1024' as const,
        quality,
        count: 1
      };
      const candidateLimit = 3;
      const candidateFailures: string[] = [];
      for (let candidateAttempt = 1; candidateAttempt <= candidateLimit; candidateAttempt += 1) {
        const candidatePrompt = candidateAttempt === 1
          ? request.prompt
          : [
              request.prompt,
              'Regenerate from scratch. The previous candidate failed an automated image-quality check.',
              'Keep the attached reference as the exact same protagonist; do not change hairstyle, eyewear, clothing silhouette, or outfit details.',
              'Do not draw any letters, words, numbers, captions, labels, signs, watermarks, or interface text.'
            ].join('\n');
        const candidateRequest = { ...request, prompt: candidatePrompt };
        const requestKey = `${stage.job.id}:images:${scopeKey}:${inputFingerprint}:candidate:${candidateAttempt}`;
        const ledger = input.ledger.registerBeforeSubmit({
          jobId: stage.job.id,
          provider,
          stageRunId: stage.stageRun.id,
          scopeKey,
          requestKey,
          request: {
            ...candidateRequest,
            model,
            characterReferenceSha256,
            requestReferenceSha256,
            characterReferenceMime,
            referenceImages: referenceImages.map(reference => ({
              role: reference.role,
              sha256: reference.sha256,
              mimeType: reference.mime,
              artifactId: reference.artifactId
            })),
            characterAsset: selectedCharacter,
            styleAsset: selectedStyle,
            referenceImagePreparation: STICKMAN_CHARACTER_REFERENCE_PREPARATION,
            imagePromptContract: STICKMAN_IMAGE_PROMPT_CONTRACT
          }
        });
        input.ledger.markSubmitting(ledger.id);
        stage.reportProgress({
          phase: candidateAttempt === 1 ? 'submitting' : 'retrying_candidate',
          percent: Math.round((
            (shotIndex + (candidateAttempt - 0.9) / candidateLimit) / shotCount
          ) * 100),
          completed: shotIndex,
          failed: candidateAttempt - 1,
          total: shotCount,
          ledgerId: ledger.id
        });
        let result: Awaited<ReturnType<typeof generate>>;
        try {
          result = await generate(candidateRequest, config, {
            signal: stage.signal,
            referenceImages: referenceImages.map(reference => ({
              content: reference.content,
              mime: reference.mime
            }))
          });
          input.ledger.markSucceeded(ledger.id);
        } catch (error) {
          input.ledger.markFailed(ledger.id);
          throw error;
        }
        const image = result.contents[0];
        if (image === undefined) {
          candidateFailures.push(`Candidate ${candidateAttempt} returned no image`);
          if (candidateAttempt < candidateLimit) continue;
          break;
        }
        const extension = image.mime === 'image/jpeg' ? 'jpg' : image.mime === 'image/webp' ? 'webp' : 'png';
        const candidatePath = join(stage.workdir, `${scopeKey}-candidate-${candidateAttempt}.${extension}`);
        await sharp(image.content)
          .resize(1280, 720, { fit: 'cover', position: 'centre' })
          .toFile(candidatePath);
        let candidateQuality: StickmanImageCandidateQuality;
        try {
          candidateQuality = await validateCandidate(candidatePath);
        } catch (error) {
          candidateFailures.push(
            error instanceof Error ? error.message : `Candidate ${candidateAttempt} failed quality checks`
          );
          if (candidateAttempt < candidateLimit) continue;
          break;
        }
        const path = join(stage.workdir, `${scopeKey}.${extension}`);
        await copyFile(candidatePath, path);
        const metadata = await validateImageFile(path);
        return {
          outputs: [{
            kind: 'shot_image',
            status: 'completed',
            path,
            sourceArtifactIds,
            metadata: {
              ...metadata,
              shotId: scopeKey,
              prompt: candidateRequest.prompt,
              provider,
              model: result.model,
              quality,
              width: candidateQuality.width,
              height: candidateQuality.height,
              brightnessMean: candidateQuality.brightnessMean,
              contrastStddev: candidateQuality.contrastStddev,
              ocrStatus: candidateQuality.ocrStatus,
              detectedText: candidateQuality.detectedText,
              characterReferenceArtifactId: characterReference.id,
              characterReferenceSha256,
              requestReferenceSha256,
              characterReferenceMime,
              referenceImages: referenceImages.map(reference => ({
                role: reference.role,
                sha256: reference.sha256,
                mimeType: reference.mime,
                artifactId: reference.artifactId
              })),
              characterAssetId: selectedCharacter.assetId,
              characterRevision: selectedCharacter.revision,
              styleAssetId: selectedStyle.assetId,
              styleRevision: selectedStyle.revision,
              ...(previousShotImage === undefined ? {} : {
                previousShotArtifactId: previousShotImage.id,
                previousShotSha256: previousShotImage.sha256
              }),
              referenceImagePreparation: STICKMAN_CHARACTER_REFERENCE_PREPARATION,
              imagePromptContract: STICKMAN_IMAGE_PROMPT_CONTRACT,
              ledgerId: ledger.id,
              candidateAttempt,
              candidateLimit,
              candidateFailures
            }
          }],
          progress: {
            phase: 'completed',
            percent: Math.round(((shotIndex + 1) / shotCount) * 100),
            completed: shotIndex + 1,
            failed: 0,
            total: shotCount,
            ledgerId: ledger.id
          }
        };
      }
      throw new CreatorExecutorError(
        'creator_shot_image_invalid',
        `Image quality retries exhausted for ${scopeKey}: ${candidateFailures.join('; ')}`
      );
    }
  };
}

type StickmanImageCandidateQuality = {
  width: number;
  height: number;
  brightnessMean: number;
  contrastStddev: number;
  ocrStatus: 'passed' | 'unavailable';
  detectedText: string[];
};

async function inspectStickmanImageCandidate(
  path: string,
  tesseractPath?: string
): Promise<StickmanImageCandidateQuality> {
  let metadata: Awaited<ReturnType<typeof sharp.prototype.metadata>>;
  let stats: Awaited<ReturnType<typeof sharp.prototype.stats>>;
  try {
    [metadata, stats] = await Promise.all([
      sharp(path).metadata(),
      sharp(path).greyscale().stats()
    ]);
  } catch {
    throw new CreatorExecutorError('creator_shot_image_invalid', 'Generated image is not decodable');
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0 || Math.abs(width / height - 16 / 9) > 0.03) {
    throw new CreatorExecutorError('creator_shot_image_invalid', 'Generated image is not 16:9');
  }
  const brightnessMean = stats.channels[0]?.mean ?? 0;
  const contrastStddev = stats.channels[0]?.stdev ?? 0;
  if (brightnessMean < 12 || brightnessMean > 248 || contrastStddev < 8) {
    throw new CreatorExecutorError(
      'creator_shot_image_unreadable',
      'Generated image appears blank or unreadable'
    );
  }
  const detectedText = tesseractPath === undefined
    ? []
    : await runCandidateTesseract(tesseractPath, path);
  if (detectedText.length > 0) {
    throw new CreatorExecutorError(
      'creator_visual_text_detected',
      `Generated image contains prohibited visible text: ${detectedText.join(', ')}`
    );
  }
  return {
    width,
    height,
    brightnessMean: roundMetric(brightnessMean),
    contrastStddev: roundMetric(contrastStddev),
    ocrStatus: tesseractPath === undefined ? 'unavailable' : 'passed',
    detectedText
  };
}

function runCandidateTesseract(tesseractPath: string, path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      tesseractPath,
      [path, 'stdout', '--psm', '11', 'tsv'],
      { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new CreatorExecutorError(
            'creator_visual_ocr_failed',
            `Tesseract failed for ${path}: ${error.message}`
          ));
          return;
        }
        resolve(String(stdout).split(/\r?\n/).slice(1).flatMap(line => {
          const columns = line.split('\t');
          const confidence = Number(columns[10]);
          const text = columns[11]?.trim() ?? '';
          const normalized = text.replace(/[^A-Za-z0-9\u3400-\u9fff]/g, '');
          return confidence >= 80 && normalized.length >= 3 ? [text] : [];
        }));
      }
    );
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function assertReferenceImageSupport(provider: ImageGenerationProvider, count: number): void {
  const capabilities = imageGenerationCapabilities(provider);
  if (capabilities.supportsReferenceImage && capabilities.maxReferenceImages >= count) return;
  throw new CreatorExecutorError(
    'creator_stickman_image_provider_unsupported',
    `当前生图服务 ${provider} 不支持任务需要的 ${count} 张参考图。请在 AI 服务 -> 生图服务中切换到支持多参考图的 OpenAI 或 Gemini 服务`
  );
}

function readReferenceMime(
  path: string,
  configured: unknown
): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (configured === 'image/jpeg' || configured === 'image/webp') return configured;
  if (configured === 'image/png') return configured;
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  return 'image/png';
}

function readQuality(value: unknown): ImageGenerationQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}
