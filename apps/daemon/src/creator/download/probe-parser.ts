import { z } from 'zod';

const formatSchema = z.object({
  format_id: z.string(),
  ext: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  filesize: z.number().optional(),
  filesize_approx: z.number().optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional()
}).passthrough();

const probeSchema = z.object({
  id: z.string(),
  title: z.string(),
  webpage_url: z.string().optional(),
  extractor_key: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  formats: z.array(formatSchema).default([])
}).passthrough();

export type DownloadProbe = {
  id: string;
  title: string;
  url: string;
  platform: 'youtube' | 'bilibili';
  duration: number | null;
  formats: Array<{
    id: string;
    ext: string | null;
    width: number | null;
    height: number | null;
    bytes: number | null;
    hasVideo: boolean;
    hasAudio: boolean;
  }>;
};

export function parseDownloadProbe(value: unknown): DownloadProbe {
  const parsed = probeSchema.parse(value);
  const platform = /bilibili/i.test(parsed.extractor_key ?? parsed.webpage_url ?? '') ? 'bilibili' : 'youtube';
  return {
    id: parsed.id,
    title: parsed.title,
    url: parsed.webpage_url ?? '',
    platform,
    duration: parsed.duration ?? null,
    formats: parsed.formats.map(format => ({
      id: format.format_id,
      ext: format.ext ?? null,
      width: format.width ?? null,
      height: format.height ?? null,
      bytes: format.filesize ?? format.filesize_approx ?? null,
      hasVideo: format.vcodec !== undefined && format.vcodec !== 'none',
      hasAudio: format.acodec !== undefined && format.acodec !== 'none'
    }))
  };
}
