import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import Fuse from 'fuse.js';
import { gatewayModelDisplayName, gatewayModelIdMatches, gatewayRelayIdentity, gatewayModelReady, gatewayRecommendedModelId, type GatewayModel } from '@opencreator/protocol';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { officialModelPrice, officialModelPriceDescription } from './official-model-pricing.js';
import ModelBrandIcon, { modelBrand } from '../brand/ModelBrandIcon.js';
import './official-model-select.css';

export { officialModelPrice } from './official-model-pricing.js';

export function officialModelLabel(model: GatewayModel, automatic: string): string {
  if (/openrouter/i.test(model.id)) return automatic;
  return gatewayModelDisplayName(model, automatic);
}
export default function OfficialModelSelect(props: {
  label: string; describedBy?: string; models: GatewayModel[]; value: string;
  recommendedModel?: GatewayModel; followsRecommendation?: boolean;
  disabled?: boolean; layout?: 'list' | 'catalog'; onChange(value: string): void;
}) {
  const l = useLocalizedCopy();
  const id = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeBrand, setActiveBrand] = useState<string>();
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean }>();
  const automatic = l('自动选择', 'Automatic');
  const catalog = props.layout === 'catalog';
  const selectionValue = props.recommendedModel && (props.followsRecommendation || gatewayModelIdMatches(props.value, props.recommendedModel.id)) ? gatewayRecommendedModelId : props.models.find(model => gatewayModelIdMatches(model.id, props.value))?.id ?? props.value;
  const choices = useMemo(() => {
    const models = [...new Map(props.models.map(model => [model.id, model])).values()];
    return [...(props.recommendedModel ? [props.recommendedModel] : []), ...models.filter(model => model.id !== props.recommendedModel?.id)].map(model => {
      const recommended = model.id === props.recommendedModel?.id;
      const name = officialModelLabel(model, automatic);
      const label = recommended ? l(`系统推荐 · ${name}`, `Recommended · ${name}`) : name;
      return { model, value: recommended ? gatewayRecommendedModelId : model.id, label, brand: modelVendor(model), nameSearch: normalizeSearch(label), idSearch: normalizeSearch(gatewayModelDisplayName({ id: model.id }, "")) };
    });
  }, [props.models, props.recommendedModel, automatic, l]);
  const search = useMemo(() => new Fuse(choices, {
    keys: [{ name: 'nameSearch', weight: 0.7 }, { name: 'idSearch', weight: 0.3 }],
    threshold: 0.3, ignoreLocation: true,
  }), [choices]);
  const filtered = useMemo(() => {
    if (!query.trim()) {
      return [...choices].sort((a,b)=>Number(b.value===selectionValue)-Number(a.value===selectionValue)
        || Number(b.value===gatewayRecommendedModelId || !!b.model.recommended)-Number(a.value===gatewayRecommendedModelId || !!a.model.recommended)
        || (a.brand??'').localeCompare(b.brand??''));
    }
    const terms = query.trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (terms.length === 0) return [];
    const results = search.search({
      $and: terms.map(term => ({ $or: ['nameSearch', 'idSearch'].map(key => ({ [key]: term })) })),
    }).map(result => result.item);
    const exact = new Set(choices.filter(choice => terms.every(term => choice.nameSearch.includes(term) || choice.idSearch.includes(term))));
    return exact.size ? results.filter(choice => exact.has(choice)) : results;
  }, [choices, search, query, selectionValue]);
  const selected = choices.find(choice => choice.value === selectionValue);
  const brands = useMemo(() => {
    const result: Array<{ name: string; model: GatewayModel; count: number }> = [];
    for (const choice of choices) {
      const name = choice.brand ?? l('其他', 'Other', 'Övriga');
      const existing = result.find(brand => brand.name === name);
      if (existing) existing.count += 1;
      else result.push({ name, model: choice.model, count: 1 });
    }
    return result;
  }, [choices, l]);
  const visible = useMemo(() => catalog && !query.trim() && activeBrand !== undefined
    ? filtered.filter(choice => (choice.brand ?? l('其他', 'Other', 'Övriga')) === activeBrand)
    : filtered, [activeBrand, catalog, filtered, l, query]);
  const selectedLabel = selected?.label ?? (gatewayModelDisplayName({ id: props.value }, '') || (props.models.length === 0 ? l('暂不可用', 'Unavailable') : l('选择模型', 'Select model')));
  const expanded = open && !props.disabled;
  const currentIndex = Math.min(activeIndex, visible.length - 1);
  const optionId = (index: number) => `${id}-option-${index}`;

  function close() { setOpen(false); setQuery(''); setActiveIndex(0); }
  function show() {
    if (props.disabled || open) return;
    setQuery(''); setActiveIndex(0); setActiveBrand(selected?.brand ?? brands[0]?.name); setOpen(true);
  }
  function select(value: string) {
    if (!(value === gatewayRecommendedModelId && props.recommendedModel) && !props.models.some(model=>model.id===value&&gatewayModelReady(model)))return;
    inputRef.current?.focus();
    close();
    if (value !== selectionValue || (value === gatewayRecommendedModelId && !props.followsRecommendation)) props.onChange(value);
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
      const opensAbove = (catalog && above > 80) || (below < 300 && above > below);
      const width = Math.min(Math.max(rect.width, catalog ? 600 : 340), viewportWidth - 16);
      const menuLeft = getComputedStyle(rootRef.current!).direction === 'rtl' ? rect.right - width : rect.left;
      const next = {
        width, left: Math.max(viewportLeft + 8, Math.min(menuLeft, viewportLeft + viewportWidth - width - 8)),
        top: opensAbove ? rect.top - 6 : rect.bottom + 6,
        maxHeight: Math.max(0, Math.min(440, opensAbove ? above : below)), above: opensAbove,
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
  }, [expanded, catalog]);

  useEffect(() => {
    if (expanded && currentIndex >= 0) document.getElementById(optionId(currentIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, currentIndex, query, activeBrand]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) { show(); return; }
      if (visible.length) setActiveIndex((currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!expanded) show();
      else if (visible[currentIndex]) select(visible[currentIndex].value);
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  }

  const options = <div id={`${id}-listbox`} className="official-model-options" role="listbox" aria-label={props.label}>
    {visible.map((choice, index) => <Fragment key={choice.model.id}>
      {!catalog && choice.value !== gatewayRecommendedModelId && choice.brand && (choice.brand !== visible[index-1]?.brand || visible[index-1]?.value === gatewayRecommendedModelId) ? <div className="official-model-menu-group" role="presentation">{choice.brand}</div> : null}
      <button id={optionId(index)} type="button" role="option" tabIndex={-1}
        aria-label={choice.label} aria-selected={choice.value === selectionValue}
        disabled={!gatewayModelReady(choice.model)} aria-disabled={!gatewayModelReady(choice.model)}
        className={`official-model-option${index === currentIndex ? ' is-active' : ''}`}
        title={[choice.label, officialModelPriceDescription(choice.model, l)].filter(Boolean).join('\n')} onMouseDown={event => event.preventDefault()}
        onPointerMove={event => { if (event.pointerType === 'mouse') setActiveIndex(index); }}
        onClick={() => select(choice.value)}>
        <ModelBrandIcon model={choice.model} />
        <span className="official-model-option-text"><span className="official-model-option-heading">
          <span className="official-model-option-name">{choice.label}</span>
          {choice.model.recommended && choice.value !== gatewayRecommendedModelId ? <span className="official-model-option-badge">{l('推荐','Recommended')}</span> : null}
          {!gatewayModelReady(choice.model) ? <span className="official-model-option-badge is-unavailable">{l('暂不可用','Temporarily unavailable')}</span> : null}
        </span>
          {!/openrouter/i.test(choice.model.id) && (choice.model.modality === 'video' || choice.value !== gatewayRecommendedModelId) && modelDetail(choice.model, l) ? <span className="official-model-option-id">{modelDetail(choice.model, l)}</span> : null}
          {choice.model.price ? <span className={`official-model-option-price${choice.model.modality === 'video' ? ' is-video' : ''}`}>{officialModelPrice(choice.model,l)}</span> : null}
        </span>
        {choice.value === selectionValue ? <Check size={16} aria-hidden="true" /> : <span className="official-model-check-space" />}
      </button>
    </Fragment>)}
    {visible.length === 0 ? <div className="official-model-empty" role="status">{l('未找到匹配模型', 'No matching models')}</div> : null}
  </div>;

  return <span className="official-model-select" ref={rootRef}>
    <span className={`official-model-control${expanded ? ' is-open' : ''}`}>
      {expanded ? <Search size={15} className="official-model-search-icon" aria-hidden="true" />
        : <ModelBrandIcon model={selected?.model ?? { id: '' }} className="official-model-selected-icon" />}
      <input ref={inputRef} type="text" role="combobox" aria-label={props.label} aria-describedby={props.describedBy}
        aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
        aria-controls={expanded ? `${id}-listbox` : undefined}
        aria-activedescendant={expanded && currentIndex >= 0 ? optionId(currentIndex) : undefined}
        value={expanded ? query : selectedLabel} disabled={props.disabled} autoComplete="off" spellCheck={false}
        placeholder={l('搜索模型', 'Search models', 'Sök modeller')} title={expanded ? undefined : selectedLabel}
        onFocus={show} onClick={show} onKeyDown={onKeyDown}
        onBlur={event => { if (!rootRef.current?.contains(event.relatedTarget) && !menuRef.current?.contains(event.relatedTarget)) close(); }}
        onChange={event => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} />
      {expanded && query ? <button className="official-model-clear" type="button" tabIndex={-1}
        aria-label={l('清空模型搜索', 'Clear model search', 'Rensa modellsökning')} title={l('清空搜索', 'Clear search', 'Rensa sökning')}
        onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(''); setActiveIndex(0); inputRef.current?.focus(); }}>
        <X size={14} aria-hidden="true" />
      </button> : null}
      <button className="official-model-toggle" type="button" tabIndex={-1} disabled={props.disabled}
        aria-label={expanded ? l('收起模型列表', 'Close model list', 'Stäng modellistan') : l('展开模型列表', 'Open model list', 'Öppna modellistan')}
        title={expanded ? l('收起模型列表', 'Close model list', 'Stäng modellistan') : l('展开模型列表', 'Open model list', 'Öppna modellistan')}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { inputRef.current?.focus(); if (expanded) close(); else show(); }}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </span>
    {expanded && position ? createPortal(<div ref={menuRef} className={`official-model-menu${catalog ? ' official-model-menu--catalog' : ''}`} style={{
      left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight,
      transform: position.above ? 'translateY(-100%)' : undefined,
    }}>
      {catalog ? <div className="official-model-catalog-body">
        <nav className="official-model-catalog-brands" aria-label={l('模型服务商', 'Model providers', 'Modellleverantörer')}>
          <span className="official-model-catalog-title">{l('模型', 'MODELS', 'MODELLER')}</span>
          {brands.map(brand => <button type="button" key={brand.name} aria-pressed={!query.trim() && activeBrand === brand.name}
            onMouseDown={event => event.preventDefault()}
            onClick={() => { setQuery(''); setActiveBrand(brand.name); setActiveIndex(0); }}>
            <ModelBrandIcon model={brand.model} />
            <span><strong>{brand.name}</strong><small>{l(`${brand.count} 个模型`, `${brand.count} ${brand.count === 1 ? 'model' : 'models'}`, `${brand.count} modeller`)}</small></span>
          </button>)}
        </nav>
        {options}
      </div> : options}
    </div>, document.body) : null}
  </span>;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function modelDetail(model: GatewayModel, l: LocalizeCopy): string {
  const brand = modelVendor(model);
  if (model.modality === 'video') {
    const durations = [...new Set(model.durations?.filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
    const ranges: string[] = [];
    for (let index = 0; index < durations.length; index++) {
      const start = durations[index]!;
      let end = start;
      while (Number.isInteger(end) && durations[index + 1] === end + 1) end = durations[++index]!;
      ranges.push(start === end ? `${start}` : `${start}–${end}`);
    }
    const duration = ranges.length ? l(`时长 ${ranges.join('、')} 秒`, `Duration ${ranges.join(', ')} seconds`, `Längd ${ranges.join(', ')} sekunder`) : '';
    return [duration, model.resolutions?.join(' / ')].filter(Boolean).join(' · ');
  }
  return brand ?? '';
}

function modelVendor(model: GatewayModel): string | undefined {
  return model.vendor && !gatewayRelayIdentity.test(model.vendor) ? model.vendor : modelBrand(model)?.name;
}
