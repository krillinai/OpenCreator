import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { stickmanShotSpecSchema } from './contracts.js';

export function createStickmanValidationExecutor(): CreatorExecutor {
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
      const missing = value.shots.filter(shot => !images.some(image => image.scopeKey === shot.id));
      if (missing.length > 0) {
        throw new CreatorExecutorError(
          'creator_shot_images_incomplete',
          `Missing shot images: ${missing.map(shot => shot.id).join(', ')}`
        );
      }
      const result = {
        approvedShotSpecArtifactId: shotSpec.id,
        shotCount: value.shots.length,
        warnings: [] as string[]
      };
      const path = join(stage.workdir, 'visual-validation.json');
      await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      return {
        outputs: [{
          kind: 'visual_validation',
          status: 'completed',
          path,
          sourceArtifactIds: [shotSpec.id, ...images.map(image => image.id)],
          metadata: { shotCount: value.shots.length, warningCount: 0 }
        }]
      };
    }
  };
}
