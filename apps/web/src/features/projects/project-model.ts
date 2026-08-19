import type {
  LegacyLocalStorageProjectV1,
  ProjectResponse,
  ThreadResponse
} from '@opencreator/protocol';

export type ProjectPermission =
  | 'follow-global'
  | 'workspace-write'
  | 'danger-full-access';

export type OpenCreatorProject = Pick<
  ProjectResponse,
  'id' | 'name' | 'cwd' | 'sandbox' | 'profile' | 'model' | 'reasoning'
> & Partial<Pick<
  ProjectResponse,
  | 'canonicalCwd'
  | 'directoryState'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'archivedAt'
>>;

export type OpenCreatorConversation = {
  id: string;
  projectId: string;
  title: string;
  updatedAt?: string;
  updatedLabel: string;
  pinnedAt?: string | null;
};

export function sortProjectConversations<T extends OpenCreatorConversation>(
  conversations: readonly T[]
): T[] {
  return [...conversations].sort((left, right) => {
    const pinOrder = Number(right.pinnedAt != null) - Number(left.pinnedAt != null);
    if (pinOrder !== 0) return pinOrder;
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
}

export const PROJECTS_STORAGE_KEY = 'opencreator.projects.v1';

export function findProjectById(
  projects: OpenCreatorProject[],
  projectId: string | undefined
): OpenCreatorProject | undefined {
  if (projectId === undefined) return undefined;
  return projects.find(project => project.id === projectId);
}

export function parseLegacyLocalStorageProjects(
  value: unknown
): LegacyLocalStorageProjectV1[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isLegacyProject).map(project => ({ ...project }));
}

export function groupThreadsByPurpose(threads: ThreadResponse[]): {
  conversationThreads: ThreadResponse[];
  scheduleDraftThreads: ThreadResponse[];
  scheduleTaskThreads: ThreadResponse[];
} {
  const conversationThreads: ThreadResponse[] = [];
  const scheduleDraftThreads: ThreadResponse[] = [];
  const scheduleTaskThreads: ThreadResponse[] = [];

  for (const thread of threads) {
    if (thread.purpose === 'schedule_task') scheduleTaskThreads.push(thread);
    else if (thread.purpose === 'schedule_draft') scheduleDraftThreads.push(thread);
    else conversationThreads.push(thread);
  }

  return { conversationThreads, scheduleDraftThreads, scheduleTaskThreads };
}

function isLegacyProject(value: unknown): value is LegacyLocalStorageProjectV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const project = value as Record<string, unknown>;
  return typeof project.id === 'string'
    && project.id.trim().length > 0
    && typeof project.name === 'string'
    && project.name.trim().length > 0
    && typeof project.cwd === 'string'
    && project.cwd.trim().length > 0
    && (
      project.sandbox === 'follow-global'
      || project.sandbox === 'read-only'
      || project.sandbox === 'workspace-write'
      || project.sandbox === 'danger-full-access'
    )
    && typeof project.profile === 'string'
    && project.profile.trim().length > 0
    && (project.model === null || typeof project.model === 'string')
    && (
      project.reasoning === null
      || project.reasoning === 'default'
      || project.reasoning === 'low'
      || project.reasoning === 'medium'
      || project.reasoning === 'high'
      || project.reasoning === 'xhigh'
    );
}
