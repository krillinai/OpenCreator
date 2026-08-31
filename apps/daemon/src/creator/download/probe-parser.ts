import type {
  DownloadOption,
  DownloadProbe,
  DownloadProbeFormat
} from '@opencreator/protocol';
import { z } from 'zod';

const formatSchema = z.object({
  format_id: z.string(),
  ext: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  fps: z.number().nullish(),
  tbr: z.number().nullish(),
  abr: z.number().nullish(),
  filesize: z.number().nullish(),
  filesize_approx: z.number().nullish(),
  vcodec: z.string().nullish(),
  acodec: z.string().nullish()
}).passthrough();

const probeSchema = z.object({
  id: z.string(),
  title: z.string(),
  webpage_url: z.string().nullish(),
  extractor_key: z.string().nullish(),
  uploader: z.string().nullish(),
  channel: z.string().nullish(),
  thumbnail: z.string().url().nullish(),
  duration: z.number().nonnegative().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  formats: z.array(formatSchema).default([])
}).passthrough();

export function parseDownloadProbe(
  value: unknown,
  requestedUrl = ''
): DownloadProbe {
  const parsed = probeSchema.parse(value);
  const platform = /bilibili/i.test(parsed.extractor_key ?? parsed.webpage_url ?? '') ? 'bilibili' : 'youtube';
  const formats: DownloadProbeFormat[] = parsed.formats.map(format => ({
    id: format.format_id,
    ext: format.ext ?? null,
    videoCodec: format.vcodec ?? null,
    audioCodec: format.acodec ?? null,
    width: format.width ?? null,
    height: format.height ?? null,
    fps: format.fps ?? null,
    bitrateKbps: format.tbr ?? format.abr ?? null,
    bytes: format.filesize ?? format.filesize_approx ?? null,
    hasVideo: hasCodec(format.vcodec),
    hasAudio: hasCodec(format.acodec)
  }));
  return {
    id: parsed.id,
    title: parsed.title,
    requestedUrl: requestedUrl.trim() || (parsed.webpage_url ?? ''),
    url: parsed.webpage_url ?? '',
    platform,
    uploader: parsed.uploader ?? parsed.channel ?? null,
    thumbnailUrl: parsed.thumbnail ?? null,
    duration: parsed.duration ?? null,
    width: parsed.width ?? largestDimension(formats, 'width'),
    height: parsed.height ?? largestDimension(formats, 'height'),
    formats,
    options: createDownloadOptions(formats, parsed.duration ?? null)
  };
}

function createDownloadOptions(
  formats: DownloadProbeFormat[],
  duration: number | null
): DownloadOption[] {
  const audioOnly = formats
    .filter(format => format.hasAudio && !format.hasVideo)
    .sort(compareAudioFormats)[0];
  const audioSource = audioOnly ?? formats
    .filter(format => format.hasAudio)
    .sort(compareAudioFormats)[0];
  const videosByHeight = new Map<string, DownloadProbeFormat>();
  for (const format of formats.filter(candidate => candidate.hasVideo)) {
    const key = `${format.width ?? 0}x${format.height ?? 0}`;
    const current = videosByHeight.get(key);
    if (current === undefined || compareVideoFormats(format, current) < 0) {
      videosByHeight.set(key, format);
    }
  }
  const videoOptions = [...videosByHeight.values()]
    .sort(compareVideoFormats)
    .map((video, index): DownloadOption => {
      const estimatedBytes = estimatedVideoBytes(
        video,
        video.hasAudio ? undefined : audioOnly,
        duration
      );
      return {
        id: `video-${video.height ?? 'source'}-${index + 1}`,
        mediaType: 'video',
        container: 'mp4',
        ...(video.width === null ? {} : { width: video.width }),
        ...(video.height === null ? {} : { height: video.height }),
        ...(video.fps === null ? {} : { fps: video.fps }),
        ...(video.bitrateKbps === null ? {} : { bitrateKbps: video.bitrateKbps }),
        ...(estimatedBytes === undefined ? {} : { estimatedBytes }),
        videoFormatId: video.id,
        ...(video.hasAudio || audioOnly === undefined
          ? {}
          : { audioFormatId: audioOnly.id })
      };
    });
  const audioOptions = audioSource === undefined
    ? []
    : [320, 192, 128].map((bitrateKbps): DownloadOption => ({
        id: `audio-mp3-${bitrateKbps}`,
        mediaType: 'audio',
        container: 'mp3',
        bitrateKbps,
        ...(duration === null
          ? {}
          : { estimatedBytes: Math.round(duration * bitrateKbps * 1_000 / 8) }),
        audioFormatId: audioSource.id,
        transcode: 'mp3'
      }));
  return [...videoOptions, ...audioOptions];
}

function compareVideoFormats(
  left: DownloadProbeFormat,
  right: DownloadProbeFormat
): number {
  return (
    (right.height ?? 0) - (left.height ?? 0)
    || (right.width ?? 0) - (left.width ?? 0)
    || Number(isH264Codec(right.videoCodec)) - Number(isH264Codec(left.videoCodec))
    || Number(right.ext === 'mp4') - Number(left.ext === 'mp4')
    || Number(right.hasAudio) - Number(left.hasAudio)
    || (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0)
    || (right.bytes ?? 0) - (left.bytes ?? 0)
  );
}

function compareAudioFormats(
  left: DownloadProbeFormat,
  right: DownloadProbeFormat
): number {
  return (
    Number(right.ext === 'm4a' || right.ext === 'mp4')
      - Number(left.ext === 'm4a' || left.ext === 'mp4')
    || (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0)
    || (right.bytes ?? 0) - (left.bytes ?? 0)
  );
}

function estimatedVideoBytes(
  video: DownloadProbeFormat,
  audio: DownloadProbeFormat | undefined,
  duration: number | null
): number | undefined {
  const videoBytes = estimatedFormatBytes(video, duration);
  if (videoBytes === undefined) return undefined;
  return videoBytes + (estimatedFormatBytes(audio, duration) ?? 0);
}

function estimatedFormatBytes(
  format: DownloadProbeFormat | undefined,
  duration: number | null
): number | undefined {
  if (format === undefined) return undefined;
  if (format.bytes !== null) return format.bytes;
  if (
    duration === null
    || format.bitrateKbps === null
    || duration <= 0
    || format.bitrateKbps <= 0
  ) {
    return undefined;
  }
  return Math.round(duration * format.bitrateKbps * 1_000 / 8);
}

function largestDimension(
  formats: DownloadProbeFormat[],
  key: 'width' | 'height'
): number | null {
  const values = formats
    .map(format => format[key])
    .filter((value): value is number => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function hasCodec(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== 'none';
}

function isH264Codec(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized === 'h264'
    || normalized.startsWith('avc1')
    || normalized.startsWith('avc3');
}
