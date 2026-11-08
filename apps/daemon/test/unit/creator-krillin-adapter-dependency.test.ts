import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const preflightKrillinDependencies = vi.hoisted(() => vi.fn());
const runKrillinCli = vi.hoisted(() => vi.fn());

vi.mock('../../src/creator/krillin/dependency-preflight.js', () => ({
  preflightKrillinDependencies
}));

vi.mock('../../src/creator/validators/media.js', () => ({
  validateMediaFile: vi.fn(async () => ({ duration: 1, hasVideo: true, hasAudio: true }))
}));

vi.mock('../../src/creator/krillin/cli-runner.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/creator/krillin/cli-runner.js')>();
  return { ...actual, runKrillinCli };
});

import { createKrillinExecutor } from '../../src/creator/krillin/adapter.js';
import { KrillinCliError } from '../../src/creator/krillin/cli-runner.js';

let tempDir = '';

afterEach(() => {
  vi.clearAllMocks();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('KrillinAI configured transcription dependency', () => {
  it.each(['platform-success', 'platform-failure', 'audio', 'import'])('checks language only at the actual ASR boundary: %s', async route => {
    const fixture = setup();
    fixture.config.transcription.provider = 'whisperkit';
    const stage = fixture.stage as CreatorExecutorInput;
    stage.job.templateId = 'video-translation';
    stage.job.state.sourceLanguage = 'yue'; // Bundled large-v2 lacks the Cantonese token.
    if (route === 'audio') stage.job.state.preferPlatformCaptions = false;
    if (route === 'import') {
      stage.job.state.preferPlatformCaptions = false;
      const subtitle = writeTargetSubtitle(tempDir);
      stage.inputArtifacts.push({ id: 'source-srt', kind: 'source_subtitle', path: join(tempDir, subtitle.relativePath) } as never);
    }
    if (route === 'platform-failure') runKrillinCli.mockRejectedValueOnce(new KrillinCliError('platform_caption_failed', 'No platform captions'));
    else runKrillinCli.mockImplementation(async input => { const subtitle = writeTargetSubtitle(input.jobsRoot); return ['source_subtitle', 'target_subtitle', 'vertical_subtitle'].map(kind => ({ ...subtitle, kind })); });
    if (route === 'audio' || route === 'platform-failure') {
      await expect(fixture.executor.run(stage)).rejects.toMatchObject({ code: 'creator_transcription_language_unsupported' });
      expect(runKrillinCli).toHaveBeenCalledTimes(route === 'audio' ? 0 : 1);
    } else await expect(fixture.executor.run(stage)).resolves.toMatchObject({ outputs: expect.any(Array) });
    expect(fixture.ensure).not.toHaveBeenCalled();
  });
  it.each([
    ['分享视频 https://v.douyin.com/abc123/ 复制打开抖音', 'https://v.douyin.com/abc123/'],
    ['https://www.douyin.com/jingxuan?modal_id=123', 'https://www.douyin.com/video/123'],
    ['https://www.douyin.com/jingxuan/search/qianjidong?aid=2052a92f-0793-47c1-b739-c0af829b6103&modal_id=7693859410975690010&type=general',
      'https://www.douyin.com/video/7693859410975690010'],
    ['https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D',
      'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D']
  ])('transcribes added translation sources with normalized URLs and preserved tokens: %s', async (sourceUrl, expected) => {
    const fixture = setup();
    const stage = fixture.stage as CreatorExecutorInput;
    stage.job.templateId = 'video-translation';
    stage.job.state.sourceType = 'url';
    stage.job.state.sourceUrl = sourceUrl;
    stage.inputArtifacts = [];
    runKrillinCli.mockImplementation(async input => {
      const subtitle = writeTargetSubtitle(input.jobsRoot);
      return ['source_subtitle', 'target_subtitle', 'vertical_subtitle'].map(kind => ({ ...subtitle, kind }));
    });
    await fixture.executor.run(stage);
    expect(fixture.ensure).toHaveBeenCalledTimes(1);
    expect(runKrillinCli).toHaveBeenCalledTimes(1);
    expect(runKrillinCli.mock.calls[0]?.[0]).toMatchObject({ source: expected, options: { sourceUrl: expected } });
    expect(fixture.getYtDlpRuntime).toHaveBeenCalledWith(expected);
    expect(runKrillinCli.mock.calls[0]?.[0].options.captionSource).not.toBe('platform');
  });
  it('uses the original YouTube URL without preparing transcription when platform captions succeed', async () => {
    const fixture = setup();
    runKrillinCli.mockImplementation(async input => [writeTargetSubtitle(input.jobsRoot)]);

    const result = await fixture.executor.run(fixture.stage);

    expect(result.outputs).toEqual([
      expect.objectContaining({ kind: 'target_subtitle', status: 'completed' })
    ]);
    expect(fixture.ensure).not.toHaveBeenCalled();
    expect(runKrillinCli).toHaveBeenCalledTimes(1);
    expect(runKrillinCli.mock.calls[0]?.[0]).toMatchObject({
      source: 'https://www.youtube.com/watch?v=demo',
      options: {
        captionSource: 'platform',
        originLanguage: 'auto',
        targetLanguage: 'zh_cn'
      }
    });
  });

  it.each(['platform_caption_failed', 'platform_caption_invalid'])('prepares transcription after %s and reports the fallback to the frontend', async code => {
    const fixture = setup();
    runKrillinCli
      .mockRejectedValueOnce(new KrillinCliError(
        code,
        'No platform captions are available'
      ))
      .mockImplementationOnce(async input => {
        input.stage.reportProgress({ phase: 'transcribing_audio', percent: 55 });
        return [writeTargetSubtitle(input.jobsRoot)];
      });

    const result = await fixture.executor.run(fixture.stage);

    expect(fixture.ensure).toHaveBeenCalledTimes(1);
    expect(runKrillinCli).toHaveBeenCalledTimes(2);
    expect(runKrillinCli.mock.calls[0]?.[0]).toMatchObject({
      source: 'https://www.youtube.com/watch?v=demo',
      options: { captionSource: 'platform' }
    });
    expect(runKrillinCli.mock.calls[1]?.[0]).toMatchObject({
      source: expect.stringMatching(/^local:/),
      options: {
        captionSource: 'whisper',
        originLanguage: 'auto',
        targetLanguage: 'zh_cn'
      }
    });
    const stage = fixture.stage as CreatorExecutorInput;
    expect(stage.reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'fallback_to_transcription', providerStatus: 'running',
      captionSource: 'whisper', captionFallbackCode: code,
        message: expect.stringContaining('Switched to speech transcription.')
    }));
    expect(stage.reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'transcribing_audio', percent: 55, captionFallbackCode: code, captionSource: 'whisper'
    }));
    expect(result.progress).toMatchObject({ captionFallbackCode: code, captionSource: 'whisper' });
  });

  it.each(['platform_caption_failed', 'platform_caption_invalid'])('preserves %s diagnostics when transcription fallback also fails', async code => {
    const fixture = setup();
    runKrillinCli
      .mockRejectedValueOnce(new KrillinCliError(
        code,
        'No original YouTube captions are available'
      ))
      .mockRejectedValueOnce(new KrillinCliError(
        'audio_transcription_failed',
        'whisperkit-cli rejected the language option'
      ));

    await expect(fixture.executor.run(fixture.stage)).rejects.toMatchObject({
      code: 'audio_transcription_failed',
      message: expect.stringMatching(/No original YouTube captions.*whisperkit-cli rejected/)
    });
  });

  it('continues from unusable VTT without a local video and keeps the component preparation notice', async () => {
    const fixture = setup();
    const stage = fixture.stage as CreatorExecutorInput;
    stage.job.templateId = 'video-translation';
    stage.inputArtifacts = [];
    fixture.ensure.mockImplementationOnce(async input => {
      input.reportProgress({ phase: 'downloading_dependencies', message: 'Preparing the transcription model' });
    });
    runKrillinCli.mockImplementationOnce(async input => {
      input.stage.reportProgress({ providerStatus: 'failed', phase: 'failed' });
      throw new KrillinCliError('platform_caption_invalid', 'No usable text');
    }).mockImplementationOnce(async input => {
      const subtitle = writeTargetSubtitle(input.jobsRoot);
      return ['source_subtitle', 'target_subtitle', 'vertical_subtitle'].map(kind => ({ ...subtitle, kind }));
    });

    await fixture.executor.run(stage);

    expect(runKrillinCli.mock.calls[1]?.[0]).toMatchObject({
      source: 'https://www.youtube.com/watch?v=demo', options: { captionSource: 'whisper' }
    });
    expect(stage.reportProgress).not.toHaveBeenCalledWith(expect.objectContaining({ providerStatus: 'failed' }));
    expect(stage.reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading_dependencies', captionFallbackCode: 'platform_caption_invalid',
      message: expect.stringContaining('Platform subtitle parsing failed. Switched to speech transcription.')
    }));
  });

  it('does not start transcription after the task is canceled', async () => {
    const fixture = setup();
    const controller = new AbortController();
    const stage = fixture.stage as CreatorExecutorInput;
    stage.signal = controller.signal;
    runKrillinCli.mockImplementationOnce(async () => {
      controller.abort();
      throw new KrillinCliError('platform_caption_invalid', 'No usable text');
    });
    await expect(fixture.executor.run(stage)).rejects.toMatchObject({ code: 'platform_caption_invalid' });
    expect(fixture.ensure).not.toHaveBeenCalled();
    expect(runKrillinCli).toHaveBeenCalledTimes(1);
  });

  it.each(['platform_caption_access_failed', 'platform_caption_processing_failed'])('does not download transcription components after %s', async code => {
    const fixture = setup();
    runKrillinCli.mockRejectedValueOnce(new KrillinCliError(code, 'Platform request failed'));

    await expect(fixture.executor.run(fixture.stage)).rejects.toMatchObject({ code });

    expect(runKrillinCli).toHaveBeenCalledTimes(1);
    expect(fixture.ensure).not.toHaveBeenCalled();
  });

  it.each(['different-url', 'different-part', 'unknown'])('does not reuse a source video with %s provenance when rendering a URL', async provenance => {
    const fixture = setup();
    const stage = fixture.stage as CreatorExecutorInput;
    stage.job.templateId = 'video-translation';
    stage.stageRun.stageId = 'render-horizontal';
    if (provenance === 'different-part') stage.job.state.sourceUrl = 'https://www.bilibili.com/video/BV18E421w7bf?p=3';
    const previousVideo = stage.inputArtifacts[0]!;
    previousVideo.metadata = provenance === 'different-url'
      ? { settingsSnapshot: { sourceUrl: 'https://www.youtube.com/watch?v=previous' } }
      : provenance === 'different-part'
        ? { settingsSnapshot: { sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf?p=2' } }
      : {};
    const subtitle = writeTargetSubtitle(tempDir);
    stage.inputArtifacts.push({ id: 'target-subtitle', kind: 'target_subtitle', path: join(tempDir, subtitle.relativePath) } as never);
    runKrillinCli.mockImplementation(async input => {
      const outputDir = join(input.jobsRoot, stage.job.id, 'outputs');
      mkdirSync(outputDir, { recursive: true });
      const sourcePath = join(outputDir, 'new-source.mp4');
      const renderPath = join(outputDir, 'horizontal.mp4');
      writeFileSync(sourcePath, 'new source');
      writeFileSync(renderPath, 'render');
      return [
        { kind: 'source_video', relativePath: relative(input.jobsRoot, sourcePath), size: 10 },
        { kind: 'horizontal_video', relativePath: relative(input.jobsRoot, renderPath), size: 6 }
      ];
    });

    const result = await fixture.executor.run(stage);

    expect(runKrillinCli.mock.calls[0]?.[0].artifacts).toEqual([
      expect.objectContaining({ id: 'target-subtitle', kind: 'target_subtitle' })
    ]);
    expect(runKrillinCli.mock.calls[0]?.[0].options.sourceUrl).toBe(stage.job.state.sourceUrl);
    expect(result.outputs).toEqual([
      expect.objectContaining({ kind: 'source_video', sourceArtifactIds: [] }),
      expect.objectContaining({ kind: 'horizontal_video', sourceArtifactIds: ['target-subtitle'] })
    ]);
    expect(fixture.ensure).not.toHaveBeenCalled();
  });

  it.each(['matching-url', 'matching-part', 'local-file'])('retains a source video with %s provenance', async provenance => {
    const fixture = setup();
    const stage = fixture.stage as CreatorExecutorInput;
    stage.job.templateId = 'video-translation';
    stage.stageRun.stageId = 'tts';
    stage.job.state.sourceType = provenance === 'local-file' ? 'file' : 'url';
    if (provenance === 'matching-part') stage.job.state.sourceUrl = 'https://www.bilibili.com/video/BV18E421w7bf?p=3&spm_id_from=share';
    stage.inputArtifacts[0]!.metadata = provenance === 'matching-url'
      ? { settingsSnapshot: { sourceUrl: stage.job.state.sourceUrl! } }
      : provenance === 'matching-part'
        ? { settingsSnapshot: { sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf/?p=3&vd_source=other' } }
      : {};
    runKrillinCli.mockImplementation(async input => {
      const outputDir = join(input.jobsRoot, stage.job.id, 'outputs');
      mkdirSync(outputDir, { recursive: true });
      const outputPath = join(outputDir, 'dubbed.wav');
      writeFileSync(outputPath, 'audio');
      return [
        writeTargetSubtitle(input.jobsRoot),
        { kind: 'dubbed_audio', relativePath: relative(input.jobsRoot, outputPath), size: 5 }
      ];
    });

    await fixture.executor.run(stage);

    expect(runKrillinCli.mock.calls[0]?.[0].artifacts).toEqual([
      expect.objectContaining({ id: 'source-video', kind: 'source_video' })
    ]);
    expect(fixture.ensure).not.toHaveBeenCalled();
  });

  it('uses fresh dubbed audio when the previous dubbed video is stale during render', async () => {
    const fixture = setup();
    const stage = fixture.stage as CreatorExecutorInput;
    stage.job.templateId = 'video-translation';
    stage.stageRun.stageId = 'render-horizontal';
    stage.job.state.dubbing = true;
    stage.job.state.composeVideo = true;
    stage.inputArtifacts[0]!.metadata = { settingsSnapshot: { sourceUrl: 'https://www.youtube.com/watch?v=demo' } };
    const subtitle = writeTargetSubtitle(tempDir);
    const audioPath = join(tempDir, 'dubbed.wav');
    const staleVideoPath = join(tempDir, 'old-dubbed.mp4');
    writeFileSync(audioPath, 'audio');
    writeFileSync(staleVideoPath, 'old video');
    stage.inputArtifacts.push(
      { id: 'target-subtitle', kind: 'target_subtitle', status: 'completed', path: join(tempDir, subtitle.relativePath) } as never,
      { id: 'dubbed-audio', kind: 'dubbed_audio', status: 'completed', path: audioPath } as never,
      { id: 'old-dubbed-video', kind: 'dubbed_video', status: 'stale', path: staleVideoPath } as never
    );
    runKrillinCli.mockImplementation(async input => {
      const outputDir = join(input.jobsRoot, stage.job.id, 'outputs');
      mkdirSync(outputDir, { recursive: true });
      const renderPath = join(outputDir, 'horizontal.mp4');
      writeFileSync(renderPath, 'render');
      return [{ kind: 'horizontal_video', relativePath: relative(input.jobsRoot, renderPath), size: 6 }];
    });

    await fixture.executor.run(stage);

    expect(runKrillinCli.mock.calls[0]?.[0].artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dubbed-audio', kind: 'dubbed_audio' })
    ]));
    expect(runKrillinCli.mock.calls[0]?.[0].artifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old-dubbed-video' })
    ]));
    expect(fixture.ensure).not.toHaveBeenCalled();
  });
});

function setup() {
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'creator-krillin-caption-plan-')));
  const resourceRoot = join(tempDir, 'runtime');
  const jobsRoot = join(tempDir, 'jobs');
  const sourcePath = join(jobsRoot, 'auto-clip-job', 'inputs', 'source.mp4');
  const ffprobePath = join(resourceRoot, 'bin', 'ffprobe');
  mkdirSync(join(resourceRoot, 'bin'), { recursive: true });
  mkdirSync(join(jobsRoot, 'auto-clip-job', 'inputs'), { recursive: true });
  writeFileSync(sourcePath, 'video');
  writeFileSync(ffprobePath, 'ffprobe');
  writeFileSync(join(resourceRoot, 'manifest.json'), JSON.stringify({
    version: 1,
    platform: process.platform,
    arch: process.arch,
    resources: [{
      path: 'bin/ffprobe',
      sha256: 'a'.repeat(64),
      kind: 'executable'
    }]
  }));

  const config = createDefaultCreatorServicesConfig();
  config.transcription.provider = 'whisperkit';
  preflightKrillinDependencies.mockReturnValue({
    manifest: { resources: [] },
    config
  });
  const ensure = vi.fn(async (_input: { reportProgress(progress: Record<string, unknown>): void }) => undefined);
  const getYtDlpRuntime = vi.fn(() => undefined);
  const executor = createKrillinExecutor({
    resourceRoot,
    jobsRoot,
    getYtDlpRuntime,
    configStore: {
      read: vi.fn(async () => config)
    } as never,
    dependencyLoader: {
      root: join(tempDir, 'dependencies'),
      capabilities: vi.fn(),
      ensure
    }
  });
  const stage = {
    signal: new AbortController().signal,
    stageRun: {
      id: 'subtitle-stage',
      stageId: 'subtitle',
      progress: {}
    },
    job: {
      id: 'auto-clip-job',
      templateId: 'auto-clip',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo',
        sourceLanguage: 'auto',
        targetLanguage: 'zh-CN',
        preferPlatformCaptions: true
      }
    },
    inputArtifacts: [{
      id: 'source-video',
      kind: 'source_video',
      path: sourcePath
    }],
    workdir: join(jobsRoot, 'auto-clip-job', 'subtitle-stage'),
    reportProgress: vi.fn()
  } as never;
  return { ensure, executor, stage, getYtDlpRuntime, config };
}

function writeTargetSubtitle(jobsRoot: string) {
  const outputDir = join(jobsRoot, 'auto-clip-job', 'outputs');
  const path = join(outputDir, 'target.srt');
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path, '1\n00:00:00,000 --> 00:00:01,000\n字幕内容\n');
  return {
    kind: 'target_subtitle',
    relativePath: relative(jobsRoot, path).replaceAll('\\', '/'),
    size: 48,
    sha256: 'b'.repeat(64)
  };
}
