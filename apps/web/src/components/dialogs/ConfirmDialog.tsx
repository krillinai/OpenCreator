import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  className?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { t } = useAppLanguage();
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !props.busy) props.onCancel();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [props.busy, props.onCancel, props.open]);

  if (!props.open) return null;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !props.busy) props.onCancel();
      }}
    >
      <section
        className={[
          'confirm-dialog',
          props.className
        ].filter(Boolean).join(' ')}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header>
          <h2 id={titleId}>{props.title}</h2>
          <p id={descriptionId}>{props.description}</p>
        </header>
        <footer>
          <button
            ref={cancelButtonRef}
            type="button"
            className="button-secondary"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={props.destructive ? 'confirm-dialog-danger' : 'button-primary'}
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {props.busy ? t('common.processing') : props.confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
