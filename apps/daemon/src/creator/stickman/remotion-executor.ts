import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateMediaFile } from '../validators/media.js';
import { readStickmanRemotionRuntime, type StickmanRemotionRuntime } from './remotion-runtime.js';

type ValidateVideo = (path: string, ffprobePath: string) => Promise<{
  duration: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
}>;

export function createStickmanRemotionExecutor(input: {
  ffprobePath: string;
  runtimeRoot: string;
  workerEntrypoint?: string;
  runtime?: StickmanRemotionRuntime;
  validateVideo?: ValidateVideo;
}): CreatorExecutor {
  const validateVideo = input.validateVideo ?? validateMediaFile;
  return {
    id: 'stickman-remotion',
    async run(stage) {
      const timeline = stage.inputArtifacts.find(artifact => artifact.kind === 'timeline_manifest');
      if (timeline?.path === null || timeline?.path === undefined) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'Timeline manifest is required');
      }
      const runtime = input.runtime ?? readStickmanRemotionRuntime(input.runtimeRoot);
      const outputPath = join(stage.workdir, 'landscape-clean.mp4');
      const requestPath = join(stage.workdir, 'remotion-request.json');
      const resultPath = join(stage.workdir, 'remotion-result.json');
      await writeFile(requestPath, `${JSON.stringify({
        timelinePath: timeline.path,
        outputPath,
        bundlePath: runtime.bundlePath,
        browserExecutable: runtime.browserExecutable,
        workdir: stage.workdir,
        jobRoot: dirname(stage.workdir),
        runtimeRoot: runtime.root
      }, null, 2)}\n`, 'utf8');
      const workerEntrypoint = input.workerEntrypoint
        ?? fileURLToPath(new URL('./remotion-worker.js', import.meta.url));
      try {
        await runWorker(workerEntrypoint, requestPath, resultPath, stage.signal);
        const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
          ok?: boolean;
          error?: string;
        };
        if (result.ok !== true) {
          throw new CreatorExecutorError(
            'stickman_remotion_failed',
            result.error ?? 'Remotion worker failed'
          );
        }
        const media = await validateVideo(outputPath, input.ffprobePath);
        const timelineValue = JSON.parse(await readFile(timeline.path, 'utf8')) as {
          totalFrames?: number;
          fps?: number;
        };
        const expectedDuration = Number(timelineValue.totalFrames) / Number(timelineValue.fps);
        const durationTolerance = Math.max(0.15, 2 / Number(timelineValue.fps));
        if (
          media.width !== 1280
          || media.height !== 720
          || !media.hasVideo
          || !media.hasAudio
          || !Number.isFinite(expectedDuration)
          || Math.abs(media.duration - expectedDuration) > durationTolerance
        ) {
          throw new CreatorExecutorError(
            'stickman_render_invalid',
            'Rendered video must be decodable 1280x720 media with matching audio duration'
          );
        }
        return {
          outputs: [{
            kind: 'clean_video',
            status: 'completed',
            path: outputPath,
            sourceArtifactIds: [timeline.id],
            metadata: { ...media, fileName: 'landscape-clean.mp4' }
          }]
        };
      } catch (error) {
        await Promise.all([
          rm(outputPath, { force: true }),
          rm(resultPath, { force: true })
        ]);
        if (stage.signal.aborted) {
          throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
        }
        throw error;
      }
    }
  };
}

function runWorker(
  workerEntrypoint: string,
  requestPath: string,
  resultPath: string,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnCreatorProcess(
      process.execPath,
      [workerEntrypoint, requestPath, resultPath],
      { cwd: dirname(requestPath), stdio: ['ignore', 'ignore', 'pipe'] },
      signal
    );
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new CreatorExecutorError(
        'stickman_remotion_worker_failed',
        stderr.slice(-2_000) || `Remotion worker exited with code ${code}`
      ));
    });
  });
}
