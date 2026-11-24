import { Download, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { OmniVoiceComponentStatus } from '../../services/runtime-dependency-service.js';
import { OriginalErrorDetails } from '../issues/OriginalErrorDetails.js';

export function OmniVoiceComponentCard({ service }: { service: NonNullable<RuntimeDependenciesController['omniVoice']> }) {
  const l = useLocalizedCopy();
  const [status, setStatus] = useState<OmniVoiceComponentStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const update = useCallback(async (install = false) => {
    const id = ++request.current;
    setPending(true);
    try {
      const result = install ? await service.downloadOmniVoiceComponent() : await service.getOmniVoiceComponent();
      if (id === request.current) { setStatus(result); setError(undefined); }
    } catch (cause) {
      if (id === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === request.current) setPending(false);
    }
  }, [service]);
  useEffect(() => {
    setStatus(undefined);
    void update();
    return () => { request.current++; };
  }, [update]);
  useEffect(() => {
    if (status?.state !== 'preparing' || pending || error) return;
    const timer = setTimeout(() => { void update(); }, 1200);
    return () => clearTimeout(timer);
  }, [status, pending, error, update]);

  const ready = status?.state === 'ready';
  const preparing = status?.state === 'preparing' && !error;
  const detail = error ?? status?.error;
  const label = error ? l('状态未知', 'Unknown status') : ready ? l('已就绪', 'Ready')
    : preparing ? l('正在准备', 'Preparing') : status?.state === 'failed' ? l('准备失败', 'Preparation failed')
    : status?.state === 'missing' ? l('尚未安装', 'Not installed') : l('正在检查', 'Checking');
  return <article className="runtime-component-item" id="component-omnivoice">
    <div className="runtime-component-heading"><div>
      <div className="runtime-component-title"><h2>{l('OmniVoice 本地配音', 'OmniVoice local speech synthesis')}</h2>
        <span role="status" data-status={error || status?.state === 'failed' ? 'update' : ready ? 'current' : 'checking'}>{label}</span>
      </div>
      <p>{l('供智能配音和视频翻译共用，需要 Python 3.10 或以上版本。', 'Used by smart dubbing and video translation. Requires Python 3.10 or later.')}</p>
    </div></div>
    <dl className="runtime-component-details">
      <div><dt>{l('默认模型', 'Default model')}</dt><dd>k2-fsa/OmniVoice · 3.27 GB</dd></div>
      {status?.path ? <div><dt>{l('安装位置', 'Install location')}</dt><dd>{status.path}</dd></div> : null}
    </dl>
    {preparing ? <div className="local-component-progress" role="status">
      <span>{l('正在准备 Python 依赖和模型文件，可离开此页。', 'Preparing Python dependencies and model files. You can leave this page.')}</span>
      <progress aria-label={l('OmniVoice 下载进度', 'OmniVoice download progress')} />
    </div> : null}
    {detail ? <div role="alert"><OriginalErrorDetails detail={detail} /></div> : null}
    {!preparing ? <footer className="runtime-component-footer"><div className="runtime-component-actions">
      <button type="button" className="settings-secondary-button" disabled={pending} onClick={() => void update()}>
        <RefreshCw size={15} aria-hidden="true" />{l('检查状态', 'Check status')}
      </button>
      {status && !ready && !error ? <button type="button" className="settings-primary-button" disabled={pending} onClick={() => void update(true)}>
        <Download size={15} aria-hidden="true" />{status.state === 'failed' ? l('重试下载', 'Retry download') : l('下载模型', 'Download model')}
      </button> : null}
    </div></footer> : null}
  </article>;
}
