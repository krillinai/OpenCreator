import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClaweeSidebar } from './ClaweeSidebar.js';

const projects = [
  {
    id: 'content-design',
    name: 'content-design',
    cwd: '~/develop/content-design',
    sandbox: 'danger-full-access' as const,
    profile: 'default',
    model: null,
    reasoning: null
  },
  {
    id: 'bili',
    name: 'bili',
    cwd: '~/develop/clawee/bili',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null
  }
];

const conversations = [
  {
    id: 'weekly-progress-brief',
    projectId: 'content-design',
    title: '整理本周项目进展',
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
      tasks={[]}
      currentProjectId="content-design"
      activeView="conversation"
      onNewConversation={vi.fn()}
      onSelectProject={vi.fn()}
      onSelectConversation={vi.fn()}
      onSelectTask={vi.fn()}
      onOpenView={vi.fn()}
      onOpenSettings={vi.fn()}
      onToggleCollapsed={vi.fn()}
      {...overrides}
    />
  );
}

describe('ClaweeSidebar', () => {
  it('renders global actions, projects with nested conversations, and the settings footer action', () => {
    renderSidebar();

    expect(screen.getByRole('img', { name: 'Clawee' })).toHaveAttribute('src', '/logo-all.png');
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新对话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已安排' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '任务' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'content-design' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'content-design' })).toHaveAttribute('data-current-project', 'true');
    expect(screen.getByRole('button', { name: 'bili' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '对话' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整理本周项目进展 4天' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成 B 站封面 1天' })).not.toBeInTheDocument();
    expect(screen.getByText('4天')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置 账户' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });

  it('expands projects with conversations without selecting the project', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();

    renderSidebar({ onSelectProject });

    await user.click(screen.getByRole('button', { name: 'bili' }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '生成 B 站封面 1天' })).toBeInTheDocument();
  });

  it('selects projects without conversations', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();

    renderSidebar({
      projects: [
        ...projects,
        {
          id: 'empty-project',
          name: 'empty-project',
          cwd: '~/develop/empty-project',
          sandbox: 'follow-global' as const,
          profile: 'default',
          model: null,
          reasoning: null
        }
      ],
      onSelectProject
    });

    await user.click(screen.getByRole('button', { name: 'empty-project' }));

    expect(onSelectProject).toHaveBeenCalledWith('empty-project');
    expect(screen.queryByText('暂无聊天')).not.toBeInTheDocument();
  });

  it('shows conversations under the selected project', () => {
    renderSidebar({ currentProjectId: 'bili' });

    expect(screen.getByRole('button', { name: 'bili' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'bili' })).toHaveAttribute('data-current-project', 'true');
    expect(screen.getByRole('button', { name: '生成 B 站封面 1天' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '整理本周项目进展 4天' })).not.toBeInTheDocument();
  });

  it('highlights only the selected conversation instead of both project and conversation', () => {
    renderSidebar({ selectedConversationId: 'weekly-progress-brief' });

    expect(screen.getByRole('button', { name: 'content-design' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '整理本周项目进展 4天' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows a spinning status for conversations with an active run', () => {
    renderSidebar({
      runningConversationIds: new Set(['weekly-progress-brief'])
    });

    expect(screen.getByLabelText('正在运行')).toHaveClass('conversation-run-spinner');
    expect(screen.getByRole('button', { name: /整理本周项目进展.*正在运行.*4天/ })).toBeInTheDocument();
  });

  it('shows task rows with running, queued, approval, failed, paused, repair, and unread states', () => {
    renderSidebar({
      tasks: [
        createTask({ id: 'draft', name: '任务草稿', status: 'draft' }),
        createTask({ id: 'running', name: '运行任务', status: 'running' }),
        createTask({ id: 'queued', name: '排队任务', status: 'queued' }),
        createTask({ id: 'approval', name: '审批任务', status: 'waiting_approval' }),
        createTask({ id: 'failed', name: '失败任务', status: 'failed' }),
        createTask({ id: 'paused', name: '暂停任务', status: 'paused' }),
        createTask({
          id: 'repair',
          name: '异常任务',
          threadId: undefined,
          status: 'repair_required'
        }),
        createTask({ id: 'unread', name: '未读任务', unread: true })
      ]
    });

    expect(screen.getByRole('heading', { name: '任务' })).toBeInTheDocument();
    expect(screen.getByText('草稿')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('排队中')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByText('需修复')).toBeInTheDocument();
    expect(screen.getByLabelText('未读更新')).toBeInTheDocument();
    expect(document.querySelector('.sidebar-task-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /异常任务.*需修复/ })).toBeDisabled();
  });

  it('highlights a selected draft task without marking its execution project as current', () => {
    renderSidebar({
      selectedConversationId: 'thread-draft',
      tasks: [
        createTask({
          id: 'draft',
          threadId: 'thread-draft',
          name: '任务草稿',
          status: 'draft'
        })
      ]
    });

    expect(screen.getByRole('button', { name: /任务草稿.*草稿/ }))
      .toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'content-design' }))
      .not.toHaveAttribute('data-current-project');
  });

  it('opens a paused task thread and keeps it selectable', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    renderSidebar({
      tasks: [createTask({ id: 'paused', name: '暂停任务', status: 'paused' })],
      onSelectTask
    });

    await user.click(screen.getByRole('button', { name: /暂停任务.*已暂停/ }));

    expect(onSelectTask).toHaveBeenCalledWith('thread-paused');
  });

  it('collapses the selected project when clicking it again', async () => {
    const user = userEvent.setup();

    renderSidebar({ currentProjectId: 'bili' });

    expect(screen.getByRole('button', { name: '生成 B 站封面 1天' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'bili' }));

    expect(screen.queryByRole('button', { name: '生成 B 站封面 1天' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bili' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('selects a nested project conversation', async () => {
    const user = userEvent.setup();
    const onSelectConversation = vi.fn();

    renderSidebar({ onSelectConversation });

    await user.click(screen.getByRole('button', { name: '整理本周项目进展 4天' }));

    expect(onSelectConversation).toHaveBeenCalledWith('weekly-progress-brief');
  });

  it('opens settings from the footer button', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    renderSidebar({ onOpenSettings });

    await user.click(screen.getByRole('button', { name: '设置 账户' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('starts a new conversation from the primary action', async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn();

    renderSidebar({ onNewConversation });

    await user.click(screen.getByRole('button', { name: '新对话' }));

    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it('opens search from the primary action', async () => {
    const user = userEvent.setup();
    const onOpenView = vi.fn();

    renderSidebar({ onOpenView });

    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(onOpenView).toHaveBeenCalledWith('search');
  });

  it('does not expose the internal task center in primary navigation', () => {
    renderSidebar({ activeView: 'tasks' });

    expect(screen.queryByRole('button', { name: /^任务/ })).not.toBeInTheDocument();
  });

  it('collapses from the header action', async () => {
    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();

    renderSidebar({ onToggleCollapsed });

    await user.click(screen.getByRole('button', { name: '收起侧栏' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('renders icon-only navigation and expands from the logo when collapsed', async () => {
    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();

    renderSidebar({
      collapsed: true,
      onToggleCollapsed,
      tasks: [createTask({ name: '折叠时隐藏的任务' })]
    });

    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起侧栏' })).not.toBeInTheDocument();
    expect(screen.queryByText('项目')).not.toBeInTheDocument();
    expect(screen.queryByText('折叠时隐藏的任务')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Clawee' })).toHaveAttribute('data-collapsed', 'true');

    await user.click(screen.getByRole('button', { name: '展开侧栏' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});

function createTask(overrides: {
  id?: string;
  threadId?: string;
  name?: string;
  status?: 'draft' | 'idle' | 'running' | 'queued' | 'waiting_approval' | 'failed' | 'paused' | 'repair_required';
  nextRunLabel?: string;
  unread?: boolean;
} = {}) {
  const id = overrides.id ?? 'task';
  return {
    id,
    threadId: overrides.threadId === undefined && overrides.status !== 'repair_required'
      ? `thread-${id}`
      : overrides.threadId,
    name: overrides.name ?? '每日总结',
    status: overrides.status ?? 'idle',
    nextRunLabel: overrides.nextRunLabel ?? '下次 18:00',
    unread: overrides.unread ?? false
  };
}
