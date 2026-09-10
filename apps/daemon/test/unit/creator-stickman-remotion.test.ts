import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStickmanRemotionExecutor } from '../../src/creator/stickman/remotion-executor.js';
import { readStickmanRemotionRuntime } from '../../src/creator/stickman/remotion-runtime.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('stickman Remotion worker isolation', () => {
  it('accepts visual assets from the packaged runtime manifest', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-runtime-'));
    const visualAssetPath = join(tempDir, 'catalog.json');
    writeFileSync(visualAssetPath, '{}\n');
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify({
      version: 1,
      platform: process.platform,
      arch: process.arch,
      remotionVersion: '4.0.473',
      chromiumVersion: 'test',
      bundlePath: 'bundle',
      browserExecutable: 'browser',
      resources: [{
        path: 'catalog.json',
        kind: 'visual-asset',
        sha256: '0'.repeat(64),
        bytes: 3,
        version: '1',
        platform: process.platform,
        arch: process.arch
      }]
    }));

    expect(readStickmanRemotionRuntime(tempDir)).toEqual({
      root: tempDir,
      bundlePath: join(tempDir, 'bundle'),
      browserExecutable: join(tempDir, 'browser')
    });
  });

  it('isolates worker crashes and cancellation without leaving a clean video', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-remotion-'));
    const timelinePath = join(tempDir, 'timeline.json');
    writeFileSync(timelinePath, JSON.stringify({ fps: 30, width: 1280, height: 720, totalFrames: 30, shots: [] }));
    const crashWorker = join(tempDir, 'crash-worker.ts');
    writeFileSync(crashWorker, "const code: number = 2; process.stderr.write('injected crash'); process.exit(code);\n");
    const executor = createStickmanRemotionExecutor({
      ffprobePath: 'unused',
      runtimeRoot: tempDir,
      workerEntrypoint: crashWorker,
      runtime: { root: tempDir, bundlePath: join(tempDir, 'bundle'), browserExecutable: join(tempDir, 'browser') },
      validateVideo: async () => ({ duration: 1, width: 1280, height: 720, hasVideo: true, hasAudio: true })
    });
    const baseInput = {
      stageRun: { id: 'stage-1', stageId: 'render-clean' },
      job: { id: 'job-1' },
      inputArtifacts: [{ id: 'timeline-1', kind: 'timeline_manifest', status: 'completed', path: timelinePath }],
      workdir: tempDir,
      reportProgress() {}
    };

    await expect(executor.run({
      ...baseInput,
      signal: new AbortController().signal
    } as never)).rejects.toMatchObject({ code: 'stickman_remotion_worker_failed' });
    expect(existsSync(join(tempDir, 'landscape-clean.mp4'))).toBe(false);

    const waitWorker = join(tempDir, 'wait-worker.mjs');
    writeFileSync(waitWorker, 'setInterval(() => {}, 1000);\n');
    const cancelExecutor = createStickmanRemotionExecutor({
      ffprobePath: 'unused',
      runtimeRoot: tempDir,
      workerEntrypoint: waitWorker,
      runtime: { root: tempDir, bundlePath: join(tempDir, 'bundle'), browserExecutable: join(tempDir, 'browser') },
      validateVideo: async () => ({ duration: 1, width: 1280, height: 720, hasVideo: true, hasAudio: true })
    });
    const controller = new AbortController();
    const running = cancelExecutor.run({ ...baseInput, signal: controller.signal } as never);
    setTimeout(() => controller.abort(), 100);
    await expect(running).rejects.toMatchObject({ code: 'creator_stage_canceled' });
    expect(existsSync(join(tempDir, 'landscape-clean.mp4'))).toBe(false);
  });
});
