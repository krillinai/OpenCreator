export type DownloadPlatform = 'youtube' | 'bilibili';

export type DownloadMediaType = 'video' | 'audio';

export type DownloadContainer = 'mp4' | 'mp3' | 'm4a' | 'webm';

export type DownloadOption = {
  id: string;
  mediaType: DownloadMediaType;
  container: DownloadContainer;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  estimatedBytes?: number;
  videoFormatId?: string;
  audioFormatId?: string;
  transcode?: 'mp3';
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
