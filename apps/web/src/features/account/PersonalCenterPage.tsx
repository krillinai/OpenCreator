import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { GatewayAccountState } from '@opencreator/protocol';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import { GatewayAccountSettingsView } from '../settings/GatewayAccountSettingsView.js';
import { GatewaySubscriptionSettingsView } from '../settings/GatewaySubscriptionSettingsView.js';
import { AccountAvatar } from './AccountAvatar.js';
import './personal-center.css';

export default function PersonalCenterPage(props: {
  view?: 'account' | 'subscription';
  service: GatewayAccountSettingsService | null;
  accountState?: GatewayAccountState;
  onStateChange?(state: GatewayAccountState): void;
  openExternal?(url: string): Promise<void> | void;
  onBack(): void;
  onOpenSubscription(): void;
}) {
  const l = useLocalizedCopy();
  const [state, setState] = useState(props.accountState);
  useEffect(() => { setState(props.accountState); }, [props.accountState]);
  const email = state?.authState === 'signed_in' ? state.account?.email : undefined;
  const subscriptionPage = props.view === 'subscription';
  const title = subscriptionPage ? l('积分与充值', 'Credits & Recharge') : l('个人中心', 'Personal center');

  return <main className="opencreator-scroll-page personal-center" aria-label={title}>
    <div className="personal-center__content">
      <header className="personal-center__heading">
        <button type="button" onClick={props.onBack} title={l('返回', 'Back')} aria-label={l('返回', 'Back')}><ArrowLeft size={20}/></button>
        <h1>{title}</h1>
      </header>
      <section className="personal-center__identity" aria-label={l('账户信息', 'Account information')}>
        <AccountAvatar email={email} accountId={state?.account?.id} avatarUrl={state?.account?.avatarUrl} loadAvatar={props.service?.getAvatar} large/>
          <GatewayAccountSettingsView
            variant="profile"
            service={props.service}
            accountState={state}
            openExternal={props.openExternal}
            onStateChange={next => {
              setState(next); props.onStateChange?.(next);
            }}
          />
      </section>
      <GatewaySubscriptionSettingsView
        variant={subscriptionPage ? 'subscription' : 'overview'}
        key={`${state?.authState}:${state?.account?.id ?? ''}`}
        service={props.service} embedded accountState={state} openExternal={props.openExternal}
        onOpenSubscription={props.onOpenSubscription}
      />
    </div>
  </main>;
}
