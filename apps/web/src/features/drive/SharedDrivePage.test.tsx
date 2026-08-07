import type {
  EnterpriseSessionResponse,
  EnterpriseSharedFileResponse,
  EnterpriseSharedSpaceResponse
} from '@clawee/protocol';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  SharedDrivePage,
  type SharedDrivePageProps
} from './SharedDrivePage.js';

const signedInSession: EnterpriseSessionResponse = {
  status: 'signed_in',
  account: { email: 'member@example.com', name: '企业成员' },
  transportSecurity: 'secure_https'
};

const writableSpace = createSpace({
  spaceId: 'space-design',
  name: '设计资料',
  permissions: { read: true, write: true }
});

const readOnlySpace = createSpace({
  spaceId: 'space-policy',
  name: '公司制度',
  permissions: { read: true, write: false }
});

const designFile = createFile({
  fileId: 'file-design',
  spaceId: writableSpace.spaceId,
  spaceName: writableSpace.name,
  logicalPath: 'docs/design.md',
  fileName: 'design.md',
  revision: 3
});

describe('SharedDrivePage', () => {
  it('renders Runtime, session, service, and login gates', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    const onOpenAccount = vi.fn();
    const view = renderDrive({
      connected: false,
      onRefresh,
      onOpenAccount
    });
    expect(screen.getByRole('heading', { name: '正在等待本地 Runtime' }))
      .toBeInTheDocument();

    view.rerender(createDrive({
      session: {
        status: 'checking',
        transportSecurity: 'secure_https'
      },
      onRefresh,
      onOpenAccount
    }));
    expect(screen.getByRole('heading', { name: '正在验证企业会话' }))
      .toBeInTheDocument();

    view.rerender(createDrive({
      session: {
        status: 'service_unavailable',
        reason: 'service_unavailable',
        transportSecurity: 'secure_https'
      },
      onRefresh,
      onOpenAccount
    }));
    await user.click(screen.getByRole('button', { name: '重新加载' }));
    expect(onRefresh).toHaveBeenCalledOnce();

    view.rerender(createDrive({
      session: {
        status: 'signed_out',
        transportSecurity: 'secure_https'
      },
      onRefresh,
      onOpenAccount
    }));
    await user.click(screen.getByRole('button', { name: '登录企业账户' }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });

  it('renders authorized spaces and remote files, then submits server search', async () => {
    const user = userEvent.setup();
    const onSelectSpace = vi.fn();
    const onSearch = vi.fn();
    renderDrive({
      spaces: [writableSpace, readOnlySpace],
      selectedSpaceId: writableSpace.spaceId,
      files: [designFile],
      onSelectSpace,
      onSearch
    });

    const navigation = screen.getByRole('navigation', {
      name: '授权共享空间'
    });
    expect(within(navigation).getByText('设计资料')).toBeInTheDocument();
    expect(within(navigation).getByText('公司制度')).toBeInTheDocument();
    expect(within(navigation).getByText('可写')).toBeInTheDocument();
    expect(screen.getByText('docs/design.md · revision 3')).toBeInTheDocument();
    expect(screen.getByText('12.1 KiB')).toBeInTheDocument();

    await user.click(within(navigation).getByRole('button', { name: /公司制度/ }));
    expect(onSelectSpace).toHaveBeenCalledWith(readOnlySpace.spaceId);

    await user.type(
      screen.getByRole('searchbox', { name: '搜索共享文件' }),
      'design'
    );
    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledWith('design');
  });

  it('only exposes write operations for writable spaces', () => {
    const view = renderDrive({
      spaces: [readOnlySpace],
      selectedSpaceId: readOnlySpace.spaceId,
      files: [
        createFile({
          spaceId: readOnlySpace.spaceId,
          spaceName: readOnlySpace.name
        })
      ]
    });
    expect(screen.queryByRole('button', { name: '上传文件' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /替换/ }))
      .not.toBeInTheDocument();

    view.rerender(createDrive({
      spaces: [writableSpace],
      selectedSpaceId: writableSpace.spaceId,
      files: [designFile]
    }));
    expect(screen.getByRole('button', { name: '上传文件' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '替换 design.md' }))
      .toBeInTheDocument();
  });

  it('uploads, replaces, downloads, and requires explicit local overwrite', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    const onReplace = vi.fn();
    const onDownload = vi.fn();
    const view = renderDrive({
      spaces: [writableSpace],
      selectedSpaceId: writableSpace.spaceId,
      files: [designFile],
      onUpload,
      onReplace,
      onDownload
    });

    const upload = new File(['new'], 'new.md', { type: 'text/markdown' });
    await user.upload(
      screen.getByLabelText('选择上传到共享网盘的文件'),
      upload
    );
    expect(onUpload).toHaveBeenCalledWith(writableSpace.spaceId, upload);

    await user.click(screen.getByRole('button', { name: '替换 design.md' }));
    const replacement = new File(['replace'], 'local.md', {
      type: 'text/markdown'
    });
    await user.upload(
      screen.getByLabelText('选择替换共享文件的本地文件'),
      replacement
    );
    expect(onReplace).toHaveBeenCalledWith(designFile, replacement);

    await user.click(
      screen.getByRole('button', { name: '保存 design.md 到当前项目' })
    );
    expect(onDownload).toHaveBeenCalledWith(designFile, false);

    view.rerender(createDrive({
      spaces: [writableSpace],
      selectedSpaceId: writableSpace.spaceId,
      files: [designFile],
      operation: {
        kind: 'download',
        fileId: designFile.fileId,
        fileName: designFile.logicalPath,
        status: 'requires_overwrite',
        error: '项目中已存在文件'
      },
      onUpload,
      onReplace,
      onDownload
    }));
    await user.click(
      screen.getByRole('button', { name: '覆盖保存 design.md' })
    );
    expect(onDownload).toHaveBeenLastCalledWith(designFile, true);
  });

  it('rejects files above the service-advertised size before upload', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    renderDrive({
      spaces: [writableSpace],
      selectedSpaceId: writableSpace.spaceId,
      maxFileSizeBytes: 4,
      onUpload
    });
    const oversized = new File(['12345'], 'large.bin');
    await user.upload(
      screen.getByLabelText('选择上传到共享网盘的文件'),
      oversized
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      '单个文件不能超过 4 B'
    );
    expect(onUpload).not.toHaveBeenCalled();
  });
});

function renderDrive(overrides: Partial<SharedDrivePageProps> = {}) {
  return render(createDrive(overrides));
}

function createDrive(overrides: Partial<SharedDrivePageProps> = {}) {
  return (
    <SharedDrivePage
      connected
      session={signedInSession}
      spaces={[]}
      spacesLoading={false}
      spacesHasNext={false}
      files={[]}
      filesLoading={false}
      filesHasNext={false}
      query=""
      maxFileSizeBytes={1024 * 1024 * 1024}
      currentProjectId="project_1"
      currentProjectName="默认项目"
      onOpenAccount={vi.fn()}
      onRefresh={vi.fn()}
      onLoadMoreSpaces={vi.fn()}
      onSelectSpace={vi.fn()}
      onSearch={vi.fn()}
      onLoadMoreFiles={vi.fn()}
      onUpload={vi.fn()}
      onReplace={vi.fn()}
      onDownload={vi.fn()}
      {...overrides}
    />
  );
}

function createSpace(
  overrides: Partial<EnterpriseSharedSpaceResponse> = {}
): EnterpriseSharedSpaceResponse {
  return {
    spaceId: 'space-default',
    name: '共享空间',
    description: '企业共享文件',
    updatedAt: '2026-08-05T08:00:00Z',
    permissions: { read: true, write: false },
    ...overrides
  };
}

function createFile(
  overrides: Partial<EnterpriseSharedFileResponse> = {}
): EnterpriseSharedFileResponse {
  return {
    fileId: 'file-default',
    spaceId: 'space-default',
    spaceName: '共享空间',
    logicalPath: 'docs/file.md',
    fileName: 'file.md',
    sizeBytes: 12345,
    sha256: 'a'.repeat(64),
    contentType: 'text/markdown',
    revision: 1,
    updatedByUserId: 'usr_123',
    updatedByAgentId: 'agent_123',
    updatedAt: '2026-08-05T08:30:00Z',
    ...overrides
  };
}
