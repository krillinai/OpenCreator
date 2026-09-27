import { useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import {
  captureCreatorClientFailure,
  useOptionalCreatorSession
} from './creator-session-store.js';

export function VideoTranslationSubtitleImport(props: { sourceLanguage: string; targetLanguage: string; disabled: boolean }) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [enabled, setEnabled] = useState(() => session?.job.artifacts.some(artifact => artifact.metadata.source === 'local-upload' && artifact.kind.endsWith('_subtitle')) ?? false);
  const [kind, setKind] = useState('source_subtitle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (session === null) return null;
  const imports = session.job.artifacts.filter(artifact => artifact.metadata.source === 'local-upload' && artifact.kind.endsWith('_subtitle'));

  async function importFile(file: File) {
    if (session === null) return;
    if (!/\.srt$/i.test(file.name) || file.size > 512 * 1024) {
      setError(l('请选择不超过 512 KiB 的 UTF-8 SRT 文件', 'Choose a UTF-8 SRT file up to 512 KiB'));
      return;
    }
    setBusy(true);
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
        fileName: file.name, contentBase64, kind,
        language: kind === 'source_subtitle' ? props.sourceLanguage : props.targetLanguage
      } });
    } catch {
      // The session records runtime and file-read failures in the shared Agent panel.
    } finally {
      setBusy(false);
    }
  }

  return <div className="video-translation-subtitle-import" role="group" aria-label={l('导入已有字幕', 'Import existing subtitles')}>
    <div className={`video-translation-toggle-row${props.disabled ? ' is-disabled' : ''}`}>
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
    </div>
    {enabled ? <fieldset className="video-translation-subtitle-import-fields video-translation-field" disabled={props.disabled || busy}>
      <label><span>{l('字幕类型', 'Subtitle type')}</span>
        <select value={kind} onChange={event => setKind(event.target.value)}>
          <option value="source_subtitle">{l('原文字幕（跳过语音识别）', 'Source subtitles (skip transcription)')}</option>
          <option value="target_subtitle">{l('已翻译字幕（跳过识别和翻译）', 'Translated subtitles (skip transcription and translation)')}</option>
        </select>
      </label>
      <label><span>{l('UTF-8 SRT 文件', 'UTF-8 SRT file')}</span>
        <input type="file" accept=".srt" onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }} />
      </label>
      <p>{l('语言沿用上方选择。仅有译文时不会生成双语字幕。', 'Uses the language selected above. A translated-only import does not generate bilingual subtitles.')}</p>
      {busy ? <p role="status">{l('正在导入字幕…', 'Importing subtitles…')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {imports.map(artifact => <details key={artifact.id}>
        <summary>{l('本地导入', 'Local import')} · {String(artifact.metadata.fileName)} · {String(artifact.metadata.language)} · {String(artifact.metadata.cueCount)} {l('条字幕', 'cues')} · v{artifact.version}</summary>
        <pre>{Array.isArray(artifact.metadata.cues) ? artifact.metadata.cues.map(cue => cue !== null && typeof cue === 'object' && !Array.isArray(cue) ? `${cue.start} → ${cue.end}\n${cue.text}` : '').join('\n\n') : ''}</pre>
      </details>)}
    </fieldset> : null}
  </div>;
}
