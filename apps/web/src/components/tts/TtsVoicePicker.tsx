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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  onChange(voiceId: string, voice?: CreatorTtsVoice): void;
  onVoiceResolved?(voice: CreatorTtsVoice): void;
}) {
  const l = useLocalizedCopy();
  const [voices, setVoices] = useState<CreatorTtsVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
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

  const options = useMemo(() => {
    if (!props.value || voices.some(voice => voice.id === props.value)) return voices;
    return [{
      id: props.value,
      name: props.value,
      provider: props.provider,
      kind: 'custom' as const
    }, ...voices];
  }, [props.provider, props.value, voices]);
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
            props.onChange(event.target.value, voice);
          }}
        >
          {options.length === 0 ? (
            <option value="">
              {loading
                ? l('正在加载音色', 'Loading voices')
                : l('暂无可用音色', 'No voices available')}
            </option>
          ) : null}
          {options.map(voice => (
            <option key={voice.id} value={voice.id}>
              {voiceLabel(voice, l)}
            </option>
          ))}
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
      {selected ? (
        <small className="tts-voice-picker-meta">
          {[selected.scenario, selected.language, voiceKindLabel(selected.kind, l)]
            .filter(Boolean)
            .join(' · ')}
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
