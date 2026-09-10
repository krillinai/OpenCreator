import { realpath, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CreatorArtifact } from '@opencreator/protocol';
import type { CreatorExecutor, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import {
  stickmanAudioTimingSchema,
  stickmanScriptManifestSchema,
  stickmanShotSpecSchema,
  stickmanTimelineSchema
} from './contracts.js';
import { renderStickmanTimedNarrationSrt } from './narration-subtitle.js';

export function createStickmanTimelineExecutor(): CreatorExecutor {
  return {
    id: 'stickman-timeline',
    async run(stage) {
      const shotSpecArtifact = requireArtifact(stage.inputArtifacts, 'shot_spec');
      const scriptArtifact = requireArtifact(stage.inputArtifacts, 'script_manifest');
      const timingArtifact = requireArtifact(stage.inputArtifacts, 'audio_timing');
      if (
        shotSpecArtifact.path === null
        || scriptArtifact.path === null
        || timingArtifact.path === null
      ) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Timeline file inputs are required');
      }
      const jobRoot = dirname(resolve(stage.workdir));
      await assertInputPath(jobRoot, shotSpecArtifact.path);
      await assertInputPath(jobRoot, scriptArtifact.path);
      await assertInputPath(jobRoot, timingArtifact.path);
      const shotSpec = stickmanShotSpecSchema.parse(JSON.parse(
        await readFile(shotSpecArtifact.path, 'utf8')
      ));
      const script = stickmanScriptManifestSchema.parse(JSON.parse(
        await readFile(scriptArtifact.path, 'utf8')
      ));
      const timing = stickmanAudioTimingSchema.parse(JSON.parse(
        await readFile(timingArtifact.path, 'utf8')
      ));
      const images = stage.inputArtifacts.filter(artifact => (
        artifact.kind === 'shot_image' && artifact.status === 'completed'
      ));
      const narration = stage.inputArtifacts.filter(artifact => (
        artifact.kind === 'narration_audio' && artifact.status === 'completed'
      ));
      const timingBySegment = new Map(timing.segments.map(segment => [segment.segmentId, segment]));
      const fps = 30;
      const totalFrames = Math.round(timing.totalDurationSeconds * fps);
      if (totalFrames < shotSpec.shots.length) {
        throw new CreatorExecutorError(
          'creator_audio_too_short',
          'Narration duration cannot allocate at least one frame to every shot'
        );
      }
      const shots = [];
      for (const shot of shotSpec.shots) {
        const measured = timingBySegment.get(shot.sourceSegmentId);
        if (measured === undefined) {
          throw new CreatorExecutorError(
            'creator_audio_timing_incomplete',
            `Audio timing is missing ${shot.sourceSegmentId}`
          );
        }
        if (
          Math.abs(shot.startSeconds - measured.startSeconds) > 0.001
          || Math.abs(shot.endSeconds - measured.endSeconds) > 0.001
          || Math.abs(shot.durationSeconds - measured.durationSeconds) > 0.001
        ) {
          throw new CreatorExecutorError(
            'creator_storyboard_timing_stale',
            `Shot ${shot.id} is not derived from current audio timing`
          );
        }
        const candidates = images.filter(image => image.scopeKey === shot.id);
        if (candidates.length !== 1) {
          throw new CreatorExecutorError(
            'creator_shot_image_ambiguous',
            `Shot ${shot.id} requires exactly one current image`
          );
        }
        const image = candidates[0]!;
        const audioCandidates = narration.filter(audio => audio.scopeKey === shot.sourceSegmentId);
        if (audioCandidates.length !== 1) {
          throw new CreatorExecutorError(
            'creator_narration_incomplete',
            `Shot ${shot.id} requires exactly one current narration segment`
          );
        }
        const audio = audioCandidates[0]!;
        if (image.path === null || image.sha256 === null) {
          throw new CreatorExecutorError('creator_artifact_hash_missing', `Shot ${shot.id} image is incomplete`);
        }
        if (audio.path === null || audio.sha256 === null || audio.id !== measured.audioArtifactId) {
          throw new CreatorExecutorError('creator_artifact_hash_missing', `Shot ${shot.id} audio is incomplete`);
        }
        await assertInputPath(jobRoot, image.path);
        await assertInputPath(jobRoot, audio.path);
        const startFrame = Math.round(measured.startSeconds * fps);
        const endFrame = Math.round(measured.endSeconds * fps);
        shots.push({
          shotId: shot.id,
          startFrame,
          endFrame,
          imageArtifactId: image.id,
          audioArtifactId: audio.id,
          motion: shot.motion,
          imageSha256: image.sha256,
          audioSha256: audio.sha256,
          imagePath: image.path,
          audioPath: audio.path
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
      const subtitlePath = join(stage.workdir, 'narration.srt');
      await writeFile(subtitlePath, renderStickmanTimedNarrationSrt(script, timing), 'utf8');
      const outputs: CreatorExecutorOutput[] = [
          {
            kind: 'timeline_manifest',
            status: 'completed',
            path,
            sourceArtifactIds: [
              scriptArtifact.id,
              timingArtifact.id,
              shotSpecArtifact.id,
              ...narration.map(audio => audio.id),
              ...images.map(image => image.id)
            ],
            metadata: {
              fps,
              width: 1280,
              height: 720,
              totalFrames,
              duration: timing.totalDurationSeconds,
              shotCount: shots.length,
              timingSource: timing.timingSource
            }
          },
          {
            kind: 'narration_subtitle',
            status: 'completed',
            path: subtitlePath,
            sourceArtifactIds: [scriptArtifact.id, timingArtifact.id],
            metadata: {
              cueCount: timing.segments.length,
              duration: timing.totalDurationSeconds,
              timingSource: timing.timingSource
            }
          }
        ];
      return { outputs };
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
