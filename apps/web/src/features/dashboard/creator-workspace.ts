import {
  creatorRuntimeWorkspaces as creatorPresetWorkspaces,
  type CreatorRuntimeWorkspace as CreatorPresetWorkspace
} from '@opencreator/protocol';

export { creatorPresetWorkspaces };
export type { CreatorPresetWorkspace };

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
  'image-generation',
  'video-generation'
] as const satisfies readonly CreatorWorkspace[];

const templateByWorkspace: Record<CreatorRuntimeWorkspace, string> = {
  'video-translation': 'video-translation',
  'video-download': 'video-download',
  'stickman-video': 'stickman-video',
  'auto-clips': 'auto-clip',
  'smart-dubbing': 'smart-dubbing',
  'cover-generator': 'cover',
  'image-generation': 'image-generation',
  'video-generation': 'video-generation'
};

const templateVersionByWorkspace: Record<CreatorRuntimeWorkspace, number> = {
  'video-translation': 2,
  'video-download': 2,
  'stickman-video': 1,
  'auto-clips': 1,
  'smart-dubbing': 1,
  'cover-generator': 2,
  'image-generation': 2,
  'video-generation': 1
};

export const creatorRuntimeWorkspaces = [
  ...creatorPresetWorkspaces,
  'stickman-video',
  'auto-clips'
] as const satisfies readonly CreatorWorkspace[];

export type CreatorRuntimeWorkspace = typeof creatorRuntimeWorkspaces[number];

export function isCreatorWorkspace(value: string): value is CreatorWorkspace {
  return creatorWorkspaces.includes(value as CreatorWorkspace);
}

export function isCreatorPresetWorkspace(
  value: string
): value is CreatorPresetWorkspace {
  return creatorPresetWorkspaces.includes(value as CreatorPresetWorkspace);
}

export function isVisibleCreatorWorkspace(workspace: CreatorWorkspace): boolean {
  return visibleCreatorWorkspaces.includes(
    workspace as typeof visibleCreatorWorkspaces[number]
  );
}

export function creatorTemplateForWorkspace(workspace: CreatorRuntimeWorkspace): string {
  return templateByWorkspace[workspace];
}

export function creatorTemplateVersionForWorkspace(
  workspace: CreatorRuntimeWorkspace
): number {
  return templateVersionByWorkspace[workspace];
}

export function creatorWorkspaceForTemplate(templateId: string): CreatorRuntimeWorkspace | undefined {
  return creatorRuntimeWorkspaces.find(workspace => templateByWorkspace[workspace] === templateId);
}

export type CreatorSkillLaunch = {
  skillId: string;
  workspace: CreatorWorkspace;
  promptHint: string;
};
