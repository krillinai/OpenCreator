import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CreditCard, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import type { GatewayAccountState } from '@opencreator/protocol';
import type { GatewayAccountSettingsService, GatewayBillingSummary } from '../../services/gateway-account-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { formatGatewayCredits, GatewayAccountSettingsView } from './GatewayAccountSettingsView.js';
import './gateway-account-settings.css';

export function GatewaySubscriptionSettingsView(props: {
  service: GatewayAccountSettingsService | null;
  embedded?: boolean;
  variant?: 'overview' | 'subscription';
  accountState?: GatewayAccountState;
  onOpenSubscription?(): void;
  openExternal?(url: string): Promise<void> | void;
  onStateChange?(state: GatewayAccountState): void;
}) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const [state, setState] = useState<GatewayAccountState>();
  const [summary, setSummary] = useState<GatewayBillingSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const sequence = useRef(0);
  const owner = useRef<string>();
  const supplied = useRef(props.accountState); supplied.current = props.accountState;
  const callback = useRef(props.onStateChange); callback.current = props.onStateChange;
  const service = props.service;
  const overview = props.variant === 'overview';
  const account = props.embedded ? props.accountState : state;
  const signedIn = account?.authState === 'signed_in';

  async function refresh() {
    const request = ++sequence.current;
    if (!service) { setLoading(false); return; }
    try {
      const next = props.embedded ? supplied.current : await service.getState();
      if (!alive.current || request !== sequence.current) return;
      const id = next?.authState === 'signed_in' ? next.account?.id : undefined;
      if (owner.current !== id) { owner.current = id; setSummary(undefined); }
      setState(next);
      if (!props.embedded && next) callback.current?.(next);
      const value = id ? await service.getSummary() : undefined;
      if (!alive.current || request !== sequence.current) return;
      setSummary(value); setError('');
    } catch {
      if (alive.current && request === sequence.current) setError(l('积分信息暂不可用，请重试', 'Credit information is unavailable. Try again.'));
    } finally { if (alive.current && request === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; setLoading(true); setSummary(undefined); setBusy(false); setError('');
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { alive.current = false; sequence.current++; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [service, props.embedded, props.accountState?.account?.id, props.accountState?.authState]);

  const plansURL = (() => {
    try {
      const url = new URL(summary?.plansUrl || 'https://www.open-creator.ai/pricing');
      const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.pathname !== '/pricing') return undefined;
      url.searchParams.set('lang', language === 'zh-CN' ? 'zh' : 'en');
      return url.href;
    } catch { return undefined; }
  })();

  async function recharge() {
    if (!plansURL) return;
    const id = owner.current;
    setBusy(true); setError('');
    try {
      if (props.openExternal) await props.openExternal(plansURL);
      else window.open(plansURL, '_blank', 'noopener,noreferrer');
    } catch {
      if (alive.current && id === owner.current) setError(l('无法打开充值页面，请重试', 'Unable to open credit plans. Try again.'));
    } finally { if (alive.current && id === owner.current) setBusy(false); }
  }

  return <section className={`gateway-account gateway-subscription${props.embedded ? ' gateway-subscription--embedded' : ''}`} aria-label={l('积分与充值', 'Credits')}>
    {!props.embedded ? <GatewayAccountSettingsView service={service} variant="login" onStateChange={value => { setState(value); callback.current?.(value); void refresh(); }}/>: null}
    {loading && !summary ? <p className="gateway-subscription__loading" role="status"><LoaderCircle size={16}/>{l('正在加载积分', 'Loading credits')}</p> : null}
    {signedIn ? <div className="gateway-subscription__overview">
      <div><h2>{l('可用积分', 'Available credits')}</h2><p className="gateway-subscription__credit-value">{summary ? formatGatewayCredits(summary.balance.availableUnits) : '—'} <small>{l('积分', 'credits')}</small></p>
        {summary ? <p className="gateway-subscription__detail">{l(error ? '上次更新' : '更新于', error ? 'Last updated' : 'Updated')} {new Date(summary.balance.asOf).toLocaleString()}</p> : null}
      </div>
      <div><h2>{l('充值积分', 'Buy credits')}</h2><p className="gateway-subscription__detail">{l('一次性购买 · 积分长期有效 · 无自动续费', 'One-time purchase · Credits never expire · No automatic renewal')}</p>
        {summary?.paymentReview ? <p role="status">{l('付款正在审核，积分使用已暂停，请联系客服', 'Your payment is under review. Credit usage is paused. Contact support.')}</p> : null}
        {!overview ? <button type="button" className="gateway-account__primary" disabled={busy || loading || !summary || !plansURL || !!error || !summary.billingAvailable} onClick={() => { void recharge(); }}><CreditCard size={16}/>{l('充值积分', 'Buy credits')}<ExternalLink size={14}/></button> : null}
        {!overview && summary && !summary.billingAvailable && !summary.paymentReview ? <p className="gateway-subscription__detail" role="status">{l('充值暂不可用', 'Credit purchases are currently unavailable')}</p> : null}
      </div>
    </div> : !loading && !overview ? <p className="gateway-subscription__detail">{l('登录后可查看积分、购买积分并使用官方模型', 'Sign in to view your balance, buy credits, and use official models')}</p> : null}
    {overview && props.onOpenSubscription ? <button type="button" className="gateway-subscription__entry" onClick={props.onOpenSubscription}><span>{l('积分与充值', 'Credits')}</span><ArrowRight size={17}/></button> : null}
    {!overview && plansURL ? <a href={plansURL} target="_blank" rel="noreferrer">{l('查看积分方案', 'View credit plans')} <ExternalLink size={14}/></a> : null}
    {error ? <div className="gateway-subscription__error"><p role="alert">{error}</p><button type="button" disabled={loading} onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={16}/>{l('重试', 'Retry')}</button></div> : null}
  </section>;
}
