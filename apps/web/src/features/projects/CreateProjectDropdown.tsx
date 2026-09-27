import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderPlus } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { creatorProjectTypes, type CreatorProjectType } from './project-types.js';
import './CreateProjectDropdown.css';

export function CreateProjectDropdown(props: {
  align?: 'start' | 'end';
  onCreate(projectType: CreatorProjectType): boolean | void | Promise<boolean | void>;
}) {
  const l = useLocalizedCopy();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [open]);

  const createProject = async (projectType: CreatorProjectType) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await props.onCreate(projectType);
      if (created !== false) setOpen(false);
    } catch {
      setOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="create-project-dropdown"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="create-project-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={submitting}
        onClick={() => setOpen(current => !current)}
      >
        <FolderPlus aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>{l('新建项目', 'New Project')}</span>
        <ChevronDown
          aria-hidden="true"
          size={15}
          strokeWidth={1.8}
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {open ? (
        <div
          className={props.align === 'end'
            ? 'create-project-menu create-project-menu--end'
            : 'create-project-menu'}
          role="menu"
          aria-label={l('项目类型', 'Project type')}
        >
          {creatorProjectTypes.map(projectType => (
            <button
              key={projectType.workspace}
              type="button"
              className="create-project-option"
              role="menuitem"
              disabled={submitting}
              onClick={() => void createProject(projectType)}
            >
              <strong>{l(projectType.title, projectType.englishTitle)}</strong>
              <small>{l(projectType.description, projectType.englishDescription)}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
