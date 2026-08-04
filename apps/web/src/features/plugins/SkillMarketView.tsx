import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
} from '@clawee/protocol';
import { skillMarketCatalog, type SkillMarketEntry } from '@clawee/skill-market';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterAndSortSkillMarketEntries,
  paginateSkillMarketEntries,
  skillMarketInitialVisibleCount,
  skillMarketLoadMoreCount,
  type SkillMarketFilterStatus,
  type SkillMarketViewEntry,
} from './skill-market-model.js';
import {
  getSkillMarketAction,
  SkillMarketCard,
} from './SkillMarketCard.js';
import { SkillDetailModal } from './SkillDetailModal.js';
import {
  SkillUseProjectDialog,
  type SkillMarketProjectOption,
} from './SkillUseProjectDialog.js';
import './skill-market.css';

export type SkillMarketOperation =
  | { skillId: string; kind: 'install' | 'update'; error?: string }
  | undefined;

export type SkillMarketUseError = {
  skillId: string;
  error: string;
};

export type SkillMarketViewProps = {
  connected: boolean;
  skills?: CodexSkillListResponse;
  installRecords?: CodexSkillMarketInstallRecordResponse[];
  loading: boolean;
  loadError?: string;
  operation?: SkillMarketOperation;
  useError?: SkillMarketUseError;
  projects: readonly SkillMarketProjectOption[];
  currentProjectId: string;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skillId: string, projectId: string): void;
};

type SkillMarketViewInternalProps = SkillMarketViewProps & {
  catalogOverride?: readonly SkillMarketEntry[];
};

export function SkillMarketView({
  connected,
  skills,
  installRecords,
  loading,
  loadError,
  operation,
  useError,
  projects,
  currentProjectId,
  onInstall,
  onUpdate,
  onUse,
  catalogOverride,
}: SkillMarketViewInternalProps) {
  const catalog = catalogOverride ?? skillMarketCatalog;
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SkillMarketFilterStatus>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<SkillMarketViewEntry | null>(null);
  const [pendingUseEntry, setPendingUseEntry] = useState<SkillMarketViewEntry | null>(null);
  const [visibleCount, setVisibleCount] = useState(skillMarketInitialVisibleCount);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const baseResult = useMemo(
    () =>
      filterAndSortSkillMarketEntries({
        entries: catalog,
        skills,
        records: installRecords,
        operation,
      }),
    [catalog, skills, installRecords, operation]
  );

  const filteredResult = useMemo(
    () =>
      filterAndSortSkillMarketEntries({
        entries: catalog,
        skills,
        records: installRecords,
        search: query,
        status,
        category,
        operation,
      }),
    [catalog, skills, installRecords, query, status, category, operation]
  );

  const activeSyncedEntry =
    activeEntry === null
      ? null
      : filteredResult.entries.find((entry) => entry.id === activeEntry.id) ??
        baseResult.entries.find((entry) => entry.id === activeEntry.id) ??
        activeEntry;
  const page = paginateSkillMarketEntries(filteredResult.entries, visibleCount);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!page.hasMore || target === null || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((current) =>
          Math.min(current + skillMarketLoadMoreCount, filteredResult.entries.length)
        );
      },
      { rootMargin: '0px 0px 320px 0px' }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredResult.entries.length, page.hasMore, page.visibleCount]);

  const installedCount = baseResult.entries.filter((entry) => entry.installed).length;
  const mutationLocked = operation !== undefined && operation.error === undefined;
  const skillsKnown = skills !== undefined;
  function openEntry(
    entry: SkillMarketViewEntry,
    trigger: HTMLElement,
    restoreFocus: boolean
  ) {
    restoreFocusRef.current = restoreFocus ? trigger : null;
    setActiveEntry(entry);
  }

  function closeEntry() {
    setActiveEntry(null);
    window.setTimeout(() => {
      restoreFocusRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = null;
    }, 0);
  }

  function requestUse(skillId: string) {
    const entry =
      filteredResult.entries.find((item) => item.id === skillId)
      ?? baseResult.entries.find((item) => item.id === skillId);
    if (entry === undefined) return;
    setActiveEntry(null);
    setPendingUseEntry(entry);
  }

  function resetVisibleCount() {
    setVisibleCount(skillMarketInitialVisibleCount);
  }

  return (
    <section className="skill-market" aria-label="Skill 功能目录">
      <header className="skill-market-heading">
        <div className="skill-market__toolbar">
          <label className="skill-market-search">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="搜索 Skill"
              onChange={(event) => {
                setQuery(event.target.value);
                resetVisibleCount();
              }}
              placeholder="搜索技能"
              type="search"
              value={query}
            />
          </label>

        </div>
      </header>

      <div className="skill-market-navigation">
        <div className="skill-market-category-line">
          <div
            className="skill-market-filter-row skill-market-filter-row--categories"
            aria-label="分类"
            role="group"
          >
            <button
              aria-pressed={status === 'installed'}
              className={status === 'installed' ? 'is-active' : ''}
              onClick={() => {
                setStatus('installed');
                setCategory(null);
                resetVisibleCount();
              }}
              type="button"
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>已安装</span>
              <b>{installedCount}</b>
            </button>
            <button
              aria-pressed={category === null && status === 'all'}
              className={category === null && status === 'all' ? 'is-active' : ''}
              onClick={() => {
                setStatus('all');
                setCategory(null);
                resetVisibleCount();
              }}
              type="button"
            >
              <span>全部</span>
              <b>{baseResult.entries.length}</b>
            </button>
            {baseResult.categories.map((item) => (
              <button
                aria-pressed={category === item.id}
                className={category === item.id ? 'is-active' : ''}
                key={item.id}
                onClick={() => {
                  setStatus('all');
                  setCategory(item.id);
                  resetVisibleCount();
                }}
                type="button"
              >
                <span>{item.name}</span>
                <b>{item.count}</b>
              </button>
            ))}
          </div>

        </div>

      </div>

      {!connected ? (
        <p className="skill-market-banner" role="status">
          Runtime 未连接，目录可浏览，安装、更新和使用需连接后操作。
        </p>
      ) : null}
      {loading ? (
        <p className="skill-market-banner" role="status">
          <Loader2 size={18} aria-hidden="true" />
          正在加载 Skills 目录
        </p>
      ) : null}
      {loadError ? (
        <p className="skill-market-inline-error skill-market-page-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          {loadError}
        </p>
      ) : null}
      {useError ? (
        <p className="skill-market-inline-error skill-market-page-error" role="status">
          使用失败：{useError.error}
        </p>
      ) : null}
      {catalog.length === 0 ? (
        <StateMessage text="目录暂时为空" />
      ) : filteredResult.entries.length === 0 ? (
        <StateMessage text={query.trim().length > 0 ? '没有找到匹配的 Skill' : '当前筛选没有可显示的 Skill'} />
      ) : (
        <div className="skill-market-grid">
          {page.entries.map((item) => (
            <SkillMarketCard
              action={getSkillMarketAction(item.status, connected, {
                mutationLocked,
                skillsKnown,
              })}
              item={item}
              key={item.id}
              onInstall={onInstall}
              onOpen={(trigger, restoreFocus) => openEntry(item, trigger, restoreFocus)}
              onUpdate={onUpdate}
              onUse={requestUse}
            />
          ))}
        </div>
      )}

      {filteredResult.entries.length > 0 ? (
        <div className="skill-market-pagination" aria-live="polite">
          <span>已显示 {page.visibleCount} / {page.totalCount}</span>
          {page.hasMore ? (
            <div
              aria-hidden="true"
              className="skill-market-scroll-sentinel"
              data-testid="skill-market-scroll-sentinel"
              ref={loadMoreRef}
            />
          ) : null}
        </div>
      ) : null}

      {activeSyncedEntry ? (
        <SkillDetailModal
          connected={connected}
          item={activeSyncedEntry}
          mutationLocked={mutationLocked}
          onClose={closeEntry}
          onInstall={onInstall}
          onUpdate={onUpdate}
          onUse={requestUse}
          skillsKnown={skillsKnown}
          useError={
            useError?.skillId === activeSyncedEntry.id ? useError.error : undefined
          }
        />
      ) : null}

      {pendingUseEntry ? (
        <SkillUseProjectDialog
          currentProjectId={currentProjectId}
          onClose={() => setPendingUseEntry(null)}
          onConfirm={(projectId) => {
            const skillId = pendingUseEntry.id;
            setPendingUseEntry(null);
            onUse(skillId, projectId);
          }}
          projects={projects}
          skillTitle={pendingUseEntry.title}
        />
      ) : null}
    </section>
  );
}

function StateMessage({ text }: { text: string }) {
  return (
    <div className="skill-market-state" role="status">
      <span>{text}</span>
    </div>
  );
}
