import { localOmniVoiceVoices, type OmniVoiceProfile } from '@opencreator/protocol';
import { AudioLines, ChevronRight, FileAudio, Library, Plus, Upload, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import './omnivoice-library.css';

type LibraryProps = {
  addOnly?: boolean;
  preferredLanguage?: string;
  profiles?: OmniVoiceProfile[];
  service?: CreatorServicesSettingsService | null;
  disabled?: boolean;
  onAdd(profile: OmniVoiceProfile): Promise<boolean> | boolean;
  referenceAudio?: string;
  onSaveReference?(path: string): Promise<boolean> | boolean;
};

export function OmniVoiceLibrary(props: LibraryProps) {
  const l = useLocalizedCopy();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={trigger} type="button" className={props.addOnly ? 'settings-primary-button omni-library-add' : 'omni-library-trigger'} aria-haspopup="dialog" aria-expanded={open}
      disabled={props.addOnly && (!props.service?.uploadOmniVoiceReference || props.disabled)}
      onClick={() => setOpen(true)}>
      {props.addOnly ? <><Plus size={16} aria-hidden="true" />{l('添加音色', 'Add voice')}</> :
        <><Library size={16} aria-hidden="true" />{l('管理 OmniVoice 音色库', 'Manage OmniVoice voices')}<ChevronRight size={15} aria-hidden="true" /></>}
    </button>
    {open && createPortal(<LibraryDialog {...props} onClose={() => setOpen(false)} trigger={trigger.current} />, document.body)}
  </>;
}

function LibraryDialog({ profiles = [], service, disabled, referenceAudio = '', onSaveReference, onAdd, onClose, trigger, addOnly = false, preferredLanguage }:
  LibraryProps & { onClose(): void; trigger: HTMLButtonElement | null }) {
  const l = useLocalizedCopy();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [adding, setAdding] = useState(addOnly);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(referenceAudio);
  const [pathError, setPathError] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const locked = busy || disabled;
  const locale = l('zh', 'en');
  const groups = new Map<string, OmniVoiceProfile[]>();
  for (const profile of profiles) {
    const group = groups.get(profile.language);
    if (group) group.push(profile);
    else groups.set(profile.language, [profile]);
  }
  const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
  const languages = localOmniVoiceVoices().flatMap(voice =>
    voice.language ? [[voice.language, displayNames.of(voice.language) ?? voice.language] as const] : []);
  const languageLabels = new Map(languages);

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { element.close(); trigger?.focus(); };
  }, [trigger]);
  useEffect(() => { setPath(referenceAudio); }, [referenceAudio]);
  useEffect(() => { if (!adding) addButton.current?.focus(); }, [adding]);

  async function savePath() {
    if (!onSaveReference || locked || path.trim() === referenceAudio) return;
    setBusy(true);
    setPathError('');
    try {
      if (await onSaveReference(path.trim())) setPath(path.trim());
      else setPathError(l('路径未保存，请重试。', 'Could not save the path. Try again.'));
    } catch {
      setPathError(l('路径未保存，请重试。', 'Could not save the path. Try again.'));
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="omni-library-dialog" aria-labelledby={titleId}
    onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}
    onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
    <div className="omni-library-shell">
      <header className="omni-library-header">
        <span className="omni-library-mark"><AudioLines size={23} aria-hidden="true" /></span>
        <div><h2 id={titleId}>{l('OmniVoice 音色库', 'OmniVoice library')}</h2>
          <p>{addOnly ? l('用参考录音创建本地配音音色。', 'Create a local voice from a reference recording.')
            : l(`${profiles.length} 个音色 · ${groups.size} 种语言`, `${profiles.length} voices · ${groups.size} languages`)}</p></div>
        {!adding && <button ref={addButton} type="button" className="settings-primary-button omni-library-add" disabled={locked || !service?.uploadOmniVoiceReference}
          onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />{l('添加音色', 'Add voice')}</button>}
        <button type="button" className="omni-library-close" aria-label={l('关闭音色库', 'Close library')}
          disabled={locked} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      <div className="omni-library-body">
        {adding ? <ImportVoice profiles={profiles} preferredLanguage={preferredLanguage} service={service} disabled={locked} onAdd={onAdd}
          languages={languages} setBusy={setBusy} onDone={addOnly ? onClose : () => setAdding(false)} /> : <>
          <div className="omni-library-toolbar"><h3>{l('自定义音色', 'Custom voices')}</h3>
          </div>
          {groups.size ? [...groups.keys()].sort((a, b) => a.localeCompare(b, locale)).map(language =>
            <section key={language} className="omni-library-group"><h4>{languageLabels.get(language) ?? language}</h4>
              <ul>{groups.get(language)!.map(voice => <li key={voice.id}>
                <AudioLines size={16} aria-hidden="true" /><strong>{voice.name}</strong>
                <span>{[voice.region, voice.gender === 'male' ? l('男声', 'Male') : voice.gender === 'female' ? l('女声', 'Female') : undefined].filter(Boolean).join(' · ')}</span>
              </li>)}</ul>
            </section>) : <div className="omni-library-empty">
              <FileAudio size={30} strokeWidth={1.5} aria-hidden="true" />
              <strong>{l('还没有自定义音色', 'No custom voices yet')}</strong>
              <p>{l('添加一段参考录音，创建第一个音色。', 'Add a reference recording to create your first voice.')}</p>
            </div>}
          {onSaveReference && <details className="omni-library-advanced"><summary>{l('高级设置', 'Advanced settings')}</summary>
            <label>{l('默认参考录音路径（选填）', 'Default reference recording path (optional)')}
              <input value={path} disabled={locked} onChange={event => { setPath(event.target.value); setPathError(''); }} /></label>
            <button type="button" className="settings-secondary-button" disabled={locked || path.trim() === referenceAudio}
              onClick={() => void savePath()}>{l('应用路径', 'Apply path')}</button>
            {pathError && <p role="alert" className="settings-error">{pathError}</p>}
          </details>}
        </>}
      </div>
    </div>
  </dialog>;
}

function ImportVoice({ profiles = [], service, disabled, onAdd, languages, setBusy, onDone, preferredLanguage }: LibraryProps & {
  languages: ReadonlyArray<readonly [string, string]>;
  setBusy(value: boolean): void;
  onDone(): void;
}) {
  const l = useLocalizedCopy();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<OmniVoiceProfile['gender']>();
  const preferred = preferredLanguage?.toLowerCase().split(/[-_]/)[0];
  const [language, setLanguage] = useState(languages.find(([code]) => code === preferred)?.[0] ?? (preferred ? '' : 'id'));
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const uploaded = useRef<{ file: File; path: string }>();
  const pending = useRef(false);
  async function submit() {
    if (!service?.uploadOmniVoiceReference || !file || !name.trim() || !language || !gender || disabled || pending.current) return;
    setError('');
    if (file.size > 20 * 1024 * 1024) { setError(l('录音超过 20 MB。', 'The recording exceeds 20 MB.')); return; }
    if (profiles.some(v => v.language === language && v.name === name.trim())) {
      setError(l('该语言已有同名音色，请换一个名称。', 'This language already has a voice with that name.')); return;
    }
    pending.current = true;
    setBusy(true);
    try {
      if (uploaded.current?.file !== file) uploaded.current = { file, ...await service.uploadOmniVoiceReference(file) };
      const profile = { id: 'omnivoice-custom-' + crypto.randomUUID(), gender, language, name: name.trim(), referenceAudio: uploaded.current.path };
      if (await onAdd(profile)) onDone();
      else setError(l('音色未保存，请重试。', 'Could not save the voice. Try again.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : l('录音导入失败', 'Recording import failed'));
    } finally { pending.current = false; setBusy(false); }
  }

  return <form className="omni-library-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void submit(); }}>
    <h3>{l('添加音色', 'Add voice')}</h3>
    <fieldset disabled={disabled}>
      <label>{l('音色名称', 'Voice name')}<input autoFocus required maxLength={64} value={name}
        onChange={event => setName(event.target.value)} /></label>
      <div className="omni-library-pair">
        <label>{l('配音语言', 'Speech language')}<select required value={language} onChange={event => setLanguage(event.target.value)}>
          {!language && <option value="">{l('请选择语言', 'Choose language')}</option>}
          {languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>{l('声音性别', 'Voice gender')}<select required value={gender ?? ''} onChange={event => {
          const value = event.target.value;
          setGender(value === 'male' || value === 'female' ? value : undefined);
        }}>
          <option value="" disabled hidden>{l('请选择', 'Select')}</option>
          <option value="male">{l('男声', 'Male')}</option>
          <option value="female">{l('女声', 'Female')}</option>
        </select></label>
      </div>
      <label className="omni-library-recording"><span>{l('参考录音', 'Reference recording')}</span>
        <span className="omni-library-upload"><Upload size={19} aria-hidden="true" />
          <strong>{file?.name || l('选择录音文件', 'Choose recording')}</strong>
          <small>{l('WAV / MP3 · 最长 60 秒 · 最大 20 MB', 'WAV / MP3 · Up to 60 seconds · Max 20 MB')}</small>
          <input type="file" accept=".wav,.mp3" aria-label={l('参考录音', 'Reference recording')}
            onChange={event => { setFile(event.target.files?.[0]); setError(''); }} />
        </span>
      </label>
    </fieldset>
    {error && <p role="alert" className="settings-error">{error}</p>}
    <footer><button type="button" className="settings-secondary-button" disabled={disabled}
      onClick={onDone}>{l('取消', 'Cancel')}</button>
      <button type="submit" className="settings-primary-button" disabled={disabled || !file || !language || !gender || !name.trim() || !service?.uploadOmniVoiceReference}>
        {pending.current ? l('正在导入…', 'Importing…') : l('保存音色', 'Save voice')}</button></footer>
  </form>;
}
