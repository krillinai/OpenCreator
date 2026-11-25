import { AudioLines, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function TtsVoiceLibraryPopover(props: {
  label: string;
  name: string;
  detail?: string;
  disabled?: boolean;
  resetKey: string;
  onClose(): void;
  children(close: () => void): ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number; top: number; width: number; maxHeight: number;
    backdropLeft: number; backdropTop: number; backdropWidth: number; backdropHeight: number;
  }>();
  const expanded = open && !props.disabled;
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    onCloseRef.current();
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => { close(); }, [props.disabled, props.resetKey, close]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const boundary = triggerRef.current?.closest<HTMLElement>('.creator-workspace-content');
    const place = () => {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const rect = boundary?.getBoundingClientRect();
      const left = Math.max(viewportLeft, rect?.left ?? viewportLeft);
      const top = Math.max(viewportTop, rect?.top ?? viewportTop);
      const right = Math.min(viewportRight, rect?.right ?? viewportRight);
      const bottom = Math.min(viewportBottom, rect?.bottom ?? viewportBottom);
      const panelWidth = Math.max(0, Math.min(720, right - left - 24));
      const next = {
        left: (left + right - panelWidth) / 2,
        top: (top + bottom) / 2,
        width: panelWidth,
        maxHeight: Math.max(0, Math.min(720, bottom - top - 24)),
        backdropLeft: left,
        backdropTop: top,
        backdropWidth: Math.max(0, right - left),
        backdropHeight: Math.max(0, bottom - top)
      };
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (boundary) observer?.observe(boundary);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    // The import dialog is portalled to document.body and opens a native file picker.
    const dialogOpen = () => panelRef.current?.querySelector('[aria-haspopup="dialog"][aria-expanded="true"]');
    const outside = (event: Event) => {
      if (dialogOpen()) return;
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const blur = () => { if (!dialogOpen()) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('blur', blur);
    };
  }, [expanded, close]);

  const positioned = expanded && !!position;
  useEffect(() => {
    if (positioned) {
      const target = panelRef.current?.querySelector<HTMLElement>('input[type="search"]:not(:disabled)')
        ?? panelRef.current?.querySelector<HTMLElement>('button:not(:disabled)');
      target?.focus({ preventScroll: true });
    }
  }, [positioned]);

  return <>
    <div className="tts-voice-library-entry">
      <span id={`${id}-label`}>{props.label}</span>
      <button ref={triggerRef} type="button" className="tts-voice-library-trigger" disabled={props.disabled}
        aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={expanded}
        aria-controls={expanded ? id : undefined} onClick={() => { if (expanded) close(); else setOpen(true); }}>
        <AudioLines size={20} aria-hidden="true" />
        <span><strong id={`${id}-value`}><bdi>{props.name || '—'}</bdi></strong>{props.detail ? <small>{props.detail}</small> : null}</span>
        <ChevronRight className="tts-voice-library-chevron" size={17} aria-hidden="true" />
      </button>
    </div>
    {expanded && position ? createPortal(<>
      <div className="tts-voice-library-backdrop" aria-hidden="true"
        style={{ left: position.backdropLeft, top: position.backdropTop, width: position.backdropWidth, height: position.backdropHeight }}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); close(true); }} />
      <div id={id} ref={panelRef} className="tts-voice-library-popover" role="dialog" aria-label={props.label}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: 'translateY(-50%)' }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === 'Tab') {
          const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]')].filter(element => element.tabIndex >= 0 && !element.matches(':disabled'));
          if ((event.shiftKey && event.target === elements[0]) || (!event.shiftKey && event.target === elements.at(-1))) {
            event.preventDefault(); close(true);
          }
        }
      }}>
      {props.children(() => close(true))}
    </div></>, document.body) : null}
  </>;
}
