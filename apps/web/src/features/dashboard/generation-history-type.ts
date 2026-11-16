import type { CreatorWorkspace } from './creator-workspace.js';

export type GenerationHistoryType = 'all' | 'image' | 'video' | 'text' | 'audio';

const workspaceTypes: Record<CreatorWorkspace, Exclude<GenerationHistoryType, 'all'>> = {
  'video-translation': 'video',
  'video-download': 'video',
  'stickman-video': 'video',
  'auto-clips': 'video',
  'smart-dubbing': 'audio',
  transcription: 'text',
  'xiaohongshu-post': 'text',
  'short-video-script': 'text',
  'wechat-article': 'text',
  'digital-avatar': 'video',
  'cover-generator': 'image',
  'image-generation': 'image',
  'video-generation': 'video'
};

export function generationHistoryTypeForWorkspace(workspace?: CreatorWorkspace | null): GenerationHistoryType {
  return workspace === undefined || workspace === null ? 'all' : workspaceTypes[workspace];
}
