import AppSelect from '../../components/forms/Select.js';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, Loader2, RefreshCw, Unlink, Upload, X } from 'lucide-react';
import type { ConnectionPlatform, PlatformConnectionState } from '@opencreator/protocol';
import type { PlatformConnectionsService } from '../../services/platform-connections-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './platform-connections.css';

export function PlatformConnectionsSettingsView(props: { connected: boolean; service?: PlatformConnectionsService | null }) {
  const l = useLocalizedCopy();
  return <section className="settings-section" aria-labelledby="platform-connections-title">
    <header><h1 id="platform-connections-title">{l('平台连接', 'Platform connections')}</h1></header>
    <PlatformConnectionRow {...props} platform="youtube" />
    <PlatformConnectionRow {...props} platform="douyin" />
  </section>;
}

function PlatformConnectionRow(props: { connected: boolean; service?: PlatformConnectionsService | null; platform: ConnectionPlatform }) {
  const l = useLocalizedCopy();
  const youtube = props.platform === 'youtube';
  const name = youtube ? 'YouTube' : l('抖音', 'Douyin');
  const [state, setState] = useState<PlatformConnectionState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedProfile, setSelectedProfile] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    const service = props.service;
    if (!props.connected || !service) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = requestVersion.current;
      try {
        const next = await (youtube ? service.getYouTube() : service.getDouyin());
        if (!canceled && version === requestVersion.current) { setState(next); setError(undefined); }
      } catch { if (!canceled) setError(l('无法读取连接状态，请重试。', 'Unable to read connection status. Try again.')); }
      if (!canceled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { canceled = true; clearTimeout(timer); };
  }, [props.connected, props.service, youtube, l]);

  async function act(operation: () => Promise<PlatformConnectionState>) {
    setBusy(true); setError(undefined); ++requestVersion.current;
    try { setState(await operation()); }
    catch { setError(l('操作未完成，请检查网络或重新连接。', 'The operation failed. Check your network or reconnect.')); }
    finally { ++requestVersion.current; setBusy(false); }
  }

  const service = props.service;
  const disabled = !props.connected || !service || !state || busy;
  const connecting = state?.status === 'connecting';
  const connected = state?.status === 'connected';
  const canDisconnect = connected || state?.status === 'expired' || (state?.status === 'error' && Boolean(state.connectedAt));
  const managed = state?.connectionMethod === 'browser-login';
  const profiles = managed ? [] : state?.profiles ?? [];
  const profileId = profiles.some(profile => profile.id === selectedProfile) ? selectedProfile
    : profiles.find(profile => profile.id === state?.profileId)?.id ?? profiles[0]?.id;
  const awaitingLogin = youtube && connecting && !!state?.actionRequired;
  const label = connected ? l('已连接', 'Connected') : connecting ? state?.message ?? (youtube
    ? l('正在读取浏览器登录态', 'Reading browser session') : l('正在读取浏览器会话', 'Reading browser session'))
    : state?.status === 'expired' ? youtube ? l('登录已过期', 'Session expired') : l('会话已过期', 'Session expired') : state?.status === 'error' ? l('连接失败', 'Connection failed')
    : l('未连接', 'Disconnected');

  return <div role="group" aria-label={name}>
    <div className="platform-connection-row">
      <div className="platform-connection-identity">
        <img src={youtube ? '/platforms/youtube.png' : '/platforms/douyin-hd.png'} width="36" height="36" alt="" />
        <div className="platform-connection-copy"><h2>{name}</h2><span className={`platform-connection-status${connected ? ' is-connected' : ''}`} role="status">
          {connected ? <CheckCircle2 size={15} /> : connecting ? <Loader2 size={15} className="platform-connection-spinner" /> : null}{label}</span>
          <p className="platform-connection-description">{youtube
            ? l('使用 YouTube 登录态获取视频信息和下载视频，应对平台登录验证。', 'Use your YouTube sign-in to fetch video details and download videos when authentication is required.', 'Använd din YouTube-inloggning för att hämta videoinformation och ladda ner videor när inloggning krävs.')
            : l('使用抖音浏览器会话获取视频信息和下载公开视频，应对平台访问校验。', 'Use your Douyin browser session to fetch video details and download public videos that require session verification.', 'Använd din Douyin-webbläsarsession för att hämta videoinformation och ladda ner offentliga videor som kräver sessionsverifiering.')}</p>
        </div>
      </div>
      <div className="platform-connection-actions">
        {profiles.length ? <AppSelect aria-label={l('浏览器账号', 'Browser profile')} value={profileId} disabled={disabled || connecting}
          onChange={event => setSelectedProfile(event.target.value)}>
          {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
        </AppSelect> : null}
        {awaitingLogin ? <button type="button" disabled={disabled} onClick={() => service && void act(service.completeYouTubeLogin)}>
          <CheckCircle2 size={16} />{l('完成登录', 'Finish sign-in')}</button> : null}
        {connecting ? <button type="button" disabled={disabled} onClick={() => service && void act(youtube ? service.cancelYouTube : service.cancelDouyin)}><X size={16} />{l('取消', 'Cancel')}</button>
          : <button type="button" disabled={disabled} onClick={() => service && void act(() => youtube ? service.connectYouTube(profileId) : service.connectDouyin(profileId))}>
            {connected || state?.status === 'expired' ? <RefreshCw size={16} /> : <Link2 size={16} />}
            {connected || state?.status === 'expired' ? l('重新连接', 'Reconnect') : l('连接', 'Connect')}</button>}
        {canDisconnect ? <button type="button" disabled={disabled} onClick={() => service && void act(youtube ? service.disconnectYouTube : service.disconnectDouyin)}><Unlink size={16} />{l('断开', 'Disconnect')}</button> : null}
        {!connecting ? <button type="button" disabled={disabled} aria-label={l('导入 Cookie 文件', 'Import cookie file')} title={l('导入 Cookie 文件', 'Import cookie file')} onClick={() => fileInput.current?.click()}><Upload size={16} /></button> : null}
      </div>
    </div>
    {state?.message && !connecting ? <p role="status">{state.message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <input ref={fileInput} type="file" accept=".txt" hidden onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (!file || !service) return;
      if (file.size > 1024 * 1024) { setError(l('文件过大，请选择有效的 Cookie 文件。', 'The file is too large. Select a valid cookie file.')); return; }
      void act(async () => youtube ? service.importYouTube(await file.text()) : service.importDouyin(await file.text()));
    }} />
  </div>;
}
