import type { WorkspaceFileMeta } from '@opencreator/protocol';
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

  it('HTML 默认在隔离 iframe 中渲染页面并移除用户脚本', async () => {
    const html = '<!doctype html><html><body><main>商务封面</main><script>document.body.dataset.ready = "true"</script></body></html>';

    const { container } = render(
      <FileEditorPane
        meta={createMeta({
          name: 'business-cover.html',
          path: 'business-cover.html',
          kind: 'html',
          mime: 'text/html; charset=utf-8'
        })}
        content={html}
      />
    );

    const preview = await screen.findByTitle('business-cover.html HTML 预览');
    expect(screen.getByRole('button', { name: '预览' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox', { name: 'business-cover.html 编辑器' })).not.toBeInTheDocument();
    expect(preview).toHaveAttribute('sandbox', 'allow-scripts');
    expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(preview.getAttribute('srcdoc')).not.toContain('document.body.dataset.ready');
    expect(preview.getAttribute('srcdoc')).toContain('html-preview-runtime-2026-07-28.js');
    expect(container.querySelector('.file-preview-html pre')).not.toBeInTheDocument();
  });

  it('JSON 预览会格式化；无效 JSON 显示解析失败但保留原文', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FileEditorPane
        meta={createMeta({ name: 'package.json', path: 'package.json', kind: 'json', mime: 'application/json' })}
        content={'{"name":"opencreator","version":1}'}
      />
    );

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(document.querySelector('.file-preview pre')?.textContent).toBe('{\n  "name": "opencreator",\n  "version": 1\n}');

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

  it('实际编辑后按用户输入触发 onChange(value)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text' })}
        content="草稿"
        onChange={onChange}
      />
    );

    const editor = screen.getByRole('textbox', { name: 'notes.txt 编辑器' });
    await user.click(editor);
    await user.keyboard('A');

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall?.[0]).toContain('A');
  });

  it('外部 rerender 更新 content 不触发 onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text' })}
        content="初始内容"
        onChange={onChange}
      />
    );

    rerender(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text' })}
        content="外部同步内容"
        onChange={onChange}
      />
    );

    expect(onChange).not.toHaveBeenCalled();
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

  it('readonly=true 时 Mod-s 不会保存', () => {
    const onSave = vi.fn();

    render(
      <FileEditorPane
        meta={createMeta({ name: 'notes.txt', path: 'notes.txt', kind: 'text', readonly: true })}
        content="只读草稿"
        dirty={true}
        onSave={onSave}
      />
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'notes.txt 编辑器' }), {
      key: 's',
      code: 'KeyS',
      ctrlKey: true
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('SVG 文件支持编辑和源码预览，不渲染图片', async () => {
    const user = userEvent.setup();
    const svgSource = '<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>';

    render(
      <FileEditorPane
        meta={createMeta({
          name: 'logo.svg',
          path: 'logo.svg',
          kind: 'image',
          mime: 'image/svg+xml',
          editable: true,
          previewable: true
        })}
        content={svgSource}
        objectUrl="blob:logo-svg"
      />
    );

    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'logo.svg 编辑器' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.queryByRole('img', { name: 'logo.svg' })).not.toBeInTheDocument();
    expect(document.querySelector('.file-preview pre')?.textContent).toBe(svgSource);
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
