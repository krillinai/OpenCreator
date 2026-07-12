import { Check, RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { MarkdownRenderer } from '../../components/markdown/MarkdownRenderer.js';

type DetailPanelProps = {
  mode: 'file' | 'change' | 'run';
  title: string;
  subtitle?: string;
  content: ReactNode;
  onClose(): void;
  onApprove?(): void;
  onRevert?(): void;
};

function fileExtension(title: string, subtitle?: string): string {
  const path = subtitle ?? title;
  const filename = path.split('/').pop() ?? path;
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function DetailContent(props: Pick<DetailPanelProps, 'mode' | 'title' | 'subtitle' | 'content'>) {
  if (props.mode !== 'file') {
    return typeof props.content === 'string' ? <pre>{props.content}</pre> : props.content;
  }

  const content = typeof props.content === 'string' ? props.content : '';
  const ext = fileExtension(props.title, props.subtitle);

  if (ext === 'md' || ext === 'markdown') {
    return <MarkdownRenderer text={content} variant="document" />;
  }

  if (ext === 'json') {
    return (
      <pre className="detail-code-block">
        <code>{formatJson(content)}</code>
      </pre>
    );
  }

  return (
    <pre className={ext === 'html' || ext === 'htm' ? 'detail-code-block detail-html-source' : 'detail-code-block'}>
      <code>{content}</code>
    </pre>
  );
}

export function DetailPanel(props: DetailPanelProps) {
  return (
    <aside className={`detail-panel detail-${props.mode}`} aria-labelledby="detail-panel-title">
      <header className="detail-header">
        <div className="detail-title">
          <h2 id="detail-panel-title">{props.title}</h2>
          {props.subtitle ? <span>{props.subtitle}</span> : null}
        </div>
        <button className="icon-button" type="button" aria-label="关闭详情" onClick={props.onClose}>
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="detail-content" role="region" aria-label="详情内容">
        <DetailContent mode={props.mode} title={props.title} subtitle={props.subtitle} content={props.content} />
      </div>

      {props.mode === 'change' ? (
        <footer className="detail-actions">
          <button className="toolbar-button" type="button" onClick={props.onRevert} disabled={!props.onRevert}>
            <RotateCcw aria-hidden="true" size={16} />
            <span>撤销</span>
          </button>
          <button className="toolbar-button primary" type="button" onClick={props.onApprove} disabled={!props.onApprove}>
            <Check aria-hidden="true" size={16} />
            <span>审核</span>
          </button>
        </footer>
      ) : null}
    </aside>
  );
}
