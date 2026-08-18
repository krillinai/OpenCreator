import { useAppLanguage } from '../../i18n/LanguageProvider.js';

export function ConversationEmptyState(props: { now?: Date }) {
  const { t } = useAppLanguage();
  const greeting = timePeriodGreeting(props.now ?? new Date());
  const greetingText = t(`home.greeting.${greeting}`);

  return (
    <section className="conversation-empty-state" aria-labelledby="conversation-empty-title">
      <div className="conversation-empty-greeting">
        <h2 id="conversation-empty-title">{greetingText}</h2>
        <p>{t('home.question')}</p>
      </div>
    </section>
  );
}

export function timePeriodGreeting(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}
