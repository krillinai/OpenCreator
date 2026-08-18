import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectsPage from './ProjectsPage.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';

const projects = [
  {
    id: 'cover',
    name: '夏季新品封面',
    cwd: '/projects/cover',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null,
    updatedAt: '2026-08-18T10:00:00.000Z'
  },
  {
    id: 'translation',
    name: '发布会视频翻译',
    cwd: '/projects/translation',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null,
    updatedAt: '2026-08-17T10:00:00.000Z'
  },
  {
    id: 'avatar',
    name: '课程数字人口播',
    cwd: '/projects/avatar',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null,
    updatedAt: '2026-08-19T10:00:00.000Z'
  },
  {
    id: 'campaign',
    name: '秋季新品推广',
    cwd: '/projects/campaign',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null,
    updatedAt: '2026-08-16T10:00:00.000Z'
  }
];

describe('ProjectsPage', () => {
  it('localizes project chrome while preserving project names', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <ProjectsPage projects={projects} currentProjectId="cover" onOpenProject={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'My Projects' })).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: 'Search projects' });
    expect(search.closest('label')?.parentElement).toHaveClass('projects-page-header');
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Output Center' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Content Marketing' })).toBeInTheDocument();
    expect(screen.getByText('Current project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project 夏季新品封面' })).toBeInTheDocument();
  });

  it('lists projects as visual cards without rendering conversation rows', () => {
    render(<ProjectsPage projects={projects} currentProjectId="cover" onOpenProject={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '项目列表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开项目 夏季新品封面' })).toBeInTheDocument();
    expect(screen.getByText('当前项目')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument();
    expect(screen.queryByText('对话')).not.toBeInTheDocument();
  });

  it('keeps the empty state focused on projects created from Workbench', () => {
    render(<ProjectsPage projects={[]} onOpenProject={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('从工作台开始创作后，项目会自动显示在这里。');
    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument();
  });

  it('filters by category, searches, opens, and manages projects', () => {
    const onOpenProject = vi.fn();
    const onManageProject = vi.fn();
    render(
      <ProjectsPage
        projects={projects}
        onOpenProject={onOpenProject}
        onManageProject={onManageProject}
      />
    );

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), {
      target: { value: '翻译' }
    });
    expect(screen.queryByRole('button', { name: '打开项目 夏季新品封面' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开项目 发布会视频翻译' }));
    expect(onOpenProject).toHaveBeenCalledWith('translation');
    fireEvent.click(screen.getByRole('button', { name: '项目设置 发布会视频翻译' }));
    expect(onManageProject).toHaveBeenCalledWith('translation');

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '打开项目 夏季新品封面' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开项目 发布会视频翻译' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '内容营销' }));
    expect(screen.getByRole('button', { name: '打开项目 秋季新品推广' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开项目 夏季新品封面' })).not.toBeInTheDocument();
  });

  it('shows all projects by default in reverse update order', () => {
    render(<ProjectsPage projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');
    const projectButtons = within(screen.getByRole('list', { name: '项目列表' }))
      .getAllByRole('button', { name: /^打开项目/ });
    expect(projectButtons.map(button => button.getAttribute('aria-label'))).toEqual([
      '打开项目 课程数字人口播',
      '打开项目 夏季新品封面',
      '打开项目 发布会视频翻译',
      '打开项目 秋季新品推广'
    ]);
  });

  it('switches to an output center and filters outputs independently', () => {
    const onOpenProject = vi.fn();
    render(<ProjectsPage projects={projects} onOpenProject={onOpenProject} />);

    const dimensions = screen.getByRole('tablist', { name: '内容维度' });
    expect(within(dimensions).getByRole('tab', { name: '项目' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(dimensions).getByRole('tab', { name: '产出中心' }));

    expect(screen.getByRole('searchbox', { name: '搜索产出' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '全部产出' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: '产出列表' })).getAllByRole('listitem')).toHaveLength(9);

    fireEvent.click(screen.getByRole('button', { name: '在项目中打开产出 发布会视频翻译-翻译成片' }));
    expect(onOpenProject).toHaveBeenCalledWith('translation');

    const outputCategories = screen.getByRole('tablist', { name: '产出分类' });
    fireEvent.click(within(outputCategories).getByRole('tab', { name: '字幕' }));
    expect(screen.getByRole('heading', { name: '字幕' })).toBeInTheDocument();
    expect(screen.getByText('发布会视频翻译-双语字幕')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: '产出列表' })).getAllByRole('listitem')).toHaveLength(1);

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索产出' }), {
      target: { value: '没有这个文件' }
    });
    expect(screen.getByRole('status')).toHaveTextContent('没有找到匹配的产出');
  });
});
