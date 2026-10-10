import { useEffect, useRef, useState } from 'react';
import { CreditCard, ExternalLink, LogIn, LogOut, RefreshCw } from 'lucide-react';
import type { GatewayAccountState, GatewayAuthorization } from '@opencreator/protocol';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { ApiClientError } from '../../runtime/errors.js';
import './gateway-account-settings.css';

export function formatGatewayCredits(units: string) {
  if (!/^\d+$/.test(units)) return '?';
  const value = BigInt(units);
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
}

export function GatewayAccountSettingsView(props: {
  service: GatewayAccountSettingsService | null;
  variant?: 'settings' | 'login' | 'profile';
  accountState?: GatewayAccountState;
  signInRequest?: number;
  onSignInCanceled?(): void;
  openExternal?(url: string): Promise<void> | void;
  onStateChange?(state: GatewayAccountState): void;
  onBusyChange?(busy: boolean): void;
  onOpenSubscription?(): void;
}) {
  const l = useLocalizedCopy();
  const [state, setState] = useState<GatewayAccountState | undefined>(props.accountState);
  const [authorization, setAuthorization] = useState<GatewayAuthorization>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const callback = useRef(props.onStateChange); callback.current = props.onStateChange;
  const alive = useRef(true);
  const busyRef = useRef(false);
  const refreshSequence = useRef(0);
  const lastSignInRequest = useRef(0);
  const service = props.service;
  const compact = props.variant === 'login';
  const profile = props.variant === 'profile';
  useEffect(() => { if (props.accountState) { refreshSequence.current++; setState(props.accountState); } }, [props.accountState]);

  function update(next: GatewayAccountState) {
    if (!alive.current) return;
    refreshSequence.current++;
    setState(next); callback.current?.(next);
    if (next.authState !== 'authorizing') setAuthorization(undefined);
  }
  async function refresh() {
    const request = ++refreshSequence.current;
    if (service) {
      const next = await service.getState();
      if (alive.current && request === refreshSequence.current) { update(next); setError(''); }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => { if (alive.current) setError(l('账户服务暂不可用，请稍后重试', 'Account service is unavailable. Try again later.')); });
    const timer = setInterval(() => { if (!busyRef.current) void refresh().catch(() => undefined); }, 3000);
    return () => { alive.current = false; refreshSequence.current++; clearInterval(timer); };
  }, [service]);

  async function action(work: () => Promise<void>) {
    busyRef.current = true; refreshSequence.current++;
    setBusy(true); props.onBusyChange?.(true); setError('');
    try { await work(); }
    catch (cause) { if (alive.current) setError(cause instanceof ApiClientError && cause.code === 'GATEWAY_REQUEST_CONFLICT' ? l('请先完成或取消当前任务，再退出登录', 'Complete or cancel the current tasks before signing out.') : l('操作未完成，请稍后重试', 'Request failed. Try again later.')); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); props.onBusyChange?.(false); } }
  }
  async function signIn() {
    if (!service) return;
    try {
      const value = await service.start();
      const url = new URL(value.authorizationUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid authorization URL');
      if (!alive.current) return;
      setAuthorization(value); await refresh(); await props.openExternal?.(value.authorizationUrl);
    } catch (cause) { props.onSignInCanceled?.(); throw cause; }
  }
  useEffect(() => {
    if (!props.signInRequest || props.signInRequest === lastSignInRequest.current) return;
    lastSignInRequest.current = props.signInRequest;
    void action(signIn);
  }, [props.signInRequest]);
  const signedIn = state?.authState === 'signed_in';
  const status = <p role="status">{!service ? l('登录服务暂不可用', 'Sign-in service is unavailable')
    : state === undefined ? l('正在连接账户服务…', 'Connecting to account service…')
    : state.authState === 'authorizing' ? l('等待浏览器确认登录', 'Waiting for browser authorization')
    : state.authState === 'signing_out' ? l('正在退出', 'Signing out')
    : state.authState === 'expired' ? l('登录已过期，请重新登录', 'Session expired; sign in again')
    : signedIn && profile ? l('已登录', 'Signed in')
    : signedIn ? state.activationState === 'ready' && state.source === 'gateway' ? l('已登录，可以开始创作', 'Signed in and ready to create')
      : state.activationState === 'loading' ? l('已登录，正在连接模型服务…', 'Signed in; connecting to model service…')
      : l('已登录，模型服务暂不可用', 'Signed in; model service is unavailable')
    : l('未登录', 'Signed out')}</p>;
  return <section className={`gateway-account${compact ? ' gateway-account--login' : profile ? ' gateway-account--profile' : ''}`} aria-label={l('OpenCreator 账户', 'OpenCreator Account')}>
    {!compact && !profile ? <div className="gateway-account__heading">
      <h2>{l('OpenCreator 账户', 'OpenCreator Account')}</h2>
      <button type="button" className="gateway-account__icon" title={l('刷新账户', 'Refresh account')} aria-label={l('刷新账户', 'Refresh account')} disabled={busy || !service} onClick={() => void action(refresh)}><RefreshCw size={16}/></button>
    </div> : null}
    {state?.account && !profile ? <p className="gateway-account__email">{state.account.email}</p> : null}
    {profile ? <div className="gateway-account__identity"><h2>{signedIn ? state.account?.email ?? l('OpenCreator 账户', 'OpenCreator Account') : l('OpenCreator 账户', 'OpenCreator Account')}</h2>{status}</div> : status}
    {state?.activationError && (!profile || state.source === 'gateway') ? <p role="alert">{state.activationError.code === 'active_tasks' ? l('请等待当前任务结束后再连接官方服务。', 'Wait for the current tasks to finish before connecting official services.') : l('模型服务暂不可用，请重新连接。', 'Model service is unavailable. Please reconnect.')}</p> : null}
    {signedIn ? <div className="gateway-account__actions">
      {(profile ? state.source === 'gateway' && state.activationState !== 'ready' : state.activationState !== 'ready' || state.source !== 'gateway') ? <button type="button" disabled={busy || !service || state.activationState === 'loading'} onClick={() => void action(async () => update(await service!.activate()))}><RefreshCw size={16}/>{l('重新连接', 'Reconnect')}</button> : null}
      {props.onOpenSubscription ? <button type="button" onClick={props.onOpenSubscription}><CreditCard size={16}/>{l('积分与充值', 'Credits & Recharge')}</button> : null}
      <button type="button" disabled={busy || !service} onClick={() => void action(async () => update(await service!.logout()))}><LogOut size={16}/>{l('退出登录', 'Sign out')}</button>
    </div> : state?.authState === 'authorizing' ? <button type="button" disabled={busy} onClick={() => void action(async () => { update(await service!.cancel()); props.onSignInCanceled?.(); })}>{l('取消登录', 'Cancel sign-in')}</button>
      : <button type="button" className="gateway-account__primary" disabled={busy || !service || !state || state.authState === 'signing_out' || state.authState === 'disabled'} onClick={() => void action(signIn)}><LogIn size={16}/>{busy ? l('正在登录…', 'Signing in…') : profile ? l('登录 / 注册', 'Sign in / Register') : l('登录 OpenCreator', 'Sign in to OpenCreator')}</button>}
    {authorization ? <a href={authorization.authorizationUrl} target="_blank" rel="noreferrer">{l('打开登录页面', 'Open sign-in page')} <ExternalLink size={14}/></a> : null}
    {error ? <p role="alert">{error}</p> : null}
    {(compact || profile) && error && !state && service ? <button type="button" disabled={busy} onClick={() => void action(refresh)}><RefreshCw size={16}/>{l('重试', 'Retry')}</button> : null}
  </section>;
}
