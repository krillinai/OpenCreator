import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
} from '@clawee/protocol';
import { skillMarketCatalog } from '@clawee/skill-market';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterAndSortSkillMarketEntries } from './skill-market-model.js';
import { savedSkillIdsStorageKey } from './skill-market-storage.js';
import { SkillMarketView } from './SkillMarketView.js';

describe('SkillMarketView', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('渲染 55 条目录和分类计数', () => {
    renderSkillMarket();

    expect(screen.getByText('55 个 Skill')).toBeInTheDocument();
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(55);

    const videoCategory = skillMarketCatalog.filter(
      (entry) => entry.category === 'video-subtitle'
    ).length;
    expect(
      screen.getByRole('button', {
        name: new RegExp(`做视频与字幕\\s+${videoCategory}`),
      })
    ).toBeInTheDocument();
  });

  it('搜索“字幕”后只显示匹配卡片', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '字幕');

    const expectedIds = filterAndSortSkillMarketEntries({
      entries: skillMarketCatalog,
      skills: createSkillsResponse([]),
      records: [],
      search: '字幕',
    }).entries.map((entry) => entry.id);
    const visibleIds = screen
      .getAllByTestId('skill-market-card')
      .map((card) => card.getAttribute('data-skill-id'));

    expect(visibleIds).toEqual(expectedIds);
    expect(visibleIds.length).toBeGreaterThan(0);
  });

  it('点击卡片打开 role="dialog" 的详情弹窗', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.click(getSkillCard('frontend-slides'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();
    expect(screen.getByText('适合做什么')).toBeInTheDocument();
    expect(screen.getByText('需要输入')).toBeInTheDocument();
    expect(screen.getByText('会产出')).toBeInTheDocument();
    expect(screen.getByText('精选案例')).toBeInTheDocument();
    expect(screen.getByText('使用前注意')).toBeInTheDocument();
  });

  it('Escape 和关闭按钮关闭弹窗', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    const trigger = getSkillCard('frontend-slides');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '关闭详情' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('收藏后“我的收藏”计数更新并持久化', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    expect(screen.getByRole('button', { name: /我的收藏\s+0/ })).toBeInTheDocument();
    await user.click(
      within(getSkillCard('frontend-slides')).getByRole('button', {
        name: '收藏 网页演示稿生成',
      })
    );

    expect(screen.getByRole('button', { name: /我的收藏\s+1/ })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(savedSkillIdsStorageKey) ?? 'null')).toEqual([
      'frontend-slides',
    ]);
  });

  it('未安装不可安装条目显示禁用的“暂不可安装”', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'GStack');
    expect(screen.getByRole('button', { name: '暂不可安装' })).toBeDisabled();
  });

  it('外部安装同名有效 Skill 显示“使用”和“版本未知”', async () => {
    const user = userEvent.setup();
    renderSkillMarket({
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
      ]),
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const card = getSkillCard('frontend-slides');

    expect(within(card).getByText('版本未知')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '使用' })).toBeEnabled();
  });

  it('可安装未安装条目点击“安装”调用 onInstall(id)', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderSkillMarket({ onInstall });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(screen.getByRole('button', { name: '安装' }));

    expect(onInstall).toHaveBeenCalledWith('frontend-slides');
  });

  it('低修订号条目点击“更新”调用 onUpdate(id)', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderSkillMarket({
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
      ]),
      installRecords: [createRecord({ skillId: 'frontend-slides', marketRevision: 0 })],
      onUpdate,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(screen.getByRole('button', { name: '更新' }));

    expect(onUpdate).toHaveBeenCalledWith('frontend-slides');
  });

  it('已安装条目点击“使用”调用 onUse(id)', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    renderSkillMarket({
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
      ]),
      installRecords: [createRecord({ skillId: 'frontend-slides', marketRevision: 1 })],
      onUse,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(screen.getByRole('button', { name: '使用' }));

    expect(onUse).toHaveBeenCalledWith('frontend-slides');
  });

  it('Runtime 未连接时仍展示目录，但变更按钮禁用并显示连接提示', async () => {
    const user = userEvent.setup();
    renderSkillMarket({ connected: false });

    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(55);
    expect(screen.getByText('Runtime 未连接，目录可浏览，安装、更新和使用需连接后操作。')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    expect(screen.getByRole('button', { name: '连接后安装' })).toBeDisabled();
  });

  it('operation error 和 useError 显示在对应卡片与详情中且按钮仍可重试', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const onUse = vi.fn();
    renderSkillMarket({
      operation: {
        skillId: 'frontend-slides',
        kind: 'install',
        error: '安装失败，请重试',
      },
      useError: '启动失败，请重试',
      onInstall,
      onUse,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const card = getSkillCard('frontend-slides');
    expect(within(card).getByText('安装失败，请重试')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '安装' }));
    expect(onInstall).toHaveBeenCalledWith('frontend-slides');

    await user.click(card);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('安装失败，请重试')).toBeInTheDocument();
    expect(within(dialog).getByText('启动失败，请重试')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '安装' }));
    expect(onInstall).toHaveBeenCalledTimes(2);
    expect(onUse).not.toHaveBeenCalled();
  });

  it('loading、loadError、empty 和 search-empty 都有清晰状态', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSkillMarket({ loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('正在加载 Skills 目录');

    rerender(<SkillMarketView {...createProps({ loadError: '目录加载失败' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('目录加载失败');

    rerender(<SkillMarketView {...createProps({ catalogOverride: [] })} />);
    expect(screen.getByRole('status')).toHaveTextContent('目录暂时为空');

    rerender(<SkillMarketView {...createProps()} />);
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'not-a-real-skill-query');
    expect(screen.getByRole('status')).toHaveTextContent('没有找到匹配的 Skill');
  });
});

type RenderOverrides = Partial<Parameters<typeof createProps>[0]>;

function renderSkillMarket(overrides: RenderOverrides = {}) {
  return render(<SkillMarketView {...createProps(overrides)} />);
}

function createProps({
  connected = true,
  skills = createSkillsResponse([]),
  installRecords = [],
  loading = false,
  loadError,
  operation,
  useError,
  onInstall = vi.fn(),
  onUpdate = vi.fn(),
  onUse = vi.fn(),
  catalogOverride,
}: {
  connected?: boolean;
  skills?: CodexSkillListResponse;
  installRecords?: CodexSkillMarketInstallRecordResponse[];
  loading?: boolean;
  loadError?: string;
  operation?: { skillId: string; kind: 'install' | 'update'; error?: string };
  useError?: string;
  onInstall?: (skillId: string) => void;
  onUpdate?: (skillId: string) => void;
  onUse?: (skillId: string) => void;
  catalogOverride?: typeof skillMarketCatalog;
} = {}) {
  return {
    connected,
    skills,
    installRecords,
    loading,
    loadError,
    operation,
    useError,
    onInstall,
    onUpdate,
    onUse,
    catalogOverride,
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

function getSkillCard(skillId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`[data-skill-id="${skillId}"]`);
  expect(card).not.toBeNull();
  return card!;
}
