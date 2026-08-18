import { CircleCheck, LogIn, UserRound } from 'lucide-react';
import type { ConsumerUser } from './consumer-user.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export type ConsumerAccountPageProps = {
  user?: ConsumerUser;
  onLogin?(): void;
};

export function ConsumerAccountPage({ user, onLogin }: ConsumerAccountPageProps) {
  const l = useLocalizedCopy();
  if (user === undefined) {
    return (
      <main className="consumer-account-page" aria-labelledby="consumer-account-title">
        <section className="consumer-login-panel">
          <LogIn size={24} strokeWidth={1.8} aria-hidden="true" />
          <h1 id="consumer-account-title">{l('登录 OpenCreator', 'Sign in to OpenCreator')}</h1>
          <p>{l('登录后即可使用云端协作。', 'Sign in to sync and collaborate in the cloud.')}</p>
          <button type="button" onClick={onLogin}>
            <LogIn size={16} strokeWidth={2} aria-hidden="true" />
            {l('登录', 'Sign in')}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="consumer-account-page" aria-labelledby="consumer-account-title">
      <section className="consumer-account-profile">
        <div className="consumer-account-avatar" aria-hidden="true">
          {user.initials}
        </div>
        <div className="consumer-account-copy">
          <span className="consumer-account-status">
            <CircleCheck size={14} aria-hidden="true" />
            {l('已登录', 'Signed in')}
          </span>
          <h1 id="consumer-account-title">{user.name}</h1>
          <p>{user.email}</p>
        </div>
        <UserRound className="consumer-account-icon" size={22} aria-hidden="true" />
      </section>
    </main>
  );
}

export default ConsumerAccountPage;
