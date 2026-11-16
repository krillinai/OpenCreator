import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, SlidersHorizontal, X } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './ImageGenerationSettings.css';
import './DashboardGenerationComposer.css';

export default function DashboardVideoTranslationSettings(props: {
  summary: string[];
  disabled?: boolean;
  label?: string;
  variant?: 'speech';
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
  const closeSettings = () => {
    setOpen(false);
    rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  useEffect(() => {
    if (props.disabled) setOpen(false);
  }, [props.disabled]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (props.variant === 'speech' && target.closest('.tts-voice-menu, .app-select-menu')) return;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSettings();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, props.variant]);

  useLayoutEffect(() => {
    if (open && position && props.variant === 'speech') panelRef.current?.focus({ preventScroll: true });
  }, [open, !!position, props.variant]);

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
      if (props.variant === 'speech') {
        const height = viewport?.height ?? window.innerHeight;
        const width = Math.max(0, Math.min(680, viewportWidth - 16));
        setPosition({
          left: viewportLeft + (viewportWidth - width) / 2,
          top: viewportTop + height / 2,
          width,
          maxHeight: Math.max(0, height - 24),
          above: false
        });
        return;
      }
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
  }, [open, props.variant]);

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
      {open && position ? createPortal(<>
        {props.variant === 'speech' ? <div className="dashboard-speech-settings-backdrop" aria-hidden="true" /> : null}
        <div
          id={`${id}-panel`}
          ref={panelRef}
          className={`image-generation-settings-panel dashboard-translation-settings-panel${props.variant === 'speech' ? ' dashboard-speech-settings-panel' : ''}`}
          role="dialog"
          aria-label={label}
          aria-modal={props.variant === 'speech' ? true : undefined}
          tabIndex={props.variant === 'speech' ? -1 : undefined}
          onKeyDown={event => {
            if (props.variant !== 'speech' || event.key !== 'Tab') return;
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
              .filter(control => control.getClientRects().length > 0 || control.offsetParent !== null);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: props.variant === 'speech' ? 'translateY(-50%)' : position.above ? 'translateY(-100%)' : undefined
          }}
        >
          {props.variant === 'speech' ? <header><strong>{label}</strong><button type="button" aria-label={l('关闭', 'Close')} title={l('关闭', 'Close')} onClick={closeSettings}><X size={17} aria-hidden="true" /></button></header> : null}
          <div className="dashboard-translation-settings-sections">{props.children}</div>
        </div></>,
        document.body
      ) : null}
    </div>
  );
}
