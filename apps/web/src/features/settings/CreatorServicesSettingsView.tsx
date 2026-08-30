import {
  createDefaultCreatorServicesConfig,
  type CodexProviderConfig,
  type AliyunOssConfig,
  type AliyunSpeechConfig,
  type CreatorServicesCapabilitiesResponse,
  type CreatorServicesConfig,
  type CreatorServicesCredentialField,
  type CreatorTranscriptionProvider,
  type CreatorTranscriptionProviderCapability,
  type KlingAiConfig,
  type OpenAiCompatibleConfig
} from '@opencreator/protocol';
import {
  AudioLines,
  Check,
  ChevronDown,
  CircleAlert,
  Clapperboard,
  Cloud,
  Eye,
  EyeOff,
  FileKey2,
  HardDriveDownload,
  Image,
  Languages,
  LoaderCircle,
  Mic2,
  RotateCcw,
  Save
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { ConnectionService } from '../../services/connection-service.js';
import './creator-services-settings.css';

export type CreatorServicesSection = 'text' | 'transcription' | 'tts' | 'image' | 'video';
type ModelSettingsService = Pick<ConnectionService, 'getCodexProvider' | 'updateCodexProvider'>;

export function CreatorServicesSettingsView(props: {
  connected: boolean;
  service: CreatorServicesSettingsService | null;
  modelService?: ModelSettingsService | null;
  initialSection?: CreatorServicesSection;
}) {
  const l = useLocalizedCopy();
  const confirm = useConfirmDialog();
  const [activeSection, setActiveSection] = useState<CreatorServicesSection>(
    props.initialSection ?? 'text'
  );
  const [config, setConfig] = useState<CreatorServicesConfig>();
  const [capabilities, setCapabilities] = useState<CreatorServicesCapabilitiesResponse>();
  const [modelProvider, setModelProvider] = useState<CodexProviderConfig>();
  const [modelBaseUrl, setModelBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelApiKey, setModelApiKey] = useState('');
  const [configuredCredentials, setConfiguredCredentials] = useState<ReadonlySet<CreatorServicesCredentialField>>(new Set());
  const [savedTranscriptionSelection, setSavedTranscriptionSelection] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [modelError, setModelError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (props.initialSection !== undefined) setActiveSection(props.initialSection);
  }, [props.initialSection]);

  useEffect(() => {
    let active = true;
    if (!props.connected || props.service === null) {
      setLoading(false);
      setConfig(undefined);
      setCapabilities(undefined);
      setModelProvider(undefined);
      setModelError(undefined);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError(undefined);
    setModelError(undefined);
    void Promise.allSettled([
      props.service.getConfig(),
      props.service.getCapabilities(),
      props.modelService?.getCodexProvider()
        ?? Promise.reject(new Error('Model provider configuration is unavailable'))
    ])
      .then(([configResult, capabilitiesResult, providerResult]) => {
        if (!active) return;
        if (configResult.status === 'rejected' || capabilitiesResult.status === 'rejected') {
          setConfig(undefined);
          setCapabilities(undefined);
          setError(l('无法读取 AI 服务配置', 'Could not load AI service settings'));
          return;
        }
        const response = configResult.value;
        setConfig(response.config);
        setCapabilities(capabilitiesResult.value);
        setConfiguredCredentials(new Set(response.configuredCredentials));
        setSavedTranscriptionSelection(transcriptionSelection(response.config));
        const useLegacyTextModel = response.config.llm.source === 'custom';
        if (providerResult.status === 'fulfilled') {
          const provider = providerResult.value;
          setModelProvider(provider);
          setModelBaseUrl(useLegacyTextModel ? response.config.llm.baseUrl : provider.baseUrl);
          setModelName(useLegacyTextModel ? response.config.llm.model : provider.model);
        } else {
          setModelProvider(undefined);
          setModelBaseUrl(response.config.llm.baseUrl);
          setModelName(response.config.llm.model);
          setModelError(l(
            '模型服务暂不可用，语音、图像和视频服务仍可正常配置。',
            'The model provider is unavailable. Speech, image, and video services can still be configured.'
          ));
        }
        setModelApiKey('');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.connected, props.modelService, props.service]);

  const sections: Array<{
    id: CreatorServicesSection;
    label: string;
    icon: typeof Languages;
  }> = [
    { id: 'text', label: l('模型服务', 'Models'), icon: Languages },
    { id: 'transcription', label: l('语音识别', 'Transcription'), icon: Mic2 },
    { id: 'tts', label: l('配音服务', 'Voice'), icon: AudioLines },
    { id: 'image', label: l('图像生成', 'Images'), icon: Image },
    { id: 'video', label: l('视频生成', 'Video'), icon: Clapperboard }
  ];

  function updateConfig(mutator: (draft: CreatorServicesConfig) => void) {
    setConfig(current => {
      const next = structuredClone(current ?? createDefaultCreatorServicesConfig());
      mutator(next);
      return next;
    });
    setNotice(undefined);
  }

  async function save() {
    if (config === undefined || capabilities === undefined || props.service === null) return;
    const selectedCapability = transcriptionCapability(
      capabilities,
      config.transcription.provider
    );
    if (selectedCapability?.available !== true) {
      setError(l(
        '当前 Runtime 不支持已选语音识别服务，请重新选择后保存。',
        'The selected transcription provider is unavailable on this Runtime. Choose another provider before saving.'
      ));
      return;
    }
    if (
      selectedCapability?.kind === 'local'
      && transcriptionSelection(config) !== savedTranscriptionSelection
    ) {
      const confirmed = await confirm({
        title: l('启用本地语音识别', 'Enable local transcription'),
        description: l(
          `保存后，KrillinAI 下次启动时会检查并按需下载 ${transcriptionProviderLabel(config.transcription.provider, l)} ${selectedTranscriptionModel(config)}。首次准备可能需要较长时间。`,
          `After saving, KrillinAI will check and download ${transcriptionProviderLabel(config.transcription.provider, l)} ${selectedTranscriptionModel(config)} when it next starts. Initial preparation may take a while.`
        ),
        confirmLabel: l('保存并启用', 'Save and enable')
      });
      if (!confirmed) return;
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      let nextConfig = structuredClone(config);
      if (activeSection === 'text') {
        if (props.modelService === null || props.modelService === undefined || modelProvider === undefined) {
          throw new Error('Model provider configuration is unavailable');
        }
        const provider = await props.modelService.updateCodexProvider({
          baseUrl: modelBaseUrl,
          model: modelName,
          ...(modelApiKey.trim().length === 0 ? {} : { apiKey: modelApiKey })
        });
        setModelProvider(provider);
        setModelBaseUrl(provider.baseUrl);
        setModelName(provider.model);
        setModelApiKey('');
        nextConfig.llm = {
          ...nextConfig.llm,
          baseUrl: provider.baseUrl,
          apiKey: '',
          model: provider.model,
          source: 'codex'
        };
      }
      const response = await props.service.saveConfig(nextConfig);
      setConfig(response.config);
      setConfiguredCredentials(new Set(response.configuredCredentials));
      setSavedTranscriptionSelection(transcriptionSelection(response.config));
      setNotice(l('配置已安全保存', 'Settings saved securely'));
    } catch {
      setError(l('保存失败，请检查字段后重试', 'Save failed. Check the fields and try again'));
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (props.service === null) return;
    const confirmed = await confirm({
      title: l('恢复默认配置', 'Restore default settings'),
      description: l(
        '这会清除语音、图像和视频服务的 Key 与设置；模型服务配置会保留。',
        'This clears speech, image, and video service keys and settings. The model provider configuration is kept.'
      ),
      confirmLabel: l('恢复默认', 'Restore defaults'),
      destructive: true
    });
    if (!confirmed) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await props.service.resetConfig();
      setConfig(response.config);
      setConfiguredCredentials(new Set(response.configuredCredentials));
      setSavedTranscriptionSelection(transcriptionSelection(response.config));
      setNotice(l('已恢复默认配置', 'Default settings restored'));
    } catch {
      setError(l('无法恢复默认配置', 'Could not restore default settings'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section creator-services-settings" aria-labelledby="creator-services-title">
      <header className="creator-services-header">
        <div>
          <h1 id="creator-services-title">{l('AI 服务', 'AI Services')}</h1>
          <p>{l(
            '配置文本、语音、图像和视频生成使用的模型服务。',
            'Configure the model services used for text, speech, image, and video generation.'
          )}</p>
        </div>
        <span className="creator-services-security">
          <FileKey2 size={16} aria-hidden="true" />
          {l('本地配置文件', 'Local configuration file')}
        </span>
      </header>

      <div className="creator-services-tabs" role="tablist" aria-label={l('AI 服务分类', 'AI service categories')}>
        {sections.map(section => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              aria-controls={`creator-services-panel-${section.id}`}
              onClick={() => setActiveSection(section.id)}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
              {section.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="creator-services-state">
          <LoaderCircle className="creator-services-spinner" size={18} aria-hidden="true" />
          {l('正在读取配置', 'Loading settings')}
        </div>
      ) : !props.connected || props.service === null ? (
        <div className="creator-services-state">
          {l('连接本地 Runtime 后即可管理 AI 服务配置。', 'Connect the local Runtime to manage AI service settings.')}
        </div>
      ) : config === undefined || capabilities === undefined ? (
        <div className="creator-services-state" role="alert">
          {error ?? l('配置暂不可用', 'Settings are unavailable')}
        </div>
      ) : (
        <form
          className="creator-services-form"
          id={`creator-services-panel-${activeSection}`}
          role="tabpanel"
          onSubmit={event => {
            event.preventDefault();
            void save();
          }}
        >
          {activeSection === 'text' ? (
            <TextModelSettings
              config={config}
              update={updateConfig}
              configuredCredentials={configuredCredentials}
              provider={modelProvider}
              baseUrl={modelBaseUrl}
              model={modelName}
              apiKey={modelApiKey}
              error={modelError}
              onProviderChange={value => {
                setModelBaseUrl(value.baseUrl);
                setModelName(value.model);
                setModelApiKey(value.apiKey);
                setNotice(undefined);
              }}
            />
          ) : null}
          {activeSection === 'transcription' ? (
            <TranscriptionSettings
              config={config}
              update={updateConfig}
              configuredCredentials={configuredCredentials}
              capabilities={capabilities}
            />
          ) : null}
          {activeSection === 'tts' ? (
            <TtsSettings
              config={config}
              update={updateConfig}
              configuredCredentials={configuredCredentials}
              service={props.service}
            />
          ) : null}
          {activeSection === 'image' ? (
            <ImageSettings config={config} update={updateConfig} configuredCredentials={configuredCredentials} />
          ) : null}
          {activeSection === 'video' ? (
            <VideoSettings config={config} update={updateConfig} configuredCredentials={configuredCredentials} />
          ) : null}

          <footer className="creator-services-actions">
            <div aria-live="polite">
              {error ? <p className="settings-error" role="alert">{error}</p> : null}
              {notice ? <p className="settings-notice">{notice}</p> : null}
            </div>
            <button
              className="settings-secondary-button"
              type="button"
              disabled={saving}
              onClick={() => void reset()}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {l('恢复默认', 'Restore defaults')}
            </button>
            <button
              className="settings-primary-button"
              type="submit"
              disabled={
                saving
                || (
                  activeSection === 'text'
                  && (modelProvider === undefined || modelName.trim().length === 0)
                )
              }
            >
              {saving ? (
                <LoaderCircle className="creator-services-spinner" size={15} aria-hidden="true" />
              ) : (
                <Save size={15} aria-hidden="true" />
              )}
              {saving ? l('保存中', 'Saving') : l('保存配置', 'Save settings')}
            </button>
          </footer>
        </form>
      )}
    </section>
  );
}

function TextModelSettings(props: SettingsGroupProps & {
  provider?: CodexProviderConfig;
  baseUrl: string;
  model: string;
  apiKey: string;
  error?: string;
  onProviderChange(value: OpenAiCompatibleConfig): void;
}) {
  const l = useLocalizedCopy();
  const legacyApiKeyConfigured = props.config.llm.source === 'custom'
    && props.configuredCredentials.has('llm.apiKey');
  const providerApiKeyConfigured = props.provider?.apiKeyConfigured === true;
  const apiKeyConfigured = providerApiKeyConfigured || legacyApiKeyConfigured;
  const agentAvailable = props.provider?.authentication !== 'none' || providerApiKeyConfigured;
  const textTasksAvailable = apiKeyConfigured;
  const AgentStatusIcon = agentAvailable ? Check : CircleAlert;
  const TextTaskStatusIcon = textTasksAvailable ? Check : CircleAlert;
  const modelCredentials = apiKeyConfigured
    ? new Set<CreatorServicesCredentialField>(['llm.apiKey'])
    : new Set<CreatorServicesCredentialField>();
  return (
    <>
      <SettingsFieldset
        title={l('模型服务', 'Model provider')}
        description={l(
          'OpenCreator Agent 与翻译、脚本处理等文本任务共用这一套 OpenAI 兼容配置。',
          'OpenCreator Agent and text tasks such as translation and script processing share this OpenAI-compatible configuration.'
        )}
      >
        <OpenAiFields
          id="llm"
          credential="llm.apiKey"
          configuredCredentials={modelCredentials}
          value={{
            baseUrl: props.baseUrl,
            apiKey: props.apiKey,
            model: props.model
          }}
          modelPlaceholder="gpt-4o-mini"
          onChange={props.onProviderChange}
        />
        <div className="creator-services-model-status is-wide" role="status">
          <span className={agentAvailable ? '' : 'is-warning'}>
            <AgentStatusIcon size={15} aria-hidden="true" />
            {agentAvailable
              ? l('Agent 可用', 'Agent ready')
              : l('Agent 尚未配置', 'Agent not configured')}
          </span>
          <span className={textTasksAvailable ? '' : 'is-warning'}>
            <TextTaskStatusIcon size={15} aria-hidden="true" />
            {textTasksAvailable
              ? l('文本任务可用', 'Text tasks ready')
              : l('文本任务需要 API Key', 'Text tasks require an API key')}
          </span>
        </div>
        {props.provider?.authentication === 'chatgpt' && !textTasksAvailable ? (
          <p className="creator-services-inline-note is-warning">
            {l(
              'ChatGPT 登录可用于 Agent，但视频翻译等文本任务通过兼容 API 调用，仍需填写 API Key。',
              'ChatGPT sign-in can power the Agent, but text tasks such as video translation use the compatible API and still require an API key.'
            )}
          </p>
        ) : null}
        {props.error === undefined ? null : (
          <p className="creator-services-inline-note is-warning" role="alert">
            {props.error}
          </p>
        )}
      </SettingsFieldset>
      <SettingsFieldset
        title={l('网络', 'Network')}
        description={l('可选。为模型和媒体请求指定 HTTP 代理。', 'Optional. Route model and media requests through an HTTP proxy.')}
      >
        <TextField
          id="creator-services-proxy"
          label={l('代理地址', 'Proxy URL')}
          value={props.config.proxy}
          placeholder="http://127.0.0.1:7890"
          onChange={value => props.update(config => {
            config.proxy = value;
          })}
          wide
        />
      </SettingsFieldset>
    </>
  );
}

function TranscriptionSettings(props: SettingsGroupProps & {
  capabilities: CreatorServicesCapabilitiesResponse;
}) {
  const l = useLocalizedCopy();
  const provider = props.config.transcription.provider;
  const selectedCapability = transcriptionCapability(props.capabilities, provider);
  const mode = selectedCapability?.kind
    ?? (isLocalTranscriptionProvider(provider) ? 'local' : 'cloud');
  const availableCloudProviders = props.capabilities.transcription.providers.filter(
    candidate => candidate.kind === 'cloud' && candidate.available
  );
  const availableLocalProviders = props.capabilities.transcription.providers.filter(
    candidate => candidate.kind === 'local' && candidate.available
  );
  const visibleProviders = mode === 'cloud'
    ? availableCloudProviders
    : selectedCapability?.kind === 'local' && !selectedCapability.available
      ? [selectedCapability, ...availableLocalProviders]
      : availableLocalProviders;

  function selectMode(nextMode: 'cloud' | 'local') {
    const nextProvider = (nextMode === 'cloud'
      ? availableCloudProviders
      : availableLocalProviders)[0];
    if (nextProvider === undefined) return;
    props.update(config => {
      config.transcription.provider = nextProvider.provider;
    });
  }

  return (
    <SettingsFieldset
      title={l('语音识别', 'Speech transcription')}
      description={l(
        '选择实际需要语音识别时使用的服务。KrillinAI 会严格使用保存的配置，不会在云端与本地服务之间自动切换。',
        'Choose the provider used when speech recognition is actually required. KrillinAI follows the saved setting and never switches automatically between cloud and local providers.'
      )}
    >
      <p className="creator-services-runtime-note">
        {l('当前 Runtime', 'Current Runtime')}
        <strong>{formatRuntimeLabel(props.capabilities.platform, props.capabilities.arch)}</strong>
      </p>
      <TranscriptionModeField
        value={mode}
        localAvailable={availableLocalProviders.length > 0}
        onChange={selectMode}
      />
      <SelectField
        id="transcription-provider"
        label={l('语音识别服务', 'Transcription provider')}
        value={provider}
        options={visibleProviders.map(candidate => [
          candidate.provider,
          candidate.available
            ? transcriptionProviderLabel(candidate.provider, l)
            : l(
              `${transcriptionProviderLabel(candidate.provider, l)}（当前不可用）`,
              `${transcriptionProviderLabel(candidate.provider, l)} (unavailable)`
            )
        ] as [string, string])}
        onChange={value => props.update(config => {
          config.transcription.provider = value as CreatorTranscriptionProvider;
        })}
      />
      {selectedCapability?.available === false ? (
        <p className="creator-services-inline-note is-warning" role="alert">
          {l(
            `当前 ${formatRuntimeLabel(props.capabilities.platform, props.capabilities.arch)} 不支持 ${transcriptionProviderLabel(provider, l)} 的受控安装，请重新选择可用服务。`,
            `${transcriptionProviderLabel(provider, l)} cannot be installed by the current ${formatRuntimeLabel(props.capabilities.platform, props.capabilities.arch)} Runtime. Choose an available provider.`
          )}
        </p>
      ) : null}
      {provider === 'openai' ? (
        <>
          <OpenAiFields
            id="transcription-openai"
            credential="transcription.openai.apiKey"
            configuredCredentials={props.configuredCredentials}
            value={props.config.transcription.openai}
            modelPlaceholder="whisper-1"
            modelReadonly
            onChange={value => props.update(config => {
              config.transcription.openai = value;
            })}
          />
          {!props.configuredCredentials.has('transcription.openai.apiKey')
            && props.config.transcription.openai.apiKey.trim().length === 0 ? (
              <p className="creator-services-inline-note">
                {l(
                  'API Key 可以暂不填写。只有任务实际调用语音识别时才会提示配置；直接使用平台字幕的任务不会校验此 Key。',
                  'The API key may be left blank for now. It is requested only when a task actually calls speech recognition; tasks using platform captions do not validate it.'
                )}
              </p>
            ) : null}
        </>
      ) : null}
      {provider === 'faster-whisper' ? (
        <>
          <SelectField
            id="faster-whisper-model"
            label={l('本地模型', 'Local model')}
            value={props.config.transcription.fasterWhisper.model}
            options={(selectedCapability?.models ?? []).map(model => [model, model])}
            onChange={value => props.update(config => {
              config.transcription.fasterWhisper.model = value as 'tiny' | 'medium' | 'large-v2';
            })}
          />
          {selectedCapability?.gpuAcceleration ? (
            <ToggleField
              label={l('GPU 加速', 'GPU acceleration')}
              description={l('仅在当前设备已正确配置 CUDA 时开启。', 'Enable only when CUDA is configured correctly on this device.')}
              checked={props.config.transcription.enableGpuAcceleration}
              onChange={checked => props.update(config => {
                config.transcription.enableGpuAcceleration = checked;
              })}
            />
          ) : null}
        </>
      ) : null}
      {provider === 'whisperkit' ? (
        <ReadonlyModelField
          label={l('本地模型', 'Local model')}
          value={selectedCapability?.models[0] ?? props.config.transcription.whisperKit.model}
        />
      ) : null}
      {provider === 'whisper.cpp' ? (
        <SelectField
          id="whisper-cpp-model"
          label={l('本地模型', 'Local model')}
          value={props.config.transcription.whisperCpp.model}
          options={(selectedCapability?.models ?? []).map(model => [model, model])}
          onChange={value => props.update(config => {
            config.transcription.whisperCpp.model = value as 'tiny' | 'medium' | 'large-v2';
          })}
        />
      ) : null}
      {provider === 'aliyun' ? (
        <AliyunFields
          id="transcription-aliyun"
          credentialPrefix="transcription.aliyun"
          configuredCredentials={props.configuredCredentials}
          oss={props.config.transcription.aliyun.oss}
          speech={props.config.transcription.aliyun.speech}
          onOssChange={value => props.update(config => {
            config.transcription.aliyun.oss = value;
          })}
          onSpeechChange={value => props.update(config => {
            config.transcription.aliyun.speech = value;
          })}
        />
      ) : null}
      {selectedCapability?.kind === 'local' && selectedCapability.available ? (
        <p className="creator-services-inline-note">
          {l(
            '保存后，KrillinAI 下次启动时会检查所选本地模型，缺失时才开始下载。未选择本地 Whisper 时不会下载。',
            'After saving, KrillinAI checks the selected local model the next time it starts and downloads it only if missing. No model is downloaded unless local Whisper is selected.'
          )}
        </p>
      ) : null}
    </SettingsFieldset>
  );
}

function TranscriptionModeField(props: {
  value: 'cloud' | 'local';
  localAvailable: boolean;
  onChange(value: 'cloud' | 'local'): void;
}) {
  const l = useLocalizedCopy();
  return (
    <div className="creator-services-field is-wide">
      <span>{l('运行方式', 'Mode')}</span>
      <div
        className="creator-services-segmented"
        role="group"
        aria-label={l('语音识别运行方式', 'Transcription mode')}
      >
        <button
          type="button"
          aria-pressed={props.value === 'cloud'}
          onClick={() => props.onChange('cloud')}
        >
          <Cloud size={16} aria-hidden="true" />
          {l('云端 API', 'Cloud API')}
        </button>
        <button
          type="button"
          aria-pressed={props.value === 'local'}
          disabled={!props.localAvailable && props.value !== 'local'}
          onClick={() => props.onChange('local')}
        >
          <HardDriveDownload size={16} aria-hidden="true" />
          {l('本地 Whisper', 'Local Whisper')}
        </button>
      </div>
    </div>
  );
}

function TtsSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  const provider = props.config.tts.provider;
  return (
    <SettingsFieldset
      title={l('配音服务', 'Dubbing and speech synthesis')}
      description={l(
        '统一配置视频翻译和智能配音使用的服务商、模型与默认音色。',
        'Configure the provider, model, and default voice shared by video translation and AI dubbing.'
      )}
    >
      <SelectField
        id="tts-provider"
        label={l('服务商', 'Provider')}
        value={provider}
        options={[
          ['openai', 'OpenAI TTS'],
          ['minimax', 'MiniMax'],
          ['aliyun', l('阿里云百炼', 'Alibaba Cloud Model Studio')],
          ['edge-tts', 'Edge TTS']
        ]}
        onChange={value => props.update(config => {
          config.tts.provider = value as CreatorServicesConfig['tts']['provider'];
        })}
      />
      {provider === 'openai' ? (
        <OpenAiFields
          id="tts-openai"
          credential="tts.openai.apiKey"
          configuredCredentials={props.configuredCredentials}
          value={props.config.tts.openai}
          modelPlaceholder="gpt-4o-mini-tts"
          onChange={value => props.update(config => {
            config.tts.openai = { ...config.tts.openai, ...value };
          })}
        />
      ) : null}
      {provider === 'minimax' ? (
        <OpenAiFields
          id="tts-minimax"
          credential="tts.minimax.apiKey"
          configuredCredentials={props.configuredCredentials}
          value={props.config.tts.minimax}
          modelPlaceholder="speech-2.8-hd"
          baseUrlPlaceholder="https://api.minimax.io"
          onChange={value => props.update(config => {
            config.tts.minimax = { ...config.tts.minimax, ...value };
          })}
        />
      ) : null}
      {provider === 'aliyun' ? (
        <OpenAiFields
          id="tts-aliyun"
          credential="tts.aliyun.apiKey"
          configuredCredentials={props.configuredCredentials}
          value={props.config.tts.aliyun}
          modelPlaceholder="qwen3-tts-flash"
          baseUrlPlaceholder="https://dashscope.aliyuncs.com/api/v1"
          onChange={value => props.update(config => {
            config.tts.aliyun = { ...config.tts.aliyun, ...value };
          })}
        />
      ) : null}
      {provider !== 'edge-tts' ? (
        <div className="creator-services-tts-voice">
          <TtsVoicePicker
            id={`tts-${provider}-default-voice`}
            provider={provider}
            model={props.config.tts[provider].model}
            value={props.config.tts[provider].defaultVoiceId}
            service={props.service ?? null}
            onChange={voiceId => props.update(config => {
              config.tts[provider].defaultVoiceId = voiceId;
            })}
          />
        </div>
      ) : null}
      {provider === 'edge-tts' ? (
        <p className="creator-services-inline-note">
          {l('无需填写凭据。运行时会使用本地 Edge TTS 服务。', 'No credentials required. The Runtime will use the local Edge TTS service.')}
        </p>
      ) : null}
    </SettingsFieldset>
  );
}

function ImageSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  const provider = props.config.image.provider;
  return (
    <SettingsFieldset
      title={l('图像生成', 'Image generation')}
      description={l('配置 GPT Image、即梦、可灵或 Gemini 图像服务。', 'Configure GPT Image, Jimeng, Kling, or Gemini image generation.')}
    >
      <SelectField
        id="image-provider"
        label={l('服务商', 'Provider')}
        value={provider}
        options={[
          ['openai', 'GPT Image'],
          ['jimeng', l('即梦', 'Jimeng')],
          ['kling', l('可灵', 'Kling')],
          ['gemini', 'Gemini']
        ]}
        onChange={value => props.update(config => {
          config.image.provider = value as CreatorServicesConfig['image']['provider'];
        })}
      />
      {provider === 'openai' ? <OpenAiFields id="image-openai" credential="image.openai.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.image.openai} modelPlaceholder="gpt-image-1" onChange={value => props.update(config => { config.image.openai = value; })} /> : null}
      {provider === 'jimeng' ? <OpenAiFields id="image-jimeng" credential="image.jimeng.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.image.jimeng} modelPlaceholder="doubao-seedream-4-0-250828" baseUrlPlaceholder="https://ark.cn-beijing.volces.com/api/v3" onChange={value => props.update(config => { config.image.jimeng = value; })} /> : null}
      {provider === 'kling' ? <KlingFields id="image-kling" accessKeyCredential="image.kling.accessKey" secretKeyCredential="image.kling.secretKey" configuredCredentials={props.configuredCredentials} value={props.config.image.kling} modelPlaceholder="kling-v2-1" onChange={value => props.update(config => { config.image.kling = value; })} /> : null}
      {provider === 'gemini' ? <OpenAiFields id="image-gemini" credential="image.gemini.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.image.gemini} modelPlaceholder="gemini-2.5-flash-image" baseUrlPlaceholder="https://generativelanguage.googleapis.com/v1beta" onChange={value => props.update(config => { config.image.gemini = value; })} /> : null}
    </SettingsFieldset>
  );
}

function VideoSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  const provider = props.config.video.provider;
  return (
    <SettingsFieldset
      title={l('视频生成', 'Video generation')}
      description={l('配置 Seedance、可灵或 Veo 视频生成服务。', 'Configure Seedance, Kling, or Veo video generation.')}
    >
      <SelectField
        id="video-provider"
        label={l('服务商', 'Provider')}
        value={provider}
        options={[
          ['seedance', 'Seedance'],
          ['kling', l('可灵', 'Kling')],
          ['veo', 'Veo']
        ]}
        onChange={value => props.update(config => {
          config.video.provider = value as CreatorServicesConfig['video']['provider'];
        })}
      />
      {provider === 'seedance' ? <OpenAiFields id="video-seedance" credential="video.seedance.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.video.seedance} modelPlaceholder="doubao-seedance-1-0-pro-250528" baseUrlPlaceholder="https://ark.cn-beijing.volces.com/api/v3" onChange={value => props.update(config => { config.video.seedance = value; })} /> : null}
      {provider === 'kling' ? <KlingFields id="video-kling" accessKeyCredential="video.kling.accessKey" secretKeyCredential="video.kling.secretKey" configuredCredentials={props.configuredCredentials} value={props.config.video.kling} modelPlaceholder="kling-v2-1-master" onChange={value => props.update(config => { config.video.kling = value; })} /> : null}
      {provider === 'veo' ? <OpenAiFields id="video-veo" credential="video.veo.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.video.veo} modelPlaceholder="veo-3.1-generate-preview" baseUrlPlaceholder="https://generativelanguage.googleapis.com/v1beta" onChange={value => props.update(config => { config.video.veo = value; })} /> : null}
    </SettingsFieldset>
  );
}

type SettingsGroupProps = {
  config: CreatorServicesConfig;
  configuredCredentials: ReadonlySet<CreatorServicesCredentialField>;
  service?: CreatorServicesSettingsService | null;
  update(mutator: (draft: CreatorServicesConfig) => void): void;
};

function SettingsFieldset(props: { title: string; description: string; children: ReactNode }) {
  return (
    <fieldset className="creator-services-fieldset">
      <legend>{props.title}</legend>
      <p>{props.description}</p>
      <div className="creator-services-grid">{props.children}</div>
    </fieldset>
  );
}

function OpenAiFields(props: {
  id: string;
  credential: CreatorServicesCredentialField;
  configuredCredentials: ReadonlySet<CreatorServicesCredentialField>;
  value: OpenAiCompatibleConfig;
  modelPlaceholder: string;
  modelReadonly?: boolean;
  baseUrlPlaceholder?: string;
  onChange(value: OpenAiCompatibleConfig): void;
}) {
  const l = useLocalizedCopy();
  return (
    <>
      <TextField
        id={`${props.id}-base-url`}
        label={l('Base URL', 'Base URL')}
        value={props.value.baseUrl}
        placeholder={props.baseUrlPlaceholder ?? 'https://api.openai.com/v1'}
        onChange={baseUrl => props.onChange({ ...props.value, baseUrl })}
        wide
      />
      <PasswordField
        id={`${props.id}-api-key`}
        label="API Key"
        value={props.value.apiKey}
        configured={props.configuredCredentials.has(props.credential)}
        onChange={apiKey => props.onChange({ ...props.value, apiKey })}
      />
      {props.modelReadonly ? (
        <ReadonlyModelField label={l('模型', 'Model')} value={props.modelPlaceholder} />
      ) : (
        <TextField
          id={`${props.id}-model`}
          label={l('模型', 'Model')}
          value={props.value.model}
          placeholder={props.modelPlaceholder}
          onChange={model => props.onChange({ ...props.value, model })}
        />
      )}
    </>
  );
}

function KlingFields(props: {
  id: string;
  accessKeyCredential: CreatorServicesCredentialField;
  secretKeyCredential: CreatorServicesCredentialField;
  configuredCredentials: ReadonlySet<CreatorServicesCredentialField>;
  value: KlingAiConfig;
  modelPlaceholder: string;
  onChange(value: KlingAiConfig): void;
}) {
  return (
    <>
      <TextField id={`${props.id}-base-url`} label="Base URL" value={props.value.baseUrl} placeholder="https://api-beijing.klingai.com" onChange={baseUrl => props.onChange({ ...props.value, baseUrl })} wide />
      <PasswordField id={`${props.id}-access-key`} label="Access Key" value={props.value.accessKey} configured={props.configuredCredentials.has(props.accessKeyCredential)} onChange={accessKey => props.onChange({ ...props.value, accessKey })} />
      <PasswordField id={`${props.id}-secret-key`} label="Secret Key" value={props.value.secretKey} configured={props.configuredCredentials.has(props.secretKeyCredential)} onChange={secretKey => props.onChange({ ...props.value, secretKey })} />
      <TextField id={`${props.id}-model`} label="Model" value={props.value.model} placeholder={props.modelPlaceholder} onChange={model => props.onChange({ ...props.value, model })} />
    </>
  );
}

function AliyunFields(props: {
  id: string;
  credentialPrefix: 'transcription.aliyun';
  configuredCredentials: ReadonlySet<CreatorServicesCredentialField>;
  oss: AliyunOssConfig;
  speech: AliyunSpeechConfig;
  onOssChange(value: AliyunOssConfig): void;
  onSpeechChange(value: AliyunSpeechConfig): void;
}) {
  const l = useLocalizedCopy();
  return (
    <>
      <h3 className="creator-services-subheading">{l('OSS 存储', 'OSS storage')}</h3>
      <PasswordField
        id={`${props.id}-oss-access-key-id`}
        label="Access Key ID"
        value={props.oss.accessKeyId}
        configured={props.configuredCredentials.has(`${props.credentialPrefix}.oss.accessKeyId` as CreatorServicesCredentialField)}
        onChange={accessKeyId => props.onOssChange({ ...props.oss, accessKeyId })}
      />
      <PasswordField
        id={`${props.id}-oss-access-key-secret`}
        label="Access Key Secret"
        value={props.oss.accessKeySecret}
        configured={props.configuredCredentials.has(`${props.credentialPrefix}.oss.accessKeySecret` as CreatorServicesCredentialField)}
        onChange={accessKeySecret => props.onOssChange({ ...props.oss, accessKeySecret })}
      />
      <PasswordField
        id={`${props.id}-oss-bucket`}
        label="Bucket"
        value={props.oss.bucket}
        onChange={bucket => props.onOssChange({ ...props.oss, bucket })}
      />
      <h3 className="creator-services-subheading">{l('语音服务', 'Speech service')}</h3>
      <PasswordField
        id={`${props.id}-speech-access-key-id`}
        label="Access Key ID"
        value={props.speech.accessKeyId}
        configured={props.configuredCredentials.has(`${props.credentialPrefix}.speech.accessKeyId` as CreatorServicesCredentialField)}
        onChange={accessKeyId => props.onSpeechChange({ ...props.speech, accessKeyId })}
      />
      <PasswordField
        id={`${props.id}-speech-access-key-secret`}
        label="Access Key Secret"
        value={props.speech.accessKeySecret}
        configured={props.configuredCredentials.has(`${props.credentialPrefix}.speech.accessKeySecret` as CreatorServicesCredentialField)}
        onChange={accessKeySecret => props.onSpeechChange({ ...props.speech, accessKeySecret })}
      />
      <PasswordField
        id={`${props.id}-speech-app-key`}
        label="App Key"
        value={props.speech.appKey}
        configured={props.configuredCredentials.has(`${props.credentialPrefix}.speech.appKey` as CreatorServicesCredentialField)}
        onChange={appKey => props.onSpeechChange({ ...props.speech, appKey })}
      />
    </>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  wide?: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className={props.wide ? 'creator-services-field is-wide' : 'creator-services-field'} htmlFor={props.id}>
      <span>{props.label}</span>
      <input
        id={props.id}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={event => props.onChange(event.target.value)}
      />
    </label>
  );
}

function PasswordField(props: {
  id: string;
  label: string;
  value: string;
  configured?: boolean;
  onChange(value: string): void;
}) {
  const l = useLocalizedCopy();
  const [visible, setVisible] = useState(false);
  return (
    <label className="creator-services-field" htmlFor={props.id}>
      <span>{props.label}</span>
      <span className="creator-services-secret-input">
        <input
          id={props.id}
          type={visible ? 'text' : 'password'}
          value={props.value}
          placeholder={props.configured
            ? l('已配置，留空则保持', 'Configured; leave blank to keep')
            : l('输入密钥', 'Enter key')}
          spellCheck={false}
          autoComplete="new-password"
          onChange={event => props.onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={visible ? l('隐藏密钥', 'Hide key') : l('显示密钥', 'Show key')}
          title={visible ? l('隐藏密钥', 'Hide key') : l('显示密钥', 'Show key')}
          onClick={() => setVisible(current => !current)}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </label>
  );
}

function SelectField(props: {
  id: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedLabel = props.options.find(([value]) => value === props.value)?.[1] ?? props.value;
  const labelId = `${props.id}-label`;
  const listboxId = `${props.id}-listbox`;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    });
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  function select(value: string) {
    props.onChange(value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveOptionFocus(event: KeyboardEvent<HTMLElement>, direction: -1 | 1 | 'first' | 'last') {
    const options = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLElement);
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? options.length - 1
        : (Math.max(0, currentIndex) + direction + options.length) % options.length;
    options[nextIndex]?.focus();
  }

  return (
    <div
      className="creator-services-field creator-services-select"
      ref={rootRef}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span id={labelId}>{props.label}</span>
      <button
        ref={triggerRef}
        id={props.id}
        className="creator-services-select-trigger"
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={listboxId}
          className="creator-services-select-menu"
          role="listbox"
          aria-labelledby={labelId}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === 'ArrowDown') {
              moveOptionFocus(event, 1);
            } else if (event.key === 'ArrowUp') {
              moveOptionFocus(event, -1);
            } else if (event.key === 'Home') {
              moveOptionFocus(event, 'first');
            } else if (event.key === 'End') {
              moveOptionFocus(event, 'last');
            }
          }}
        >
          {props.options.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="option"
              aria-selected={value === props.value}
              onClick={() => select(value)}
            >
              <span>{label}</span>
              {value === props.value ? <Check size={15} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReadonlyModelField(props: { label: string; value: string }) {
  return (
    <div className="creator-services-field">
      <span>{props.label}</span>
      <output>{props.value}</output>
    </div>
  );
}

function ToggleField(props: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="creator-services-toggle">
      <span>
        <strong>{props.label}</strong>
        {props.description === undefined ? null : <small>{props.description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={event => props.onChange(event.target.checked)}
      />
    </label>
  );
}

type LocalizedCopy = (zh: string, en: string) => string;

function transcriptionCapability(
  capabilities: CreatorServicesCapabilitiesResponse,
  provider: CreatorTranscriptionProvider
): CreatorTranscriptionProviderCapability | undefined {
  return capabilities.transcription.providers.find(candidate => (
    candidate.provider === provider
  ));
}

function isLocalTranscriptionProvider(provider: CreatorTranscriptionProvider): boolean {
  return provider === 'faster-whisper'
    || provider === 'whisperkit'
    || provider === 'whisper.cpp';
}

function transcriptionSelection(config: CreatorServicesConfig): string {
  return `${config.transcription.provider}:${selectedTranscriptionModel(config)}`;
}

function selectedTranscriptionModel(config: CreatorServicesConfig): string {
  switch (config.transcription.provider) {
    case 'openai':
      return config.transcription.openai.model;
    case 'faster-whisper':
      return config.transcription.fasterWhisper.model;
    case 'whisperkit':
      return config.transcription.whisperKit.model;
    case 'whisper.cpp':
      return config.transcription.whisperCpp.model;
    case 'aliyun':
      return '';
  }
}

function transcriptionProviderLabel(
  provider: CreatorTranscriptionProvider,
  l: LocalizedCopy
): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI Whisper';
    case 'faster-whisper':
      return 'FasterWhisper';
    case 'whisperkit':
      return 'WhisperKit';
    case 'whisper.cpp':
      return 'Whisper.cpp';
    case 'aliyun':
      return l('阿里云百炼', 'Alibaba Cloud Model Studio');
  }
}

function formatRuntimeLabel(platform: string, arch: string): string {
  const platformLabel = platform === 'darwin'
    ? 'macOS'
    : platform === 'win32'
      ? 'Windows'
      : platform === 'linux'
        ? 'Linux'
        : platform;
  const archLabel = platform === 'darwin' && arch === 'arm64'
    ? 'Apple Silicon'
    : arch === 'x64'
      ? 'x64'
      : arch === 'arm64'
        ? 'ARM64'
        : arch;
  return `${platformLabel} · ${archLabel}`;
}
