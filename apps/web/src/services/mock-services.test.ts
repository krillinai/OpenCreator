import { describe, expect, it } from 'vitest';
import { createMockApprovalService } from './approval-service.js';
import { createMockFileService } from './file-service.js';

function testDatabaseName(name: string) {
  return `clawee.web.test.mock-services.${name}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

describe('mock services', () => {
  it('opens edits and saves a mock file', async () => {
    const service = createMockFileService({ databaseName: testDatabaseName('seed-save') });
    const file = await service.openFile('docs/design/enterprise-agent-workbench.md');
    expect(file.dirty).toBe(false);

    await service.saveFile(file.path, `${file.content}\nupdated`);
    const saved = await service.openFile(file.path);
    expect(saved.content).toContain('updated');
    expect(saved.dirty).toBe(false);
  });

  it('keeps metadata accurate when saving an unknown file path', async () => {
    const service = createMockFileService({ databaseName: testDatabaseName('unknown-path') });
    const saved = await service.saveFile('foo/new.json', '{"ok":true}');

    expect(saved).toMatchObject({
      path: 'foo/new.json',
      name: 'new.json',
      language: 'json',
      content: '{"ok":true}',
      saved: true,
      dirty: false,
      source: 'mock'
    });

    await expect(service.openFile('foo/new.json')).resolves.toMatchObject({
      path: 'foo/new.json',
      name: 'new.json',
      language: 'json',
      content: '{"ok":true}'
    });
  });

  it('isolates saved drafts by mock file service database name', async () => {
    const path = 'docs/shared.md';
    const serviceA = createMockFileService({ databaseName: testDatabaseName('isolation-a') });
    const serviceB = createMockFileService({ databaseName: testDatabaseName('isolation-b') });

    await serviceA.saveFile(path, '# Draft A');
    await serviceB.saveFile(path, '# Draft B');

    await expect(serviceA.openFile(path)).resolves.toMatchObject({
      path,
      content: '# Draft A'
    });
    await expect(serviceB.openFile(path)).resolves.toMatchObject({
      path,
      content: '# Draft B'
    });
  });

  it('labels mock approvals as local drafts that do not write to disk', () => {
    const service = createMockApprovalService();
    const approval = service.createFileWriteApproval('foo/new.json');

    expect(approval.risk).toContain('不会写入真实磁盘');
  });
});
