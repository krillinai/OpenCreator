import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toBeInTheDocument();
    expect(screen.getByText('Current project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project 夏季新品封面' })).toBeInTheDocument();
  });

  it('lists projects as visual cards without rendering conversation rows', () => {
    render(<ProjectsPage projects={projects} currentProjectId="cover" onOpenProject={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '项目列表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开项目 夏季新品封面' })).toBeInTheDocument();
    expect(screen.getByText('当前项目')).toBeInTheDocument();
    expect(screen.queryByText('对话')).not.toBeInTheDocument();
  });

  it('searches, sorts, opens, and manages projects', () => {
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

    fireEvent.change(screen.getByRole('combobox', { name: '项目排序' }), {
      target: { value: 'name' }
    });
    expect(screen.getByRole('combobox', { name: '项目排序' })).toHaveValue('name');
  });
});
