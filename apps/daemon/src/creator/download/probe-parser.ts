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
  acodec: z.string().nullish(),
  language: z.string().nullish(),
  language_preference: z.number().nullish()
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
  language: z.string().nullish(),
  formats: z.array(formatSchema).default([])
}).passthrough();

export function parseDownloadProbe(
  value: unknown,
  requestedUrl = ''
): DownloadProbe {
  if (
    typeof value === 'object'
    && value !== null
    && '_type' in value
    && value._type === 'playlist'
  ) {
    const playlist = z.object({
      id: z.string(),
      title: z.string(),
      extractor_key: z.string(),
      entries: z.array(z.unknown()).min(1).max(16)
    }).parse(value);
    if (!/^(twitter|x)(?::|$)/i.test(playlist.extractor_key)) {
      throw new Error('Unsupported multi-video source');
    }
    const entries = playlist.entries.map((entry, index) => ({
      index: index + 1,
      probe: parseSingleDownloadProbe(entry, requestedUrl)
    }));
    const first = entries[0]!.probe;
    return {
      ...first,
      id: playlist.id,
      title: playlist.title,
      duration: null,
      options: entries.flatMap(({ index, probe }) => probe.options.map(option => ({
        ...option,
        id: `item-${index}-${option.id}`,
        playlistIndex: index
      })))
    };
  }
  return parseSingleDownloadProbe(value, requestedUrl);
}

function parseSingleDownloadProbe(value: unknown, requestedUrl: string): DownloadProbe {
  const parsed = probeSchema.parse(value);
  const extractor = parsed.extractor_key ?? '';
  const platform = /^https:\/\/(?:v|www)\.douyin\.com\//i.test(requestedUrl)
    || /^douyin(?::|$)/i.test(extractor) ? 'douyin'
    : /bilibili/i.test(extractor) ? 'bilibili'
    : /^(twitter|x)(?::|$)/i.test(extractor) ? 'x'
      : /^tiktok(?::|$|VM)/i.test(extractor) ? 'tiktok'
        : /^instagram(?::|$)/i.test(extractor) ? 'instagram'
          : /^facebook(?::|$)/i.test(extractor) ? 'facebook'
            : /^xiaohongshu(?::|$)/i.test(extractor) ? 'xiaohongshu'
              : /^pinterest(?::|$)/i.test(extractor) ? 'pinterest' : 'youtube';
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
    language: normalizeLanguage(format.language ?? parsed.language),
    languagePreference: format.language_preference ?? null,
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
  const audioOnly = formats.filter(format => format.hasAudio && !format.hasVideo);
  const audioSources = bestAudioFormatsByLanguage(
    audioOnly.length > 0
      ? audioOnly
      : formats.filter(format => format.hasAudio)
  );
  const videosByHeight = new Map<string, DownloadProbeFormat>();
  for (const format of formats.filter(candidate => candidate.hasVideo)) {
    const key = `${format.width ?? 0}x${format.height ?? 0}`;
    const current = videosByHeight.get(key);
    const preferSeparateAudio = audioSources.length > 1
      && current !== undefined
      && current.hasAudio !== format.hasAudio;
    if (
      current === undefined
      || (preferSeparateAudio
        ? !format.hasAudio
        : compareVideoFormats(format, current) < 0)
    ) {
      videosByHeight.set(key, format);
    }
  }
  const videoOptions = [...videosByHeight.values()]
    .sort(compareVideoFormats)
    .flatMap((video, index): DownloadOption[] => {
      const selectedAudioSources = video.hasAudio
        ? [undefined]
        : audioSources.length > 0
          ? audioSources
          : [undefined];
      return selectedAudioSources.map(audio => {
        const estimatedBytes = estimatedVideoBytes(video, audio, duration);
        const audioLanguage = video.hasAudio
          ? video.language ?? 'und'
          : audio === undefined
            ? undefined
            : audio.language ?? 'und';
        const baseId = `video-${video.height ?? 'source'}-${index + 1}`;
        return {
          id: audioSources.length > 1 && audio !== undefined
            ? `${baseId}-${encodeURIComponent(audio.id)}`
            : baseId,
          mediaType: 'video',
          container: 'mp4',
          ...(audioLanguage === undefined ? {} : { audioLanguage }),
          ...(video.width === null ? {} : { width: video.width }),
          ...(video.height === null ? {} : { height: video.height }),
          ...(video.fps === null ? {} : { fps: video.fps }),
          ...(video.bitrateKbps === null ? {} : { bitrateKbps: video.bitrateKbps }),
          ...(estimatedBytes === undefined ? {} : { estimatedBytes }),
          videoFormatId: video.id,
          ...(video.hasAudio || audio === undefined
            ? {}
            : { audioFormatId: audio.id })
        };
      });
    });
  const audioOptions = [320, 192, 128].flatMap(bitrateKbps => (
    audioSources.map((audio): DownloadOption => ({
      id: audioSources.length > 1
        ? `audio-mp3-${bitrateKbps}-${encodeURIComponent(audio.id)}`
        : `audio-mp3-${bitrateKbps}`,
      mediaType: 'audio',
      container: 'mp3',
      audioLanguage: audio.language ?? 'und',
      bitrateKbps,
      ...(duration === null
        ? {}
        : { estimatedBytes: Math.round(duration * bitrateKbps * 1_000 / 8) }),
      audioFormatId: audio.id,
      transcode: 'mp3'
    }))
  ));
  return [...videoOptions, ...audioOptions];
}

function bestAudioFormatsByLanguage(
  formats: DownloadProbeFormat[]
): DownloadProbeFormat[] {
  const byLanguage = new Map<string, DownloadProbeFormat>();
  for (const format of formats) {
    const key = format.language?.toLocaleLowerCase() ?? 'und';
    const current = byLanguage.get(key);
    if (current === undefined || compareAudioFormats(format, current) < 0) {
      byLanguage.set(key, format);
    }
  }
  return [...byLanguage.values()].sort(compareAudioFormats);
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
    languagePreferenceScore(right) - languagePreferenceScore(left)
    || Number(right.ext === 'm4a' || right.ext === 'mp4')
      - Number(left.ext === 'm4a' || left.ext === 'mp4')
    || (right.bitrateKbps ?? 0) - (left.bitrateKbps ?? 0)
    || (right.bytes ?? 0) - (left.bytes ?? 0)
  );
}

function languagePreferenceScore(format: DownloadProbeFormat): number {
  return format.languagePreference ?? -1_000_000;
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

function normalizeLanguage(value: string | null | undefined): string | null {
  const normalized = value?.trim().replaceAll('_', '-') ?? '';
  if (!normalized) return null;
  try {
    return Intl.getCanonicalLocales(normalized)[0] ?? normalized;
  } catch {
    return normalized;
  }
}

function isH264Codec(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized === 'h264'
    || normalized.startsWith('avc1')
    || normalized.startsWith('avc3');
}
