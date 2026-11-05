import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, Clock3, Images, RectangleHorizontal, X } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './ImageGenerationSettings.css';

export type ImageGenerationSettingSection = {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  ratio?: boolean;
  disabled?: boolean;
  onChange(value: string): void;
};

export default function ImageGenerationSettings(props: {
  label: string;
  summary: {
    aspectRatio: string;
    count: string;
    resolution: string;
    quality: string;
  };
  sections: ImageGenerationSettingSection[];
  countIcon?: 'images' | 'clock';
  disabled?: boolean;
}) {
  const l = useLocalizedCopy();
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
      const width = Math.min(440, viewportWidth - 16);
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
    <div className="image-generation-settings" ref={rootRef}>
      <button
        type="button"
        className="image-generation-settings-trigger"
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        disabled={props.disabled}
        onClick={() => setOpen(value => !value)}
      >
        <span className="image-generation-settings-summary">
          <span><RectangleHorizontal size={15} strokeWidth={1.6} aria-hidden="true" />{props.summary.aspectRatio}</span>
          <span>{props.countIcon === 'clock' ? <Clock3 size={14} strokeWidth={1.6} aria-hidden="true" /> : <Images size={14} strokeWidth={1.6} aria-hidden="true" />}{props.summary.count}</span>
          <span>{props.summary.resolution}</span>
          <span>{props.summary.quality}</span>
        </span>
        <ChevronUp size={14} className={open ? 'is-open' : undefined} aria-hidden="true" />
      </button>
      {open && position ? createPortal(
        <div
          id={`${id}-panel`}
          ref={panelRef}
          className="image-generation-settings-panel"
          role="dialog"
          aria-label={props.label}
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: position.above ? 'translateY(-100%)' : undefined
          }}
        >
          <header>
            <strong>{props.label}</strong>
            <button type="button" aria-label={l('关闭图片设置', 'Close image settings', 'Stäng bildinställningar')} onClick={() => setOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="image-generation-settings-sections">
            {props.sections.map(section => (
              <section key={section.id} aria-labelledby={`${id}-${section.id}`}>
                <h3 id={`${id}-${section.id}`}>{section.label}</h3>
                <div
                  className={section.ratio ? 'image-generation-ratio-options' : 'image-generation-segment-options'}
                  role="radiogroup"
                  aria-label={section.label}
                >
                  {section.options.map(option => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={section.value === option.value}
                      aria-label={option.label}
                      data-value={option.value}
                      disabled={section.disabled}
                      key={option.value}
                      onClick={() => section.onChange(option.value)}
                    >
                      {section.ratio ? <span className="image-generation-ratio-icon" aria-hidden="true"><span style={ratioShape(option.value)} /></span> : null}
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function ratioShape(value: string): { width: number; height: number } {
  const parts = value.split(':');
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 22, height: 22 };
  }
  return width >= height
    ? { width: 24, height: Math.max(8, 24 * height / width) }
    : { width: Math.max(8, 24 * width / height), height: 24 };
}
