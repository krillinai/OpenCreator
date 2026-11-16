import { gatewayModelIdMatches } from '@opencreator/protocol';
import { gatewayModelCompatible, gatewayModelReady, gatewayModelSupports, gatewayTranslationFlashModel, migrateOpenAiImageModel, type GatewayModel, type GatewayModelPurpose } from '@opencreator/protocol';

export const modelModalities: GatewayModelPurpose[] = ['text', 'image', 'video', 'speech', 'transcription'];
const historicalDefaults: Record<string, string[]> = {
  text: ['gpt-4o-mini', 'gpt-6-luna'], image: ['gpt-image-1', 'gpt-image-2'],
  speech: ['tts-1', 'gpt-4o-mini-tts'], transcription: ['whisper-1'],
};

export function migrateModelPreferences(selected: Record<string, string>, priorDefaults: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string | undefined> = { ...selected, text: selected.text ?? selected.textProcessing, transcription: selected.subtitle ?? selected.transcription };
  const manual: Record<string, string> = {};
  for (const modality of modelModalities) {
    const id = normalized[modality];
    // Old clients persisted defaults and explicit choices identically. Known system
    // defaults follow recommendations; other historical choices remain manual.
    if (id && !historicalDefaults[modality]?.includes(id) && id !== priorDefaults[modality]) manual[modality] = id;
  }
  return manual;
}

export function resolveModelPreferences(models: GatewayModel[], defaults: Record<string, string>, manual: Record<string, string>) {
  const compatible = models.filter(gatewayModelCompatible);
  const selected: Record<string, string> = {};
  const recommended: Record<string, string> = {};
  const modes: Partial<Record<GatewayModelPurpose, 'recommended' | 'manual'>> = {};
  const retained: Record<string, string> = {};
  let changed = false;
  for (const modality of modelModalities) {
    const candidates = compatible.filter(model => gatewayModelSupports(model, modality) && gatewayModelReady(model));
    const defaultId = modality === 'image' ? migrateOpenAiImageModel(defaults[modality] ?? '') : defaults[modality];
    const automatic = candidates.find(model => model.id === defaultId) ?? candidates.find(model => model.recommended)
      ?? (modality === 'text' ? gatewayTranslationFlashModel(candidates) ?? candidates[0] : undefined);
    if (automatic) recommended[modality] = automatic.id;
    const chosen = compatible.find(model => model.modality === modality && gatewayModelIdMatches(model.id, manual[modality]) && model.status !== 'retired');
    if (chosen) {
      retained[modality] = chosen.id; selected[modality] = chosen.id; modes[modality] = 'manual';
    } else {
      if (manual[modality]) changed = true;
      if (automatic) selected[modality] = automatic.id;
      modes[modality] = 'recommended';
    }
  }
  return { models: compatible, selected, recommended, modes, manual: retained, changed };
}
