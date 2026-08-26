import {
  createDefaultCreatorServicesConfig,
  type AliyunOssConfig,
  type AliyunSpeechConfig,
  type CreatorServicesConfig,
  type CreatorServicesCredentialField,
  type KlingAiConfig,
  type OpenAiCompatibleConfig
} from '@opencreator/protocol';
import {
  AudioLines,
  Check,
  ChevronDown,
  Clapperboard,
  Eye,
  EyeOff,
  Image,
  Languages,
  LoaderCircle,
  Mic2,
  RotateCcw,
  Save,
  ShieldCheck
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import './creator-services-settings.css';

type ServiceSection = 'text' | 'transcription' | 'tts' | 'image' | 'video';

export function CreatorServicesSettingsView(props: {
  connected: boolean;
  service: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const confirm = useConfirmDialog();
  const [activeSection, setActiveSection] = useState<ServiceSection>('text');
  const [config, setConfig] = useState<CreatorServicesConfig>();
  const [configuredCredentials, setConfiguredCredentials] = useState<ReadonlySet<CreatorServicesCredentialField>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!props.connected || props.service === null) {
      setLoading(false);
      setConfig(undefined);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    setError(undefined);
    void props.service.getConfig()
      .then(response => {
        if (active) {
          setConfig(response.config);
          setConfiguredCredentials(new Set(response.configuredCredentials));
        }
      })
      .catch(() => {
        if (active) setError(l('无法读取 AI 服务配置', 'Could not load AI service settings'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.connected, props.service]);

  const sections: Array<{
    id: ServiceSection;
    label: string;
    icon: typeof Languages;
  }> = [
    { id: 'text', label: l('文本模型', 'Text'), icon: Languages },
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
    if (config === undefined || props.service === null) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await props.service.saveConfig(config);
      setConfig(response.config);
      setConfiguredCredentials(new Set(response.configuredCredentials));
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
        '这会清除语音、图像和视频服务的 Key 与设置；文本模型继续使用 Codex Agent 配置。',
        'This clears voice, image, and video keys and settings. The text model continues to use the Codex Agent configuration.'
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
          <ShieldCheck size={16} aria-hidden="true" />
          {l('系统凭据存储', 'System credential storage')}
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
      ) : config === undefined ? (
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
            <TextModelSettings config={config} update={updateConfig} configuredCredentials={configuredCredentials} />
          ) : null}
          {activeSection === 'transcription' ? (
            <TranscriptionSettings config={config} update={updateConfig} configuredCredentials={configuredCredentials} />
          ) : null}
          {activeSection === 'tts' ? (
            <TtsSettings config={config} update={updateConfig} configuredCredentials={configuredCredentials} />
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
            <button className="settings-primary-button" type="submit" disabled={saving}>
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

function TextModelSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  return (
    <>
      <SettingsFieldset
        title={l('文本模型', 'Text model')}
        description={l(
          '用于翻译、脚本处理和其他文本任务，默认使用 Codex Agent 的模型服务配置。',
          'Used for translation, script processing, and other text tasks through the Codex Agent model provider.'
        )}
      >
        <ReadonlyModelField
          label="Base URL"
          value={props.config.llm.baseUrl || 'https://api.openai.com/v1'}
          wide
        />
        <ReadonlyModelField
          label="API Key"
          value={props.configuredCredentials.has('llm.apiKey')
            ? l('已配置', 'Configured')
            : l('未配置', 'Not configured')}
        />
        <ReadonlyModelField
          label={l('模型', 'Model')}
          value={props.config.llm.model}
        />
        <p className="creator-services-inline-note">
          {l(
            'Base URL、Model 和 API Key 请在“Codex Agent”中修改，保存后会自动同步到这里。',
            'Change Base URL, Model, and API Key under Codex Agent. Saved values are synchronized here automatically.'
          )}
        </p>
        <ToggleField
          label={l('JSON 输出模式', 'JSON response mode')}
          description={l('仅在当前模型明确支持 JSON 格式时开启。', 'Enable only when the selected model explicitly supports JSON responses.')}
          checked={props.config.llm.jsonMode}
          onChange={checked => props.update(config => {
            config.llm.jsonMode = checked;
          })}
        />
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

function TranscriptionSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  const provider = props.config.transcription.provider;
  return (
    <SettingsFieldset
      title={l('语音识别', 'Speech transcription')}
      description={l('选择优先使用的转录服务。云端凭证未配置时，Runtime 会尝试使用安装包内可用的本地 Whisper。', 'Choose the preferred transcription service. When cloud credentials are absent, the Runtime tries an available local Whisper packaged with the app.')}
    >
      <SelectField
        id="transcription-provider"
        label={l('优先服务', 'Preferred provider')}
        value={provider}
        options={[
          ['openai', 'OpenAI Whisper'],
          ['faster-whisper', 'FasterWhisper'],
          ['whisperkit', 'WhisperKit (Apple Silicon)'],
          ['whisper.cpp', 'Whisper.cpp'],
          ['aliyun', l('阿里云语音', 'Alibaba Cloud Speech')]
        ]}
        onChange={value => props.update(config => {
          config.transcription.provider = value as CreatorServicesConfig['transcription']['provider'];
        })}
      />
      {provider === 'openai' ? (
        <OpenAiFields
          id="transcription-openai"
          credential="transcription.openai.apiKey"
          configuredCredentials={props.configuredCredentials}
          value={props.config.transcription.openai}
          modelPlaceholder="whisper-1"
          onChange={value => props.update(config => {
            config.transcription.openai = value;
          })}
        />
      ) : null}
      {provider === 'faster-whisper' ? (
        <>
          <SelectField
            id="faster-whisper-model"
            label={l('本地模型', 'Local model')}
            value={props.config.transcription.fasterWhisper.model}
            options={[['tiny', 'tiny'], ['medium', 'medium'], ['large-v2', 'large-v2']]}
            onChange={value => props.update(config => {
              config.transcription.fasterWhisper.model = value as 'tiny' | 'medium' | 'large-v2';
            })}
          />
          <ToggleField
            label={l('GPU 加速', 'GPU acceleration')}
            description={l('适用于支持 CUDA 的 Windows 或 Linux 设备。', 'For Windows or Linux devices with CUDA support.')}
            checked={props.config.transcription.enableGpuAcceleration}
            onChange={checked => props.update(config => {
              config.transcription.enableGpuAcceleration = checked;
            })}
          />
        </>
      ) : null}
      {provider === 'whisperkit' ? (
        <ReadonlyModelField label={l('本地模型', 'Local model')} value="large-v2" />
      ) : null}
      {provider === 'whisper.cpp' ? (
        <SelectField
          id="whisper-cpp-model"
          label={l('本地模型', 'Local model')}
          value={props.config.transcription.whisperCpp.model}
          options={[['tiny', 'tiny'], ['medium', 'medium'], ['large-v2', 'large-v2']]}
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
    </SettingsFieldset>
  );
}

function TtsSettings(props: SettingsGroupProps) {
  const l = useLocalizedCopy();
  const provider = props.config.tts.provider;
  return (
    <SettingsFieldset
      title={l('配音服务', 'Dubbing and speech synthesis')}
      description={l('用于生成目标语言配音。Edge TTS 无需 API Key。', 'Generates target-language dubbing. Edge TTS does not require an API key.')}
    >
      <SelectField
        id="tts-provider"
        label={l('服务商', 'Provider')}
        value={provider}
        options={[
          ['openai', 'OpenAI TTS'],
          ['minimax', 'MiniMax'],
          ['aliyun', l('阿里云语音', 'Alibaba Cloud Speech')],
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
            config.tts.openai = value;
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
            config.tts.minimax = value;
          })}
        />
      ) : null}
      {provider === 'aliyun' ? (
        <AliyunFields
          id="tts-aliyun"
          credentialPrefix="tts.aliyun"
          configuredCredentials={props.configuredCredentials}
          oss={props.config.tts.aliyun.oss}
          speech={props.config.tts.aliyun.speech}
          onOssChange={value => props.update(config => {
            config.tts.aliyun.oss = value;
          })}
          onSpeechChange={value => props.update(config => {
            config.tts.aliyun.speech = value;
          })}
        />
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
      <TextField
        id={`${props.id}-model`}
        label={l('模型', 'Model')}
        value={props.value.model}
        placeholder={props.modelPlaceholder}
        onChange={model => props.onChange({ ...props.value, model })}
      />
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
  credentialPrefix: 'transcription.aliyun' | 'tts.aliyun';
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

function ReadonlyModelField(props: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={props.wide ? 'creator-services-field is-wide' : 'creator-services-field'}>
      <span>{props.label}</span>
      <output>{props.value}</output>
    </div>
  );
}

function ToggleField(props: {
  label: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="creator-services-toggle">
      <span>
        <strong>{props.label}</strong>
        <small>{props.description}</small>
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
