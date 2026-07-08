import type { WorkspaceFileMeta } from '@clawee/protocol';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEditorPane } from './FileEditorPane.js';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

describe('FileEditorPane', () => {
  it('meta 为空时显示空态', () => {
    render(<FileEditorPane />);

    expect(screen.getByText('选择一个文件')).toBeInTheDocument();
  });

  it('markdown 默认源码编辑，可切换到预览', async () => {
    const user = userEvent.setup();

    render(
      <FileEditorPane
        meta={createMeta({ name: 'README.md', path: 'README.md', kind: 'markdown', mime: 'text/markdown' })}
        content={'# 标题\n\n**正文**'}
      />
    );

    expect(screen.getByRole('button', { name: '编辑' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'README.md 编辑器' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '标题' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument();
    expect(screen.getByText('正文')).toBeInTheDocument();
  });

  it('JSON 预览会格式化；无效 JSON 显示解析失败但保留原文', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FileEditorPane
        meta={createMeta({ name: 'package.json', path: 'package.json', kind: 'json', mime: 'application/json' })}
        content={'{"name":"clawee","version":1}'}
      />
    );

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(document.querySelector('.file-preview pre')?.textContent).toBe('{\n  "name": "clawee",\n  "version": 1\n}');

    rerender(
      <FileEditorPane
        meta={createMeta({ name: 'broken.json', path: 'broken.json', kind: 'json', mime: 'application/json' })}
        content={'{"name": }'}
      />
    );

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.getByText('JSON 解析失败，以下保留原始内容。')).toBeInTheDocument();
    expect(screen.getByText('{"name": }')).toBeInTheDocument();
  });

  it('readonly=true 时编辑器不可编辑，保存按钮禁用', () => {
    render(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text', readonly: true })}
        content="只读内容"
        dirty={true}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole('textbox', { name: 'notes.txt 编辑器' })).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('dirty 时保存按钮可用，点击触发 onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text' })}
        content="草稿"
        dirty={true}
        onSave={onSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('image 使用 objectUrl 渲染 img', () => {
    render(
      <FileEditorPane
        meta={createMeta({ name: 'preview.png', path: 'preview.png', kind: 'image', mime: 'image/png', editable: false })}
        objectUrl="blob:preview-image"
      />
    );

    const image = screen.getByRole('img', { name: 'preview.png' });
    expect(image).toHaveAttribute('src', 'blob:preview-image');
  });

  it('PDF 使用 objectUrl 渲染 object', () => {
    render(
      <FileEditorPane
        meta={createMeta({ name: 'spec.pdf', path: 'spec.pdf', kind: 'pdf', mime: 'application/pdf', editable: false })}
        objectUrl="blob:preview-pdf"
      />
    );

    const objectNode = screen.getByTitle('spec.pdf PDF 预览');
    expect(objectNode).toHaveAttribute('data', 'blob:preview-pdf');
    expect(objectNode).toHaveAttribute('type', 'application/pdf');
  });

  it('unsupported 文件显示文件名、MIME、大小、原因', () => {
    render(
      <FileEditorPane
        meta={createMeta({
          name: 'archive.bin',
          path: 'archive.bin',
          kind: 'binary',
          mime: 'application/octet-stream',
          size: 4096,
          previewable: false,
          editable: false,
          reason: '暂不支持预览此二进制文件'
        })}
      />
    );

    const panel = screen.getByText('暂不支持预览此文件').closest('.unsupported-file-state');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText('archive.bin')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText('application/octet-stream')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText('4 KB')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText('暂不支持预览此二进制文件')).toBeInTheDocument();
  });

  it('Mod-s 触发保存', () => {
    const onSave = vi.fn();

    render(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text' })}
        content="草稿"
        dirty={true}
        onSave={onSave}
      />
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'notes.txt 编辑器' }), {
      key: 's',
      code: 'KeyS',
      ctrlKey: true
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

function createMeta(overrides: Partial<WorkspaceFileMeta> = {}): WorkspaceFileMeta {
  return {
    path: overrides.path ?? 'notes.txt',
    name: overrides.name ?? 'notes.txt',
    type: 'file',
    kind: overrides.kind ?? 'text',
    mime: overrides.mime ?? 'text/plain',
    size: overrides.size ?? 23,
    mtimeMs: overrides.mtimeMs ?? 1,
    versionToken: overrides.versionToken ?? 'v1',
    previewable: overrides.previewable ?? true,
    editable: overrides.editable ?? true,
    readonly: overrides.readonly ?? false,
    reason: overrides.reason
  };
}
