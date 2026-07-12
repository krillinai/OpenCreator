import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
} from '@clawee/protocol';
import { skillMarketCatalog, type SkillMarketEntry } from '@clawee/skill-market';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterAndSortSkillMarketEntries } from './skill-market-model.js';
import { savedSkillIdsStorageKey } from './skill-market-storage.js';
import { normalizeSkillMarketAssetUrl } from './SkillMarketCover.js';
import { SkillMarketView } from './SkillMarketView.js';

describe('SkillMarketView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('首屏只渲染一批目录卡片，并可继续加载剩余结果', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    expect(screen.getByText('55 个 Skill')).toBeInTheDocument();
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);
    expect(screen.getByText('已显示 12 / 55')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '加载更多 Skill' }));

    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(24);
    expect(screen.getByText('已显示 24 / 55')).toBeInTheDocument();

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

    expect(visibleIds).toEqual(expectedIds.slice(0, 12));
    expect(visibleIds.length).toBeGreaterThan(0);
  });

  it('筛选变化后重置首屏批次，加载更多后收藏和安装状态仍保持正确', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderSkillMarket({ onInstall });

    await user.click(screen.getByRole('button', { name: '加载更多 Skill' }));
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(24);

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(1);

    const card = getSkillCard('frontend-slides');
    await user.click(within(card).getByRole('button', { name: '收藏 网页演示稿生成' }));
    expect(screen.getByRole('button', { name: /我的收藏\s+1/ })).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '安装' }));
    expect(onInstall).toHaveBeenCalledWith('frontend-slides');
  });

  it('点击卡片打开 role="dialog" 的详情弹窗', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.click(getSkillDetailButton('frontend-slides'));

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

    const trigger = getSkillDetailButton('frontend-slides');
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

  it('Shift+Tab 在详情弹窗内从首个焦点回到最后一个焦点', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = screen.getByRole('dialog');
    const favoriteButton = within(dialog).getByRole('button', {
      name: '收藏 网页演示稿生成',
    });
    favoriteButton.focus();

    await user.tab({ shift: true });

    expect(within(dialog).getByRole('button', { name: '安装' })).toHaveFocus();
  });

  it('父组件重渲染不会重置详情弹窗焦点', async () => {
    const user = userEvent.setup();
    const rendered = renderSkillMarket();

    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = screen.getByRole('dialog');
    const actionButton = within(dialog).getByRole('button', { name: '安装' });
    actionButton.focus();

    rendered.rerender(<SkillMarketView {...createProps()} />);

    expect(actionButton).toHaveFocus();
  });

  it('收藏、安装、使用按钮的 Enter/Space 不会打开详情，详情按钮可键盘打开', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const onUse = vi.fn();
    renderSkillMarket({
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
      ]),
      installRecords: [createRecord({ skillId: 'frontend-slides', marketRevision: 1 })],
      onInstall,
      onUse,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const card = getSkillCard('frontend-slides');

    within(card).getByRole('button', { name: '收藏 网页演示稿生成' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /我的收藏\s+1/ })).toBeInTheDocument();

    within(card).getByRole('button', { name: '使用' }).focus();
    await user.keyboard('{Enter}');
    expect(onUse).toHaveBeenCalledWith('frontend-slides');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: '搜索 Skill' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'guizang-social-card-skill');
    const installCard = getSkillCard('guizang-social-card-skill');
    within(installCard).getByRole('button', { name: '安装' }).focus();
    await user.keyboard(' ');
    expect(onInstall).toHaveBeenCalledWith('guizang-social-card-skill');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    getSkillDetailButton('guizang-social-card-skill').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
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

  it('收藏写入失败时保持原状态，恢复后可重试成功并清除错误', async () => {
    const user = userEvent.setup();
    renderSkillMarket();
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('blocked storage');
      });

    expect(screen.getByRole('button', { name: /我的收藏\s+0/ })).toBeInTheDocument();
    await user.click(
      within(getSkillCard('frontend-slides')).getByRole('button', {
        name: '收藏 网页演示稿生成',
      })
    );

    expect(setItemSpy).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /我的收藏\s+0/ })).toBeInTheDocument();
    expect(
      within(getSkillCard('frontend-slides')).getByRole('button', {
        name: '收藏 网页演示稿生成',
      })
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('收藏保存失败，请检查浏览器存储权限');

    await user.click(
      within(getSkillCard('frontend-slides')).getByRole('button', {
        name: '收藏 网页演示稿生成',
      })
    );

    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: /我的收藏\s+1/ })).toBeInTheDocument();
    expect(
      within(getSkillCard('frontend-slides')).getByRole('button', {
        name: '取消收藏 网页演示稿生成',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText('收藏保存失败，请检查浏览器存储权限')).not.toBeInTheDocument();
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

    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);
    expect(screen.getByText('Runtime 未连接，目录可浏览，安装、更新和使用需连接后操作。')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    expect(screen.getByRole('button', { name: '连接后安装' })).toBeDisabled();
  });

  it('Runtime 未连接时 update 和 use 按钮禁用并显示连接提示', async () => {
    const user = userEvent.setup();
    renderSkillMarket({
      connected: false,
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
        createSkill({ id: 'guizang-social-card-skill', status: 'valid' }),
      ]),
      installRecords: [
        createRecord({ skillId: 'frontend-slides', marketRevision: 1 }),
        createRecord({ skillId: 'guizang-social-card-skill', marketRevision: 0 }),
      ],
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    expect(screen.getByRole('button', { name: '连接后使用' })).toBeDisabled();

    await user.clear(screen.getByRole('searchbox', { name: '搜索 Skill' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'guizang-social-card-skill');
    expect(screen.getByRole('button', { name: '连接后更新' })).toBeDisabled();
    expect(screen.getAllByText('需要连接 Runtime').length).toBeGreaterThan(0);
  });

  it('skills 状态未知时目录仍显示且所有安装、更新和使用动作禁用', async () => {
    const user = userEvent.setup();
    render(
      <SkillMarketView
        {...createProps({
          installRecords: [createRecord({ skillId: 'frontend-slides', marketRevision: 0 })],
        })}
        skills={undefined}
      />
    );

    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const action = within(getSkillCard('frontend-slides')).getByRole('button', {
      name: '状态未知',
    });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription('Skill 安装状态未知');
  });

  it('operation error 显示在对应卡片与详情中且按钮可重试', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderSkillMarket({
      operation: {
        skillId: 'frontend-slides',
        kind: 'install',
        error: '安装失败，请重试',
      },
      onInstall,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const card = getSkillCard('frontend-slides');
    expect(within(card).getByText('安装失败，请重试')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '安装' }));
    expect(onInstall).toHaveBeenCalledWith('frontend-slides');

    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('安装失败，请重试')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '安装' }));
    expect(onInstall).toHaveBeenCalledTimes(2);
  });

  it('use error 只显示在对应 Skill 详情中并可重试使用', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    renderSkillMarket({
      skills: createSkillsResponse([
        createSkill({ id: 'frontend-slides', status: 'valid' }),
        createSkill({ id: 'op7418-humanizer-zh', status: 'valid' }),
      ]),
      installRecords: [
        createRecord({ skillId: 'frontend-slides', marketRevision: 1 }),
        createRecord({ skillId: 'op7418-humanizer-zh', marketRevision: 1 }),
      ],
      useError: { skillId: 'frontend-slides', error: '启动失败，请重试' },
      onUse,
    });

    expect(screen.getByText('使用失败：启动失败，请重试')).toBeInTheDocument();
    await user.click(getSkillDetailButton('frontend-slides'));
    const frontendDialog = screen.getByRole('dialog');
    expect(within(frontendDialog).getByText('使用失败：启动失败，请重试')).toBeInTheDocument();
    await user.click(within(frontendDialog).getByRole('button', { name: '使用' }));
    expect(onUse).toHaveBeenCalledWith('frontend-slides');

    await user.click(within(frontendDialog).getByRole('button', { name: '关闭详情' }));
    await user.click(getSkillDetailButton('op7418-humanizer-zh'));
    expect(
      within(screen.getByRole('dialog')).queryByText('使用失败：启动失败，请重试')
    ).not.toBeInTheDocument();
  });

  it('install/update mutation 进行中时禁用其他安装和更新按钮但不禁用使用按钮', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const onUse = vi.fn();
    renderSkillMarket({
      skills: createSkillsResponse([
        createSkill({ id: 'guizang-social-card-skill', status: 'valid' }),
        createSkill({ id: 'op7418-humanizer-zh', status: 'valid' }),
      ]),
      installRecords: [
        createRecord({ skillId: 'guizang-social-card-skill', marketRevision: 0 }),
        createRecord({ skillId: 'op7418-humanizer-zh', marketRevision: 1 }),
      ],
      operation: {
        skillId: 'frontend-slides',
        kind: 'install',
      },
      onUpdate,
      onUse,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '小红书图文与公众号封面');
    const updateButton = within(getSkillCard('guizang-social-card-skill')).getByRole('button', { name: '更新' });
    expect(updateButton).toBeDisabled();
    expect(updateButton).toHaveAttribute('title', '请等待当前操作完成');
    expect(updateButton).toHaveAccessibleDescription('请等待当前操作完成');

    await user.click(updateButton);
    expect(onUpdate).not.toHaveBeenCalled();

    await user.click(getSkillDetailButton('guizang-social-card-skill'));
    const dialog = screen.getByRole('dialog');
    const modalUpdateButton = within(dialog).getByRole('button', { name: '更新' });
    expect(modalUpdateButton).toBeDisabled();
    expect(modalUpdateButton).toHaveAttribute('title', '请等待当前操作完成');
    expect(modalUpdateButton).toHaveAccessibleDescription('请等待当前操作完成');
    await user.click(screen.getByRole('button', { name: '关闭详情' }));

    await user.clear(screen.getByRole('searchbox', { name: '搜索 Skill' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'humanizer-zh');
    const useButton = within(getSkillCard('op7418-humanizer-zh')).getByRole('button', { name: '使用' });
    expect(useButton).toBeEnabled();
    expect(useButton).not.toHaveAttribute('title', '请等待当前操作完成');

    await user.click(useButton);
    expect(onUse).toHaveBeenCalledWith('op7418-humanizer-zh');
  });

  it('operation error 不会触发全局 mutation 禁用，其他安装按钮仍可重试', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderSkillMarket({
      operation: {
        skillId: 'frontend-slides',
        kind: 'install',
        error: '安装失败，请重试',
      },
      onInstall,
    });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'AI Builders 动态摘要');
    const installButton = within(getSkillCard('follow-builders')).getByRole('button', { name: '安装' });
    expect(installButton).toBeEnabled();
    expect(installButton).not.toHaveAttribute('title', '请等待当前操作完成');

    await user.click(installButton);
    expect(onInstall).toHaveBeenCalledWith('follow-builders');
  });

  it('非法图片和头像 URL 不会进入 img src，合法 https 与同源路径可使用', () => {
    expect(normalizeSkillMarketAssetUrl('  https://example.com/a path.png  ')).toBe(
      'https://example.com/a%20path.png'
    );
    expect(normalizeSkillMarketAssetUrl('   ')).toBeUndefined();
    expect(normalizeSkillMarketAssetUrl('http://example.com/a.png')).toBeUndefined();
    expect(normalizeSkillMarketAssetUrl('blob:https://example.com/id')).toBeUndefined();
    expect(normalizeSkillMarketAssetUrl('//example.com/a.png')).toBeUndefined();
    expect(normalizeSkillMarketAssetUrl('/\\evil.png')).toBeUndefined();
    expect(normalizeSkillMarketAssetUrl('https://example.com\\evil.png')).toBeUndefined();
    expect(normalizeSkillMarketAssetUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(normalizeSkillMarketAssetUrl('/a.png')).toBe('/a.png');

    const invalid = createMarketEntry({
      id: 'invalid-media',
      title: '非法媒体',
      creator: {
        name: 'Bad Avatar',
        avatarUrl: 'javascript:alert(1)',
      },
      examples: [
        {
          type: 'image',
          title: 'bad cover',
          url: 'data:image/png;base64,bad',
          approved: true,
        },
      ],
    });
    const https = createMarketEntry({
      id: 'https-media',
      title: '合法 HTTPS',
      creator: {
        name: 'Https Avatar',
        avatarUrl: 'https://example.com/avatar.png',
      },
      examples: [
        {
          type: 'image',
          title: 'valid https cover',
          url: 'https://example.com/cover.png',
          approved: true,
        },
      ],
    });
    const local = createMarketEntry({
      id: 'local-media',
      title: '合法本地',
      creator: {
        name: 'Local Avatar',
        avatarUrl: '/avatar.png',
      },
      examples: [
        {
          type: 'image',
          title: 'valid local cover',
          url: '/cover.png',
          approved: true,
        },
      ],
    });

    renderSkillMarket({ catalogOverride: [invalid, https, local] });

    expect(screen.getByRole('img', { name: 'bad cover' })).toHaveAttribute(
      'src',
      expect.stringContaining('/skill-market/examples/')
    );
    expect(screen.queryByRole('img', { name: 'Bad Avatar' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bad Avatar')).toHaveTextContent('B');
    expect(document.querySelector('img[src^="data:"]')).not.toBeInTheDocument();
    expect(document.querySelector('img[src^="javascript:"]')).not.toBeInTheDocument();

    expect(screen.getByRole('img', { name: 'valid https cover' })).toHaveAttribute(
      'src',
      'https://example.com/cover.png'
    );
    expect(screen.getByRole('img', { name: 'valid https cover' })).toHaveAttribute(
      'loading',
      'lazy'
    );
    expect(screen.getByRole('img', { name: 'valid https cover' })).toHaveAttribute(
      'decoding',
      'async'
    );
    expect(screen.getByRole('img', { name: 'Https Avatar' })).toHaveAttribute(
      'src',
      'https://example.com/avatar.png'
    );
    expect(screen.getByRole('img', { name: 'Https Avatar' })).toHaveAttribute(
      'loading',
      'lazy'
    );
    expect(screen.getByRole('img', { name: 'Https Avatar' })).toHaveAttribute(
      'decoding',
      'async'
    );
    expect(screen.getByRole('img', { name: 'valid local cover' })).toHaveAttribute(
      'src',
      '/cover.png'
    );
    expect(screen.getByRole('img', { name: 'Local Avatar' })).toHaveAttribute(
      'src',
      '/avatar.png'
    );
  });

  it('详情主图 eager 加载并异步解码', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.click(getSkillDetailButton('frontend-slides'));

    const dialog = screen.getByRole('dialog');
    const cover = dialog.querySelector('.skill-market-detail-head__cover img');
    expect(cover).toBeInstanceOf(HTMLImageElement);
    expect(cover).toHaveAttribute('loading', 'eager');
    expect(cover).toHaveAttribute('decoding', 'async');
  });

  it('approved 图片和本地回退都失败后在详情按钮内显示 CSS fallback 且没有 div', async () => {
    const entry = createMarketEntry({
      id: 'fallback-media',
      title: '失败封面',
      examples: [
        {
          type: 'image',
          title: 'failing approved cover',
          url: 'https://example.com/fail.png',
          approved: true,
        },
      ],
    });

    renderSkillMarket({ catalogOverride: [entry] });
    const detailButton = getSkillDetailButton('fallback-media');
    const firstImage = within(detailButton).getByRole('img', { name: 'failing approved cover' });

    fireEvent.error(firstImage);

    const fallbackImage = within(detailButton).getByRole('img', { name: 'failing approved cover' });
    expect(fallbackImage).toHaveAttribute('src', expect.stringContaining('/skill-market/examples/'));
    fireEvent.error(fallbackImage);

    expect(await within(detailButton).findByLabelText('失败封面 封面')).toBeInTheDocument();
    expect(within(detailButton).queryByRole('img', { name: 'failing approved cover' })).not.toBeInTheDocument();
    expect(detailButton.querySelector('div')).toBeNull();
  });

  it('loading 和 loadError 作为 banner 显示且不替换目录', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSkillMarket({ loading: true });
    expect(screen.getByRole('status')).toHaveTextContent('正在加载 Skills 目录');
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);

    rerender(<SkillMarketView {...createProps({ loadError: '目录加载失败' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('目录加载失败');
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);

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
  useError?: { skillId: string; error: string };
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

function createMarketEntry(overrides: Partial<SkillMarketEntry> = {}): SkillMarketEntry {
  return {
    id: 'test-skill',
    name: 'test-skill',
    title: '测试 Skill',
    tagline: '用于测试市场卡片',
    summary: '用于测试市场卡片。',
    category: 'content-planning',
    subcategory: '测试场景',
    platforms: ['Web'],
    tasks: ['测试任务'],
    creator: {
      name: 'Clawee',
      avatarUrl: 'https://example.com/avatar.png',
    },
    examples: [],
    inputs: ['输入'],
    outputs: ['输出'],
    risks: {
      requiresLogin: false,
      requiresApiKey: false,
      externalWrite: false,
      readsLocalFiles: false,
      privateDataRisk: false,
      notes: [],
    },
    listingStatus: 'featured',
    install: {
      available: true,
      repository: 'test/test-skill',
      skillPath: '.',
      commit: 'commit',
      marketRevision: 1,
    },
    ...overrides,
  };
}

function getSkillCard(skillId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`[data-skill-id="${skillId}"]`);
  expect(card).not.toBeNull();
  return card!;
}

function getSkillDetailButton(skillId: string): HTMLButtonElement {
  const card = getSkillCard(skillId);
  return within(card).getByRole('button', {
    name: new RegExp(`打开 .*详情`),
  }) as HTMLButtonElement;
}
