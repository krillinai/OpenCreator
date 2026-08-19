import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
} from '@opencreator/protocol';
import {
  skillMarketCategories,
  type SkillMarketCategory,
  type SkillMarketEntry,
} from '@opencreator/skill-market';

export type SkillMarketStatus =
  | 'not_installed'
  | 'invalid'
  | 'installed_unknown_version'
  | 'installed'
  | 'update_available'
  | 'installing'
  | 'updating';

export type SkillMarketOperation =
  | { skillId: string; kind: 'install' | 'update'; error?: string }
  | null
  | undefined;

export type SkillMarketSort = 'recommended' | 'installed';

export type SkillMarketFilterStatus = 'all' | 'installed';

export type SkillMarketCategorySummary = SkillMarketCategory & {
  count: number;
};

export type SkillMarketSubcategorySummary = {
  id: string;
  label: string;
  count: number;
};

export type SkillMarketViewEntry = {
  id: string;
  entry: SkillMarketEntry;
  title: string;
  category: SkillMarketCategory;
  subcategory: string;
  status: SkillMarketStatus;
  installed: boolean;
  operationError?: string;
  operationKind?: 'install' | 'update';
};

export type FilterAndSortSkillMarketEntriesInput = {
  entries: readonly SkillMarketEntry[];
  skills?: CodexSkillListResponse | readonly CodexSkillResponse[] | null;
  records?: readonly CodexSkillMarketInstallRecordResponse[] | null;
  search?: string | null;
  category?: string | null;
  subcategory?: string | null;
  status?: SkillMarketFilterStatus | null;
  sort?: SkillMarketSort | null;
  operation?: SkillMarketOperation;
};

export type SkillMarketFilterResult = {
  entries: SkillMarketViewEntry[];
  categories: SkillMarketCategorySummary[];
  subcategories: SkillMarketSubcategorySummary[];
};

export const skillMarketInitialVisibleCount = 12;
export const skillMarketLoadMoreCount = 12;

const categoryById = new Map(
  skillMarketCategories.map((category) => [category.id, category])
);

const listingStatusRank: Record<SkillMarketEntry['listingStatus'], number> = {
  featured: 0,
  verified: 1,
  'curated-exception': 2,
};

const titleOverrides: Partial<Record<string, string>> = {};

export function resolveSkillMarketStatus(
  entry: SkillMarketEntry,
  skills: CodexSkillListResponse | readonly CodexSkillResponse[] | null | undefined,
  records: readonly CodexSkillMarketInstallRecordResponse[] | null | undefined,
  operation?: SkillMarketOperation
): SkillMarketStatus {
  if (operation?.skillId === entry.id && operation.error === undefined) {
    return operation.kind === 'install' ? 'installing' : 'updating';
  }

  const skill = findSkillById(skills, entry.id);
  if (skill?.status === 'invalid') return 'invalid';

  if (skill?.status === 'valid') {
    const record = findRecordBySkillId(records, entry.id);
    if (record === undefined) return 'installed_unknown_version';
    return record.marketRevision < entry.install.marketRevision
      ? 'update_available'
      : 'installed';
  }

  return 'not_installed';
}

export function filterAndSortSkillMarketEntries(
  input: FilterAndSortSkillMarketEntriesInput
): SkillMarketFilterResult {
  const models = input.entries.map((entry, index) =>
    createViewEntry(entry, index, input.skills, input.records, input.operation)
  );

  const categories = summarizeCategories(models);

  const categoryFiltered = input.category
    ? models.filter((item) => item.entry.category === input.category)
    : models;
  const subcategories = summarizeSubcategories(categoryFiltered);

  const search = normalizeSearch(input.search);
  const status = input.status ?? 'all';
  const filtered = categoryFiltered.filter((item) => {
    if (input.subcategory && item.subcategory !== input.subcategory) return false;
    if (status === 'installed' && !isInstalledStatus(item.status)) return false;
    return matchesSearch(item.entry, item.title, search);
  });

  const sort = input.sort ?? 'recommended';
  filtered.sort((left, right) => compareEntries(left, right, sort));

  return {
    entries: filtered,
    categories,
    subcategories,
  };
}

export function paginateSkillMarketEntries(
  entries: readonly SkillMarketViewEntry[],
  requestedCount: number
): {
  entries: SkillMarketViewEntry[];
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
} {
  const normalizedCount = Number.isFinite(requestedCount)
    ? Math.max(Math.floor(requestedCount), 0)
    : 0;
  const visibleCount = Math.min(normalizedCount, entries.length);
  return {
    entries: entries.slice(0, visibleCount),
    visibleCount,
    totalCount: entries.length,
    hasMore: visibleCount < entries.length
  };
}

export function getSkillMarketDisplayTitle(entry: SkillMarketEntry): string {
  const override = titleOverrides[entry.id];
  if (override !== undefined && override.trim().length > 0) return override.trim();
  const title = entry.title.trim();
  return title.length > 0 ? title : entry.name.trim();
}

export function getSkillMarketCategory(entry: SkillMarketEntry): SkillMarketCategory {
  return (
    categoryById.get(entry.category) ?? {
      id: entry.category,
      name: entry.category,
      description: '',
    }
  );
}

export function getSkillMarketSubcategory(entry: SkillMarketEntry): string {
  const subcategory = entry.subcategory.trim();
  return subcategory.length > 0 ? subcategory : getSkillMarketCategory(entry).name;
}

function createViewEntry(
  entry: SkillMarketEntry,
  index: number,
  skills: CodexSkillListResponse | readonly CodexSkillResponse[] | null | undefined,
  records: readonly CodexSkillMarketInstallRecordResponse[] | null | undefined,
  operation?: SkillMarketOperation
): SkillMarketViewEntry & { originalIndex: number } {
  const status = resolveSkillMarketStatus(entry, skills, records, operation);
  const matchesOperation = operation?.skillId === entry.id;
  return {
    id: entry.id,
    entry,
    title: getSkillMarketDisplayTitle(entry),
    category: getSkillMarketCategory(entry),
    subcategory: getSkillMarketSubcategory(entry),
    status,
    installed: isInstalledStatus(status),
    operationError:
      matchesOperation && operation?.error !== undefined ? operation.error : undefined,
    operationKind: matchesOperation ? operation?.kind : undefined,
    originalIndex: index,
  };
}

function summarizeCategories(
  entries: Array<SkillMarketViewEntry & { originalIndex: number }>
): SkillMarketCategorySummary[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.category.id, (counts.get(entry.category.id) ?? 0) + 1);
  }

  return skillMarketCategories
    .filter((category) => counts.has(category.id))
    .map((category) => ({
      ...category,
      count: counts.get(category.id) ?? 0,
    }));
}

function summarizeSubcategories(
  entries: Array<SkillMarketViewEntry & { originalIndex: number }>
): SkillMarketSubcategorySummary[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.subcategory, (counts.get(entry.subcategory) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([label, count]) => ({
      id: label,
      label,
      count,
    }));
}

function compareEntries(
  left: SkillMarketViewEntry & { originalIndex: number },
  right: SkillMarketViewEntry & { originalIndex: number },
  sort: SkillMarketSort
): number {
  switch (sort) {
    case 'recommended':
      return (
        compareNumber(
          listingStatusRank[left.entry.listingStatus],
          listingStatusRank[right.entry.listingStatus]
        ) ||
        compareInstalledPriority(left.status, right.status) ||
        compareText(left.title, right.title) ||
        compareText(left.id, right.id) ||
        compareNumber(left.originalIndex, right.originalIndex)
      );
    case 'installed':
      return (
        compareBoolean(right.installed, left.installed) ||
        compareInstalledPriority(left.status, right.status) ||
        compareText(left.title, right.title) ||
        compareText(left.id, right.id) ||
        compareNumber(left.originalIndex, right.originalIndex)
      );
  }
}

function compareInstalledPriority(
  left: SkillMarketStatus,
  right: SkillMarketStatus
): number {
  return compareNumber(statusSortRank(left), statusSortRank(right));
}

function statusSortRank(status: SkillMarketStatus): number {
  switch (status) {
    case 'installing':
      return 0;
    case 'updating':
      return 1;
    case 'update_available':
      return 2;
    case 'installed':
      return 3;
    case 'installed_unknown_version':
      return 4;
    case 'invalid':
      return 5;
    case 'not_installed':
      return 6;
  }
}

function matchesSearch(
  entry: SkillMarketEntry,
  title: string,
  search: string[]
): boolean {
  if (search.length === 0) return true;
  const searchable = normalizeText(
    [
      title,
      entry.name,
      entry.tagline,
      entry.summary,
      ...entry.tasks,
      ...entry.platforms,
    ].join(' ')
  );
  return search.every((token) => searchable.includes(token));
}

function normalizeSearch(input: string | null | undefined): string[] {
  const normalized = normalizeText(input ?? '');
  return normalized.length === 0 ? [] : normalized.split(' ');
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function findSkillById(
  skills: CodexSkillListResponse | readonly CodexSkillResponse[] | null | undefined,
  skillId: string
): CodexSkillResponse | undefined {
  const items: readonly CodexSkillResponse[] =
    skills === null || skills === undefined
      ? []
      : Array.isArray(skills)
        ? skills
        : isSkillListResponse(skills)
          ? skills.skills
          : [];
  return items.find((skill) => skill.id === skillId);
}

function isSkillListResponse(
  skills: CodexSkillListResponse | readonly CodexSkillResponse[]
): skills is CodexSkillListResponse {
  return !Array.isArray(skills);
}

function findRecordBySkillId(
  records: readonly CodexSkillMarketInstallRecordResponse[] | null | undefined,
  skillId: string
): CodexSkillMarketInstallRecordResponse | undefined {
  return records?.find((record) => record.skillId === skillId);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN', {
    sensitivity: 'base',
  });
}

function compareBoolean(left: boolean, right: boolean): number {
  return compareNumber(Number(left), Number(right));
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function isInstalledStatus(status: SkillMarketStatus): boolean {
  return (
    status === 'installed_unknown_version' ||
    status === 'installed' ||
    status === 'update_available' ||
    status === 'updating'
  );
}
