import type {
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillResponse,
} from '@clawee/protocol';
import { skillMarketCatalog, type SkillMarketEntry } from '@clawee/skill-market';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterAndSortSkillMarketEntries } from './skill-market-model.js';
import { savedSkillIdsStorageKey } from './skill-market-storage.js';
import { normalizeSkillMarketAssetUrl } from './SkillMarketCover.js';
import { SkillMarketView } from './SkillMarketView.js';

let intersectionObserverCallbacks: IntersectionObserverCallback[] = [];

describe('SkillMarketView', () => {
  beforeEach(() => {
    intersectionObserverCallbacks = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds = [0];

        constructor(callback: IntersectionObserverCallback) {
          intersectionObserverCallbacks.push(callback);
        }

        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('首屏只渲染一批目录卡片，滚动到底部时自动加载剩余结果', async () => {
    renderSkillMarket();

    const heading = screen.getByRole('heading', { level: 1, name: '插件' });
    expect(heading).toBeInTheDocument();
    expect(heading.querySelector('.lucide-plug')).toBeInTheDocument();
    expect(screen.getAllByText('55 个 Skill')).toHaveLength(2);
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);
    expect(screen.getByText('已显示 12 / 55')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多 Skill' })).not.toBeInTheDocument();

    await intersectSkillMarketSentinel();

    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(24);
    expect(screen.getByText('已显示 24 / 55')).toBeInTheDocument();

    const videoCategory = skillMarketCatalog.filter(
      (entry) => entry.category === 'video-subtitle'
    ).length;
    expect(
      within(screen.getByRole('group', { name: '分类' })).getByRole('button', {
        name: `做视频与字幕 ${videoCategory}`,
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '场景' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /我的收藏/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '排序' })).toHaveValue('recommended');
    expect(screen.queryByRole('combobox', { name: '分类' })).not.toBeInTheDocument();
  });

  it('超宽屏下哨兵持续可见时自动加载全部批次', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds = [0];

        constructor(private readonly callback: IntersectionObserverCallback) {}

        observe(target: Element) {
          const bounds = target.getBoundingClientRect();
          queueMicrotask(() => {
            this.callback(
              [{
                boundingClientRect: bounds,
                intersectionRatio: 1,
                intersectionRect: bounds,
                isIntersecting: true,
                rootBounds: null,
                target,
                time: 0,
              }],
              this as unknown as IntersectionObserver
            );
          });
        }

        unobserve() {}
        disconnect() {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      }
    );

    renderSkillMarket();

    await waitFor(() => {
      expect(screen.getAllByTestId('skill-market-card')).toHaveLength(55);
    });
    expect(screen.getByText('已显示 55 / 55')).toBeInTheDocument();
    expect(screen.queryByTestId('skill-market-scroll-sentinel')).not.toBeInTheDocument();
  });

  it('通过平铺的分类和场景联动筛选并可一次重置', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    const categoryResult = filterAndSortSkillMarketEntries({
      entries: skillMarketCatalog,
      skills: createSkillsResponse([]),
      records: [],
      category: 'video-subtitle',
    });
    await user.click(screen.getByRole('button', {
      name: `做视频与字幕 ${categoryResult.entries.length}`,
    }));
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(
      Math.min(categoryResult.entries.length, 12)
    );
    expect(categoryResult.subcategories.length).toBeGreaterThan(0);

    const firstSubcategory = categoryResult.subcategories[0]!;
    await user.click(screen.getByRole('button', {
      name: `${firstSubcategory.label} ${firstSubcategory.count}`,
    }));
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(
      Math.min(firstSubcategory.count, 12)
    );

    await user.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByRole('button', { name: '全部 55' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByRole('group', { name: '场景' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(12);
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

  it('通过排序菜单切换目录顺序并可重置', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    const usersSortedIds = filterAndSortSkillMarketEntries({
      entries: skillMarketCatalog,
      skills: createSkillsResponse([]),
      records: [],
      sort: 'users',
    }).entries.map((entry) => entry.id);

    await user.selectOptions(screen.getByRole('combobox', { name: '排序' }), 'users');

    expect(
      screen.getAllByTestId('skill-market-card').map((card) => card.getAttribute('data-skill-id'))
    ).toEqual(usersSortedIds.slice(0, 12));

    await user.click(screen.getByRole('button', { name: '重置筛选' }));
    expect(screen.getByRole('combobox', { name: '排序' })).toHaveValue('recommended');
  });

  it('筛选变化后重置首屏批次，加载更多后安装状态仍保持正确', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderSkillMarket({ onInstall });

    await intersectSkillMarketSentinel();
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(24);

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    expect(screen.getAllByTestId('skill-market-card')).toHaveLength(1);

    const card = getSkillCard('frontend-slides');
    await user.click(within(card).getByRole('button', { name: '安装' }));
    expect(onInstall).toHaveBeenCalledWith('frontend-slides');
  });

  it('点击卡片打开 role="dialog" 的详情弹窗', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: '网页演示稿生成' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '描述' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '输入与产出' })).toBeInTheDocument();
    expect(screen.getByText('需要输入')).toBeInTheDocument();
    expect(screen.getByText('会产出')).toBeInTheDocument();
    expect(screen.getByText('精选案例')).toBeInTheDocument();
    expect(screen.getByText('使用前注意')).toBeInTheDocument();
    expect(dialog.querySelector('.skill-market-detail-layout')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.skill-market-case')).toHaveLength(3);
    expect(within(dialog).getByRole('img', { name: '编辑风格演示页' })).toHaveAttribute(
      'src',
      'https://raw.githubusercontent.com/zarazhangrui/beautiful-html-templates/main/screenshots/soft-editorial-4.png'
    );
    expect(within(dialog).getByRole('button', { name: '预览 编辑风格演示页' })).toBeInTheDocument();
    expect(dialog.querySelector('.skill-market-modal__bar')).not.toBeInTheDocument();
    expect(dialog.querySelector('.skill-market-modal__toolbar')).not.toBeInTheDocument();
    const title = within(dialog).getByRole('heading', { name: '网页演示稿生成' });
    const meta = dialog.querySelector('.skill-market-detail-meta');
    expect(meta).not.toBeNull();
    expect(title.compareDocumentPosition(meta!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog.firstElementChild).toHaveClass('skill-market-detail-head');
    expect(dialog.querySelector('.skill-market-modal__body')).not.toContainElement(title);
    expect(meta!.firstElementChild).toHaveClass('skill-market-detail-author');
    expect(meta!.firstElementChild).toHaveTextContent('zarazhangrui');
    expect(
      within(dialog).getByRole('button', { name: '收藏 网页演示稿生成' }).closest('.skill-market-detail-title-row')
    ).toBeInTheDocument();
    expect(dialog.querySelector('.skill-market-case__caption svg')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '关闭详情' })).not.toBeInTheDocument();
  });

  it('案例超过三个时全部渲染在单行横滑轨道中', async () => {
    const user = userEvent.setup();
    const entry = createMarketEntry({
      id: 'scrollable-examples',
      title: '横滑案例',
      examples: [
        { type: 'image', title: '案例一', url: '/case-1.png', approved: true },
        { type: 'image', title: '案例二', url: '/case-2.png', approved: true },
        { type: 'image', title: '案例三', url: '/case-3.png', approved: true },
        { type: 'image', title: '案例四', url: '/case-4.png', approved: true },
      ],
    });
    renderSkillMarket({ catalogOverride: [entry] });

    await user.click(screen.getByRole('button', { name: '打开 横滑案例 详情' }));

    const dialog = screen.getByRole('dialog');
    const caseList = dialog.querySelector('.skill-market-case-list');
    expect(caseList).toHaveClass('skill-market-case-list--scrollable');
    expect(dialog.querySelectorAll('.skill-market-case')).toHaveLength(4);
    expect(within(dialog).getByRole('button', { name: '预览 案例四' })).toBeInTheDocument();
  });

  it('点击案例后预览大图，Escape 关闭并把焦点还给案例', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const previewTrigger = screen.getByRole('button', { name: '预览 编辑风格演示页' });
    await user.click(previewTrigger);

    const preview = screen.getByRole('dialog', { name: '预览 编辑风格演示页' });
    expect(within(preview).getByRole('img', { name: '编辑风格演示页' })).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: '查看 GitHub 原图' })).toHaveAttribute(
      'target',
      '_blank'
    );
    expect(within(preview).getByRole('button', { name: '关闭图片预览' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '预览 编辑风格演示页' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(previewTrigger).toHaveFocus());
  });

  it('GitHub 案例图加载失败时使用本地素材兜底', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));

    const image = screen.getByRole('img', { name: '编辑风格演示页' });
    fireEvent.error(image);

    expect(screen.getByRole('img', { name: '编辑风格演示页案例图暂不可用' })).toHaveAttribute(
      'src',
      '/skill-market/skills-empty.png'
    );
  });

  it('Escape 关闭弹窗，且仅在键盘打开时恢复卡片焦点', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const trigger = getSkillDetailButton('frontend-slides');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('点击详情遮罩关闭弹窗', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = screen.getByRole('dialog');

    fireEvent.mouseDown(dialog.parentElement!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Shift+Tab 在详情弹窗内从首个焦点回到最后一个焦点', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = screen.getByRole('dialog');
    const firstButton = within(dialog).getByRole('button', { name: '收藏 网页演示稿生成' });
    firstButton.focus();

    await user.tab({ shift: true });

    expect(within(dialog).getByRole('button', { name: '安装' })).toHaveFocus();
  });

  it('父组件重渲染不会重置详情弹窗焦点', async () => {
    const user = userEvent.setup();
    const rendered = renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = screen.getByRole('dialog');
    const actionButton = within(dialog).getByRole('button', { name: '安装' });
    actionButton.focus();

    rendered.rerender(<SkillMarketView {...createProps()} />);

    expect(actionButton).toHaveFocus();
  });

  it('安装、使用按钮的 Enter/Space 不会打开详情，详情按钮可键盘打开', async () => {
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
    expect(screen.getByRole('button', { name: /已安装\s+1/ })).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    const card = getSkillCard('frontend-slides');

    within(card).getByRole('button', { name: '使用' }).focus();
    await user.keyboard('{Enter}');
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '选择使用项目' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '在 content-design 中使用' }));
    expect(onUse).toHaveBeenCalledWith('frontend-slides', 'content-design');
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

  it('详情收藏仍可持久化，但列表不再展示“我的收藏”入口', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    expect(screen.queryByRole('button', { name: /我的收藏/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: '收藏 网页演示稿生成' }));

    expect(JSON.parse(window.localStorage.getItem(savedSkillIdsStorageKey) ?? 'null')).toEqual([
      'frontend-slides',
    ]);
    expect(screen.queryByRole('button', { name: /我的收藏/ })).not.toBeInTheDocument();
  });

  it('收藏写入失败时保持原状态，恢复后可重试成功并清除错误', async () => {
    const user = userEvent.setup();
    renderSkillMarket();
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('blocked storage');
      });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const dialog = within(screen.getByRole('dialog'));
    const favoriteButton = dialog.getByRole('button', { name: '收藏 网页演示稿生成' });
    await user.click(favoriteButton);

    expect(setItemSpy).toHaveBeenCalled();
    expect(dialog.getByRole('button', { name: '收藏 网页演示稿生成' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('收藏保存失败，请检查浏览器存储权限');

    await user.click(favoriteButton);

    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(dialog.getByRole('button', { name: '取消收藏 网页演示稿生成' })).toBeInTheDocument();
    expect(screen.queryByText('收藏保存失败，请检查浏览器存储权限')).not.toBeInTheDocument();
  });

  it('所有未安装目录条目都可直接发起安装', async () => {
    const user = userEvent.setup();
    const onInstall = vi.fn();
    renderSkillMarket({ onInstall });

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'GStack');
    const gstackAction = within(getSkillCard('garrytan-gstack')).getByRole('button', {
      name: '安装',
    });
    expect(gstackAction).toBeEnabled();
    await user.click(gstackAction);
    expect(onInstall).toHaveBeenCalledWith('garrytan-gstack');

    await user.clear(screen.getByRole('searchbox', { name: '搜索 Skill' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '卡卡字幕助手');
    const captionAction = within(getSkillCard('videocaptioner')).getByRole('button', {
      name: '安装',
    });
    expect(captionAction).toBeEnabled();
    await user.click(captionAction);
    expect(onInstall).toHaveBeenCalledWith('videocaptioner');
  });

  it('卡片精简低优先级信息，并让高信号标签与安装按钮位于同一操作行', () => {
    const entry = createMarketEntry({
      category: 'video-subtitle',
      subcategory: '字幕生成',
      platforms: ['YouTube', 'B站'],
      tasks: ['字幕生成', '转录', 'YouTube'],
    });

    renderSkillMarket({ catalogOverride: [entry] });

    const card = getSkillCard('test-skill');
    const tags = within(card).getByLabelText('标签');
    expect([...tags.querySelectorAll(':scope > span')].map((tag) => tag.textContent)).toEqual([
      '字幕生成',
      '转录',
    ]);
    expect(card.querySelector('.skill-market-card__cover')).not.toBeInTheDocument();
    expect(within(card).getByAltText('Clawee')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /收藏/ })).not.toBeInTheDocument();
    expect(within(card).queryByLabelText('使用人数')).not.toBeInTheDocument();

    const actionRow = card.querySelector('.skill-market-card__action-row');
    expect(actionRow).toContainElement(tags);
    expect(actionRow).toContainElement(within(card).getByRole('button', { name: '安装' }));
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

  it('已安装条目点击“使用”时先选择项目，确认后调用 onUse(id, projectId)', async () => {
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

    expect(onUse).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: '选择使用项目' });
    expect(within(dialog).getByRole('radio', { name: /content-design/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await user.click(within(dialog).getByRole('radio', { name: /bili/ }));
    await user.click(within(dialog).getByRole('button', { name: '在 bili 中使用' }));

    expect(onUse).toHaveBeenCalledWith('frontend-slides', 'bili');
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
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));
    const frontendDialog = screen.getByRole('dialog');
    expect(within(frontendDialog).getByText('使用失败：启动失败，请重试')).toBeInTheDocument();
    await user.click(within(frontendDialog).getByRole('button', { name: '使用' }));
    const projectDialog = screen.getByRole('dialog', { name: '选择使用项目' });
    await user.click(within(projectDialog).getByRole('button', { name: '在 content-design 中使用' }));
    expect(onUse).toHaveBeenCalledWith('frontend-slides', 'content-design');

    await user.clear(screen.getByRole('searchbox', { name: '搜索 Skill' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'humanizer-zh');
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
    expect(
      getSkillCard('guizang-social-card-skill').querySelector('.skill-market-action-reason')
    ).not.toBeInTheDocument();
    expect(updateButton).toHaveClass('skill-market-action-button--quiet-disabled');

    await user.click(updateButton);
    expect(onUpdate).not.toHaveBeenCalled();

    await user.click(getSkillDetailButton('guizang-social-card-skill'));
    const dialog = screen.getByRole('dialog');
    const modalUpdateButton = within(dialog).getByRole('button', { name: '更新' });
    expect(modalUpdateButton).toBeDisabled();
    expect(modalUpdateButton).toHaveAttribute('title', '请等待当前操作完成');
    expect(modalUpdateButton).toHaveAccessibleDescription('请等待当前操作完成');
    await user.keyboard('{Escape}');

    await user.clear(screen.getByRole('searchbox', { name: '搜索 Skill' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), 'humanizer-zh');
    const useButton = within(getSkillCard('op7418-humanizer-zh')).getByRole('button', { name: '使用' });
    expect(useButton).toBeEnabled();
    expect(useButton).not.toHaveAttribute('title', '请等待当前操作完成');

    await user.click(useButton);
    await user.click(screen.getByRole('button', { name: '在 content-design 中使用' }));
    expect(onUse).toHaveBeenCalledWith('op7418-humanizer-zh', 'content-design');
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
      githubRepository: 'invalid/repository/extra',
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

    expect(screen.queryByRole('img', { name: 'Bad Avatar' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bad Avatar')).toHaveTextContent('B');
    expect(document.querySelector('img[src^="data:"]')).not.toBeInTheDocument();
    expect(document.querySelector('img[src^="javascript:"]')).not.toBeInTheDocument();

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
    expect(screen.getByRole('img', { name: 'Local Avatar' })).toHaveAttribute(
      'src',
      '/avatar.png'
    );
  });

  it('详情使用大头像头部，不再展示大封面', async () => {
    const user = userEvent.setup();
    renderSkillMarket();

    await user.type(screen.getByRole('searchbox', { name: '搜索 Skill' }), '网页演示稿生成');
    await user.click(getSkillDetailButton('frontend-slides'));

    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.skill-market-detail-head__cover')).not.toBeInTheDocument();
    expect(dialog.querySelector('.skill-market-detail-head__identity')).toBeInTheDocument();
    expect(within(dialog).getByAltText('zarazhangrui')).toBeInTheDocument();
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

async function intersectSkillMarketSentinel() {
  const target = screen.getByTestId('skill-market-scroll-sentinel');
  await waitFor(() => expect(intersectionObserverCallbacks.length).toBeGreaterThan(0));
  const bounds = target.getBoundingClientRect();
  act(() => {
    for (const callback of intersectionObserverCallbacks) {
      callback(
        [{
          boundingClientRect: bounds,
          intersectionRatio: 1,
          intersectionRect: bounds,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
        }],
        {} as IntersectionObserver
      );
    }
  });
}

function createProps({
  connected = true,
  skills = createSkillsResponse([]),
  installRecords = [],
  loading = false,
  loadError,
  operation,
  useError,
  projects = [
    { id: 'content-design', name: 'content-design', cwd: '~/develop/content-design' },
    { id: 'bili', name: 'bili', cwd: '~/develop/clawee/bili' },
  ],
  currentProjectId = 'content-design',
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
  projects?: Array<{ id: string; name: string; cwd: string }>;
  currentProjectId?: string;
  onInstall?: (skillId: string) => void;
  onUpdate?: (skillId: string) => void;
  onUse?: (skillId: string, projectId: string) => void;
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
    projects,
    currentProjectId,
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
    githubRepository: 'test/test-skill',
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
      repository: 'test/test-skill',
      skillPath: '.',
      ref: 'main',
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
