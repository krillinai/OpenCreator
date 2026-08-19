import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexModelResponse } from '@clawee/protocol';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { Composer } from './Composer.js';

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
    id: 'playground',
    name: 'Playground',
    cwd: '~/develop/clawee/playground',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null
  },
  {
    id: 'cover',
    name: 'cover',
    cwd: '~/develop/clawee/cover',
    sandbox: 'follow-global' as const,
    profile: 'default',
    model: null,
    reasoning: null
  }
];

const defaultProps = {
  projectId: 'content-design',
  projectName: 'content-design',
  projects,
  permission: 'danger-full-access' as const,
  profile: 'default',
  model: null,
  reasoning: null,
  onSelectProject: vi.fn(),
  onSubmit: vi.fn()
};

const codexModels: CodexModelResponse[] = [
  {
    id: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    description: 'Latest model',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep' },
      { reasoningEffort: 'xhigh', description: 'Deepest' }
    ],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image'],
    isDefault: true
  },
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'Previous model',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Deep' },
      { reasoningEffort: 'xhigh', description: 'Deepest' }
    ],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image'],
    isDefault: false
  }
];

describe('Composer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows codex-style composer controls', () => {
    render(<Composer {...defaultProps} permission="workspace-write" />);

    expect(screen.getByRole('button', { name: '选择项目 content-design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加上下文' }))
      .toHaveAttribute('title', '添加文件等');
    const permissionButton = screen.getByRole('button', {
      name: '选择访问权限 请求批准'
    });
    expect(permissionButton).toHaveAttribute('title', '更改项目权限');
    expect(permissionButton.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
    const modelButton = screen.getByRole('button', { name: '选择模型 默认模型' });
    expect(modelButton).toBeInTheDocument();
    expect(modelButton.querySelector('.lucide-circle')).not.toBeInTheDocument();
    expect(modelButton.querySelector('.lucide-chevron-down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.queryByText('跟随全局配置')).not.toBeInTheDocument();
    expect(screen.queryByText('本地模式')).not.toBeInTheDocument();
    expect(screen.queryByText('open-clawee')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入 / 调用插件')).toBeInTheDocument();
  });

  it('renders the empty composer controls in English without mixed-language labels', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <Composer {...defaultProps} permission="workspace-write" projectName="No project selected" />
      </LanguageProvider>
    );

    expect(screen.getByRole('button', { name: 'Select project No project selected' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select access level: Ask for approval' }))
      .toHaveAttribute('title', 'Change project access');
    expect(screen.getByRole('button', { name: 'Select model: Default model' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add context' }))
      .toHaveAttribute('title', 'Add files and more');
    expect(screen.getByPlaceholderText('Type a message or use a plugin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('hides the project selector for a project-independent task draft', () => {
    const { container } = render(
      <Composer
        {...defaultProps}
        showProjectSelector={false}
        permission="workspace-write"
      />
    );

    expect(screen.queryByRole('button', { name: /选择项目/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '选择项目' })).not.toBeInTheDocument();
    expect(container.querySelector('.clawee-composer')).toHaveClass('without-project-selector');
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' })).toBeInTheDocument();
  });

  it('searches projects and switches the conversation workspace', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    render(<Composer {...defaultProps} onSelectProject={onSelectProject} />);

    await user.click(screen.getByRole('button', { name: '选择项目 content-design' }));

    expect(screen.getByRole('dialog', { name: '选择项目' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'content-design' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.type(screen.getByRole('searchbox', { name: '搜索项目' }), 'play');

    expect(screen.getByRole('option', { name: 'Playground' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'cover' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'Playground' }));

    expect(onSelectProject).toHaveBeenCalledWith('playground');
    expect(screen.queryByRole('dialog', { name: '选择项目' })).not.toBeInTheDocument();
  });

  it('offers blank and existing-folder project creation from the project selector', async () => {
    const user = userEvent.setup();
    const onCreateBlankProject = vi.fn();
    const onAddProjectDirectory = vi.fn();
    render(
      <Composer
        {...defaultProps}
        projects={[]}
        projectId=""
        projectName="未选择项目"
        onCreateBlankProject={onCreateBlankProject}
        onAddProjectDirectory={onAddProjectDirectory}
      />
    );

    await user.click(screen.getByRole('button', { name: '选择项目 未选择项目' }));

    expect(screen.getByText('没有匹配的项目')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '新建项目' }));
    const createProjectDialog = screen.getByRole('dialog', { name: '创建项目' });
    expect(createProjectDialog).toBeInTheDocument();
    expect(createProjectDialog.parentElement?.parentElement).toBe(document.body);
    await user.type(screen.getByRole('textbox', { name: '文件夹名称' }), '我的项目');
    await user.click(screen.getByRole('button', { name: '创建' }));
    expect(onCreateBlankProject).toHaveBeenCalledWith('我的项目');
    expect(screen.queryByRole('dialog', { name: '创建项目' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '选择项目 未选择项目' }));
    await user.click(screen.getByRole('button', { name: '使用现有文件夹' }));
    expect(onAddProjectDirectory).toHaveBeenCalledTimes(1);
  });

  it('hides the desktop-only existing-folder action when its capability is unavailable', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        onCreateBlankProject={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '选择项目 content-design' }));

    expect(screen.getByRole('button', { name: '新建项目' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用现有文件夹' })).not.toBeInTheDocument();
  });

  it('closes the project menu without resetting the current project', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    render(<Composer {...defaultProps} onSelectProject={onSelectProject} />);

    await user.click(screen.getByRole('button', { name: '选择项目 content-design' }));
    await user.click(screen.getByRole('option', { name: 'content-design' }));

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '选择项目' })).not.toBeInTheDocument();
  });

  it('keeps the project menu open for inside clicks and closes it on outside pointer presses', async () => {
    const user = userEvent.setup();
    render(<Composer {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '选择项目 content-design' }));
    fireEvent.pointerDown(screen.getByRole('searchbox', { name: '搜索项目' }));

    expect(screen.getByRole('dialog', { name: '选择项目' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('textbox', { name: '输入任务' }));

    expect(screen.queryByRole('dialog', { name: '选择项目' })).not.toBeInTheDocument();
  });

  it.each([
    ['添加上下文', '添加上下文'],
    ['选择访问权限 完全访问权限', '访问权限'],
    ['选择模型 默认模型', '模型']
  ])('closes the %s menu on outside pointer presses', async (triggerName, menuName) => {
    const user = userEvent.setup();
    render(<Composer {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: triggerName }));
    expect(screen.getByRole('menu', { name: menuName })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('textbox', { name: '输入任务' }));

    expect(screen.queryByRole('menu', { name: menuName })).not.toBeInTheDocument();
  });

  it('does not expose a running submission mode menu', () => {
    render(<Composer {...defaultProps} running />);

    expect(screen.queryByRole('button', { name: '选择发送方式' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: '发送方式' })).not.toBeInTheDocument();
    const stopButton = screen.getByRole('button', { name: '停止任务' });
    expect(stopButton).toBeDisabled();
    expect(stopButton).toHaveAttribute('title', '停止任务');
    expect(stopButton.querySelector('.lucide-square')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '排队发送' })).not.toBeInTheDocument();
  });

  it('closes the active composer menu with Escape', async () => {
    const user = userEvent.setup();
    render(<Composer {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: '选择模型 默认模型' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: '模型' })).not.toBeInTheDocument();
  });

  it('opens menus and submits selected permission and model config', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onModelConfigChange = vi.fn();
    render(
      <Composer
        {...defaultProps}
        permission="workspace-write"
        models={codexModels}
        onModelConfigChange={onModelConfigChange}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: '选择访问权限 请求批准' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问/ }));
    await user.click(screen.getByRole('button', { name: '开启' }));

    await user.click(screen.getByRole('button', { name: '选择模型 GPT-5.6 Sol' }));
    expect(screen.getByRole('menuitemradio', { name: /GPT-5.6 Sol/ }))
      .toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /GPT-5.5/ }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: /GPT-5.5/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /^超高 / }));
    expect(onModelConfigChange).toHaveBeenLastCalledWith({
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    });

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello', {
      permission: 'danger-full-access',
      profile: 'default',
      model: 'gpt-5.5',
      reasoning: 'xhigh'
    }, []);
    expect(textbox).toHaveValue('');
    await waitFor(() => expect(textbox).toHaveFocus());
  });

  it('shows an unavailable persisted model without replacing it silently', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        model="gpt-5.4"
        models={codexModels}
      />
    );

    expect(screen.getByRole('button', { name: '选择模型 gpt-5.4 · 不可用' }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', {
      name: '选择模型 gpt-5.4 · 不可用'
    }));

    expect(screen.getByRole('menuitemradio', { name: /gpt-5.4 · 不可用/ }))
      .toBeDisabled();
    expect(screen.getAllByRole('menuitemradio', { name: /GPT-5\.(6|5)/ }))
      .toHaveLength(2);
  });

  it('prevents selecting a text-only model after an image is attached', async () => {
    const user = userEvent.setup();
    mockObjectUrls();
    const textOnlyModel: CodexModelResponse = {
      ...codexModels[1]!,
      id: 'gpt-5.5-text',
      model: 'gpt-5.5-text',
      displayName: 'GPT-5.5 Text',
      inputModalities: ['text']
    };
    render(
      <Composer
        {...defaultProps}
        models={[codexModels[0]!, textOnlyModel]}
        imageInputSupported
        onUploadAttachment={async () => attachment()}
      />
    );

    await user.upload(
      screen.getByLabelText('选择图片'),
      new File(['png'], 'screen.png', { type: 'image/png' })
    );
    await screen.findByRole('img', { name: 'screen.png' });
    await user.click(screen.getByRole('button', { name: '选择模型 GPT-5.6 Sol' }));

    expect(screen.getByRole('menuitemradio', { name: /GPT-5.5 Text/ }))
      .toBeDisabled();
    expect(screen.getByRole('menuitemradio', { name: /GPT-5.5 Text/ }))
      .toHaveTextContent('当前任务包含图片，无法选择');
  });

  it('shows only two permission levels and keeps request approval when full access is canceled', async () => {
    const user = userEvent.setup();
    const onPermissionChange = vi.fn();
    render(
      <Composer
        {...defaultProps}
        permission="workspace-write"
        onPermissionChange={onPermissionChange}
      />
    );

    await user.click(screen.getByRole('button', { name: '选择访问权限 请求批准' }));

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
    expect(screen.queryByText('只读访问')).not.toBeInTheDocument();
    expect(screen.queryByText('工作区读写')).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问权限/ }));

    const dialog = screen.getByRole('alertdialog', { name: '开启完全访问权限' });
    expect(dialog).toHaveTextContent('仅在你信任当前项目时开启');
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('alertdialog', { name: '开启完全访问权限' })).not.toBeInTheDocument();
    expect(onPermissionChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' })).toBeInTheDocument();
  });

  it('keeps the current permission when the parent rejects the change', async () => {
    const user = userEvent.setup();
    const onPermissionChange = vi.fn(async () => false);
    render(
      <Composer
        {...defaultProps}
        permission="workspace-write"
        onPermissionChange={onPermissionChange}
      />
    );

    await user.click(screen.getByRole('button', { name: '选择访问权限 请求批准' }));
    await user.click(screen.getByRole('menuitemradio', { name: /完全访问权限/ }));
    await user.click(screen.getByRole('button', { name: '开启' }));

    expect(onPermissionChange).toHaveBeenCalledWith('danger-full-access');
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' })).toBeInTheDocument();
  });

  it('disables permission changes while the current task is running', () => {
    render(
      <Composer
        {...defaultProps}
        permission="workspace-write"
        permissionChangeDisabled
      />
    );

    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: '选择访问权限 请求批准' }))
      .toHaveAttribute('title', '当前任务结束后可修改访问权限');
  });

  it('hides Profile controls while preserving the configured Profile', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Composer
        {...defaultProps}
        profile="review"
        onSubmit={onSubmit}
      />
    );

    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Profile' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '检查改动');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('检查改动', {
      permission: 'danger-full-access',
      profile: 'review',
      model: null,
      reasoning: null
    }, []);
  });

  it('does not expose the Profile for an existing conversation', () => {
    render(
      <Composer
        {...defaultProps}
        profile="review"
      />
    );

    expect(screen.queryByRole('button', { name: /Profile/ })).not.toBeInTheDocument();
  });

  it('opens the add context menu', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          }
        ]}
      />
    );

    expect(screen.getByRole('button', { name: '打开连接器列表，github MCP' }))
      .toHaveAttribute('title', 'github · 查看连接器');
    expect(screen.queryByRole('list', { name: '已开启的 MCP' }))
      .toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '添加上下文' }));

    expect(screen.getByRole('menu', { name: '添加上下文' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '添加文件' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '技能' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '连接器' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: '技能' }));
    expect(screen.getByRole('menu', { name: '技能' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /brainstorming/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /github/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /brainstorming/ }));
    expect(screen.getByLabelText('已选择 Skill brainstorming')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveAttribute('placeholder', '');
  });

  it('loads the connector catalog, shows status, and selects enabled connectors', async () => {
    const user = userEvent.setup();
    const onManageSkills = vi.fn();
    const onManageConnectors = vi.fn();
    const onToggleConnector = vi.fn(async (_connectorId: string, enabled: boolean) => [{
      id: 'enterprise:crm',
      label: '客户关系管理',
      description: 'sales · 1/2 项工具已授权',
      status: 'available' as const
    }, {
      id: 'enterprise:docs',
      label: '企业文档',
      description: 'knowledge · 3/3 项工具已授权',
      status: enabled ? 'enabled' as const : 'installed' as const,
      ...(enabled ? { insertText: '使用连接器：企业文档 ' } : {})
    }, {
      id: 'enterprise:analytics',
      label: '数据分析',
      description: 'analytics · 2/3 项工具已授权',
      status: 'installed' as const
    }, {
      id: 'enterprise:legacy',
      label: '旧版系统',
      description: 'legacy · 0/1 项工具已授权',
      status: 'unavailable' as const
    }]);
    const onLoadConnectors = vi.fn(async () => [{
      id: 'enterprise:crm',
      label: '客户关系管理',
      description: 'sales · 1/2 项工具已授权',
      status: 'available' as const
    }, {
      id: 'enterprise:docs',
      label: '企业文档',
      description: 'knowledge · 3/3 项工具已授权',
      status: 'enabled' as const,
      insertText: '使用连接器：企业文档 '
    }, {
      id: 'enterprise:analytics',
      label: '数据分析',
      description: 'analytics · 2/3 项工具已授权',
      status: 'installed' as const
    }, {
      id: 'enterprise:legacy',
      label: '旧版系统',
      description: 'legacy · 0/1 项工具已授权',
      status: 'unavailable' as const
    }]);
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          }
        ]}
        onLoadConnectors={onLoadConnectors}
        onToggleConnector={onToggleConnector}
        preloadConnectors
        onManageSkills={onManageSkills}
        onManageConnectors={onManageConnectors}
      />
    );

    const enabledMcpList = await screen.findByRole('list', { name: '已开启的 MCP' });
    const enterpriseDocsIcon = within(enabledMcpList).getByRole('button', {
      name: '打开连接器列表，企业文档 MCP'
    });
    expect(enterpriseDocsIcon).toHaveAttribute('title', '企业文档 · 查看连接器');
    expect(within(enabledMcpList).getByRole('button', {
      name: '打开连接器列表，github MCP'
    })).toHaveAttribute('title', 'github · 查看连接器');
    expect(within(enabledMcpList).queryByRole('button', {
      name: '打开连接器列表，客户关系管理 MCP'
    }))
      .not.toBeInTheDocument();
    expect(onLoadConnectors).toHaveBeenCalledTimes(1);

    await user.click(enterpriseDocsIcon);
    expect(screen.getByRole('dialog', { name: '连接器' })).toBeInTheDocument();
    const enterpriseToggle = screen.getByRole('switch', { name: '企业文档 MCP' });
    expect(enterpriseToggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: '数据分析 MCP' }))
      .toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText('客户关系管理')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择更多连接器' })).toBeInTheDocument();
    await user.click(enterpriseToggle);
    expect(onToggleConnector).toHaveBeenCalledWith('enterprise:docs', false);
    expect(screen.getByRole('switch', { name: '企业文档 MCP' }))
      .toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('switch', { name: '企业文档 MCP' }));
    expect(onToggleConnector).toHaveBeenLastCalledWith('enterprise:docs', true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '连接器' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.click(screen.getByRole('menuitem', { name: '连接器' }));

    expect(screen.getByRole('menu', { name: '连接器' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: /客户关系管理.*可安装/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /企业文档.*已开启/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /数据分析.*已安装/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /旧版系统.*服务停用/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /github.*已配置/ })).toBeInTheDocument();
    expect(onLoadConnectors).toHaveBeenCalledTimes(1);

    await user.type(screen.getByRole('searchbox', { name: '搜索连接器' }), '文档');
    expect(screen.queryByRole('menuitem', { name: /客户关系管理/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /企业文档.*已开启/ }));
    expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveValue('使用连接器：企业文档 ');
    expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveAttribute('placeholder', '');

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.click(screen.getByRole('menuitem', { name: '技能' }));
    await user.click(screen.getByRole('menuitem', { name: '管理技能' }));
    expect(onManageSkills).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.click(screen.getByRole('menuitem', { name: '连接器' }));
    await user.click(screen.getByRole('menuitem', { name: '管理连接器' }));
    expect(onManageConnectors).toHaveBeenCalledTimes(1);
  });

  it('keeps local connectors available when the connector catalog fails', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[{
          id: 'mcp:github',
          category: 'mcp',
          label: 'github',
          description: 'stdio · 已配置',
          insertText: '使用 MCP：github '
        }]}
        onLoadConnectors={vi.fn(async () => {
          throw new Error('企业连接服务暂时不可用');
        })}
      />
    );

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.click(screen.getByRole('menuitem', { name: '连接器' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('企业连接服务暂时不可用');
    await user.click(screen.getByRole('menuitem', { name: /github.*已配置/ }));
    expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveValue('使用 MCP：github ');
  });

  it('inserts a connector after the selected Skill prefix', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[{
          id: 'skill:brainstorming',
          category: 'skill',
          label: 'brainstorming',
          description: '需求梳理',
          insertText: '$brainstorming '
        }, {
          id: 'mcp:github',
          category: 'mcp',
          label: 'github',
          description: 'stdio · 已配置',
          insertText: '使用 MCP：github '
        }]}
      />
    );

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.click(screen.getByRole('menuitem', { name: '技能' }));
    await user.click(screen.getByRole('menuitem', { name: /brainstorming/ }));
    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.click(screen.getByRole('menuitem', { name: '连接器' }));
    await user.click(screen.getByRole('menuitem', { name: /github.*已配置/ }));

    expect(screen.getByLabelText('已选择 Skill brainstorming')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveValue('使用 MCP：github ');
  });

  it('is disabled when current thread has an active run', () => {
    render(<Composer {...defaultProps} disabled disabledReason="当前对话有任务运行中" />);

    expect(screen.getByRole('textbox', { name: '输入任务' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(screen.getByPlaceholderText('当前对话有任务运行中')).toBeInTheDocument();
  });

  it('keeps input available while running and submits queued follow-ups', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer
        {...defaultProps}
        running
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    expect(textbox).toBeEnabled();
    expect(screen.getByRole('button', { name: '停止任务' })).toBeInTheDocument();
    await user.type(textbox, '排队任务');
    expect(screen.queryByRole('button', { name: '停止任务' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '排队发送' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      '排队任务',
      expect.any(Object),
      [],
      'enqueue'
    );
    expect(textbox).toHaveFocus();
    expect(screen.queryByRole('button', { name: '排队发送' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '停止任务' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <Composer
        {...defaultProps}
        running
        canceling
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('button', { name: '正在停止任务' })).toBeDisabled();
  });

  it('keeps permission and model controls visible when disabled', () => {
    render(<Composer {...defaultProps} disabled />);

    expect(screen.getByRole('button', { name: '选择访问权限 完全访问权限' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择模型 默认模型' })).toBeInTheDocument();
  });

  it('submits the trimmed prompt and clears the textbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '  hello  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('hello', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: null
    }, []);
    expect(textbox).toHaveValue('');
  });

  it('auto-sizes the textbox to its content and resets after submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get() {
        return textbox.value.includes('\n') ? 52 : 28;
      }
    });

    await user.type(textbox, 'first line');
    await waitFor(() => expect(textbox.style.height).toBe('48px'));

    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textbox, 'second line');
    await waitFor(() => expect(textbox.style.height).toBe('52px'));

    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('first line\nsecond line', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: null
    }, []);
    await waitFor(() => expect(textbox.style.height).toBe('48px'));
  });

  it('caps the textbox at twelve lines without forcing the current scroll position', async () => {
    render(<Composer {...defaultProps} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    let assignedScrollTop = 40;
    const setScrollTop = vi.fn((value: number) => {
      assignedScrollTop = value;
    });
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      get: () => textbox.value.split('\n').length > 12 ? 300 : 48
    });
    Object.defineProperty(textbox, 'scrollTop', {
      configurable: true,
      get() {
        return assignedScrollTop;
      },
      set: setScrollTop
    });

    fireEvent.change(textbox, {
      target: {
        value: Array.from({ length: 13 }, (_, index) => `line ${index + 1}`).join('\n')
      }
    });

    await waitFor(() => {
      expect(textbox.style.height).toBe('268px');
      expect(textbox.style.overflowY).toBe('auto');
      expect(textbox.scrollTop).toBe(40);
      expect(setScrollTop).not.toHaveBeenCalled();
    });
  });

  it('submits with Enter and keeps Shift+Enter for new lines', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, 'hello');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('hello\n');

    await user.type(textbox, 'world');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('hello\nworld', {
      permission: 'danger-full-access',
      profile: 'default',
      model: null,
      reasoning: null
    }, []);
    expect(textbox).toHaveValue('');
  });

  it('does not submit Enter during IME composition', () => {
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '你好' } });
    fireEvent.keyDown(textbox, {
      key: 'Enter',
      code: 'Enter',
      isComposing: true
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('你好');
  });

  it('does not submit when disabled even if the form submit event fires', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    fireEvent.change(textbox, { target: { value: '  hello  ' } });
    rerender(<Composer {...defaultProps} disabled onSubmit={onSubmit} />);
    fireEvent.submit(textbox.closest('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit an empty trimmed prompt', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Composer {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '   ');

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hides the default placeholder after entering any text', async () => {
    const user = userEvent.setup();
    render(<Composer {...defaultProps} />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, 'a');

    expect(textbox).toHaveAttribute('placeholder', '');
  });

  it('shows a Skill prompt hint without adding it to the draft', () => {
    render(<Composer {...defaultProps} promptHint="上传视频，或者输入有效的视频链接" />);

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    expect(textbox).toHaveAttribute('placeholder', '上传视频，或者输入有效的视频链接');
    expect(textbox).toHaveValue('');
  });

  it('uploads a selected image, blocks submit while uploading, and submits attachment metadata', async () => {
    const user = userEvent.setup();
    let resolveUpload!: (value: ReturnType<typeof attachment>) => void;
    const onUploadAttachment = vi.fn(() => new Promise<ReturnType<typeof attachment>>(resolve => {
      resolveUpload = resolve;
    }));
    const onSubmit = vi.fn(async () => true);
    mockObjectUrls();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported
        onUploadAttachment={onUploadAttachment}
        onSubmit={onSubmit}
      />
    );
    const file = new File(['png'], 'screen.png', { type: 'image/png' });

    await user.click(screen.getByRole('button', { name: '添加上下文' }));
    await user.upload(screen.getByLabelText('选择图片'), file);
    expect(screen.getByRole('textbox', { name: '输入任务' })).toHaveAttribute('placeholder', '');
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '描述图片');

    expect(screen.getByRole('status', { name: '正在上传 screen.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();

    resolveUpload(attachment());
    expect(await screen.findByRole('img', { name: 'screen.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      '描述图片',
      expect.objectContaining({ permission: 'danger-full-access' }),
      [{
        attachment: attachment(),
        previewUrl: 'blob:screen.png'
      }]
    ));
    await waitFor(() => expect(
      screen.queryByRole('img', { name: 'screen.png' })
    ).not.toBeInTheDocument());
  });

  it('keeps an accepted attachment preview alive when submission changes the composer key', async () => {
    const user = userEvent.setup();
    mockObjectUrls();

    function Harness() {
      const [composerKey, setComposerKey] = useState('draft');
      const [focusRequestId, setFocusRequestId] = useState<number>();
      return (
        <Composer
          key={composerKey}
          {...defaultProps}
          focusRequestId={focusRequestId}
          imageInputSupported
          onUploadAttachment={async () => attachment()}
          onSubmit={() => {
            setComposerKey('thread');
            setFocusRequestId(1);
            return true;
          }}
        />
      );
    }

    render(<Harness />);
    const file = new File(['png'], 'screen.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('选择图片'), file);
    await screen.findByRole('img', { name: 'screen.png' });
    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '描述图片');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:screen.png');
    await waitFor(() => expect(
      screen.getByRole('textbox', { name: '输入任务' })
    ).toHaveFocus());
  });

  it('supports pasted and dropped images through the same upload path', async () => {
    const onUploadAttachment = vi.fn(async (file: File) => attachment(file.name));
    mockObjectUrls();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported
        onUploadAttachment={onUploadAttachment}
      />
    );
    const pasted = new File(['one'], 'pasted.png', { type: 'image/png' });
    const dropped = new File(['two'], 'dropped.webp', { type: 'image/webp' });
    const textbox = screen.getByRole('textbox', { name: '输入任务' });

    fireEvent.paste(textbox, {
      clipboardData: { files: [pasted] }
    });
    fireEvent.drop(textbox.closest('form')!, {
      dataTransfer: { files: [dropped] }
    });

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('img', { name: 'pasted.png' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'dropped.webp' })).toBeInTheDocument();
  });

  it('removes uploaded attachments and retries failed uploads', async () => {
    const user = userEvent.setup();
    const onUploadAttachment = vi.fn()
      .mockRejectedValueOnce(new Error('上传失败'))
      .mockResolvedValueOnce(attachment());
    const onDeleteAttachment = vi.fn(async () => undefined);
    mockObjectUrls();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported
        onUploadAttachment={onUploadAttachment}
        onDeleteAttachment={onDeleteAttachment}
      />
    );
    const file = new File(['png'], 'screen.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('选择图片'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('上传失败');
    await user.click(screen.getByRole('button', { name: '重试上传 screen.png' }));
    expect(await screen.findByRole('img', { name: 'screen.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移除附件 screen.png' }));

    await waitFor(() => expect(onDeleteAttachment).toHaveBeenCalledWith(attachment()));
    expect(screen.queryByRole('img', { name: 'screen.png' })).not.toBeInTheDocument();
  });

  it('disables image input and prompts for a Codex update when unsupported', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        imageInputSupported={false}
        imageInputUnsupportedReason="当前 Codex 版本不支持图片输入，请更新 Codex"
      />
    );

    await user.click(screen.getByRole('button', { name: '添加上下文' }));

    expect(screen.getByRole('menuitem', { name: /添加文件/ })).toBeDisabled();
    expect(screen.getByText('当前 Codex 版本不支持图片输入，请更新 Codex')).toBeInTheDocument();
    expect(screen.getByLabelText('选择图片')).toBeDisabled();
  });

  it('applies an external draft once and focuses the textarea', async () => {
    const user = userEvent.setup();
    const onDraftApplied = vi.fn();
    const { rerender } = render(
      <Composer
        {...defaultProps}
        draftRequest={{ id: 1, text: '$frontend-slides ' }}
        onDraftApplied={onDraftApplied}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await waitFor(() => {
      expect(textbox).toHaveValue('$frontend-slides ');
      expect(textbox).toHaveFocus();
    });
    expect(onDraftApplied).toHaveBeenCalledWith(1);

    await user.type(textbox, '生成季度汇报');
    rerender(<Composer {...defaultProps} onDraftApplied={onDraftApplied} />);
    expect(textbox).toHaveValue('$frontend-slides 生成季度汇报');
  });

  it('uses a two-line input and does not force the scroll position while editing', () => {
    render(<Composer {...defaultProps} />);
    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    let scrollTopWrites = 0;
    Object.defineProperty(textbox, 'scrollHeight', {
      configurable: true,
      value: 1_000
    });
    Object.defineProperty(textbox, 'scrollTop', {
      configurable: true,
      get: () => 12,
      set: () => {
        scrollTopWrites += 1;
      }
    });

    expect(textbox).toHaveAttribute('rows', '2');
    fireEvent.change(textbox, {
      target: {
        value: '第一行\n第二行\n第三行',
        selectionStart: 4
      }
    });

    expect(scrollTopWrites).toBe(0);
    expect(textbox.style.overflowY).toBe('auto');
  });

  it('applies an external draft after RAF focus and caret placement in StrictMode', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const calls: string[] = [];
    const onDraftApplied = vi.fn(() => calls.push('applied'));

    render(
      <StrictMode>
        <Composer
          {...defaultProps}
          draftRequest={{ id: 7, text: '$frontend-slides ' }}
          onDraftApplied={onDraftApplied}
        />
      </StrictMode>
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' }) as HTMLTextAreaElement;
    const originalFocus = textbox.focus.bind(textbox);
    vi.spyOn(textbox, 'focus').mockImplementation(() => {
      calls.push('focus');
      originalFocus();
    });
    const originalSetSelectionRange = textbox.setSelectionRange.bind(textbox);
    vi.spyOn(textbox, 'setSelectionRange').mockImplementation((start, end, direction) => {
      calls.push(`selection:${start}:${end}`);
      originalSetSelectionRange(start, end, direction);
    });

    expect(textbox).toHaveValue('$frontend-slides ');
    expect(callbacks.size).toBe(1);
    expect(onDraftApplied).not.toHaveBeenCalled();

    const callback = Array.from(callbacks.values())[0]!;
    act(() => {
      callback(16);
    });

    expect(calls).toEqual(['focus', 'selection:17:17', 'applied']);
    expect(textbox).toHaveFocus();
    expect(textbox.selectionStart).toBe(17);
    expect(textbox.selectionEnd).toBe(17);
    expect(onDraftApplied).toHaveBeenCalledWith(7);
  });

  it('cancels a pending draft RAF on unmount without applying the draft', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const onDraftApplied = vi.fn();

    const { unmount } = render(
      <Composer
        {...defaultProps}
        draftRequest={{ id: 9, text: '$frontend-slides ' }}
        onDraftApplied={onDraftApplied}
      />
    );

    expect(callbacks.size).toBe(1);
    unmount();

    expect(callbacks.size).toBe(0);
    expect(onDraftApplied).not.toHaveBeenCalled();
  });

  it('typing slash shows only skills and inserts the selected command', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextRafId = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextRafId += 1;
      callbacks.set(nextRafId, callback);
      return nextRafId;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id);
    });
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'mcp:github',
            category: 'mcp',
            label: 'github',
            description: 'stdio · configured',
            insertText: '使用 MCP：github '
          },
          {
            id: 'goal:create',
            category: 'goal',
            label: '设置 Goal',
            description: '为这次任务声明目标',
            insertText: '目标：'
          }
        ]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/');

    expect(screen.getByRole('listbox', { name: '能力菜单' })).toBeInTheDocument();
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.queryByText('MCP')).not.toBeInTheDocument();
    expect(screen.queryByText('Goal')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /brainstorming/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /github/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /设置 Goal/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /brainstorming/ }));

    expect(screen.getByLabelText('已选择 Skill brainstorming')).toBeInTheDocument();
    expect(textbox).toHaveValue('');
    expect(callbacks.size).toBe(1);
    await user.type(textbox, '整');
    act(() => {
      Array.from(callbacks.values())[0]!(16);
    });
    await user.type(textbox, '理需求');
    expect(textbox).toHaveValue('整理需求');
    expect(screen.queryByRole('listbox', { name: '能力菜单' })).not.toBeInTheDocument();
  });

  it('filters skills from the first typed character and selects the active command with Enter', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          },
          {
            id: 'skill:zhiyu-helper',
            category: 'skill',
            label: 'zhiyu-helper',
            description: '辅助完成开发操作',
            insertText: '$zhiyu-helper '
          }
        ]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/z');

    expect(screen.queryByRole('option', { name: /brainstorming/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /zhiyu-helper/ })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');

    expect(screen.getByLabelText('已选择 Skill zhiyu-helper')).toBeInTheDocument();
    expect(textbox).toHaveValue('');
  });

  it('filters slash skills by prefix instead of matching a single letter anywhere in the name', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:acquisition-strategy',
            category: 'skill',
            label: 'acquisition-strategy',
            description: '获客策略',
            insertText: '$acquisition-strategy '
          },
          {
            id: 'skill:community-growth-strategy',
            category: 'skill',
            label: 'community-growth-strategy',
            description: '社区增长策略',
            insertText: '$community-growth-strategy '
          },
          {
            id: 'skill:growth-audit',
            category: 'skill',
            label: 'growth-audit',
            description: '增长审计',
            insertText: '$growth-audit '
          }
        ]}
      />
    );

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/g');

    expect(screen.getByRole('option', { name: /growth-audit/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /acquisition-strategy/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /community-growth-strategy/ })).not.toBeInTheDocument();
  });

  it('removes the selected skill chip when Backspace is pressed at the start', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[{
          id: 'skill:brainstorming',
          category: 'skill',
          label: 'brainstorming',
          description: '需求梳理和方案发散',
          insertText: '$brainstorming '
        }]}
      />
    );

    const textbox = screen.getByRole('textbox', { name: '输入任务' });
    await user.type(textbox, '/');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('已选择 Skill brainstorming')).toBeInTheDocument();

    await user.keyboard('{Backspace}');

    expect(screen.queryByLabelText('已选择 Skill brainstorming')).not.toBeInTheDocument();
    expect(textbox).toHaveValue('');
  });

  it('keeps the keyboard-selected skill visible while moving through a long slash menu', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    try {
      render(
        <Composer
          {...defaultProps}
          slashCommands={Array.from({ length: 12 }, (_, index) => ({
            id: `skill:skill-${index + 1}`,
            category: 'skill' as const,
            label: `skill-${index + 1}`,
            description: `第 ${index + 1} 个 Skill`,
            insertText: `$skill-${index + 1} `
          }))}
        />
      );

      const textbox = screen.getByRole('textbox', { name: '输入任务' });
      await user.type(textbox, '/');
      scrollIntoView.mockClear();

      for (let index = 0; index < 9; index += 1) {
        await user.keyboard('{ArrowDown}');
      }

      const activeOption = screen.getByRole('option', { name: /skill-10/ });
      expect(activeOption).toHaveAttribute('aria-selected', 'true');
      expect(textbox).toHaveAttribute('aria-activedescendant', activeOption.id);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.instances.at(-1)).toBe(activeOption);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: originalScrollIntoView
      });
    }
  });

  it('caps the slash menu height to the space above the composer inside a clipping container', async () => {
    const user = userEvent.setup();
    let composerTop = 340;
    const getBoundingClientRect = vi.spyOn(
      HTMLElement.prototype,
      'getBoundingClientRect'
    ).mockImplementation(function getRect(this: HTMLElement) {
      if (this.dataset.slashMenuBoundary === 'true') {
        return {
          x: 0,
          y: 48,
          width: 840,
          height: 792,
          top: 48,
          right: 840,
          bottom: 840,
          left: 0,
          toJSON: () => ({})
        };
      }
      if (this.classList.contains('composer-input-wrap')) {
        return {
          x: 80,
          y: composerTop,
          width: 680,
          height: 72,
          top: composerTop,
          right: 760,
          bottom: composerTop + 72,
          left: 80,
          toJSON: () => ({})
        };
      }
      return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({})
      };
    });

    render(
      <div data-slash-menu-boundary="true" style={{ overflow: 'hidden' }}>
        <Composer
          {...defaultProps}
          slashCommands={Array.from({ length: 12 }, (_, index) => ({
            id: `skill:skill-${index + 1}`,
            category: 'skill' as const,
            label: `skill-${index + 1}`,
            description: `第 ${index + 1} 个 Skill`,
            insertText: `$skill-${index + 1} `
          }))}
        />
      </div>
    );

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/');

    const menu = screen.getByRole('listbox', { name: '能力菜单' });
    expect(menu.style.getPropertyValue('--composer-slash-menu-available-height'))
      .toBe('272px');

    composerTop = 300;
    fireEvent(window, new Event('resize'));

    expect(menu.style.getPropertyValue('--composer-slash-menu-available-height'))
      .toBe('232px');
    getBoundingClientRect.mockRestore();
  });

  it('renders queued messages above the input and forwards Steer and delete actions', async () => {
    const user = userEvent.setup();
    const onSteerQueuedRun = vi.fn();
    const onCancelQueuedRun = vi.fn();
    render(
      <Composer
        {...defaultProps}
        queuedItems={[{
          runId: 'run-queued',
          text: '继续修复剩余问题',
          queuePosition: 2
        }]}
        onSteerQueuedRun={onSteerQueuedRun}
        onCancelQueuedRun={onCancelQueuedRun}
      />
    );

    const queue = screen.getByLabelText('排队消息');
    const composer = screen.getByRole('textbox', { name: '输入任务' }).closest('form');
    expect(queue).toHaveTextContent('继续修复剩余问题');
    expect(queue).toHaveTextContent('第 2 位');
    expect(composer).not.toContainElement(queue);
    expect(queue.nextElementSibling).toBe(composer);

    await user.click(screen.getByRole('button', { name: '优先执行等待任务 继续修复剩余问题' }));
    await user.click(screen.getByRole('button', { name: '移除等待任务 继续修复剩余问题' }));

    expect(onSteerQueuedRun).toHaveBeenCalledWith('run-queued');
    expect(onCancelQueuedRun).toHaveBeenCalledWith('run-queued');
  });

  it('closes the slash command list on outside pointer presses', async () => {
    const user = userEvent.setup();
    render(
      <Composer
        {...defaultProps}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理和方案发散',
            insertText: '$brainstorming '
          }
        ]}
      />
    );

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '/');
    expect(screen.getByRole('listbox', { name: '能力菜单' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: '选择项目 content-design' }));

    expect(screen.queryByRole('listbox', { name: '能力菜单' })).not.toBeInTheDocument();
  });
});

function attachment(fileName = 'screen.png') {
  return {
    id: 'attachment-1',
    fileName,
    mime: fileName.endsWith('.webp') ? 'image/webp' : 'image/png',
    size: 3,
    sha256: 'a'.repeat(64),
    storageKey: 'at/attachment-1.bin',
    draftId: 'draft-1',
    status: 'draft' as const,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z'
  };
}

function mockObjectUrls() {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((file: File) => `blob:${file.name}`)
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
}
