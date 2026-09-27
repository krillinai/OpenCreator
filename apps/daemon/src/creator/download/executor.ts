import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type {
  CreatorJson,
  DownloadOption,
  DownloadProbe
} from '@opencreator/protocol';
import { extractDouyinShareUrl } from '@opencreator/protocol';
import type {
  CreatorExecutor,
  CreatorExecutorInput,
  CreatorExecutorResult
} from '../executor.js';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import { CreatorExecutorError } from '../executor.js';
import { sanitizeIssueDetail } from '../issues.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateMediaFile } from '../validators/media.js';
import { withYtDlpProxy } from '../yt-dlp/args.js';
import type { YtDlpRuntime } from '../yt-dlp/runtime.js';
import { parseDownloadProbe } from './probe-parser.js';

type DownloadExecutorOptions = {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ytDlpPath: string;
  ytDlpPrefixArgs?: string[];
  ytDlpEnv?: NodeJS.ProcessEnv;
  getYtDlpRuntime?(): YtDlpRuntime;
  ffmpegPath: string;
  ffmpegPrefixArgs?: string[];
  ffprobePath: string;
  ffprobePrefixArgs?: string[];
};

type PlaybackCodecs = {
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
};

type PlaybackOutput = PlaybackCodecs & {
  path: string;
  fileName: string;
  normalizedForPlayback: boolean;
};

const YT_DLP_UTF8_ARGS = ['--encoding', 'utf-8'];

export function createDownloadExecutor(
  input: DownloadExecutorOptions
): CreatorExecutor {
  return {
    id: 'download',
    async run(stage) {
      const url = readSourceUrl(stage);
      if (!isSupported(url)) {
        throw new CreatorExecutorError(
          'unsupported_source',
          'Only public YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, and Pinterest video URLs are supported'
        );
      }
      const proxy = (await input.configStore.read()).proxy.trim();
      if (stage.stageRun.stageId === 'probe') {
        return probe(input, url, proxy, stage);
      }
      if (stage.stageRun.stageId === 'download') {
        return stage.job.templateId === 'video-download'
          && stage.job.templateVersion >= 2
          ? downloadSelectedOption(input, url, proxy, stage)
          : downloadLegacy(input, url, proxy, stage);
      }
      if (stage.stageRun.stageId === 'acquire-source') {
        if (!isYoutube(url)) {
          throw new CreatorExecutorError(
            'unsupported_source',
            'Stickman video accepts public YouTube URLs only'
          );
        }
        return downloadStickmanSource(input, url, proxy, stage);
      }
      throw new CreatorExecutorError(
        'creator_stage_not_supported',
        'Unsupported download stage'
      );
    }
  };
}

async function probe(
  input: DownloadExecutorOptions,
  url: string,
  proxy: string,
  stage: CreatorExecutorInput
): Promise<CreatorExecutorResult> {
  stage.reportProgress({
    status: 'running',
    phase: 'validating',
    percent: null,
    message: 'Checking the video URL'
  });
  stage.reportProgress({
    status: 'running',
    phase: 'probing_source',
    percent: null,
    message: 'Reading video information and available formats'
  });
  const ytDlp = currentYtDlpRuntime(input);
  const stdout = await run(
    ytDlp.executable,
    [
      ...ytDlp.prefixArgs,
      ...YT_DLP_UTF8_ARGS,
      ...withYtDlpProxy([
        '--dump-single-json',
        '--no-playlist',
        normalizeSourceUrl(url)
      ], proxy)
    ],
    stage,
    undefined,
    ytDlp.env
  );
  let parsed: DownloadProbe;
  try {
    parsed = parseDownloadProbe(JSON.parse(stdout), url);
  } catch (error) {
    throw new CreatorExecutorError(
      'download_probe_invalid',
      error instanceof Error ? error.message : 'yt-dlp returned an invalid probe'
    );
  }
  if (parsed.options.length === 0) {
    throw new CreatorExecutorError(
      'format_unavailable',
      'No downloadable video or audio formats are available'
    );
  }
  const path = join(stage.workdir, 'probe.json');
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  const progress = {
    status: 'succeeded',
    phase: 'completed',
    percent: 100,
    message: 'Video information is ready',
    formatCount: parsed.formats.length,
    optionCount: parsed.options.length
  };
  stage.reportProgress(progress);
  return {
    outputs: [{
      kind: 'download_probe',
      status: 'completed',
      path,
      metadata: parsed as unknown as Record<string, CreatorJson>
    }],
    progress
  };
}

async function downloadSelectedOption(
  input: DownloadExecutorOptions,
  url: string,
  proxy: string,
  stage: CreatorExecutorInput
): Promise<CreatorExecutorResult> {
  const probe = await readProbe(stage);
  if (normalizeSourceUrl(probe.requestedUrl) !== normalizeSourceUrl(url)) {
    throw new CreatorExecutorError(
      'download_probe_stale',
      'The video URL changed after analysis. Analyze the current URL again.'
    );
  }
  const selectedOptionId = typeof stage.stageRun.progress.optionId === 'string'
    ? stage.stageRun.progress.optionId
    : typeof stage.job.state.selectedOptionId === 'string'
      ? stage.job.state.selectedOptionId
      : '';
  const selectedMediaType = typeof stage.stageRun.progress.mediaType === 'string'
    ? stage.stageRun.progress.mediaType
    : typeof stage.job.state.mediaType === 'string'
      ? stage.job.state.mediaType
    : '';
  const option = probe.options.find(candidate => candidate.id === selectedOptionId);
  if (option === undefined) {
    throw new CreatorExecutorError(
      'format_unavailable',
      'Select one of the formats returned by the latest analysis'
    );
  }
  if (
    selectedMediaType !== ''
    && selectedMediaType !== option.mediaType
  ) {
    throw new CreatorExecutorError(
      'format_unavailable',
      'The selected format does not match the requested media type'
    );
  }

  stage.reportProgress({
    status: 'running',
    phase: 'preparing_download',
    percent: 2,
    message: 'Preparing the selected format'
  });
  const outputTemplate = join(
    stage.workdir,
    'OpenCreator-%(title).120B-%(id)s.%(ext)s'
  );
  const downloadUrl = normalizeSourceUrl(url);
  const args = option.mediaType === 'audio'
    ? audioDownloadArgs(input.ffmpegPath, option, outputTemplate, downloadUrl, proxy)
    : videoDownloadArgs(input.ffmpegPath, option, outputTemplate, downloadUrl, proxy);
  const reportProgress = createDownloadProgressReporter(
    stage,
    option.mediaType,
    downloadPartWeights(probe, option)
  );
  const ytDlp = currentYtDlpRuntime(input);
  const stdout = await run(
    ytDlp.executable,
    [...ytDlp.prefixArgs, ...YT_DLP_UTF8_ARGS, ...args],
    stage,
    reportProgress,
    ytDlp.env
  );
  const reportedPath = printedOutputPath(stdout);
  if (reportedPath === undefined) {
    throw new CreatorExecutorError(
      'download_output_missing',
      'yt-dlp did not report an output path',
      {},
      { kind: 'invalid-response', provider: 'yt-dlp' }
    );
  }
  const downloadedPath = await safeOutputPath(stage.workdir, reportedPath);
  stage.reportProgress({
    status: 'running',
    phase: 'validating_output',
    percent: 97,
    message: 'Checking the downloaded file'
  });
  const output = option.mediaType === 'video'
    ? await normalizeVideoForPlayback(
        downloadedPath,
        input,
        stage,
        probe.duration
      )
    : {
        path: downloadedPath,
        fileName: basename(downloadedPath),
        videoCodec: null,
        audioCodec: null,
        pixelFormat: null,
        normalizedForPlayback: false
      };
  const metadata = await outputMetadata(
    output.path,
    input,
    probe,
    option,
    output
  );
  const progress = {
    status: 'succeeded',
    phase: 'completed',
    percent: 100,
    message: option.mediaType === 'audio'
      ? 'Audio downloaded to the project'
      : 'Video downloaded to the project'
  };
  stage.reportProgress(progress);
  return {
    outputs: [{
      kind: option.mediaType === 'audio' ? 'source_audio' : 'source_video',
      status: 'completed',
      path: output.path,
      metadata
    }],
    progress
  };
}

async function downloadStickmanSource(
  input: DownloadExecutorOptions,
  url: string,
  proxy: string,
  stage: CreatorExecutorInput
): Promise<CreatorExecutorResult> {
  stage.reportProgress({
    status: 'running',
    phase: 'preparing_download',
    percent: 2,
    message: 'Preparing the YouTube source'
  });
  const outputTemplate = join(stage.workdir, 'source.%(ext)s');
  const ytDlp = currentYtDlpRuntime(input);
  const stdout = await run(
    ytDlp.executable,
    [
      ...ytDlp.prefixArgs,
      ...YT_DLP_UTF8_ARGS,
      ...withYtDlpProxy([
        '--no-playlist',
        '--newline',
        '--windows-filenames',
        '--ffmpeg-location',
        input.ffmpegPath,
        '--print',
        'after_move:filepath',
        '--progress',
        '--progress-delta',
        '0.5',
        '-f',
        'bestvideo+bestaudio/best',
        '--merge-output-format',
        'mp4',
        '--remux-video',
        'mp4',
        '-o',
        outputTemplate,
        url
      ], proxy)
    ],
    stage,
    createDownloadProgressReporter(stage, 'video', [1]),
    ytDlp.env
  );
  const reportedPath = printedOutputPath(stdout);
  if (reportedPath === undefined) {
    throw new CreatorExecutorError(
      'download_output_missing',
      'yt-dlp did not report an output path',
      {},
      { kind: 'invalid-response', provider: 'yt-dlp' }
    );
  }
  const downloadedPath = await safeOutputPath(stage.workdir, reportedPath);
  stage.reportProgress({
    status: 'running',
    phase: 'validating_output',
    percent: 97,
    message: 'Checking the YouTube source'
  });
  const output = await normalizeVideoForPlayback(
    downloadedPath,
    input,
    stage,
    null
  );
  const [media, info, sha256] = await Promise.all([
    validateMediaFile(
      output.path,
      input.ffprobePath,
      input.ffprobePrefixArgs
    ),
    stat(output.path),
    sha256File(output.path)
  ]);
  const progress = {
    status: 'succeeded',
    phase: 'completed',
    percent: 100,
    message: 'YouTube source downloaded'
  };
  stage.reportProgress(progress);
  return {
    outputs: [{
      kind: 'source_video',
      status: 'completed',
      path: output.path,
      metadata: {
        ...media,
        fileName: output.fileName,
        size: info.size,
        bytes: info.size,
        sha256,
        mimeType: mimeTypeFor(output.path),
        source: 'stickman-video',
        sourceUrl: url,
        videoCodec: output.videoCodec,
        audioCodec: output.audioCodec,
        pixelFormat: output.pixelFormat,
        playbackCompatible: isPlaybackCompatible(output),
        normalizedForPlayback: output.normalizedForPlayback
      }
    }],
    progress
  };
}

async function downloadLegacy(
  input: DownloadExecutorOptions,
  url: string,
  proxy: string,
  stage: CreatorExecutorInput
): Promise<CreatorExecutorResult> {
  const probe = await readProbe(stage);
  const formatId = typeof stage.job.state.formatId === 'string'
    ? stage.job.state.formatId
    : 'bestvideo+bestaudio/best';
  if (
    formatId !== 'bestvideo+bestaudio/best'
    && !probe.formats.some(format => format.id === formatId)
  ) {
    throw new CreatorExecutorError(
      'format_unavailable',
      'Selected format is no longer available'
    );
  }
  const outputTemplate = join(stage.workdir, 'source.%(ext)s');
  const ytDlp = currentYtDlpRuntime(input);
  const stdout = await run(
    ytDlp.executable,
    [
      ...ytDlp.prefixArgs,
      ...YT_DLP_UTF8_ARGS,
      ...withYtDlpProxy([
        '--no-playlist',
        '--newline',
        '--ffmpeg-location',
        input.ffmpegPath,
        '--print',
        'after_move:filepath',
        '--progress',
        '--progress-delta',
        '0.5',
        '-f',
        formatId,
        '-o',
        outputTemplate,
        normalizeSourceUrl(url)
      ], proxy)
    ],
    stage,
    createDownloadProgressReporter(stage, 'video', [1]),
    ytDlp.env
  );
  const reportedPath = printedOutputPath(stdout);
  if (reportedPath === undefined) {
    throw new CreatorExecutorError(
      'download_output_missing',
      'yt-dlp did not report an output path',
      {},
      { kind: 'invalid-response', provider: 'yt-dlp' }
    );
  }
  const path = await safeOutputPath(stage.workdir, reportedPath);
  const media = await validateMediaFile(
    path,
    input.ffprobePath,
    input.ffprobePrefixArgs
  );
  const info = await stat(path);
  return {
    outputs: [{
      kind: 'source_video',
      status: 'completed',
      path,
      metadata: {
        ...media,
        ...sourceMetadata(probe),
        fileName: basename(path),
        size: info.size,
        bytes: info.size,
        mimeType: mimeTypeFor(path),
        sha256: await sha256File(path)
      }
    }]
  };
}

async function readProbe(stage: CreatorExecutorInput): Promise<DownloadProbe> {
  const probeArtifact = stage.inputArtifacts.find(
    artifact => artifact.kind === 'download_probe'
  );
  if (probeArtifact?.path === null || probeArtifact?.path === undefined) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      'Download probe is required'
    );
  }
  try {
    return JSON.parse(await readFile(probeArtifact.path, 'utf8')) as DownloadProbe;
  } catch {
    throw new CreatorExecutorError(
      'download_probe_invalid',
      'Download probe could not be read'
    );
  }
}

function downloadPartWeights(
  probe: DownloadProbe,
  option: DownloadOption
): number[] {
  const formatIds = option.mediaType === 'video'
    ? [option.videoFormatId, option.audioFormatId]
    : [option.audioFormatId];
  const selectedFormatIds = formatIds
    .filter((id): id is string => id !== undefined);
  if (option.playlistIndex !== undefined) {
    return Array.from({ length: Math.max(1, selectedFormatIds.length) }, () => 1);
  }
  const weights = selectedFormatIds
    .map(id => estimatedProbeFormatBytes(probe, id));
  return weights.length > 0 && weights.every(weight => weight > 0)
    ? weights
    : Array.from({ length: Math.max(1, selectedFormatIds.length) }, () => 1);
}

function estimatedProbeFormatBytes(
  probe: DownloadProbe,
  formatId: string
): number {
  const format = probe.formats.find(candidate => candidate.id === formatId);
  if (format === undefined) return 0;
  if (format.bytes !== null && format.bytes > 0) return format.bytes;
  if (
    probe.duration === null
    || format.bitrateKbps === null
    || probe.duration <= 0
    || format.bitrateKbps <= 0
  ) {
    return 0;
  }
  return probe.duration * format.bitrateKbps * 1_000 / 8;
}

function audioDownloadArgs(
  ffmpegPath: string,
  option: DownloadOption,
  outputTemplate: string,
  url: string,
  proxy: string
): string[] {
  if (option.audioFormatId === undefined || option.transcode !== 'mp3') {
    throw new CreatorExecutorError(
      'format_unavailable',
      'The selected audio format is invalid'
    );
  }
  return withYtDlpProxy([
    '--no-playlist',
    ...(option.playlistIndex === undefined ? [] : ['--playlist-items', String(option.playlistIndex)]),
    '--newline',
    '--windows-filenames',
    '--ffmpeg-location',
    ffmpegPath,
    '--print',
    'after_move:filepath',
    '--progress',
    '--progress-delta',
    '0.5',
    '-f',
    option.audioFormatId,
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--audio-quality',
    `${option.bitrateKbps ?? 192}K`,
    '-o',
    outputTemplate,
    url
  ], proxy);
}

function videoDownloadArgs(
  ffmpegPath: string,
  option: DownloadOption,
  outputTemplate: string,
  url: string,
  proxy: string
): string[] {
  if (option.videoFormatId === undefined) {
    throw new CreatorExecutorError(
      'format_unavailable',
      'The selected video format is invalid'
    );
  }
  const selector = option.audioFormatId === undefined
    ? option.videoFormatId
    : `${option.videoFormatId}+${option.audioFormatId}`;
  return withYtDlpProxy([
    '--no-playlist',
    ...(option.playlistIndex === undefined ? [] : ['--playlist-items', String(option.playlistIndex)]),
    '--newline',
    '--windows-filenames',
    '--ffmpeg-location',
    ffmpegPath,
    '--print',
    'after_move:filepath',
    '--progress',
    '--progress-delta',
    '0.5',
    '-f',
    selector,
    '--merge-output-format',
    'mp4',
    '--remux-video',
    'mp4',
    '-o',
    outputTemplate,
    url
  ], proxy);
}

async function outputMetadata(
  path: string,
  input: DownloadExecutorOptions,
  probe: DownloadProbe,
  option: DownloadOption,
  playback: PlaybackOutput
): Promise<Record<string, CreatorJson>> {
  const [media, info, sha256] = await Promise.all([
    validateMediaFile(path, input.ffprobePath, input.ffprobePrefixArgs),
    stat(path),
    sha256File(path)
  ]);
  return {
    ...media,
    ...sourceMetadata(probe),
    fileName: playback.fileName,
    size: info.size,
    bytes: info.size,
    sha256,
    mimeType: mimeTypeFor(path),
    optionId: option.id,
    mediaType: option.mediaType,
    container: option.container,
    ...(option.audioLanguage === undefined
      ? {}
      : { audioLanguage: option.audioLanguage }),
    ...(playback.videoCodec === null ? {} : { videoCodec: playback.videoCodec }),
    ...(playback.audioCodec === null ? {} : { audioCodec: playback.audioCodec }),
    ...(playback.pixelFormat === null ? {} : { pixelFormat: playback.pixelFormat }),
    ...(option.mediaType !== 'video'
      ? {}
      : {
          playbackCompatible: isPlaybackCompatible(playback),
          normalizedForPlayback: playback.normalizedForPlayback
        }),
    ...(option.width === undefined ? {} : { selectedWidth: option.width }),
    ...(option.height === undefined ? {} : { selectedHeight: option.height }),
    ...(option.fps === undefined ? {} : { selectedFps: option.fps }),
    ...(option.bitrateKbps === undefined
      ? {}
      : { selectedBitrateKbps: option.bitrateKbps })
  };
}

function sourceMetadata(probe: DownloadProbe): Record<string, CreatorJson> {
  return {
    source: 'video-download',
    sourceUrl: probe.url || probe.requestedUrl,
    requestedUrl: probe.requestedUrl,
    platform: probe.platform,
    sourceId: probe.id,
    title: probe.title,
    uploader: probe.uploader,
    thumbnailUrl: probe.thumbnailUrl
  };
}

async function normalizeVideoForPlayback(
  path: string,
  input: DownloadExecutorOptions,
  stage: CreatorExecutorInput,
  duration: number | null
): Promise<PlaybackOutput> {
  const fileName = basename(path);
  const codecs = await readPlaybackCodecs(path, input, stage);
  if (isPlaybackCompatible(codecs)) {
    return {
      path,
      fileName,
      ...codecs,
      normalizedForPlayback: false
    };
  }
  if (codecs.videoCodec === null) {
    throw new CreatorExecutorError(
      'download_output_invalid',
      'Downloaded video does not contain a video stream'
    );
  }

  stage.reportProgress({
    status: 'running',
    phase: 'normalizing_media',
    percent: 98,
    message: 'Converting video for local playback'
  });
  const outputPath = playbackOutputPath(path);
  const copyVideo = isH264Codec(codecs.videoCodec)
    && isCompatiblePixelFormat(codecs.pixelFormat);
  const args = [
    '-y',
    '-i',
    path,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    ...(copyVideo
      ? ['-c:v', 'copy']
      : [
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '20',
          '-pix_fmt', 'yuv420p',
          '-tag:v', 'avc1'
        ]),
    ...(codecs.audioCodec === null
      ? ['-an']
      : isAacCodec(codecs.audioCodec)
        ? ['-c:a', 'copy']
        : ['-c:a', 'aac', '-b:a', '192k']),
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:2',
    '-nostats',
    outputPath
  ];
  try {
    await run(
      input.ffmpegPath,
      [...(input.ffmpegPrefixArgs ?? []), ...args],
      stage,
      line => reportPlaybackConversionProgress(stage, line, duration)
    );
    await validateMediaFile(
      outputPath,
      input.ffprobePath,
      input.ffprobePrefixArgs
    );
    const normalized = await readPlaybackCodecs(outputPath, input, stage);
    if (!isPlaybackCompatible(normalized)) {
      throw new CreatorExecutorError(
        'download_playback_conversion_failed',
        'Converted video is still incompatible with local playback'
      );
    }
    await rm(path, { force: true });
    return {
      path: outputPath,
      fileName,
      ...normalized,
      normalizedForPlayback: true
    };
  } catch (error) {
    await rm(outputPath, { force: true });
    throw error;
  }
}

function reportPlaybackConversionProgress(
  stage: CreatorExecutorInput,
  line: string,
  duration: number | null
): void {
  if (duration === null || duration <= 0) return;
  const match = line.match(/^out_time=(\d+):(\d+):([\d.]+)$/);
  if (match === null) return;
  const elapsed = (
    Number(match[1]) * 3_600
    + Number(match[2]) * 60
    + Number(match[3])
  );
  if (!Number.isFinite(elapsed)) return;
  stage.reportProgress({
    status: 'running',
    phase: 'normalizing_media',
    percent: Math.min(99, 98 + Math.max(0, elapsed / duration)),
    message: 'Converting video for local playback'
  });
}

async function readPlaybackCodecs(
  path: string,
  input: DownloadExecutorOptions,
  stage: CreatorExecutorInput
): Promise<PlaybackCodecs> {
  const stdout = await run(input.ffprobePath, [
    ...(input.ffprobePrefixArgs ?? []),
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,codec_name,pix_fmt',
    '-of',
    'json',
    path
  ], stage);
  try {
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        pix_fmt?: string;
      }>;
    };
    const video = parsed.streams?.find(stream => stream.codec_type === 'video');
    const audio = parsed.streams?.find(stream => stream.codec_type === 'audio');
    return {
      videoCodec: normalizeCodec(video?.codec_name),
      audioCodec: normalizeCodec(audio?.codec_name),
      pixelFormat: normalizeCodec(video?.pix_fmt)
    };
  } catch {
    throw new CreatorExecutorError(
      'download_output_invalid',
      'Downloaded media codecs could not be inspected'
    );
  }
}

function playbackOutputPath(path: string): string {
  const extension = extname(path);
  return join(
    dirname(path),
    `${basename(path, extension)}.playable.mp4`
  );
}

function isPlaybackCompatible(codecs: PlaybackCodecs): boolean {
  return isH264Codec(codecs.videoCodec)
    && isCompatiblePixelFormat(codecs.pixelFormat)
    && (codecs.audioCodec === null || isAacCodec(codecs.audioCodec));
}

function isH264Codec(value: string | null): boolean {
  return value === 'h264'
    || value?.startsWith('avc1') === true
    || value?.startsWith('avc3') === true;
}

function isAacCodec(value: string | null): boolean {
  return value === 'aac' || value?.startsWith('mp4a') === true;
}

function isCompatiblePixelFormat(value: string | null): boolean {
  return value === 'yuv420p' || value === 'yuvj420p';
}

function normalizeCodec(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

function createDownloadProgressReporter(
  stage: CreatorExecutorInput,
  mediaType: DownloadOption['mediaType'],
  partWeights: number[]
): (line: string) => void {
  const weights = partWeights.length > 0
    && partWeights.every(weight => Number.isFinite(weight) && weight > 0)
    ? [...partWeights]
    : [1];
  let completedParts = 0;
  let previousPartPercent = 0;
  let reportedPercent = 2;
  return line => {
    const match = line.match(/\[download\]\s+([\d.]+)%/);
    if (match !== null) {
      const partPercent = Math.max(0, Math.min(100, Number(match[1])));
      if (!Number.isFinite(partPercent)) return;
      if (
        partPercent < previousPartPercent
        && previousPartPercent >= 99
        && completedParts < weights.length - 1
      ) {
        completedParts += 1;
      }
      previousPartPercent = partPercent;
      const observedBytes = parseDownloadTotalBytes(line);
      if (observedBytes !== null) weights[completedParts] = observedBytes;
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const completedWeight = weights
        .slice(0, completedParts)
        .reduce((sum, weight) => sum + weight, 0);
      const currentWeight = weights[completedParts] ?? weights.at(-1) ?? 1;
      const combinedPercent = 2 + (
        (
          completedWeight
          + currentWeight * partPercent / 100
        )
        / totalWeight
      ) * 93;
      reportedPercent = Math.max(
        reportedPercent,
        Math.min(95, combinedPercent)
      );
      stage.reportProgress({
        status: 'running',
        phase: 'downloading',
        percent: reportedPercent,
        message: mediaType === 'audio' ? 'Downloading audio' : 'Downloading video'
      });
      return;
    }
    if (/\[(?:Merger|VideoRemuxer)\]/.test(line)) {
      reportedPercent = Math.max(reportedPercent, 96);
      stage.reportProgress({
        status: 'running',
        phase: 'merging_media',
        percent: reportedPercent,
        message: 'Merging video and audio'
      });
      return;
    }
    if (/\[(?:ExtractAudio|AudioConvertor)\]/.test(line)) {
      reportedPercent = Math.max(reportedPercent, 96);
      stage.reportProgress({
        status: 'running',
        phase: 'extracting_audio',
        percent: reportedPercent,
        message: 'Converting audio to MP3'
      });
    }
  };
}

function parseDownloadTotalBytes(line: string): number | null {
  const match = /\bof\s+~?\s*([\d.]+)\s*([KMGT]?i?B)\b/i.exec(line);
  if (match === null) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1_000,
    kib: 1_024,
    mb: 1_000_000,
    mib: 1_048_576,
    gb: 1_000_000_000,
    gib: 1_073_741_824,
    tb: 1_000_000_000_000,
    tib: 1_099_511_627_776
  };
  return amount * (multipliers[unit] ?? 1);
}

async function safeOutputPath(workdir: string, path: string): Promise<string> {
  const root = await realpath(workdir);
  let actual: string;
  try {
    actual = await realpath(resolve(stagePath(workdir, path)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new CreatorExecutorError(
      'download_output_missing',
      'yt-dlp completed, but its reported output file was not found. The saved filename may differ from the reported filename.',
      {},
      { kind: 'not-found', provider: 'yt-dlp' }
    );
  }
  if (
    actual !== root
    && !actual.startsWith(`${root}\\`)
    && !actual.startsWith(`${root}/`)
  ) {
    throw new CreatorExecutorError(
      'download_output_escape',
      'Downloaded output escapes the stage workdir'
    );
  }
  return actual;
}

function stagePath(workdir: string, path: string): string {
  return resolve(path) === path ? path : join(workdir, path);
}

function printedOutputPath(stdout: string): string | undefined {
  const path = stdout
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .at(-1);
  if (path?.includes('\uFFFD')) {
    throw new CreatorExecutorError(
      'download_output_encoding_invalid',
      'yt-dlp reported an output filename with invalid text encoding. The download may exist, but its path cannot be matched safely.',
      {},
      { kind: 'invalid-response', provider: 'yt-dlp' }
    );
  }
  return path;
}

function run(
  binary: string,
  args: string[],
  stage: CreatorExecutorInput,
  onLine?: (line: string) => void,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnCreatorProcess(binary, args, {
      cwd: stage.workdir,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }, stage.signal);
    let stdout = '';
    let stderr = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const emitLines = (value: string, stream: 'stdout' | 'stderr') => {
      const combined = (stream === 'stdout' ? stdoutBuffer : stderrBuffer) + value;
      const lines = combined.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      if (stream === 'stdout') stdoutBuffer = remainder;
      else stderrBuffer = remainder;
      for (const line of lines) onLine?.(line);
    };
    child.stdout?.on('data', chunk => {
      const value = stdoutDecoder.write(chunk);
      stdout += value;
      emitLines(value, 'stdout');
    });
    child.stderr?.on('data', chunk => {
      const value = stderrDecoder.write(chunk);
      stderr += value;
      emitLines(value, 'stderr');
    });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      const trailingStdout = stdoutDecoder.end();
      const trailingStderr = stderrDecoder.end();
      stdout += trailingStdout;
      stderr += trailingStderr;
      emitLines(trailingStdout, 'stdout');
      emitLines(trailingStderr, 'stderr');
      if (stdoutBuffer) onLine?.(stdoutBuffer);
      if (stderrBuffer) onLine?.(stderrBuffer);
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(classifyDownloadError(stderr, code));
    });
  });
}

function classifyDownloadError(stderr: string, exitCode: number | null): CreatorExecutorError {
  const text = stderr.toLowerCase();
  const failure = (
    code: string,
    message: string,
    kind: NonNullable<CreatorExecutorError['publicFacts']>['kind'],
    httpStatus?: number
  ) => new CreatorExecutorError(code, message, {}, {
    kind,
    provider: 'yt-dlp',
    ...(httpStatus === undefined ? {} : { httpStatus })
  });
  if (/proxyerror|proxy connection|proxy (?:server )?(?:timed out|refused|unreachable|failed)/.test(text)) {
    const reason = /timed out|timeout/.test(text) ? 'timed out' : /refused/.test(text) ? 'was refused' : 'failed';
    return failure('network_unavailable', `yt-dlp proxy connection ${reason}. Check the proxy address and whether the proxy service is running.`,
      reason === 'timed out' ? 'timeout' : reason === 'was refused' ? 'connection-refused' : 'unavailable');
  }
  if (/temporary failure in name resolution|name or service not known|no address associated|nodename nor servname|dns error|failed to resolve/.test(text)) {
    return failure('network_unavailable', 'yt-dlp could not resolve the video platform host. Check DNS, network, and proxy settings.', 'dns');
  }
  if (
    text.includes('connection timed out')
    || text.includes('connect timeout')
    || text.includes('timed out')
  ) {
    return failure('network_unavailable', 'yt-dlp connection to the video platform timed out. Check the network or proxy settings.', 'timeout');
  }
  if (
    text.includes('network is unreachable')
    || text.includes('unable to connect')
    || text.includes('connection refused')
    || text.includes('connection reset')
  ) {
    const kind = text.includes('refused') ? 'connection-refused'
      : text.includes('reset') ? 'connection-reset' : 'unavailable';
    const reason = kind === 'connection-refused' ? 'the connection was refused'
      : kind === 'connection-reset' ? 'the connection was reset' : 'the network is unavailable';
    return failure('network_unavailable', `yt-dlp could not connect to the video platform: ${reason}. Check the network or proxy settings.`, kind);
  }
  const httpStatus = /http error\s+(\d{3})\b/i.exec(stderr);
  if (httpStatus !== null) {
    const status = Number(httpStatus[1]);
    const kind = status === 429 ? 'rate-limited'
      : status === 401 || status === 403 ? 'unauthorized'
        : status >= 500 ? 'unavailable' : 'http-rejected';
    return failure('download_http_error', `The video platform returned HTTP ${status} to yt-dlp.`, kind, status);
  }
  if (
    text.includes('requested format is not available')
    || text.includes('no video formats found')
  ) {
    return failure('format_unavailable', 'yt-dlp could not find the requested video or audio format.', 'not-found');
  }
  if (
    text.includes('sign in')
    || text.includes('login')
    || text.includes('cookies')
  ) {
    return failure('login_required', 'yt-dlp reports that platform login or fresh cookies are required.', 'unauthorized');
  }
  if (
    text.includes('copyright')
    || text.includes('not available in your country')
    || text.includes('geo-restricted')
  ) {
    return failure('region_or_copyright_restricted', 'yt-dlp reports that the video is region or copyright restricted.', 'unauthorized');
  }
  if (
    text.includes('please update')
    || text.includes('confirm you are on the latest version')
    || text.includes('signature extraction failed')
    || text.includes('nsig extraction failed')
    || text.includes('unable to extract')
    || text.includes('extractor error')
  ) {
    return failure('yt_dlp_update_recommended', 'yt-dlp could not extract this video; its platform extractor may be outdated.', 'unsupported');
  }
  if (text.includes('no space left')) {
    return failure('disk_full', 'yt-dlp could not save the video because disk space is exhausted.', 'storage');
  }
  const detail = publicYtDlpErrorLine(stderr);
  return failure(
    'download_failed',
    detail === undefined
      ? `yt-dlp exited with code ${exitCode ?? 'unknown'} without a usable error detail.`
      : `yt-dlp exited with code ${exitCode ?? 'unknown'}: ${detail}`,
    'unknown'
  );
}

function publicYtDlpErrorLine(stderr: string): string | undefined {
  const line = stderr.split(/\r?\n/).reverse()
    .find(candidate => /^\s*ERROR:/i.test(candidate));
  if (line === undefined) return undefined;
  const redacted = line
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/(?:https?|ftp):\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[local path]')
    .replace(/\b(?:cookie|token|authorization|password)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/\b[A-Za-z0-9_=-]{32,}\b/g, '[redacted]');
  return sanitizeIssueDetail(redacted, 300);
}

function currentYtDlpRuntime(input: DownloadExecutorOptions): YtDlpRuntime {
  return input.getYtDlpRuntime?.() ?? {
    version: 'configured',
    executable: input.ytDlpPath,
    prefixArgs: input.ytDlpPrefixArgs ?? [],
    env: input.ytDlpEnv ?? {}
  };
}

function readSourceUrl(stage: CreatorExecutorInput): string {
  const sourceUrl = stage.stageRun.stageId === 'download'
    && typeof stage.stageRun.progress.sourceUrl === 'string'
    ? stage.stageRun.progress.sourceUrl
    : stage.job.state.sourceUrl;
  return typeof sourceUrl === 'string' ? extractDouyinShareUrl(sourceUrl) : '';
}

function normalizeSourceUrl(value: string): string {
  const trimmed = extractDouyinShareUrl(value);
  try {
    const parsed = new URL(trimmed);
    if (isDouyinFeaturedVideoUrl(parsed)) {
      return `https://www.douyin.com/video/${parsed.searchParams.get('modal_id')}`;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function mimeTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolveHash(hash.digest('hex')));
  });
}

function isSupported(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && (
        host === 'youtu.be'
        || host === 'youtube.com'
        || host.endsWith('.youtube.com')
        || host === 'b23.tv'
        || host === 'bilibili.com'
        || host.endsWith('.bilibili.com')
        || host === 'x.com'
        || host.endsWith('.x.com')
        || host === 'twitter.com'
        || host.endsWith('.twitter.com')
        || isTikTokVideoUrl(parsed)
        || isInstagramVideoUrl(parsed)
        || isDouyinVideoUrl(parsed)
        || isFacebookVideoUrl(parsed)
        || isXiaohongshuVideoUrl(parsed)
        || isPinterestVideoUrl(parsed)
      );
  } catch {
    return false;
  }
}

function isTikTokVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') {
    return /^\/[\w-]+\/?$/.test(url.pathname);
  }
  return (host === 'tiktok.com' || host.endsWith('.tiktok.com'))
    && /^\/@[^/]+\/video\/\d+\/?$/.test(url.pathname);
}

function isInstagramVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (host === 'instagram.com' || host === 'www.instagram.com')
    && /^\/(?:reel|p|tv)\/[\w-]+\/?$/.test(url.pathname);
}

function isDouyinVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'v.douyin.com') {
    return /^\/[\w-]+\/?$/.test(url.pathname);
  }
  return (host === 'douyin.com' || host === 'www.douyin.com')
    && (/^\/video\/\d+\/?$/.test(url.pathname) || isDouyinFeaturedVideoUrl(url));
}

function isDouyinFeaturedVideoUrl(url: URL): boolean {
  return (url.hostname === 'douyin.com' || url.hostname === 'www.douyin.com')
    && url.pathname === '/jingxuan'
    && /^\d+$/.test(url.searchParams.get('modal_id') ?? '');
}

function isFacebookVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'fb.watch') {
    return /^\/[\w-]+\/?$/.test(url.pathname);
  }
  if (!['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(host)) {
    return false;
  }
  return /^\/watch\/?$/.test(url.pathname)
    ? /^\d+$/.test(url.searchParams.get('v') ?? '')
    : /^\/(?:reel\/\d+|videos\/\d+|[^/]+\/videos\/\d+)\/?$/.test(url.pathname);
}

function isXiaohongshuVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (host === 'xiaohongshu.com' || host === 'www.xiaohongshu.com')
    && /^\/explore\/[0-9a-f]{24}\/?$/i.test(url.pathname);
}

function isPinterestVideoUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (host === 'pinterest.com' || host === 'www.pinterest.com')
    && /^\/pin\/\d+\/?$/.test(url.pathname);
}

function isYoutube(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && (
        host === 'youtu.be'
        || host === 'youtube.com'
        || host.endsWith('.youtube.com')
      );
  } catch {
    return false;
  }
}
