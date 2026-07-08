import type { ThreadResponse, WorkspaceDirectoryResponse, WorkspaceFileMeta, WorkspaceFileNode } from '@clawee/protocol';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import { workspaceKey } from './file-view-state.js';
import { FileWorkspaceView, type WorkspaceFileService } from './FileWorkspaceView.js';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  document.createRange = ((() => ({
    setStart() {},
    setEnd() {},
    collapse() {},
    cloneRange() {
      return this;
    },
    selectNodeContents() {},
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON() {} };
    },
    getClientRects() {
      return {
        length: 0,
        item() {
          return null;
        },
        [Symbol.iterator]: function* iterator() {}
      };
    },
    commonAncestorContainer: document.body
  })) as unknown) as typeof document.createRange;
  window.localStorage.clear();
});

describe('FileWorkspaceView', () => {
  it('没有 selected thread 时显示空态', () => {
    render(<FileWorkspaceView workspaceFileService={createService()} onBack={vi.fn()} />);

    expect(screen.getByText('请选择或创建一个会话后查看文件')).toBeInTheDocument();
  });

  it('加载根目录后自动打开 suggestedOpenPath，并记录最近打开文件', async () => {
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'README.md',
          nodes: [fileNode('README.md', 'markdown')]
        })
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    expect(service.listDirectory).toHaveBeenCalledWith(thread.id, '');
    await waitFor(() => expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'README.md'));
    await waitFor(() => expect(service.openText).toHaveBeenCalledWith(thread.id, 'README.md'));
    expect(await screen.findByRole('textbox', { name: 'README.md 编辑器' })).toBeInTheDocument();
    expect(window.localStorage.getItem(`clawee.file-workspace.recent.${workspaceKey(thread.canonicalCwd)}`)).toBe('README.md');
  });

  it('点击目录时调用 listDirectory 并合并节点', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          nodes: [directoryNode('docs', 0)]
        }),
        docs: createDirectory({
          path: 'docs',
          nodes: [fileNode('docs/guide.md', 'markdown', 1)]
        })
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('treeitem', { name: 'docs' }));

    expect(service.listDirectory).toHaveBeenCalledWith(thread.id, 'docs');
    expect(await screen.findByRole('treeitem', { name: 'guide.md' })).toBeInTheDocument();
  });

  it('点击文本文件时调用 getMeta 和 openText', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          nodes: [fileNode('notes.txt', 'text')]
        })
      },
      metas: {
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain' })
      },
      contents: {
        'notes.txt': 'hello notes'
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('treeitem', { name: 'notes.txt' }));

    expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'notes.txt');
    expect(service.openText).toHaveBeenCalledWith(thread.id, 'notes.txt');
    expect(await screen.findByRole('textbox', { name: 'notes.txt 编辑器' })).toHaveTextContent('hello notes');
  });

  it('点击图片和 PDF 时调用 getMeta 和 openBlob', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          nodes: [fileNode('preview.png', 'image'), fileNode('spec.pdf', 'pdf')]
        })
      },
      metas: {
        'preview.png': createMeta({
          path: 'preview.png',
          name: 'preview.png',
          kind: 'image',
          mime: 'image/png',
          editable: false
        }),
        'spec.pdf': createMeta({
          path: 'spec.pdf',
          name: 'spec.pdf',
          kind: 'pdf',
          mime: 'application/pdf',
          editable: false
        })
      },
      blobs: {
        'preview.png': { objectUrl: 'blob:image-preview', mime: 'image/png', size: 100 },
        'spec.pdf': { objectUrl: 'blob:pdf-preview', mime: 'application/pdf', size: 200 }
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    await user.click(await screen.findByRole('treeitem', { name: 'preview.png' }));
    await waitFor(() => expect(service.openBlob).toHaveBeenCalledWith(thread.id, 'preview.png'));
    await user.click(screen.getByRole('treeitem', { name: 'spec.pdf' }));
    await waitFor(() => expect(service.openBlob).toHaveBeenCalledWith(thread.id, 'spec.pdf'));
  });

  it('主工作区 DOM 顺序为编辑区在前、文件树在后', async () => {
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'README.md',
          nodes: [fileNode('README.md', 'markdown')]
        })
      }
    });

    const { container } = render(
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />
    );

    await screen.findByRole('textbox', { name: 'README.md 编辑器' });

    const body = container.querySelector('.file-workspace-body');
    if (!(body instanceof HTMLElement)) throw new Error('Expected file workspace body');
    const editor = body.querySelector('.file-workspace-editor');
    const tree = body.querySelector('.file-tree-panel');

    expect(body.firstElementChild).toBe(editor);
    expect(body.lastElementChild).toBe(tree);
  });

  it('切换 blob 文件或卸载时会 revokeBlob', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          nodes: [fileNode('preview.png', 'image'), fileNode('notes.txt', 'text')]
        })
      },
      metas: {
        'preview.png': createMeta({
          path: 'preview.png',
          name: 'preview.png',
          kind: 'image',
          mime: 'image/png',
          editable: false
        }),
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain' })
      },
      contents: {
        'notes.txt': 'switch target'
      },
      blobs: {
        'preview.png': { objectUrl: 'blob:image-preview', mime: 'image/png', size: 100 }
      }
    });

    const { unmount } = render(
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />
    );

    await user.click(await screen.findByRole('treeitem', { name: 'preview.png' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'preview.png' })).toBeInTheDocument());
    await user.click(screen.getByRole('treeitem', { name: 'notes.txt' }));
    await waitFor(() => expect(service.revokeBlob).toHaveBeenCalledWith('blob:image-preview'));

    await user.click(screen.getByRole('treeitem', { name: 'preview.png' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'preview.png' })).toBeInTheDocument());
    unmount();

    expect(service.revokeBlob).toHaveBeenCalledWith('blob:image-preview');
  });

  it('编辑后保存调用 saveText 并清除 dirty', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'notes.txt',
          nodes: [fileNode('notes.txt', 'text')]
        })
      },
      metas: {
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain', versionToken: 'v1' })
      },
      contents: {
        'notes.txt': 'draft'
      },
      saveResultMeta: createMeta({
        path: 'notes.txt',
        name: 'notes.txt',
        kind: 'text',
        mime: 'text/plain',
        versionToken: 'v2'
      })
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    const editor = await screen.findByRole('textbox', { name: 'notes.txt 编辑器' });
    await user.click(editor);
    await user.keyboard('A');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(service.saveText).toHaveBeenCalledWith({
        threadId: thread.id,
        path: 'notes.txt',
        content: 'Adraft',
        baseVersionToken: 'v1',
        overwriteConflict: false
      });
    });
    await waitFor(() => expect(screen.queryByLabelText('未保存')).not.toBeInTheDocument());
  });

  it('409 FILE_CONFLICT 显示重新加载、覆盖保存、取消入口', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'notes.txt',
          nodes: [fileNode('notes.txt', 'text')]
        })
      },
      metas: {
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain', versionToken: 'v1' })
      },
      contents: {
        'notes.txt': 'draft'
      },
      saveError: new ApiClientError({
        status: 409,
        code: 'FILE_CONFLICT',
        message: 'conflict'
      })
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    const editor = await screen.findByRole('textbox', { name: 'notes.txt 编辑器' });
    await user.click(editor);
    await user.keyboard('A');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '覆盖保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('编辑后切换文件时，取消 confirm 不切换，确认后才切换', async () => {
    const user = userEvent.setup();
    const confirmMock = vi.spyOn(window, 'confirm');
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'notes.txt',
          nodes: [fileNode('notes.txt', 'text'), fileNode('guide.md', 'markdown')]
        })
      },
      metas: {
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain' }),
        'guide.md': createMeta({ path: 'guide.md', name: 'guide.md', kind: 'markdown', mime: 'text/markdown' })
      },
      contents: {
        'notes.txt': 'draft',
        'guide.md': '# guide'
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    const editor = await screen.findByRole('textbox', { name: 'notes.txt 编辑器' });
    await user.click(editor);
    await user.keyboard('A');

    confirmMock.mockReturnValueOnce(false);
    await user.click(screen.getByRole('treeitem', { name: 'guide.md' }));

    expect(confirmMock).toHaveBeenCalledWith('当前文件有未保存修改，确定放弃并切换吗？');
    expect(service.getMeta).not.toHaveBeenCalledWith(thread.id, 'guide.md');
    expect(screen.getByRole('textbox', { name: 'notes.txt 编辑器' })).toBeInTheDocument();

    confirmMock.mockReturnValueOnce(true);
    await user.click(screen.getByRole('treeitem', { name: 'guide.md' }));

    await waitFor(() => expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'guide.md'));
    expect(await screen.findByRole('textbox', { name: 'guide.md 编辑器' })).toBeInTheDocument();
  });

  it('409 冲突时重新加载会重新打开当前文件，覆盖保存会带 overwriteConflict，取消会关闭提示', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'notes.txt',
          nodes: [fileNode('notes.txt', 'text')]
        })
      },
      metas: {
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain', versionToken: 'v1' })
      },
      contents: {
        'notes.txt': 'draft'
      },
      saveError: new ApiClientError({
        status: 409,
        code: 'FILE_CONFLICT',
        message: 'conflict'
      })
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    const editor = await screen.findByRole('textbox', { name: 'notes.txt 编辑器' });
    await user.click(editor);
    await user.keyboard('A');
    await user.click(screen.getByRole('button', { name: '保存' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('文件内容与最新版本冲突。')).toBeInTheDocument();

    const metaCallsBeforeReload = service.getMeta.mock.calls.length;
    const textCallsBeforeReload = service.openText.mock.calls.length;
    await user.click(within(alert).getByRole('button', { name: '重新加载' }));
    await waitFor(() => expect(service.getMeta.mock.calls.length).toBe(metaCallsBeforeReload + 1));
    await waitFor(() => expect(service.openText.mock.calls.length).toBe(textCallsBeforeReload + 1));

    await user.click(screen.getByRole('textbox', { name: 'notes.txt 编辑器' }));
    await user.keyboard('B');
    await user.click(screen.getByRole('button', { name: '保存' }));
    const conflictAlert = await screen.findByRole('alert');
    await user.click(within(conflictAlert).getByRole('button', { name: '覆盖保存' }));

    await waitFor(() => {
      expect(service.saveText).toHaveBeenLastCalledWith({
        threadId: thread.id,
        path: 'notes.txt',
        content: 'Bdraft',
        baseVersionToken: 'v1',
        overwriteConflict: true
      });
    });

    await user.click(screen.getByRole('textbox', { name: 'notes.txt 编辑器' }));
    await user.keyboard('C');
    await user.click(screen.getByRole('button', { name: '保存' }));
    const closeAlert = await screen.findByRole('alert');
    await user.click(within(closeAlert).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('read-only thread 显示只读提示且不能保存', async () => {
    const thread = createThread({ sandbox: 'read-only' });
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'notes.txt',
          nodes: [fileNode('notes.txt', 'text')]
        })
      },
      metas: {
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain' })
      },
      contents: {
        'notes.txt': 'readonly'
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onBack={vi.fn()} />);

    expect(await screen.findByText('当前会话为只读模式，不能保存文件')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'notes.txt 编辑器' })).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });
});

type ServiceOptions = {
  directories?: Record<string, WorkspaceDirectoryResponse>;
  metas?: Record<string, WorkspaceFileMeta>;
  contents?: Record<string, string>;
  blobs?: Record<string, { objectUrl: string; mime: string; size: number }>;
  saveResultMeta?: WorkspaceFileMeta;
  saveError?: Error;
};

function createService(options: ServiceOptions = {}): WorkspaceFileService & {
  listDirectory: ReturnType<typeof vi.fn>;
  getMeta: ReturnType<typeof vi.fn>;
  openText: ReturnType<typeof vi.fn>;
  saveText: ReturnType<typeof vi.fn>;
  openBlob: ReturnType<typeof vi.fn>;
  revokeBlob: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
} {
  return {
    listDirectory: vi.fn(async (_threadId: string, path: string) => {
      return options.directories?.[path] ?? createDirectory({ path });
    }),
    getMeta: vi.fn(async (_threadId: string, path: string) => {
      return options.metas?.[path] ?? createMeta({ path, name: path.split('/').at(-1) ?? path });
    }),
    openText: vi.fn(async (_threadId: string, path: string) => ({
      meta: options.metas?.[path] ?? createMeta({ path, name: path.split('/').at(-1) ?? path }),
      content: options.contents?.[path] ?? '',
      encoding: 'utf8' as const
    })),
    saveText: vi.fn(async (input) => {
      if (options.saveError) {
        throw options.saveError;
      }

      return {
        meta: options.saveResultMeta ?? createMeta({ path: input.path, name: input.path.split('/').at(-1) ?? input.path, versionToken: 'v2' }),
        saved: true as const
      };
    }),
    openBlob: vi.fn(async (_threadId: string, path: string) => {
      const blob = options.blobs?.[path];
      if (!blob) {
        throw new Error(`Missing blob for ${path}`);
      }
      return blob;
    }),
    revokeBlob: vi.fn(),
    reveal: vi.fn(async () => ({ ok: true }))
  };
}

function createThread(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread-1',
    title: '会话',
    codexThreadId: null,
    cwd: '/Users/test/repo',
    canonicalCwd: '/Users/test/repo',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'danger-full-access',
    status: 'active',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

function createDirectory(input: Partial<WorkspaceDirectoryResponse>): WorkspaceDirectoryResponse {
  return {
    threadId: 'thread-1',
    rootName: 'repo',
    rootPathLabel: '/Users/test/repo',
    path: '',
    truncated: false,
    warnings: [],
    nodes: [],
    ...input
  };
}

function createMeta(overrides: Partial<WorkspaceFileMeta> = {}): WorkspaceFileMeta {
  return {
    path: overrides.path ?? 'README.md',
    name: overrides.name ?? 'README.md',
    type: 'file',
    kind: overrides.kind ?? 'markdown',
    mime: overrides.mime ?? 'text/markdown',
    size: 1,
    mtimeMs: 1,
    versionToken: overrides.versionToken ?? 'v1',
    previewable: overrides.previewable ?? true,
    editable: overrides.editable ?? true,
    readonly: overrides.readonly ?? false,
    reason: overrides.reason,
    ...overrides
  };
}

function fileNode(path: string, kind: WorkspaceFileMeta['kind'], depth = 0): WorkspaceFileNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'file',
    meta: {
      kind,
      mime: kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'text/plain',
      size: 1,
      mtimeMs: 1,
      previewable: kind !== 'binary',
      editable: kind !== 'image' && kind !== 'pdf' && kind !== 'binary',
      readonly: false
    }
  };
}

function directoryNode(path: string, depth = 0): WorkspaceFileNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'directory',
    hasChildren: true,
    childrenLoaded: false
  };
}
