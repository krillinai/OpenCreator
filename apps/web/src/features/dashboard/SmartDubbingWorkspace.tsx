import { useEffect, useMemo, useState } from 'react';
import type {
  CreatorTtsProvider,
  SmartDubbingFormat,
  SmartDubbingResult,
  SmartDubbingStyle,
  SmartDubbingVoice
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
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { SmartDubbingService } from '../../services/smart-dubbing-service.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';

type DubbingStep = 0 | 1 | 2;

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
  service?: SmartDubbingService;
  creatorServicesService?: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const [currentStep, setCurrentStep] = useState<DubbingStep>(0);
  const [furthestStep, setFurthestStep] = useState<DubbingStep>(0);
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<CreatorTtsProvider>('openai');
  const [model, setModel] = useState('gpt-4o-mini-tts');
  const [voice, setVoice] = useState<SmartDubbingVoice>('');
  const [voiceName, setVoiceName] = useState('');
  const [style, setStyle] = useState<SmartDubbingStyle>('natural');
  const [speed, setSpeed] = useState(1);
  const [format, setFormat] = useState<SmartDubbingFormat>('mp3');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<SmartDubbingResult>();
  const [audioUrl, setAudioUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const characterCount = useMemo(() => [...text.trim()].length, [text]);
  const selectedStyle = styles.find(item => item.value === style) ?? styles[0]!;

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  useEffect(() => {
    let active = true;
    if (props.creatorServicesService === null || props.creatorServicesService === undefined) {
      return () => {
        active = false;
      };
    }
    void props.creatorServicesService.getConfig()
      .then(response => {
        if (!active) return;
        const selectedProvider = response.config.tts.provider;
        setProvider(selectedProvider);
        if (selectedProvider === 'edge-tts') {
          setModel('');
          setVoice('');
          setVoiceName('');
          return;
        }
        const selectedConfig = response.config.tts[selectedProvider];
        setModel(selectedConfig.model);
        setVoice(selectedConfig.defaultVoiceId);
        setVoiceName(selectedConfig.defaultVoiceId);
      })
      .catch(() => setError(l('无法读取配音服务配置', 'Could not load TTS settings')));
    return () => {
      active = false;
    };
  }, [props.creatorServicesService]);

  function openStep(step: DubbingStep) {
    setCurrentStep(step);
    setFurthestStep(previous => Math.max(previous, step) as DubbingStep);
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

  async function generate() {
    if (generating) return;
    if (!props.service) {
      setError(l('智能配音服务暂不可用，请检查 Runtime 连接', 'Smart dubbing is unavailable. Check the Runtime connection.'));
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const response = await props.service.generate({ text, voice, style, speed, format });
      const audioResponse = await props.service.openContent(response.result.id);
      const objectUrl = URL.createObjectURL(await audioResponse.blob());
      setAudioUrl(previous => {
        if (previous) URL.revokeObjectURL(previous);
        return objectUrl;
      });
      setResult(response.result);
      setNotice(l('配音已生成，可以试听或下载音频', 'Dubbing is ready to preview or download'));
    } catch (caught) {
      setError(formatGenerationError(caught, l));
    } finally {
      setGenerating(false);
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

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      setText(l(sampleTextZh, sampleTextEn));
      openStep(0);
      return l('示例文案已填入，可以继续选择音色。', 'The sample script is ready. Continue to voice selection.');
    }
    const styleMatch = styles.find(item => command.includes(item.zh) || command.toLowerCase().includes(item.en.toLowerCase()));
    if (styleMatch) {
      setStyle(styleMatch.value);
      openStep(1);
      return l(`表达风格已改为${styleMatch.zh}。`, `Delivery style changed to ${styleMatch.en}.`);
    }
    if (/快一点|加快|faster/i.test(command)) {
      setSpeed(current => Math.min(1.25, Math.round((current + 0.1) * 100) / 100));
      openStep(1);
      return l('语速已加快。', 'The speaking rate is faster.');
    }
    if (/慢一点|减慢|slower/i.test(command)) {
      setSpeed(current => Math.max(0.75, Math.round((current - 0.1) * 100) / 100));
      openStep(1);
      return l('语速已放慢。', 'The speaking rate is slower.');
    }
    if (command.trim().length > 12) {
      setText(command.trim());
      openStep(0);
      return l('文案已同步到左侧，可以继续设置音色和表达。', 'The script is synchronized on the left. Continue with voice and delivery settings.');
    }
    return l('可以发送配音文案，或告诉我需要自然、专业、温暖、活力、沉静或叙事风格。', 'Send a script, or ask for a natural, professional, warm, energetic, calm, or storytelling delivery.');
  }

  const summary = (
    <CreatorTaskSummary
      sourceIcon={FileAudio}
      sourceLabel={l('配音文案', 'Script')}
      sourceValue={text.trim()}
      items={[
        { label: l('服务商', 'Provider'), value: providerLabel(provider, l) },
        { label: l('音色', 'Voice'), value: voiceName || voice },
        { label: l('表达风格', 'Delivery'), value: l(selectedStyle.zh, selectedStyle.en) },
        { label: l('语速', 'Speed'), value: `${speed.toFixed(2)}x` },
        { label: l('音频格式', 'Format'), value: format.toUpperCase() },
        { label: l('文案长度', 'Length'), value: l(`${characterCount} 字`, `${characterCount} characters`) }
      ]}
    />
  );

  return (
    <CreatorToolShell
      title={l('智能配音', 'AI Dubbing')}
      subtitle={l('自然音色、表达风格与可下载音频', 'Natural voices, expressive delivery, and downloadable audio')}
      context={result ? l(`${result.format.toUpperCase()} 配音已完成`, `${result.format.toUpperCase()} dubbing ready`) : currentStep === 0 ? l('正在编辑文案', 'Editing script') : currentStep === 1 ? `${voiceName || voice || providerLabel(provider, l)} · ${speed.toFixed(2)}x` : l('等待生成', 'Ready to generate')}
      initialMessage={l('把需要配音的文案发给我，再选择音色和表达风格。', 'Send me the script, then choose a voice and delivery style.')}
      suggestions={result ? [l('换成温暖风格', 'Use a warm style'), l('语速慢一点', 'Make it slower')] : [l('填入示例文案', 'Use a sample script'), l('使用专业风格', 'Use a professional style')]}
      placeholder={props.promptHint ?? l('输入配音文案或调整要求', 'Enter a script or delivery request')}
      onBack={props.onBack}
      onCommand={handleCommand}
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
                  onChange={event => { setText(event.target.value); setResult(undefined); setError(''); }}
                  placeholder={l('输入需要转换为语音的文案', 'Enter the script to convert into speech')}
                  aria-label={l('配音文案内容', 'Dubbing script content')}
                />
              </label>
              <button className="smart-dubbing-sample" type="button" onClick={() => setText(l(sampleTextZh, sampleTextEn))}>
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
                    setResult(undefined);
                  }}
                  onVoiceResolved={selectedVoice => setVoiceName(selectedVoice.name)}
                />
              </div>
              <div className="smart-dubbing-control-group">
                <span>{l('表达风格', 'Delivery style')}</span>
                <div className="creator-tool-segmented smart-dubbing-style-options" role="radiogroup" aria-label={l('表达风格', 'Delivery style')}>
                  {styles.map(item => <button type="button" role="radio" aria-checked={style === item.value} aria-selected={style === item.value} key={item.value} onClick={() => { setStyle(item.value); setResult(undefined); }}>{l(item.zh, item.en)}</button>)}
                </div>
              </div>
              <label className="smart-dubbing-speed">
                <span><span><Gauge size={15} strokeWidth={1.8} aria-hidden="true" />{l('语速', 'Speaking rate')}</span><output>{speed.toFixed(2)}x</output></span>
                <input type="range" min="0.75" max="1.25" step="0.05" value={speed} onChange={event => { setSpeed(Number(event.target.value)); setResult(undefined); }} />
                <small><span>0.75x</span><span>1.00x</span><span>1.25x</span></small>
              </label>
              <div className="smart-dubbing-control-group">
                <span>{l('音频格式', 'Audio format')}</span>
                <div className="creator-tool-segmented smart-dubbing-format-options" role="radiogroup" aria-label={l('音频格式', 'Audio format')}>
                  {(['mp3', 'wav'] as const).map(value => <button type="button" role="radio" aria-checked={format === value} aria-selected={format === value} key={value} onClick={() => { setFormat(value); setResult(undefined); }}>{value.toUpperCase()}</button>)}
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
                      <button type="button" onClick={generate} disabled={generating}><RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />{l('重新生成', 'Regenerate')}</button>
                      <button className="creator-tool-primary" type="button" onClick={download}><Download size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载音频', 'Download audio')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="smart-dubbing-ready">
                    <span><Sparkles size={24} strokeWidth={1.6} aria-hidden="true" /></span>
                    <strong>{l('准备生成配音', 'Ready to generate dubbing')}</strong>
                    <p>{l('文案、音色和输出格式已经就绪', 'The script, voice, and output format are ready')}</p>
                    <button className="creator-tool-primary" type="button" onClick={generate} disabled={generating}>
                      {generating ? <LoaderCircle className="smart-dubbing-spinner" size={16} strokeWidth={1.8} aria-hidden="true" /> : <Mic2 size={16} strokeWidth={1.8} aria-hidden="true" />}
                      {generating ? l('正在生成', 'Generating') : l('开始生成', 'Generate')}
                    </button>
                  </div>
                )}
              </section>
              {summary}
            </div>
          ) : null}
          {error ? <p className="creator-tool-error smart-dubbing-error" role="alert">{error}</p> : null}
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
  if (code === 'SMART_DUBBING_CONFIG_REQUIRED') {
    return l('请先在设置的配音服务中配置当前服务商的 API Key', 'Configure the selected TTS provider API key in Settings first');
  }
  if (code === 'SMART_DUBBING_PROVIDER_UNSUPPORTED') {
    return l('当前配音服务商不支持智能配音，请在设置中选择阿里云百炼、OpenAI 或 MiniMax', 'Select Alibaba Cloud, OpenAI, or MiniMax for AI dubbing.');
  }
  if (code === 'SMART_DUBBING_UPSTREAM_ERROR') {
    return l('配音服务请求失败，请检查服务配置和网络后重试', 'The dubbing request failed. Check the service configuration and network, then retry.');
  }
  return error instanceof Error ? error.message : l('配音生成失败，请稍后重试', 'Dubbing generation failed. Try again later.');
}
