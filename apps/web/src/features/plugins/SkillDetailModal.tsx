import {
  Bookmark,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { SkillMarketViewEntry } from './skill-market-model.js';
import {
  formatUsers,
  getSkillMarketAction,
  type SkillMarketAction,
} from './SkillMarketCard.js';
import { SkillAuthorAvatar, SkillMarketCover } from './SkillMarketCover.js';

export function SkillDetailModal({
  item,
  connected,
  mutationLocked,
  skillsKnown,
  saved,
  useError,
  onClose,
  onToggleSaved,
  onInstall,
  onUpdate,
  onUse,
}: {
  item: SkillMarketViewEntry;
  connected: boolean;
  mutationLocked?: boolean;
  skillsKnown: boolean;
  saved: boolean;
  useError?: string;
  onClose(): void;
  onToggleSaved(skillId: string): void;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skillId: string): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const action = getSkillMarketAction(item.status, connected, {
    mutationLocked,
    skillsKnown,
  });
  const actionReasonId = action.reason ? `skill-market-modal-action-reason-${sanitizeId(item.id)}` : undefined;
  const riskNotes = getRiskNotes(item);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    lockBodyScroll();
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();
    };
  }, [item.id]);

  return (
    <div
      className="skill-market-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-modal="true"
        aria-labelledby="skill-market-detail-title"
        className="skill-market-modal"
        ref={dialogRef}
        role="dialog"
      >
        <div className="skill-market-modal__bar">
          <button
            aria-label={`${saved ? '取消收藏' : '收藏'} ${item.title}`}
            className={`skill-market-icon-button ${saved ? 'is-active' : ''}`}
            onClick={() => onToggleSaved(item.id)}
            title={`${saved ? '取消收藏' : '收藏'} ${item.title}`}
            type="button"
          >
            <Bookmark fill={saved ? 'currentColor' : 'none'} size={16} aria-hidden="true" />
          </button>
          <button
            aria-label="关闭详情"
            className="skill-market-icon-button"
            onClick={onClose}
            ref={closeRef}
            title="关闭详情"
            type="button"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="skill-market-modal__body">
          <header className="skill-market-detail-head">
            <div className="skill-market-detail-head__cover">
              <SkillMarketCover item={item} compact />
            </div>
            <div className="skill-market-detail-head__content">
              <div className="skill-market-detail-meta">
                <span>{item.category.name}</span>
                <span>{item.subcategory}</span>
                <span>
                  <Users size={13} aria-hidden="true" />
                  {formatUsers(item.users)}
                </span>
                {item.status === 'installed_unknown_version' ? <span>版本未知</span> : null}
              </div>
              <h2 id="skill-market-detail-title">{item.title}</h2>
              <p>{item.entry.summary || item.entry.tagline}</p>
              <div className="skill-market-detail-author">
                <SkillAuthorAvatar
                  name={item.entry.creator.name}
                  size="large"
                  src={item.entry.creator.avatarUrl}
                />
                <span>{item.entry.creator.name}</span>
              </div>
            </div>
          </header>

          <div className="skill-market-detail-grid">
            <DetailSection icon={<Sparkles size={16} />} title="适合做什么" items={item.entry.tasks} />
            <DetailSection icon={<FileText size={16} />} title="需要输入" items={item.entry.inputs} />
            <DetailSection icon={<CheckCircle2 size={16} />} title="会产出" items={item.entry.outputs} />
            <DetailSection
              icon={<ShieldAlert size={16} />}
              title="使用前注意"
              items={riskNotes}
            />
          </div>

          <section className="skill-market-detail-section">
            <h3>精选案例</h3>
            {item.entry.examples.length > 0 ? (
              <div className="skill-market-case-list">
                {item.entry.examples.slice(0, 3).map((example) => (
                  <article key={`${example.title}-${example.url}`} className="skill-market-case">
                    <span>{example.type === 'video' ? '视频案例' : '图片案例'}</span>
                    <strong>{example.title}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <p className="skill-market-muted">暂无精选案例，仍可根据说明评估输入与产出。</p>
            )}
          </section>

          {item.operationError ? (
            <p className="skill-market-inline-error" role="alert">
              {item.operationError}
            </p>
          ) : null}
          {useError ? (
            <p className="skill-market-inline-error" role="alert">
              使用失败：{useError}
            </p>
          ) : null}
        </div>

        <footer className="skill-market-modal__footer">
          {action.reason ? (
            <span className="skill-market-action-hint" id={actionReasonId}>{action.reason}</span>
          ) : !connected ? (
            <span className="skill-market-action-hint">需要连接 Runtime 后才能安装、更新或使用。</span>
          ) : null}
          <button
            aria-describedby={actionReasonId}
            className="skill-market-action-button"
            disabled={action.disabled}
            onClick={() => handleAction(action, item.id, onInstall, onUpdate, onUse)}
            title={action.reason}
            type="button"
          >
            {getActionIcon(action.kind)}
            <span>{action.label}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function DetailSection({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: readonly string[];
}) {
  return (
    <section className="skill-market-detail-section">
      <h3>
        {icon}
        {title}
      </h3>
      {items.length > 0 ? (
        <ul>
          {items.slice(0, 6).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="skill-market-muted">暂无明确说明。</p>
      )}
    </section>
  );
}

function getRiskNotes(item: SkillMarketViewEntry): string[] {
  const notes = [...item.entry.risks.notes];
  if (item.entry.risks.requiresLogin) notes.unshift('需要登录第三方平台。');
  if (item.entry.risks.requiresApiKey) notes.unshift('需要配置 API Key。');
  if (item.entry.risks.externalWrite) notes.unshift('可能写入外部平台。');
  if (item.entry.risks.readsLocalFiles) notes.unshift('会读取本地文件，请确认资料范围。');
  if (item.entry.risks.privateDataRisk) notes.unshift('涉及私密资料时需先脱敏。');
  return notes.length > 0 ? notes : ['使用前确认输入资料、版权和发布平台要求。'];
}

function handleAction(
  action: SkillMarketAction,
  skillId: string,
  onInstall: (skillId: string) => void,
  onUpdate: (skillId: string) => void,
  onUse: (skillId: string) => void
) {
  if (action.disabled) return;
  if (action.kind === 'install') onInstall(skillId);
  if (action.kind === 'update') onUpdate(skillId);
  if (action.kind === 'use') onUse(skillId);
}

function getActionIcon(kind: SkillMarketAction['kind']) {
  if (kind === 'update') return <RefreshCw size={15} aria-hidden="true" />;
  if (kind === 'use') return <CheckCircle2 size={15} aria-hidden="true" />;
  return <Download size={15} aria-hidden="true" />;
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute('disabled'));
}

let scrollLockDepth = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (scrollLockDepth === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockDepth += 1;
}

function unlockBodyScroll() {
  scrollLockDepth = Math.max(0, scrollLockDepth - 1);
  if (scrollLockDepth === 0) {
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = '';
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
