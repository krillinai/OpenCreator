import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
} from '@clawee/protocol';
import { skillMarketCatalog, type SkillMarketEntry } from '@clawee/skill-market';
import {
  AlertCircle,
  ArrowDownUp,
  CheckCircle2,
  Loader2,
  Plug,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterAndSortSkillMarketEntries,
  paginateSkillMarketEntries,
  skillMarketInitialVisibleCount,
  skillMarketLoadMoreCount,
  type SkillMarketFilterStatus,
  type SkillMarketSort,
  type SkillMarketViewEntry,
} from './skill-market-model.js';
import { readSavedSkillIds, writeSavedSkillIds } from './skill-market-storage.js';
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
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SkillMarketSort>('recommended');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savedWriteError, setSavedWriteError] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<SkillMarketViewEntry | null>(null);
  const [pendingUseEntry, setPendingUseEntry] = useState<SkillMarketViewEntry | null>(null);
  const [visibleCount, setVisibleCount] = useState(skillMarketInitialVisibleCount);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSavedIds(readSavedSkillIds());
  }, []);

  const baseResult = useMemo(
    () =>
      filterAndSortSkillMarketEntries({
        entries: catalog,
        skills,
        records: installRecords,
        savedSkillIds: savedIds,
        operation,
      }),
    [catalog, skills, installRecords, savedIds, operation]
  );

  const filteredResult = useMemo(
    () =>
      filterAndSortSkillMarketEntries({
        entries: catalog,
        skills,
        records: installRecords,
        savedSkillIds: savedIds,
        search: query,
        status,
        category,
        subcategory,
        sort,
        operation,
      }),
    [catalog, skills, installRecords, savedIds, query, status, category, subcategory, sort, operation]
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
  const currentSubcategories = filteredResult.subcategories;
  const mutationLocked = operation !== undefined && operation.error === undefined;
  const skillsKnown = skills !== undefined;
  const hasActiveControls =
    query.trim().length > 0 ||
    status !== 'all' ||
    category !== null ||
    subcategory !== null ||
    sort !== 'recommended';

  function resetFilters() {
    setQuery('');
    setStatus('all');
    setCategory(null);
    setSubcategory(null);
    setSort('recommended');
    resetVisibleCount();
  }

  function toggleSaved(skillId: string) {
    const next = savedIds.includes(skillId)
      ? savedIds.filter((id) => id !== skillId)
      : [...savedIds, skillId];

    try {
      writeSavedSkillIds(next);
      setSavedIds(next);
      setSavedWriteError(null);
    } catch {
      setSavedWriteError('收藏保存失败，请检查浏览器存储权限');
    }
  }

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
        <div className="skill-market-heading__title">
          <h1>
            <Plug size={20} aria-hidden="true" />
            <span>插件</span>
          </h1>
          <span>{baseResult.entries.length} 个 Skill</span>
        </div>

        <div className="skill-market__toolbar">
          <label className="skill-market-search">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="搜索 Skill"
              onChange={(event) => {
                setQuery(event.target.value);
                resetVisibleCount();
              }}
              placeholder="搜索：字幕、封面、SEO、B站发布..."
              type="search"
              value={query}
            />
          </label>

          <label className="skill-market-sort">
            <ArrowDownUp size={15} aria-hidden="true" />
            <span>排序</span>
            <select
              aria-label="排序"
              onChange={(event) => {
                setSort(event.target.value as SkillMarketSort);
                resetVisibleCount();
              }}
              value={sort}
            >
              <option value="recommended">推荐优先</option>
              <option value="users">使用人数</option>
              <option value="installed">已安装优先</option>
              <option value="saved">已收藏优先</option>
            </select>
          </label>

          {hasActiveControls ? (
            <button
              aria-label="重置筛选"
              className="skill-market-reset-button"
              onClick={resetFilters}
              title="重置筛选"
              type="button"
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          ) : null}
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
              aria-pressed={category === null}
              className={category === null ? 'is-active' : ''}
              onClick={() => {
                setCategory(null);
                setSubcategory(null);
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
                  setCategory(item.id);
                  setSubcategory(null);
                  resetVisibleCount();
                }}
                type="button"
              >
                <span>{item.name}</span>
                <b>{item.count}</b>
              </button>
            ))}
          </div>

          <div className="skill-market-status-controls" aria-label="目录状态" role="group">
            <button
              aria-pressed={status === 'installed'}
              className={status === 'installed' ? 'is-active' : ''}
              onClick={() => {
                setStatus(status === 'installed' ? 'all' : 'installed');
                resetVisibleCount();
              }}
              type="button"
            >
              <CheckCircle2 size={14} aria-hidden="true" />
              <span>已安装</span>
              <b>{installedCount}</b>
            </button>
          </div>
        </div>

        {category !== null ? (
          <div
            className="skill-market-filter-row skill-market-filter-row--scenes"
            aria-label="场景"
            role="group"
          >
            <button
              aria-pressed={subcategory === null}
              className={subcategory === null ? 'is-active' : ''}
              onClick={() => {
                setSubcategory(null);
                resetVisibleCount();
              }}
              type="button"
            >
              <span>全部场景</span>
            </button>
            {currentSubcategories.map((item) => (
              <button
                aria-pressed={subcategory === item.id}
                className={subcategory === item.id ? 'is-active' : ''}
                key={item.id}
                onClick={() => {
                  setSubcategory(item.id);
                  resetVisibleCount();
                }}
                type="button"
              >
                <span>{item.label}</span>
                <b>{item.count}</b>
              </button>
            ))}
          </div>
        ) : null}
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
      {savedWriteError ? (
        <p className="skill-market-inline-error skill-market-page-error" role="alert">
          {savedWriteError}
        </p>
      ) : null}

      <div className="skill-market-summary">
        <strong>{filteredResult.entries.length} 个 Skill</strong>
        <span>
          {query.trim().length > 0
            ? `搜索 “${query.trim()}”`
            : hasActiveControls
              ? `已从 ${baseResult.entries.length} 个条目中筛选`
              : '全部目录'}
        </span>
      </div>

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
          onToggleSaved={toggleSaved}
          onUpdate={onUpdate}
          onUse={requestUse}
          saved={activeSyncedEntry.saved}
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
