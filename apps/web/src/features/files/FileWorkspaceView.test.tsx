import type { ThreadResponse, WorkspaceDirectoryResponse, WorkspaceFileMeta, WorkspaceFileNode } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/dialogs/ConfirmDialogProvider.js';
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
  window.localStorage.clear();
});

describe('FileWorkspaceView', () => {
  it('没有 selected thread 时显示空态', () => {
    render(<FileWorkspaceView workspaceFileService={createService()} onClose={vi.fn()} />);

    expect(screen.getByText('请选择或创建一个会话后查看文件')).toBeInTheDocument();
  });

  it('切换线程后上报根目录是否包含内容', async () => {
    const firstThread = createThread({ id: 'thread-with-files' });
    const emptyThread = createThread({ id: 'thread-empty' });
    const onWorkspaceAvailabilityChange = vi.fn();
    const service = createService();
    service.listDirectory.mockImplementation(async (threadId: string) => createDirectory({
      threadId,
      nodes: threadId === firstThread.id ? [fileNode('README.md', 'markdown')] : []
    }));

    const view = render(
      <FileWorkspaceView
        selectedThread={firstThread}
        workspaceFileService={service}
        onWorkspaceAvailabilityChange={onWorkspaceAvailabilityChange}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(onWorkspaceAvailabilityChange).toHaveBeenCalledWith(firstThread.id, true));

    view.rerender(
      <FileWorkspaceView
        selectedThread={emptyThread}
        workspaceFileService={service}
        onWorkspaceAvailabilityChange={onWorkspaceAvailabilityChange}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(onWorkspaceAvailabilityChange).toHaveBeenCalledWith(emptyThread.id, false));
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    expect(service.listDirectory).toHaveBeenCalledWith(thread.id, '');
    await waitFor(() => expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'README.md'));
    await waitFor(() => expect(service.openText).toHaveBeenCalledWith(thread.id, 'README.md'));
    expect(await screen.findAllByText('README.md')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: '预览' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox', { name: 'README.md 编辑器' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`opencreator.file-workspace.recent.${workspaceKey(thread.canonicalCwd)}`)).toBe('README.md');
  });

  it('优先打开外部传入的 selectedPath', async () => {
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'README.md',
          nodes: [fileNode('README.md', 'markdown'), fileNode('docs/generated.md', 'markdown')]
        })
      },
      metas: {
        'docs/generated.md': createMeta({
          path: 'docs/generated.md',
          name: 'generated.md',
          kind: 'markdown',
          mime: 'text/markdown'
        })
      },
      contents: {
        'docs/generated.md': '# Generated'
      }
    });

    render(
      <FileWorkspaceView
        selectedThread={thread}
        selectedPath="docs/generated.md"
        workspaceFileService={service}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'docs/generated.md'));
    expect(service.getMeta).not.toHaveBeenCalledWith(thread.id, 'README.md');
    expect(await screen.findByRole('heading', { name: 'Generated' })).toBeInTheDocument();
  });

  it('目录加载期间 selectedPath 更新时打开最新目标文件', async () => {
    const thread = createThread();
    let resolveDirectory: ((directory: WorkspaceDirectoryResponse) => void) | undefined;
    const directoryPromise = new Promise<WorkspaceDirectoryResponse>((resolve) => {
      resolveDirectory = resolve;
    });
    const service = createService({
      metas: {
        'xiaodoujia-apple-aso-audit.html': createMeta({
          path: 'xiaodoujia-apple-aso-audit.html',
          name: 'xiaodoujia-apple-aso-audit.html',
          kind: 'html',
          mime: 'text/html'
        })
      },
      contents: {
        'xiaodoujia-apple-aso-audit.html': '<h1>ASO Audit</h1>'
      }
    });
    service.listDirectory.mockImplementation(async () => directoryPromise);

    const view = render(
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />
    );
    view.rerender(
      <FileWorkspaceView
        selectedThread={thread}
        selectedPath="xiaodoujia-apple-aso-audit.html"
        workspaceFileService={service}
        onClose={vi.fn()}
      />
    );

    resolveDirectory?.(createDirectory({
      suggestedOpenPath: 'README.md',
      nodes: [
        fileNode('README.md', 'markdown'),
        fileNode('xiaodoujia-apple-aso-audit.html', 'html')
      ]
    }));

    expect(await screen.findByTitle('xiaodoujia-apple-aso-audit.html HTML 预览')).toBeInTheDocument();
    expect(service.getMeta).not.toHaveBeenCalledWith(thread.id, 'README.md');
  });

  it('外部路径前缀不一致时使用文件树中的真实路径打开文件', async () => {
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          nodes: [fileNode('xiaodoujia-apple-aso-audit.html', 'html')]
        })
      },
      metas: {
        'xiaodoujia-apple-aso-audit.html': createMeta({
          path: 'xiaodoujia-apple-aso-audit.html',
          name: 'xiaodoujia-apple-aso-audit.html',
          kind: 'html',
          mime: 'text/html'
        })
      },
      contents: {
        'xiaodoujia-apple-aso-audit.html': '<h1>ASO Audit</h1>'
      }
    });

    render(
      <FileWorkspaceView
        selectedThread={thread}
        selectedPath="/private/runtime/another-root/xiaodoujia-apple-aso-audit.html"
        workspaceFileService={service}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByTitle('xiaodoujia-apple-aso-audit.html HTML 预览')).toBeInTheDocument();
    expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'xiaodoujia-apple-aso-audit.html');
    expect(service.getMeta).not.toHaveBeenCalledWith(
      thread.id,
      '/private/runtime/another-root/xiaodoujia-apple-aso-audit.html'
    );
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    await expandFileTree(user);
    await user.click(await screen.findByRole('treeitem', { name: 'docs' }));

    expect(service.listDirectory).toHaveBeenCalledWith(thread.id, 'docs');
    expect(await screen.findByRole('treeitem', { name: 'guide.md' })).toBeInTheDocument();
  });

  it('选择文件更新 selectedPath 时保留已经展开的目录', async () => {
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
      },
      metas: {
        'docs/guide.md': createMeta({
          path: 'docs/guide.md',
          name: 'guide.md',
          kind: 'markdown',
          mime: 'text/markdown'
        })
      },
      contents: {
        'docs/guide.md': '# Guide'
      }
    });

    function ControlledWorkspace() {
      const [selectedPath, setSelectedPath] = useState<string>();
      return (
        <FileWorkspaceView
          selectedThread={thread}
          selectedPath={selectedPath}
          workspaceFileService={service}
          onSelectPath={setSelectedPath}
          onClose={vi.fn()}
        />
      );
    }

    render(<ControlledWorkspace />);
    await expandFileTree(user);
    const docs = await screen.findByRole('treeitem', { name: 'docs' });
    await user.click(docs);
    await user.click(await screen.findByRole('treeitem', { name: 'guide.md' }));

    expect(await screen.findByRole('heading', { name: 'Guide' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'docs' })).toHaveAttribute('aria-expanded', 'true');
    expect(service.listDirectory).toHaveBeenCalledTimes(2);
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    await expandFileTree(user);
    await user.click(await screen.findByRole('treeitem', { name: 'notes.txt' }));

    expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'notes.txt');
    expect(service.openText).toHaveBeenCalledWith(thread.id, 'notes.txt');
    expect(await screen.findByText('hello notes')).toBeInTheDocument();
  });

  it('回到窗口时检测版本并自动刷新未修改的当前文件', async () => {
    const thread = createThread();
    const metas = {
      'notes.txt': createMeta({
        path: 'notes.txt',
        name: 'notes.txt',
        kind: 'text',
        mime: 'text/plain',
        versionToken: 'v1'
      })
    };
    const contents = { 'notes.txt': '旧内容' };
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'notes.txt',
          nodes: [fileNode('notes.txt', 'text')]
        })
      },
      metas,
      contents
    });

    render(
      <FileWorkspaceView
        selectedThread={thread}
        workspaceFileService={service}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('旧内容')).toBeInTheDocument();
    const textCallsBeforeRefresh = service.openText.mock.calls.length;
    metas['notes.txt'] = createMeta({
      path: 'notes.txt',
      name: 'notes.txt',
      kind: 'text',
      mime: 'text/plain',
      versionToken: 'v2'
    });
    contents['notes.txt'] = '新内容';

    fireEvent.focus(window);

    await waitFor(() => expect(service.openText.mock.calls.length).toBe(textCallsBeforeRefresh + 1));
    expect(await screen.findByText('新内容')).toBeInTheDocument();
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    await expandFileTree(user);
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
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />
    );

    await screen.findAllByText('README.md');
    await userEvent.setup().click(screen.getByRole('button', { name: '展开目录树' }));

    const body = container.querySelector('.file-workspace-body');
    if (!(body instanceof HTMLElement)) throw new Error('Expected file workspace body');
    const editor = body.querySelector('.file-workspace-editor');
    const tree = body.querySelector('.file-tree-panel');

    expect(body.firstElementChild).toBe(editor);
    expect(body.lastElementChild).toBe(tree);
  });

  it('使用单层文件工具栏，避免重复的路径栏和编辑器标题栏', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'scripts/notes.md',
          nodes: [directoryNode('scripts', 0), fileNode('scripts/notes.md', 'markdown', 1)]
        })
      },
      metas: {
        'scripts/notes.md': createMeta({
          path: 'scripts/notes.md',
          name: 'notes.md',
          kind: 'markdown',
          mime: 'text/markdown'
        })
      },
      contents: {
        'scripts/notes.md': '# notes'
      }
    });

    const { container } = render(
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />
    );

    expect(await screen.findByRole('heading', { name: 'notes' })).toBeInTheDocument();

    const toolbar = container.querySelector('.file-top-bar');
    if (!(toolbar instanceof HTMLElement)) throw new Error('Expected compact file toolbar');

    const titleRow = toolbar.querySelector('.file-top-bar-title-row');
    if (!(titleRow instanceof HTMLElement)) throw new Error('Expected file toolbar title row');
    const title = toolbar.querySelector('.file-top-bar-title');
    if (!(title instanceof HTMLElement)) throw new Error('Expected file toolbar title');
    expect(within(title).getByText('notes.md')).toBeInTheDocument();
    expect(within(titleRow).getByRole('button', { name: '关闭文件工作区' })).toBeEnabled();

    const controlRow = toolbar.querySelector('.file-top-bar-control-row');
    if (!(controlRow instanceof HTMLElement)) throw new Error('Expected file toolbar control row');
    const pathNav = within(toolbar).getByLabelText('文件路径');
    expect(pathNav).toHaveTextContent('repo/scripts/notes.md');
    expect(within(pathNav).queryByRole('button', { name: '复制路径' })).not.toBeInTheDocument();
    const pathGroup = toolbar.querySelector('.file-top-bar-path-group');
    if (!(pathGroup instanceof HTMLElement)) throw new Error('Expected file toolbar path group');
    expect(within(pathGroup).getByRole('button', { name: '打开文件' })).toBeEnabled();
    expect(within(controlRow).getByRole('button', { name: '预览' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(controlRow).getByRole('button', { name: '编辑' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(controlRow).getByRole('button', { name: '保存' })).toBeDisabled();
    expect(within(controlRow).getByRole('button', { name: '展开目录树' })).toBeEnabled();

    const actions = toolbar.querySelector('.file-top-bar-actions');
    if (!(actions instanceof HTMLElement)) throw new Error('Expected file toolbar actions');
    expect(within(actions).queryByRole('button', { name: '复制路径' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: '打开文件' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('button', { name: '关闭文件工作区' })).not.toBeInTheDocument();

    const modeButtons = within(toolbar).getAllByRole('button')
      .filter(button => button.textContent === '预览' || button.textContent === '编辑');
    expect(modeButtons.map(button => button.textContent)).toEqual(['预览', '编辑']);

    await user.click(within(toolbar).getByRole('button', { name: '编辑' }));

    expect(within(toolbar).getByRole('button', { name: '编辑' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByRole('button', { name: '预览' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('textbox', { name: 'scripts/notes.md 编辑器' })).toBeInTheDocument();

    expect(container.querySelector('.file-path-bar')).not.toBeInTheDocument();
    expect(container.querySelector('.file-editor-toolbar')).not.toBeInTheDocument();
  });

  it('在顶部工具栏预览 HTML 时渲染实际页面', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const html = '<!doctype html><html><body><main>商务封面</main></body></html>';
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'business-cover.html',
          nodes: [fileNode('business-cover.html', 'html')]
        })
      },
      metas: {
        'business-cover.html': createMeta({
          path: 'business-cover.html',
          name: 'business-cover.html',
          kind: 'html',
          mime: 'text/html; charset=utf-8'
        })
      },
      contents: {
        'business-cover.html': html
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    const preview = await screen.findByTitle('business-cover.html HTML 预览');
    expect(screen.getByRole('button', { name: '预览' })).toHaveAttribute('aria-pressed', 'true');
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    expect(screen.queryByRole('textbox', { name: 'business-cover.html 编辑器' })).not.toBeInTheDocument();
  });

  it('可以收起和展开右侧目录树，编辑区保持可用', async () => {
    const user = userEvent.setup();
    const thread = createThread();
    const service = createService({
      directories: {
        '': createDirectory({
          suggestedOpenPath: 'README.md',
          nodes: [fileNode('README.md', 'markdown')]
        })
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    expect(await screen.findAllByText('README.md')).not.toHaveLength(0);
    expect(screen.queryByLabelText('项目文件树')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator', { name: '调整编辑区和目录树宽度' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '展开目录树' }));

    expect(screen.getByLabelText('项目文件树')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整编辑区和目录树宽度' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收起目录树' }));
    expect(screen.queryByLabelText('项目文件树')).not.toBeInTheDocument();
  });

  it('编辑区和目录树之间的分隔条可以拖动调整目录树宽度', async () => {
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
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />
    );

    await screen.findAllByText('README.md');
    await userEvent.setup().click(screen.getByRole('button', { name: '展开目录树' }));

    const body = container.querySelector('.file-workspace-body');
    if (!(body instanceof HTMLElement)) throw new Error('Expected file workspace body');
    vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 900,
      bottom: 800,
      width: 900,
      height: 800,
      toJSON: () => undefined
    });

    const separator = screen.getByRole('separator', { name: '调整编辑区和目录树宽度' });
    fireEvent.mouseDown(separator, { button: 0, clientX: 620 });
    expect(document.querySelector('.pane-resize-shield')).not.toBeNull();
    fireEvent.mouseMove(window, { clientX: 560 });
    fireEvent.mouseUp(window);
    expect(document.querySelector('.pane-resize-shield')).toBeNull();

    expect(body).toHaveStyle({ '--file-tree-width': '340px' });
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
      <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />
    );

    await expandFileTree(user);
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    const editor = await openFileEditor(user, 'notes.txt');
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    const editor = await openFileEditor(user, 'notes.txt');
    await user.click(editor);
    await user.keyboard('A');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('button', { name: '重新加载' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '覆盖保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('编辑后切换文件时，取消 confirm 不切换，确认后才切换', async () => {
    const user = userEvent.setup();
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

    render(
      <ConfirmDialogProvider>
        <FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />
      </ConfirmDialogProvider>
    );

    const editor = await openFileEditor(user, 'notes.txt');
    await user.click(editor);
    await user.keyboard('A');
    await expandFileTree(user);

    await user.click(screen.getByRole('treeitem', { name: 'guide.md' }));
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' }))
      .toHaveTextContent('切换文件后，当前文件中尚未保存的修改将丢失。');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(service.getMeta).not.toHaveBeenCalledWith(thread.id, 'guide.md');
    expect(screen.getByRole('textbox', { name: 'notes.txt 编辑器' })).toBeInTheDocument();

    await user.click(screen.getByRole('treeitem', { name: 'guide.md' }));
    await user.click(screen.getByRole('button', { name: '放弃并切换' }));

    await waitFor(() => expect(service.getMeta).toHaveBeenCalledWith(thread.id, 'guide.md'));
    expect(await screen.findByRole('heading', { name: 'guide' })).toBeInTheDocument();
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    const editor = await openFileEditor(user, 'notes.txt');
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

    await user.click(await openFileEditor(user, 'notes.txt'));
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

    await user.click(await openFileEditor(user, 'notes.txt'));
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

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    expect(await screen.findByText('当前会话为只读模式，不能保存文件')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '编辑' }));
    expect(await screen.findByRole('textbox', { name: 'notes.txt 编辑器' })).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('点击打开文件时以 file 模式在系统文件管理器中定位当前文件', async () => {
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
        'notes.txt': createMeta({ path: 'notes.txt', name: 'notes.txt', kind: 'text', mime: 'text/plain' })
      },
      contents: {
        'notes.txt': 'draft'
      }
    });

    render(<FileWorkspaceView selectedThread={thread} workspaceFileService={service} onClose={vi.fn()} />);

    await screen.findByText('draft');
    await user.click(screen.getByRole('button', { name: '打开文件' }));

    await waitFor(() => {
      expect(service.reveal).toHaveBeenCalledWith({
        threadId: thread.id,
        path: 'notes.txt',
        mode: 'file'
      });
    });
  });
});

async function expandFileTree(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.queryByRole('button', { name: '展开目录树' });
  if (button !== null) await user.click(button);
}

async function openFileEditor(
  user: ReturnType<typeof userEvent.setup>,
  fileName: string
): Promise<HTMLElement> {
  const existing = screen.queryByRole('textbox', { name: `${fileName} 编辑器` });
  if (existing !== null) return existing;
  await user.click(await screen.findByRole('button', { name: '编辑' }));
  return await screen.findByRole('textbox', { name: `${fileName} 编辑器` });
}

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
    projectId: 'project-one',
    origin: 'opencreator_created',
    codexThreadId: null,
    cwd: '/Users/test/repo',
    canonicalCwd: '/Users/test/repo',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'danger-full-access',
    status: 'active',
    purpose: 'conversation',
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
