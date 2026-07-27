import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createProjectService } from './project-service.js';

describe('ProjectService', () => {
  it('uses Runtime project, migration, and assignment endpoints', async () => {
    const get = vi.fn(async () => ({ projects: [] }));
    const post = vi.fn(async () => ({}));
    const patch = vi.fn(async () => ({}));
    const service = createProjectService({ get, post, patch } as unknown as RuntimeClient);

    await service.listProjects('all');
    await service.ensureDefaultProject();
    await service.createProject({ cwd: '/workspace/one' });
    await service.createManagedProject({ name: 'New project' });
    await service.updateProject('project/one', { name: 'One' });
    await service.archiveProject('project/one');
    await service.restoreProject('project/one');
    await service.replaceProjectDirectory('project/one', { cwd: '/workspace/two' });
    await service.migrateLocalStorageV1({ projects: [] });
    await service.listUnassignedThreads();
    await service.assignThreadProject('thread/one', { projectId: 'project-one' });

    expect(get).toHaveBeenCalledWith('/projects?status=all');
    expect(get).toHaveBeenCalledWith(
      '/threads?status=all&purpose=conversation&assignment=unassigned&limit=100'
    );
    expect(post).toHaveBeenCalledWith('/projects', { cwd: '/workspace/one' });
    expect(post).toHaveBeenCalledWith('/projects/default');
    expect(post).toHaveBeenCalledWith('/projects/managed', { name: 'New project' });
    expect(patch).toHaveBeenCalledWith('/projects/project%2Fone', { name: 'One' });
    expect(post).toHaveBeenCalledWith('/projects/project%2Fone/archive');
    expect(post).toHaveBeenCalledWith('/projects/project%2Fone/restore');
    expect(post).toHaveBeenCalledWith(
      '/projects/project%2Fone/replace-directory',
      { cwd: '/workspace/two' }
    );
    expect(post).toHaveBeenCalledWith('/projects/migrations/local-storage-v1', {
      projects: []
    });
    expect(post).toHaveBeenCalledWith(
      '/threads/thread%2Fone/assign-project',
      { projectId: 'project-one' }
    );
  });
});
