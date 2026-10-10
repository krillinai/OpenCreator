import { useEffect } from 'react';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export function LocalTranscriptionNotice({ controller, importedSubtitle, beforeNavigate }: {
  controller?: RuntimeDependenciesController;
  importedSubtitle: boolean;
  beforeNavigate(): void;
}) {
  const localize = useLocalizedCopy();
  useEffect(() => { void controller?.refreshComponents?.(); }, [controller?.refreshComponents]);
  if (!controller || importedSubtitle) return null;
  const status = controller.componentsStatus;
  if (!status) return null;
  const component = status.components.find(candidate => candidate.id === status.selectedProvider);
  if (!component || status.selectedModel?.trim()) return null;
  const settingsQuery = new URLSearchParams({ tab: 'ai-services', section: 'transcription', component: component.id, from: 'video-translation', returnPath: window.location.hash });
  return <aside className="local-transcription-notice" data-state={component.state} role="status">
    <div className="local-transcription-notice-actions">
      <a href={`#/settings?${settingsQuery}`} onClick={beforeNavigate}>{localize('调整转录设置', 'Change transcription settings')}</a>
    </div>
  </aside>;
}
