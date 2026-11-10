import {
  smartDubbingStyles, gatewayModelDisplayName, gatewayModelIdMatches,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorServicesConfig,
  type CreatorTtsProvider,
  type SmartDubbingFormat,
  type SmartDubbingStyle,
  type SmartDubbingVoice
} from '@opencreator/protocol';
import { useGenerationAccess } from './DashboardGenerationAccess.js';
import {
  Download,
  FileAudio,
  Gauge,
  LoaderCircle,
  Mic2,
  RotateCcw,
  Trash2,
  WandSparkles
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import AppSelect from '../../components/forms/Select.js';
import ModelBrandIcon from '../../components/brand/ModelBrandIcon.js';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import DashboardVideoTranslationSettings from './DashboardVideoTranslationSettings.js';
import { OfficialModelField, useOfficialServices } from './official-services.js';
import {
  createCreatorArtifactObjectUrl,
  useOptionalCreatorSession
} from './creator-session-store.js';
import './smart-dubbing-workspace.css';

type DubbingResult = {
  artifact: CreatorArtifact;
  fileName: string;
  size: number;
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>;
  model: string;
  voice: string;
  voiceName: string;
  style: SmartDubbingStyle;
  speed: number;
  format: SmartDubbingFormat;
  characterCount: number;
};

const styles: Array<{ value: SmartDubbingStyle; zh: string; en: string }> = [
  { value: 'natural', zh: '自然', en: 'Natural' },
  { value: 'professional', zh: '专业', en: 'Professional' },
  { value: 'warm', zh: '温暖', en: 'Warm' },
  { value: 'energetic', zh: '活力', en: 'Energetic' },
  { value: 'calm', zh: '沉静', en: 'Calm' },
  { value: 'storytelling', zh: '叙事', en: 'Storytelling' }
];

const sampleTextZh = '每一个好故事，都从一个清晰的想法开始。让声音带着恰当的节奏和情绪，把内容自然地传递给听众。';
const sampleTextEn = 'Every strong story begins with a clear idea. Give it the right pace and emotion, then let the voice carry it naturally to the audience.';

export default function SmartDubbingWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  embedded?: boolean;
  embeddedTabs?: ReactNode;
  forceComposer?: boolean;
  onGenerated?(): void;
  creatorServicesService?: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const requireGenerationAccess = useGenerationAccess();
  const session = useOptionalCreatorSession();
  const official = useOfficialServices('speech');
  const supportsStyle = !official.official || official.model?.capabilities.includes('speech_instructions') === true;
  const supportsSpeed = !official.official || official.model?.capabilities.includes('speech_speed') === true;
  const [submitting, setSubmitting] = useState(false);
  const [text, setText] = useState(() => readString(session?.state.text));
  const [provider, setProvider] = useState<CreatorTtsProvider>(() => (
    readProvider(session?.state.ttsProvider) ?? 'openai'
  ));
  const [model, setModel] = useState(() => readString(session?.state.ttsModel) || 'gpt-4o-mini-tts');
  const [voice, setVoice] = useState<SmartDubbingVoice>(() => readString(session?.state.voiceCode));
  const [voiceName, setVoiceName] = useState(() => readString(session?.state.voiceName));
  const [style, setStyle] = useState<SmartDubbingStyle>(() => readStyle(session?.state.style));
  const [speed, setSpeed] = useState(() => readSpeed(session?.state.speed));
  const [format, setFormat] = useState<SmartDubbingFormat>(() => readFormat(session?.state.format));
  const [audioUrl, setAudioUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const characterCount = useMemo(() => [...text.trim()].length, [text]);
  const selectedStyle = styles.find(item => item.value === style) ?? styles[0]!;
  const result = useMemo(
    () => props.forceComposer ? undefined : readLatestResult(session?.job.artifacts ?? []),
    [props.forceComposer, session?.job.artifacts]
  );
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'tts').at(-1);
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const busy = generating || submitting;
  const runtimeError = latestStage?.status === 'failed'
    ? formatGenerationError({ code: latestStage.errorCode, message: latestStage.errorMessage }, l)
    : session?.error === null || session?.error === undefined
      ? ''
      : formatGenerationError(session.error, l);
  const visibleError = error || runtimeError;
  const [config, setConfig] = useState<CreatorServicesConfig>();
  const modelOptions = useMemo(() => {
    if (config === undefined) return [];
    const providers = ['openai', 'minimax', 'aliyun', 'volcengine'] as const;
    return providers.map(nextProvider => {
      const nextModel = config.tts[nextProvider].model;
      return {
        provider: nextProvider,
        model: nextModel,
        value: `${nextProvider}:${nextModel}`,
        label: `${providerLabel(nextProvider, l)} · ${nextModel}`
      };
    });
  }, [config, l]);
  const settingsHref = shouldOpenTtsSettings(
    provider,
    latestStage?.errorCode,
    session?.error?.code
  ) ? '#/settings?tab=ai-services&section=tts' : undefined;

  useEffect(() => {
    if (official.official) {
      setProvider('openai'); setModel(official.model?.id ?? '');
      if (!supportsStyle) setStyle('natural');
      if (!supportsSpeed) setSpeed(1);
      const voices = official.model?.voices ?? [];
      if (!voices.includes(voice)) { setVoice(voices[0] ?? ''); setVoiceName(voices[0] ?? ''); }
      return;
    }
    let active = true;
    if (props.creatorServicesService === null || props.creatorServicesService === undefined) {
      return () => { active = false; };
    }
    void props.creatorServicesService.getConfig()
      .then(response => {
        if (!active) return;
        setConfig(response.config);
        const configuredProvider = response.config.tts.provider;
        const selectedProvider = readProvider(session?.state.ttsProvider) ?? configuredProvider;
        setProvider(selectedProvider);
        if (selectedProvider === 'edge-tts') {
          setModel('');
          setVoice('');
          setVoiceName('');
          return;
        }
        const selectedConfig = response.config.tts[selectedProvider];
        setModel(readString(session?.state.ttsModel) || selectedConfig.model);
        setVoice(readString(session?.state.voiceCode) || selectedConfig.defaultVoiceId);
        setVoiceName(readString(session?.state.voiceName) || selectedConfig.defaultVoiceId);
      })
      .catch(cause => {
        if (!active) return;
        session?.captureCreatorFailure(
          'smart-dubbing.load-service-config',
          cause,
          l('无法读取配音服务配置，请稍后重试。', 'Could not load TTS settings. Try again later.'),
          'client'
        );
      });
    return () => { active = false; };
  }, [props.creatorServicesService, session?.job.id, official.official, official.model?.id, supportsStyle, supportsSpeed]);

  useEffect(() => {
    if (session === null || result === undefined) {
      setAudioUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return '';
      });
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    void createCreatorArtifactObjectUrl(
      session,
      result.artifact.id,
      'smart-dubbing.load-audio-preview',
      l('配音音频加载失败，可以稍后重试或重新生成。', 'Dubbing audio failed to load. Retry later or generate it again.')
    )
      .then(url => {
        objectUrl = url;
        if (active) setAudioUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [l, result?.artifact.id, session?.captureCreatorFailure, session?.openArtifact]);

  useEffect(() => {
    if (result !== undefined && !generating) {
      setNotice(l('配音已生成，可以试听或下载音频', 'Dubbing is ready to preview or download'));
    }
  }, [generating, l, result?.artifact.id]);

  function changeModel(value: string) {
    const choice = modelOptions.find(option => option.value === value);
    if (choice === undefined) return;
    setProvider(choice.provider);
    setModel(choice.model);
    setError('');
    const defaultVoiceId = config?.tts[choice.provider].defaultVoiceId ?? '';
    setVoice(defaultVoiceId);
    setVoiceName(defaultVoiceId);
    session?.updateDraft({
      ttsProvider: choice.provider,
      ttsModel: choice.model,
      voiceCode: defaultVoiceId,
      voiceName: defaultVoiceId
    });
    if (config !== undefined && props.creatorServicesService?.saveConfig !== undefined) {
      const nextConfig = structuredClone(config);
      nextConfig.tts.provider = choice.provider;
      nextConfig.tts[choice.provider].model = choice.model;
      void props.creatorServicesService.saveConfig(nextConfig)
        .then(response => setConfig(response.config))
        .catch(() => setError(l('模型保存失败，请稍后重试', 'Could not save the model. Try again.')));
    }
  }

  function updateText(value: string) {
    setText(value);
    session?.updateDraft({ text: value });
    setError('');
  }

  function updateStyle(value: SmartDubbingStyle) {
    setStyle(value);
    session?.updateDraft({ style: value });
    setError('');
  }

  function updateSpeed(value: number) {
    setSpeed(value);
    session?.updateDraft({ speed: value });
    setError('');
  }

  function updateFormat(value: SmartDubbingFormat) {
    setFormat(value);
    session?.updateDraft({ format: value });
    setError('');
  }

  async function generate() {
    if (!requireGenerationAccess()) return;
    if (official.official && !official.ready) { setError(l('官方语音服务暂不可用，请在账户页面检查连接状态', 'Official speech service is unavailable. Check your account.')); return; }
    if (busy) return;
    if (session === null) {
      setError(l('文本转语音服务暂不可用，请检查 Runtime 连接', 'Text to Speech is unavailable. Check the Runtime connection.'));
      return;
    }
    if (!text.trim()) {
      setError(l('请先填写需要配音的文案', 'Enter the script to be voiced'));
      return;
    }
    if (!voice.trim()) {
      setError(l('请选择一个可用音色', 'Select an available voice'));
      return;
    }
    if (provider === 'edge-tts') {
      setError(l(
        '文本转语音暂不支持 Edge TTS，请先在设置中选择阿里云百炼、OpenAI 或 MiniMax',
        'Text to Speech does not support Edge TTS. Select Alibaba Cloud, OpenAI, or MiniMax in Settings.'
      ));
      return;
    }
    setError('');
    setNotice('');
    setSubmitting(true);
    session.updateDraft({
      text: text.trim(),
      ttsProvider: official.official ? 'openai' : provider,
      ttsModel: official.official ? official.model?.id ?? '' : model,
      voiceCode: voice,
      voiceName: voiceName || voice,
      style,
      speed,
      format,
      ...(official.official ? official.draftPatch : {})
    }, { semantic: true });
    try {
      await session.flush();
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'tts' }
      });
      setNotice(l('配音任务已提交，完成后会自动显示音频', 'Dubbing started. The audio will appear automatically.'));
      props.onGenerated?.();
    } catch {} finally {
      setSubmitting(false);
    }
  }

  function download() {
    if (!result || !audioUrl) return;
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = result.fileName;
    link.click();
    setNotice(l('配音音频已开始下载', 'The dubbing audio download has started'));
  }

  async function cancelTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('canceling');
    try {
      await session.cancelJob();
    } catch {} finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    try {
      await session.resumeJob();
    } catch {} finally {
      setTaskControlPending(undefined);
    }
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updateText(l(sampleTextZh, sampleTextEn));
      return l('示例文案已填入，可以继续选择音色。', 'The sample script is ready. Continue to voice selection.');
    }
    const styleMatch = styles.find(item => (
      command.includes(item.zh) || command.toLowerCase().includes(item.en.toLowerCase())
    ));
    if (styleMatch && supportsStyle) {
      updateStyle(styleMatch.value);
      return l(`表达风格已改为${styleMatch.zh}。`, `Delivery style changed to ${styleMatch.en}.`);
    }
    if (supportsSpeed && /快一点|加快|faster/i.test(command)) {
      updateSpeed(Math.min(1.25, Math.round((speed + 0.1) * 100) / 100));
      return l('语速已加快。', 'The speaking rate is faster.');
    }
    if (supportsSpeed && /慢一点|减慢|slower/i.test(command)) {
      updateSpeed(Math.max(0.75, Math.round((speed - 0.1) * 100) / 100));
      return l('语速已放慢。', 'The speaking rate is slower.');
    }
    if (command.trim().length > 12) {
      updateText(command.trim());
      return l('文案已同步到左侧，可以继续设置音色和表达。', 'The script is synchronized on the left. Continue with voice and delivery settings.');
    }
    return l('可以发送配音文案，或告诉我需要自然、专业、温暖、活力、沉静或叙事风格。', 'Send a script, or ask for a natural, professional, warm, energetic, calm, or storytelling delivery.');
  }

  const settingsSnapshot = result?.artifact.metadata.settingsSnapshot;
  const resultSettings = settingsSnapshot !== null
    && typeof settingsSnapshot === 'object'
    && !Array.isArray(settingsSnapshot)
      ? settingsSnapshot as Record<string, CreatorJson>
      : undefined;
  const resultModelId = result?.model || model || '';
  const resultModelLabel = gatewayModelDisplayName(official.models.find(candidate => gatewayModelIdMatches(candidate.id, resultModelId)) ?? { id: resultModelId }, l('官方模型', 'Official model'));
  const summaryText = result ? readString(resultSettings?.text) || text.trim() : text.trim();
  const summaryStyle = result
    ? styles.find(item => item.value === result.style) ?? selectedStyle
    : selectedStyle;
  const summary = (
    <CreatorTaskSummary
      sourceIcon={FileAudio}
      sourceLabel={l('配音文案', 'Script')}
      sourceValue={summaryText || '—'}
      compactSummary={`${result?.voiceName || voiceName || voice || providerLabel(provider, l)} · ${(result?.format ?? format).toUpperCase()}`}
      items={[
        { label: l('服务商', 'Provider'), value: providerLabel(result?.provider ?? provider, l) },
        { label: l('模型', 'Model'), value: resultModelId ? resultModelLabel : '—' },
        { label: l('音色', 'Voice'), value: result?.voiceName || voiceName || voice || '—' },
        ...(result || supportsStyle ? [{ label: l('表达风格', 'Delivery'), value: l(summaryStyle.zh, summaryStyle.en) }] : []),
        ...(result || supportsSpeed ? [{ label: l('语速', 'Speed'), value: `${(result?.speed ?? speed).toFixed(2)}x` }] : []),
        { label: l('音频格式', 'Format'), value: (result?.format ?? format).toUpperCase() },
        { label: l('文案长度', 'Length'), value: l(`${result?.characterCount ?? characterCount} 字`, `${result?.characterCount ?? characterCount} characters`) }
      ]}
    />
  );

  return (
    <CreatorToolShell
      embedded={props.embedded && !result}
      title={l('文本转语音', 'Text to Speech')}
      subtitle={l('自然音色、表达风格与可下载音频', 'Natural voices, expressive delivery, and downloadable audio')}
      context={busy
        ? l('正在生成配音', 'Generating dubbing')
        : result
          ? l(`${result.format.toUpperCase()} 配音已完成`, `${result.format.toUpperCase()} dubbing ready`)
          : `${voiceName || voice || providerLabel(provider, l)} · ${speed.toFixed(2)}x`}
      taskSummary={summary}
      stepLabel={busy ? l('正在生成配音', 'Generating dubbing') : l('文本转语音', 'Text to Speech')}
      currentIssue={visibleError || undefined}
      suggestions={result
        ? [l('换成温暖风格', 'Use a warm style'), l('语速慢一点', 'Make it slower')]
        : [l('填入示例文案', 'Use a sample script'), l('使用专业风格', 'Use a professional style')]}
      placeholder={props.promptHint ?? l('输入配音文案或调整要求', 'Enter a script or delivery request')}
      onBack={props.onBack}
      onCommand={handleCommand}
      onCancelTask={() => void cancelTask()}
      onResumeTask={() => void resumeTask()}
      taskControlPending={taskControlPending}
      pageClassName="smart-dubbing-workspace-page"
      contentClassName="smart-dubbing-workspace-content"
    >
      <div className="creator-tool-stack smart-dubbing-studio">
        <form className={`smart-dubbing-composer${props.embedded ? ' image-generation-composer dashboard-speech-composer' : ''}`} aria-label={l('文本转语音', 'Text to Speech')} onSubmit={event => {
          event.preventDefault();
          void generate();
        }}>
          <fieldset className={`smart-dubbing-fields${props.embedded ? ' image-generation-fields' : ''}`} disabled={busy}>
            <div className="smart-dubbing-main-fields">
              <div className={`smart-dubbing-editor${props.embedded ? ' image-generation-editor' : ''}`}>
                <div className={`smart-dubbing-editor-heading${props.embedded ? ' image-generation-composer-heading' : ''}`}>
                  {props.embedded ? props.embeddedTabs : (
                    <h2 id="smart-dubbing-script-title"><Mic2 size={18} strokeWidth={1.7} aria-hidden="true" />{l('配音文案', 'Dubbing script')}</h2>
                  )}
                </div>
                <div className="creator-tool-field smart-dubbing-script-field">
                  <textarea
                    id="smart-dubbing-script-input"
                    rows={5}
                    maxLength={5000}
                    value={text}
                    onChange={event => updateText(event.target.value)}
                    placeholder={l('输入需要转换为语音的文案', 'Enter the script to convert into speech')}
                    aria-label={l('配音文案内容', 'Dubbing script content')}
                  />
                </div>
                <div className="smart-dubbing-script-tools">
                  <button className="smart-dubbing-sample" type="button" onClick={() => updateText(l(sampleTextZh, sampleTextEn))}>
                    <WandSparkles size={15} strokeWidth={1.8} aria-hidden="true" />
                    {l('填入示例文案', 'Use sample script')}
                  </button>
                  <button className="smart-dubbing-clear" type="button" disabled={!text} aria-label={l('清空文案', 'Clear script')} title={l('清空文案', 'Clear script')} onClick={() => updateText('')}>
                    <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  <small dir="ltr">{characterCount} / 5000</small>
                </div>
              </div>
            </div>
            <div className={props.embedded ? 'smart-dubbing-side-fields image-generation-action-bar dashboard-speech-action-bar' : 'smart-dubbing-side-fields'}>
              <div className={props.embedded ? 'smart-dubbing-model-row image-generation-model-row' : 'smart-dubbing-model-row'}>
                {official.official ? <OfficialModelField label={l('模型', 'Model')} service={official} disabled={busy} /> : (
                  <AppSelect
                    aria-label={l('语音模型', 'Speech model')}
                    value={`${provider}:${model}`}
                    disabled={busy || modelOptions.length === 0}
                    renderOptionIcon={value => <ModelBrandIcon model={{ id: value }} />}
                    onChange={event => changeModel(event.target.value)}
                  >
                    {modelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </AppSelect>
                )}
              </div>
              {props.embedded ? (
                <DashboardVideoTranslationSettings
                  label={l('语音设置', 'Speech settings')}
                  summary={[
                    voiceName || voice || providerLabel(provider, l),
                    l(selectedStyle.zh, selectedStyle.en),
                    ...(supportsSpeed ? [`${speed.toFixed(2)}x`] : []),
                    format.toUpperCase()
                  ]}
                  disabled={busy}
                >
                  <div className="smart-dubbing-voice-field">
                    <TtsVoicePicker
                      id="smart-dubbing-voice"
                      presentation="library"
                      allowPreviewLanguage={official.official}
                      catalogKey={official.official ? JSON.stringify([official.model?.voices, official.model?.voiceProfiles]) : undefined}
                      provider={provider}
                      model={model}
                      value={voice}
                      service={props.creatorServicesService ?? null}
                      label={l('配音音色', 'Dubbing voice')}
                      disabled={busy}
                      onChange={(voiceId, selectedVoice) => {
                        setVoice(voiceId);
                        setVoiceName(selectedVoice?.name ?? voiceId);
                        session?.updateDraft({
                          voiceCode: voiceId,
                          voiceName: selectedVoice?.name ?? voiceId
                        });
                        setError('');
                      }}
                      onVoiceResolved={selectedVoice => setVoiceName(selectedVoice.name)}
                    />
                  </div>
                  <div className="smart-dubbing-settings">
                    {supportsStyle ? <div className="smart-dubbing-control-group">
                      <span>{l('表达风格', 'Delivery style')}</span>
                      <div className="creator-tool-segmented smart-dubbing-style-options" role="radiogroup" aria-label={l('表达风格', 'Delivery style')}>
                        {styles.map(item => <button type="button" role="radio" aria-checked={style === item.value} aria-selected={style === item.value} key={item.value} onClick={() => updateStyle(item.value)}>{l(item.zh, item.en)}</button>)}
                      </div>
                    </div> : null}
                    {supportsSpeed ? <label className="smart-dubbing-speed">
                      <span><span><Gauge size={15} strokeWidth={1.8} aria-hidden="true" />{l('语速', 'Speaking rate')}</span><output>{speed.toFixed(2)}x</output></span>
                      <input type="range" aria-label={l('语速', 'Speaking rate')} min="0.75" max="1.25" step="0.05" value={speed} onChange={event => updateSpeed(Number(event.target.value))} />
                      <small><span>0.75x</span><span>1.00x</span><span>1.25x</span></small>
                    </label> : null}
                    <div className="smart-dubbing-control-group smart-dubbing-format-field">
                      <span>{l('音频格式', 'Audio format')}</span>
                      <div className="creator-tool-segmented smart-dubbing-format-options" role="radiogroup" aria-label={l('音频格式', 'Audio format')}>
                        {(['mp3', 'wav'] as const).map(value => <button type="button" role="radio" aria-checked={format === value} aria-selected={format === value} key={value} onClick={() => updateFormat(value)}>{value.toUpperCase()}</button>)}
                      </div>
                    </div>
                  </div>
                </DashboardVideoTranslationSettings>
              ) : (
                <>
                  <div className="smart-dubbing-voice-field">
                    <TtsVoicePicker
                      id="smart-dubbing-voice"
                      presentation="library"
                      allowPreviewLanguage={official.official}
                      catalogKey={official.official ? JSON.stringify([official.model?.voices, official.model?.voiceProfiles]) : undefined}
                      provider={provider}
                      model={model}
                      value={voice}
                      service={props.creatorServicesService ?? null}
                      label={l('配音音色', 'Dubbing voice')}
                      disabled={busy}
                      onChange={(voiceId, selectedVoice) => {
                        setVoice(voiceId);
                        setVoiceName(selectedVoice?.name ?? voiceId);
                        session?.updateDraft({
                          voiceCode: voiceId,
                          voiceName: selectedVoice?.name ?? voiceId
                        });
                        setError('');
                      }}
                      onVoiceResolved={selectedVoice => setVoiceName(selectedVoice.name)}
                    />
                  </div>
                  <div className="smart-dubbing-settings">
                    {supportsStyle ? <div className="smart-dubbing-control-group">
                      <span>{l('表达风格', 'Delivery style')}</span>
                      <div className="creator-tool-segmented smart-dubbing-style-options" role="radiogroup" aria-label={l('表达风格', 'Delivery style')}>
                        {styles.map(item => <button type="button" role="radio" aria-checked={style === item.value} aria-selected={style === item.value} key={item.value} onClick={() => updateStyle(item.value)}>{l(item.zh, item.en)}</button>)}
                      </div>
                    </div> : null}
                    {supportsSpeed ? <label className="smart-dubbing-speed">
                      <span><span><Gauge size={15} strokeWidth={1.8} aria-hidden="true" />{l('语速', 'Speaking rate')}</span><output>{speed.toFixed(2)}x</output></span>
                      <input type="range" aria-label={l('语速', 'Speaking rate')} min="0.75" max="1.25" step="0.05" value={speed} onChange={event => updateSpeed(Number(event.target.value))} />
                      <small><span>0.75x</span><span>1.00x</span><span>1.25x</span></small>
                    </label> : null}
                    <div className="smart-dubbing-control-group smart-dubbing-format-field">
                      <span>{l('音频格式', 'Audio format')}</span>
                      <div className="creator-tool-segmented smart-dubbing-format-options" role="radiogroup" aria-label={l('音频格式', 'Audio format')}>
                        {(['mp3', 'wav'] as const).map(value => <button type="button" role="radio" aria-checked={format === value} aria-selected={format === value} key={value} onClick={() => updateFormat(value)}>{value.toUpperCase()}</button>)}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <div className={props.embedded ? 'smart-dubbing-submit-row image-generation-submit-row' : 'smart-dubbing-submit-row'}>
                <button className="creator-tool-primary" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="smart-dubbing-spinner" size={16} aria-hidden="true" /> : result ? <RotateCcw size={16} aria-hidden="true" /> : <Mic2 size={16} aria-hidden="true" />}
                  {busy ? l('正在生成', 'Generating') : result ? l('重新生成', 'Regenerate') : l('开始生成', 'Generate')}
                </button>
              </div>
            </div>
          </fieldset>
        </form>

        {result || generating ? (
          <section className="smart-dubbing-output-panel" aria-labelledby="smart-dubbing-output-title">
            <div className="creator-tool-panel-heading">
              <div><h2 id="smart-dubbing-output-title">{result ? l('配音音频', 'Dubbing audio') : l('生成音频', 'Generate audio')}</h2><p>{generating ? l('正在生成配音', 'Generating dubbing') : l('音频已生成，可以试听或下载', 'Audio is ready to preview or download')}</p></div>
            </div>
            {result && audioUrl ? (
              <div className="smart-dubbing-result">
                <span className="smart-dubbing-result-icon"><FileAudio size={28} strokeWidth={1.5} aria-hidden="true" /></span>
                <div><strong>{result.fileName}</strong><small>{formatBytes(result.size)} · {resultModelLabel}</small></div>
                <audio controls src={audioUrl} aria-label={l('文本转语音试听', 'Text to Speech preview')} />
                <div className="smart-dubbing-result-actions">
                  <button className="creator-tool-primary" type="button" onClick={download}><Download size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载音频', 'Download audio')}</button>
                </div>
              </div>
            ) : (
              <div className="smart-dubbing-preview-pending" role="status">
                <LoaderCircle className="smart-dubbing-spinner" size={20} aria-hidden="true" />
                <span>{generating ? l('正在生成配音', 'Generating dubbing') : l('正在加载', 'Loading')}</span>
              </div>
            )}
          </section>
        ) : null}
        {visibleError ? (
          <div className="creator-tool-error smart-dubbing-error" role="alert">
            <span>{visibleError}</span>
            {settingsHref ? (
              <a href={settingsHref}>{l('打开配音服务设置', 'Open voice service settings')}</a>
            ) : null}
          </div>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function readLatestResult(artifacts: CreatorArtifact[]): DubbingResult | undefined {
  const artifact = [...artifacts].reverse().find(candidate => (
    candidate.kind === 'dubbed_audio'
    && candidate.path !== null
    && candidate.status === 'completed'
  ));
  if (artifact === undefined) return undefined;
  const metadata = artifact.metadata;
  const provider = readProvider(metadata.provider);
  return {
    artifact,
    fileName: readString(metadata.fileName) || `OpenCreator-dubbing.${readFormat(metadata.format)}`,
    size: readNonNegativeNumber(metadata.bytes),
    provider: provider === 'aliyun' || provider === 'minimax' || provider === 'volcengine' ? provider : 'openai',
    model: readString(metadata.model),
    voice: readString(metadata.voiceCode),
    voiceName: readString(metadata.voiceName) || readString(metadata.voiceCode),
    style: readStyle(metadata.style),
    speed: readSpeed(metadata.speed),
    format: readFormat(metadata.format),
    characterCount: readNonNegativeNumber(metadata.characterCount)
  };
}

function providerLabel(
  provider: CreatorTtsProvider,
  l: (zh: string, en: string) => string
): string {
  if (provider === 'aliyun') return l('阿里云百炼', 'Alibaba Cloud Model Studio');
  if (provider === 'minimax') return 'MiniMax';
  if (provider === 'volcengine') return l('火山引擎', 'Volcengine');
  if (provider === 'edge-tts') return 'Edge TTS';
  return 'OpenAI TTS';
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatGenerationError(error: unknown, l: (zh: string, en: string) => string) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  if (code === 'SMART_DUBBING_CONFIG_REQUIRED' || code === 'creator_tts_config_missing') {
    return l('请先在设置的配音服务中配置当前服务商的 API Key', 'Configure the selected TTS provider API key in Settings first');
  }
  if (code === 'SMART_DUBBING_PROVIDER_UNSUPPORTED' || code === 'unsupported_capability') {
    return l('当前配音服务商不支持文本转语音，请在设置中选择阿里云百炼、OpenAI 或 MiniMax', 'Select Alibaba Cloud, OpenAI, or MiniMax for Text to Speech.');
  }
  if (
    code === 'SMART_DUBBING_UPSTREAM_ERROR'
    || code === 'creator_tts_upstream_error'
    || code === 'creator_tts_runtime_unavailable'
  ) {
    return l('配音服务请求失败，请检查服务配置和网络后重试', 'The dubbing request failed. Check the service configuration and network, then retry.');
  }
  return l('配音生成失败，请在 Agent 区域查看诊断后重试', 'Dubbing generation failed. Review the diagnosis in the Agent panel and retry.');
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readProvider(value: CreatorJson | undefined): CreatorTtsProvider | undefined {
  return value === 'openai' || value === 'aliyun' || value === 'minimax' || value === 'edge-tts' || value === 'volcengine'
    ? value
    : undefined;
}

function readStyle(value: CreatorJson | undefined): SmartDubbingStyle {
  return typeof value === 'string' && (smartDubbingStyles as readonly string[]).includes(value)
    ? value as SmartDubbingStyle
    : 'natural';
}

function readSpeed(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.75 && value <= 1.25
    ? value
    : 1;
}

function readFormat(value: CreatorJson | undefined): SmartDubbingFormat {
  return value === 'wav' ? 'wav' : 'mp3';
}

function readNonNegativeNumber(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function shouldOpenTtsSettings(
  provider: CreatorTtsProvider,
  ...codes: Array<string | null | undefined>
): boolean {
  return provider === 'edge-tts' || codes.some(code => (
    code === 'SMART_DUBBING_CONFIG_REQUIRED'
    || code === 'SMART_DUBBING_PROVIDER_UNSUPPORTED'
    || code === 'creator_tts_config_missing'
    || code === 'unsupported_capability'
  ));
}
