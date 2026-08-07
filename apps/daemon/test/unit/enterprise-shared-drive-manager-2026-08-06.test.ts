import type { ProjectResponse } from '@clawee/protocol';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteSharedFile
} from '../../src/enterprise/http-client-2026-07-30.js';
import {
  EnterpriseHttpError
} from '../../src/enterprise/http-client-2026-07-30.js';
import {
  createEnterpriseSharedDriveManager
} from '../../src/enterprise/shared-drive-manager-2026-08-06.js';
import type {
  EnterpriseSessionManager
} from '../../src/enterprise/session-manager-2026-07-30.js';
import type { ProjectManager } from '../../src/projects/types.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = '';
});

describe('enterprise shared drive manager', () => {
  it('returns paginated spaces and files with refresh metadata', async () => {
    tempDir = createTempDirectory();
    const listSharedSpaces = vi.fn(async () => ({
      spaces: [sharedSpace()],
      meta: {
        nextCursor: 'space-next',
        hasNext: true,
        maxFileSizeBytes: 1024
      }
    }));
    const listSharedFiles = vi.fn(async () => ({
      files: [sharedFile()],
      meta: { nextCursor: 'file-next', hasNext: true }
    }));
    const manager = createManager({
      listSharedSpaces,
      listSharedFiles,
      now: () => new Date('2026-08-06T08:00:00.000Z')
    });

    await expect(manager.listSpaces({
      limit: 50,
      cursor: 'space-cursor'
    })).resolves.toEqual({
      spaces: [sharedSpace()],
      meta: {
        nextCursor: 'space-next',
        hasNext: true,
        maxFileSizeBytes: 1024
      },
      refreshedAt: '2026-08-06T08:00:00.000Z'
    });
    await expect(manager.listFiles({
      spaceId: ' space_1 ',
      query: ' design ',
      logicalPathPrefix: 'docs/',
      limit: 100,
      cursor: 'file-cursor'
    })).resolves.toEqual({
      files: [sharedFile()],
      meta: { nextCursor: 'file-next', hasNext: true },
      refreshedAt: '2026-08-06T08:00:00.000Z'
    });
    expect(listSharedSpaces).toHaveBeenCalledWith('enterprise-token', {
      limit: 50,
      cursor: 'space-cursor'
    });
    expect(listSharedFiles).toHaveBeenCalledWith({
      accessToken: 'enterprise-token',
      spaceId: 'space_1',
      query: 'design',
      logicalPathPrefix: 'docs/',
      limit: 100,
      cursor: 'file-cursor'
    });
  });

  it('stages upload bytes privately and forwards the computed digest once', async () => {
    tempDir = createTempDirectory();
    const content = Buffer.from('shared design');
    const sha256 = createHash('sha256').update(content).digest('hex');
    let stagedPath = '';
    const uploadSharedFileContent = vi.fn(async input => {
      stagedPath = input.filePath;
      expect(readFileSync(input.filePath)).toEqual(content);
      expect(input).toMatchObject({
        accessToken: 'enterprise-token',
        spaceId: 'space_1',
        logicalPath: 'docs/design.md',
        expectedRevision: 3,
        sizeBytes: content.byteLength,
        sha256,
        contentType: 'text/markdown'
      });
      return {
        fileId: 'file_1',
        spaceId: 'space_1',
        logicalPath: 'docs/design.md',
        fileName: 'design.md',
        sizeBytes: content.byteLength,
        sha256,
        contentType: 'text/markdown',
        revision: 4,
        created: false,
        updatedAt: '2026-08-06T08:01:00Z'
      };
    });
    const manager = createManager({ uploadSharedFileContent });

    await expect(manager.uploadFile({
      spaceId: 'space_1',
      logicalPath: 'docs/design.md',
      expectedRevision: 3,
      contentType: 'text/markdown',
      expectedSizeBytes: content.byteLength,
      content: chunks(content.subarray(0, 5), content.subarray(5))
    })).resolves.toMatchObject({
      fileId: 'file_1',
      revision: 4,
      created: false
    });
    expect(uploadSharedFileContent).toHaveBeenCalledOnce();
    expect(existsSync(stagedPath)).toBe(false);
  });

  it('reconciles an unknown create by exact path and digest without retrying upload', async () => {
    tempDir = createTempDirectory();
    const content = Buffer.from('new shared file');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const uploadSharedFileContent = vi.fn(async () => {
      throw new EnterpriseHttpError(
        'ENTERPRISE_SERVICE_UNAVAILABLE',
        'request'
      );
    });
    const listSharedFiles = vi.fn()
      .mockResolvedValueOnce({
        files: [
          sharedFile({
            fileId: 'file_prefix_only',
            logicalPath: 'docs/design.md.bak',
            sha256
          })
        ],
        meta: { nextCursor: 'page-2', hasNext: true }
      })
      .mockResolvedValueOnce({
        files: [
          sharedFile({
            logicalPath: 'docs/design.md',
            sha256,
            sizeBytes: content.byteLength
          })
        ],
        meta: { nextCursor: '', hasNext: false }
      });
    const manager = createManager({
      uploadSharedFileContent,
      listSharedFiles
    });

    await expect(manager.uploadFile({
      spaceId: 'space_1',
      logicalPath: 'docs/design.md',
      contentType: 'text/markdown',
      expectedSizeBytes: content.byteLength,
      content: chunks(content)
    })).resolves.toMatchObject({
      fileId: 'file_1',
      logicalPath: 'docs/design.md',
      sha256,
      created: true,
      reconciled: true
    });
    expect(uploadSharedFileContent).toHaveBeenCalledOnce();
    expect(listSharedFiles).toHaveBeenNthCalledWith(1, {
      accessToken: 'enterprise-token',
      spaceId: 'space_1',
      logicalPathPrefix: 'docs/design.md',
      limit: 100
    });
    expect(listSharedFiles).toHaveBeenNthCalledWith(2, {
      accessToken: 'enterprise-token',
      spaceId: 'space_1',
      logicalPathPrefix: 'docs/design.md',
      limit: 100,
      cursor: 'page-2'
    });
  });

  it('reports an existing remote path when unknown create reconciliation finds another digest', async () => {
    tempDir = createTempDirectory();
    const content = Buffer.from('new shared file');
    const manager = createManager({
      uploadSharedFileContent: vi.fn(async () => {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'request'
        );
      }),
      listSharedFiles: vi.fn(async () => ({
        files: [
          sharedFile({
            logicalPath: 'docs/design.md',
            sha256: 'f'.repeat(64)
          })
        ],
        meta: { nextCursor: '', hasNext: false }
      }))
    });

    await expect(manager.uploadFile({
      spaceId: 'space_1',
      logicalPath: 'docs/design.md',
      contentType: 'text/markdown',
      expectedSizeBytes: content.byteLength,
      content: chunks(content)
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SHARED_FILE_ALREADY_EXISTS',
      statusCode: 409
    });
  });

  it('requires explicit overwrite before replacing a project file', async () => {
    tempDir = createTempDirectory();
    const projectDir = join(tempDir, 'project');
    const targetPath = join(projectDir, 'docs', 'design.md');
    mkdirSync(join(projectDir, 'docs'), { recursive: true });
    writeFileSync(targetPath, 'local version');
    const content = Buffer.from('remote version');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const downloadSharedFileContent = vi.fn(async input => {
      writeFileSync(input.destinationPath, content);
      return {
        bytes: content.byteLength,
        sha256,
        revision: 3,
        contentType: 'text/markdown'
      };
    });
    const manager = createManager({
      project: projectResponse(projectDir),
      getSharedFileDetail: vi.fn(async () => sharedFile()),
      downloadSharedFileContent
    });

    await expect(manager.downloadToProject({
      fileId: 'file_1',
      projectId: 'project_1',
      overwrite: false
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS',
      statusCode: 409,
      details: { relativePath: 'docs/design.md' }
    });
    expect(downloadSharedFileContent).not.toHaveBeenCalled();

    await expect(manager.downloadToProject({
      fileId: 'file_1',
      projectId: 'project_1',
      overwrite: true
    })).resolves.toEqual({
      fileId: 'file_1',
      projectId: 'project_1',
      relativePath: 'docs/design.md',
      sizeBytes: content.byteLength,
      sha256,
      revision: 3,
      overwritten: true
    });
    expect(readFileSync(targetPath)).toEqual(content);
  });

  it('rejects ignored and symlinked project paths before downloading bytes', async () => {
    tempDir = createTempDirectory();
    const projectDir = join(tempDir, 'project');
    const outsideDir = join(tempDir, 'outside');
    mkdirSync(projectDir);
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, join(projectDir, 'linked'));
    const downloadSharedFileContent = vi.fn();
    const getSharedFileDetail = vi.fn()
      .mockResolvedValueOnce(sharedFile({ logicalPath: '.git/config' }))
      .mockResolvedValueOnce(sharedFile({ logicalPath: 'linked/secret.txt' }));
    const manager = createManager({
      project: projectResponse(projectDir),
      getSharedFileDetail,
      downloadSharedFileContent
    });

    await expect(manager.downloadToProject({
      fileId: 'file_1',
      projectId: 'project_1',
      overwrite: false
    })).rejects.toMatchObject({ code: 'PATH_IGNORED', statusCode: 403 });
    await expect(manager.downloadToProject({
      fileId: 'file_1',
      projectId: 'project_1',
      overwrite: false
    })).rejects.toMatchObject({ code: 'PATH_ESCAPE', statusCode: 403 });
    expect(downloadSharedFileContent).not.toHaveBeenCalled();
  });
});

function createManager(
  overrides: Partial<EnterpriseHttpClient> & {
    now?: () => Date;
    project?: ProjectResponse;
  } = {}
) {
  const { now, project, ...httpOverrides } = overrides;
  return createEnterpriseSharedDriveManager({
    dataDir: tempDir,
    sessionManager: createSessionManager(),
    httpClient: createHttpClient(httpOverrides),
    projectManager: createProjectManager(project),
    ...(now === undefined ? {} : { now })
  });
}

function createSessionManager(): EnterpriseSessionManager {
  return {
    startRestore: vi.fn(),
    getSnapshot: vi.fn(() => ({
      status: 'signed_in' as const,
      account: { email: 'member@example.com', name: 'Member' },
      transportSecurity: 'secure_https' as const
    })),
    refresh: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    requireAccessToken: vi.fn(async () => 'enterprise-token'),
    invalidateUnauthorized: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  };
}

function createHttpClient(
  overrides: Partial<EnterpriseHttpClient> = {}
): EnterpriseHttpClient {
  return {
    register: vi.fn(),
    login: vi.fn(),
    getMe: vi.fn(),
    logout: vi.fn(),
    listKnowledgeBases: vi.fn(async () => ({
      knowledgeBases: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    listKnowledgeDocuments: vi.fn(async () => ({
      documents: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    uploadKnowledgeDocument: vi.fn(),
    listSharedSpaces: vi.fn(async () => ({
      spaces: [sharedSpace()],
      meta: {
        nextCursor: '',
        hasNext: false,
        maxFileSizeBytes: 1024 * 1024 * 1024
      }
    })),
    listSharedFiles: vi.fn(async () => ({
      files: [sharedFile()],
      meta: { nextCursor: '', hasNext: false }
    })),
    getSharedFileDetail: vi.fn(async () => sharedFile()),
    downloadSharedFileContent: vi.fn(),
    uploadSharedFileContent: vi.fn(),
    listSkills: vi.fn(async () => []),
    getSkillDetail: vi.fn(),
    downloadSkillPackage: vi.fn(),
    ...overrides
  };
}

function createProjectManager(project?: ProjectResponse): ProjectManager {
  return {
    getProject: vi.fn(id => (
      id === project?.id ? project : undefined
    ))
  } as unknown as ProjectManager;
}

function projectResponse(cwd: string): ProjectResponse {
  return {
    id: 'project_1',
    name: '当前项目',
    cwd,
    canonicalCwd: realpathSync(cwd),
    directoryState: 'available',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'follow-global',
    status: 'active',
    createdAt: '2026-08-06T07:00:00.000Z',
    updatedAt: '2026-08-06T07:00:00.000Z',
    archivedAt: null
  };
}

function sharedSpace() {
  return {
    spaceId: 'space_1',
    name: '设计资料',
    description: '团队设计文件',
    updatedAt: '2026-08-06T07:30:00Z',
    permissions: { read: true, write: false }
  };
}

function sharedFile(
  overrides: Partial<EnterpriseRemoteSharedFile> = {}
): EnterpriseRemoteSharedFile {
  return {
    fileId: 'file_1',
    spaceId: 'space_1',
    spaceName: '设计资料',
    logicalPath: 'docs/design.md',
    fileName: 'design.md',
    sizeBytes: 13,
    sha256: 'a'.repeat(64),
    contentType: 'text/markdown',
    revision: 3,
    updatedByUserId: 'usr_1',
    updatedByAgentId: 'agent_1',
    updatedAt: '2026-08-06T07:45:00Z',
    ...overrides
  };
}

async function* chunks(
  ...values: Uint8Array[]
): AsyncIterable<Uint8Array> {
  for (const value of values) yield value;
}

function createTempDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'clawee-shared-drive-manager-'));
}
