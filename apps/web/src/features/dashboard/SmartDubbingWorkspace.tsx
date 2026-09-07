import {
  smartDubbingStyles,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorTtsProvider,
  type SmartDubbingFormat,
  type SmartDubbingStyle,
  type SmartDubbingVoice
} from '@opencreator/protocol';
import {
  Check,
  Download,
  FileAudio,
  Gauge,
  LoaderCircle,
  Mic2,
  RotateCcw,
  Sparkles,
  WandSparkles
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

type DubbingStep = 0 | 1 | 2;

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
  creatorServicesService?: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const restoredResult = session?.job.artifacts.some(artifact => (
    artifact.kind === 'dubbed_audio' && artifact.status === 'completed'
  )) === true;
  const restoredStep = restoredResult ? 2 : readStep(session?.state.currentStep, 0);
  const [currentStep, setCurrentStep] = useState<DubbingStep>(restoredStep);
  const [furthestStep, setFurthestStep] = useState<DubbingStep>(() => (
    Math.max(restoredStep, readStep(session?.state.furthestStep, restoredStep)) as DubbingStep
  ));
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
    () => readLatestResult(session?.job.artifacts ?? []),
    [session?.job.artifacts]
  );
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'tts').at(-1);
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const runtimeError = latestStage?.status === 'failed'
    ? formatGenerationError({ code: latestStage.errorCode, message: latestStage.errorMessage }, l)
    : session?.error === null || session?.error === undefined
      ? ''
      : formatGenerationError(session.error, l);
  const visibleError = error || runtimeError;
  const settingsHref = shouldOpenTtsSettings(
    provider,
    latestStage?.errorCode,
    session?.error?.code
  ) ? '#/settings?tab=ai-services&section=tts' : undefined;

  useEffect(() => {
    let active = true;
    if (props.creatorServicesService === null || props.creatorServicesService === undefined) {
      return () => { active = false; };
    }
    void props.creatorServicesService.getConfig()
      .then(response => {
        if (!active) return;
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
      .catch(() => setError(l('无法读取配音服务配置', 'Could not load TTS settings')));
    return () => { active = false; };
  }, [props.creatorServicesService, session?.job.id]);

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
    void session.openArtifact(result.artifact.id)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setAudioUrl(objectUrl);
      })
      .catch(cause => {
        if (active) setError(l(
          '配音音频加载失败，可以稍后重试或重新生成',
          `Dubbing audio failed to load: ${cause instanceof Error ? cause.message : String(cause)}`
        ));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [l, result?.artifact.id, session?.openArtifact]);

  useEffect(() => {
    if (result !== undefined && !generating) {
      setCurrentStep(2);
      setFurthestStep(2);
      setNotice(l('配音已生成，可以试听或下载音频', 'Dubbing is ready to preview or download'));
    }
  }, [generating, l, result?.artifact.id]);

  function openStep(step: DubbingStep) {
    const nextFurthest = Math.max(furthestStep, step) as DubbingStep;
    setCurrentStep(step);
    setFurthestStep(nextFurthest);
    session?.updateDraft({ currentStep: step, furthestStep: nextFurthest });
  }

  function nextStep() {
    setError('');
    if (currentStep === 0 && characterCount === 0) {
      setError(l('请先填写需要配音的文案', 'Enter the script to be voiced'));
      return;
    }
    if (currentStep === 1 && !voice.trim()) {
      setError(l('请选择一个可用音色', 'Select an available voice'));
      return;
    }
    openStep(Math.min(2, currentStep + 1) as DubbingStep);
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
    if (generating) return;
    if (session === null) {
      setError(l('智能配音服务暂不可用，请检查 Runtime 连接', 'Smart dubbing is unavailable. Check the Runtime connection.'));
      return;
    }
    if (!text.trim()) {
      setError(l('请先填写需要配音的文案', 'Enter the script to be voiced'));
      openStep(0);
      return;
    }
    if (!voice.trim()) {
      setError(l('请选择一个可用音色', 'Select an available voice'));
      openStep(1);
      return;
    }
    if (provider === 'edge-tts') {
      setError(l(
        '智能配音暂不支持 Edge TTS，请先在设置中选择阿里云百炼、OpenAI 或 MiniMax',
        'AI dubbing does not support Edge TTS. Select Alibaba Cloud, OpenAI, or MiniMax in Settings.'
      ));
      openStep(1);
      return;
    }
    setError('');
    setNotice('');
    session.updateDraft({
      text: text.trim(),
      ttsProvider: provider,
      ttsModel: model,
      voiceCode: voice,
      voiceName: voiceName || voice,
      style,
      speed,
      format
    }, { semantic: true });
    try {
      await session.flush();
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'tts' }
      });
      setNotice(l('配音任务已提交，完成后会自动显示音频', 'Dubbing started. The audio will appear automatically.'));
    } catch (caught) {
      setError(formatGenerationError(caught, l));
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
    } catch (caught) {
      setError(formatGenerationError(caught, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    try {
      await session.resumeJob();
    } catch (caught) {
      setError(formatGenerationError(caught, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updateText(l(sampleTextZh, sampleTextEn));
      openStep(0);
      return l('示例文案已填入，可以继续选择音色。', 'The sample script is ready. Continue to voice selection.');
    }
    const styleMatch = styles.find(item => (
      command.includes(item.zh) || command.toLowerCase().includes(item.en.toLowerCase())
    ));
    if (styleMatch) {
      updateStyle(styleMatch.value);
      openStep(1);
      return l(`表达风格已改为${styleMatch.zh}。`, `Delivery style changed to ${styleMatch.en}.`);
    }
    if (/快一点|加快|faster/i.test(command)) {
      updateSpeed(Math.min(1.25, Math.round((speed + 0.1) * 100) / 100));
      openStep(1);
      return l('语速已加快。', 'The speaking rate is faster.');
    }
    if (/慢一点|减慢|slower/i.test(command)) {
      updateSpeed(Math.max(0.75, Math.round((speed - 0.1) * 100) / 100));
      openStep(1);
      return l('语速已放慢。', 'The speaking rate is slower.');
    }
    if (command.trim().length > 12) {
      updateText(command.trim());
      openStep(0);
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
  const summaryText = result ? readString(resultSettings?.text) || text.trim() : text.trim();
  const summaryStyle = result
    ? styles.find(item => item.value === result.style) ?? selectedStyle
    : selectedStyle;
  const summary = (
    <CreatorTaskSummary
      sourceIcon={FileAudio}
      sourceLabel={l('配音文案', 'Script')}
      sourceValue={summaryText}
      items={[
        { label: l('服务商', 'Provider'), value: providerLabel(result?.provider ?? provider, l) },
        { label: l('音色', 'Voice'), value: result?.voiceName || voiceName || voice },
        { label: l('表达风格', 'Delivery'), value: l(summaryStyle.zh, summaryStyle.en) },
        { label: l('语速', 'Speed'), value: `${(result?.speed ?? speed).toFixed(2)}x` },
        { label: l('音频格式', 'Format'), value: (result?.format ?? format).toUpperCase() },
        { label: l('文案长度', 'Length'), value: l(`${result?.characterCount ?? characterCount} 字`, `${result?.characterCount ?? characterCount} characters`) }
      ]}
    />
  );

  return (
    <CreatorToolShell
      title={l('智能配音', 'AI Dubbing')}
      subtitle={l('自然音色、表达风格与可下载音频', 'Natural voices, expressive delivery, and downloadable audio')}
      context={result
        ? l(`${result.format.toUpperCase()} 配音已完成`, `${result.format.toUpperCase()} dubbing ready`)
        : currentStep === 0
          ? l('正在编辑文案', 'Editing script')
          : currentStep === 1
            ? `${voiceName || voice || providerLabel(provider, l)} · ${speed.toFixed(2)}x`
            : generating
              ? l('正在生成配音', 'Generating dubbing')
              : l('等待生成', 'Ready to generate')}
      stepLabel={generating ? l('正在生成配音', 'Generating dubbing') : l('智能配音', 'AI dubbing')}
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
      contentClassName="smart-dubbing-workspace-content"
    >
      <div className="creator-tool-stack smart-dubbing-stack">
        <nav className="video-translation-steps creator-tool-steps smart-dubbing-steps" aria-label={l('智能配音流程', 'AI dubbing workflow')}>
          <ol>
            {[l('配音文案', 'Script'), l('音色与表达', 'Voice and delivery'), l('生成音频', 'Generate audio')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return (
                <li key={label} data-active={active} data-completed={completed}>
                  <button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => openStep(index as DubbingStep)}>
                    <span>{completed ? <Check size={13} strokeWidth={2.2} /> : index + 1}</span>
                    <strong>{label}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="smart-dubbing-step-scroll">
          {currentStep === 0 ? (
            <section className="creator-tool-panel smart-dubbing-script-panel" aria-labelledby="smart-dubbing-script-title">
              <div className="creator-tool-panel-heading">
                <div><h2 id="smart-dubbing-script-title">{l('配音文案', 'Dubbing script')}</h2><p>{l('支持中英文及多语言文本，最多 5000 字', 'Supports multilingual text up to 5,000 characters')}</p></div>
                <small>{characterCount} / 5000</small>
              </div>
              <label className="creator-tool-field">
                <span>{l('文案内容', 'Script')}</span>
                <textarea
                  rows={12}
                  maxLength={5000}
                  value={text}
                  onChange={event => updateText(event.target.value)}
                  placeholder={l('输入需要转换为语音的文案', 'Enter the script to convert into speech')}
                  aria-label={l('配音文案内容', 'Dubbing script content')}
                />
              </label>
              <button className="smart-dubbing-sample" type="button" onClick={() => updateText(l(sampleTextZh, sampleTextEn))}>
                <WandSparkles size={14} strokeWidth={1.8} aria-hidden="true" />
                {l('填入示例文案', 'Use sample script')}
              </button>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="smart-dubbing-voice-title">
              <div className="creator-tool-panel-heading"><div><h2 id="smart-dubbing-voice-title">{l('音色与表达', 'Voice and delivery')}</h2><p>{l('选择基础音色，再设置表达风格和语速', 'Choose a voice, delivery style, and speaking rate')}</p></div></div>
              <div className="smart-dubbing-control-group">
                <span>{l('基础音色', 'Voice')}</span>
                <div className="smart-dubbing-provider-row">
                  <strong>{providerLabel(provider, l)}</strong>
                  <small>{model || l('本地语音服务', 'Local speech service')}</small>
                </div>
                <TtsVoicePicker
                  id="smart-dubbing-voice"
                  provider={provider}
                  model={model}
                  value={voice}
                  service={props.creatorServicesService ?? null}
                  label={l('配音音色', 'Dubbing voice')}
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
              <div className="smart-dubbing-control-group">
                <span>{l('表达风格', 'Delivery style')}</span>
                <div className="creator-tool-segmented smart-dubbing-style-options" role="radiogroup" aria-label={l('表达风格', 'Delivery style')}>
                  {styles.map(item => <button type="button" role="radio" aria-checked={style === item.value} aria-selected={style === item.value} key={item.value} onClick={() => updateStyle(item.value)}>{l(item.zh, item.en)}</button>)}
                </div>
              </div>
              <label className="smart-dubbing-speed">
                <span><span><Gauge size={15} strokeWidth={1.8} aria-hidden="true" />{l('语速', 'Speaking rate')}</span><output>{speed.toFixed(2)}x</output></span>
                <input type="range" min="0.75" max="1.25" step="0.05" value={speed} onChange={event => updateSpeed(Number(event.target.value))} />
                <small><span>0.75x</span><span>1.00x</span><span>1.25x</span></small>
              </label>
              <div className="smart-dubbing-control-group">
                <span>{l('音频格式', 'Audio format')}</span>
                <div className="creator-tool-segmented smart-dubbing-format-options" role="radiogroup" aria-label={l('音频格式', 'Audio format')}>
                  {(['mp3', 'wav'] as const).map(value => <button type="button" role="radio" aria-checked={format === value} aria-selected={format === value} key={value} onClick={() => updateFormat(value)}>{value.toUpperCase()}</button>)}
                </div>
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <div className="creator-task-final-grid smart-dubbing-final-grid">
              <section className="creator-tool-panel smart-dubbing-output-panel" aria-labelledby="smart-dubbing-output-title">
                <div className="creator-tool-panel-heading">
                  <div><h2 id="smart-dubbing-output-title">{result ? l('配音音频', 'Dubbing audio') : l('生成音频', 'Generate audio')}</h2><p>{result ? l('音频已生成，可以试听或下载', 'Audio is ready to preview or download') : l('确认任务设置后开始生成', 'Review the task settings before generating')}</p></div>
                </div>
                {result && audioUrl ? (
                  <div className="smart-dubbing-result">
                    <span className="smart-dubbing-result-icon"><FileAudio size={28} strokeWidth={1.5} aria-hidden="true" /></span>
                    <div><strong>{result.fileName}</strong><small>{formatBytes(result.size)} · {result.model}</small></div>
                    <audio controls src={audioUrl} aria-label={l('智能配音试听', 'AI dubbing preview')} />
                    <div className="smart-dubbing-result-actions">
                      <button type="button" onClick={() => void generate()} disabled={generating}><RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />{l('重新生成', 'Regenerate')}</button>
                      <button className="creator-tool-primary" type="button" onClick={download}><Download size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载音频', 'Download audio')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="smart-dubbing-ready">
                    <span><Sparkles size={24} strokeWidth={1.6} aria-hidden="true" /></span>
                    <strong>{generating ? l('正在生成配音', 'Generating dubbing') : l('准备生成配音', 'Ready to generate dubbing')}</strong>
                    <p>{l('文案、音色和输出格式已经就绪', 'The script, voice, and output format are ready')}</p>
                    <button className="creator-tool-primary" type="button" onClick={() => void generate()} disabled={generating}>
                      {generating ? <LoaderCircle className="smart-dubbing-spinner" size={16} strokeWidth={1.8} aria-hidden="true" /> : <Mic2 size={16} strokeWidth={1.8} aria-hidden="true" />}
                      {generating ? l('正在生成', 'Generating') : l('开始生成', 'Generate')}
                    </button>
                  </div>
                )}
              </section>
              {summary}
            </div>
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

        <footer className="video-translation-wizard-actions smart-dubbing-actions">
          <button className="video-translation-secondary-action" type="button" onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as DubbingStep)}>
            {currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}
          </button>
          {currentStep < 2 ? <button className="video-translation-primary-action" type="button" onClick={nextStep}>{l('继续', 'Continue')}</button> : null}
        </footer>
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
    provider: provider === 'aliyun' || provider === 'minimax' ? provider : 'openai',
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
    return l('当前配音服务商不支持智能配音，请在设置中选择阿里云百炼、OpenAI 或 MiniMax', 'Select Alibaba Cloud, OpenAI, or MiniMax for AI dubbing.');
  }
  if (
    code === 'SMART_DUBBING_UPSTREAM_ERROR'
    || code === 'creator_tts_upstream_error'
    || code === 'creator_tts_runtime_unavailable'
  ) {
    return l('配音服务请求失败，请检查服务配置和网络后重试', 'The dubbing request failed. Check the service configuration and network, then retry.');
  }
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error
      ? error.message
      : '';
  return message || l('配音生成失败，请稍后重试', 'Dubbing generation failed. Try again later.');
}

function readStep(value: CreatorJson | undefined, fallback: DubbingStep): DubbingStep {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readProvider(value: CreatorJson | undefined): CreatorTtsProvider | undefined {
  return value === 'openai' || value === 'aliyun' || value === 'minimax' || value === 'edge-tts'
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
