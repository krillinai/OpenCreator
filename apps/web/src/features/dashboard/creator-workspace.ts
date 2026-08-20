export type CreatorWorkspace =
  | 'video-translation'
  | 'video-download'
  | 'stickman-video'
  | 'auto-clips'
  | 'smart-dubbing'
  | 'digital-avatar'
  | 'cover-generator'
  | 'image-generation'
  | 'video-generation';

export type CreatorSkillLaunch = {
  skillId: string;
  workspace: CreatorWorkspace;
  promptHint: string;
};
