import type {
  AssignThreadProjectRequest,
  CreateManagedProjectRequest,
  CreateProjectRequest,
  MigrateLocalStorageProjectsV1Request,
  MigrateLocalStorageProjectsV1Response,
  ProjectListResponse,
  ProjectResponse,
  ProjectStatus,
  ReplaceProjectDirectoryRequest,
  ThreadListResponse,
  ThreadResponse,
  UpdateProjectRequest
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createProjectService(client: RuntimeClient) {
  return {
    listProjects(status: ProjectStatus | 'all' = 'active'): Promise<ProjectListResponse> {
      return client.get(`/projects?status=${status}`);
    },
    ensureDefaultProject(): Promise<{ project: ProjectResponse }> {
      return client.post('/projects/default');
    },
    createProject(input: CreateProjectRequest): Promise<{ project: ProjectResponse }> {
      return client.post('/projects', input);
    },
    createManagedProject(
      input: CreateManagedProjectRequest
    ): Promise<{ project: ProjectResponse }> {
      return client.post('/projects/managed', input);
    },
    updateProject(
      projectId: string,
      input: UpdateProjectRequest
    ): Promise<{ project: ProjectResponse }> {
      return client.patch(`/projects/${encodeURIComponent(projectId)}`, input);
    },
    archiveProject(projectId: string): Promise<{ project: ProjectResponse }> {
      return client.post(`/projects/${encodeURIComponent(projectId)}/archive`);
    },
    restoreProject(projectId: string): Promise<{ project: ProjectResponse }> {
      return client.post(`/projects/${encodeURIComponent(projectId)}/restore`);
    },
    replaceProjectDirectory(
      projectId: string,
      input: ReplaceProjectDirectoryRequest
    ): Promise<{ project: ProjectResponse }> {
      return client.post(
        `/projects/${encodeURIComponent(projectId)}/replace-directory`,
        input
      );
    },
    migrateLocalStorageV1(
      input: MigrateLocalStorageProjectsV1Request
    ): Promise<MigrateLocalStorageProjectsV1Response> {
      return client.post('/projects/migrations/local-storage-v1', input);
    },
    listUnassignedThreads(): Promise<ThreadListResponse> {
      return client.get(
        '/threads?status=all&purpose=conversation&assignment=unassigned&limit=100'
      );
    },
    assignThreadProject(
      threadId: string,
      input: AssignThreadProjectRequest
    ): Promise<{ thread: ThreadResponse }> {
      return client.post(
        `/threads/${encodeURIComponent(threadId)}/assign-project`,
        input
      );
    }
  };
}
