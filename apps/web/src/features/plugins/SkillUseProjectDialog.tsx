import { Check, Folder, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export type SkillMarketProjectOption = {
  id: string;
  name: string;
  cwd: string;
};

export function SkillUseProjectDialog({
  skillTitle,
  projects,
  currentProjectId,
  onClose,
  onConfirm,
}: {
  skillTitle: string;
  projects: readonly SkillMarketProjectOption[];
  currentProjectId: string;
  onClose(): void;
  onConfirm(projectId: string): void;
}) {
  const l = useLocalizedCopy();
  const initialProjectId =
    projects.find((project) => project.id === currentProjectId)?.id
    ?? projects[0]?.id
    ?? '';
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="skill-market-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-modal="true"
        aria-labelledby="skill-market-use-project-title"
        className="skill-market-use-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="skill-market-use-dialog__header">
          <div>
            <span>{skillTitle}</span>
            <h2 id="skill-market-use-project-title">{l('选择使用项目', 'Choose a project')}</h2>
          </div>
          <button
            aria-label={l('关闭项目选择', 'Close project picker')}
            className="skill-market-icon-button"
            onClick={onClose}
            ref={closeRef}
            title={l('关闭', 'Close')}
            type="button"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="skill-market-use-project-list" role="radiogroup" aria-label={l('使用项目', 'Project to use')}>
          {projects.map((project) => {
            const selected = project.id === selectedProjectId;
            return (
              <button
                aria-checked={selected}
                className={selected ? 'is-selected' : ''}
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                role="radio"
                type="button"
              >
                <Folder size={17} aria-hidden="true" />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.cwd}</small>
                </span>
                <Check className="skill-market-use-project-list__check" size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <footer className="skill-market-use-dialog__footer">
          <button
            className="skill-market-use-dialog__cancel"
            onClick={onClose}
            type="button"
          >
            {l('取消', 'Cancel')}
          </button>
          <button
            className="skill-market-action-button skill-market-action-button--use"
            disabled={selectedProject === undefined}
            onClick={() => {
              if (selectedProject !== undefined) onConfirm(selectedProject.id);
            }}
            title={
              selectedProject === undefined
                ? undefined
                : `${l('在', 'Use in')} ${selectedProject.name}`
            }
            type="button"
          >
            <span>{l('在', 'Use in')} {selectedProject?.name ?? l('所选项目', 'selected project')}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );
}
