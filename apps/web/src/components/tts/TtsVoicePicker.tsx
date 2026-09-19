import type {
  CreatorTtsProvider,
  CreatorTtsVoice
} from '@opencreator/protocol';
import {
  LoaderCircle,
  Pause,
  Play,
  RefreshCw
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import './tts-voice-picker.css';

export function TtsVoicePicker(props: {
  id: string;
  provider: CreatorTtsProvider;
  model: string;
  value: string;
  service: Pick<CreatorServicesSettingsService, 'getTtsVoices' | 'previewTtsVoice'> | null;
  label?: string;
  disabled?: boolean;
  allowCustomVoice?: boolean;
  onChange(voiceId: string, voice?: CreatorTtsVoice): void;
  onVoiceResolved?(voice: CreatorTtsVoice): void;
}) {
  const l = useLocalizedCopy();
  const allowCustomVoice = props.allowCustomVoice ?? props.provider === 'volcengine';
  const [voices, setVoices] = useState<CreatorTtsVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [customId, setCustomId] = useState(props.value);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewUrlRef = useRef('');
  const onVoiceResolvedRef = useRef(props.onVoiceResolved);
  onVoiceResolvedRef.current = props.onVoiceResolved;

  useEffect(() => {
    let active = true;
    if (props.service === null || props.provider === 'edge-tts') {
      setVoices([]);
      setError('');
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError('');
    void props.service.getTtsVoices(props.provider, props.model)
      .then(response => {
        if (!active) return;
        setVoices(response.voices);
      })
      .catch(() => {
        if (active) {
          setVoices([]);
          setError(l('无法加载音色列表', 'Could not load voices'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.model, props.provider, props.service, reloadToken]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    setCustomId(props.value);
  }, [props.value]);

  const options = useMemo(() => {
    if (!props.value || voices.some(voice => voice.id === props.value)) return voices;
    return [{
      id: props.value,
      name: props.value,
      provider: props.provider,
      kind: 'custom' as const
    }, ...voices];
  }, [props.provider, props.value, voices]);
  const groupedOptions = useMemo(() => groupVoices(options), [options]);
  const selected = options.find(voice => voice.id === props.value);

  useEffect(() => {
    if (selected) onVoiceResolvedRef.current?.(selected);
  }, [selected]);

  function stopPreview() {
    if (audioRef.current?.getAttribute('src')) {
      audioRef.current.pause();
    }
    setPlaying(false);
  }

  function commitCustomVoice(raw: string) {
    const voiceId = raw.trim();
    setCustomId(voiceId);
    if (voiceId === props.value) return;
    stopPreview();
    const voice = options.find(candidate => candidate.id === voiceId);
    props.onChange(voiceId, voice ?? {
      id: voiceId,
      name: voiceId,
      provider: props.provider,
      kind: 'custom'
    });
  }

  async function preview() {
    if (playing) {
      stopPreview();
      return;
    }
    if (
      props.service === null
      || props.provider === 'edge-tts'
      || !props.value
      || previewing
    ) return;
    setPreviewing(true);
    setError('');
    try {
      const response = await props.service.previewTtsVoice({
        provider: props.provider,
        model: props.model,
        voiceId: props.value
      });
      const url = URL.createObjectURL(await response.blob());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = url;
      await audio.play();
      setPlaying(true);
    } catch {
      setError(l('音色试听失败，请检查 API Key 和网络', 'Voice preview failed. Check the API key and network.'));
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="tts-voice-picker">
      <label htmlFor={props.id}>
        <span>{props.label ?? l('默认音色', 'Default voice')}</span>
        <select
          id={props.id}
          value={props.value}
          disabled={props.disabled || loading || props.provider === 'edge-tts'}
          onChange={event => {
            stopPreview();
            const voice = options.find(candidate => candidate.id === event.target.value);
            setCustomId(event.target.value);
            props.onChange(event.target.value, voice);
          }}
        >
          {options.length === 0 ? (
            <option value={props.value}>
              {loading
                ? l('正在加载音色', 'Loading voices')
                : allowCustomVoice
                  ? l('请填写下方 Speaker ID', 'Enter a speaker ID below')
                  : l('暂无可用音色', 'No voices available')}
            </option>
          ) : null}
          {groupedOptions.map(group => {
            const items = group.voices.map(voice => (
              <option key={voice.id} value={voice.id}>
                {voiceLabel(voice, l)}
              </option>
            ));
            if (!group.label) {
              return <Fragment key="ungrouped">{items}</Fragment>;
            }
            return (
              <optgroup key={group.label} label={group.label}>
                {items}
              </optgroup>
            );
          })}
        </select>
      </label>
      <div className="tts-voice-picker-actions">
        <button
          type="button"
          disabled={props.disabled || loading || props.service === null || props.provider === 'edge-tts'}
          aria-label={l('刷新音色列表', 'Refresh voices')}
          title={l('刷新音色列表', 'Refresh voices')}
          onClick={() => setReloadToken(current => current + 1)}
        >
          {loading
            ? <LoaderCircle className="tts-voice-picker-spinner" size={16} aria-hidden="true" />
            : <RefreshCw size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          disabled={props.disabled || !selected || props.service === null || props.provider === 'edge-tts' || previewing}
          aria-label={playing ? l('暂停音色试听', 'Pause voice preview') : l('试听当前音色', 'Preview selected voice')}
          title={playing ? l('暂停', 'Pause') : l('试听', 'Preview')}
          onClick={() => void preview()}
        >
          {previewing
            ? <LoaderCircle className="tts-voice-picker-spinner" size={16} aria-hidden="true" />
            : playing
              ? <Pause size={16} aria-hidden="true" />
              : <Play size={16} aria-hidden="true" />}
        </button>
      </div>
      <audio ref={audioRef} hidden onEnded={() => setPlaying(false)} />
      {allowCustomVoice ? (
        <label className="tts-voice-picker-custom" htmlFor={`${props.id}-custom`}>
          <span>{l('克隆 / 自定义 Speaker ID', 'Clone / custom speaker ID')}</span>
          <input
            id={`${props.id}-custom`}
            type="text"
            value={customId}
            placeholder={l('例如 S_xxxxxxxx 或官方音色 ID', 'e.g. S_xxxxxxxx or an official voice ID')}
            spellCheck={false}
            autoComplete="off"
            disabled={props.disabled || props.provider === 'edge-tts'}
            onChange={event => setCustomId(event.target.value)}
            onBlur={() => commitCustomVoice(customId)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitCustomVoice(customId);
              }
            }}
          />
        </label>
      ) : null}
      {selected ? (
        <small className="tts-voice-picker-meta">
          {[selected.scenario, selected.language, voiceKindLabel(selected.kind, l)]
            .filter(Boolean)
            .join(' · ')}
        </small>
      ) : allowCustomVoice && !loading ? (
        <small className="tts-voice-picker-meta">
          {l(
            '声音复刻请填写控制台中的 Speaker ID（S_ 开头）。',
            'For cloned voices, enter the console Speaker ID starting with S_.'
          )}
        </small>
      ) : null}
      {error ? <small className="tts-voice-picker-error" role="alert">{error}</small> : null}
    </div>
  );
}

function voiceLabel(
  voice: CreatorTtsVoice,
  l: (zh: string, en: string) => string
): string {
  const recommended = voice.recommended ? ` · ${l('推荐', 'Recommended')}` : '';
  return voice.name === voice.id
    ? `${voice.name}${recommended}`
    : `${voice.name} (${voice.id})${recommended}`;
}

function voiceKindLabel(
  kind: CreatorTtsVoice['kind'],
  l: (zh: string, en: string) => string
): string {
  if (kind === 'custom') return l('自定义音色', 'Custom');
  if (kind === 'designed') return l('设计音色', 'Designed');
  return '';
}

function groupVoices(voices: CreatorTtsVoice[]): Array<{
  label: string;
  voices: CreatorTtsVoice[];
}> {
  const groups: Array<{ label: string; voices: CreatorTtsVoice[] }> = [];
  const index = new Map<string, number>();
  for (const voice of voices) {
    const label = voice.kind === 'custom' ? '' : (voice.scenario ?? '');
    const existing = index.get(label);
    if (existing === undefined) {
      index.set(label, groups.length);
      groups.push({ label, voices: [voice] });
      continue;
    }
    groups[existing]!.voices.push(voice);
  }
  return groups;
}
