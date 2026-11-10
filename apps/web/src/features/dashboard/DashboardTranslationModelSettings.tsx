import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import ModelBrandIcon from '../../components/brand/ModelBrandIcon.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';

const CreatorServicesSettingsView = lazy(async () => {
  const module = await import('../settings/CreatorServicesSettingsView.js');
  return { default: module.CreatorServicesSettingsView };
});

export default function DashboardTranslationModelSettings(props: {
  service?: CreatorServicesSettingsService | null;
  disabled?: boolean;
}) {
  const l = useLocalizedCopy();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(() => l('跟随服务设置', 'Service default'));
  const [modelId, setModelId] = useState('codex-native');
  const refresh = useCallback(async () => {
    if (!props.service) return;
    try {
      const { config } = await props.service.getConfig();
      setModelId(config.llm.source === 'codex' ? 'codex-native' : config.llm.model);
      setSummary(config.llm.source === 'codex'
        ? l('本机 Codex', 'Local Codex')
        : config.llm.model || l('自定义模型服务', 'Custom model service'));
    } catch {
      setSummary(l('跟随服务设置', 'Service default'));
    }
  }, [l, props.service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  function close() {
    setOpen(false);
    void refresh();
  }

  return (
    <>
      <button
        type="button"
        className="official-model-value dashboard-translation-model-trigger"
        aria-label={l('设置翻译模型', 'Configure translation model')}
        disabled={props.disabled || !props.service}
        onClick={() => setOpen(true)}
      >
        <ModelBrandIcon model={{ id: modelId }} className="dashboard-translation-model-brand" />
        <span>{summary}</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div className="dashboard-translation-model-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) close();
        }}>
          <section
            className="dashboard-translation-model-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={l('翻译模型设置', 'Translation model settings')}
          >
            <button type="button" className="dashboard-translation-model-close" aria-label={l('关闭模型设置', 'Close model settings')} onClick={close}>
              <X size={18} aria-hidden="true" />
            </button>
            <Suspense fallback={<p className="dashboard-translation-model-loading" role="status">{l('正在加载模型设置…', 'Loading model settings…')}</p>}>
              <CreatorServicesSettingsView
                connected={props.service != null}
                service={props.service ?? null}
                initialSection="text"
              />
            </Suspense>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
