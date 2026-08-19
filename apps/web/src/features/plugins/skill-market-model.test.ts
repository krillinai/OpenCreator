import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
} from '@opencreator/protocol';
import type { SkillMarketEntry } from '@opencreator/skill-market';
import { describe, expect, it } from 'vitest';
import {
  filterAndSortSkillMarketEntries,
  paginateSkillMarketEntries,
  resolveSkillMarketStatus,
} from './skill-market-model.js';

describe('skill market model', () => {
  it('paginates a stable prefix and reports whether more entries remain', () => {
    const result = filterAndSortSkillMarketEntries({
      entries: [
        createEntry({ id: 'skill-a', title: 'A' }),
        createEntry({ id: 'skill-b', title: 'B' }),
        createEntry({ id: 'skill-c', title: 'C' }),
      ],
      skills: createSkillsResponse([]),
      records: [],
    });

    const firstPage = paginateSkillMarketEntries(result.entries, 2);
    expect(firstPage.entries.map(entry => entry.id)).toEqual(
      result.entries.slice(0, 2).map(entry => entry.id)
    );
    expect(firstPage.visibleCount).toBe(2);
    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.hasMore).toBe(true);

    expect(paginateSkillMarketEntries(result.entries, 20)).toMatchObject({
      visibleCount: 3,
      totalCount: 3,
      hasMore: false,
    });
    expect(paginateSkillMarketEntries(result.entries, Number.NaN)).toMatchObject({
      visibleCount: 0,
      totalCount: 3,
      hasMore: true,
    });
  });

  it('resolves every absent catalog skill as installable', () => {
    expect(
      resolveSkillMarketStatus(
        createEntry(),
        createSkillsResponse([]),
        []
      )
    ).toBe('not_installed');
  });

  it('treats a valid local skill as installed even without a market record', () => {
    expect(
      resolveSkillMarketStatus(
        createEntry(),
        createSkillsResponse([createSkill({ id: 'frontend-slides', status: 'valid' })]),
        []
      )
    ).toBe('installed_unknown_version');
  });

  it('does not treat invalid installed skills as available', () => {
    expect(
      resolveSkillMarketStatus(
        createEntry(),
        createSkillsResponse([createSkill({ id: 'frontend-slides', status: 'invalid' })]),
        []
      )
    ).toBe('invalid');
  });

  it('marks update available when the installed market revision is behind', () => {
    expect(
      resolveSkillMarketStatus(
        createEntry({ install: createInstallSource(3) }),
        createSkillsResponse([createSkill({ id: 'frontend-slides', status: 'valid' })]),
        [createRecord({ marketRevision: 2 })]
      )
    ).toBe('update_available');
  });

  it('marks installed when the installed market revision matches the catalog revision', () => {
    expect(
      resolveSkillMarketStatus(
        createEntry({ install: createInstallSource(3) }),
        createSkillsResponse([createSkill({ id: 'frontend-slides', status: 'valid' })]),
        [createRecord({ marketRevision: 3 })]
      )
    ).toBe('installed');
  });

  it('lets install and update mutations override only the matching skill', () => {
    const entries = [
      createEntry({ id: 'frontend-slides' }),
      createEntry({ id: 'guizang-social-card-skill', name: 'guizang-social-card-skill' }),
    ] as const;
    const skills = createSkillsResponse([
      createSkill({ id: 'frontend-slides', status: 'valid' }),
      createSkill({ id: 'guizang-social-card-skill', status: 'valid' }),
    ]);
    const records = [
      createRecord({ skillId: 'frontend-slides', marketRevision: 1 }),
      createRecord({ skillId: 'guizang-social-card-skill', marketRevision: 1 }),
    ];

    expect(
      resolveSkillMarketStatus(entries[0], skills, records, {
        skillId: 'frontend-slides',
        kind: 'install',
      })
    ).toBe('installing');
    expect(
      resolveSkillMarketStatus(entries[1], skills, records, {
        skillId: 'frontend-slides',
        kind: 'install',
      })
    ).toBe('installed');
    expect(
      resolveSkillMarketStatus(entries[1], skills, records, {
        skillId: 'guizang-social-card-skill',
        kind: 'update',
      })
    ).toBe('updating');
  });

  it('keeps not installed status and exposes install error when install fails', () => {
    const result = filterAndSortSkillMarketEntries({
      entries: [createEntry()],
      skills: createSkillsResponse([]),
      records: [],
      operation: {
        skillId: 'frontend-slides',
        kind: 'install',
        error: 'install failed',
      },
    });

    expect(result.entries[0]?.status).toBe('not_installed');
    expect(result.entries[0]?.operationKind).toBe('install');
    expect(result.entries[0]?.operationError).toBe('install failed');
  });

  it('keeps update available status and exposes update error when update fails', () => {
    const result = filterAndSortSkillMarketEntries({
      entries: [createEntry({ install: createInstallSource(3) })],
      skills: createSkillsResponse([createSkill({ id: 'frontend-slides', status: 'valid' })]),
      records: [createRecord({ marketRevision: 2 })],
      operation: {
        skillId: 'frontend-slides',
        kind: 'update',
        error: 'update failed',
      },
    });

    expect(result.entries[0]?.status).toBe('update_available');
    expect(result.entries[0]?.operationKind).toBe('update');
    expect(result.entries[0]?.operationError).toBe('update failed');
  });

  it('does not let another skill operation error contaminate external installed status', () => {
    const result = filterAndSortSkillMarketEntries({
      entries: [
        createEntry({ id: 'frontend-slides' }),
        createEntry({
          id: 'guizang-social-card-skill',
          name: 'guizang-social-card-skill',
        }),
      ],
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
      ]),
      records: [],
      operation: {
        skillId: 'guizang-social-card-skill',
        kind: 'install',
        error: 'other skill failed',
      },
    });

    const externalInstalled = result.entries.find((entry) => entry.id === 'frontend-slides');
    expect(externalInstalled?.status).toBe('installed_unknown_version');
    expect(externalInstalled?.operationError).toBeUndefined();
    expect(externalInstalled?.operationKind).toBeUndefined();
  });

  it('searches across chinese title, english name, summary, tasks, and platforms with normalized spaces', () => {
    const entry = createEntry({
      id: 'frontend-slides',
      name: 'frontend-slides',
      title: '网页演示稿生成',
      tagline: '把课件生成网页 slides',
      summary: '为课程和产品演示生成 HTML slides',
      tasks: ['课程课件', '产品演示'],
      platforms: ['Web', 'Claude Code'],
    });

    const byTitle = filterAndSortSkillMarketEntries({
      entries: [entry],
      skills: createSkillsResponse([]),
      records: [],
      search: '网页 演示稿',
    });
    const byName = filterAndSortSkillMarketEntries({
      entries: [entry],
      skills: createSkillsResponse([]),
      records: [],
      search: ' FRONTEND-SLIDES ',
    });
    const byTask = filterAndSortSkillMarketEntries({
      entries: [entry],
      skills: createSkillsResponse([]),
      records: [],
      search: '产品演示',
    });
    const byPlatform = filterAndSortSkillMarketEntries({
      entries: [entry],
      skills: createSkillsResponse([]),
      records: [],
      search: 'claude   code',
    });

    expect(byTitle.entries.map((item) => item.id)).toEqual(['frontend-slides']);
    expect(byName.entries.map((item) => item.id)).toEqual(['frontend-slides']);
    expect(byTask.entries.map((item) => item.id)).toEqual(['frontend-slides']);
    expect(byPlatform.entries.map((item) => item.id)).toEqual(['frontend-slides']);
  });

  it('includes externally installed skills in the installed filter', () => {
    const entry = createEntry();

    const result = filterAndSortSkillMarketEntries({
      entries: [entry],
      skills: createSkillsResponse([createSkill({ id: 'frontend-slides', status: 'valid' })]),
      records: [],
      status: 'installed',
    });

    expect(result.entries.map((item) => item.id)).toEqual(['frontend-slides']);
    expect(result.entries[0]?.status).toBe('installed_unknown_version');
  });

  it('excludes installing, invalid, and absent skills from the installed filter while keeping updating included', () => {
    const entries = [
      createEntry({ id: 'installing-entry', name: 'installing-entry', title: '安装中条目' }),
      createEntry({ id: 'invalid-entry', name: 'invalid-entry', title: '异常条目' }),
      createEntry({ id: 'updating-entry', name: 'updating-entry', title: '更新中条目' }),
      createEntry({ id: 'not-installed-entry', name: 'not-installed-entry', title: '未安装条目' }),
    ];

    const installingResult = filterAndSortSkillMarketEntries({
      entries,
      skills: createSkillsResponse([
        createSkill({ id: 'invalid-entry', status: 'invalid' }),
        createSkill({ id: 'updating-entry', status: 'valid' }),
      ]),
      records: [
        createRecord({ skillId: 'updating-entry', marketRevision: 1 }),
      ],
      operation: {
        skillId: 'installing-entry',
        kind: 'install',
      },
      status: 'installed',
    });

    expect(installingResult.entries.map((entry) => entry.id)).toEqual(['updating-entry']);
    expect(installingResult.entries[0]?.status).toBe('installed');
    expect(installingResult.entries[0]?.installed).toBe(true);

    const updatingResult = filterAndSortSkillMarketEntries({
      entries,
      skills: createSkillsResponse([
        createSkill({ id: 'invalid-entry', status: 'invalid' }),
        createSkill({ id: 'updating-entry', status: 'valid' }),
      ]),
      records: [
        createRecord({ skillId: 'updating-entry', marketRevision: 1 }),
      ],
      operation: {
        skillId: 'updating-entry',
        kind: 'update',
      },
      status: 'installed',
    });

    expect(updatingResult.entries.map((entry) => entry.id)).toEqual(['updating-entry']);
    expect(updatingResult.entries[0]?.status).toBe('updating');
    expect(updatingResult.entries[0]?.installed).toBe(true);
  });

  it('keeps recommended and installed sorts stable with explicit tie breakers', () => {
    const entries = [
      createEntry({
        id: 'b-entry',
        name: 'b-entry',
        title: 'B 条目',
        listingStatus: 'verified',
      }),
      createEntry({
        id: 'a-entry',
        name: 'a-entry',
        title: 'A 条目',
        listingStatus: 'verified',
      }),
    ];

    const baseInput = {
      entries,
      skills: createSkillsResponse([
        createSkill({ id: 'a-entry', status: 'valid' }),
        createSkill({ id: 'b-entry', status: 'valid' }),
      ]),
      records: [
        createRecord({ skillId: 'a-entry', marketRevision: 1 }),
        createRecord({ skillId: 'b-entry', marketRevision: 1 }),
      ],
    };

    expect(
      filterAndSortSkillMarketEntries({ ...baseInput, sort: 'recommended' }).entries.map((item) => item.id)
    ).toEqual(['a-entry', 'b-entry']);
    expect(
      filterAndSortSkillMarketEntries({ ...baseInput, sort: 'installed' }).entries.map((item) => item.id)
    ).toEqual(['a-entry', 'b-entry']);
  });
});

function createEntry(
  overrides: Partial<SkillMarketEntry> = {}
): SkillMarketEntry {
  return {
    id: 'frontend-slides',
    name: 'frontend-slides',
    title: '网页演示稿生成',
    githubRepository: 'zarazhangrui/frontend-slides',
    tagline: '把演示稿生成网页',
    summary: '生成可以浏览的 HTML 幻灯片。',
    category: 'content-planning',
    subcategory: '网页幻灯片',
    platforms: ['Web'],
    tasks: ['课程课件'],
    creator: {
      name: 'OpenCreator',
      avatarUrl: 'https://example.com/avatar.png',
    },
    examples: [],
    inputs: [],
    outputs: [],
    risks: {
      requiresLogin: false,
      requiresApiKey: false,
      externalWrite: false,
      readsLocalFiles: false,
      privateDataRisk: false,
      notes: [],
    },
    listingStatus: 'featured',
    install: createInstallSource(1),
    ...overrides,
  };
}

function createInstallSource(marketRevision: number): SkillMarketEntry['install'] {
  return {
    repository: 'zarazhangrui/frontend-slides',
    skillPath: '.',
    ref: 'main',
    marketRevision,
  };
}

function createSkill(
  overrides: Partial<CodexSkillResponse> & Pick<CodexSkillResponse, 'id' | 'status'>
): CodexSkillResponse {
  return {
    name: overrides.id,
    description: overrides.id,
    id: overrides.id,
    status: overrides.status,
    diagnostics: [],
    codexHome: '/tmp/codex',
    codexHomeMode: 'global',
    skillsPath: '/tmp/codex/skills',
    skillPath: `/tmp/codex/skills/${overrides.id}`,
    skillFilePath: `/tmp/codex/skills/${overrides.id}/SKILL.md`,
    updatedAt: overrides.updatedAt,
  };
}

function createSkillsResponse(skills: CodexSkillResponse[]): CodexSkillListResponse {
  return {
    codexHome: '/tmp/codex',
    codexHomeMode: 'global',
    skillsPath: '/tmp/codex/skills',
    skillsWritable: true,
    requiresWriteConfirmation: false,
    skills,
    diagnostics: [],
  };
}

function createRecord(
  overrides: Partial<CodexSkillMarketInstallRecordResponse> = {}
): CodexSkillMarketInstallRecordResponse {
  return {
    skillId: 'frontend-slides',
    repository: 'zarazhangrui/frontend-slides',
    skillPath: '.',
    commit: 'commit',
    marketRevision: 1,
    installedAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}
