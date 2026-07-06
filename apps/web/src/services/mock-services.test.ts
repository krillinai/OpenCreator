import { describe, expect, it } from 'vitest';
import { createMockFileService } from './file-service.js';
import { createMockProjectService } from './project-service.js';

describe('mock services', () => {
  it('loads default project and file tree', async () => {
    const service = createMockProjectService();
    await expect(service.listProjects()).resolves.toEqual([
      expect.objectContaining({ id: 'default-project', source: 'mock' })
    ]);
  });

  it('opens edits and saves a mock file', async () => {
    const service = createMockFileService();
    const file = await service.openFile('docs/design/enterprise-agent-workbench.md');
    expect(file.dirty).toBe(false);

    await service.saveFile(file.path, `${file.content}\nupdated`);
    const saved = await service.openFile(file.path);
    expect(saved.content).toContain('updated');
    expect(saved.dirty).toBe(false);
  });
});
