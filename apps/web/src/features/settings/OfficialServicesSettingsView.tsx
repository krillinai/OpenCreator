import { useState } from 'react';
import { AudioLines, Image, LoaderCircle, Mic, TextCursorInput, Video, type LucideIcon } from 'lucide-react';
import type { GatewayAccountState, GatewayModel } from '@opencreator/protocol';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import OfficialModelSelect from '../../components/forms/OfficialModelSelect.js';
import './official-services-settings.css';

export function OfficialServicesSettingsView(props: { state: GatewayAccountState; service: GatewayAccountSettingsService; onChange(state: GatewayAccountState): void }) {
  const l = useLocalizedCopy();
  const [pendingModality, setPendingModality] = useState<GatewayModel['modality'] | null>(null);
  const [error, setError] = useState('');
  const modalities: Array<{ id: GatewayModel['modality']; label: string; icon: LucideIcon }> = [
    { id: 'text', label: l('文本模型', 'Text model'), icon: TextCursorInput },
    { id: 'image', label: l('图片模型', 'Image model'), icon: Image },
    { id: 'video', label: l('视频模型', 'Video model'), icon: Video },
    { id: 'speech', label: l('语音合成模型', 'Speech model'), icon: AudioLines },
    { id: 'transcription', label: l('语音识别模型', 'Transcription model'), icon: Mic }
  ];
  return <div className="official-services-models">
    {modalities.map(modality => {
      const models = props.state.models.filter(model => model.modality === modality.id && (modality.id !== 'text' || model.capabilities.includes('responses')));
      const Icon = modality.icon;
      const saving = pendingModality === modality.id;
      return <label className="official-services-model-row" key={modality.id} aria-busy={saving}>
        <span className="official-services-model-label">
          <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
          <span>
            <span className="official-services-model-name">{modality.label}</span>
            <span className="official-services-model-count" id={`official-${modality.id}-count`}>
              {models.length === 0 ? l('暂不可用', 'Unavailable') : l(`${models.length} 个模型`, `${models.length} ${models.length === 1 ? 'model' : 'models'}`)}
            </span>
          </span>
        </span>
        <span className="official-services-model-select">
          <OfficialModelSelect label={modality.label} describedBy={`official-${modality.id}-count`} models={models} disabled={pendingModality !== null || props.state.activationState !== 'ready' || models.length === 0}
            value={props.state.selectedModels?.[modality.id] ?? models[0]?.id ?? ''}
            onChange={id => {
              setPendingModality(modality.id); setError('');
              void props.service.selectModel(modality.id, id).then(props.onChange)
                .catch(() => setError(l('模型切换失败，请等待当前任务结束后重试', 'Could not switch models. Wait for the current task to finish and try again.')))
                .finally(() => setPendingModality(null));
            }} />
          {saving ? <LoaderCircle className="official-services-spinner" size={16} aria-hidden="true" /> : null}
        </span>
      </label>;
    })}
    {error ? <p className="official-services-error" role="alert">{error}</p> : null}
  </div>;
}
