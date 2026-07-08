import type { WorkspaceFileMeta } from '@clawee/protocol';
import { FileCode2, FileImage, FileText, Image as ImageIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MarkdownRenderer } from '../../components/markdown/MarkdownRenderer.js';
import { TextFileEditor } from './TextFileEditor.js';

export type FileEditorPaneProps = {
  meta?: WorkspaceFileMeta;
  content?: string;
  objectUrl?: string;
  dirty?: boolean;
  saving?: boolean;
  loadError?: string;
  saveError?: string;
  onChange?(value: string): void;
  onSave?(): void;
};

type PaneMode = 'edit' | 'preview';

export function FileEditorPane(props: FileEditorPaneProps) {
  const meta = props.meta;
  const [mode, setMode] = useState<PaneMode>('edit');
  const errors = [props.loadError, props.saveError].filter((error): error is string => error !== undefined);

  useEffect(() => {
    setMode(defaultModeForMeta(meta));
  }, [meta?.path, meta?.kind]);

  if (!meta) {
    return (
      <section className="file-editor-pane" aria-label="文件编辑区">
        <div className="file-preview file-preview-empty">
          <p>选择一个文件</p>
        </div>
      </section>
    );
  }

  const editable = meta.editable;
  const previewable = isPreviewable(meta);
  const currentMode = editable ? mode : 'preview';

  return (
    <section className="file-editor-pane" aria-label="文件编辑区">
      <header className="file-editor-toolbar">
        <div className="file-editor-toolbar-main">
          <div className="file-editor-toolbar-title">
            <strong>{meta.name}</strong>
            <span>{meta.path}</span>
          </div>
          {props.dirty ? <span className="dirty-indicator">未保存</span> : null}
        </div>

        <div className="file-editor-toolbar-actions">
          {editable && previewable ? (
            <div className="file-editor-mode-toggle" aria-label="文件视图模式">
              <button
                type="button"
                aria-pressed={currentMode === 'edit'}
                onClick={() => setMode('edit')}
              >
                编辑
              </button>
              <button
                type="button"
                aria-pressed={currentMode === 'preview'}
                onClick={() => setMode('preview')}
              >
                预览
              </button>
            </div>
          ) : null}

          {editable ? (
            <button
              className="editor-save-button"
              type="button"
              disabled={props.saving || !props.dirty || meta.readonly}
              onClick={() => props.onSave?.()}
            >
              保存
            </button>
          ) : null}
        </div>
      </header>

      {errors.length === 0 ? null : (
        <div className="file-error-bar" role="status">
          {errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      )}

      {renderContent({
        meta,
        mode: currentMode,
        content: props.content ?? '',
        objectUrl: props.objectUrl,
        onChange: props.onChange,
        onSave: props.onSave
      })}
    </section>
  );
}

type RenderContentArgs = {
  meta: WorkspaceFileMeta;
  mode: PaneMode;
  content: string;
  objectUrl?: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
};

function renderContent(args: RenderContentArgs) {
  if (isImagePreview(args.meta)) {
    return (
      <div className="file-preview file-preview-media">
        {args.objectUrl ? <img src={args.objectUrl} alt={args.meta.name} /> : <p>图片预览不可用</p>}
      </div>
    );
  }

  if (args.meta.kind === 'pdf') {
    return (
      <div className="file-preview file-preview-media">
        {args.objectUrl ? (
          <object data={args.objectUrl} type="application/pdf" title={`${args.meta.name} PDF 预览`} aria-label={`${args.meta.name} PDF 预览`} />
        ) : (
          <p>PDF 预览不可用</p>
        )}
      </div>
    );
  }

  if (isTextLike(args.meta)) {
    if (args.mode === 'preview') {
      return renderTextPreview(args.meta, args.content);
    }

    return (
      <TextFileEditor
        path={args.meta.path}
        kind={args.meta.kind}
        content={args.content}
        readonly={args.meta.readonly}
        onChange={args.onChange}
        onSave={args.onSave}
      />
    );
  }

  return renderUnsupported(args.meta);
}

function renderTextPreview(meta: WorkspaceFileMeta, content: string) {
  if (meta.kind === 'markdown') {
    return (
      <div className="file-preview">
        <MarkdownRenderer text={content} variant="document" />
      </div>
    );
  }

  if (meta.kind === 'json') {
    return <JsonPreview content={content} />;
  }

  return (
    <div className="file-preview">
      <pre>{content}</pre>
    </div>
  );
}

function JsonPreview(props: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return {
        ok: true as const,
        text: JSON.stringify(JSON.parse(props.content), null, 2)
      };
    } catch {
      return {
        ok: false as const,
        text: props.content
      };
    }
  }, [props.content]);

  return (
    <div className="file-preview">
      {parsed.ok ? null : <p className="file-preview-note">JSON 解析失败，以下保留原始内容。</p>}
      <pre>{parsed.text}</pre>
    </div>
  );
}

function renderUnsupported(meta: WorkspaceFileMeta) {
  return (
    <div className="unsupported-file-state">
      <div className="unsupported-file-state-icon" aria-hidden="true">
        {unsupportedIcon(meta)}
      </div>
      <div className="unsupported-file-state-copy">
        <strong>暂不支持预览此文件</strong>
        <span>{meta.name}</span>
        <span>{meta.mime}</span>
        <span>{formatSize(meta.size)}</span>
        <p>{meta.reason ?? '该文件当前既不可编辑，也没有可用预览。'}</p>
      </div>
    </div>
  );
}

function unsupportedIcon(meta: WorkspaceFileMeta) {
  if (meta.kind === 'image') {
    return <ImageIcon size={18} strokeWidth={2} />;
  }

  if (meta.kind === 'binary' || meta.kind === 'pdf') {
    return <FileImage size={18} strokeWidth={2} />;
  }

  if (isTextLike(meta)) {
    return <FileCode2 size={18} strokeWidth={2} />;
  }

  return <FileText size={18} strokeWidth={2} />;
}

function isTextLike(meta: WorkspaceFileMeta): boolean {
  if (meta.type !== 'file') {
    return false;
  }

  return meta.kind === 'markdown' || meta.kind === 'text' || meta.kind === 'json' || meta.kind === 'code' || meta.kind === 'html' || isSvgSource(meta);
}

function isPreviewable(meta: WorkspaceFileMeta): boolean {
  if (meta.kind === 'markdown' || meta.kind === 'json' || meta.kind === 'text' || meta.kind === 'code' || meta.kind === 'html') {
    return true;
  }

  return meta.kind === 'image' || meta.kind === 'pdf';
}

function isImagePreview(meta: WorkspaceFileMeta): boolean {
  return meta.kind === 'image' && !isSvgSource(meta);
}

function isSvgSource(meta: WorkspaceFileMeta): boolean {
  return meta.name.toLowerCase().endsWith('.svg') || meta.mime === 'image/svg+xml';
}

function defaultModeForMeta(meta?: WorkspaceFileMeta): PaneMode {
  if (!meta) {
    return 'edit';
  }

  if (!meta.editable || meta.kind === 'image' || meta.kind === 'pdf') {
    return 'preview';
  }

  return 'edit';
}

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  const kb = size / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }

  return `${(kb / 1024).toFixed(1)} MB`;
}
