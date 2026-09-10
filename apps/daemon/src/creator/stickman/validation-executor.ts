import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { stickmanShotSpecSchema, stickmanVisualValidationSchema } from './contracts.js';

type OcrResult = {
  available: boolean;
  detectedText: string[];
};

export function createStickmanValidationExecutor(input: {
  tesseractPath?: string;
  runOcr?: (path: string) => Promise<OcrResult>;
} = {}): CreatorExecutor {
  const runOcr = input.runOcr ?? (input.tesseractPath === undefined
    ? (async () => ({ available: false, detectedText: [] }))
    : (path => runTesseract(input.tesseractPath!, path)));
  return {
    id: 'stickman-validation',
    async run(stage) {
      const shotSpec = stage.inputArtifacts.find(artifact => artifact.kind === 'shot_spec');
      if (shotSpec?.path === null || shotSpec?.path === undefined) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Shot spec is required');
      }
      const value = stickmanShotSpecSchema.parse(JSON.parse(
        await readFile(shotSpec.path, 'utf8')
      ));
      const images = stage.inputArtifacts.filter(artifact => (
        artifact.kind === 'shot_image' && artifact.status === 'completed'
      ));
      const rows = [];
      const hashes = new Set<string>();
      for (const shot of value.shots) {
        const candidates = images.filter(image => image.scopeKey === shot.id);
        if (candidates.length !== 1) {
          throw new CreatorExecutorError(
            candidates.length === 0
              ? 'creator_shot_images_incomplete'
              : 'creator_shot_image_ambiguous',
            `Shot ${shot.id} requires exactly one current image`
          );
        }
        const image = candidates[0]!;
        if (image.path === null || image.sha256 === null) {
          throw new CreatorExecutorError('creator_artifact_hash_missing', `Shot ${shot.id} image is incomplete`);
        }
        const content = await readFile(image.path);
        const actualSha256 = createHash('sha256').update(content).digest('hex');
        if (actualSha256 !== image.sha256.toLowerCase()) {
          throw new CreatorExecutorError(
            'creator_shot_image_hash_mismatch',
            `Shot ${shot.id} image no longer matches its artifact hash`
          );
        }
        if (hashes.has(actualSha256)) {
          throw new CreatorExecutorError(
            'creator_shot_images_duplicate',
            `Shot ${shot.id} duplicates another generated image`
          );
        }
        hashes.add(actualSha256);
        const [metadata, stats] = await Promise.all([
          sharp(content).metadata(),
          sharp(content).greyscale().stats()
        ]);
        const width = metadata.width ?? 0;
        const height = metadata.height ?? 0;
        if (width <= 0 || height <= 0 || Math.abs(width / height - 16 / 9) > 0.03) {
          throw new CreatorExecutorError(
            'creator_shot_image_invalid',
            `Shot ${shot.id} image must be decodable 16:9 media`
          );
        }
        const brightnessMean = stats.channels[0]?.mean ?? 0;
        const contrastStddev = stats.channels[0]?.stdev ?? 0;
        if (brightnessMean < 12 || brightnessMean > 248 || contrastStddev < 8) {
          throw new CreatorExecutorError(
            'creator_shot_image_unreadable',
            `Shot ${shot.id} image appears blank or unreadable`
          );
        }
        let ocr: OcrResult;
        try {
          ocr = await runOcr(image.path);
        } catch (error) {
          throw new CreatorExecutorError(
            'creator_visual_ocr_failed',
            error instanceof Error ? error.message : `OCR failed for ${shot.id}`
          );
        }
        if (ocr.detectedText.length > 0) {
          throw new CreatorExecutorError(
            'creator_visual_text_detected',
            `Shot ${shot.id} contains prohibited visible text: ${ocr.detectedText.join(', ')}`
          );
        }
        rows.push({
          shotId: shot.id,
          imageArtifactId: image.id,
          imageSha256: actualSha256,
          width,
          height,
          brightnessMean: roundMetric(brightnessMean),
          contrastStddev: roundMetric(contrastStddev),
          ocrStatus: ocr.available ? 'passed' as const : 'unavailable' as const,
          detectedText: ocr.detectedText
        });
      }
      const unexpected = images.filter(image => !value.shots.some(shot => shot.id === image.scopeKey));
      if (unexpected.length > 0) {
        throw new CreatorExecutorError(
          'creator_shot_image_ambiguous',
          `Unexpected current shot images: ${unexpected.map(image => image.scopeKey ?? image.id).join(', ')}`
        );
      }
      const ocrStatus = rows.every(row => row.ocrStatus === 'passed') ? 'passed' as const : 'unavailable' as const;
      const warnings = ocrStatus === 'passed' ? [] : ['visual_ocr_unavailable'];
      const result = stickmanVisualValidationSchema.parse({
        ok: true,
        validation: 'automated_decode_aspect_nonblank_hash_and_ocr',
        approvedShotSpecArtifactId: shotSpec.id,
        shotCount: value.shots.length,
        ocrStatus,
        publishable: ocrStatus === 'passed',
        warnings,
        shots: rows
      });
      const path = join(stage.workdir, 'visual-validation.json');
      await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      return {
        outputs: [{
          kind: 'visual_validation',
          status: 'completed',
          path,
          sourceArtifactIds: [shotSpec.id, ...images.map(image => image.id)],
          metadata: {
            shotCount: value.shots.length,
            warningCount: warnings.length,
            ocrStatus,
            publishable: result.publishable,
            validation: result.validation
          }
        }]
      };
    }
  };
}

function runTesseract(tesseractPath: string, path: string): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    execFile(
      tesseractPath,
      [path, 'stdout', '--psm', '11', 'tsv'],
      { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Tesseract failed for ${path}: ${error.message}`));
          return;
        }
        const detectedText = String(stdout).split(/\r?\n/).slice(1).flatMap(line => {
          const columns = line.split('\t');
          const confidence = Number(columns[10]);
          const text = columns[11]?.trim() ?? '';
          const normalized = text.replace(/[^A-Za-z0-9\u3400-\u9fff]/g, '');
          return confidence >= 80 && normalized.length >= 3 ? [text] : [];
        });
        resolve({ available: true, detectedText });
      }
    );
  });
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
