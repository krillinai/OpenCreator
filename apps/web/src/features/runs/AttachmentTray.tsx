import { LoaderCircle, RotateCcw, X } from 'lucide-react';

export type AttachmentTrayItem = {
  localId: string;
  fileName: string;
  mime: string;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
};

export function AttachmentTray(props: {
  items: AttachmentTrayItem[];
  onRemove(localId: string): void;
  onRetry(localId: string): void;
}) {
  if (props.items.length === 0) return null;

  return (
    <div className="composer-attachment-tray" aria-label="待发送附件">
      {props.items.map(item => (
        <div
          key={item.localId}
          className={`composer-attachment composer-attachment-${item.status}`}
        >
          <img src={item.previewUrl} alt={item.fileName} />
          <div className="composer-attachment-meta">
            <strong>{item.fileName}</strong>
            {item.status === 'uploading' ? (
              <span role="status">
                <LoaderCircle className="spin" aria-hidden="true" size={13} />
                正在上传 {item.fileName}
              </span>
            ) : null}
            {item.status === 'error' ? (
              <span className="composer-attachment-error" role="alert">
                {item.error ?? '上传失败'}
              </span>
            ) : null}
          </div>
          <div className="composer-attachment-actions">
            {item.status === 'error' ? (
              <button
                type="button"
                aria-label={`重试上传 ${item.fileName}`}
                title="重试上传"
                onClick={() => props.onRetry(item.localId)}
              >
                <RotateCcw aria-hidden="true" size={14} />
              </button>
            ) : null}
            <button
              type="button"
              aria-label={`移除附件 ${item.fileName}`}
              title="移除附件"
              onClick={() => props.onRemove(item.localId)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
