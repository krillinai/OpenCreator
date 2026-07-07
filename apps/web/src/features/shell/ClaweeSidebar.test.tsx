import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClaweeSidebar } from './ClaweeSidebar.js';

const projects = [
  {
    id: 'content-design',
    name: 'content-design',
    cwd: '~/develop/content-design',
    sandbox: 'danger-full-access' as const,
    profile: 'default',
    model: '5.5',
    reasoning: 'xhigh'
  },
  {
    id: 'bili',
    name: 'bili',
    cwd: '~/develop/clawee/bili',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: '5.5',
    reasoning: 'xhigh'
  }
];

const conversations = [
  {
    id: 'analysis-codex-integration',
    projectId: 'content-design',
    title: '分析 Codex 接入方案',
    updatedLabel: '4天'
  },
  {
    id: 'bili-cover',
    projectId: 'bili',
    title: '生成 B 站封面',
    updatedLabel: '1天'
  }
];

function renderSidebar(overrides: Partial<ComponentProps<typeof ClaweeSidebar>> = {}) {
  return render(
    <ClaweeSidebar
      projects={projects}
      conversations={conversations}
      currentProjectId="content-design"
      activeView="conversation"
      onNewConversation={vi.fn()}
      onSelectProject={vi.fn()}
      onSelectConversation={vi.fn()}
      onOpenView={vi.fn()}
      onOpenSettings={vi.fn()}
      {...overrides}
    />
  );
}

describe('ClaweeSidebar', () => {
  it('renders global actions, projects, conversations, and footer actions', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: '新对话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已安排' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'content-design' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'bili' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '对话' })).toBeInTheDocument();
    expect(screen.getByText('分析 Codex 接入方案')).toBeInTheDocument();
    expect(screen.getByText('4天')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置 账户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
  });

  it('calls project selection with the selected project id', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();

    renderSidebar({ onSelectProject });

    await user.click(screen.getByRole('button', { name: 'bili' }));

    expect(onSelectProject).toHaveBeenCalledWith('bili');
  });

  it('opens settings from the footer button', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    renderSidebar({ onOpenSettings });

    await user.click(screen.getByRole('button', { name: '设置 账户' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
