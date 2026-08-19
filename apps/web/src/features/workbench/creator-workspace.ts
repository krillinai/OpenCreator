export type CreatorWorkspace =
  | 'video-translation'
  | 'video-download'
  | 'stickman-video'
  | 'auto-clips'
  | 'cover-generator';

export type CreatorSkillLaunch = {
  skillId: string;
  workspace: CreatorWorkspace;
  promptHint: string;
};
