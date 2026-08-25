import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, CircleCheck } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export type CreatorResultVersionItem = {
  value: number;
  description: string;
};

export default function CreatorResultVersionMenu(props: {
  version: number;
  versions: CreatorResultVersionItem[];
  onVersionChange(version: number): void;
}) {
  const l = useLocalizedCopy();
  const [historyOpen, setHistoryOpen] = useState(false);
  const versionMenuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!historyOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!versionMenuRef.current?.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [historyOpen]);

  return (
    <div className="video-result-version" ref={versionMenuRef}>
      <button
        type="button"
        aria-expanded={historyOpen}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setHistoryOpen(open => !open)}
      >
        <CircleCheck size={15} strokeWidth={2} aria-hidden="true" />
        <span>{l(`项目 V${props.version}`, `Project V${props.version}`)}</span>
        <ChevronDown className="video-result-version-chevron" size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {historyOpen ? (
        <div id={menuId} role="menu">
          {props.versions.map(item => (
            <button
              type="button"
              role="menuitem"
              aria-current={item.value === props.version ? 'true' : undefined}
              key={item.value}
              onClick={() => {
                props.onVersionChange(item.value);
                setHistoryOpen(false);
              }}
            >
              <span>
                <strong>{l(`项目 V${item.value}`, `Project V${item.value}`)}</strong>
                <small>{item.description}{item.value === props.version ? l('，当前查看', ', currently viewing') : ''}</small>
              </span>
              {item.value === props.version ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
