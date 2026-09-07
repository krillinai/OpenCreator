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

export const creatorWorkspaces = [
  'video-translation',
  'video-download',
  'stickman-video',
  'auto-clips',
  'smart-dubbing',
  'digital-avatar',
  'cover-generator',
  'image-generation',
  'video-generation'
] as const satisfies readonly CreatorWorkspace[];

export const visibleCreatorWorkspaces = [
  'video-translation',
  'video-download',
  'smart-dubbing',
  'cover-generator',
  'image-generation'
] as const satisfies readonly CreatorWorkspace[];

export const creatorRuntimeWorkspaces = [
  'video-translation',
  'video-download',
  'stickman-video',
  'auto-clips',
  'smart-dubbing',
  'cover-generator',
  'image-generation'
] as const satisfies readonly CreatorWorkspace[];

export type CreatorRuntimeWorkspace = typeof creatorRuntimeWorkspaces[number];

const templateByWorkspace: Record<CreatorRuntimeWorkspace, string> = {
  'video-translation': 'video-translation',
  'video-download': 'video-download',
  'stickman-video': 'stickman-video',
  'auto-clips': 'auto-clip',
  'smart-dubbing': 'smart-dubbing',
  'cover-generator': 'cover',
  'image-generation': 'image-generation'
};

export function isCreatorWorkspace(value: string): value is CreatorWorkspace {
  return creatorWorkspaces.includes(value as CreatorWorkspace);
}

export function isVisibleCreatorWorkspace(workspace: CreatorWorkspace): boolean {
  return visibleCreatorWorkspaces.includes(
    workspace as typeof visibleCreatorWorkspaces[number]
  );
}

export function creatorTemplateForWorkspace(workspace: CreatorRuntimeWorkspace): string {
  return templateByWorkspace[workspace];
}

export function creatorWorkspaceForTemplate(templateId: string): CreatorRuntimeWorkspace | undefined {
  return creatorRuntimeWorkspaces.find(workspace => templateByWorkspace[workspace] === templateId);
}

export type CreatorSkillLaunch = {
  skillId: string;
  workspace: CreatorWorkspace;
  promptHint: string;
};
