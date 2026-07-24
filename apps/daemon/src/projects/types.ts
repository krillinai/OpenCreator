import type {
  CreateProjectRequest,
  MigrateLocalStorageProjectsV1Request,
  MigrateLocalStorageProjectsV1Response,
  ProjectResponse,
  ProjectStatus,
  ReplaceProjectDirectoryRequest,
  UpdateProjectRequest
} from '@clawee/protocol';

export type ProjectManagerErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_DIRECTORY_CONFLICT'
  | 'PROJECT_DIRECTORY_UNAVAILABLE';

export class ProjectManagerError extends Error {
  constructor(
    readonly code: ProjectManagerErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type CreateMigratedProjectInput = CreateProjectRequest & {
  preferredId?: string;
};

export type ProjectManager = {
  createProject(input: CreateProjectRequest): ProjectResponse;
  createMigratedProject(input: CreateMigratedProjectInput): ProjectResponse;
  migrateLocalStorageV1(
    input: MigrateLocalStorageProjectsV1Request
  ): MigrateLocalStorageProjectsV1Response;
  getProject(id: string): ProjectResponse | undefined;
  listProjects(status?: ProjectStatus | 'all'): ProjectResponse[];
  updateProject(id: string, input: UpdateProjectRequest): ProjectResponse;
  archiveProject(id: string): ProjectResponse;
  restoreProject(id: string): ProjectResponse;
  replaceProjectDirectory(
    id: string,
    input: ReplaceProjectDirectoryRequest
  ): ProjectResponse;
};
