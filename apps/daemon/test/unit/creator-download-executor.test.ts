import type {
  CreatorArtifact,
  CreatorJob,
  CreatorStageRun,
  DownloadProbe
} from '@opencreator/protocol';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { extractDouyinShareUrl } from '@opencreator/protocol';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadExecutor } from '../../src/creator/download/executor.js';
import { parseDownloadProbe } from '../../src/creator/download/probe-parser.js';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';
import { createCreatorProcessControl } from '../../src/creator/process-tree.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator download executor', () => {
  it.skipIf(process.platform === 'win32')('suspends and continues the actual downloader without starting it again', async () => {
    const binaries = await fakeBinaries({ holdDownload: true });
    const workdir = join(tempDir, 'live-pause');
    await mkdir(workdir);
    const probe = parsedProbe();
    const controller = new AbortController();
    const stage = stageInput({ workdir, stageId: 'download', state: {
      sourceUrl: probe.requestedUrl, mediaType: 'video', selectedOptionId: 'video-1080-1'
    }, inputArtifacts: [await writeProbeArtifact(workdir, probe)] });
    stage.signal = controller.signal;
    stage.processControl = createCreatorProcessControl(controller.signal)!;
    const ticks = async () => Number(await readFile(join(workdir, 'ticks'), 'utf8').catch(() => '0'));
    const work = createDownloadExecutor(binaries).run(stage);
    // Attach a rejection handler immediately so a failed assertion can clean up.
    void work.catch(() => undefined);
    try {
      await expect.poll(ticks).toBeGreaterThan(2);
      stage.processControl.pause();
      await new Promise(resolve => setTimeout(resolve, 60));
      const saved = await ticks();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await ticks()).toBe(saved);
      stage.processControl.resume();
      await expect.poll(ticks).toBeGreaterThan(saved);
      await writeFile(join(workdir, 'finish'), 'finish');
      const result = await work;
      expect(result.outputs[0]?.kind).toBe('source_video');
      expect(await readFile(join(workdir, 'starts'), 'utf8')).toBe('1');
    } finally {
      controller.abort();
      await work.catch(() => undefined);
    }
  });

  it.skipIf(process.platform === 'win32')('cancels a paused executor before it starts another subprocess', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'paused-before-spawn');
    await mkdir(workdir);
    const probe = parsedProbe();
    const controller = new AbortController();
    const reportProgress = vi.fn();
    const stage = stageInput({ workdir, stageId: 'download', reportProgress, state: {
      sourceUrl: probe.requestedUrl, mediaType: 'video', selectedOptionId: 'video-1080-1'
    }, inputArtifacts: [await writeProbeArtifact(workdir, probe)] });
    stage.signal = controller.signal;
    stage.processControl = createCreatorProcessControl(controller.signal)!;
    stage.processControl.pause();
    const work = createDownloadExecutor(binaries).run(stage);
    const canceled = expect(work).rejects.toThrow();
    await expect.poll(() => reportProgress.mock.calls.some(([progress]) => progress.phase === 'preparing_download')).toBe(true);
    controller.abort();
    await canceled;
    await expect(readFile(join(workdir, 'args.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([null, 'not an SRT file'])('rejects missing or invalid subtitle output: %s', async subtitleContent => {
    const executor = createDownloadExecutor(await fakeBinaries({ subtitleContent }));
    const workdir = join(tempDir, 'subtitle-failure');
    await mkdir(workdir);
    const sourceUrl = 'https://youtu.be/demo';
    const probe = parseDownloadProbe({ id: 'demo', title: 'Subtitle video', formats: [], subtitles: {
      en: [{ ext: 'vtt', url: 'https://example.com/en.vtt' }]
    } }, sourceUrl);
    const stage = stageInput({ workdir, stageId: 'download', state: {
      sourceUrl, selectedOptionId: 'subtitle-manual-en', mediaType: 'subtitle'
    }, inputArtifacts: [await writeProbeArtifact(workdir, probe)] });
    await expect(executor.run(stage)).rejects.toThrow(subtitleContent === null ? 'no longer available' : 'invalid_srt');
    expect(stage.reportProgress).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded' }));
  });

  it('lists usable manual and automatic subtitle tracks without exposing signed URLs', () => {
    const probe = parseDownloadProbe({
      id: 'demo', title: 'Subtitled video', formats: [],
      subtitles: {
        en: [{ ext: 'vtt', url: 'https://example.com/en.vtt?token=private', name: 'English' }, { ext: 'srt', url: 'https://example.com/en.srt' }],
        live_chat: [{ ext: 'json', url: 'https://example.com/chat' }],
        fr: [{ ext: 'vtt' }],
        de: [{ ext: 'vtt', url: 'file:///tmp/captions' }]
      },
      automatic_captions: { en: [{ ext: 'vtt', url: 'https://example.com/auto.vtt' }], 'zh-Hans': [{ ext: 'srt', url: 'https://example.com/zh.srt' }] }
    }, 'https://youtu.be/demo');
    expect(probe.options).toEqual([
      { id: 'subtitle-manual-en', mediaType: 'subtitle', container: 'srt', subtitleLanguage: 'en', subtitleName: 'English', subtitleSource: 'manual' },
      { id: 'subtitle-automatic-en', mediaType: 'subtitle', container: 'srt', subtitleLanguage: 'en', subtitleSource: 'automatic' },
      { id: 'subtitle-automatic-zh-Hans', mediaType: 'subtitle', container: 'srt', subtitleLanguage: 'zh-Hans', subtitleSource: 'automatic' }
    ]);
    expect(JSON.stringify(probe)).not.toContain('private');
  });

  it.each(['manual', 'automatic'] as const)('downloads only the selected %s subtitle track and validates SRT', async source => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'subtitle-work');
    await mkdir(workdir);
    const sourceUrl = 'https://youtu.be/demo';
    const option = { id: `subtitle-${source}-en`, mediaType: 'subtitle' as const, container: 'srt' as const, subtitleLanguage: 'en', subtitleSource: source };
    const probe = parseDownloadProbe({ id: 'demo', title: 'Subtitle video', formats: [] }, sourceUrl);
    probe.options = [option];
    const result = await executor.run(stageInput({
      workdir, stageId: 'download', state: { sourceUrl, selectedOptionId: option.id, mediaType: 'subtitle' },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }));
    const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining(['--skip-download', '--sub-langs', '^en$', '--convert-subs', 'srt', '--ffmpeg-location', binaries.ffmpegPath, '--proxy', 'http://127.0.0.1:7897']));
    expect(args).toContain(source === 'automatic' ? '--write-auto-subs' : '--write-subs');
    expect(args).not.toContain(source === 'automatic' ? '--write-subs' : '--write-auto-subs');
    expect(result.outputs[0]).toMatchObject({ kind: 'source_subtitle', status: 'completed', metadata: { optionId: option.id, subtitleLanguage: 'en', subtitleSource: source, cueCount: 1, mimeType: 'application/x-subrip' } });
    expect(await readFile(result.outputs[0]!.path!, 'utf8')).toContain('Hello subtitles');
  });

  it('downloads the queued draft source even if the URL changes before execution', async () => {
    const executor = createDownloadExecutor(await fakeBinaries());
    const workdir = join(tempDir, 'draft-preview');
    await mkdir(workdir);
    const sourceUrl = 'https://www.douyin.com/video/7490000000000000001';
    const reportProgress = vi.fn();
    const stage = previewInput({ workdir, sourceUrl, reportProgress });
    stage.stageRun.stageId = 'preview-source-video';
    stage.stageRun.progress = { previewSourceUrl: sourceUrl };
    stage.job.state.resultSnapshots = [];
    const result = await executor.run(stage);
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    expect(result.outputs[0]).toMatchObject({ kind: 'source_video', metadata: {
      previewOnly: true, playbackCompatible: true, settingsSnapshot: { sourceType: 'url', sourceUrl }
    } });
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'downloading', percent: 33 }));
  });
  it.each([
    'https://x.com/creator/status/123', 'https://www.tiktok.com/@creator/video/123',
    'https://www.instagram.com/reel/abc123/', 'https://www.douyin.com/video/123',
    'https://www.facebook.com/watch/?v=123',
    'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D',
    'https://www.pinterest.com/pin/123/',
    'https://www.reddit.com/r/claude/s/R5I7tDfJ0h'
  ])('prepares saved translation previews from the added platform: %s', async sourceUrl => {
    const executor = createDownloadExecutor(await fakeBinaries());
    const workdir = join(tempDir, 'preview');
    await mkdir(workdir);
    const result = await executor.run(previewInput({ workdir, sourceUrl }));
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    expect(result.outputs[0]).toMatchObject({ kind: 'source_video', status: 'completed',
      metadata: { playbackCompatible: true, settingsSnapshot: { sourceUrl } } });
  });
  it('prepares the saved Bilibili part without translating or using the current draft source', async () => {
    const executor = createDownloadExecutor(await fakeBinaries());
    const workdir = join(tempDir, 'preview');
    await mkdir(workdir);
    const reportProgress = vi.fn();
    const sourceUrl = 'https://www.bilibili.com/video/BV18E421w7bf/?spm_id_from=share&p=3';
    const result = await executor.run(previewInput({ workdir, sourceUrl, reportProgress }));
    const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain('https://www.bilibili.com/video/BV18E421w7bf?p=3');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('download:[download] %(progress._percent_str)s oc-preview:%(progress)j');
    expect(args).toContain('before_dl:oc-preview-formats:%(format_id)s');
    expect(args).toContain('before_dl:oc-preview-duration:%(duration)s');
    expect(args).toContain('before_dl:oc-preview-metadata:%(requested_formats.:.{format_id,filesize,filesize_approx,tbr,abr})j');
    expect(args).not.toContain('--extract-audio');
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video', status: 'completed', sourceArtifactIds: [],
      metadata: expect.objectContaining({ settingsSnapshot: expect.objectContaining({ sourceUrl }), playbackCompatible: true })
    })]);
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'downloading', percent: 33, downloadedBytes: 42, totalBytes: 100 }));
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'merging_media', percent: 77 }));
  });

  it('keeps measured dual-stream preview progress visible and monotonic from the first video byte', async () => {
    const executor = createDownloadExecutor(await fakeBinaries({
      previewFormatId: '399+140-20',
      previewFormatSizes: [8_350_655, 4_654_174],
      previewProgressEvents: [
        { downloaded_bytes: 4_175_327, total_bytes: 8_350_655, filename: 'video.mp4' },
        { downloaded_bytes: 8_350_655, total_bytes: 8_350_655, filename: 'video.mp4' },
        { downloaded_bytes: 1024, total_bytes: 4_654_174, filename: 'audio.m4a' },
        { downloaded_bytes: 4_654_174, total_bytes: 4_654_174, filename: 'audio.m4a' }
      ]
    }));
    const workdir = join(tempDir, 'preview-multi-resource');
    await mkdir(workdir);
    const reportProgress = vi.fn();
    await executor.run(previewInput({
      workdir,
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      reportProgress
    }));

    const progress = reportProgress.mock.calls
      .map(([value]) => value as { phase?: string; percent?: number | null; downloadedBytes?: number; totalBytes?: number | null })
      .filter(value => value.phase === 'downloading');
    expect(progress.map(value => value.percent)).toEqual([25, 49, 49, 75]);
    expect(progress.map(value => value.totalBytes)).toEqual(Array(4).fill(13_004_829));
    expect(progress.map(value => value.downloadedBytes)).toEqual([4_175_327, 8_350_655, 8_351_679, 13_004_829]);
  });

  it('does not freeze a partial percentage while unknown-size resources keep downloading', async () => {
    const executor = createDownloadExecutor(await fakeBinaries({
      previewFormatId: 'video+audio',
      previewProgressEvents: [
        { downloaded_bytes: 100, total_bytes: 100, filename: 'video.mp4' },
        { downloaded_bytes: 25, filename: 'audio.m4a' },
        { downloaded_bytes: 50, filename: 'audio.m4a' },
        { downloaded_bytes: 75, filename: 'audio.m4a' },
        { downloaded_bytes: 100, total_bytes: 100, filename: 'audio.m4a' }
      ]
    }));
    const workdir = join(tempDir, 'preview-unknown-sizes');
    await mkdir(workdir);
    const reportProgress = vi.fn();
    await executor.run(previewInput({ workdir, sourceUrl: 'https://www.youtube.com/watch?v=demo', reportProgress }));

    const progress = reportProgress.mock.calls
      .map(([value]) => value as { phase?: string; percent?: number | null; downloadedBytes?: number; totalBytes?: number | null })
      .filter(value => value.phase === 'downloading');
    expect(progress.map(value => value.percent)).toEqual([null, null, null, null, 75]);
    expect(progress.map(value => value.downloadedBytes)).toEqual([100, 125, 150, 175, 200]);
    expect(progress.map(value => value.totalBytes)).toEqual([null, null, null, null, 200]);
  });

  it('advances preview progress using the selected format bitrate when yt-dlp has no byte total', async () => {
    const executor = createDownloadExecutor(await fakeBinaries({
      previewFormatId: '616+140-drc',
      previewDuration: 121,
      previewFormats: [
        { format_id: '616', filesize: null, filesize_approx: null, tbr: 3549.491 },
        { format_id: '140-drc', filesize: 1_966_756, filesize_approx: null, abr: 129.537 }
      ],
      previewProgressEvents: [
        { downloaded_bytes: 300_000, total_bytes_estimate: 300_000, fragment_index: 1, fragment_count: 0,
          _percent: 100, status: 'downloading', filename: 'video.mp4' },
        { downloaded_bytes: 1_600_000, filename: 'video.mp4' },
        { downloaded_bytes: 8_000_000, filename: 'video.mp4' },
        { downloaded_bytes: 20_000_000, filename: 'video.mp4' }
      ]
    }));
    const workdir = join(tempDir, 'preview-bitrate-estimate');
    await mkdir(workdir);
    const reportProgress = vi.fn();
    await executor.run(previewInput({ workdir, sourceUrl: 'https://www.youtube.com/watch?v=demo', reportProgress }));

    const progress = reportProgress.mock.calls
      .map(([value]) => value as { phase?: string; percent?: number | null; downloadedBytes?: number; totalBytes?: number | null; totalBytesEstimated?: boolean })
      .filter(value => value.phase === 'downloading');
    expect(progress.map(value => value.percent)).toEqual([2, 4, 12, 28]);
    expect(progress.map(value => value.downloadedBytes)).toEqual([300_000, 1_600_000, 8_000_000, 20_000_000]);
    expect(progress.map(value => value.totalBytes)).toEqual(Array(4).fill(121 * 3549.491 * 1_000 / 8 + 1_966_756));
    expect(progress.every(value => value.totalBytesEstimated === true)).toBe(true);
  });

  it('reports the measured ratio for a single preview resource', async () => {
    const downloadedBytes = 39.4 * 1024 ** 2;
    const totalBytes = 44.2 * 1024 ** 2;
    const executor = createDownloadExecutor(await fakeBinaries({
      previewProgressEvents: [{ downloaded_bytes: downloadedBytes, total_bytes: totalBytes, filename: 'video.mp4' }]
    }));
    const workdir = join(tempDir, 'preview-single-resource');
    await mkdir(workdir);
    const reportProgress = vi.fn();
    await executor.run(previewInput({
      workdir,
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      reportProgress
    }));

    const progress = reportProgress.mock.calls
      .map(([value]) => value as { phase?: string; percent?: number | null; downloadedBytes?: number; totalBytes?: number | null })
      .filter(value => value.phase === 'downloading');
    expect(progress).toEqual([
      expect.objectContaining({ percent: 67, downloadedBytes, totalBytes })
    ]);
  });

  it('reports measured progress while converting a preview for local playback', async () => {
    const executor = createDownloadExecutor(await fakeBinaries({ videoCodec: 'vp9' }));
    const workdir = join(tempDir, 'preview-conversion');
    await mkdir(workdir);
    const reportProgress = vi.fn();
    await executor.run(previewInput({
      workdir,
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      reportProgress
    }));

    const progress = reportProgress.mock.calls
      .map(([value]) => value as { phase?: string; percent?: number | null; phasePercent?: number | null })
      .filter(value => value.phase === 'normalizing_media')
    expect(progress.map(value => value.percent)).toEqual([80, 90]);
    expect(progress.map(value => value.phasePercent)).toEqual([0, 50]);
    expect(progress.every(value => Number.isInteger(value.percent) && Number.isInteger(value.phasePercent))).toBe(true);
  });

  it.each(['matching', 'different-part', 'missing', 'invalid'])('handles %s preview cache without mixing Bilibili parts', async cache => {
    const executor = createDownloadExecutor(await fakeBinaries({ videoCodec: 'vp9' }));
    const workdir = join(tempDir, 'preview');
    await mkdir(workdir);
    const cachedPath = join(tempDir, 'cached.mp4');
    if (cache !== 'missing') await writeFile(cachedPath, cache === 'invalid' ? '' : 'cached-video');
    const sourceUrl = 'https://www.bilibili.com/video/BV18E421w7bf?p=3';
    const artifact: CreatorArtifact = {
      id: 'source-cached', jobId: 'download_job', kind: 'source_video', version: 1,
      status: 'completed', path: cachedPath, scopeKey: null, inputFingerprint: null,
      sha256: null, sourceArtifactIds: [], createdAt: '2026-10-02T00:00:00.000Z',
      metadata: { settingsSnapshot: { sourceUrl: `${sourceUrl.replace('p=3', cache === 'different-part' ? 'p=2' : 'p=3')}&vd_source=other` } }
    };
    const result = await executor.run(previewInput({ workdir, sourceUrl, inputArtifacts: [artifact] }));
    if (cache === 'matching') {
      expect(result.outputs[0]).toMatchObject({ sourceArtifactIds: [artifact.id], metadata: { cacheReused: true, normalizedForPlayback: true } });
      await expect(readFile(join(workdir, 'args.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      expect(result.outputs[0]?.metadata?.cacheReused).toBeUndefined();
      expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    }
  });

  it('requires a saved remote source for preview', async () => {
    const executor = createDownloadExecutor(await fakeBinaries());
    const stage = previewInput({ workdir: tempDir, sourceUrl: 'https://youtu.be/demo' });
    stage.stageRun.progress = {};
    await expect(executor.run(stage)).rejects.toMatchObject({ code: 'creator_action_input_invalid' });
    const local = previewInput({ workdir: tempDir, sourceUrl: 'file:///tmp/source.mp4' });
    await expect(executor.run(local)).rejects.toMatchObject({ code: 'creator_action_input_invalid' });
  });

  it('recognizes a Pinterest video Pin and rejects non-Pin URLs', async () => {
    const sourceUrl = 'https://www.pinterest.com/pin/6544361954284154/';
    const probe = parseDownloadProbe({
      id: '6544361954284154', title: 'Video Pin', extractor_key: 'Pinterest',
      webpage_url: sourceUrl, duration: 43.017,
      formats: [{ format_id: 'http-1080', ext: 'mp4', width: 1080, height: 1920, vcodec: 'h264', acodec: 'aac' }]
    }, sourceUrl);
    expect(probe.platform).toBe('pinterest');
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaType: 'video', videoFormatId: 'http-1080' })
    ]));

    const executor = createDownloadExecutor(await fakeBinaries());
    const workdir = join(tempDir, 'pinterest');
    await mkdir(workdir, { recursive: true });
    await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl } }));
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    for (const invalidUrl of [
      'https://www.pinterest.com/creator/',
      'https://www.pinterest.com/pin/not-a-pin/',
      'https://notpinterest.com/pin/6544361954284154/'
    ]) {
      await expect(executor.run(stageInput({
        workdir, stageId: 'probe', state: { sourceUrl: invalidUrl }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it.each(['Reddit', 'Youtube'])('keeps Reddit attribution for a post resolved by %s and sends share links to the downloader', async extractor => {
    const sourceUrl = 'https://www.reddit.com/r/claude/s/R5I7tDfJ0h';
    const canonicalUrl = 'https://www.reddit.com/r/claude/comments/1x1qhlj/i_made_with_opus_55/';
    const probe = parseDownloadProbe({
      id: 'reddit-video', title: 'Reddit video', extractor_key: extractor,
      webpage_url: canonicalUrl,
      formats: [
        { format_id: 'dash-video', ext: 'mp4', width: 1280, height: 720, vcodec: 'h264', acodec: 'none' },
        { format_id: 'dash-audio', ext: 'm4a', vcodec: 'none', acodec: 'aac' }
      ]
    }, sourceUrl);
    expect(probe).toMatchObject({ platform: 'reddit', requestedUrl: sourceUrl, url: canonicalUrl });
    const option = probe.options.find(option => option.mediaType === 'video' && option.videoFormatId === 'dash-video');
    expect(option).toMatchObject({ videoFormatId: 'dash-video', audioFormatId: 'dash-audio' });
    const executor = createDownloadExecutor(await fakeBinaries());
    const workdir = join(tempDir, 'reddit');
    await mkdir(workdir);
    await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl } }));
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const result = await executor.run(stageInput({
      workdir, stageId: 'download', state: { sourceUrl, selectedOptionId: option!.id, mediaType: 'video' }, inputArtifacts: [probeArtifact]
    }));
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toContain(sourceUrl);
    expect(result.outputs[0]?.metadata).toMatchObject({ platform: 'reddit', requestedUrl: sourceUrl });
  });

  it('recognizes a Xiaohongshu video note and its downloadable formats', () => {
    const sourceUrl = 'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D&xsec_source=pc_feed';
    const probe = parseDownloadProbe({
      id: '6a9149f3000000001f01d20a',
      title: 'Public video note',
      extractor_key: 'XiaoHongShu',
      webpage_url: sourceUrl,
      duration: 173.454,
      formats: [{
        format_id: '0', ext: 'mp4', width: 1388, height: 720,
        vcodec: 'h264', acodec: 'aac'
      }]
    }, sourceUrl);
    expect(probe).toMatchObject({
      platform: 'xiaohongshu', requestedUrl: sourceUrl, duration: 173.454
    });
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaType: 'video', videoFormatId: '0' }),
      expect.objectContaining({
        mediaType: 'audio',
        audioFormatId: '0',
        transcode: 'mp3'
      })
    ]));
  });

  it('preserves Xiaohongshu note tokens for probe and download but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'xiaohongshu');
    await mkdir(workdir, { recursive: true });
    const sourceUrl = 'https://www.xiaohongshu.com/explore/6a9149f3000000001f01d20a?xsec_token=sample%3D&xsec_source=pc_feed';
    await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl } }));
    let args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(sourceUrl);

    const probe = { ...parsedProbe(), requestedUrl: sourceUrl, url: sourceUrl };
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    await executor.run(stageInput({
      workdir, stageId: 'download',
      state: { sourceUrl, mediaType: 'video', selectedOptionId: 'video-360-2' },
      inputArtifacts: [probeArtifact]
    }));
    args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(sourceUrl);

    const audioProbe = parseDownloadProbe({
      id: '6a9149f3000000001f01d20a',
      title: 'Public video note',
      extractor_key: 'XiaoHongShu',
      webpage_url: sourceUrl,
      formats: [{
        format_id: '0', ext: 'mp4', width: 1388, height: 720,
        vcodec: 'h264', acodec: 'aac'
      }]
    }, sourceUrl);
    const audioProbeArtifact = await writeProbeArtifact(workdir, audioProbe);
    const audio = await executor.run(stageInput({
      workdir, stageId: 'download',
      state: { sourceUrl, mediaType: 'audio', selectedOptionId: 'audio-mp3-192' },
      inputArtifacts: [audioProbeArtifact]
    }));
    args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '-f', '0', '--extract-audio', '--audio-format', 'mp3', sourceUrl
    ]));
    expect(audio.outputs).toEqual([expect.objectContaining({ kind: 'source_audio' })]);

    for (const invalidUrl of [
      'https://www.xiaohongshu.com/user/profile/6a9149f3000000001f01d20a',
      'https://notxiaohongshu.com/explore/6a9149f3000000001f01d20a',
      'https://www.xiaohongshu.com/explore/not-a-note'
    ]) {
      await expect(executor.run(stageInput({
        workdir, stageId: 'probe', state: { sourceUrl: invalidUrl }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('extracts a Douyin short link from copied share text', async () => {
    const shortUrl = 'https://v.douyin.com/aN88tM5tjyE/';
    const shareText = `2.53 jCu:/ AI复刻爆款短视频全流程！ ${shortUrl} 复制此链接，打开Dou音搜索，直接观看视频！`;
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'douyin-share-text');
    await mkdir(workdir, { recursive: true });
    const result = await executor.run(stageInput({
      workdir, stageId: 'probe', state: { sourceUrl: shareText }
    }));
    const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(shortUrl);
    expect(result.outputs[0]?.metadata?.requestedUrl).toBe(shortUrl);
    expect(extractDouyinShareUrl(`${shareText} (${shortUrl})`)).toBe(shortUrl);
    expect(extractDouyinShareUrl(`${shortUrl} 复制此链接，打开抖音观看`)).toBe(shortUrl);
    expect(extractDouyinShareUrl('https://notv.douyin.com/aN88tM5tjyE/')).toBe('https://notv.douyin.com/aN88tM5tjyE/');
    expect(extractDouyinShareUrl(`${shortUrl} https://v.douyin.com/other/`))
      .toBe(`${shortUrl} https://v.douyin.com/other/`);
  });

  it('lists separate formats for both videos in an X post', () => {
    const probe = xMultiVideoProbe();
    expect(probe).toMatchObject({
      id: 'post-123',
      platform: 'x',
      requestedUrl: 'https://x.com/creator/status/123'
    });
    expect(probe.options.filter(option => option.mediaType === 'video')).toEqual([
      expect.objectContaining({
        id: 'item-1-video-720-1', videoFormatId: 'first-video', playlistIndex: 1
      }),
      expect.objectContaining({
        id: 'item-2-video-1080-1', videoFormatId: 'second-video', playlistIndex: 2
      })
    ]);
  });

  it('downloads the selected second video instead of the entire X post', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'x-second-video');
    await mkdir(workdir, { recursive: true });
    const probe = xMultiVideoProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);
    await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'item-2-video-1080-1'
      },
      inputArtifacts: [probeArtifact]
    }));
    const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args.slice(args.indexOf('--playlist-items'), args.indexOf('--playlist-items') + 2))
      .toEqual(['--playlist-items', '2']);
    expect(args.slice(args.indexOf('-f'), args.indexOf('-f') + 2))
      .toEqual(['-f', 'second-video']);
  });

  it('recognizes X and legacy Twitter extractor results', () => {
    for (const extractor_key of ['Twitter', 'Twitter:Amplify', 'X']) {
      const probe = parseDownloadProbe({
        id: '123',
        title: 'Public post',
        webpage_url: 'https://x.com/creator/status/123',
        extractor_key,
        formats: [{
          format_id: 'hls-720', ext: 'mp4', width: 1280, height: 720,
          vcodec: 'avc1', acodec: 'mp4a'
        }]
      }, 'https://x.com/creator/status/123');
      expect(probe.platform).toBe('x');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'hls-720' })
      ]));
    }
  });

  it('recognizes TikTok extractor formats', () => {
    for (const extractor_key of ['TikTok', 'TikTokVM']) {
      const probe = parseDownloadProbe({
        id: '123', title: 'Public TikTok',
        webpage_url: 'https://www.tiktok.com/@creator/video/123',
        extractor_key,
        formats: [{
          format_id: 'download', ext: 'mp4', width: 720, height: 1280,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, 'https://vm.tiktok.com/abc123/');
      expect(probe).toMatchObject({ platform: 'tiktok', requestedUrl: 'https://vm.tiktok.com/abc123/' });
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'download' })
      ]));
    }
  });

  it('recognizes Douyin video formats even when a short link resolves through TikTok', () => {
    for (const [extractor_key, requestedUrl] of [
      ['Douyin', 'https://www.douyin.com/video/123'],
      ['TikTok', 'https://v.douyin.com/abc123/']
    ]) {
      const probe = parseDownloadProbe({
        id: '123', title: 'Public Douyin video',
        webpage_url: 'https://www.douyin.com/video/123', extractor_key,
        formats: [{
          format_id: 'download', ext: 'mp4', width: 720, height: 1280,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, requestedUrl);
      expect(probe.platform).toBe('douyin');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'download' })
      ]));
    }
  });

  it('recognizes Facebook video and reel extractor results', () => {
    for (const extractor_key of ['Facebook', 'Facebook:Reel']) {
      const probe = parseDownloadProbe({
        id: '123', title: 'Public reel',
        webpage_url: 'https://www.facebook.com/reel/123', extractor_key,
        formats: [{
          format_id: 'sd', ext: 'mp4', width: 640, height: 360,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, 'https://fb.watch/abc123/');
      expect(probe.platform).toBe('facebook');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'sd' })
      ]));
    }
  });

  it('passes Facebook videos, reels and short links to yt-dlp but rejects profiles and impostors', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const [index, url] of [
      'https://www.facebook.com/watch/?v=123',
      'https://m.facebook.com/reel/123',
      'https://facebook.com/videos/123',
      'https://www.facebook.com/creator/videos/123',
      'https://fb.watch/abc123/'
    ].entries()) {
      const workdir = join(tempDir, `facebook-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of [
      'https://www.facebook.com/creator',
      'https://www.facebook.com/watch/',
      'https://notfacebook.com/reel/123',
      'https://fb.watch/'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('passes Douyin videos and short links to yt-dlp but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const [index, url] of [
      'https://www.douyin.com/video/123',
      'https://douyin.com/video/123?modal_id=123',
      'https://v.douyin.com/abc123/'
    ].entries()) {
      const workdir = join(tempDir, `douyin-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of [
      'https://www.douyin.com/user/creator',
      'https://notdouyin.com/video/123',
      'https://v.douyin.com/'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it.each([
    ['https://www.douyin.com/jingxuan?modal_id=7687030616353823355', 'https://www.douyin.com/video/7687030616353823355'],
    ['https://www.douyin.com/jingxuan/search/qianjidong?aid=2052a92f-0793-47c1-b739-c0af829b6103&modal_id=7693859410975690010&type=general',
      'https://www.douyin.com/video/7693859410975690010']
  ])('converts a Douyin jingxuan modal link into a video URL for probing and downloading: %s', async (sourceUrl, videoUrl) => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const workdir = join(tempDir, 'douyin-featured');
    await mkdir(workdir, { recursive: true });
    const result = await executor.run(stageInput({
      workdir, stageId: 'probe', state: { sourceUrl }
    }));
    expect(result.outputs[0]?.metadata?.requestedUrl).toBe(sourceUrl);
    let args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(videoUrl);
    expect(args).not.toContain(sourceUrl);

    const probe = { ...parsedProbe(), requestedUrl: sourceUrl, url: videoUrl };
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    await executor.run(stageInput({
      workdir, stageId: 'download',
      state: { sourceUrl, mediaType: 'video', selectedOptionId: 'video-360-2' },
      inputArtifacts: [probeArtifact]
    }));
    args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
    expect(args).toContain(videoUrl);
    expect(args).not.toContain(sourceUrl);
  });

  it('rejects a Douyin jingxuan page without a numeric modal id', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const sourceUrl of [
      'https://www.douyin.com/jingxuan',
      'https://www.douyin.com/jingxuan?modal_id=abc',
      'https://www.douyin.com/jingxuan/search/qianjidong',
      'https://www.douyin.com/jingxuan/search/qianjidong?modal_id=abc',
      'https://notdouyin.com/jingxuan?modal_id=123'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('reports a missing fresh Douyin cookie as an access requirement', async () => {
    const binaries = await fakeBinaries({ failure: 'ERROR: Fresh cookies (not necessarily logged in) are needed' });
    const executor = createDownloadExecutor(binaries);
    await expect(executor.run(stageInput({
      workdir: tempDir, stageId: 'probe',
      state: { sourceUrl: 'https://www.douyin.com/jingxuan?modal_id=7687030616353823355' }
    }))).rejects.toMatchObject({ code: 'login_required' });
  });

  it('preserves the Douyin session requirement when the preceding API warning contains HTTP 403', async () => {
    const binaries = await fakeBinaries({ failure: 'WARNING: [Douyin] Failed to download web detail JSON: HTTP Error 403: Forbidden\nERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed' });
    const executor = createDownloadExecutor(binaries);
    await expect(executor.run(stageInput({
      workdir: tempDir, stageId: 'probe', state: { sourceUrl: 'https://www.douyin.com/video/7693859410975690010' }
    }))).rejects.toMatchObject({
      code: 'platform_session_required',
      publicFacts: { kind: 'unauthorized', provider: 'yt-dlp', httpStatus: 403,
        upstreamMessage: expect.stringContaining('Fresh cookies (not necessarily logged in) are needed') }
    });
  });

  it('selects the runtime session using the queued source instead of the edited draft URL', async () => {
    const binaries = await fakeBinaries();
    const sourceUrl = 'https://www.douyin.com/video/7693859410975690010';
    const workdir = join(tempDir, 'queued-douyin-cookie');
    await mkdir(workdir, { recursive: true });
    const probeArtifact = await writeProbeArtifact(workdir, { ...parsedProbe(), requestedUrl: sourceUrl, url: sourceUrl });
    const getYtDlpRuntime = vi.fn(() => ({ executable: binaries.ytDlpPath,
      prefixArgs: [...binaries.ytDlpPrefixArgs!, '--cookies', '/test/douyin-cookies.txt'], env: {}, version: 'test' }));
    const input = stageInput({ workdir, stageId: 'download',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=draft', mediaType: 'video', selectedOptionId: 'video-360-2' },
      inputArtifacts: [probeArtifact] });
    input.stageRun.progress.sourceUrl = sourceUrl;
    await createDownloadExecutor({ ...binaries, getYtDlpRuntime }).run(input);
    expect(getYtDlpRuntime).toHaveBeenCalledWith(sourceUrl);
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8'))).toEqual(expect.arrayContaining(['--cookies', '/test/douyin-cookies.txt', sourceUrl]));
  });

  it.each(['Douyin', 'Douyin+opencreator'])('distinguishes the confirmed %s signature incompatibility from cookie and model permissions', async prefix => {
    const binaries = await fakeBinaries({ failure: `ERROR: [${prefix}] Douyin request signature is required (HTTP Error 403; Signature Not Found). Reconnecting cookies alone cannot fix it.` });
    await expect(createDownloadExecutor(binaries).run(stageInput({ workdir: tempDir, stageId: 'probe',
      state: { sourceUrl: 'https://www.douyin.com/video/7693859410975690010' }
    }))).rejects.toMatchObject({ code: 'platform_request_signature_required',
      publicFacts: { kind: 'unsupported', provider: 'yt-dlp', httpStatus: 403,
        upstreamMessage: expect.stringContaining('Signature Not Found') } });
  });

  it('recognizes Instagram extractor formats', () => {
    for (const extractor_key of ['Instagram', 'Instagram:Story']) {
      const probe = parseDownloadProbe({
        id: 'abc123', title: 'Public reel',
        webpage_url: 'https://www.instagram.com/reel/abc123/',
        extractor_key,
        formats: [{
          format_id: 'dash-720', ext: 'mp4', width: 720, height: 1280,
          vcodec: 'h264', acodec: 'aac'
        }]
      }, 'https://www.instagram.com/reel/abc123/');
      expect(probe.platform).toBe('instagram');
      expect(probe.options).toEqual(expect.arrayContaining([
        expect.objectContaining({ mediaType: 'video', videoFormatId: 'dash-720' })
      ]));
    }
  });

  it('does not offer video formats for image-only Instagram posts', () => {
    const probe = parseDownloadProbe({
      id: 'image123', title: 'Image post', extractor_key: 'Instagram',
      webpage_url: 'https://www.instagram.com/p/image123/', formats: []
    }, 'https://www.instagram.com/p/image123/');
    expect(probe.platform).toBe('instagram');
    expect(probe.options).toEqual([]);
  });

  it('passes Instagram reels and posts to yt-dlp but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const [index, url] of [
      'https://www.instagram.com/reel/abc123/',
      'https://instagram.com/p/abc123/',
      'https://www.instagram.com/tv/abc123/'
    ].entries()) {
      const workdir = join(tempDir, `instagram-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of [
      'https://www.instagram.com/creator/',
      'https://notinstagram.com/reel/abc123/',
      'https://www.instagram.com/stories/creator/123/'
    ]) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('passes TikTok video and short URLs to yt-dlp, but rejects profiles and lookalike hosts', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    const urls = [
      'https://www.tiktok.com/@creator/video/123',
      'https://m.tiktok.com/@creator/video/123',
      'https://vm.tiktok.com/abc123/',
      'https://vt.tiktok.com/abc123/'
    ];
    for (const [index, url] of urls.entries()) {
      const workdir = join(tempDir, `tiktok-${index}`);
      await mkdir(workdir, { recursive: true });
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
    for (const url of ['https://www.tiktok.com/@creator', 'https://not-tiktok.com/@creator/video/123']) {
      await expect(executor.run(stageInput({
        workdir: tempDir, stageId: 'probe', state: { sourceUrl: url }
      }))).rejects.toMatchObject({ code: 'unsupported_source' });
    }
  });

  it('passes X and Twitter post URLs to the existing yt-dlp probe', async () => {
    const binaries = await fakeBinaries();
    const executor = createDownloadExecutor(binaries);
    for (const host of ['x.com', 'twitter.com']) {
      const workdir = join(tempDir, host);
      await mkdir(workdir, { recursive: true });
      const url = `https://${host}/creator/status/123`;
      await executor.run(stageInput({ workdir, stageId: 'probe', state: { sourceUrl: url } }));
      const args = JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')) as string[];
      expect(args).toContain(url);
    }
  });

  it('normalizes real video and MP3 choices without exposing arbitrary state format ids', () => {
    const probe = parsedProbe();

    expect(probe).toMatchObject({
      requestedUrl: 'https://www.youtube.com/watch?v=demo',
      platform: 'youtube',
      uploader: 'OpenCreator',
      width: 1920,
      height: 1080
    });
    expect(probe.options).toEqual([
      expect.objectContaining({
        id: 'video-1080-1',
        mediaType: 'video',
        container: 'mp4',
        videoFormatId: '137',
        audioFormatId: '140',
        audioLanguage: 'und',
        estimatedBytes: 120
      }),
      expect.objectContaining({
        id: 'video-360-2',
        mediaType: 'video',
        videoFormatId: '18'
      }),
      expect.objectContaining({
        id: 'audio-mp3-320',
        mediaType: 'audio',
        bitrateKbps: 320,
        audioFormatId: '140',
        audioLanguage: 'und',
        transcode: 'mp3'
      }),
      expect.objectContaining({ id: 'audio-mp3-192' }),
      expect.objectContaining({ id: 'audio-mp3-128' })
    ]);
  });

  it('creates video and MP3 choices for each detected audio language', () => {
    const probe = multilingualParsedProbe();

    expect(probe.formats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'audio-en',
        language: 'en',
        languagePreference: 10
      }),
      expect.objectContaining({
        id: 'audio-es',
        language: 'es',
        languagePreference: 5
      })
    ]));
    expect(probe.options.filter(option => option.mediaType === 'video')).toEqual([
      expect.objectContaining({
        id: 'video-1080-1-audio-en',
        videoFormatId: 'video-1080',
        audioFormatId: 'audio-en',
        audioLanguage: 'en'
      }),
      expect.objectContaining({
        id: 'video-1080-1-audio-es',
        videoFormatId: 'video-1080',
        audioFormatId: 'audio-es',
        audioLanguage: 'es'
      })
    ]);
    expect(probe.options.filter(option => option.mediaType === 'audio')).toHaveLength(6);
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'audio-mp3-192-audio-en',
        audioFormatId: 'audio-en',
        audioLanguage: 'en'
      }),
      expect.objectContaining({
        id: 'audio-mp3-192-audio-es',
        audioFormatId: 'audio-es',
        audioLanguage: 'es'
      })
    ]));
  });

  it('offers MP3 extraction when the source only has a combined media format', () => {
    const probe = parseDownloadProbe({
      id: 'progressive-only',
      title: 'Progressive only',
      webpage_url: 'https://www.youtube.com/watch?v=progressive-only',
      extractor_key: 'Youtube',
      duration: 10,
      formats: [{
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        tbr: 500,
        filesize: 30,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }]
    }, 'https://www.youtube.com/watch?v=progressive-only');

    expect(probe.options).toEqual([
      expect.objectContaining({
        id: 'video-360-1',
        videoFormatId: '18'
      }),
      expect.objectContaining({
        id: 'audio-mp3-320',
        audioFormatId: '18',
        transcode: 'mp3'
      }),
      expect.objectContaining({ id: 'audio-mp3-192' }),
      expect.objectContaining({ id: 'audio-mp3-128' })
    ]);
  });

  it('accepts null metadata fields emitted by real yt-dlp probes', () => {
    const probe = parseDownloadProbe({
      id: 'nullable-fields',
      title: 'Nullable fields',
      webpage_url: 'https://www.youtube.com/watch?v=nullable-fields',
      extractor_key: 'Youtube',
      uploader: null,
      channel: null,
      thumbnail: null,
      width: null,
      height: null,
      formats: [{
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        fps: null,
        tbr: null,
        abr: null,
        filesize: null,
        filesize_approx: null,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }, {
        format_id: 'storyboard',
        ext: 'mhtml',
        width: null,
        height: null,
        fps: null,
        tbr: null,
        abr: null,
        filesize: null,
        filesize_approx: null,
        vcodec: null,
        acodec: null
      }]
    }, 'https://www.youtube.com/watch?v=nullable-fields');

    expect(probe).toMatchObject({
      uploader: null,
      thumbnailUrl: null,
      width: 640,
      height: 360
    });
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'video-360-1',
        videoFormatId: '18'
      })
    ]));
  });

  it('estimates video size from duration and bitrate instead of using audio bytes alone', () => {
    const probe = parseDownloadProbe({
      id: 'estimated-size',
      title: 'Estimated size',
      webpage_url: 'https://www.youtube.com/watch?v=estimated-size',
      extractor_key: 'Youtube',
      duration: 100,
      formats: [{
        format_id: 'video',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        tbr: 4_000,
        filesize: null,
        filesize_approx: null,
        vcodec: 'avc1',
        acodec: 'none'
      }, {
        format_id: 'audio',
        ext: 'm4a',
        abr: 128,
        filesize: 1_600_000,
        vcodec: 'none',
        acodec: 'mp4a'
      }]
    }, 'https://www.youtube.com/watch?v=estimated-size');

    expect(probe.options[0]).toMatchObject({
      id: 'video-1080-1',
      estimatedBytes: 51_600_000
    });
  });

  it('downloads the selected video option with bundled ffmpeg and emits verified metadata', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'video-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      progress: {
        optionId: 'video-1080-1',
        mediaType: 'video',
        sourceUrl: probe.requestedUrl
      },
      inputArtifacts: [probeArtifact],
      reportProgress
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--encoding',
      'utf-8',
      '--proxy',
      'http://127.0.0.1:7897',
      '--ffmpeg-location',
      binaries.ffmpegPath,
      '--progress',
      '--continue',
      '--progress-delta',
      '0.5',
      '-f',
      '137+140',
      '--merge-output-format',
      'mp4'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      status: 'completed',
      metadata: expect.objectContaining({
        fileName: 'download.mp4',
        mimeType: 'video/mp4',
        size: 14,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        optionId: 'video-1080-1',
        selectedHeight: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        playbackCompatible: true,
        normalizedForPlayback: false
      })
    })]);
    const downloadPercents = reportProgress.mock.calls
      .map(([progress]) => progress)
      .filter(progress => progress.phase === 'downloading')
      .map(progress => Number(progress.percent));
    expect(downloadPercents).toHaveLength(3);
    expect(downloadPercents).toEqual(
      [...downloadPercents].sort((left, right) => left - right)
    );
    expect(downloadPercents).toEqual([35, 80, 81]);
    expect(downloadPercents.at(-1)).toBeGreaterThan(downloadPercents[1]!);
    expect(reportProgress.mock.calls
      .map(([progress]) => progress)
      .filter(progress => progress.phase === 'downloading')
      .map(progress => progress.bytesPerSecond))
      .toEqual([2.5 * 1024 ** 2, 512_000, null]);
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'succeeded',
      phase: 'completed',
      percent: 100
    }));
  });

  it('downloads the audio track bound to the selected video language', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'multilingual-video-work');
    await mkdir(workdir, { recursive: true });
    const probe = multilingualParsedProbe();
    const option = probe.options.find(candidate => (
      candidate.mediaType === 'video'
      && candidate.audioLanguage === 'es'
    ));
    expect(option).toBeDefined();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: option!.id
      },
      inputArtifacts: [probeArtifact]
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '-f',
      'video-1080+audio-es'
    ]));
    expect(result.outputs[0]?.metadata).toEqual(expect.objectContaining({
      optionId: option!.id,
      audioLanguage: 'es'
    }));
  });

  it('converts VP9 MP4 downloads to H.264 for local playback', async () => {
    const binaries = await fakeBinaries({ videoCodec: 'vp9' });
    const workdir = join(tempDir, 'vp9-video-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      inputArtifacts: [probeArtifact],
      reportProgress
    }));

    const ffmpegArgs = JSON.parse(
      await readFile(join(workdir, 'ffmpeg-args.json'), 'utf8')
    ) as string[];
    expect(ffmpegArgs).toEqual(expect.arrayContaining([
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      path: expect.stringMatching(/\.playable\.mp4$/),
      metadata: expect.objectContaining({
        fileName: 'download.mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        pixelFormat: 'yuv420p',
        playbackCompatible: true,
        normalizedForPlayback: true
      })
    })]);
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'normalizing_media',
      percent: 98
    }));
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'normalizing_media',
      percent: 99,
      phasePercent: 50
    }));
  }, 20_000);

  it('extracts the selected audio option as an MP3 source artifact', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'audio-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'audio',
        selectedOptionId: 'audio-mp3-192'
      },
      inputArtifacts: [probeArtifact]
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '-f',
      '140',
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '192K'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_audio',
      metadata: expect.objectContaining({
        fileName: 'download.mp3',
        mimeType: 'audio/mpeg',
        mediaType: 'audio',
        selectedBitrateKbps: 192,
        hasAudio: true,
        hasVideo: false
      })
    })]);
  });

  it('downloads a YouTube source for stickman video without a probe artifact', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'stickman-source-work');
    await mkdir(workdir, { recursive: true });
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'acquire-source',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=stickman-demo'
      },
      reportProgress
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '--ffmpeg-location',
      binaries.ffmpegPath,
      '-f',
      'bestvideo+bestaudio/best',
      '--merge-output-format',
      'mp4'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      status: 'completed',
      metadata: expect.objectContaining({
        source: 'stickman-video',
        sourceUrl: 'https://www.youtube.com/watch?v=stickman-demo',
        mimeType: 'video/mp4',
        playbackCompatible: true
      })
    })]);
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'succeeded',
      phase: 'completed',
      percent: 100
    }));
  });

  it('rejects a stale probe after the source URL changes', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'stale-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=changed',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      inputArtifacts: [probeArtifact]
    }))).rejects.toMatchObject({ code: 'download_probe_stale' });
  });

  it('routes probe requests through the configured media proxy', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'probe-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '--dump-single-json'
    ]));
  });

  it('passes portable runtime prefix arguments and environment to yt-dlp', async () => {
    const binaries = await fakeBinaries({ portableRuntime: true });
    const workdir = join(tempDir, 'portable-probe-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args[0]).toBe('--portable-runtime');
    expect(JSON.parse(
      await readFile(join(workdir, 'runtime-env.json'), 'utf8')
    )).toEqual({
      sslCertificateFile: '/runtime/cacert.pem'
    });
  });

  it('keeps probe progress indeterminate until video information is ready', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'probe-progress-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);
    const reportProgress = vi.fn();

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      },
      reportProgress
    }));

    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([
      expect.objectContaining({
        phase: 'validating',
        percent: null
      }),
      expect.objectContaining({
        phase: 'probing_source',
        percent: null
      }),
      expect.objectContaining({
        phase: 'completed',
        percent: 100
      })
    ]);
    expect(result.progress).toEqual(expect.objectContaining({
      phase: 'completed',
      percent: 100
    }));
  });

  it('reports the yt-dlp timeout cause and safe public facts', async () => {
    const binaries = await fakeBinaries({
      failure: "ERROR: Unable to download API page: Connection to www.youtube.com timed out."
    });
    const workdir = join(tempDir, 'network-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({
      code: 'network_unavailable',
      message: 'yt-dlp connection to the video platform timed out. Check the network or proxy settings.',
      publicFacts: { kind: 'timeout', provider: 'yt-dlp' }
    });
  });

  it('preserves a non-ASCII output filename split across stdout chunks', async () => {
    const fileName = 'clip-\u2019-test.mp4';
    const binaries = await fakeBinaries({ outputName: fileName, splitOutputUtf8: true });
    const workdir = join(tempDir, 'unicode-output-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const executor = createDownloadExecutor(binaries);
    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }));

    expect(result.outputs[0]?.path).toBe(await realpath(join(workdir, fileName)));
    expect(result.outputs[0]?.metadata?.fileName).toBe(fileName);
    expect(JSON.parse(await readFile(join(workdir, 'args.json'), 'utf8')))
      .toEqual(expect.arrayContaining(['--encoding', 'utf-8']));
  });

  it('identifies a damaged reported filename rather than returning a generic ENOENT', async () => {
    const binaries = await fakeBinaries({
      outputName: 'clip-\u2019-test.mp4',
      reportedOutputName: 'clip-\uFFFD\uFFFD-test.mp4'
    });
    const workdir = join(tempDir, 'damaged-output-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }))).rejects.toMatchObject({
      code: 'download_output_encoding_invalid',
      publicFacts: { kind: 'invalid-response', provider: 'yt-dlp' }
    });
  });

  it('reports a missing yt-dlp output with a download-specific error', async () => {
    const binaries = await fakeBinaries({ reportedOutputName: 'other.mp4' });
    const workdir = join(tempDir, 'missing-output-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      inputArtifacts: [await writeProbeArtifact(workdir, probe)]
    }))).rejects.toMatchObject({
      code: 'download_output_missing',
      publicFacts: { kind: 'not-found', provider: 'yt-dlp' }
    });
  });

  it('reports proxy refusal separately from a platform timeout', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: ProxyError: connection refused at http://user:secret@127.0.0.1:7897'
    });
    const workdir = join(tempDir, 'proxy-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
    }))).rejects.toMatchObject({
      code: 'network_unavailable',
      message: expect.stringContaining('proxy connection was refused'),
      publicFacts: { kind: 'connection-refused', provider: 'yt-dlp' }
    });
  });

  it('reports an upstream HTTP status without leaking the request URL', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Unable to download webpage: HTTP Error 403: Forbidden https://example.com/?token=secret'
    });
    const workdir = join(tempDir, 'http-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
    }))).rejects.toMatchObject({
      code: 'download_http_error',
      message: 'The video platform returned HTTP 403 to yt-dlp.',
      publicFacts: { kind: 'unauthorized', provider: 'yt-dlp', httpStatus: 403 }
    });
  });

  it('keeps an unclassified yt-dlp cause while redacting links and tokens', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Extractor returned an unexpected challenge at https://example.com/?token=secret token=private'
    });
    const workdir = join(tempDir, 'unknown-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    try {
      await executor.run(stageInput({
        workdir,
        stageId: 'probe',
        state: { sourceUrl: 'https://www.youtube.com/watch?v=demo' }
      }));
      throw new Error('Expected yt-dlp to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'download_failed',
        publicFacts: { kind: 'unknown', provider: 'yt-dlp' }
      });
      const message = (error as Error).message;
      expect(message).toContain('unexpected challenge');
      expect(message).not.toContain('example.com');
      expect(message).not.toContain('private');
      expect(message).not.toContain('secret');
    }
  });

  it('recommends updating yt-dlp when the platform extractor is outdated', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Signature extraction failed. Please update to the latest version.'
    });
    const workdir = join(tempDir, 'outdated-extractor-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({
      code: 'yt_dlp_update_recommended',
      message: 'yt-dlp could not extract this video; its platform extractor may be outdated.',
      publicFacts: { kind: 'unsupported', provider: 'yt-dlp' }
    });
  });

  it('identifies a Bilibili risk-control rejection even when the extractor also reports no formats', async () => {
    const binaries = await fakeBinaries({
      failure: 'WARNING: Bilibili risk control rejected the playback API request\nERROR: No video formats found!'
    });
    const workdir = join(tempDir, 'bilibili-risk-control-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);
    await expect(executor.run(stageInput({
      workdir, stageId: 'probe', state: { sourceUrl: 'https://www.bilibili.com/video/BV18Qhf6hE8P?p=1' }
    }))).rejects.toMatchObject({
      code: 'download_failed',
      message: 'Bilibili risk control rejected the media request. Wait and retry, or use a local video file.',
      publicFacts: { kind: 'http-rejected', provider: 'yt-dlp' }
    });
  });

  it('does not attribute a later format selection failure to successful Bilibili risk-control fallback', async () => {
    const binaries = await fakeBinaries({
      failure: 'WARNING: Bilibili risk control rejected the playback API request; retaining webpage media formats when available\nERROR: Requested format is not available'
    });
    const workdir = join(tempDir, 'bilibili-format-work');
    await mkdir(workdir, { recursive: true });
    await expect(createDownloadExecutor(binaries).run(stageInput({
      workdir, stageId: 'probe', state: { sourceUrl: 'https://www.bilibili.com/video/BV18Qhf6hE8P?p=1' }
    }))).rejects.toMatchObject({ publicFacts: { kind: 'not-found' } });
  });

  it('rejects misleading domains that only end with a supported domain name', async () => {
    const config = createDefaultCreatorServicesConfig();
    const executor = createDownloadExecutor({
      configStore: { read: async () => config },
      ytDlpPath: '/missing/yt-dlp',
      ffmpegPath: '/missing/ffmpeg',
      ffprobePath: '/missing/ffprobe'
    });

    await expect(executor.run(stageInput({
      workdir: '/tmp',
      stageId: 'probe',
      state: {
        sourceUrl: 'https://notyoutube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({ code: 'unsupported_source' });

    await expect(executor.run(stageInput({
      workdir: '/tmp',
      stageId: 'probe',
      state: {
        sourceUrl: 'file://youtube.com/etc/passwd'
      }
    }))).rejects.toMatchObject({ code: 'unsupported_source' });
  });
});

function parsedProbe(): DownloadProbe {
  return parseDownloadProbe({
    id: 'demo',
    title: 'Creator Download',
    webpage_url: 'https://www.youtube.com/watch?v=demo',
    extractor_key: 'Youtube',
    uploader: 'OpenCreator',
    thumbnail: 'https://i.ytimg.com/vi/demo/hqdefault.jpg',
    duration: 12,
    width: 1920,
    height: 1080,
    formats: [
      {
        format_id: '137',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 4_500,
        filesize: 100,
        vcodec: 'avc1',
        acodec: 'none'
      },
      {
        format_id: '399',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 5_000,
        filesize: 120,
        vcodec: 'av01',
        acodec: 'none'
      },
      {
        format_id: '140',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a'
      },
      {
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        tbr: 500,
        filesize: 30,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }
    ]
  }, 'https://www.youtube.com/watch?v=demo');
}

function xMultiVideoProbe(): DownloadProbe {
  return parseDownloadProbe({
    _type: 'playlist', id: 'post-123', title: 'Two videos', extractor_key: 'Twitter',
    entries: [
      {
        id: 'media-1', title: 'Video 1', extractor_key: 'Twitter',
        formats: [{
          format_id: 'first-video', ext: 'mp4', width: 1280, height: 720,
          vcodec: 'h264', acodec: 'aac'
        }]
      },
      {
        id: 'media-2', title: 'Video 2', extractor_key: 'Twitter',
        formats: [{
          format_id: 'second-video', ext: 'mp4', width: 1920, height: 1080,
          vcodec: 'h264', acodec: 'aac'
        }]
      }
    ]
  }, 'https://x.com/creator/status/123');
}

function multilingualParsedProbe(): DownloadProbe {
  return parseDownloadProbe({
    id: 'multilingual-demo',
    title: 'Multilingual Download',
    webpage_url: 'https://www.youtube.com/watch?v=multilingual-demo',
    extractor_key: 'Youtube',
    duration: 30,
    formats: [
      {
        format_id: 'video-1080',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 4_500,
        filesize: 100,
        vcodec: 'avc1',
        acodec: 'none'
      },
      {
        format_id: 'audio-en-webm',
        ext: 'webm',
        abr: 96,
        filesize: 15,
        vcodec: 'none',
        acodec: 'opus',
        language: 'en',
        language_preference: 10
      },
      {
        format_id: 'audio-en',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a',
        language: 'en',
        language_preference: 10
      },
      {
        format_id: 'audio-es',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a',
        language: 'es',
        language_preference: 5
      }
    ]
  }, 'https://www.youtube.com/watch?v=multilingual-demo');
}

async function fakeBinaries(input?: {
  failure?: string;
  videoCodec?: string;
  portableRuntime?: boolean;
  outputName?: string;
  reportedOutputName?: string;
  splitOutputUtf8?: boolean;
  subtitleContent?: string | null;
  holdDownload?: boolean;
  previewProgressEvents?: Array<Record<string, number | string | null>>;
  previewFormatId?: string | null;
  previewFormatSizes?: number[];
  previewFormats?: Array<Record<string, number | string | null>>;
  previewDuration?: number;
}): Promise<{
  configStore: {
    read(): Promise<ReturnType<typeof createDefaultCreatorServicesConfig>>;
  };
  ytDlpPath: string;
  ytDlpPrefixArgs?: string[];
  ytDlpEnv?: NodeJS.ProcessEnv;
  ffmpegPath: string;
  ffmpegPrefixArgs?: string[];
  ffprobePath: string;
  ffprobePrefixArgs?: string[];
}> {
  tempDir = await mkdtemp(join(tmpdir(), 'creator-download-executor-'));
  const ytDlpScriptPath = join(tempDir, 'yt-dlp.mjs');
  const ffmpegScriptPath = join(tempDir, 'ffmpeg.mjs');
  const ffprobeScriptPath = join(tempDir, 'ffprobe.mjs');
  const failure = input?.failure;
  const videoCodec = input?.videoCodec ?? 'h264';
  await writeExecutable(ytDlpScriptPath, `#!/usr/bin/env node
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const previewProgressEvents = ${JSON.stringify(input?.previewProgressEvents ?? null)};
writeFileSync(join(process.cwd(), 'args.json'), JSON.stringify(args));
writeFileSync(join(process.cwd(), 'runtime-env.json'), JSON.stringify({
  sslCertificateFile: process.env.SSL_CERT_FILE ?? null
}));
${failure === undefined ? '' : `process.stderr.write(${JSON.stringify(failure)} + '\\n'); process.exit(1);`}
if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({
    id: 'demo',
    title: 'Creator Download',
    webpage_url: 'https://www.youtube.com/watch?v=demo',
    extractor_key: 'Youtube',
    formats: [{
      format_id: '18',
      ext: 'mp4',
      width: 640,
      height: 360,
      vcodec: 'avc1',
      acodec: 'mp4a'
    }]
  }));
  process.exit(0);
}
if (args.includes('--skip-download')) {
  const template = args[args.indexOf('-o') + 1];
  const subtitle = ${JSON.stringify(input?.subtitleContent === undefined ? '1\n00:00:00,000 --> 00:00:01,000\nHello subtitles\n' : input.subtitleContent)};
  if (subtitle !== null) writeFileSync(template.replace('%(title).120B', 'Subtitle video').replace('%(id)s', 'demo').replace('%(ext)s', 'en.srt'), subtitle);
  process.exit(0);
}
const audio = args.includes('--extract-audio');
const output = join(process.cwd(), ${JSON.stringify(input?.outputName ?? null)} ?? (audio ? 'download.mp3' : 'download.mp4'));
const reportedOutput = join(process.cwd(), ${JSON.stringify(input?.reportedOutputName ?? null)} ?? ${JSON.stringify(input?.outputName ?? null)} ?? (audio ? 'download.mp3' : 'download.mp4'));
if (${input?.holdDownload === true}) {
  writeFileSync('starts', String(existsSync('starts') ? Number(readFileSync('starts', 'utf8')) + 1 : 1));
  let ticks = 0;
  while (!existsSync('finish')) {
    writeFileSync('ticks', String(++ticks));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
writeFileSync(output, audio ? 'download-audio' : 'download-video');
if (args.includes('--progress')) {
  if (args.includes('--progress-template')) {
    if (${JSON.stringify(input?.previewFormatId === undefined ? 'video' : input.previewFormatId)} !== null) {
      process.stdout.write('oc-preview-formats:' + ${JSON.stringify(input?.previewFormatId === undefined ? 'video' : input.previewFormatId)} + '\\n');
    }
    if (${JSON.stringify(input?.previewDuration ?? null)} !== null) {
      process.stdout.write('oc-preview-duration:' + ${JSON.stringify(input?.previewDuration ?? null)} + '\\n');
    }
    if (${JSON.stringify(input?.previewFormats ?? input?.previewFormatSizes ?? null)} !== null) {
      process.stdout.write('oc-preview-metadata:' + JSON.stringify(${JSON.stringify(input?.previewFormats ?? (input?.previewFormatSizes ?? []).map((filesize, index) => ({ format_id: String(index), filesize })))}) + '\\n');
    }
    const events = previewProgressEvents ?? [
      { downloaded_bytes: 42, total_bytes: 100 },
      { downloaded_bytes: 10 }
    ];
    for (const event of events) {
      const total = event.total_bytes ?? event.total_bytes_estimate;
      const partPercent = typeof event._percent === 'number' ? event._percent
        : typeof total === 'number' && total > 0 ? event.downloaded_bytes / total * 100 : null;
      process.stderr.write('[download] ' + (partPercent === null ? 'N/A' : partPercent.toFixed(1) + '%') + ' oc-preview:' + JSON.stringify(event) + '\\n');
    }
  }
  process.stderr.write('[download] 42.0% of 100B at 2.50MiB/s ETA 00:01\\n');
  if (!audio) {
    process.stderr.write('[download] 100% of 100B in 00:01 at 512.00KB/s\\n');
    process.stderr.write('[download] 10.0% of 20B at Unknown B/s ETA Unknown\\n');
  }
}
process.stderr.write(audio ? '[ExtractAudio] Destination\\n' : '[Merger] Merging formats\\n');
const outputBytes = Buffer.from(reportedOutput + '\\n', 'utf8');
if (${input?.splitOutputUtf8 === true}) {
  const split = outputBytes.indexOf(0xe2) + 1;
  process.stdout.write(outputBytes.subarray(0, split));
  setTimeout(() => process.stdout.write(outputBytes.subarray(split)), 10);
} else {
  process.stdout.write(outputBytes);
}
`);
  await writeExecutable(ffmpegScriptPath, `#!/usr/bin/env node
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(join(process.cwd(), 'ffmpeg-args.json'), JSON.stringify(args));
const inputIndex = args.indexOf('-i');
copyFileSync(args[inputIndex + 1], args.at(-1));
process.stderr.write('out_time=00:00:06.000000\\n');
`);
  await writeExecutable(ffprobeScriptPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('format=duration')) {
  process.stdout.write('12\\n');
  process.exit(0);
}
const path = process.argv.at(-1) ?? '';
const audio = path.endsWith('.mp3');
const compatible = path.endsWith('.playable.mp4');
process.stdout.write(JSON.stringify({
  format: { duration: '12' },
  streams: audio
    ? [{ codec_type: 'audio', codec_name: 'mp3' }]
    : [
        {
          codec_type: 'video',
          codec_name: compatible ? 'h264' : ${JSON.stringify(videoCodec)},
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080
        },
        { codec_type: 'audio', codec_name: 'aac' }
      ]
}));
`);
  const config = createDefaultCreatorServicesConfig();
  config.proxy = 'http://127.0.0.1:7897';
  return {
    configStore: { read: async () => config },
    ytDlpPath: process.execPath,
    ytDlpPrefixArgs: [
      ytDlpScriptPath,
      ...(input?.portableRuntime ? ['--portable-runtime'] : [])
    ],
    ...(input?.portableRuntime
      ? {
          ytDlpEnv: {
            SSL_CERT_FILE: '/runtime/cacert.pem'
          }
        }
      : {}),
    ffmpegPath: process.execPath,
    ffmpegPrefixArgs: [ffmpegScriptPath],
    ffprobePath: process.execPath,
    ffprobePrefixArgs: [ffprobeScriptPath]
  };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function writeProbeArtifact(
  workdir: string,
  probe: DownloadProbe
): Promise<CreatorArtifact> {
  const path = join(workdir, 'probe.json');
  await writeFile(path, JSON.stringify(probe));
  return {
    id: 'probe_artifact',
    jobId: 'download_job',
    kind: 'download_probe',
    version: 1,
    status: 'completed',
    path,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {},
    createdAt: '2026-08-30T00:00:00.000Z'
  };
}

function stageInput(input: {
  workdir: string;
  stageId: 'probe' | 'download' | 'acquire-source';
  state: CreatorJob['state'];
  progress?: CreatorStageRun['progress'];
  inputArtifacts?: CreatorArtifact[];
  reportProgress?: CreatorExecutorInput['reportProgress'];
}): CreatorExecutorInput {
  const createdAt = '2026-08-30T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'download_job',
    projectId: 'project_1',
    templateId: input.stageId === 'acquire-source'
      ? 'stickman-video'
      : 'video-download',
    templateVersion: 2,
    status: 'running',
    revision: 1,
    presetOrigin: null,
    state: input.state,
    agentThreadId: null,
    stages: [],
    artifacts: input.inputArtifacts ?? [],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
  const stageRun: CreatorStageRun = {
    id: `stage_${input.stageId}`,
    jobId: job.id,
    stageId: input.stageId,
    executor: 'download',
    status: 'running',
    dispatchStatus: 'claimed',
    claimOwner: 'test',
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: null,
    scopeKey: null,
    inputFingerprint: null,
    progress: input.progress ?? {},
    errorCode: null,
    errorMessage: null,
    startedAt: createdAt,
    finishedAt: null
  };
  return {
    stageRun,
    job,
    inputArtifacts: input.inputArtifacts ?? [],
    workdir: input.workdir,
    signal: new AbortController().signal,
    reportProgress: input.reportProgress ?? vi.fn()
  };
}

function previewInput(input: {
  workdir: string;
  sourceUrl: string;
  inputArtifacts?: CreatorArtifact[];
  reportProgress?: CreatorExecutorInput['reportProgress'];
}): CreatorExecutorInput {
  const stage = stageInput({
    ...input, stageId: 'acquire-source',
    state: { sourceType: 'url', sourceUrl: 'https://www.bilibili.com/video/BV18E421w7bf?p=2' },
    progress: { inputResultVersion: 1 }
  });
  stage.job.templateId = 'video-translation';
  stage.stageRun.stageId = 'prepare-source-video';
  stage.job.state.resultSnapshots = [{
    version: 1, createdAt: stage.job.createdAt, action: 'stage-succeeded', stageId: 'subtitle',
    description: 'Original subtitles', artifactRefs: {}, changedArtifactIds: [], staleArtifactIds: [],
    state: { sourceType: 'url', sourceUrl: input.sourceUrl, composeVideo: false }
  }];
  return stage;
}
