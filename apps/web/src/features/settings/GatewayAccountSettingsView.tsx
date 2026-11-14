import AppSelect from '../../components/forms/Select.js';
import { useEffect, useRef, useState } from 'react';
import { CreditCard, ExternalLink, LogIn, LogOut, MoreHorizontal, RefreshCw } from 'lucide-react';
import type { GatewayAccountState, GatewayAuthorization } from '@opencreator/protocol';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { ApiClientError } from '../../runtime/errors.js';
import './gateway-account-settings.css';

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
  const [confirmingAuthorization, setConfirmingAuthorization] = useState(() =>
    window.location.hash.startsWith('#/account?')
    && new URLSearchParams(window.location.hash.split('?')[1]).get('login') === 'complete'
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const callback = useRef(props.onStateChange); callback.current = props.onStateChange;
  const alive = useRef(true);
  const busyRef = useRef(false);
  const refreshSequence = useRef(0);
  const lastSignInRequest = useRef(0);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const service = props.service;
  const compact = props.variant === 'login';
  const profile = props.variant === 'profile';
  useEffect(() => { if (props.accountState) { refreshSequence.current++; setState(props.accountState); } }, [props.accountState]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => { if (accountMenu.current && !accountMenu.current.contains(event.target as Node)) accountMenu.current.open = false; };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && accountMenu.current?.open) { accountMenu.current.open = false; accountMenu.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', closeOutside); document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, []);

  function update(next: GatewayAccountState) {
    if (!alive.current) return;
    refreshSequence.current++;
    setState(next); callback.current?.(next);
    if (next.authState !== 'authorizing') { setAuthorization(undefined); setConfirmingAuthorization(false); }
  }
  async function refresh(checkAuthorization = false, refreshModels = false) {
    const request = ++refreshSequence.current;
    if (service) {
      const next = await service.getState({ checkAuthorization, ...(refreshModels ? { refreshModels: true } : {}) });
      if (alive.current && request === refreshSequence.current) { update(next); setError(''); }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh(confirmingAuthorization).catch(() => { if (alive.current) setError(l('账户服务暂不可用，请稍后重试', 'Account service is unavailable. Try again later.')); });
    const onReturn = () => {
      if (busyRef.current) return;
      setConfirmingAuthorization(true);
      void refresh(true).catch(() => undefined);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') onReturn(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false; refreshSequence.current++;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [service]);
  useEffect(() => {
    const interval = state?.authState === 'authorizing' || state?.activationState === 'loading' ? 1000 : 3000;
    const timer = setInterval(() => { if (!busyRef.current) void refresh().catch(() => undefined); }, interval);
    return () => clearInterval(timer);
  }, [service, state?.authState, state?.activationState]);

  async function action(work: () => Promise<void>) {
    busyRef.current = true; refreshSequence.current++;
    setBusy(true); props.onBusyChange?.(true); setError('');
    try { await work(); }
    catch (cause) { if (alive.current) setError(cause instanceof ApiClientError && cause.code === 'GATEWAY_REQUEST_CONFLICT' ? l('当前操作与正在进行的任务冲突，请稍后重试', 'This operation conflicts with current tasks. Try again later.') : l('操作未完成，请稍后重试', 'Request failed. Try again later.')); }
    finally { busyRef.current = false; if (alive.current) { setBusy(false); props.onBusyChange?.(false); } }
  }
  async function signIn() {
    if (!service) return;
    setConfirmingAuthorization(false);
    try {
      const value = await service.start();
      const url = new URL(value.authorizationUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid authorization URL');
      url.searchParams.set('lang', l('zh', 'en'));
      if (!alive.current) return;
      setAuthorization({ ...value, authorizationUrl: url.href }); await refresh(); await props.openExternal?.(url.href);
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
    : state.authState === 'authorizing' ? confirmingAuthorization ? l('正在确认登录结果…', 'Confirming sign-in…') : l('请在浏览器中完成登录', 'Complete sign-in in your browser')
    : state.authState === 'signing_out' ? l('正在退出登录…', 'Signing out…')
    : state.authState === 'expired' ? l('登录已过期，请重新登录', 'Session expired; sign in again')
    : signedIn && state.activationError?.code === 'supplier_migrating' ? l('官方服务维护中，完成后将自动恢复。', 'Official service is under maintenance and will resume automatically.')
    : signedIn && profile ? l('已登录', 'Signed in')
    : signedIn ? state.activationState === 'ready' && state.source === 'gateway' ? l('已登录，可以开始创作', 'Signed in and ready to create')
      : state.activationState === 'loading' ? l('已登录，正在连接模型服务…', 'Signed in; connecting to model service…')
      : l('已登录，模型服务暂不可用', 'Signed in; model service is unavailable')
    : l('未登录', 'Signed out')}</p>;
  return <section className={`gateway-account${compact ? ' gateway-account--login' : profile ? ' gateway-account--profile' : ''}`} aria-label={l('OpenCreator 账户', 'OpenCreator Account')}>
    {!compact && !profile ? <div className="gateway-account__heading">
      <h2>{l('OpenCreator 账户', 'OpenCreator Account')}</h2>
      <button type="button" className="gateway-account__icon" title={l('刷新账户', 'Refresh account')} aria-label={l('刷新账户', 'Refresh account')} disabled={busy || !service} onClick={() => void action(() => refresh(false, true))}><RefreshCw size={16}/></button>
    </div> : null}
    {state?.account && !profile ? <p className="gateway-account__email">{state.account.email}</p> : null}
    {signedIn && !compact && state.transport === 'supplier-direct' && state.supplier === 'chatanywhere' && service?.setRegion ? <label>{l('连接区域', 'Connection Region')}<AppSelect aria-label={l('连接区域', 'Connection Region')} value={state.supplierRegion ?? 'auto'} disabled={busy} onChange={event => { const next = event.target.value as 'auto' | 'domestic' | 'overseas'; void action(async () => update(await service.setRegion!(next))); }}>
      <option value="auto">{l('默认（国内线路）', 'Default (Mainland route)')}</option><option value="domestic">{l('国内', 'Mainland China')}</option><option value="overseas">{l('海外', 'Overseas')}</option>
    </AppSelect></label> : null}
    {profile ? <div className="gateway-account__identity"><h2>{signedIn ? state.account?.email ?? l('OpenCreator 账户', 'OpenCreator Account') : l('OpenCreator 账户', 'OpenCreator Account')}</h2>{status}</div> : status}
    {state?.activationError && (!profile || !signedIn) ? <p role="alert">{state.activationError.code === 'device_expired' ? l('登录授权已过期，请重新登录。', 'Authorization expired. Please sign in again.')
      : !signedIn ? l('登录未完成，请重新登录。', 'Sign-in did not complete. Please try again.')
      : state.activationError.code === 'model_catalog_unavailable' ? l('模型列表暂时无法获取，请重试。', 'The model list is temporarily unavailable. Try again.')
      : state.activationError.code === 'credits_migration_required' ? l('原有积分需要迁移，请联系管理员。', 'Your existing credits need migration. Contact an administrator.')
      : state.activationError.code === 'no_available_models' ? l('当前没有可用的文本模型。', 'No compatible text models are available.')
      : state.activationError.code === 'supplier_migrating' ? l('官方服务维护中，完成后将自动恢复。', 'Official service is under maintenance and will resume automatically.')
      : state.activationError.code === 'active_tasks' ? l('请等待当前任务结束后再连接官方服务。', 'Wait for the current tasks to finish before connecting official services.') : l('模型服务暂不可用，请重新连接。', 'Model service is unavailable. Please reconnect.')}</p> : null}
    {signedIn && profile ? <details ref={accountMenu} className="gateway-account__menu"><summary title={l('账号菜单', 'Account menu')} aria-label={l('账号菜单', 'Account menu')}><MoreHorizontal size={20}/></summary><div>
      <button type="button" disabled={busy || !service} onClick={() => void action(() => refresh(false, true))}><RefreshCw size={16}/>{l('刷新模型', 'Refresh models')}</button>
      <button type="button" disabled={busy || !service} onClick={() => void action(async () => update(await service!.logout()))}><LogOut size={16}/>{l('退出登录', 'Sign out')}</button>
    </div></details>
    : signedIn ? <div className="gateway-account__actions">
      {(profile ? state.source === 'gateway' && state.activationState !== 'ready' : state.activationState !== 'ready' || state.source !== 'gateway') ? <button type="button" disabled={busy || !service || state.activationState === 'loading'} onClick={() => void action(async () => update(await service!.activate()))}><RefreshCw size={16}/>{l('重新连接', 'Reconnect')}</button> : null}
      {props.onOpenSubscription ? <button type="button" onClick={props.onOpenSubscription}><CreditCard size={16}/>{l('积分与充值', 'Credits')}</button> : null}
      <button type="button" disabled={busy || !service} onClick={() => void action(async () => update(await service!.logout()))}><LogOut size={16}/>{l('退出登录', 'Sign out')}</button>
    </div> : state?.authState === 'authorizing' ? <button type="button" disabled={busy} onClick={() => void action(async () => { update(await service!.cancel()); props.onSignInCanceled?.(); })}>{l('取消登录', 'Cancel sign-in')}</button>
      : <button type="button" className="gateway-account__primary" disabled={busy || !service || !state || state.authState === 'signing_out' || state.authState === 'disabled'} onClick={() => void action(signIn)}><LogIn size={16}/>{busy ? l('正在登录…', 'Signing in…') : profile ? l('登录 / 注册', 'Sign in / Sign up') : l('登录 OpenCreator', 'Sign in to OpenCreator')}</button>}
    {authorization ? <a href={authorization.authorizationUrl} target="_blank" rel="noreferrer">{l('打开登录页面', 'Open sign-in page')} <ExternalLink size={14}/></a> : null}
    {error ? <p role="alert">{error}</p> : null}
    {(compact || profile) && error && !state && service ? <button type="button" disabled={busy} onClick={() => void action(refresh)}><RefreshCw size={16}/>{l('重试', 'Retry')}</button> : null}
  </section>;
}
