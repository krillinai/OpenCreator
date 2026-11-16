import { AudioLines, Check, LoaderCircle, Pause, Play, RefreshCw, Search, Star, X } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import NativeSelect from '../forms/NativeSelect.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './tts-voice-library.css';

export type VoiceLibraryOption = {
  id: string;
  name: string;
  language: string;
  gender: string;
  traits?: string[];
  useCases?: string[];
  description?: string;
  scenario: string;
  kind: string;
  custom: boolean;
  recommended: boolean;
  previewAvailable?: boolean;
  previewUnavailableLabel?: string;
  search: string;
};

const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

export function TtsVoiceLibrary(props: {
  id: string;
  label: string;
  value: string;
  options: VoiceLibraryOption[];
  loading: boolean;
  disabled?: boolean;
  canRefresh: boolean;
  canPreview: boolean;
  previewVoiceId: string;
  previewing: boolean;
  playing: boolean;
  onRefresh(): void;
  onPreview(id: string): void;
  onStopPreview(): void;
  onChange(id: string, commit?: boolean): void;
  onClose?(): void;
}) {
  const l = useLocalizedCopy();
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [gender, setGender] = useState('');
  const [scenario, setScenario] = useState('');
  const [useCase, setUseCase] = useState('');
  const [category, setCategory] = useState<'all' | 'recommended' | 'custom'>('all');
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const filters = useMemo(() => ({
    languages: [...new Set(props.options.map(option => option.language).filter(Boolean))],
    genders: [...new Set(props.options.map(option => option.gender).filter(Boolean))],
    scenarios: [...new Set(props.options.flatMap(option => [option.scenario, ...option.traits ?? []]).filter(Boolean))],
    useCases: [...new Set(props.options.flatMap(option => option.useCases ?? []))]
  }), [props.options]);
  const filtered = useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return props.options.filter(option => (
      (!language || option.language === language)
      && (!gender || option.gender === gender)
      && (!scenario || option.scenario === scenario || option.traits?.includes(scenario))
      && (!useCase || option.useCases?.includes(useCase))
      && (category !== 'recommended' || option.recommended)
      && (category !== 'custom' || option.custom)
      && terms.every(term => normalize(option.search).includes(term))
    ));
  }, [props.options, query, language, gender, scenario, useCase, category]);
  const focusId = filtered.find(option => option.id === props.value)?.id ?? filtered[0]?.id;
  const disabled = props.disabled || props.loading;

  function updateFilter(update: () => void) {
    props.onStopPreview();
    update();
  }

  function onRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % filtered.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + filtered.length) % filtered.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = filtered.length - 1;
    else return;
    event.preventDefault();
    const voice = filtered[next];
    if (!voice) return;
    props.onChange(voice.id, false);
    rowRefs.current.get(voice.id)?.focus();
  }

  return <section className="tts-voice-library" aria-labelledby={`${props.id}-library-label`}>
    <div className="tts-voice-library-heading">
      <h2 id={`${props.id}-library-label`}><AudioLines size={17} aria-hidden="true" />{props.label}</h2>
      <small>{filtered.length} / {props.options.length}</small>
      <button className="tts-voice-library-refresh" type="button" disabled={disabled || !props.canRefresh}
        aria-label={l('刷新音色列表', 'Refresh voices')} title={l('刷新音色列表', 'Refresh voices')} onClick={props.onRefresh}>
        {props.loading ? <LoaderCircle className="tts-voice-picker-spinner" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
      </button>
      {props.onClose ? <button className="tts-voice-library-refresh" type="button" aria-label={l('关闭', 'Close')} title={l('关闭', 'Close')} onClick={props.onClose}><X size={18} aria-hidden="true" /></button> : null}
    </div>
    <div className="tts-voice-library-toolbar">
      <div className="tts-voice-library-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} disabled={disabled} aria-label={l('搜索音色', 'Search voices')}
          placeholder={l('搜索音色', 'Search voices')} onChange={event => updateFilter(() => setQuery(event.target.value))} />
        {query ? <button type="button" disabled={disabled} aria-label={l('清除搜索', 'Clear search')}
          onClick={() => updateFilter(() => setQuery(''))}><X size={15} aria-hidden="true" /></button> : null}
      </div>
      <div className="tts-voice-library-filters">
        {[
          { label: l('全部语言', 'All languages'), values: filters.languages, value: language, set: setLanguage },
          { label: l('全部性别', 'All genders'), values: filters.genders, value: gender, set: setGender },
          { label: l('全部风格', 'All styles'), values: filters.scenarios, value: scenario, set: setScenario },
          { label: l('全部场景', 'All use cases'), values: filters.useCases, value: useCase, set: setUseCase }
        ].filter(filter => filter.values.length > 0).map(filter => <NativeSelect key={filter.label} aria-label={filter.label} value={filter.value} disabled={disabled}
          onChange={event => updateFilter(() => filter.set(event.target.value))}>
          <option value="">{filter.label}</option>
          {filter.values.map(value => <option value={value} key={value}>{value}</option>)}
        </NativeSelect>)}
      </div>
    </div>
    {props.options.some(option => option.recommended || option.custom) ? <div className="tts-voice-library-categories" aria-label={props.label}>
      {[
        { value: 'all' as const, label: l('全部', 'All'), show: true },
        { value: 'recommended' as const, label: l('推荐', 'Recommended'), show: props.options.some(option => option.recommended) },
        { value: 'custom' as const, label: l('自定义音色', 'Custom'), show: props.options.some(option => option.custom) }
      ].filter(item => item.show).map(item => <button type="button" key={item.value} disabled={disabled} aria-pressed={category === item.value}
        onClick={() => updateFilter(() => setCategory(item.value))}>{item.label}</button>)}
    </div> : null}
    {props.loading ? <div className="tts-voice-library-empty" role="status"><LoaderCircle className="tts-voice-picker-spinner" size={20} aria-hidden="true" />{l('正在加载音色', 'Loading voices')}</div> : <>
      <div className="tts-voice-library-list" role="radiogroup" aria-labelledby={`${props.id}-library-label`} aria-busy={props.loading}>
        {filtered.map((option, index) => {
          const selected = option.id === props.value;
          const activePreview = props.previewVoiceId === option.id;
          const tags = [...new Set([option.language, option.gender, option.scenario, ...option.traits ?? [], ...option.useCases ?? [], option.kind].filter(Boolean))];
          const name = [option.name, ...tags].join(' · ');
          return <div key={option.id} className="tts-voice-library-row" data-selected={selected} data-previewing={activePreview && (props.previewing || props.playing)}>
            <button className="tts-voice-library-play" type="button" disabled={props.disabled || !props.canPreview || option.previewAvailable === false}
              tabIndex={option.id === focusId ? 0 : -1}
              aria-label={`${activePreview && props.playing ? l('暂停', 'Pause') : l('试听', 'Preview')} · ${option.name}`}
              aria-pressed={activePreview && props.playing} title={option.previewUnavailableLabel ?? option.name} onClick={() => props.onPreview(option.id)}>
              {activePreview && props.previewing ? <LoaderCircle className="tts-voice-picker-spinner" size={20} aria-hidden="true" /> : activePreview && props.playing ? <Pause size={20} aria-hidden="true" /> : <Play size={20} aria-hidden="true" />}
            </button>
            <button ref={element => { if (element) rowRefs.current.set(option.id, element); else rowRefs.current.delete(option.id); }}
              className="tts-voice-library-choice" type="button" role="radio" aria-checked={selected} aria-label={name}
              disabled={props.disabled} tabIndex={option.id === focusId ? 0 : -1} onKeyDown={event => onRadioKeyDown(event, index)} onClick={() => props.onChange(option.id, true)}>
              <span className="tts-voice-library-copy">
                <span className="tts-voice-library-name"><bdi>{option.name}</bdi>{option.name !== option.id ? <small dir="ltr">{option.id}</small> : null}</span>
                {option.description ? <span className="tts-voice-library-description">{option.description}</span> : null}
                {option.previewUnavailableLabel ? <span className="tts-voice-library-preview-unavailable">{option.previewUnavailableLabel}</span> : null}
                {tags.length || option.recommended ? <span className="tts-voice-library-tags">
                  {option.recommended ? <span className="tts-voice-library-recommended"><Star size={11} aria-hidden="true" />{l('推荐', 'Recommended')}</span> : null}
                  {tags.map(tag => <span key={tag}>{tag}</span>)}
                </span> : null}
              </span>
              <span className="tts-voice-library-check" aria-hidden="true">{selected ? <Check size={17} /> : null}</span>
            </button>
          </div>;
        })}
      </div>
      {!filtered.length ? <div className="tts-voice-library-empty" role="status">
        <AudioLines size={24} aria-hidden="true" />
        <span>{props.options.length ? l('没有匹配的音色', 'No matching voices') : l('暂无可用音色', 'No voices available')}</span>
        {props.options.length ? <button type="button" onClick={() => updateFilter(() => { setQuery(''); setLanguage(''); setGender(''); setScenario(''); setUseCase(''); setCategory('all'); })}>{l('全部', 'All')}</button> : null}
      </div> : null}
    </>}
  </section>;
}
