import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SkillMarketViewEntry } from './skill-market-model.js';
import {
  getSkillMarketAction,
  type SkillMarketAction,
} from './SkillMarketCard.js';
import {
  normalizeSkillMarketAssetUrl,
  SkillAuthorAvatar,
} from './SkillMarketCover.js';

const exampleFallback = '/skill-market/skills-empty.png';

export function SkillDetailModal({
  item,
  connected,
  mutationLocked,
  skillsKnown,
  useError,
  onClose,
  onInstall,
  onUpdate,
  onUse,
}: {
  item: SkillMarketViewEntry;
  connected: boolean;
  mutationLocked?: boolean;
  skillsKnown: boolean;
  useError?: string;
  onClose(): void;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skillId: string): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previewOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [previewExample, setPreviewExample] = useState<
    SkillMarketViewEntry['entry']['examples'][number] | undefined
  >();
  const action = getSkillMarketAction(item.status, connected, {
    mutationLocked,
    skillsKnown,
  });
  const actionReasonId = action.reason ? `skill-market-modal-action-reason-${sanitizeId(item.id)}` : undefined;
  const riskNotes = getRiskNotes(item);
  const detailTags = getDetailTags(item);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previewOpenRef.current = previewExample !== undefined;
  }, [previewExample]);

  useEffect(() => {
    lockBodyScroll();
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (previewOpenRef.current) {
          closePreview();
          return;
        }
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

  function closePreview() {
    setPreviewExample(undefined);
    window.setTimeout(() => previewTriggerRef.current?.focus(), 0);
  }

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
        data-preview-open={previewExample === undefined ? 'false' : 'true'}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header
          aria-hidden={previewExample === undefined ? undefined : true}
          className="skill-market-detail-head"
        >
          <div className="skill-market-detail-head__identity">
            <SkillAuthorAvatar
              name={item.entry.creator.name}
              size="large"
              src={item.entry.creator.avatarUrl}
            />
            <div className="skill-market-detail-head__content">
              <h2 id="skill-market-detail-title">{item.title}</h2>
              <div className="skill-market-detail-meta">
                <span className="skill-market-detail-author">{item.entry.creator.name}</span>
              </div>
            </div>
          </div>
          <button
            aria-label="关闭详情"
            className="skill-market-detail-head__close"
            onClick={onClose}
            title="关闭详情"
            type="button"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div
          aria-hidden={previewExample === undefined ? undefined : true}
          className="skill-market-modal__body"
        >
          <div className="skill-market-detail-layout">
            <section className="skill-market-detail-block skill-market-detail-description">
              <p>{item.entry.summary || item.entry.tagline}</p>
              {detailTags.length > 0 ? (
                <div className="skill-market-detail-chip-list" aria-label="适合场景">
                  {detailTags.map((task) => (
                    <span key={task}>{task}</span>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="skill-market-detail-block skill-market-detail-workflow-section">
              <h3 className="skill-market-visually-hidden">输入与产出</h3>
              <div className="skill-market-detail-workflow">
                <DetailList title="输入" items={item.entry.inputs} />
                <DetailList title="产出" items={item.entry.outputs} />
              </div>
            </section>

            <section className="skill-market-detail-block skill-market-detail-examples">
              <h3>精选案例</h3>
              {item.entry.examples.length > 0 ? (
                <div
                  className={`skill-market-case-list ${item.entry.examples.length > 3 ? 'skill-market-case-list--scrollable' : ''}`}
                >
                  {item.entry.examples.map((example) => (
                    <article key={`${example.title}-${example.url}`} className="skill-market-case">
                      <button
                        aria-label={`预览 ${example.title}`}
                        className="skill-market-case__preview"
                        onClick={(event) => {
                          previewTriggerRef.current = event.currentTarget;
                          setPreviewExample(example);
                        }}
                        type="button"
                      >
                        <SkillExampleMedia example={example} />
                        <span className="skill-market-case__caption">
                          <strong>{example.title}</strong>
                        </span>
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="skill-market-muted">GitHub 仓库暂未提供可用案例图。</p>
              )}
            </section>

            <section className="skill-market-detail-risk">
              <h3>
                <ShieldAlert size={16} aria-hidden="true" />
                使用前注意
              </h3>
              <DetailItems items={riskNotes} />
            </section>
          </div>

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

        <footer
          aria-hidden={previewExample === undefined ? undefined : true}
          className="skill-market-modal__footer"
        >
          <span className="skill-market-action-hint" id={actionReasonId}>
            {action.reason || (!connected ? '需要连接 Runtime 后才能安装、更新或使用。' : '')}
          </span>
          <div className="skill-market-modal__actions">
            <button
              aria-describedby={actionReasonId}
              className={`skill-market-action-button skill-market-modal__primary skill-market-action-button--${action.kind}`}
              disabled={action.disabled}
              onClick={() => handleAction(action, item.id, onInstall, onUpdate, onUse)}
              title={action.reason}
              type="button"
            >
              {getActionIcon(action.kind)}
              <span>{action.label}</span>
            </button>
          </div>
        </footer>

        {previewExample ? (
          <SkillExamplePreview example={previewExample} onClose={closePreview} />
        ) : null}
      </section>
    </div>
  );
}

function SkillExampleMedia({
  example,
  preview = false,
}: {
  example: SkillMarketViewEntry['entry']['examples'][number];
  preview?: boolean;
}) {
  const source = normalizeSkillMarketAssetUrl(example.url);
  const [failed, setFailed] = useState(source === undefined);

  if (example.type === 'video' && !failed && source !== undefined) {
    return (
      <video
        aria-label={example.title}
        className={`skill-market-case__media ${preview ? 'skill-market-case__media--preview' : ''}`}
        controls={preview}
        muted
        onError={() => setFailed(true)}
        playsInline
        preload="metadata"
        src={source}
      />
    );
  }

  return (
    <img
      alt={failed ? `${example.title}案例图暂不可用` : example.title}
      className={`skill-market-case__media ${preview ? 'skill-market-case__media--preview' : ''}`}
      decoding="async"
      loading={preview ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      src={failed || source === undefined ? exampleFallback : source}
    />
  );
}

function SkillExamplePreview({
  example,
  onClose,
}: {
  example: SkillMarketViewEntry['entry']['examples'][number];
  onClose(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const source = normalizeSkillMarketAssetUrl(example.url);

  useEffect(() => {
    closeRef.current?.focus();
  }, [example.url]);

  return (
    <div
      className="skill-market-example-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={`预览 ${example.title}`}
        aria-modal="true"
        className="skill-market-example-preview"
        role="dialog"
      >
        <header className="skill-market-example-preview__header">
          <strong>{example.title}</strong>
          <div className="skill-market-example-preview__actions">
            {source ? (
              <a href={source} rel="noreferrer" target="_blank">
                <ExternalLink size={14} aria-hidden="true" />
                <span>查看 GitHub 原图</span>
              </a>
            ) : null}
            <button
              aria-label="关闭图片预览"
              onClick={onClose}
              ref={closeRef}
              title="关闭图片预览"
              type="button"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="skill-market-example-preview__media">
          <SkillExampleMedia example={example} preview />
        </div>
      </section>
    </div>
  );
}

function DetailList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  return (
    <div className="skill-market-detail-list">
      <h4>{title}</h4>
      {items.length > 0 ? (
        <div className="skill-market-detail-list__items">
          {items.slice(0, 6).map((item) => <span key={item}>{item}</span>)}
        </div>
      ) : (
        <p className="skill-market-muted">暂无明确说明。</p>
      )}
    </div>
  );
}

function DetailItems({ items }: { items: readonly string[] }) {
  if (items.length === 0) return <p className="skill-market-muted">暂无明确说明。</p>;
  return (
    <ul>
      {items.slice(0, 6).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
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

function getDetailTags(item: SkillMarketViewEntry): string[] {
  return Array.from(new Set([item.category.name, ...item.entry.tasks])).slice(0, 5);
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
  ).filter((element) => (
    !element.hasAttribute('disabled')
    && element.closest('[aria-hidden="true"]') === null
  ));
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
