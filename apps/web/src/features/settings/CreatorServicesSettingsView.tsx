import {
  createDefaultCreatorServicesConfig,
  creatorProviderCatalogById,
  creatorProviderOfKind,
  defaultVideoGenerationModels,
  videoGenerationModelIds,
  type CodexProviderConfig,
  type AliyunOssConfig,
  type AliyunSpeechConfig,
  type CreatorServicesCapabilitiesResponse,
  type CreatorServicesConfig,
  type CreatorServicesCredentialField,
  type CreatorTranscriptionProvider,
  type CreatorTranscriptionProviderCapability,
  type KlingAiConfig,
  type OpenAiCompatibleConfig,
  type VolcengineAsrConfig,
  type VolcengineTtsConfig
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
type ModelSettingsService = Pick<ConnectionService, 'getCodexProvider' | 'updateCodexProvider'> & {
  getCodexModels?: ConnectionService['getCodexModels'];
};
type ModelFieldErrors = Partial<Record<'baseUrl' | 'apiKey' | 'model' | 'proxy', string>>;
type TextModelMode = 'codex' | 'custom';

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
  const [textModelMode, setTextModelMode] = useState<TextModelMode>('codex');
  const [modelProviderId, setModelProviderId] = useState('custom');
  const [runtimeModelIds, setRuntimeModelIds] = useState<string[]>([]);
  const [modelBaseUrl, setModelBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelApiKey, setModelApiKey] = useState('');
  const [configuredCredentials, setConfiguredCredentials] = useState<ReadonlySet<CreatorServicesCredentialField>>(new Set());
  const [savedTranscriptionSelection, setSavedTranscriptionSelection] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [modelError, setModelError] = useState<string>();
  const [modelFieldErrors, setModelFieldErrors] = useState<ModelFieldErrors>({});
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
      ,props.modelService?.getCodexModels?.()
        ?? Promise.reject(new Error('Model catalog is unavailable'))
    ])
      .then(([configResult, capabilitiesResult, providerResult, modelsResult]) => {
        if (!active) return;
        if (configResult.status === 'rejected' || capabilitiesResult.status === 'rejected') {
          setConfig(undefined);
          setCapabilities(undefined);
          setError(l('无法读取 AI 服务配置', 'Could not load AI service settings'));
          return;
        }
        const response = configResult.value;
        setRuntimeModelIds(modelsResult.status === 'fulfilled'
          ? modelsResult.value.models.map(model => model.model)
          : []);
        setConfig(response.config);
        setTextModelMode(response.config.llm.source);
        setCapabilities(capabilitiesResult.value);
        setConfiguredCredentials(new Set(response.configuredCredentials));
        setSavedTranscriptionSelection(transcriptionSelection(response.config));
        const useLegacyTextModel = response.config.llm.source === 'custom';
        if (providerResult.status === 'fulfilled') {
          const provider = providerResult.value;
          setModelProvider(provider);
          setModelProviderId(inferLlmProviderId(provider.baseUrl, provider.model));
          setModelBaseUrl(useLegacyTextModel ? response.config.llm.baseUrl : provider.baseUrl);
          setModelName(useLegacyTextModel ? response.config.llm.model : provider.model);
        } else {
          setModelProvider(undefined);
          setModelProviderId('custom');
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
    setModelFieldErrors({});
    setError(undefined);
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
    if (activeSection === 'text') {
      const fieldErrors = textModelMode === 'custom'
        ? validateModelFields(modelBaseUrl, modelName, modelApiKey, config.proxy, l)
        : validateModelFields('', 'codex', '', config.proxy, l);
      setModelFieldErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) {
        setError(l(
          '模型服务配置有误，请修改标出的字段。',
          'The model provider settings are invalid. Fix the highlighted fields.'
        ));
        return;
      }
    }
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      let nextConfig = structuredClone(config);
      if (activeSection === 'text') {
        if (textModelMode === 'codex') {
          nextConfig.llm = { ...nextConfig.llm, apiKey: '', source: 'codex' };
        } else {
          nextConfig.llm = {
            ...nextConfig.llm,
            baseUrl: modelBaseUrl,
            apiKey: modelApiKey,
            model: modelName,
            source: 'custom'
          };
        }
      }
      const response = await props.service.saveConfig(nextConfig);
      setConfig(response.config);
      setConfiguredCredentials(new Set(response.configuredCredentials));
      setSavedTranscriptionSelection(transcriptionSelection(response.config));
      setNotice(l('配置已安全保存', 'Settings saved securely'));
    } catch (cause) {
      const message = readableSaveError(cause, l);
      setError(l(`创作服务保存失败：${message}`, `Could not save creator services: ${message}`));
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
              mode={textModelMode}
              onModeChange={setTextModelMode}
              baseUrl={modelBaseUrl}
              model={modelName}
              apiKey={modelApiKey}
              error={modelError}
              fieldErrors={modelFieldErrors}
              onProviderChange={value => {
                setModelBaseUrl(value.baseUrl);
                setModelName(value.model);
                setModelApiKey(value.apiKey);
                setModelFieldErrors({});
                setError(undefined);
                setNotice(undefined);
              }}
              providerId={modelProviderId}
              runtimeModelIds={runtimeModelIds}
              onProviderIdChange={id => {
                const preset = creatorProviderCatalogById.llm[id];
                if (preset === undefined) return;
                setModelProviderId(id);
                setModelBaseUrl(preset.defaultBaseUrl ?? '');
                setModelName(preset.models[0]?.id ?? '');
                setModelApiKey('');
                setModelFieldErrors({});
                setError(undefined);
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
                  && textModelMode === 'codex'
                  && modelProvider === undefined
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
  mode: TextModelMode;
  onModeChange(value: TextModelMode): void;
  baseUrl: string;
  model: string;
  apiKey: string;
  error?: string;
  fieldErrors: ModelFieldErrors;
  onProviderChange(value: OpenAiCompatibleConfig): void;
  providerId: string;
  runtimeModelIds: readonly string[];
  onProviderIdChange(value: string): void;
}) {
  const l = useLocalizedCopy();
  const legacyApiKeyConfigured = props.config.llm.source === 'custom'
    && props.configuredCredentials.has('llm.apiKey');
  const providerApiKeyConfigured = props.provider?.apiKeyConfigured === true;
  const codexAvailable = props.provider !== undefined
    && (props.provider.authentication === 'chatgpt' || providerApiKeyConfigured);
  const textTasksAvailable = props.mode === 'codex'
    ? codexAvailable
    : legacyApiKeyConfigured || props.apiKey.trim().length > 0;
  const selectedModeAvailable = props.mode === 'codex' ? codexAvailable : textTasksAvailable;
  const TextTaskStatusIcon = textTasksAvailable ? Check : CircleAlert;
  const modelCredentials = legacyApiKeyConfigured
    ? new Set<CreatorServicesCredentialField>(['llm.apiKey'])
    : new Set<CreatorServicesCredentialField>();
  return (
    <>
      <SettingsFieldset
        title={l('模型服务', 'Model provider')}
        description={l(
          '选择使用本机 Codex，或继续配置独立的 OpenAI 兼容模型服务。',
          'Use the local Codex runtime or configure a separate OpenAI-compatible model service.'
        )}
      >
        <div className="creator-services-segmented is-wide" role="group" aria-label={l('文本任务运行方式', 'Text task execution mode')}>
          <button
            type="button"
            aria-pressed={props.mode === 'codex'}
            onClick={() => props.onModeChange('codex')}
          >
            {l('Codex 本机运行时', 'Local Codex runtime')}
          </button>
          <button
            type="button"
            aria-pressed={props.mode === 'custom'}
            onClick={() => props.onModeChange('custom')}
          >
            {l('自定义模型服务', 'Custom model service')}
          </button>
        </div>
        {props.mode === 'custom' ? <label className="creator-services-field is-wide">
          <span>{l('供应商', 'Provider')}</span>
          <select value={props.providerId} onChange={event => props.onProviderIdChange(event.target.value)}>
            {Object.values(creatorProviderCatalogById.llm).map(provider => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
        </label> : null}
        {props.mode === 'custom' ? <OpenAiFields
          id="llm"
          credential="llm.apiKey"
          configuredCredentials={modelCredentials}
          value={{
            baseUrl: props.baseUrl,
            apiKey: props.apiKey,
            model: props.model
          }}
          modelPlaceholder="gpt-5.6-sol"
          modelSuggestions={props.providerId === 'openai' && props.runtimeModelIds.length > 0
            ? props.runtimeModelIds
            : creatorProviderCatalogById.llm[props.providerId]?.models.map(model => model.id)}
          errors={props.fieldErrors}
          onChange={props.onProviderChange}
        /> : (
          <p className="creator-services-runtime-note">
            {props.provider === undefined
              ? l('未检测到可用的本机 Codex Runtime', 'No local Codex runtime was detected')
              : props.provider.authentication === 'chatgpt'
              ? l('已连接本机 Codex · ChatGPT 登录', 'Local Codex connected · ChatGPT sign-in')
              : l(`已连接本机 Codex · ${props.provider.model || 'Runtime'}`, `Local Codex connected · ${props.provider.model || 'Runtime'}`)}
          </p>
        )}
        <div className="creator-services-model-status is-wide" role="status">
          <span className={selectedModeAvailable ? '' : 'is-warning'}>
            <TextTaskStatusIcon size={15} aria-hidden="true" />
            {textTasksAvailable
              ? l('文本任务可用', 'Text tasks ready')
              : props.mode === 'codex'
                ? l('本机 Codex 尚未配置', 'Local Codex is not configured')
                : l('文本任务需要 API Key', 'Text tasks require an API key')}
          </span>
        </div>
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
          error={props.fieldErrors.proxy}
          onChange={value => props.update(config => {
            config.proxy = value;
          })}
          wide
        />
      </SettingsFieldset>
    </>
  );
}

function inferLlmProviderId(baseUrl: string, model: string): string {
  const normalizedUrl = baseUrl.toLowerCase();
  const normalizedModel = model.toLowerCase();
  if (normalizedUrl.includes('deepseek') || normalizedModel.startsWith('deepseek-')) return 'deepseek';
  if (normalizedUrl.includes('minimax') || normalizedModel.startsWith('minimax-')) return 'minimax';
  if (normalizedUrl.includes('openai.com')) return 'openai';
  return 'custom';
}

function validateModelFields(
  baseUrl: string,
  model: string,
  apiKey: string,
  proxy: string,
  l: (zh: string, en: string) => string
): ModelFieldErrors {
  const errors: ModelFieldErrors = {};
  if (model.trim().length === 0) {
    errors.model = l('模型不能为空', 'Model is required');
  }
  if (baseUrl.trim().length > 0 && !isHttpUrl(baseUrl)) {
    errors.baseUrl = l(
      '请输入有效的 HTTP 或 HTTPS 地址',
      'Enter a valid HTTP or HTTPS URL'
    );
  }
  if (apiKey.length > 0 && apiKey.trim().length === 0) {
    errors.apiKey = l('API Key 不能只包含空格', 'API Key cannot contain only spaces');
  }
  if (proxy.trim().length > 0 && !isHttpUrl(proxy)) {
    errors.proxy = l(
      '请输入有效的 HTTP 或 HTTPS 代理地址',
      'Enter a valid HTTP or HTTPS proxy URL'
    );
  }
  return errors;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function readableSaveError(
  cause: unknown,
  l: (zh: string, en: string) => string
): string {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return l('本地 Runtime 未返回具体原因', 'The local Runtime did not return a reason');
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
            config.transcription.whisperCpp.model = value as 'tiny' | 'medium' | 'large-v2' | 'large-v3-turbo';
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
      {provider === 'volcengine' ? (
        <>
          <VolcengineAsrFields
            configuredCredentials={props.configuredCredentials}
            value={props.config.transcription.volcengine}
            onChange={value => props.update(config => {
              config.transcription.volcengine = value;
            })}
          />
          <p className="creator-services-inline-note">
            {l(
              '使用豆包语音控制台的 App ID 和 Access Token。录音文件识别、TTS V1 与 TTS V3 共用同一套 Access Token，仅请求头字段名不同。',
              'Use the App ID and Access Token from the Doubao Voice console. File recognition, TTS V1, and TTS V3 share that Access Token; only the HTTP field names differ.'
            )}
          </p>
        </>
      ) : null}
      {selectedCapability?.kind === 'local' && selectedCapability.available ? (
        <p className="creator-services-inline-note">
          {l(
            '保存后，KrillinAI 下次启动时会检查所选本地模型，缺失时才开始下载。未选择本地 Whisper 时不会下载。',
            'After saving, KrillinAI checks the selected local model the next time it starts and downloads it only if missing. No model is downloaded unless local Whisper is selected.'
          )}
        </p>
      ) : null}
      {selectedCapability?.kind === 'local' && selectedCapability.available
        ? <TranscriptionModelDetails capability={selectedCapability} model={selectedTranscriptionModel(props.config)} />
        : null}
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
          ['volcengine', l('火山引擎', 'Volcengine')],
          ['edge-tts', 'Edge TTS']
        ]}
        onChange={value => props.update(config => {
          config.tts.provider = value as CreatorServicesConfig['tts']['provider'];
          const preset = creatorProviderOfKind('tts', value);
          if (preset?.defaultBaseUrl !== undefined && value !== 'edge-tts') {
            const target = config.tts[value as 'openai' | 'minimax' | 'aliyun'];
            target.baseUrl = target.baseUrl || preset.defaultBaseUrl;
            if (!target.model && preset.models[0] !== undefined) target.model = preset.models[0].id;
          }
        })}
      />
      {provider === 'openai' ? (
        <OpenAiFields
          id="tts-openai"
          credential="tts.openai.apiKey"
          configuredCredentials={props.configuredCredentials}
          value={props.config.tts.openai}
          modelPlaceholder="gpt-4o-mini-tts"
          modelSuggestions={creatorProviderOfKind('tts', 'openai-tts')?.models.map(model => model.id)}
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
          modelSuggestions={creatorProviderOfKind('tts', 'minimax-tts')?.models.map(model => model.id)}
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
          modelSuggestions={creatorProviderOfKind('tts', 'aliyun-tts')?.models.map(model => model.id)}
          baseUrlPlaceholder="https://dashscope.aliyuncs.com/api/v1"
          onChange={value => props.update(config => {
            config.tts.aliyun = { ...config.tts.aliyun, ...value };
          })}
        />
      ) : null}
      {provider === 'volcengine' ? (
        <>
          <VolcengineTtsFields
            configuredCredentials={props.configuredCredentials}
            value={props.config.tts.volcengine}
            onChange={value => props.update(config => {
              const previousModel = config.tts.volcengine.model;
              config.tts.volcengine = { ...config.tts.volcengine, ...value };
              if (value.model !== previousModel) {
                config.tts.volcengine.defaultVoiceId = defaultVoiceForVolcengineCluster(value.model);
              }
            })}
          />
          <p className="creator-services-inline-note">
            {l(
              '使用与语音识别相同的豆包语音控制台 App ID 和 Access Token。小模型走 V1 HTTP（Bearer Token）；豆包 2.0 / 声音复刻走 V3（X-Api-Access-Key）。可在音色列表选择官方音色，或填写克隆 Speaker ID（S_ 开头）。',
              'Use the same Doubao Voice console App ID and Access Token as transcription. Small-model voices use V1 HTTP (Bearer token). Doubao 2.0 and voice cloning use V3 (X-Api-Access-Key). Pick an official voice or enter a cloned speaker ID starting with S_.'
            )}
          </p>
        </>
      ) : null}
      {provider !== 'edge-tts' ? (
        <div className="creator-services-tts-voice">
          <TtsVoicePicker
            id={`tts-${provider}-default-voice`}
            provider={provider}
            model={props.config.tts[provider].model}
            value={props.config.tts[provider].defaultVoiceId}
            service={props.service ?? null}
            allowCustomVoice={provider === 'volcengine'}
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
      description={l('选择本机 Codex 生图，或配置其他图像生成服务。', 'Use local Codex image generation or configure another image provider.')}
    >
      <SelectField
        id="image-provider"
        label={l('服务商', 'Provider')}
        value={provider}
        options={[
          ['codex-native', l('本机 Codex 生图', 'Local Codex image generation')],
          ['openai', 'GPT Image'],
          ['jimeng', l('即梦', 'Jimeng')],
          ['kling', l('可灵', 'Kling')],
          ['gemini', 'Gemini']
        ]}
        onChange={value => props.update(config => {
          const nextProvider = value as CreatorServicesConfig['image']['provider'];
          config.image.provider = nextProvider;
          if (nextProvider === 'codex-native') return;
          const preset = creatorProviderOfKind('image', nextProvider);
          const target = config.image[nextProvider];
          if (preset?.defaultBaseUrl !== undefined && !target.baseUrl) target.baseUrl = preset.defaultBaseUrl;
          if (!target.model && preset?.models[0] !== undefined) target.model = preset.models[0].id;
        })}
      />
      {provider === 'openai' ? <OpenAiFields id="image-openai" credential="image.openai.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.image.openai} modelPlaceholder="gpt-image-1" modelSuggestions={creatorProviderOfKind('image', 'openai')?.models.map(model => model.id)} onChange={value => props.update(config => { config.image.openai = value; })} /> : null}
      {provider === 'jimeng' ? <OpenAiFields id="image-jimeng" credential="image.jimeng.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.image.jimeng} modelPlaceholder="doubao-seedream-4-0-250828" modelSuggestions={creatorProviderOfKind('image', 'jimeng')?.models.map(model => model.id)} baseUrlPlaceholder="https://ark.cn-beijing.volces.com/api/v3" onChange={value => props.update(config => { config.image.jimeng = value; })} /> : null}
      {provider === 'kling' ? <KlingFields id="image-kling" accessKeyCredential="image.kling.accessKey" secretKeyCredential="image.kling.secretKey" configuredCredentials={props.configuredCredentials} value={props.config.image.kling} modelPlaceholder="kling-v2-1" modelSuggestions={creatorProviderOfKind('image', 'kling')?.models.map(model => model.id)} onChange={value => props.update(config => { config.image.kling = value; })} /> : null}
      {provider === 'gemini' ? <OpenAiFields id="image-gemini" credential="image.gemini.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.image.gemini} modelPlaceholder="gemini-2.5-flash-image" modelSuggestions={creatorProviderOfKind('image', 'gemini')?.models.map(model => model.id)} baseUrlPlaceholder="https://generativelanguage.googleapis.com/v1beta" onChange={value => props.update(config => { config.image.gemini = value; })} /> : null}
    </SettingsFieldset>
  );
}

function VideoSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  const provider = props.config.video.provider;
  return (
    <SettingsFieldset
      title={l('视频生成', 'Video generation')}
      description={l(
        '配置 Seedance、可灵或 Veo 视频生成服务，以及新任务使用的默认模型。',
        'Configure Seedance, Kling, or Veo video generation and the default model for new tasks.'
      )}
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
          const nextProvider = value as CreatorServicesConfig['video']['provider'];
          config.video.provider = nextProvider;
          const catalogId = nextProvider === 'kling' ? 'kling-video' : nextProvider;
          const preset = creatorProviderOfKind('video', catalogId);
          const target = config.video[nextProvider];
          if (preset?.defaultBaseUrl !== undefined && !target.baseUrl) target.baseUrl = preset.defaultBaseUrl;
          if (!target.model && preset?.models[0] !== undefined) target.model = preset.models[0].id;
        })}
      />
      {provider === 'seedance' ? <OpenAiFields id="video-seedance" credential="video.seedance.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.video.seedance} modelLabel={l('默认模型', 'Default model')} modelPlaceholder={defaultVideoGenerationModels.seedance} modelSuggestions={videoGenerationModelIds.seedance} baseUrlPlaceholder="https://ark.cn-beijing.volces.com/api/v3" onChange={value => props.update(config => { config.video.seedance = value; })} /> : null}
      {provider === 'kling' ? <KlingFields id="video-kling" accessKeyCredential="video.kling.accessKey" secretKeyCredential="video.kling.secretKey" configuredCredentials={props.configuredCredentials} value={props.config.video.kling} modelLabel={l('默认模型', 'Default model')} modelPlaceholder={defaultVideoGenerationModels.kling} modelSuggestions={creatorProviderOfKind('video', 'kling-video')?.models.map(model => model.id)} onChange={value => props.update(config => { config.video.kling = value; })} /> : null}
      {provider === 'veo' ? <OpenAiFields id="video-veo" credential="video.veo.apiKey" configuredCredentials={props.configuredCredentials} value={props.config.video.veo} modelLabel={l('默认模型', 'Default model')} modelPlaceholder={defaultVideoGenerationModels.veo} modelSuggestions={videoGenerationModelIds.veo} baseUrlPlaceholder="https://generativelanguage.googleapis.com/v1beta" onChange={value => props.update(config => { config.video.veo = value; })} /> : null}
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
  modelLabel?: string;
  modelSuggestions?: readonly string[];
  modelReadonly?: boolean;
  baseUrlPlaceholder?: string;
  errors?: ModelFieldErrors;
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
        error={props.errors?.baseUrl}
        onChange={baseUrl => props.onChange({ ...props.value, baseUrl })}
        wide
      />
      <PasswordField
        id={`${props.id}-api-key`}
        label="API Key"
        value={props.value.apiKey}
        configured={props.configuredCredentials.has(props.credential)}
        error={props.errors?.apiKey}
        onChange={apiKey => props.onChange({ ...props.value, apiKey })}
      />
      {props.modelReadonly ? (
        <ReadonlyModelField label={props.modelLabel ?? l('模型', 'Model')} value={props.modelPlaceholder} />
      ) : (
        <ModelField
          id={`${props.id}-model`}
          label={props.modelLabel ?? l('模型', 'Model')}
          value={props.value.model}
          placeholder={props.modelPlaceholder}
          suggestions={props.modelSuggestions}
          error={props.errors?.model}
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
  modelLabel?: string;
  modelSuggestions?: readonly string[];
  onChange(value: KlingAiConfig): void;
}) {
  return (
    <>
      <TextField id={`${props.id}-base-url`} label="Base URL" value={props.value.baseUrl} placeholder="https://api-beijing.klingai.com" onChange={baseUrl => props.onChange({ ...props.value, baseUrl })} wide />
      <PasswordField id={`${props.id}-access-key`} label="Access Key" value={props.value.accessKey} configured={props.configuredCredentials.has(props.accessKeyCredential)} onChange={accessKey => props.onChange({ ...props.value, accessKey })} />
      <PasswordField id={`${props.id}-secret-key`} label="Secret Key" value={props.value.secretKey} configured={props.configuredCredentials.has(props.secretKeyCredential)} onChange={secretKey => props.onChange({ ...props.value, secretKey })} />
      <ModelField id={`${props.id}-model`} label={props.modelLabel ?? 'Model'} value={props.value.model} placeholder={props.modelPlaceholder} suggestions={props.modelSuggestions} onChange={model => props.onChange({ ...props.value, model })} />
    </>
  );
}

function VolcengineAsrFields(props: {
  configuredCredentials: ReadonlySet<CreatorServicesCredentialField>;
  value: VolcengineAsrConfig;
  onChange(value: VolcengineAsrConfig): void;
}) {
  const l = useLocalizedCopy();
  return (
    <>
      <PasswordField
        id="transcription-volcengine-app-id"
        label="App ID"
        value={props.value.appId}
        configured={props.configuredCredentials.has('transcription.volcengine.appId')}
        onChange={appId => props.onChange({ ...props.value, appId })}
      />
      <PasswordField
        id="transcription-volcengine-access-token"
        label="Access Token"
        value={props.value.accessToken}
        configured={props.configuredCredentials.has('transcription.volcengine.accessToken')}
        onChange={accessToken => props.onChange({ ...props.value, accessToken })}
      />
      <TextField
        id="transcription-volcengine-resource-id"
        label={l('资源 ID', 'Resource ID')}
        value={props.value.resourceId}
        placeholder="volc.seedasr.auc"
        onChange={resourceId => props.onChange({ ...props.value, resourceId })}
      />
      <TextField
        id="transcription-volcengine-base-url"
        label="Base URL"
        value={props.value.baseUrl}
        placeholder="https://openspeech.bytedance.com"
        onChange={baseUrl => props.onChange({ ...props.value, baseUrl })}
        wide
      />
    </>
  );
}

function VolcengineTtsFields(props: {
  configuredCredentials: ReadonlySet<CreatorServicesCredentialField>;
  value: VolcengineTtsConfig;
  onChange(value: VolcengineTtsConfig): void;
}) {
  const l = useLocalizedCopy();
  return (
    <>
      <TextField
        id="tts-volcengine-base-url"
        label="Base URL"
        value={props.value.baseUrl}
        placeholder="https://openspeech.bytedance.com"
        onChange={baseUrl => props.onChange({ ...props.value, baseUrl })}
        wide
      />
      <PasswordField
        id="tts-volcengine-app-id"
        label="App ID"
        value={props.value.appId}
        configured={props.configuredCredentials.has('tts.volcengine.appId')}
        onChange={appId => props.onChange({ ...props.value, appId })}
      />
      <PasswordField
        id="tts-volcengine-access-token"
        label="Access Token"
        value={props.value.accessToken}
        configured={props.configuredCredentials.has('tts.volcengine.accessToken')}
        onChange={accessToken => props.onChange({ ...props.value, accessToken })}
      />
      <SelectField
        id="tts-volcengine-cluster"
        label={l('接口 / 集群', 'API / cluster')}
        value={props.value.model}
        options={volcengineClusterOptions(l, props.value.model)}
        onChange={model => props.onChange({ ...props.value, model })}
      />
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
      <TextField
        id={`${props.id}-oss-region`}
        label={l('OSS 地域', 'OSS region')}
        value={props.oss.region}
        placeholder="cn-shanghai"
        onChange={region => props.onOssChange({ ...props.oss, region })}
      />
      <TextField
        id={`${props.id}-oss-endpoint`}
        label={l('OSS Endpoint（可选）', 'OSS endpoint (optional)')}
        value={props.oss.endpoint}
        placeholder={`https://oss-${props.oss.region || 'cn-shanghai'}.aliyuncs.com`}
        onChange={endpoint => props.onOssChange({ ...props.oss, endpoint })}
      />
      <p className="creator-services-inline-note">{l(
        '地域需与 Bucket 一致；Endpoint 留空时使用该地域的公网地址。填写时请使用不含 Bucket 的公网服务地址，供语音服务读取音频。',
        'Use the bucket region. Leave endpoint blank for its public endpoint, or enter a public service endpoint without the bucket name so the speech service can read the audio.'
      )}</p>
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
  suggestions?: readonly string[];
  wide?: boolean;
  error?: string;
  onChange(value: string): void;
}) {
  return (
    <label className={props.wide ? 'creator-services-field is-wide' : 'creator-services-field'} htmlFor={props.id}>
      <span>{props.label}</span>
      <input
        id={props.id}
        aria-label={props.label}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        list={props.suggestions?.length ? `${props.id}-suggestions` : undefined}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={props.error === undefined ? undefined : true}
        aria-describedby={props.error === undefined ? undefined : `${props.id}-error`}
        onChange={event => props.onChange(event.target.value)}
      />
      {props.error === undefined ? null : (
        <span id={`${props.id}-error`} className="creator-services-field-error">{props.error}</span>
      )}
      {props.suggestions?.length ? (
        <datalist id={`${props.id}-suggestions`}>
          {props.suggestions.map(value => <option key={value} value={value} />)}
        </datalist>
      ) : null}
    </label>
  );
}

function ModelField(props: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  suggestions?: readonly string[];
  error?: string;
  onChange(value: string): void;
}) {
  const valueIsCustom = props.suggestions?.includes(props.value) !== true;
  const [customSelected, setCustomSelected] = useState(valueIsCustom);
  const showCustomInput = customSelected || valueIsCustom;
  const suggestionKey = props.suggestions?.join('\u0000') ?? '';
  useEffect(() => {
    if (props.suggestions?.includes(props.value) === true) setCustomSelected(false);
  }, [props.value, suggestionKey]);
  return (
    <label className="creator-services-field" htmlFor={props.id}>
      <span>{props.label}</span>
      {props.suggestions?.length ? (
        <select
          aria-label={props.label}
          value={showCustomInput ? '__custom__' : props.value}
          aria-invalid={props.error === undefined ? undefined : true}
          aria-describedby={props.error === undefined ? undefined : `${props.id}-error`}
          onChange={event => {
            if (event.target.value === '__custom__') {
              setCustomSelected(true);
              return;
            }
            setCustomSelected(false);
            props.onChange(event.target.value);
          }}
        >
          {props.suggestions.map(value => <option key={value} value={value}>{value}</option>)}
          <option value="__custom__">自定义模型 / Custom model</option>
        </select>
      ) : null}
      {(!props.suggestions?.length || showCustomInput) ? (
        <input
          id={props.id}
          aria-label={props.label}
          type="text"
          value={props.value}
          placeholder={props.placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={props.error === undefined ? undefined : true}
          aria-describedby={props.error === undefined ? undefined : `${props.id}-error`}
          onChange={event => props.onChange(event.target.value)}
        />
      ) : null}
      {props.error === undefined ? null : (
        <span id={`${props.id}-error`} className="creator-services-field-error">{props.error}</span>
      )}
    </label>
  );
}

function PasswordField(props: {
  id: string;
  label: string;
  value: string;
  configured?: boolean;
  error?: string;
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
          aria-label={props.label}
          type={visible ? 'text' : 'password'}
          value={props.value}
          placeholder={props.configured
            ? l('已配置，留空则保持', 'Configured; leave blank to keep')
            : l('输入密钥', 'Enter key')}
          spellCheck={false}
          autoComplete="new-password"
          aria-invalid={props.error === undefined ? undefined : true}
          aria-describedby={props.error === undefined ? undefined : `${props.id}-error`}
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
      {props.error === undefined ? null : (
        <span id={`${props.id}-error`} className="creator-services-field-error">{props.error}</span>
      )}
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

function TranscriptionModelDetails(props: {
  capability: CreatorTranscriptionProviderCapability;
  model: string;
}) {
  const l = useLocalizedCopy();
  const diskBytes = props.capability.modelDetails?.[props.model]?.diskBytes;
  if (diskBytes === undefined) return null;
  return (
    <p className="creator-services-inline-note">
      {l(`本地执行 · 预计占用磁盘 ${formatDiskSize(diskBytes)}`, `Local execution · estimated disk usage ${formatDiskSize(diskBytes)}`)}
    </p>
  );
}

function formatDiskSize(bytes: number): string {
  const gibibytes = bytes / (1024 ** 3);
  return gibibytes >= 1 ? `${gibibytes.toFixed(2)} GiB` : `${(bytes / (1024 ** 2)).toFixed(0)} MiB`;
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

function volcengineClusterOptions(
  l: LocalizedCopy,
  current: string
): Array<[string, string]> {
  const options: Array<[string, string]> = [
    ['volcano_tts', l('小模型 TTS（volcano_tts）', 'Small-model TTS (volcano_tts)')],
    ['seed-tts-2.0', l('豆包语音 2.0（推荐音质）', 'Doubao TTS 2.0 (recommended quality)')],
    ['seed-tts-1.0', l('豆包语音 1.0', 'Doubao TTS 1.0')],
    ['seed-icl-2.0', l('声音复刻 2.0', 'Voice clone 2.0')],
    ['seed-icl-1.0', l('声音复刻 1.0', 'Voice clone 1.0')],
    ['volcano_icl', l('声音复刻 ICL（V1）', 'Voice clone ICL (V1)')],
    ['volcano_icl_concurr', l('声音复刻 ICL 并发（V1）', 'Voice clone ICL concurrent (V1)')],
    ['seed-tts-1.0-concurr', l('豆包语音 1.0 并发', 'Doubao TTS 1.0 concurrent')],
    ['seed-icl-1.0-concurr', l('声音复刻 1.0 并发', 'Voice clone 1.0 concurrent')],
    ['volcano_mega', l('声音复刻 MEGA（旧）', 'Voice clone MEGA (legacy)')],
    ['volcano_mega_concurr', l('声音复刻 MEGA 并发（旧）', 'Voice clone MEGA concurrent (legacy)')]
  ];
  if (current && !options.some(([id]) => id === current)) {
    options.push([current, current]);
  }
  return options;
}

function defaultVoiceForVolcengineCluster(model: string): string {
  const normalized = model.trim() || 'volcano_tts';
  if (normalized.startsWith('seed-tts-2')) return 'zh_female_cancan_uranus_bigtts';
  if (normalized.startsWith('seed-tts-1')) return 'zh_female_tianmeitaozi_mars_bigtts';
  if (
    normalized.startsWith('seed-icl')
    || normalized.startsWith('volcano_icl')
    || normalized.startsWith('volcano_mega')
  ) {
    return '';
  }
  return 'BV001_streaming';
}

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
    case 'volcengine':
      return config.transcription.volcengine.resourceId;
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
    case 'volcengine':
      return l('火山引擎', 'Volcengine');
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
