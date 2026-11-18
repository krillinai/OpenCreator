import { useEffect, useState } from 'react';
import { Radio, Save } from 'lucide-react';
import type { CreatorServicesSettingsService, NetworkTestResult } from '../../services/creator-services-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export function NetworkSettings(props: { service?: CreatorServicesSettingsService | null; connected: boolean }) {
  const l = useLocalizedCopy();
  const [saved, setSaved] = useState<string>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<NetworkTestResult>();
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
    if (!validProxy(proxy)) { setError(l('请输入有效的 HTTP 或 HTTPS 代理地址', 'Enter a valid HTTP or HTTPS proxy URL')); return; }
    setBusy(true);
    try {
      const value = await props.service!.saveNetwork!({ proxy });
      setSaved(value.proxy); setDraft(value.proxy); setTestResult(undefined);
    } catch { setError(l('无法保存代理配置', 'Unable to save proxy settings')); }
    finally { setBusy(false); }
  }
  async function test() {
    const proxy = draft.trim();
    setError(''); setTestResult(undefined);
    if (!validProxy(proxy)) { setError(l('请输入有效的 HTTP 或 HTTPS 代理地址', 'Enter a valid HTTP or HTTPS proxy URL')); return; }
    setTestBusy(true);
    try { setTestResult(await props.service!.testNetwork!({ proxy })); }
    catch { setError(l('无法检测代理连接，请重试。', 'Could not test the proxy connection. Try again.', 'Det gick inte att testa proxyanslutningen. Försök igen.')); }
    finally { setTestBusy(false); }
  }
  const disabled = !props.connected || busy || testBusy || saved === undefined;
  return <>
    <div className="settings-row settings-control-row settings-directory-row">
      <label htmlFor="settings-network-proxy">{l('网络代理', 'Network proxy')}</label>
      <input id="settings-network-proxy" className="settings-directory-input" aria-invalid={!!error}
        aria-describedby={error ? 'settings-network-error' : undefined} value={draft} disabled={disabled}
        placeholder="http://127.0.0.1:7890" autoComplete="off"
        onChange={event => { setDraft(event.target.value); setTestResult(undefined); }}
        onKeyDown={event => { if (event.key === 'Enter' && draft.trim() !== saved) void save(); }} />
      <span className="settings-directory-actions">
        {props.service.testNetwork ? <button type="button" className="icon-button"
          aria-label={l('检测代理连接', 'Test proxy connection', 'Testa proxyanslutning')}
          title={l('检测代理连接', 'Test proxy connection', 'Testa proxyanslutning')}
          disabled={disabled || !draft.trim()} onClick={() => void test()}><Radio size={17} aria-hidden="true" /></button> : null}
        <button type="button" className="icon-button"
        aria-label={l('保存网络代理', 'Save network proxy')} title={l('保存网络代理', 'Save network proxy')}
        disabled={disabled || draft.trim() === saved} onClick={() => void save()}><Save size={17} aria-hidden="true" /></button></span>
    </div>
    {error ? <p id="settings-network-error" role="alert">{error}</p> : null}
    {testResult ? <p role="status">{networkTestMessage(testResult, l)}</p> : null}
  </>;
}

function validProxy(proxy: string): boolean {
  if (!proxy) return true;
  try {
    const url = new URL(proxy);
    return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.search && !url.hash
      && (url.pathname === '/' || url.pathname === '');
  } catch { return false; }
}

function networkTestMessage(result: NetworkTestResult, l: ReturnType<typeof useLocalizedCopy>): string {
  if (result.status === 'proxy_unreachable') return l('无法连接代理服务，请检查地址和代理是否正在运行。',
    'Could not connect to the proxy. Check its address and whether it is running.',
    'Det gick inte att ansluta till proxyn. Kontrollera adressen och att den körs.');
  if (result.status === 'proxy_auth_required') return l('代理要求认证，请检查代理地址中的用户名和密码。',
    'The proxy requires authentication. Check the username and password in its URL.',
    'Proxyn kräver autentisering. Kontrollera användarnamnet och lösenordet i proxyadressen.');
  if (result.status === 'upstream_unreachable') return l('代理可连接，但无法经代理访问视频站。请检查代理规则或上游网络。',
    'The proxy is reachable, but the video site cannot be accessed through it. Check proxy rules or the upstream network.',
    'Proxyn kan nås, men videoportalen kan inte nås via den. Kontrollera proxyreglerna eller nätverket.');
  if (result.status === 'not_configured') return l('尚未配置代理。', 'No proxy is configured.', 'Ingen proxy har konfigurerats.');
  if (result.httpStatus >= 400) return l(`代理已连接，视频站返回 HTTP ${result.httpStatus}。请检查平台访问权限。`,
    `The proxy is connected, but the video site returned HTTP ${result.httpStatus}. Check platform access.`,
    `Proxyn är ansluten, men videoportalen svarade med HTTP ${result.httpStatus}. Kontrollera åtkomsten.`);
  return l('代理和视频站连接正常。', 'The proxy and video site are reachable.', 'Proxyn och videoportalen kan nås.');
}
