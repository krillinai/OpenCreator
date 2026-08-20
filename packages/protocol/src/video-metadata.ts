export type VideoMetadataPlatform = 'youtube' | 'bilibili';

export type VideoMetadataResponse = {
  platform: VideoMetadataPlatform;
  title: string;
  authorName?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
};
