import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

export function CreateProjectDialog(props: {
  open: boolean;
  error?: string;
  onClose(): void;
  onCreate(name: string): boolean | void | Promise<boolean | void>;
}) {
  const { t } = useAppLanguage();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setName('');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [props.open]);

  if (!props.open) return null;

  const createProject = async () => {
    const normalizedName = name.trim();
    if (normalizedName.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const created = await props.onCreate(normalizedName);
      if (created !== false) props.onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="composer-project-name-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !submitting) props.onClose();
      }}
    >
      <section
        className="composer-project-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('projectDialog.title')}
      >
        <header>
          <strong>{t('projectDialog.title')}</strong>
          <span>{t('projectDialog.description')}</span>
        </header>
        {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
        <label>
          <span>{t('projectDialog.folderName')}</span>
          <input
            ref={inputRef}
            type="text"
            aria-label={t('projectDialog.folderName')}
            maxLength={80}
            value={name}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
            onChange={event => setName(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && !submitting) {
                event.preventDefault();
                props.onClose();
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                void createProject();
              }
            }}
          />
        </label>
        <footer>
          <button
            type="button"
            className="button-secondary"
            disabled={submitting}
            onClick={props.onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={submitting || name.trim().length === 0}
            onClick={() => void createProject()}
          >
            {submitting ? t('projectDialog.creating') : t('projectDialog.create')}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
