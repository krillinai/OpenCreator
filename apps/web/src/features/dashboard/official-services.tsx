import { createContext, useContext, useEffect } from 'react';
import type { CreatorJson, GatewayAccountState, GatewayModel } from '@opencreator/protocol';
import OfficialModelSelect, { officialModelLabel } from '../../components/forms/OfficialModelSelect.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useOptionalCreatorSession } from './creator-session-store.js';
import './official-services.css';

export const OfficialServicesContext = createContext<GatewayAccountState | null | undefined>(undefined);

export function useOfficialServices(modality: GatewayModel['modality']) {
  const state = useContext(OfficialServicesContext);
  const session = useOptionalCreatorSession();
  const official = state === null || (state !== undefined && (state.source === 'gateway' || state.authState !== 'signed_out'));
  const models = state?.models.filter(model => model.modality === modality && (modality !== 'text' || model.capabilities.includes('responses'))) ?? [];
  const choices = session?.state.officialModels;
  const saved = choices && typeof choices === 'object' && !Array.isArray(choices) ? choices[modality] : undefined;
  const taskRunning = session?.job.status === 'running' || session?.job.stages.some(stage => stage.status === 'queued' || stage.status === 'running');
  const taskChoices: Record<string, CreatorJson> = {};
  for (const candidate of state?.models ?? []) {
    if (candidate.modality === 'text' && !candidate.capabilities.includes('responses')) continue;
    const taskChoice = choices && typeof choices === 'object' && !Array.isArray(choices) ? choices[candidate.modality] : undefined;
    if (!(candidate.modality in taskChoices) || candidate.id === state?.selectedModels?.[candidate.modality] || candidate.id === taskChoice) taskChoices[candidate.modality] = candidate.id;
  }
  if (choices && typeof choices === 'object' && !Array.isArray(choices)) Object.assign(taskChoices, choices);
  const selected = saved ?? state?.selectedModels?.[modality];
  const model = models.find(candidate => candidate.id === selected) ?? models[0];
  const ready = state?.authState === 'signed_in' && state.activationState === 'ready' && model !== undefined;
  useEffect(() => {
    if (ready && official && !taskRunning && model && saved !== model.id) selectModel(model.id);
  }, [official, ready, saved, model?.id, session?.job.id, taskRunning]);
  function selectModel(id: string) {
    if (!ready || taskRunning || !models.some(candidate => candidate.id === id)) return;
    session?.updateDraft({ officialModels: { ...taskChoices, [modality]: id } });
  }
  const draftPatch: Record<string, CreatorJson> = model ? { officialModels: { ...taskChoices, [modality]: model.id } } : {};
  return { official, ready, models, model, selectModel, draftPatch, taskRunning };
}

export function OfficialModelField(props: { label: string; service: ReturnType<typeof useOfficialServices>; disabled?: boolean }) {
  const l = useLocalizedCopy();
  const { models, model, ready } = props.service;
  const label = model ? officialModelLabel(model, l('自动选择', 'Automatic')) : l('暂不可用', 'Unavailable');
  return <label className="creator-tool-field">
    <span>{props.label}</span>
    {models.length === 1 && ready ? <output className="official-model-value" aria-label={props.label}>{label}</output> :
      <OfficialModelSelect label={props.label} models={models} value={model?.id ?? ''} disabled={!ready || props.disabled || props.service.taskRunning} onChange={props.service.selectModel} />}
  </label>;
}
