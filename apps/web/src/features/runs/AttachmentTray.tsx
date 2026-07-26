import { LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  const [previewLocalId, setPreviewLocalId] = useState<string>();
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const previewItem = props.items.find(item => item.localId === previewLocalId);
  const closePreview = useCallback(() => {
    const trigger = previewTriggerRef.current;
    setPreviewLocalId(undefined);
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  useEffect(() => {
    if (previewItem === undefined) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePreview();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        previewCloseRef.current?.focus();
      }
    };

    previewCloseRef.current?.focus();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePreview, previewItem?.localId]);

  if (props.items.length === 0) return null;

  return (
    <>
      <div className="composer-attachment-tray" aria-label="待发送附件">
        {props.items.map(item => (
          <div
            key={item.localId}
            className={`composer-attachment composer-attachment-${item.status}`}
          >
            <button
              className="composer-attachment-preview-trigger"
              type="button"
              aria-label={`预览附件 ${item.fileName}`}
              title={`查看大图：${item.fileName}`}
              onClick={(event) => {
                previewTriggerRef.current = event.currentTarget;
                setPreviewLocalId(item.localId);
              }}
            >
              <img src={item.previewUrl} alt={item.fileName} />
            </button>
            {item.status === 'uploading' ? (
              <span
                className="composer-attachment-status"
                role="status"
                aria-label={`正在上传 ${item.fileName}`}
              >
                <LoaderCircle className="spin" aria-hidden="true" size={13} />
                上传中
              </span>
            ) : null}
            {item.status === 'error' ? (
              <span className="composer-attachment-status composer-attachment-error" role="alert">
                {item.error ?? '上传失败'}
              </span>
            ) : null}
            <div className="composer-attachment-actions">
              {item.status === 'error' ? (
                <button
                  type="button"
                  aria-label={`重试上传 ${item.fileName}`}
                  title="重试上传"
                  onClick={() => props.onRetry(item.localId)}
                >
                  <RotateCcw aria-hidden="true" size={13} />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`移除附件 ${item.fileName}`}
                title="移除附件"
                onClick={() => props.onRemove(item.localId)}
              >
                <X aria-hidden="true" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {previewItem === undefined ? null : createPortal(
        <div
          className="attachment-image-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <section
            className="attachment-image-preview"
            role="dialog"
            aria-modal="true"
            aria-label={`预览附件 ${previewItem.fileName}`}
          >
            <img src={previewItem.previewUrl} alt={previewItem.fileName} />
            <button
              ref={previewCloseRef}
              type="button"
              aria-label="关闭图片预览"
              title="关闭图片预览"
              onClick={closePreview}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
