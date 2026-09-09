import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { OpenCreatorSidebar } from './OpenCreatorSidebar.js';

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
    cwd: '~/develop/opencreator/bili',
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

function renderSidebar(overrides: Partial<ComponentProps<typeof OpenCreatorSidebar>> = {}) {
  return render(
    <OpenCreatorSidebar
      projects={projects}
      conversations={conversations}
      tasks={[]}
      currentProjectId="content-design"
      activeView="conversation"
      projectNavigationMode="tree"
      onNewConversation={vi.fn()}
      onOpenHome={vi.fn()}
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

describe('OpenCreatorSidebar', () => {
  it('renders global actions, projects with nested conversations, and the settings footer action', () => {
    renderSidebar();

    expect(screen.getByText('OpenCreator')).toHaveClass('sidebar-logo-word');
    expect(screen.queryByText('v1.0')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('整理本周项目进...')).toHaveClass('conversation-title-hover');
    expect(screen.queryByText('Coca-Cola')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'OpenCreator' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起侧栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '工作台' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '数据看板' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agent动态' })).not.toBeInTheDocument();
    const primaryActions = screen.getByRole('button', { name: '首页' }).parentElement;
    expect(primaryActions?.children[0]).toBe(screen.getByRole('button', { name: '首页' }));
    expect(primaryActions?.children[1]).toBe(screen.getByRole('button', { name: '工作台' }));
    expect(primaryActions?.children[2]).toBe(screen.getByRole('button', { name: '我的项目' }));
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '搜索' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '定时任务' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '插件中心' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '连接器' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我的资产' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '知识库' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '素材中心' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的项目' }).nextElementSibling).toBe(screen.getByRole('button', { name: '设置' }));
    expect(primaryActions).toContainElement(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'content-design' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'content-design' })).toHaveAttribute('data-current-project', 'true');
    expect(screen.getByRole('button', { name: 'bili' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '对话' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整理本周项目进展 4天' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成 B 站封面 1天' })).not.toBeInTheDocument();
    expect(screen.getByText('4天')).toBeInTheDocument();
    expect(screen.queryByText('登录即可享受云端协作')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });

  it('does not expose the legacy data dashboard in primary navigation', () => {
    renderSidebar({ activeView: 'dashboard' });

    expect(screen.getByRole('button', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: '数据看板' })).not.toBeInTheDocument();
  });

  it('uses creator-focused icons for the primary navigation', () => {
    const view = renderSidebar();

    expect(screen.getByRole('button', { name: '工作台' })
      .querySelector('.lucide-panels-top-left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '首页' })
      .querySelector('.lucide-house')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '插件中心' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我的资产' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的项目' })
      .querySelector('.lucide-folder-kanban')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })
      .querySelector('.lucide-sliders-horizontal')).toBeInTheDocument();
    expect(view.container.querySelectorAll('.sidebar-nav-icon')).toHaveLength(5);
  });

  it('renders global navigation in the selected display language', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <OpenCreatorSidebar
          projects={projects}
          conversations={conversations}
          tasks={[]}
          activeView="dashboard"
          projectNavigationMode="library"
          onNewConversation={vi.fn()}
          onOpenHome={vi.fn()}
          onSelectProject={vi.fn()}
          onSelectConversation={vi.fn()}
          onSelectTask={vi.fn()}
          onOpenView={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleCollapsed={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('button', { name: 'Plugins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'My Assets' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My Projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('expands projects with conversations without selecting the project', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();

    renderSidebar({ onSelectProject });

    await user.click(screen.getByRole('button', { name: 'bili' }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '生成 B 站封面 1天' })).toBeInTheDocument();
  });

  it('shows only the OpenCreator wordmark without an image logo in light mode', () => {
    const { container } = renderSidebar({ colorMode: 'light' });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('OpenCreator')).toHaveClass('sidebar-logo-word');
    expect(container.querySelector('.sidebar-logo-image')).not.toBeInTheDocument();
    expect(screen.queryByText('v1.0')).not.toBeInTheDocument();
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

  it('clears the conversation highlight outside the conversation view', () => {
    renderSidebar({
      activeView: 'settings',
      selectedConversationId: 'weekly-progress-brief'
    });

    expect(screen.queryByRole('button', { name: '我的资产' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '整理本周项目进展 4天' }))
      .not.toHaveAttribute('aria-current');
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

  it('renames, archives, and deletes tasks through hover actions', async () => {
    const user = userEvent.setup();
    const onRenameTask = vi.fn(async () => undefined);
    const onArchiveTask = vi.fn(async () => undefined);
    const onDeleteTask = vi.fn(async () => undefined);

    renderSidebar({
      tasks: [
        createTask({ id: 'draft', name: '任务草稿', status: 'draft' }),
        createTask({ id: 'scheduled', name: '正式任务', status: 'idle' })
      ],
      onRenameTask,
      onArchiveTask,
      onDeleteTask
    });

    await user.click(screen.getByRole('button', { name: '更多 任务草稿' }));
    await user.click(screen.getByRole('menuitem', { name: '重命名' }));
    const input = screen.getByRole('textbox', { name: '重命名任务 任务草稿' });
    await user.clear(input);
    await user.type(input, '新的任务名{Enter}');
    expect(onRenameTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft' }), '新的任务名');

    await user.click(screen.getByRole('button', { name: '归档 正式任务' }));
    expect(onArchiveTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'scheduled' }));

    await user.click(screen.getByRole('button', { name: '更多 正式任务' }));
    await user.click(screen.getByRole('menuitem', { name: '删除任务' }));

    expect(screen.getByRole('alertdialog', { name: '删除任务' })).toBeInTheDocument();
    expect(onDeleteTask).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '删除任务' }));
    expect(onDeleteTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'scheduled' }));
    expect(screen.queryByRole('alertdialog', { name: '删除任务' })).not.toBeInTheDocument();
  });

  it('keeps a task draft when its deletion is cancelled', async () => {
    const user = userEvent.setup();
    const onDeleteTask = vi.fn();

    renderSidebar({
      tasks: [createTask({ id: 'draft', name: '任务草稿', status: 'draft' })],
      onDeleteTask
    });

    await user.click(screen.getByRole('button', { name: '更多 任务草稿' }));
    await user.click(screen.getByRole('menuitem', { name: '删除任务' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onDeleteTask).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: '删除任务' })).not.toBeInTheDocument();
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
    const onArchiveConversation = vi.fn(async () => undefined);

    renderSidebar({ onArchiveConversation });

    const conversation = screen.getByRole('group', { name: '整理本周项目进展' });
    await user.click(within(conversation).getByRole('button', { name: '归档' }));

    const dialog = screen.getByRole('alertdialog', { name: '归档对话' });
    expect(dialog).toHaveTextContent(
      '确认归档“整理本周项目进展”？归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。'
    );
    expect(onArchiveConversation).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: '归档' }));

    expect(onArchiveConversation).toHaveBeenCalledWith('weekly-progress-brief');
  });

  it('renames, pins, and permanently deletes a conversation from row actions', async () => {
    const user = userEvent.setup();
    const onRenameConversation = vi.fn(async () => undefined);
    const onPinConversation = vi.fn(async () => undefined);
    const onDeleteConversation = vi.fn(async () => undefined);
    renderSidebar({
      onArchiveConversation: vi.fn(),
      onRenameConversation,
      onPinConversation,
      onDeleteConversation
    });
    const conversation = screen.getByRole('group', { name: '整理本周项目进展' });

    expect(within(conversation).getByRole('button', { name: '更多' }))
      .toBeInTheDocument();
    await user.click(within(conversation).getByRole('button', { name: '置顶' }));
    expect(onPinConversation).toHaveBeenCalledWith('weekly-progress-brief', true);

    await user.click(within(conversation).getByRole('button', { name: '更多' }));
    const menu = screen.getByRole('menu', { name: '整理本周项目进展 操作' });
    expect(menu).toHaveClass('sidebar-conversation-menu--portal');
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveStyle({ top: '8px', left: '8px' });
    await user.click(screen.getByRole('menuitem', { name: '重命名' }));
    const input = within(conversation).getByRole('textbox', { name: '重命名 整理本周项目进展' });
    await user.clear(input);
    await user.type(input, '新的会话标题{Enter}');
    expect(onRenameConversation).toHaveBeenCalledWith(
      'weekly-progress-brief',
      '新的会话标题'
    );

    await user.click(within(conversation).getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('menuitem', { name: '删除任务' }));
    const dialog = screen.getByRole('alertdialog', { name: '删除任务' });
    expect(dialog).toHaveTextContent('永久删除');
    expect(dialog).toHaveTextContent('不会删除项目文件');
    await user.click(within(dialog).getByRole('button', { name: '永久删除' }));
    expect(onDeleteConversation).toHaveBeenCalledWith('weekly-progress-brief');
  });

  it('closes a portalled conversation menu when the viewport changes', async () => {
    const user = userEvent.setup();
    renderSidebar({ onArchiveConversation: vi.fn() });
    const conversation = screen.getByRole('group', { name: '整理本周项目进展' });

    await user.click(within(conversation).getByRole('button', { name: '更多' }));
    expect(screen.getByRole('menu', { name: '整理本周项目进展 操作' })).toBeInTheDocument();

    fireEvent(window, new Event('resize'));

    expect(screen.queryByRole('menu', { name: '整理本周项目进展 操作' })).not.toBeInTheDocument();
  });

  it('does not allow archiving a conversation while it is running', () => {
    renderSidebar({
      runningConversationIds: new Set(['weekly-progress-brief']),
      onArchiveConversation: vi.fn()
    });

    const conversation = screen.getByRole('group', { name: '整理本周项目进展' });
    expect(within(conversation).getByRole('button', { name: '归档' })).toBeDisabled();
  });

  it('opens settings from the primary sidebar navigation', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();

    renderSidebar({ onOpenSettings });

    await user.click(screen.getByRole('button', { name: '设置' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '设置' }).parentElement)
      .toHaveClass('sidebar-primary');
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
    expect(screen.getByText('确认从 OpenCreator 中移除“content-design”？项目目录和文件不会被删除。'))
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

  it('opens Home from primary navigation without starting a chat', async () => {
    const user = userEvent.setup();
    const onOpenHome = vi.fn();
    const onNewConversation = vi.fn();
    renderSidebar({ onOpenHome, onNewConversation });

    await user.click(screen.getByRole('button', { name: '首页' }));

    expect(onOpenHome).toHaveBeenCalledTimes(1);
    expect(onNewConversation).not.toHaveBeenCalled();
  });

  it('opens the creator dashboard', async () => {
    const user = userEvent.setup();
    const onOpenView = vi.fn();

    renderSidebar({ onOpenView });

    await user.click(screen.getByRole('button', { name: '工作台' }));

    expect(onOpenView).toHaveBeenCalledWith('dashboard');
  });

  it('hides the header search action', () => {
    renderSidebar({ activeView: 'search' });

    expect(screen.queryByRole('button', { name: '搜索' })).not.toBeInTheDocument();
  });

  it('does not expose the internal task center in primary navigation', () => {
    renderSidebar({ activeView: 'tasks' });

    expect(screen.queryByRole('button', { name: /^任务/ })).not.toBeInTheDocument();
  });

  it('does not expose scheduled tasks in the default project library navigation', () => {
    renderSidebar({ projectNavigationMode: 'library' });

    expect(screen.queryByRole('button', { name: '定时任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '任务' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无任务')).not.toBeInTheDocument();
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

    const { container } = renderSidebar({
      collapsed: true,
      onToggleCollapsed,
      tasks: [createTask({ name: '折叠时隐藏的任务' })]
    });

    expect(screen.getByRole('button', { name: '展开侧栏' })).toBeInTheDocument();
    expect(container.querySelector('.sidebar-logo-image')).toBeInTheDocument();
    expect(screen.queryByText('OC')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenCreator')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起侧栏' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的项目' })).toHaveAttribute('title', '我的项目');
    expect(screen.queryByText('折叠时隐藏的任务')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'OpenCreator' })).toHaveAttribute('data-collapsed', 'true');

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
