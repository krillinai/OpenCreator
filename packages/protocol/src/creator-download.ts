export type DownloadPlatform = 'youtube' | 'bilibili' | 'x' | 'tiktok' | 'instagram' | 'douyin' | 'facebook' | 'xiaohongshu' | 'pinterest';

export function extractDouyinShareUrl(value: string): string {
  const trimmed = value.trim();
  if (/^https:\/\/\S+$/.test(trimmed)) return trimmed;
  const links = [...new Set(trimmed.match(/https:\/\/v\.douyin\.com\/[\w-]+\/?(?=$|[\s)\]），。！!])/g) ?? [])];
  return links.length === 1 ? links[0]! : trimmed;
}

export type DownloadMediaType = 'video' | 'audio';

export type DownloadContainer = 'mp4' | 'mp3' | 'm4a' | 'webm';

export type DownloadOption = {
  id: string;
  mediaType: DownloadMediaType;
  container: DownloadContainer;
  audioLanguage?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  estimatedBytes?: number;
  videoFormatId?: string;
  audioFormatId?: string;
  transcode?: 'mp3';
  playlistIndex?: number;
};

export type DownloadProbeFormat = {
  id: string;
  ext: string | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  bytes: number | null;
  language?: string | null;
  languagePreference?: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type DownloadProbe = {
  id: string;
  title: string;
  requestedUrl: string;
  url: string;
  platform: DownloadPlatform;
  uploader: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  formats: DownloadProbeFormat[];
  options: DownloadOption[];
};
