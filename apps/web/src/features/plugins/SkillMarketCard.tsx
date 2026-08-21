import {
  Info,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import type { SkillMarketStatus, SkillMarketViewEntry } from './skill-market-model.js';
import { SkillAuthorAvatar } from './SkillMarketCover.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';

export type SkillMarketAction =
  | {
      label: string;
      kind: 'install' | 'update' | 'use' | 'disabled';
      disabled: boolean;
      reason?: string;
      showReason?: boolean;
    };

export function SkillMarketCard({
  item,
  action,
  onOpen,
  onInstall,
  onUpdate,
  onUse,
}: {
  item: SkillMarketViewEntry;
  action: SkillMarketAction;
  onOpen(trigger: HTMLElement, restoreFocus: boolean): void;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skillId: string): void;
}) {
  const l = useLocalizedCopy();
  const actionReasonId =
    action.reason && action.showReason !== false
      ? `skill-market-action-reason-${sanitizeId(item.id)}`
      : undefined;
  const topAction = action.kind === 'install' || action.kind === 'use';

  function handleAction(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (action.disabled) return;
    if (action.kind === 'install') onInstall(item.id);
    if (action.kind === 'update') onUpdate(item.id);
    if (action.kind === 'use') onUse(item.id);
  }

  const actionButton = (
    <button
      aria-label={topAction ? action.label : undefined}
      aria-describedby={topAction ? undefined : actionReasonId}
      className={[
        'skill-market-action-button',
        `skill-market-action-button--${action.kind}`,
        action.showReason === false ? 'skill-market-action-button--quiet-disabled' : '',
      ].filter(Boolean).join(' ')}
      disabled={action.disabled}
      onClick={handleAction}
      title={action.reason}
      type="button"
    >
      {getActionIcon(action.kind)}
      {topAction && action.kind !== 'use' ? null : <span>{action.label}</span>}
    </button>
  );

  return (
    <article
      className="skill-market-card"
      data-skill-id={item.id}
      data-testid="skill-market-card"
      id={`skill-card-${item.id}`}
    >
      <button
        aria-label={`${l('打开', 'Open')} ${item.title} ${l('详情', 'details')}`}
        className="skill-market-card__open"
        onClick={(event) => onOpen(event.currentTarget, event.detail === 0)}
        type="button"
      >
        <span className="skill-market-card__body">
          <span className="skill-market-card__identity">
            <SkillAuthorAvatar name={item.entry.creator.name} src={item.entry.creator.avatarUrl} />
            <span className="skill-market-card__identity-copy">
              <span className="skill-market-card__title">{item.title}</span>
              <span className="skill-market-card__author">{item.entry.creator.name}</span>
            </span>
          </span>

          <span className="skill-market-card__tagline" title={item.entry.tagline}>
            {item.entry.tagline}
          </span>
        </span>
      </button>

      {topAction ? actionButton : null}

      {topAction ? null : <div className="skill-market-card__action-row">
        {actionReasonId ? (
          <span
            className="skill-market-action-reason"
            id={actionReasonId}
            title={action.reason}
          >
            <Info size={14} aria-hidden="true" />
            <span className="skill-market-visually-hidden">{action.reason}</span>
          </span>
        ) : null}
        {actionButton}
      </div>}

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
  options: { mutationLocked?: boolean; skillsKnown?: boolean } = {},
  l: LocalizeCopy = (chinese) => chinese
): SkillMarketAction {
  if (!connected) {
    if (status === 'update_available') {
      return { label: l('连接后更新', 'Connect to update'), kind: 'update', disabled: true, reason: l('需要连接 Runtime', 'Runtime connection required') };
    }
    if (status === 'installed' || status === 'installed_unknown_version') {
      return { label: l('连接后使用', 'Connect to use'), kind: 'use', disabled: true, reason: l('需要连接 Runtime', 'Runtime connection required') };
    }
    return { label: l('连接后安装', 'Connect to install'), kind: 'install', disabled: true, reason: l('需要连接 Runtime', 'Runtime connection required') };
  }
  if (options.skillsKnown === false) {
    return {
      label: l('状态未知', 'Unknown status'),
      kind: 'disabled',
      disabled: true,
      reason: l('技能安装状态未知', 'Skill installation status is unknown'),
    };
  }
  if (status === 'invalid') {
    return { label: l('不可使用', 'Unavailable'), kind: 'disabled', disabled: true, reason: l('本地技能状态异常', 'The local Skill is in an invalid state') };
  }
  if (status === 'installing') {
    return { label: l('安装中', 'Installing'), kind: 'install', disabled: true };
  }
  if (status === 'updating') {
    return { label: l('更新中', 'Updating'), kind: 'update', disabled: true };
  }
  if (status === 'update_available') {
    if (options.mutationLocked) {
      return {
        label: l('更新', 'Update'),
        kind: 'update',
        disabled: true,
        reason: l('请等待当前操作完成', 'Wait for the current operation to finish'),
        showReason: false,
      };
    }
    return { label: l('更新', 'Update'), kind: 'update', disabled: false };
  }
  if (status === 'installed' || status === 'installed_unknown_version') {
    return { label: l('使用', 'Use'), kind: 'use', disabled: false };
  }
  if (options.mutationLocked) {
    return {
      label: l('安装', 'Install'),
      kind: 'install',
      disabled: true,
      reason: l('请等待当前操作完成', 'Wait for the current operation to finish'),
      showReason: false,
    };
  }
  return { label: l('安装', 'Install'), kind: 'install', disabled: false };
}

function getActionIcon(kind: SkillMarketAction['kind']) {
  if (kind === 'update') return <RefreshCw size={15} aria-hidden="true" />;
  if (kind === 'use') return null;
  return <Plus size={16} aria-hidden="true" />;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
