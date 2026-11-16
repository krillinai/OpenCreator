import AppSelect from '../../components/forms/Select.js';
import { useId, useRef, useState } from 'react';
import { FileVideo, X } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import {
  captureCreatorClientFailure,
  useOptionalCreatorSession
} from './creator-session-store.js';

export function VideoTranslationSubtitleImport(props: {
  sourceLanguage: string;
  targetLanguage: string;
  disabled: boolean;
  sourceOnly?: boolean;
  compact?: boolean;
  mediaOnly?: boolean;
  accept?: string;
  onMediaFile?(file: File): void;
  onBusyChange?(busy: boolean): void;
  onError?(message: string): void;
  onImported?(): void;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [enabled, setEnabled] = useState(() => session?.job.artifacts.some(artifact => artifact.metadata.source === 'local-upload' && artifact.kind.endsWith('_subtitle')) ?? false);
  const [kind, setKind] = useState('source_subtitle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (session === null) return null;
  const imports = session.job.artifacts.filter(artifact => artifact.metadata.source === 'local-upload'
    && (props.sourceOnly ? artifact.id === session.state.importedSourceSubtitleId : artifact.kind.endsWith('_subtitle')));

  async function importFile(file: File) {
    if (session === null) return;
    if (!/\.srt$/i.test(file.name) || file.size > 512 * 1024) {
      const message = l('请选择不超过 512 KiB 的 UTF-8 SRT 文件', 'Choose a UTF-8 SRT file up to 512 KiB');
      setError(message);
      props.onError?.(message);
      return;
    }
    setBusy(true);
    props.onBusyChange?.(true);
    setError('');
    try {
      const contentBase64 = await captureCreatorClientFailure(
        session,
        'creator.read-subtitle-file',
        l('字幕文件读取失败，请检查文件后重试。', 'The subtitle file could not be read. Check the file and try again.'),
        () => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]!);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        })
      );
      await session.applyAction({ action: 'import-subtitle', input: {
        fileName: file.name, contentBase64, kind: props.sourceOnly ? 'source_subtitle' : kind,
        language: props.sourceOnly || kind === 'source_subtitle' ? 'auto' : props.targetLanguage
      } });
      props.onImported?.();
    } catch {
      if (props.compact) {
        const message = l('字幕导入失败，请检查文件后重试。', 'Could not import the subtitles. Check the file and try again.');
        setError(message);
        props.onError?.(message);
      }
    } finally {
      setBusy(false);
      props.onBusyChange?.(false);
    }
  }

  if (props.compact) {
    const fileName = String(imports.at(-1)?.metadata.fileName ?? '') || selectedFileName;
    const unified = props.onMediaFile !== undefined;
    const uploadLabel = props.mediaOnly
      ? l('上传视频或音频', 'Upload video or audio')
      : l('上传视频、音频或 SRT 字幕', 'Upload video, audio, or SRT subtitles');
    return (
      <label className="image-generation-reference-upload dashboard-translation-subtitle-upload" title={unified ? uploadLabel : l('上传需要翻译的 SRT 字幕', 'Upload SRT subtitles to translate')}>
        <input
          id={fileInputId}
          ref={fileInputRef}
          type="file"
          accept={props.accept ?? '.srt'}
          aria-label={unified ? uploadLabel : l('上传字幕文件', 'Upload subtitle file')}
          disabled={props.disabled || busy}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              if (props.mediaOnly && /\.srt$/i.test(file.name)) {
                const message = l('请选择视频或音频文件', 'Choose a video or audio file');
                setError(message);
                props.onError?.(message);
                return;
              }
              setSelectedFileName(file.name);
              if (!/\.srt$/i.test(file.name) && props.onMediaFile) props.onMediaFile(file);
              else void importFile(file);
            }
          }}
        />
        <span className="image-generation-reference-thumbnail"><FileVideo size={23} strokeWidth={1.5} /></span>
        <span className="image-generation-reference-copy">
          <span>
            <strong>{fileName || (unified ? props.mediaOnly ? l('视频 / 音频', 'Video / Audio') : l('视频 / 音频 / SRT', 'Video / Audio / SRT') : l('字幕', 'Subs'))}</strong>
            <small>{busy ? l('正在导入…', 'Importing…') : fileName ? l('已选择文件', 'File selected') : unified ? l('点击上传', 'Choose file') : 'SRT'}</small>
          </span>
        </span>
      </label>
    );
  }

  return <div className="video-translation-subtitle-import" role="group" aria-label={l('导入已有字幕', 'Import existing subtitles')}>
    {!props.sourceOnly ? <div className={`video-translation-toggle-row${props.disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{l('导入已有字幕', 'Import existing subtitles')}</strong>
        <small>{l('使用本地 SRT 字幕文件', 'Use a local SRT subtitle file')}</small>
      </span>
      <button
        className="video-translation-switch"
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={l('导入已有字幕', 'Import existing subtitles')}
        disabled={props.disabled}
        onClick={() => setEnabled(value => !value)}
      >
        <span />
      </button>
    </div> : null}
    {enabled || props.sourceOnly ? <fieldset className="video-translation-subtitle-import-fields video-translation-field" disabled={props.disabled || busy}>
      {!props.sourceOnly ? <label><span>{l('字幕类型', 'Subtitle type')}</span>
        <AppSelect value={kind} onChange={event => setKind(event.target.value)}>
          <option value="source_subtitle">{l('原文字幕（跳过语音识别）', 'Source subtitles (skip transcription)')}</option>
          <option value="target_subtitle">{l('已翻译字幕（跳过识别和翻译）', 'Translated subtitles (skip transcription and translation)')}</option>
        </AppSelect>
      </label> : null}
      <div className="video-translation-subtitle-file-field">
        <label htmlFor={fileInputId}>{l('UTF-8 SRT 文件', 'UTF-8 SRT file')}</label>
        <div className="video-translation-subtitle-file-picker">
          <input ref={fileInputRef} id={fileInputId} className="app-visually-hidden" tabIndex={-1} type="file" accept=".srt" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              setSelectedFileName(file.name);
              void importFile(file);
            }
          }} />
          <button type="button" onClick={() => fileInputRef.current?.click()}>{props.sourceOnly && imports.length > 0 ? l('更换文件', 'Replace file') : l('选择文件', 'Choose file')}</button>
          <span aria-live="polite">{String(imports.at(-1)?.metadata.fileName ?? '') || selectedFileName || l('未选择文件', 'No file selected')}</span>
          {props.sourceOnly && imports.length > 0 ? <button
            type="button"
            className="video-translation-subtitle-remove"
            aria-label={l('移除字幕', 'Remove subtitles')}
            title={l('移除字幕', 'Remove subtitles')}
            onClick={() => {
              setSelectedFileName('');
              setError('');
              if (fileInputRef.current) fileInputRef.current.value = '';
              session.updateDraft({ importedSourceSubtitleId: null, importedTargetSubtitleId: null });
            }}
          ><X size={16} aria-hidden="true" /></button> : null}
        </div>
      </div>
      {!props.sourceOnly ? <p>{l('原文字幕自动识别语言，识别后可修改源语言。译文沿用上方目标语言；仅有译文时不会生成双语字幕。', 'Source subtitle language is detected automatically and can be changed. Translated subtitles use the selected target language; a translated-only import does not generate bilingual subtitles.')}</p> : null}
      {busy ? <p role="status">{l('正在导入字幕…', 'Importing subtitles…')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {imports.map(artifact => <details key={artifact.id} open={props.sourceOnly}>
        <summary>{l('本地导入', 'Local import')} · {String(artifact.metadata.fileName)} · {artifact.metadata.language === 'auto' ? l('语言待确认', 'Language unconfirmed') : String(artifact.metadata.language)} · {String(artifact.metadata.cueCount)} {l('条字幕', 'cues')} · v{artifact.version}</summary>
        <pre>{Array.isArray(artifact.metadata.cues) ? artifact.metadata.cues.map(cue => cue !== null && typeof cue === 'object' && !Array.isArray(cue) ? `${cue.start} → ${cue.end}\n${cue.text}` : '').join('\n\n') : ''}</pre>
      </details>)}
    </fieldset> : null}
  </div>;
}
