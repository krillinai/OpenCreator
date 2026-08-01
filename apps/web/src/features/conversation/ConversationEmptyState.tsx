import { BarChart3, Megaphone, Sparkles, TrendingUp } from 'lucide-react';

const NICKNAME_STORAGE_KEY = 'clawee.user.nickname';

const starterTags = [
  { label: '数据分析', icon: BarChart3 },
  { label: '获客转化', icon: TrendingUp },
  { label: '内容创意生成', icon: Sparkles },
  { label: '广告投放', icon: Megaphone }
] as const;

export function ConversationEmptyState(props: { nickname?: string; now?: Date }) {
  const nickname = props.nickname?.trim() || readStoredNickname() || '朋友';
  const greeting = timePeriodGreeting(props.now ?? new Date());

  return (
    <section className="conversation-empty-state" aria-labelledby="conversation-empty-title">
      <div className="conversation-empty-greeting">
        <h2 id="conversation-empty-title">{greeting}好，{nickname}</h2>
        <p>需要帮你做点什么</p>
      </div>
    </section>
  );
}

export function ConversationStarterTags() {
  return (
    <div className="conversation-starter-tags" aria-label="常用场景">
      {starterTags.map(({ label, icon: Icon }) => (
        <span className="conversation-starter-tag" key={label}>
          <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

export function timePeriodGreeting(now: Date): '上午' | '下午' | '晚上' {
  const hour = now.getHours();
  if (hour < 12) return '上午';
  if (hour < 18) return '下午';
  return '晚上';
}

function readStoredNickname(): string | undefined {
  try {
    return window.localStorage.getItem(NICKNAME_STORAGE_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}
