import {
  creatorLanguages,
  creatorTranscriptionModel,
  normalizeVideoSourceUrl,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorServicesConfig,
  type CreatorTranscriptionProvider
} from '@opencreator/protocol';
import { useGenerationAccess } from './DashboardGenerationAccess.js';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Captions,
  Check,
  FileVideo,
  Link2,
  LoaderCircle,
  RotateCcw,
  Settings2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import AppSelect from '../../components/forms/Select.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import DashboardVideoTranslationSettings from './DashboardVideoTranslationSettings.js';
import TranscriptionSubtitleEditor from './TranscriptionSubtitleEditor.js';
import VideoSourceInput from './VideoSourceInput.js';
import { LocalVideoPreview } from './VideoSourcePreview.js';
import SupportedVideoSources from './SupportedVideoSources.js';
import { VideoTranslationSubtitleImport } from './VideoTranslationSubtitleImport.js';
import { parseTranscriptionSrt, transcriptionSrtToText } from './transcription-srt.js';
import {
  readCreatorArtifactText,
  useOptionalCreatorSession
} from './creator-session-store.js';
import { OfficialModelField, useOfficialServices } from './official-services.js';
import './transcription-workspace.css';

const sourceLanguages = creatorLanguages.filter(language => language.speech)
  .sort((left, right) => Number(right.sourcePreferred) - Number(left.sourcePreferred));
const transcriptionProviderLogos: Partial<Record<CreatorTranscriptionProvider, string>> = {
  openai: '/model-brands/openai.svg',
  'faster-whisper': '/components/faster-whisper.png',
  whisperkit: '/components/whisperkit.png',
  'whisper.cpp': '/components/whisper-cpp.png',
  aliyun: '/model-brands/alibaba-color.svg',
  volcengine: '/model-brands/bytedance-color.svg'
};

function transcriptionModelIcon(value: string) {
  const provider = value.split(':')[0] as CreatorTranscriptionProvider;
  const src = transcriptionProviderLogos[provider];
  return src ? <img
    className={`transcription-model-option-logo${provider === 'openai' ? ' is-monochrome' : ''}`}
    src={src}
    alt=""
    aria-hidden="true"
  /> : <AudioLines size={18} strokeWidth={1.7} aria-hidden="true" />;
}

export default function TranscriptionWorkspace(props: {
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
  const official = useOfficialServices('transcription');
  const [sourceType, setSourceType] = useState<'url' | 'file'>(() => (
    session?.state.sourceType === 'url' ? 'url' : 'file'
  ));
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState(() => readString(session?.state.sourceUrl));
  const [sourceLanguage, setSourceLanguage] = useState(() => (
    readString(session?.state.sourceLanguage) || 'zh_cn'
  ));
  const [currentStep, setCurrentStep] = useState<0 | 1>(() => readStep(session?.state.currentStep));
  const [furthestStep, setFurthestStep] = useState<0 | 1>(() => readStep(session?.state.furthestStep));
  const [config, setConfig] = useState<CreatorServicesConfig>();
  const [selectedProvider, setSelectedProvider] = useState<CreatorTranscriptionProvider>(() => (
    readTranscriptionProvider(session?.state.transcriptionProvider) ?? 'openai'
  ));
  const [selectedModel, setSelectedModel] = useState(() => readString(session?.state.transcriptionModel));
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [srt, setSrt] = useState('');
  const [resultLoading, setResultLoading] = useState(false);
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const [editorOpen, setEditorOpen] = useState(() => Boolean(session?.job.artifacts.some(artifact => (
    artifact.kind === 'source_subtitle' && artifact.status === 'completed'
  ))));

  const sourceArtifact = session?.job.artifacts.find(artifact => (
    artifact.id === session.state.sourceArtifactId
    && artifact.kind === 'source_video'
    && artifact.status === 'completed'
  ));
  const result = useMemo(
    () => props.forceComposer ? undefined : [...(session?.job.artifacts ?? [])].reverse().find(artifact => (
      artifact.kind === 'source_subtitle'
      && artifact.status === 'completed'
      && artifact.path !== null
    )),
    [props.forceComposer, session?.job.artifacts]
  );
  const previewSourceArtifact = result === undefined ? undefined : result.sourceArtifactIds
    .map(id => session?.job.artifacts.find(artifact => artifact.id === id && artifact.kind === 'source_video' && artifact.status === 'completed'))
    .find(artifact => artifact !== undefined)
    ?? sourceArtifact
    ?? [...(session?.job.artifacts ?? [])].reverse().find(artifact => artifact.kind === 'source_video' && artifact.status === 'completed');
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'transcription').at(-1);
  const running = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const busy = running || submitting;
  const validUrl = isHttpUrl(sourceUrl);
  const hasSource = sourceType === 'file' ? file !== null || sourceArtifact !== undefined : validUrl;
  const sourceName = sourceType === 'file'
    ? (file?.name ?? (readString(sourceArtifact?.metadata.fileName) || readString(session?.state.sourceFileName))) || l('尚未选择视频', 'No video selected')
    : sourceUrl || l('尚未填写视频链接', 'No video URL entered');
  const transcript = srtToText(srt);
  const cueCount = typeof result?.metadata.cueCount === 'number'
    ? result.metadata.cueCount
    : parseSrtCues(srt).length;
  const runtimeError = latestStage?.status === 'failed'
    ? formatTranscriptionError(latestStage.errorCode, l)
    : session?.error
      ? formatTranscriptionError(session.error.code, l)
      : '';
  const visibleError = error || runtimeError;
  const model = official.official ? official.model?.id ?? '' : selectedModel;
  const provider = official.official ? 'openai' : selectedProvider;
  const modelOptions = useMemo(() => {
    if (config === undefined) return [];
    const providers: CreatorTranscriptionProvider[] = [
      'openai', 'faster-whisper', 'whisperkit', 'whisper.cpp', 'aliyun', 'volcengine', 'funasr'
    ];
    return providers.flatMap(nextProvider => {
      const models = nextProvider === 'whisper.cpp'
        ? ['tiny', 'medium', 'large-v2', 'large-v3-turbo']
        : nextProvider === 'faster-whisper'
          ? ['tiny', 'medium', 'large-v2']
          : nextProvider === 'whisperkit'
            ? ['large-v2']
            : [creatorTranscriptionModel({
              ...config,
              transcription: { ...config.transcription, provider: nextProvider }
            })];
      return models.map(nextModel => ({
        provider: nextProvider,
        model: nextModel,
        value: `${nextProvider}:${nextModel}`,
        label: `${providerLabel(nextProvider, l)} · ${nextModel}`
      }));
    });
  }, [config, l]);

  useEffect(() => {
    let active = true;
    if (!props.creatorServicesService) return () => { active = false; };
    void props.creatorServicesService.getConfig().then(response => {
      if (!active) return;
      setConfig(response.config);
      const nextProvider = readTranscriptionProvider(session?.state.transcriptionProvider) ?? response.config.transcription.provider;
      setSelectedProvider(nextProvider);
      setSelectedModel(readString(session?.state.transcriptionModel) || creatorTranscriptionModel({
        ...response.config,
        transcription: { ...response.config.transcription, provider: nextProvider }
      }));
    }).catch(cause => {
      if (!active) return;
      session?.captureCreatorFailure(
        'transcription.load-service-config',
        cause,
        l('无法读取转录服务配置，请稍后重试。', 'Could not load transcription settings. Try again later.'),
        'client'
      );
    });
    return () => { active = false; };
  }, [props.creatorServicesService, session?.job.id, l]);

  useEffect(() => {
    if (!session || !result) {
      setSrt('');
      return;
    }
    let active = true;
    setResultLoading(true);
    setSrt('');
    void readCreatorArtifactText(
      session,
      result.id,
      'transcription.load-result',
      l('转录结果加载失败，请稍后重试。', 'Could not load the transcript. Try again later.')
    ).then(value => {
      if (active) setSrt(value);
    }).catch(cause => {
      if (active) setError(formatTranscriptionError((cause as { code?: string }).code, l));
    }).finally(() => {
      if (active) setResultLoading(false);
    });
    return () => { active = false; };
  }, [result?.id, session?.openArtifact, l]);

  useEffect(() => {
    if (running || !result) setEditorOpen(false);
    else setEditorOpen(true);
  }, [result?.id, running]);

  useEffect(() => {
    if (result && !running) setNotice(l('转录已完成，可以下载文本或字幕', 'Transcription is ready. Download the text or subtitles.'));
  }, [result?.id, running, l]);

  function chooseFile(next: File | null) {
    setFile(next);
    setSourceType('file');
    setSourceUrl('');
    setError('');
    setNotice('');
    session?.updateDraft({
      sourceType: 'file',
      sourceUrl: '',
      sourceArtifactId: null,
      sourceFileName: next?.name ?? null,
      sourceFileSize: next?.size ?? null,
      sourceFileLastModified: next?.lastModified ?? null
    });
  }

  function updateUrl(value: string) {
    const normalized = normalizeVideoSourceUrl(value);
    setSourceType('url');
    setSourceUrl(normalized);
    setFile(null);
    setError('');
    session?.updateDraft({ sourceType: 'url', sourceUrl: normalized, sourceArtifactId: null });
  }

  function clearSource() {
    setFile(null);
    setSourceUrl('');
    setError('');
    session?.updateDraft({
      sourceType: 'file',
      sourceUrl: '',
      sourceArtifactId: null,
      sourceFileName: null,
      sourceFileSize: null,
      sourceFileLastModified: null
    });
  }

  function changeModel(value: string) {
    const choice = modelOptions.find(option => option.value === value);
    if (choice === undefined) return;
    setSelectedProvider(choice.provider);
    setSelectedModel(choice.model);
    setError('');
    session?.updateDraft({
      transcriptionProvider: choice.provider,
      transcriptionModel: choice.model
    });
    if (config !== undefined && props.creatorServicesService?.saveConfig !== undefined) {
      const nextConfig = withTranscriptionModel(config, choice.provider, choice.model);
      void props.creatorServicesService.saveConfig(nextConfig)
        .then(response => setConfig(response.config))
        .catch(() => setError(l('模型保存失败，请稍后重试', 'Could not save the model. Try again.')));
    }
  }

  function openStep(step: 0 | 1) {
    if (busy) return;
    if (step === 1 && !hasSource) {
      setError(sourceType === 'file'
        ? l('请先选择需要转录的视频或音频', 'Choose a video or audio file to transcribe')
        : l('请输入有效的 HTTP 或 HTTPS 视频链接', 'Enter a valid HTTP or HTTPS video URL'));
      return;
    }
    const nextFurthest = Math.max(furthestStep, step) as 0 | 1;
    setCurrentStep(step);
    setFurthestStep(nextFurthest);
    setError('');
    setNotice('');
    session?.updateDraft({ currentStep: step, furthestStep: nextFurthest });
  }

  async function transcribe(): Promise<boolean> {
    if (busy || (!props.embedded && currentStep !== 1)) return false;
    if (!requireGenerationAccess()) return false;
    if (!session) {
      setError(l('视频转录服务暂不可用，请检查 Runtime 连接', 'Video transcription is unavailable. Check the Runtime connection.'));
      return false;
    }
    if (!hasSource) {
      setError(sourceType === 'file'
        ? l('请先选择需要转录的视频或音频', 'Choose a video or audio file to transcribe')
        : l('请输入有效的 HTTP 或 HTTPS 视频链接', 'Enter a valid HTTP or HTTPS video URL'));
      return false;
    }
    if (official.official && !official.ready) {
      setError(l('官方转录服务暂不可用，请检查账户与模型设置', 'Official transcription is unavailable. Check your account and model settings.'));
      return false;
    }
    setError('');
    setNotice('');
    setSubmitting(true);
    session.updateDraft({
      sourceType,
      sourceUrl: sourceType === 'url' ? sourceUrl : '',
      sourceLanguage,
      targetLanguage: sourceLanguage,
      preferPlatformCaptions: false,
      ...(official.official ? official.draftPatch : {})
    }, { semantic: true });
    try {
      await session.flush();
      if (sourceType === 'file' && file) {
        setNotice(l('正在上传本地文件...', 'Uploading the local file...'));
        await session.uploadSourceVideo(file);
      }
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'transcription' }
      });
      setNotice(l('转录任务已提交，完成后会自动显示文本和字幕', 'Transcription started. The text and subtitles will appear automatically.'));
      return true;
    } catch (cause) {
      setError(formatTranscriptionError((cause as { code?: string }).code, l));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelTask() {
    if (!session || taskControlPending) return;
    setTaskControlPending('canceling');
    try { await session.cancelJob(); } catch {} finally { setTaskControlPending(undefined); }
  }

  async function resumeTask() {
    if (!session || taskControlPending) return;
    setTaskControlPending('resuming');
    try { await session.resumeJob(); } catch {} finally { setTaskControlPending(undefined); }
  }

  if (props.embedded && !result) {
    const hasUrlSource = sourceType === 'url' && sourceUrl.trim().length > 0;
    return (
      <div className="creator-tool-embedded">
        <div className="creator-tool-stack image-generation-studio">
          <form className="image-generation-composer dashboard-transcription-composer" aria-label={l('视频转录', 'Video Transcription')} onSubmit={event => {
            event.preventDefault();
            void transcribe().then(succeeded => {
              if (succeeded) props.onGenerated?.();
            });
          }}>
            <fieldset className="image-generation-fields" disabled={busy}>
              <div className="image-generation-editor">
                <div className="image-generation-composer-heading">{props.embeddedTabs}</div>
                <div className="image-generation-reference dashboard-translation-source" data-loaded={hasSource || hasUrlSource}>
                  {hasUrlSource ? (
                    <div className="dashboard-translation-link-preview" aria-label={l('视频链接预览', 'Video link preview')}>
                      <span><Link2 size={23} strokeWidth={1.5} /><strong>{l('链接预览', 'Link preview')}</strong><small>{l('已添加链接', 'Link added')}</small></span>
                    </div>
                  ) : file ? (
                    <div className="dashboard-translation-link-preview dashboard-translation-file-preview">
                      <LocalVideoPreview file={file} />
                    </div>
                  ) : hasSource ? (
                    <div className="dashboard-translation-link-preview" aria-label={l('本地视频预览', 'Local video preview')}>
                      <span><FileVideo size={23} strokeWidth={1.5} /><strong>{sourceName}</strong><small>{l('已选择视频', 'Video selected')}</small></span>
                    </div>
                  ) : (
                    <VideoTranslationSubtitleImport
                      compact
                      mediaOnly
                      sourceOnly
                      sourceLanguage={sourceLanguage}
                      targetLanguage={sourceLanguage}
                      accept="video/*,audio/*,.mp4,.mov,.m4v,.webm,.mkv,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg"
                      disabled={hasSource || hasUrlSource || busy}
                      onMediaFile={chooseFile}
                      onError={setError}
                    />
                  )}
                  {!hasUrlSource && hasSource ? (
                    <button className="image-generation-reference-remove" type="button" aria-label={l('移除当前来源', 'Clear current source')} title={l('移除当前来源', 'Clear current source')} onClick={clearSource}>
                      <X size={16} strokeWidth={1.8} />
                    </button>
                  ) : null}
                </div>
                <span className="dashboard-translation-source-divider" aria-hidden="true">{l('或', 'or')}</span>
                <div className="image-generation-prompt-field dashboard-translation-url-field">
                  <label className="image-generation-visually-hidden" htmlFor="dashboard-transcription-video-url">{l('视频链接', 'Video link')}</label>
                  <div className="dashboard-translation-url-input">
                    <Link2 size={18} strokeWidth={1.8} aria-hidden="true" />
                    <input
                      id="dashboard-transcription-video-url"
                      type="url"
                      aria-label={l('视频链接', 'Video link')}
                      placeholder={l('粘贴视频链接', 'Paste a video URL')}
                      disabled={hasSource || busy}
                      value={sourceUrl}
                      onChange={event => updateUrl(event.target.value)}
                    />
                    {hasUrlSource ? (
                      <button className="dashboard-translation-url-clear" type="button" aria-label={l('清除视频链接', 'Clear video link')} title={l('清除视频链接', 'Clear video link')} onClick={clearSource}>
                        <X size={16} strokeWidth={1.8} />
                      </button>
                    ) : null}
                  </div>
                  <SupportedVideoSources compact label={l('支持平台', 'Supported platforms')} />
                  {error || notice ? <p className={error ? 'dashboard-translation-message is-error' : 'dashboard-translation-message'} role={error ? 'alert' : 'status'}>{error || notice}</p> : null}
                </div>
              </div>
              <div className="image-generation-action-bar dashboard-translation-action-bar dashboard-transcription-action-bar">
                <div className="image-generation-model-row dashboard-transcription-model">
                  {official.official ? <OfficialModelField label={l('语音识别模型', 'Transcription model')} service={official} disabled={busy} /> : (
                    <AppSelect
                      aria-label={l('语音识别模型', 'Transcription model')}
                      value={`${provider}:${model}`}
                      disabled={busy || modelOptions.length === 0}
                      renderOptionIcon={transcriptionModelIcon}
                      onChange={event => changeModel(event.target.value)}
                    >
                      {modelOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </AppSelect>
                  )}
                </div>
                <DashboardVideoTranslationSettings
                  label={l('转录设置', 'Transcription settings')}
                  summary={[creatorLanguageLabel(sourceLanguage), model || l('跟随服务设置', 'Service default')]}
                  disabled={busy}
                >
                  <label className="creator-tool-field video-translation-field">
                    <span>{l('源语言', 'Source language')}</span>
                    <AppSelect aria-label={l('源语言', 'Source language')} value={sourceLanguage} disabled={busy} onChange={event => setSourceLanguage(event.target.value)}>
                      {sourceLanguages.map(language => <option key={language.code} value={language.code}>{language.nativeName}</option>)}
                    </AppSelect>
                  </label>
                </DashboardVideoTranslationSettings>
                <div className="image-generation-submit-row">
                  <button className="creator-tool-primary" type="submit" disabled={busy}>
                    {busy ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Captions size={16} />}
                    {busy ? l('正在转录', 'Transcribing') : l('开始转录', 'Transcribe')}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    );
  }

  return (
    <CreatorToolShell
      title={l('视频转录', 'Video Transcription')}
      subtitle={l('将视频与音频转换为文字和带时间轴的字幕', 'Turn video and audio into text and timed subtitles')}
      context={busy
        ? l('正在转录视频', 'Transcribing media')
        : result
          ? l('转录已完成', 'Transcription ready')
          : `${creatorLanguageLabel(sourceLanguage)} · SRT / TXT`}
      taskSummary={<CreatorTaskSummary
        sourceIcon={FileVideo}
        sourceLabel={l('转录来源', 'Transcription source')}
        sourceValue={sourceName}
        compactSummary={`${creatorLanguageLabel(sourceLanguage)} · SRT / TXT`}
        items={[
          { label: l('源语言', 'Source language'), value: creatorLanguageLabel(sourceLanguage) },
          { label: l('识别服务', 'Transcription service'), value: providerLabel(provider, l) },
          { label: l('模型', 'Model'), value: model || '—' },
          { label: l('输出格式', 'Output formats'), value: 'SRT / TXT' }
        ]}
      />}
      stepLabel={busy ? l('正在转录', 'Transcribing') : editorOpen && result ? l('字幕编辑', 'Subtitle editor') : currentStep === 0 ? l('添加素材', 'Add media') : l('转录设置', 'Transcription settings')}
      currentIssue={visibleError || undefined}
      suggestions={[l('转录这个视频', 'Transcribe this video'), l('编辑字幕', 'Edit subtitles')]}
      placeholder={props.promptHint ?? l('询问转录状态或调整源语言', 'Ask about transcription progress or change the source language')}
      onBack={props.onBack}
      onCancelTask={() => void cancelTask()}
      onResumeTask={() => void resumeTask()}
      taskControlPending={taskControlPending}
      pageClassName="transcription-workspace-page"
      contentClassName={`transcription-workspace-content${editorOpen && result ? ' transcription-editor-content' : ''}`}
    >
      {editorOpen && result ? <TranscriptionSubtitleEditor
        result={result}
        sourceArtifact={previewSourceArtifact}
        sourceName={transcriptBaseName(sourceName)}
        sourceLanguage={creatorLanguageLabel(sourceLanguage)}
        onBack={() => setEditorOpen(false)}
      /> : <div className="creator-tool-stack transcription-studio">
        <nav className="video-translation-steps creator-tool-steps-two transcription-steps" aria-label={l('转录流程', 'Transcription steps')}>
          <ol>
            {[l('添加素材', 'Add media'), l('转录设置', 'Transcription settings')].map((label, index) => {
              const step = index as 0 | 1;
              return <li key={label} data-active={step === currentStep} data-completed={step < currentStep}>
                <button type="button" disabled={busy || step > furthestStep} aria-current={step === currentStep ? 'step' : undefined} onClick={() => openStep(step)}>
                  <span>{step < currentStep ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : step + 1}</span>
                  <strong>{label}</strong>
                </button>
              </li>;
            })}
          </ol>
        </nav>
        <form className="transcription-composer" aria-label={l('视频转录', 'Video Transcription')} onSubmit={event => {
          event.preventDefault();
          if (currentStep === 0) openStep(1);
          else void transcribe();
        }}>
          <fieldset className="transcription-fields" disabled={busy}>
            {currentStep === 0 ? <div className="transcription-source-field">
              <VideoSourceInput
                showSupportedPlatforms
                file={file}
                registeredFile={sourceArtifact ? {
                  name: readString(sourceArtifact.metadata.fileName) || 'source',
                  size: readNumber(sourceArtifact.metadata.bytes ?? sourceArtifact.metadata.size),
                  mime: readString(sourceArtifact.metadata.mimeType) || 'application/octet-stream'
                } : undefined}
                sourceType={sourceType}
                url={sourceUrl}
                hasSource={hasSource}
                invalid={Boolean(error) && !hasSource}
                previewEnabled={sourceType === 'file' && (file !== null || sourceArtifact !== undefined)}
                onFileChange={chooseFile}
                onUrlChange={updateUrl}
                onClear={clearSource}
              />
            </div> : <section className="video-translation-step-panel transcription-settings-step" aria-labelledby="transcription-settings-title">
              <div className="video-translation-step-heading">
                <h2 id="transcription-settings-title">{l('设置转录语言与模型', 'Set transcription language and model')}</h2>
                <p>{l('转录结果保留原文，并生成文本和带时间轴的 SRT 字幕。', 'Keep the original speech as text and timed SRT subtitles.')}</p>
              </div>
              <div className="transcription-settings">
                <div className="transcription-setting-card">
                  {official.official ? (
                    <OfficialModelField label={l('语音识别模型', 'Transcription model')} service={official} disabled={busy} />
                  ) : (
                    <div className="transcription-configured-model">
                      <Captions size={22} strokeWidth={1.6} aria-hidden="true" />
                      <div>
                        <span>{l('语音识别模型', 'Transcription model')}</span>
                        <strong>{model || l('正在读取配置', 'Loading settings')}</strong>
                        <small>{providerLabel(provider, l)}</small>
                      </div>
                      <a href="#/settings?tab=ai-services&section=transcription" aria-label={l('打开转录服务设置', 'Open transcription settings')} title={l('打开转录服务设置', 'Open transcription settings')}>
                        <Settings2 size={17} aria-hidden="true" />
                      </a>
                    </div>
                  )}
                </div>
                <label className="transcription-language-field">
                  <span>{l('视频源语言', 'Source language')}</span>
                  <AppSelect aria-label={l('视频源语言', 'Source language')} value={sourceLanguage} onChange={event => {
                    setSourceLanguage(event.target.value);
                    session?.updateDraft({ sourceLanguage: event.target.value });
                    setError('');
                  }}>
                    {!sourceLanguages.some(language => language.code === sourceLanguage) ? <option value={sourceLanguage}>{sourceLanguage}</option> : null}
                    {sourceLanguages.map(language => <option key={language.code} value={language.code} data-search={[language.englishName, language.chineseName, ...language.aliases].join(' ')}>{language.nativeName}</option>)}
                  </AppSelect>
                </label>
                <p className="transcription-language-hint">{l('请选择视频中的实际语言；转录结果保留原文，不会自动翻译。', 'Choose the language spoken in the media. The transcript stays in the original language.')}</p>
              </div>
            </section>}
            <footer className="transcription-wizard-actions">
              {currentStep === 1 ? <button className="transcription-secondary-action" type="button" onClick={() => openStep(0)}>
                <ArrowLeft size={16} aria-hidden="true" />{l('上一步', 'Back')}
              </button> : <span />}
              {currentStep === 0 ? <button className="creator-tool-primary" type="submit">
                {l('继续', 'Continue')}<ArrowRight size={16} aria-hidden="true" />
              </button> : <button className="creator-tool-primary transcription-submit" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="transcription-spinner" size={16} aria-hidden="true" /> : result ? <RotateCcw size={16} aria-hidden="true" /> : <Captions size={16} aria-hidden="true" />}
                {busy ? l('正在转录', 'Transcribing') : result ? l('重新转录', 'Transcribe again') : l('开始转录', 'Start transcription')}
              </button>}
            </footer>
          </fieldset>
        </form>

        {result || running ? (
          <section className="transcription-output" aria-labelledby="transcription-output-title">
            <div className="creator-tool-panel-heading">
              <div>
                <h2 id="transcription-output-title">{l('转录结果', 'Transcript')}</h2>
                <p>{running ? l('正在识别语音并生成时间轴', 'Recognizing speech and generating timestamps') : l(`${cueCount} 条字幕 · ${transcript.length} 个字符`, `${cueCount} subtitle cues · ${transcript.length} characters`)}</p>
              </div>
              {result && srt ? <div className="transcription-downloads">
                <button type="button" onClick={() => setEditorOpen(true)}><Captions size={15} aria-hidden="true" />{l('编辑字幕', 'Edit subtitles')}</button>
              </div> : null}
            </div>
            {running || resultLoading ? (
              <div className="transcription-result-pending" role="status"><LoaderCircle className="transcription-spinner" size={20} aria-hidden="true" />{running ? l('正在转录，请稍候', 'Transcribing. Please wait.') : l('正在加载转录文本', 'Loading transcript')}</div>
            ) : srt ? (
              <div className="transcription-text" tabIndex={0} aria-label={l('转录文本', 'Transcribed text')}>{parseSrtCues(srt).map(cue => (
                <p key={cue.id}><time>{cue.start.slice(0, 8)}</time><span>{cue.text}</span></p>
              ))}</div>
            ) : result ? <div className="transcription-result-pending" role="status">{l('转录文本为空', 'The transcript is empty')}</div> : null}
          </section>
        ) : null}
        {visibleError ? <div className="creator-tool-error transcription-error" role="alert">
          <span>{visibleError}</span>
          <a href="#/settings?tab=ai-services&section=transcription">{l('打开转录服务设置', 'Open transcription settings')}</a>
        </div> : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>}
    </CreatorToolShell>
  );
}

function parseSrtCues(value: string) {
  return parseTranscriptionSrt(value);
}

function srtToText(value: string): string {
  return transcriptionSrtToText(value);
}

function transcriptBaseName(sourceName: string): string {
  const base = sourceName.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '').trim();
  return base && isHttpUrl(sourceName) === false ? base : 'OpenCreator-transcript';
}

function creatorLanguageLabel(code: string): string {
  return creatorLanguages.find(language => language.code === code)?.nativeName ?? code;
}

function readTranscriptionProvider(value: unknown): CreatorTranscriptionProvider | undefined {
  return value === 'openai' || value === 'faster-whisper' || value === 'whisperkit'
    || value === 'whisper.cpp' || value === 'aliyun' || value === 'volcengine' || value === 'funasr'
    ? value
    : undefined;
}

function withTranscriptionModel(
  current: CreatorServicesConfig,
  provider: CreatorTranscriptionProvider,
  model: string
): CreatorServicesConfig {
  const next = structuredClone(current);
  next.transcription.provider = provider;
  switch (provider) {
    case 'openai': next.transcription.openai.model = model; break;
    case 'faster-whisper': next.transcription.fasterWhisper.model = model as 'tiny' | 'medium' | 'large-v2'; break;
    case 'whisperkit': next.transcription.whisperKit.model = 'large-v2'; break;
    case 'whisper.cpp': next.transcription.whisperCpp.model = model as 'tiny' | 'medium' | 'large-v2' | 'large-v3-turbo'; break;
    case 'volcengine': next.transcription.volcengine.resourceId = model; break;
    case 'funasr': next.transcription.funasr.model = model; break;
  }
  return next;
}

function providerLabel(provider: CreatorServicesConfig['transcription']['provider'] | undefined, l: (zh: string, en: string) => string): string {
  if (provider === 'faster-whisper') return 'faster-whisper';
  if (provider === 'whisperkit') return 'WhisperKit';
  if (provider === 'whisper.cpp') return 'whisper.cpp';
  if (provider === 'aliyun') return l('阿里云', 'Alibaba Cloud');
  if (provider === 'volcengine') return l('火山引擎', 'Volcengine');
  if (provider === 'funasr') return 'FunASR / SenseVoice';
  return provider === 'openai' ? 'OpenAI Whisper' : '—';
}

function formatTranscriptionError(code: string | null | undefined, l: (zh: string, en: string) => string): string {
  if (code === 'creator_transcription_config_missing') return l('请先在设置中完成当前转录服务的配置', 'Configure the selected transcription service in Settings first');
  if (code === 'creator_transcription_language_unsupported') return l('当前转录服务不支持所选语言，请更换服务或源语言', 'The selected service does not support this language. Change the service or source language.');
  if (code === 'creator_transcription_timestamps_unavailable') return l('当前模型不提供时间戳，请选择支持 SRT 的转录服务', 'This model does not return timestamps. Choose a transcription service that supports SRT.');
  if (code === 'audio_no_speech' || code === 'audio_transcription_empty') return l('没有识别到可转录的语音，请检查视频声音后重试', 'No speech could be transcribed. Check the media audio and try again.');
  if (code) return l('转录失败，请检查文件、服务配置和网络后重试', 'Transcription failed. Check the file, service settings, and network, then retry.');
  return '';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readStep(value: CreatorJson | undefined): 0 | 1 {
  return value === 1 ? 1 : 0;
}

function readNumber(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
