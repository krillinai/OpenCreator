import { LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

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
  const { t } = useAppLanguage();
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
      <div className="composer-attachment-tray" aria-label={t('composer.attachment.tray')}>
        {props.items.map(item => (
          <div
            key={item.localId}
            className={`composer-attachment composer-attachment-${item.status}`}
          >
            <button
              className="composer-attachment-preview-trigger"
              type="button"
              aria-label={t('composer.attachment.preview', { name: item.fileName })}
              title={t('composer.attachment.view', { name: item.fileName })}
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
                aria-label={t('composer.attachment.uploadingLabel', { name: item.fileName })}
              >
                <LoaderCircle className="spin" aria-hidden="true" size={13} />
                {t('composer.attachment.uploading')}
              </span>
            ) : null}
            {item.status === 'error' ? (
              <span className="composer-attachment-status composer-attachment-error" role="alert">
                {item.error ?? t('composer.uploadFailed')}
              </span>
            ) : null}
            <div className="composer-attachment-actions">
              {item.status === 'error' ? (
                <button
                  type="button"
                  aria-label={t('composer.attachment.retryLabel', { name: item.fileName })}
                  title={t('composer.attachment.retry')}
                  onClick={() => props.onRetry(item.localId)}
                >
                  <RotateCcw aria-hidden="true" size={13} />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={t('composer.attachment.removeLabel', { name: item.fileName })}
                title={t('composer.attachment.remove')}
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
            aria-label={t('composer.attachment.preview', { name: previewItem.fileName })}
          >
            <img src={previewItem.previewUrl} alt={previewItem.fileName} />
            <button
              ref={previewCloseRef}
              type="button"
              aria-label={t('composer.attachment.closePreview')}
              title={t('composer.attachment.closePreview')}
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
