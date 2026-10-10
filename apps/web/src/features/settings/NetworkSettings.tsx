import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export function NetworkSettings(props: { service?: CreatorServicesSettingsService | null; connected: boolean }) {
  const l = useLocalizedCopy();
  const [saved, setSaved] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let canceled = false;
    void props.service?.getNetwork?.().then(value => {
      if (!canceled) { setSaved(value.proxy); setDraft(value.proxy); }
    }).catch(() => { if (!canceled) setError(l('无法读取代理配置', 'Unable to load proxy settings')); });
    return () => { canceled = true; };
  }, [props.service, l]);
  if (!props.service?.getNetwork || !props.service.saveNetwork) return null;
  async function save() {
    setError('');
    const proxy = draft.trim();
    if (proxy) {
      try {
        const url = new URL(proxy);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.search || url.hash
          || (url.pathname !== '/' && url.pathname !== '')) throw new Error('invalid');
      } catch { setError(l('请输入有效的 HTTP 或 HTTPS 代理地址', 'Enter a valid HTTP or HTTPS proxy URL')); return; }
    }
    setBusy(true);
    try {
      const value = await props.service!.saveNetwork!({ proxy });
      setSaved(value.proxy); setDraft(value.proxy);
    } catch { setError(l('无法保存代理配置', 'Unable to save proxy settings')); }
    finally { setBusy(false); }
  }
  const disabled = !props.connected || busy || saved === undefined;
  return <>
    <div className="settings-row settings-control-row settings-directory-row">
      <label htmlFor="settings-network-proxy">{l('网络代理', 'Network proxy')}</label>
      <input id="settings-network-proxy" className="settings-directory-input" aria-invalid={!!error}
        aria-describedby={error ? 'settings-network-error' : undefined} value={draft} disabled={disabled}
        placeholder="http://127.0.0.1:7890" autoComplete="off"
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && draft.trim() !== saved) void save(); }} />
      <span className="settings-directory-actions"><button type="button" className="icon-button"
        aria-label={l('保存网络代理', 'Save network proxy')} title={l('保存网络代理', 'Save network proxy')}
        disabled={disabled || draft.trim() === saved} onClick={() => void save()}><Save size={17} aria-hidden="true" /></button></span>
    </div>
    {error ? <p id="settings-network-error" role="alert">{error}</p> : null}
  </>;
}
