import { Check, ChevronDown, Search } from 'lucide-react';
import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './select.css';

type Choice = { value: string; label: string; disabled: boolean; hidden: boolean; group?: string; searchText?: string };
type TriggerEvents = 'onKeyDown' | 'onFocus' | 'onBlur' | 'onClick';
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size' | TriggerEvents>
  & Pick<ButtonHTMLAttributes<HTMLButtonElement>, TriggerEvents> & {
    anchorRef?: RefObject<HTMLElement>;
    renderOptionIcon?(value: string): ReactNode;
  };
type Position = { left: number; top: number; width: number; maxHeight: number; above: boolean };
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();

function textContent(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child)
    ? textContent(child.props.children) : String(child)).join('');
}

function choicesFrom(children: ReactNode, group?: string, disabled = false): Choice[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; label?: string; disabled?: boolean; hidden?: boolean; children?: ReactNode; 'data-search'?: string }>(child)) return [];
    if (child.type === Fragment) return choicesFrom(child.props.children, group, disabled);
    if (child.type === 'optgroup') return choicesFrom(child.props.children, child.props.label, disabled || !!child.props.disabled);
    if (child.type !== 'option') return [];
    const label = child.props.label ?? textContent(child.props.children);
    return [{ value: String(child.props.value ?? label), label, group, searchText: child.props['data-search'],
      disabled: disabled || !!child.props.disabled, hidden: !!child.props.hidden }];
  });
}

/** Shared single select. The hidden native control preserves form values and change events. */
export default function Select({ children, value, defaultValue, onChange, className, id, name, disabled,
  title, style, autoFocus, tabIndex, onKeyDown, onFocus, onBlur, onClick, anchorRef, renderOptionIcon,
  ...nativeProps }: SelectProps) {
  const l = useLocalizedCopy();
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-control`;
  const listId = `${generatedId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', time: 0 });
  const choices = useMemo(() => choicesFrom(children), [children]);
  const first = choices.find(choice => !choice.disabled && !choice.hidden) ?? choices[0];
  const [localValue, setLocalValue] = useState(String(defaultValue ?? first?.value ?? ''));
  const requestedValue = String(value ?? localValue);
  const selected = choices.find(choice => choice.value === requestedValue) ?? first;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeValue, setActiveValue] = useState('');
  const [position, setPosition] = useState<Position>();
  const searchable = choices.filter(choice => !choice.hidden).length >= 10;
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const filtered = choices.filter(choice => !choice.hidden && terms.every(term => normalize(`${choice.label} ${choice.value} ${choice.group ?? ''} ${choice.searchText ?? ''}`).includes(term)));
  const enabled = filtered.filter(choice => !choice.disabled);
  const active = enabled.find(choice => choice.value === activeValue) ?? enabled[0];
  const activeIndex = filtered.findIndex(choice => choice === active);
  const expanded = open && !disabled && choices.length > 0;
  const optionId = (index: number) => `${listId}-${index}`;
  const ariaProps = Object.fromEntries(Object.entries(nativeProps).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-')));
  const formProps = Object.fromEntries(Object.entries(nativeProps).filter(([key]) => !key.startsWith('aria-') && !key.startsWith('data-')));

  function close(restoreFocus = false) {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }
  function show() {
    if (disabled || !choices.length) return;
    setQuery('');
    setActiveValue(selected && !selected.disabled ? selected.value : first?.value ?? '');
    setOpen(true);
  }
  function choose(choice: Choice) {
    if (disabled || choice.disabled) return;
    close(true);
    const control = nativeRef.current;
    if (control && choice.value !== selected?.value) {
      control.value = choice.value;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => {
    const form = nativeRef.current?.form;
    const reset = () => { close(); if (value === undefined) setLocalValue(String(defaultValue ?? first?.value ?? '')); };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [value, defaultValue, first?.value]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const blur = () => close();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('blur', blur);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = (anchorRef?.current ?? triggerRef.current)?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth;
      const height = viewport?.height ?? innerHeight;
      const below = top + height - rect.bottom - 14;
      const above = rect.top - top - 14;
      const opensAbove = below < 260 && above > below;
      const menuWidth = Math.max(0, Math.min(Math.max(rect.width, 180), width - 16));
      const start = getComputedStyle(triggerRef.current!).direction === 'rtl' ? rect.right - menuWidth : rect.left;
      const next = { left: Math.max(left + 8, Math.min(start, left + width - menuWidth - 8)),
        top: opensAbove ? rect.top - 6 : rect.bottom + 6, width: menuWidth,
        maxHeight: Math.max(0, Math.min(360, opensAbove ? above : below)), above: opensAbove };
      setPosition(previous => previous && Object.keys(next).every(key => previous[key as keyof Position] === next[key as keyof Position]) ? previous : next);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    const anchor = anchorRef?.current ?? triggerRef.current;
    if (anchor) observer?.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    viewportListen('addEventListener');
    function viewportListen(method: 'addEventListener' | 'removeEventListener') {
      window.visualViewport?.[method]('resize', place);
      window.visualViewport?.[method]('scroll', place);
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      viewportListen('removeEventListener');
    };
  }, [expanded, anchorRef]);

  useEffect(() => {
    if (expanded && position && searchable) searchRef.current?.focus({ preventScroll: true });
  }, [expanded, !!position, searchable]);
  useEffect(() => {
    if (expanded && activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeIndex, query]);

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const searching = event.target === searchRef.current;
    if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); close(true);
    } else if (event.key === 'Tab') {
      // The portaled search is outside document tab order relative to its trigger.
      if (searching && triggerRef.current) {
        event.preventDefault(); event.stopPropagation();
        const boundary = triggerRef.current.closest('[role="dialog"]') ?? document.body;
        const controls = [...boundary.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
          .filter(element => element.tabIndex >= 0 && !element.matches(':disabled')
            && !element.closest('[hidden], [inert], [aria-hidden="true"]')
            && !menuRef.current?.contains(element)
            && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
        const next = controls.indexOf(triggerRef.current) + (event.shiftKey ? -1 : 1);
        (controls[next] ?? triggerRef.current).focus();
      }
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(searching && ['Home', 'End'].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      if (!expanded) { show(); return; }
      const index = enabled.indexOf(active!);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      if (enabled[next]) setActiveValue(enabled[next].value);
    } else if (event.key === 'Enter' || (event.key === ' ' && !searching)) {
      event.preventDefault(); event.stopPropagation();
      if (!expanded) show(); else if (active) choose(active);
    } else if (!searching && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const previous = now - typeahead.current.time < 700 ? typeahead.current.text : '';
      const text = normalize(previous + event.key);
      typeahead.current = { text, time: now };
      if (!expanded) show();
      const match = choices.find(choice => !choice.disabled && !choice.hidden && normalize(choice.label).startsWith(text));
      if (match) setActiveValue(match.value);
    }
  }

  return <div className="app-select native-select" dir={nativeProps.dir}>
    <button {...ariaProps} ref={triggerRef} id={controlId} type="button" role="combobox" name={name}
      value={selected?.value ?? ''} data-value={selected?.value ?? ''} title={title ?? selected?.label}
      className={['app-select-trigger', 'native-select-control', className].filter(Boolean).join(' ')}
      style={style} disabled={disabled} autoFocus={autoFocus} tabIndex={tabIndex}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
      aria-required={nativeProps.required || undefined}
      onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (expanded) close(); else show(); } }}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented) keyDown(event); }} onFocus={onFocus} onBlur={onBlur}>
      {selected && renderOptionIcon ? <span className="app-select-option-icon" aria-hidden="true">{renderOptionIcon(selected.value)}</span> : null}
      <span className="app-select-value">{selected?.label ?? '—'}</span>
      <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
    <select {...formProps} ref={nativeRef} hidden aria-hidden="true" tabIndex={-1} id={`${controlId}-native`}
      name={name} disabled={disabled} value={value === undefined ? localValue : value}
      onInvalid={event => { nativeProps.onInvalid?.(event); event.preventDefault(); triggerRef.current?.focus(); }}
      onChange={event => { setLocalValue(event.currentTarget.value); onChange?.(event); }}>{children}</select>
    {expanded && position ? createPortal(<div ref={menuRef} className="app-select-menu" dir={triggerRef.current ? getComputedStyle(triggerRef.current).direction : undefined}
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight,
        transform: position.above ? 'translateY(-100%)' : undefined }}
      onPointerDown={event => event.stopPropagation()} onFocus={event => event.stopPropagation()}>
      {searchable ? <div className="app-select-search"><Search size={15} aria-hidden="true" />
        <input ref={searchRef} type="search" aria-label={l('搜索选项', 'Search options')}
          placeholder={l('搜索选项', 'Search options')} value={query} autoComplete="off" spellCheck={false}
          aria-controls={listId} aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined} onKeyDown={keyDown}
          onChange={event => { setQuery(event.target.value); setActiveValue(''); }} />
      </div> : null}
      <div id={listId} role="listbox" aria-label={nativeProps['aria-label']} aria-labelledby={nativeProps['aria-labelledby'] ?? controlId} className="app-select-options">
        {filtered.map((choice, index) => <Fragment key={`${choice.group ?? ''}:${choice.value}:${index}`}>
          {choice.group && choice.group !== filtered[index - 1]?.group ? <div className="app-select-group" role="presentation">{choice.group}</div> : null}
          <div role="option" id={optionId(index)} data-value={choice.value} aria-label={choice.label}
            aria-selected={choice.value === selected?.value} aria-disabled={choice.disabled || undefined}
            className={`app-select-option${choice === active ? ' is-active' : ''}`}
            onMouseDown={event => event.preventDefault()}
            onPointerMove={event => { if (event.pointerType === 'mouse' && !choice.disabled) setActiveValue(choice.value); }}
            onClick={() => choose(choice)}>
            {renderOptionIcon ? <span className="app-select-option-icon" aria-hidden="true">{renderOptionIcon(choice.value)}</span> : null}
            <span className="app-select-option-label">{choice.label}</span>{choice.value === selected?.value ? <Check size={15} aria-hidden="true" /> : <span className="app-select-check" />}
          </div>
        </Fragment>)}
        {!filtered.length ? <div className="app-select-empty" role="status">{l('没有匹配的选项', 'No matching options')}</div> : null}
      </div>
    </div>, document.body) : null}
  </div>;
}
