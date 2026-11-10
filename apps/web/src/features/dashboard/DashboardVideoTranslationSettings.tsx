import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, SlidersHorizontal } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './ImageGenerationSettings.css';
import './DashboardGenerationComposer.css';

export default function DashboardVideoTranslationSettings(props: {
  summary: string[];
  disabled?: boolean;
  label?: string;
  children: ReactNode;
}) {
  const l = useLocalizedCopy();
  const label = props.label ?? l('翻译设置', 'Translation settings');
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    above: boolean;
  }>();

  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const below = viewportBottom - rect.bottom - 12;
      const above = rect.top - viewportTop - 12;
      const opensAbove = above > 80 || (below < 320 && above > below);
      const width = Math.min(480, viewportWidth - 16);
      const left = Math.max(
        viewportLeft + 8,
        Math.min(rect.left, viewportLeft + viewportWidth - width - 8)
      );
      setPosition({
        left,
        width,
        top: opensAbove ? rect.top - 8 : rect.bottom + 8,
        maxHeight: Math.max(0, Math.min(500, opensAbove ? above : below)),
        above: opensAbove
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  return (
    <div className="image-generation-settings dashboard-translation-settings" ref={rootRef}>
      <button
        type="button"
        className="image-generation-settings-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        disabled={props.disabled}
        onClick={() => setOpen(value => !value)}
      >
        <span className="image-generation-settings-summary">
          <span aria-hidden="true"><SlidersHorizontal size={14} strokeWidth={1.7} /></span>
          {props.summary.map(item => <span key={item}>{item}</span>)}
        </span>
        <ChevronUp size={14} className={open ? 'is-open' : undefined} aria-hidden="true" />
      </button>
      {open && position ? createPortal(
        <div
          id={`${id}-panel`}
          ref={panelRef}
          className="image-generation-settings-panel dashboard-translation-settings-panel"
          role="dialog"
          aria-label={label}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: position.above ? 'translateY(-100%)' : undefined
          }}
        >
          <div className="dashboard-translation-settings-sections">{props.children}</div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
