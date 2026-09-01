import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { createStickmanRemotionExecutor } from '../../src/creator/stickman/remotion-executor.js';

const runtimeRoot = process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT;
const ffmpegPath = process.env.OPENCREATOR_FFMPEG_PATH;
const ffprobePath = process.env.OPENCREATOR_FFPROBE_PATH;
const enabled = Boolean(runtimeRoot && ffmpegPath && ffprobePath);
const execFileAsync = promisify(execFile);
let tempRoot = '';

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe.runIf(enabled)('stickman Remotion packaged runtime smoke', () => {
  it('renders a nonblank fixed-frame video with packaged browser and fonts', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'creator-stickman-render-smoke-'));
    const jobRoot = join(tempRoot, 'jobs', 'job-1');
    const workdir = join(jobRoot, 'stage-render');
    const inputDir = join(jobRoot, 'inputs');
    const imageOne = join(inputDir, 'shot-one.png');
    const imageTwo = join(inputDir, 'shot-two.png');
    const narration = join(inputDir, 'narration.mp3');
    const timelinePath = join(inputDir, 'timeline.json');
    mkdirSync(workdir, { recursive: true });
    mkdirSync(inputDir, { recursive: true });
    await Promise.all([
      renderFixtureImage(imageOne, '#f7f7f5', '#111827', 260),
      renderFixtureImage(imageTwo, '#dff4ff', '#0f766e', 880)
    ]);
    await execFileAsync(ffmpegPath!, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:a', 'libmp3lame', '-q:a', '4', narration
    ], { windowsHide: true });
    writeFileSync(timelinePath, `${JSON.stringify({
      fps: 30,
      width: 1280,
      height: 720,
      totalFrames: 60,
      shots: [
        fixtureShot('shot-01', 0, 30, imageOne, narration, 'push-in'),
        fixtureShot('shot-02', 30, 60, imageTwo, narration, 'pan-left')
      ]
    }, null, 2)}\n`);

    const manifestBefore = readFileSync(join(runtimeRoot!, 'manifest.json'), 'utf8');
    const executor = createStickmanRemotionExecutor({
      runtimeRoot: runtimeRoot!,
      ffprobePath: ffprobePath!,
      workerEntrypoint: resolve('dist/creator/stickman/remotion-worker.js')
    });
    const result = await executor.run({
      stageRun: { id: 'stage-render', stageId: 'render-clean' },
      job: { id: 'job-1' },
      inputArtifacts: [{
        id: 'timeline-1',
        kind: 'timeline_manifest',
        status: 'completed',
        path: timelinePath
      }],
      workdir,
      signal: new AbortController().signal,
      reportProgress() {}
    } as never);

    const outputPath = result.outputs[0]!.path!;
    expect(result.outputs[0]).toMatchObject({ kind: 'clean_video', status: 'completed' });
    for (const [index, seconds] of [0.2, 1, 1.8].entries()) {
      const framePath = join(tempRoot, `frame-${index}.png`);
      await execFileAsync(ffmpegPath!, [
        '-y', '-ss', String(seconds), '-i', outputPath, '-frames:v', '1', framePath
      ], { windowsHide: true });
      const stats = await sharp(framePath).stats();
      expect(stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.stdev, 0)).toBeGreaterThan(20);
    }
    expect(readFileSync(join(runtimeRoot!, 'manifest.json'), 'utf8')).toBe(manifestBefore);
  }, 120_000);
});

async function renderFixtureImage(path: string, background: string, stroke: string, x: number): Promise<void> {
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
      <rect width="1280" height="720" fill="${background}"/>
      <circle cx="${x}" cy="210" r="74" fill="none" stroke="${stroke}" stroke-width="22"/>
      <path d="M ${x} 284 L ${x} 500 M ${x} 350 L ${x - 120} 430 M ${x} 350 L ${x + 120} 430 M ${x} 500 L ${x - 110} 640 M ${x} 500 L ${x + 110} 640" fill="none" stroke="${stroke}" stroke-width="24" stroke-linecap="round"/>
      <rect x="80" y="70" width="1120" height="580" fill="none" stroke="${stroke}" stroke-width="8" stroke-dasharray="18 12"/>
    </svg>
  `);
  await sharp(svg).png().toFile(path);
}

function fixtureShot(
  shotId: string,
  startFrame: number,
  endFrame: number,
  imagePath: string,
  audioPath: string,
  motion: string
) {
  return {
    shotId,
    startFrame,
    endFrame,
    imageArtifactId: `${shotId}-image`,
    audioArtifactId: 'narration-1',
    motion,
    imageSha256: '1'.repeat(64),
    audioSha256: '2'.repeat(64),
    imagePath,
    audioPath
  };
}
