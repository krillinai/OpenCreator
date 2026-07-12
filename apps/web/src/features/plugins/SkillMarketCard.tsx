import type { SkillMarketEntry } from '@clawee/skill-market';
import {
  Bookmark,
  CheckCircle2,
  Download,
  Info,
  RefreshCw,
  Users,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import type { SkillMarketStatus, SkillMarketViewEntry } from './skill-market-model.js';
import { SkillAuthorAvatar, SkillMarketCover } from './SkillMarketCover.js';

export type SkillMarketAction =
  | { label: string; kind: 'install' | 'update' | 'use' | 'disabled'; disabled: boolean; reason?: string };

export function SkillMarketCard({
  item,
  action,
  onOpen,
  onToggleSaved,
  onInstall,
  onUpdate,
  onUse,
}: {
  item: SkillMarketViewEntry;
  action: SkillMarketAction;
  onOpen(trigger: HTMLElement): void;
  onToggleSaved(skillId: string): void;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skillId: string): void;
}) {
  const tags = getCardTags(item);
  const actionReasonId = action.reason ? `skill-market-action-reason-${sanitizeId(item.id)}` : undefined;

  function handleAction(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (action.disabled) return;
    if (action.kind === 'install') onInstall(item.id);
    if (action.kind === 'update') onUpdate(item.id);
    if (action.kind === 'use') onUse(item.id);
  }

  return (
    <article
      className="skill-market-card"
      data-skill-id={item.id}
      data-testid="skill-market-card"
      id={`skill-card-${item.id}`}
    >
      <button
        aria-label={`打开 ${item.title} 详情`}
        className="skill-market-card__open"
        onClick={(event) => onOpen(event.currentTarget)}
        type="button"
      >
        <span className="skill-market-card__cover">
          <SkillMarketCover item={item} />
        </span>

        <span className="skill-market-card__body">
          <span className="skill-market-card__title">{item.title}</span>
          <span className="skill-market-card__tagline" title={item.entry.tagline}>
            {item.entry.tagline}
          </span>

          <span className="skill-market-card__tags" aria-label="标签">
            {tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </span>

          <span className="skill-market-card__footer">
            <span className="skill-market-author">
              <SkillAuthorAvatar name={item.entry.creator.name} src={item.entry.creator.avatarUrl} />
              <span>{item.entry.creator.name}</span>
            </span>
            <span className="skill-market-card__metrics">
              {item.status === 'installed_unknown_version' ? (
                <span className="skill-market-version-note">版本未知</span>
              ) : null}
              <span className="skill-market-users" title="使用人数" aria-label="使用人数">
                <Users size={14} aria-hidden="true" />
                {formatUsers(item.users)}
              </span>
            </span>
          </span>
        </span>
      </button>

      <div className="skill-market-card__action-row">
        <button
          aria-label={`${item.saved ? '取消收藏' : '收藏'} ${item.title}`}
          className={`skill-market-icon-button ${item.saved ? 'is-active' : ''}`}
          onClick={() => onToggleSaved(item.id)}
          title={`${item.saved ? '取消收藏' : '收藏'} ${item.title}`}
          type="button"
        >
          <Bookmark fill={item.saved ? 'currentColor' : 'none'} size={16} aria-hidden="true" />
        </button>
        {action.reason ? (
          <span className="skill-market-action-hint" id={actionReasonId}>
            <Info size={14} aria-hidden="true" />
            {action.reason}
          </span>
        ) : null}
        <button
          aria-describedby={actionReasonId}
          className="skill-market-action-button"
          disabled={action.disabled}
          onClick={handleAction}
          title={action.reason}
          type="button"
        >
          {getActionIcon(action.kind)}
          <span>{action.label}</span>
        </button>
      </div>

      {item.operationError ? (
        <p className="skill-market-inline-error" role="alert">
          {item.operationError}
        </p>
      ) : null}
    </article>
  );
}

export function getSkillMarketAction(
  status: SkillMarketStatus,
  connected: boolean,
  options: { mutationLocked?: boolean; skillsKnown?: boolean; unavailableReason?: string } = {}
): SkillMarketAction {
  if (status === 'unavailable') {
    return {
      label: '暂不可安装',
      kind: 'disabled',
      disabled: true,
      reason: options.unavailableReason ?? '当前目录条目没有可安装来源',
    };
  }
  if (!connected) {
    if (status === 'update_available') {
      return { label: '连接后更新', kind: 'update', disabled: true, reason: '需要连接 Runtime' };
    }
    if (status === 'installed' || status === 'installed_unknown_version') {
      return { label: '连接后使用', kind: 'use', disabled: true, reason: '需要连接 Runtime' };
    }
    return { label: '连接后安装', kind: 'install', disabled: true, reason: '需要连接 Runtime' };
  }
  if (options.skillsKnown === false) {
    return {
      label: '状态未知',
      kind: 'disabled',
      disabled: true,
      reason: 'Skill 安装状态未知',
    };
  }
  if (status === 'invalid') {
    return { label: '不可使用', kind: 'disabled', disabled: true, reason: '本地 Skill 状态异常' };
  }
  if (status === 'installing') {
    return { label: '安装中', kind: 'install', disabled: true };
  }
  if (status === 'updating') {
    return { label: '更新中', kind: 'update', disabled: true };
  }
  if (status === 'update_available') {
    if (options.mutationLocked) {
      return { label: '更新', kind: 'update', disabled: true, reason: '请等待当前操作完成' };
    }
    return { label: '更新', kind: 'update', disabled: false };
  }
  if (status === 'installed' || status === 'installed_unknown_version') {
    return { label: '使用', kind: 'use', disabled: false };
  }
  if (options.mutationLocked) {
    return { label: '安装', kind: 'install', disabled: true, reason: '请等待当前操作完成' };
  }
  return { label: '安装', kind: 'install', disabled: false };
}

export function formatUsers(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function getActionIcon(kind: SkillMarketAction['kind']) {
  if (kind === 'update') return <RefreshCw size={15} aria-hidden="true" />;
  if (kind === 'use') return <CheckCircle2 size={15} aria-hidden="true" />;
  return <Download size={15} aria-hidden="true" />;
}

export function getSkillMarketUnavailableReason(
  install: SkillMarketEntry['install']
): string | undefined {
  if (install.available) return undefined;
  if (install.reason === 'unsafe_archive') return '仓库包结构未通过安全校验';
  return '仓库未提供标准 SKILL.md';
}

function getCardTags(item: SkillMarketViewEntry): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    item.category.name,
    item.subcategory,
    ...item.entry.platforms,
    ...item.entry.tasks,
  ];

  for (const candidate of candidates) {
    const tag = candidate.trim();
    const key = tag.toLocaleLowerCase();
    if (tag.length === 0 || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === 6) break;
  }
  return tags;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
