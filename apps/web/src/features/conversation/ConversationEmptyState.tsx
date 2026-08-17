import { BarChart3, Megaphone, Sparkles, TrendingUp } from 'lucide-react';

const starterTags = [
  { label: '数据分析', icon: BarChart3 },
  { label: '脚本选题生成', icon: TrendingUp },
  { label: '广告素材审核', icon: Sparkles },
  { label: '视频发布', icon: Megaphone }
] as const;

export function ConversationEmptyState(props: { nickname?: string; now?: Date }) {
  const nickname = props.nickname?.trim() || undefined;
  const greeting = timePeriodGreeting(props.now ?? new Date());
  const greetingText = nickname === undefined
    ? `${greeting}好`
    : `${greeting}好，${nickname}`;

  return (
    <section className="conversation-empty-state" aria-labelledby="conversation-empty-title">
      <div className="conversation-empty-greeting">
        <h2 id="conversation-empty-title">{greetingText}</h2>
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
