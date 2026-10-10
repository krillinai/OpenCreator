import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Fuse from 'fuse.js';
import type { GatewayModel } from '@opencreator/protocol';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './official-model-select.css';

export function officialModelLabel(model: GatewayModel, automatic: string): string {
  if (/openrouter/i.test(model.id)) return automatic;
  return (model.name || model.id.split('/').pop() || model.id).replace(/OpenRouter\s*:?\s*/gi, '').trim();
}

export default function OfficialModelSelect(props: {
  label: string; describedBy?: string; models: GatewayModel[]; value: string;
  disabled?: boolean; onChange(value: string): void;
}) {
  const l = useLocalizedCopy();
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean }>();
  const automatic = l('自动选择', 'Automatic');
  const choices = useMemo(() => props.models.map(model => {
    const label = officialModelLabel(model, automatic);
    return { model, label, nameSearch: normalizeSearch(label), idSearch: normalizeSearch(model.id) };
  }), [props.models, automatic]);
  const search = useMemo(() => new Fuse(choices, {
    keys: [{ name: 'nameSearch', weight: 0.7 }, { name: 'idSearch', weight: 0.3 }],
    threshold: 0.3, ignoreLocation: true,
  }), [choices]);
  const filtered = useMemo(() => {
    if (!query.trim()) {
      return [...choices.filter(choice => choice.model.id === props.value), ...choices.filter(choice => choice.model.id !== props.value)];
    }
    const terms = query.trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (terms.length === 0) return [];
    const results = search.search({
      $and: terms.map(term => ({ $or: ['nameSearch', 'idSearch'].map(key => ({ [key]: term })) })),
    }).map(result => result.item);
    const exact = new Set(choices.filter(choice => terms.every(term => choice.nameSearch.includes(term) || choice.idSearch.includes(term))));
    return exact.size ? results.filter(choice => exact.has(choice)) : results;
  }, [choices, search, query, props.value]);
  const selected = choices.find(choice => choice.model.id === props.value);
  const selectedLabel = selected?.label ?? (props.models.length === 0 ? l('暂不可用', 'Unavailable') : l('选择模型', 'Select model'));
  const expanded = open && !props.disabled;
  const currentIndex = Math.min(activeIndex, filtered.length - 1);
  const optionId = (index: number) => `${id}-option-${index}`;

  function close() { setOpen(false); setQuery(''); setActiveIndex(0); }
  function show() {
    if (props.disabled || open) return;
    setQuery(''); setActiveIndex(0); setOpen(true);
  }
  function select(value: string) {
    inputRef.current?.focus();
    close();
    if (value !== props.value) props.onChange(value);
  }

  useEffect(() => { if (props.disabled) close(); }, [props.disabled]);
  useEffect(() => {
    if (!expanded) return;
    const onOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onOutsidePointer);
    window.addEventListener('blur', close);
    return () => { document.removeEventListener('pointerdown', onOutsidePointer); window.removeEventListener('blur', close); };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;
    // Keep the menu outside scrolling containers and within the visible viewport.
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const below = viewportBottom - rect.bottom - 14;
      const above = rect.top - viewportTop - 14;
      const opensAbove = below < 300 && above > below;
      const width = Math.min(rect.width, viewportWidth - 16);
      const next = {
        width, left: Math.max(viewportLeft + 8, Math.min(rect.left, viewportLeft + viewportWidth - width - 8)),
        top: opensAbove ? rect.top - 6 : rect.bottom + 6,
        maxHeight: Math.max(0, Math.min(360, opensAbove ? above : below)), above: opensAbove,
      };
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (rootRef.current) observer?.observe(rootRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded && currentIndex >= 0) document.getElementById(optionId(currentIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, currentIndex, query]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) { show(); return; }
      if (filtered.length) setActiveIndex((currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!expanded) show();
      else if (filtered[currentIndex]) select(filtered[currentIndex].model.id);
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  }

  return <span className="official-model-select" ref={rootRef}>
    <span className={`official-model-control${expanded ? ' is-open' : ''}`}>
      <Search size={15} className="official-model-search-icon" aria-hidden="true" />
      <input ref={inputRef} type="text" role="combobox" aria-label={props.label} aria-describedby={props.describedBy}
        aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
        aria-controls={expanded ? `${id}-listbox` : undefined}
        aria-activedescendant={expanded && currentIndex >= 0 ? optionId(currentIndex) : undefined}
        value={expanded ? query : selectedLabel} disabled={props.disabled} autoComplete="off" spellCheck={false}
        placeholder={l('搜索模型', 'Search models')} title={expanded ? undefined : selectedLabel}
        onFocus={show} onClick={show} onKeyDown={onKeyDown}
        onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget) && !menuRef.current?.contains(event.relatedTarget)) close(); }}
        onChange={event => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} />
      {expanded && query ? <button className="official-model-clear" type="button" tabIndex={-1}
        aria-label={l('清空模型搜索', 'Clear model search')} title={l('清空搜索', 'Clear search')}
        onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(''); setActiveIndex(0); inputRef.current?.focus(); }}>
        <X size={14} aria-hidden="true" />
      </button> : null}
      <button className="official-model-toggle" type="button" tabIndex={-1} disabled={props.disabled}
        aria-label={expanded ? l('收起模型列表', 'Close model list') : l('展开模型列表', 'Open model list')}
        title={expanded ? l('收起模型列表', 'Close model list') : l('展开模型列表', 'Open model list')}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { inputRef.current?.focus(); if (expanded) close(); else show(); }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </span>
    {expanded && position ? createPortal(<div ref={menuRef} className="official-model-menu" style={{
      left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight,
      transform: position.above ? 'translateY(-100%)' : undefined,
    }}>
      <div className="official-model-menu-count" role="status">
        {query.trim() ? l(`${filtered.length} 个匹配模型`, `${filtered.length} matches`) : l(`${filtered.length} 个模型`, `${filtered.length} models`)}
      </div>
      <div id={`${id}-listbox`} className="official-model-options" role="listbox" aria-label={props.label}>
        {filtered.map((choice, index) => <button key={choice.model.id} id={optionId(index)} type="button" role="option" tabIndex={-1}
          aria-label={choice.label} aria-selected={choice.model.id === props.value}
          className={`official-model-option${index === currentIndex ? ' is-active' : ''}`}
          title={choice.label} onMouseDown={event => event.preventDefault()}
          onPointerMove={event => { if (event.pointerType === 'mouse') setActiveIndex(index); }}
          onClick={() => select(choice.model.id)}>
          <span className="official-model-option-text"><span className="official-model-option-name">{choice.label}</span>
            {!/openrouter/i.test(choice.model.id) ? <span className="official-model-option-id">{choice.model.id}</span> : null}
          </span>
          {choice.model.id === props.value ? <Check size={16} aria-hidden="true" /> : <span className="official-model-check-space" />}
        </button>)}
        {filtered.length === 0 ? <div className="official-model-empty" role="status">{l('未找到匹配模型', 'No matching models')}</div> : null}
      </div>
    </div>, document.body) : null}
  </span>;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
