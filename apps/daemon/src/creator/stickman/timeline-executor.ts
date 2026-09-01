import { realpath, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreatorArtifact } from '@opencreator/protocol';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { stickmanShotSpecSchema, stickmanTimelineSchema } from './contracts.js';

export function createStickmanTimelineExecutor(): CreatorExecutor {
  return {
    id: 'stickman-timeline',
    async run(stage) {
      const shotSpecArtifact = requireArtifact(stage.inputArtifacts, 'shot_spec');
      const narration = requireArtifact(stage.inputArtifacts, 'narration_audio');
      if (shotSpecArtifact.path === null || narration.path === null) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Timeline file inputs are required');
      }
      if (narration.sha256 === null) {
        throw new CreatorExecutorError('creator_artifact_hash_missing', 'Narration hash is required');
      }
      const narrationDuration = narration.metadata.duration;
      if (typeof narrationDuration !== 'number' || !Number.isFinite(narrationDuration) || narrationDuration <= 0) {
        throw new CreatorExecutorError(
          'creator_audio_duration_missing',
          'Narration must include a validated positive duration'
        );
      }
      const jobRoot = dirname(resolve(stage.workdir));
      await assertInputPath(jobRoot, shotSpecArtifact.path);
      await assertInputPath(jobRoot, narration.path);
      const shotSpec = stickmanShotSpecSchema.parse(JSON.parse(
        await readFile(shotSpecArtifact.path, 'utf8')
      ));
      const images = stage.inputArtifacts.filter(artifact => (
        artifact.kind === 'shot_image' && artifact.status === 'completed'
      ));
      const fps = 30;
      const totalFrames = Math.round(narrationDuration * fps);
      if (totalFrames < shotSpec.shots.length) {
        throw new CreatorExecutorError(
          'creator_audio_too_short',
          'Narration duration cannot allocate at least one frame to every shot'
        );
      }
      const plannedDuration = shotSpec.shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
      let cursor = 0;
      let cumulativeDuration = 0;
      const shots = [];
      for (const [index, shot] of shotSpec.shots.entries()) {
        const candidates = images.filter(image => image.scopeKey === shot.id);
        if (candidates.length !== 1) {
          throw new CreatorExecutorError(
            'creator_shot_image_ambiguous',
            `Shot ${shot.id} requires exactly one current image`
          );
        }
        const image = candidates[0]!;
        if (image.path === null || image.sha256 === null) {
          throw new CreatorExecutorError('creator_artifact_hash_missing', `Shot ${shot.id} image is incomplete`);
        }
        await assertInputPath(jobRoot, image.path);
        const startFrame = cursor;
        cumulativeDuration += shot.durationSeconds;
        const proportionalEnd = Math.round((cumulativeDuration / plannedDuration) * totalFrames);
        const remainingShots = shotSpec.shots.length - index - 1;
        cursor = index === shotSpec.shots.length - 1
          ? totalFrames
          : Math.min(totalFrames - remainingShots, Math.max(startFrame + 1, proportionalEnd));
        shots.push({
          shotId: shot.id,
          startFrame,
          endFrame: cursor,
          imageArtifactId: image.id,
          audioArtifactId: narration.id,
          motion: shot.motion,
          imageSha256: image.sha256,
          audioSha256: narration.sha256,
          imagePath: image.path,
          audioPath: narration.path
        });
      }
      const timeline = stickmanTimelineSchema.parse({
        fps,
        width: 1280,
        height: 720,
        totalFrames,
        shots
      });
      const path = join(stage.workdir, 'timeline-manifest.json');
      await writeFile(path, `${JSON.stringify({ ...timeline, shots }, null, 2)}\n`, 'utf8');
      return {
        outputs: [{
          kind: 'timeline_manifest',
          status: 'completed',
          path,
          sourceArtifactIds: [
            shotSpecArtifact.id,
            narration.id,
            ...images.map(image => image.id)
          ],
          metadata: {
            fps,
            width: 1280,
            height: 720,
            totalFrames,
            duration: narrationDuration,
            shotCount: shots.length
          }
        }]
      };
    }
  };
}

async function assertInputPath(jobRoot: string, path: string): Promise<void> {
  const actual = await realpath(resolve(path));
  const value = relative(jobRoot, actual);
  if (value.startsWith('..') || isAbsolute(value)) {
    throw new CreatorExecutorError('creator_artifact_path_escape', `Artifact path escapes Job root: ${path}`);
  }
}

function requireArtifact(artifacts: CreatorArtifact[], kind: string): CreatorArtifact {
  const artifact = artifacts.find(item => item.kind === kind && item.status === 'completed');
  if (artifact === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${kind} is required`);
  }
  return artifact;
}
