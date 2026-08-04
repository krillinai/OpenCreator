import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
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
      onOpenAccount={vi.fn()}
      onOpenSettings={vi.fn()}
      onToggleCollapsed={vi.fn()}
      {...overrides}
    />
  );
}

describe('ClaweeSidebar', () => {
  it('renders global actions, projects with nested conversations, and the settings footer action', () => {
    renderSidebar();

    expect(screen.getByRole('img', { name: 'KrillinAI' })).toHaveAttribute(
      'src',
      '/krillinai-wordmark-white.png'
    );
    expect(screen.getByText('Clawee')).toHaveClass('sidebar-logo-word');
    expect(screen.getByText('v0.1.0')).toHaveClass('sidebar-brand-version');
    expect(screen.queryByText('Coca-Cola')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Clawee' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数据看板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent动态' })).toBeInTheDocument();
    const primaryActions = screen.getByRole('button', { name: '新建任务' }).parentElement;
    expect(primaryActions?.children[1]).toBe(screen.getByRole('button', { name: '数据看板' }));
    expect(primaryActions?.children[2]).toBe(screen.getByRole('button', { name: 'Agent动态' }));
    const searchButton = screen.getByRole('button', { name: '搜索' });
    expect(searchButton.nextElementSibling).toBe(screen.getByRole('button', { name: '收起侧栏' }));
    expect(primaryActions).not.toContainElement(searchButton);
    expect(screen.getByRole('button', { name: '定时任务' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '任务' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '企业Skill中心' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '系统连接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '企业知识库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '共享网盘' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '企业Skill中心' }).nextElementSibling).toBe(screen.getByRole('button', { name: '系统连接' }));
    expect(screen.getByRole('button', { name: '系统连接' }).nextElementSibling).toBe(screen.getByRole('button', { name: '企业知识库' }));
    expect(screen.getByRole('button', { name: '企业知识库' }).nextElementSibling).toBe(screen.getByRole('button', { name: '共享网盘' }));
    expect(screen.getByRole('button', { name: '共享网盘' }).nextElementSibling).toBe(screen.getByRole('button', { name: '定时任务' }));
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'content-design' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'content-design' })).toHaveAttribute('data-current-project', 'true');
    expect(screen.getByRole('button', { name: 'bili' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '对话' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整理本周项目进展 4天' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成 B 站封面 1天' })).not.toBeInTheDocument();
    expect(screen.getByText('4天')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '企业账户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });

  it('opens the dashboard and exposes selected and collapsed states', async () => {
    const onOpenView = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderSidebar({ onOpenView });
    await user.click(screen.getByRole('button', { name: '数据看板' }));
    expect(onOpenView).toHaveBeenCalledWith('dashboard');
    rerender(<ClaweeSidebar projects={projects} conversations={conversations} tasks={[]} activeView="dashboard" collapsed onNewConversation={vi.fn()} onSelectProject={vi.fn()} onSelectConversation={vi.fn()} onSelectTask={vi.fn()} onOpenView={onOpenView} onOpenAccount={vi.fn()} onOpenSettings={vi.fn()} onToggleCollapsed={vi.fn()} />);
    expect(screen.getByRole('button', { name: '数据看板' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '数据看板' })).toHaveAttribute('title', '数据看板');
  });

  it('opens the knowledge base and exposes selected and collapsed states', async () => {
    const onOpenView = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderSidebar({ onOpenView });
    await user.click(screen.getByRole('button', { name: '企业知识库' }));
    expect(onOpenView).toHaveBeenCalledWith('knowledge');
    rerender(<ClaweeSidebar projects={projects} conversations={conversations} tasks={[]} activeView="knowledge" collapsed onNewConversation={vi.fn()} onSelectProject={vi.fn()} onSelectConversation={vi.fn()} onSelectTask={vi.fn()} onOpenView={onOpenView} onOpenAccount={vi.fn()} onOpenSettings={vi.fn()} onToggleCollapsed={vi.fn()} />);
    expect(screen.getByRole('button', { name: '企业知识库' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '企业知识库' })).toHaveAttribute('title', '企业知识库');
  });

  it('opens Agent activity and exposes its selected and collapsed states', async () => {
    const onOpenView = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderSidebar({ onOpenView });

    await user.click(screen.getByRole('button', { name: 'Agent动态' }));
    expect(onOpenView).toHaveBeenCalledWith('activity');

    rerender(
      <ClaweeSidebar
        projects={projects}
        conversations={conversations}
        tasks={[]}
        activeView="activity"
        collapsed
        onNewConversation={vi.fn()}
        onSelectProject={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectTask={vi.fn()}
        onOpenView={onOpenView}
        onOpenAccount={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleCollapsed={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Agent动态' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Agent动态' })).toHaveAttribute('title', 'Agent动态');
  });

  it('expands projects with conversations without selecting the project', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();

    renderSidebar({ onSelectProject });

    await user.click(screen.getByRole('button', { name: 'bili' }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '生成 B 站封面 1天' })).toBeInTheDocument();
  });

  it('uses the black KrillinAI wordmark in light mode', () => {
    renderSidebar({ colorMode: 'light' });

    expect(screen.getByRole('img', { name: 'KrillinAI' }))
      .toHaveAttribute('src', '/krillinai-wordmark-black.png');
    expect(screen.getByText('Clawee')).toHaveClass('sidebar-logo-word');
    expect(screen.queryByRole('img', { name: 'Clawee' })).not.toBeInTheDocument();
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

  it('deletes only task drafts after confirmation', async () => {
    const user = userEvent.setup();
    const onDeleteTaskDraft = vi.fn(async () => undefined);

    renderSidebar({
      tasks: [
        createTask({ id: 'draft', name: '任务草稿', status: 'draft' }),
        createTask({ id: 'scheduled', name: '正式任务', status: 'idle' })
      ],
      onDeleteTaskDraft
    });

    await user.click(screen.getByRole('button', { name: '删除草稿 任务草稿' }));

    expect(screen.getByRole('alertdialog', { name: '删除任务草稿' })).toBeInTheDocument();
    expect(screen.getByText('此操作不会删除项目文件。')).toBeInTheDocument();
    expect(onDeleteTaskDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '删除草稿' }));
    expect(onDeleteTaskDraft).toHaveBeenCalledWith('thread-draft');
    expect(screen.queryByRole('alertdialog', { name: '删除任务草稿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除草稿 正式任务' })).not.toBeInTheDocument();
  });

  it('keeps a task draft when its deletion is cancelled', async () => {
    const user = userEvent.setup();
    const onDeleteTaskDraft = vi.fn();

    renderSidebar({
      tasks: [createTask({ id: 'draft', name: '任务草稿', status: 'draft' })],
      onDeleteTaskDraft
    });

    await user.click(screen.getByRole('button', { name: '删除草稿 任务草稿' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onDeleteTaskDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: '删除任务草稿' })).not.toBeInTheDocument();
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

  it('archives a conversation after confirming that history and project files are preserved', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onArchiveConversation = vi.fn(async () => undefined);

    renderSidebar({ onArchiveConversation });

    const conversation = screen.getByRole('group', { name: '整理本周项目进展' });
    await user.click(within(conversation).getByRole('button', { name: '归档' }));

    expect(confirm).toHaveBeenCalledWith(
      '归档“整理本周项目进展”？归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。'
    );
    expect(onArchiveConversation).toHaveBeenCalledWith('weekly-progress-brief');
  });

  it('does not allow archiving a conversation while it is running', () => {
    renderSidebar({
      runningConversationIds: new Set(['weekly-progress-brief']),
      onArchiveConversation: vi.fn()
    });

    const conversation = screen.getByRole('group', { name: '整理本周项目进展' });
    expect(within(conversation).getByRole('button', { name: '归档' })).toBeDisabled();
  });

  it('opens settings from the footer button', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    renderSidebar({ onOpenSettings });

    await user.click(screen.getByRole('button', { name: '设置' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps account and settings separately accessible when expanded or collapsed', async () => {
    const user = userEvent.setup();
    const onOpenAccount = vi.fn();
    const onOpenSettings = vi.fn();
    const view = renderSidebar({
      onOpenAccount,
      onOpenSettings,
      enterpriseSession: {
        status: 'signed_in',
        account: { email: 'member@example.com', name: 'Member' },
        transportSecurity: 'secure_https'
      },
      activeView: 'account'
    });

    expect(screen.getByRole('button', { name: 'Member member@example.com' }))
      .toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '设置' })).not.toHaveAttribute('aria-current');
    await user.click(screen.getByRole('button', { name: 'Member member@example.com' }));
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    view.rerender(
      <ClaweeSidebar
        projects={projects}
        conversations={conversations}
        tasks={[]}
        activeView="account"
        collapsed
        enterpriseSession={{
          status: 'signed_in',
          account: { email: 'member@example.com', name: 'Member' },
          transportSecurity: 'secure_https'
        }}
        onNewConversation={vi.fn()}
        onSelectProject={vi.fn()}
        onSelectConversation={vi.fn()}
        onSelectTask={vi.fn()}
        onOpenView={vi.fn()}
        onOpenAccount={onOpenAccount}
        onOpenSettings={onOpenSettings}
        onToggleCollapsed={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Member member@example.com' }))
      .toHaveAttribute('title', 'Member');
    expect(screen.getByRole('button', { name: '设置' })).toHaveAttribute('title', '设置');
  });

  it('creates a project from the projects heading', async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn();

    renderSidebar({ onAddProject });

    await user.click(screen.getByRole('button', { name: '创建项目' }));

    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it('confirms before removing a Runtime project without implying file deletion', async () => {
    const user = userEvent.setup();
    const onArchiveProject = vi.fn();

    renderSidebar({
      projects,
      onArchiveProject
    });

    await user.click(screen.getByRole('button', { name: '项目操作 content-design' }));
    const remove = screen.getByRole('menuitem', { name: '移除项目 content-design' });
    expect(remove).toHaveAttribute('title', '仅从项目列表移除，不会删除本机文件');
    await user.click(remove);

    expect(screen.getByRole('alertdialog', { name: '移除项目' })).toBeInTheDocument();
    expect(screen.getByText('确认从 Clawee 中移除“content-design”？项目目录和文件不会被删除。'))
      .toBeInTheDocument();
    expect(onArchiveProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '移除项目' }));

    expect(onArchiveProject).toHaveBeenCalledWith('content-design');
    expect(screen.queryByRole('alertdialog', { name: '移除项目' })).not.toBeInTheDocument();
  });

  it('keeps a project when removal is cancelled', async () => {
    const user = userEvent.setup();
    const onArchiveProject = vi.fn();
    renderSidebar({ projects, onArchiveProject });

    await user.click(screen.getByRole('button', { name: '项目操作 content-design' }));
    await user.click(screen.getByRole('menuitem', { name: '移除项目 content-design' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onArchiveProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: '移除项目' })).not.toBeInTheDocument();
  });

  it('shows directory replacement only when the host provides that capability', async () => {
    const user = userEvent.setup();
    const onReplaceProjectDirectory = vi.fn();
    const view = renderSidebar({ onArchiveProject: vi.fn() });

    await user.click(screen.getByRole('button', { name: '项目操作 content-design' }));
    expect(screen.queryByRole('menuitem', { name: '更换目录' })).not.toBeInTheDocument();

    view.unmount();
    renderSidebar({
      onArchiveProject: vi.fn(),
      onReplaceProjectDirectory
    });
    await user.click(screen.getByRole('button', { name: '项目操作 content-design' }));
    await user.click(screen.getByRole('menuitem', { name: '更换目录' }));

    expect(onReplaceProjectDirectory).toHaveBeenCalledWith('content-design');
  });

  it('starts a new conversation directly inside a project', async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn();

    renderSidebar({ onNewConversation });

    await user.click(screen.getByRole('button', {
      name: '在 content-design 中新建会话'
    }));

    expect(onNewConversation).toHaveBeenCalledWith('content-design');
  });

  it('starts a new conversation from the primary action', async () => {
    const user = userEvent.setup();
    const onNewConversation = vi.fn();

    renderSidebar({ onNewConversation });

    await user.click(screen.getByRole('button', { name: '新建任务' }));

    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });

  it('opens search from the header action', async () => {
    const user = userEvent.setup();
    const onOpenView = vi.fn();

    renderSidebar({ onOpenView });

    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(onOpenView).toHaveBeenCalledWith('search');
  });

  it('marks the header search action as selected', () => {
    renderSidebar({ activeView: 'search' });

    expect(screen.getByRole('button', { name: '搜索' })).toHaveAttribute('aria-current', 'page');
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
    expect(screen.getByRole('img', { name: 'KrillinAI' })).toHaveAttribute('src', '/krillinai-mark-white.png');
    expect(screen.queryByRole('button', { name: '收起侧栏' })).not.toBeInTheDocument();
    expect(screen.queryByText('项目')).not.toBeInTheDocument();
    expect(screen.queryByText('折叠时隐藏的任务')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Clawee' })).toHaveAttribute('data-collapsed', 'true');

    await user.click(screen.getByRole('button', { name: '展开侧栏' }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('explains when the sidebar is temporarily collapsed to protect workspace width', async () => {
    const user = userEvent.setup();
    const onToggleCollapsed = vi.fn();

    renderSidebar({
      collapsed: true,
      autoCollapsed: true,
      onToggleCollapsed
    });

    const autoCollapseButton = screen.getByRole('button', { name: '侧栏已自动收起' });
    expect(autoCollapseButton).toHaveAttribute('aria-disabled', 'true');
    expect(autoCollapseButton).toHaveAttribute(
      'title',
      '窗口较窄，关闭文件工作区后可展开侧栏'
    );

    await user.click(autoCollapseButton);
    expect(onToggleCollapsed).not.toHaveBeenCalled();
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
