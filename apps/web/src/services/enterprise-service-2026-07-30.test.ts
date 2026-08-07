import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createEnterpriseService } from './enterprise-service-2026-07-30.js';

describe('enterprise service', () => {
  it('posts only account fields to exact enterprise runtime routes', async () => {
    const get = vi.fn(async (_path: string) => ({}));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const service = createEnterpriseService(createClient({ get, post }));

    await service.getSession();
    await service.refreshSession();
    await service.login({ email: 'member@example.com', password: 'secret' });
    await service.register({
      email: 'new@example.com',
      name: 'New Member',
      password: 'secret'
    });
    await service.logout();

    expect(get).toHaveBeenCalledWith('/enterprise/session');
    expect(post).toHaveBeenCalledWith('/enterprise/session/refresh');
    expect(post).toHaveBeenCalledWith('/enterprise/login', {
      email: 'member@example.com',
      password: 'secret'
    });
    expect(post).toHaveBeenCalledWith('/enterprise/register', {
      email: 'new@example.com',
      name: 'New Member',
      password: 'secret'
    });
    expect(post).toHaveBeenCalledWith('/enterprise/logout');
  });

  it('uses exact encoded skill routes without version or digest bodies', async () => {
    const get = vi.fn(async (_path: string) => ({}));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const service = createEnterpriseService(createClient({ get, post }));

    await service.listSkills();
    await service.getSkillDetail('folder/中文 skill');
    await service.installSkill('folder/中文 skill');
    await service.updateSkill('folder/中文 skill');

    const encoded = 'folder%2F%E4%B8%AD%E6%96%87%20skill';
    expect(get).toHaveBeenCalledWith('/enterprise/skills');
    expect(get).toHaveBeenCalledWith(`/enterprise/skills/${encoded}`);
    expect(post).toHaveBeenCalledWith(`/enterprise/skills/${encoded}/install`);
    expect(post).toHaveBeenCalledWith(`/enterprise/skills/${encoded}/update`);
  });

  it('uses exact knowledge routes and streams document files as binary', async () => {
    const get = vi.fn(async (_path: string) => ({}));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const postBinary = vi.fn(async (
      _path: string,
      _body: BodyInit,
      _contentType?: string
    ) => ({}));
    const service = createEnterpriseService(
      createClient({ get, post, postBinary })
    );
    const file = new File(['policy'], '制度 2026.pdf', {
      type: 'application/pdf'
    });

    await service.listKnowledgeBases();
    await service.listKnowledgeDocuments('kb/公司制度');
    await service.uploadKnowledgeDocument({
      knowledgeBaseId: 'kb/公司制度',
      file
    });

    const encoded = 'kb%2F%E5%85%AC%E5%8F%B8%E5%88%B6%E5%BA%A6';
    expect(get).toHaveBeenCalledWith('/enterprise/knowledge-bases');
    expect(get).toHaveBeenCalledWith(
      `/enterprise/knowledge-bases/${encoded}/documents`
    );
    expect(postBinary).toHaveBeenCalledWith(
      `/enterprise/knowledge-bases/${encoded}/documents?fileName=%E5%88%B6%E5%BA%A6+2026.pdf&mimeType=application%2Fpdf&sizeBytes=6`,
      file,
      'application/vnd.clawee.knowledge-document'
    );
  });

  it('uses shared drive pagination, transfer, and project download routes', async () => {
    const get = vi.fn(async (_path: string) => ({}));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const postBinary = vi.fn(async (
      _path: string,
      _body: BodyInit,
      _contentType?: string
    ) => ({}));
    const service = createEnterpriseService(
      createClient({ get, post, postBinary })
    );
    const file = new File(['drive'], '方案.md', {
      type: 'text/markdown'
    });

    await service.listSharedSpaces({ limit: 50, cursor: 'space cursor' });
    await service.listSharedFiles({
      spaceId: 'space/季度',
      query: 'design',
      logicalPathPrefix: 'docs/',
      limit: 100,
      cursor: 'file cursor'
    });
    await service.getSharedFileDetail('file/方案');
    await service.uploadSharedFile({
      spaceId: 'space/季度',
      logicalPath: 'docs/方案.md',
      expectedRevision: 3,
      file
    });
    await service.downloadSharedFile({
      fileId: 'file/方案',
      projectId: 'project_1',
      overwrite: true
    });

    expect(get).toHaveBeenCalledWith(
      '/enterprise/shared-spaces?limit=50&cursor=space+cursor'
    );
    expect(get).toHaveBeenCalledWith(
      '/enterprise/shared-files?spaceId=space%2F%E5%AD%A3%E5%BA%A6&query=design&logicalPathPrefix=docs%2F&limit=100&cursor=file+cursor'
    );
    expect(get).toHaveBeenCalledWith(
      '/enterprise/shared-files/file%2F%E6%96%B9%E6%A1%88'
    );
    expect(postBinary).toHaveBeenCalledWith(
      '/enterprise/shared-spaces/space%2F%E5%AD%A3%E5%BA%A6/files?logicalPath=docs%2F%E6%96%B9%E6%A1%88.md&contentType=text%2Fmarkdown&sizeBytes=5&expectedRevision=3',
      file,
      'application/vnd.clawee.shared-file'
    );
    expect(post).toHaveBeenCalledWith(
      '/enterprise/shared-files/file%2F%E6%96%B9%E6%A1%88/download',
      { projectId: 'project_1', overwrite: true }
    );
  });
});

function createClient(
  overrides: {
    get?: (path: string) => Promise<unknown>;
    post?: (path: string, body?: unknown) => Promise<unknown>;
    postBinary?: (
      path: string,
      body: BodyInit,
      contentType?: string
    ) => Promise<unknown>;
  }
): Pick<RuntimeClient, 'get' | 'post' | 'postBinary'> {
  return {
    get<T>(path: string): Promise<T> {
      if (overrides.get) return overrides.get(path) as Promise<T>;
      throw new Error(`Unexpected get: ${path}`);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      if (overrides.post) {
        return (
          body === undefined ? overrides.post(path) : overrides.post(path, body)
        ) as Promise<T>;
      }
      throw new Error(`Unexpected post: ${path}`);
    },
    postBinary<T>(
      path: string,
      body: BodyInit,
      contentType?: string
    ): Promise<T> {
      if (overrides.postBinary) {
        return overrides.postBinary(path, body, contentType) as Promise<T>;
      }
      throw new Error(`Unexpected binary post: ${path}`);
    }
  };
}
