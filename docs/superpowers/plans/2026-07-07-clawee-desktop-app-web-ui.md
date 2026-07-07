# Clawee Desktop App Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 `apps/web` 从旧四栏 Runtime Workbench 改造成 Clawee 桌面 Agent 第一版 UI，保留已实现的 Runtime/SSE/service 能力，替换为截图方向的左侧栏、主对话、按需详情和极简设置。

**Architecture:** 前端继续使用 React + TypeScript + Vite。将现有 `WorkbenchLayout` 演进为桌面 App shell：固定左侧栏、中间会话区、右侧详情抽屉；Runtime、SSE、mock service 继续通过 service/adapter 接入，组件不直接调用 fetch 或本机能力。品牌、文案和设置收敛为 Clawee，Codex 只在关于页高级信息出现。

**Tech Stack:** React 18、TypeScript、Vite、Vitest、Testing Library、lucide-react、`@clawee/protocol`。

---

## Scope Check

本计划只实现 UI 接入第一版，不实现桌面壳、真实项目 API、真实文件树 API、真实 diff/patch review API、账号体系、自动更新或完整设置中心。

现有工作区有大量未提交改动。执行时每个任务只 stage 本任务涉及文件，避免混入无关改动。不要使用 `git worktree`。

## File Structure

### 新增文件

- `apps/web/src/features/shell/ClaweeSidebar.tsx`
  - Clawee 左侧栏，包含 macOS 窗口点、全局入口、项目、对话、底部设置/更新。
- `apps/web/src/features/shell/ClaweeSidebar.test.tsx`
  - 左侧栏渲染、项目选择、设置入口测试。
- `apps/web/src/features/conversation/ConversationHeader.tsx`
  - 中间顶部标题、打开位置、详情按钮。
- `apps/web/src/features/conversation/ConversationHeader.test.tsx`
  - 标题和动作测试。
- `apps/web/src/features/conversation/ConversationEmptyState.tsx`
  - 空状态标题和项目上下文文案。
- `apps/web/src/features/conversation/ConversationEmptyState.test.tsx`
  - 未选项目/已选项目文案测试。
- `apps/web/src/features/details/DetailPanel.tsx`
  - 右侧详情抽屉，统一承载文件预览、变更审查、运行详情。
- `apps/web/src/features/details/DetailPanel.test.tsx`
  - 三种详情模式测试。
- `apps/web/src/features/settings/ClaweeSettingsView.tsx`
  - 极简设置页：常规、插件、关于 Clawee。
- `apps/web/src/features/settings/ClaweeSettingsView.test.tsx`
  - 设置导航和高级信息测试。
- `apps/web/src/features/projects/project-model.ts`
  - UI 项目、会话 seed 数据和类型。
- `apps/web/src/features/projects/project-model.test.ts`
  - 默认项目、会话聚合测试。

### 修改文件

- `apps/web/src/app/App.tsx`
  - 组合新的 Clawee shell、conversation、detail panel、settings view。
  - 删除主 UI 中 Codex Runtime Workbench 文案。
  - 保留 RuntimeClient、SSE、mock file/change service。
- `apps/web/src/app/app-state.ts`
  - 扩展当前视图、项目、详情抽屉状态。
- `apps/web/src/app/App.test.tsx`
  - 更新为 Clawee 桌面 UI 断言，不再期待四栏工作台。
- `apps/web/src/components/layout/WorkbenchLayout.tsx`
  - 从四栏 layout 改成左侧栏 + 主区域 + 可选右侧抽屉。
- `apps/web/src/components/layout/WorkbenchLayout.test.tsx`
  - 更新布局测试。
- `apps/web/src/components/timeline/Timeline.tsx`
  - 将 assistant title 从 Codex/Mock Agent 改为 Clawee，隐藏 raw 技术输出默认展示。
- `apps/web/src/components/timeline/Timeline.test.tsx`
  - 更新文案和变更卡/运行详情入口断言。
- `apps/web/src/features/runs/Composer.tsx`
  - 改成截图式大输入框，支持项目、权限、模型、上下文展示。
- `apps/web/src/features/runs/Composer.test.tsx`
  - 输入框上下文、权限、禁用态测试。
- `apps/web/src/features/settings/SettingsView.tsx`
  - 可删除或作为兼容 re-export 到 `ClaweeSettingsView`。
- `apps/web/src/features/settings/SettingsView.test.tsx`
  - 替换为新设置测试，或迁移到 `ClaweeSettingsView.test.tsx` 后删除。
- `apps/web/src/styles/app.css`
  - 重写桌面 App 布局和视觉样式。
- `apps/web/src/styles/tokens.css`
  - 调整颜色、尺寸、字体 token。
- `apps/web/index.html`
  - title 改为 Clawee。

---

## Task 1: 项目与会话 UI 模型

**Files:**
- Create: `apps/web/src/features/projects/project-model.ts`
- Create: `apps/web/src/features/projects/project-model.test.ts`
- Modify: `apps/web/src/app/app-state.ts`
- Test: `apps/web/src/app/app-state.test.ts`

- [ ] **Step 1: 写项目模型测试**

创建 `apps/web/src/features/projects/project-model.test.ts`，覆盖默认项目、项目查找和最近对话：

```ts
import { describe, expect, it } from 'vitest';
import { createDefaultProjects, findProjectById, listRecentConversations } from './project-model.js';

describe('project-model', () => {
  it('creates Clawee default projects with content-design selected by default', () => {
    const projects = createDefaultProjects();

    expect(projects.map(project => project.name)).toEqual([
      'Playground',
      'content-design',
      'bili',
      'default',
      'feigua',
      'cover'
    ]);
    expect(projects.find(project => project.id === 'content-design')?.cwd).toContain('content-design');
  });

  it('finds a project by id and returns undefined for missing ids', () => {
    const projects = createDefaultProjects();

    expect(findProjectById(projects, 'bili')?.name).toBe('bili');
    expect(findProjectById(projects, 'missing')).toBeUndefined();
  });

  it('lists recent conversations sorted newest first', () => {
    const conversations = listRecentConversations();

    expect(conversations.map(conversation => conversation.title)).toEqual([
      '分析 Codex 接入方案',
      '分析打包后使用困难',
      '评审项目设计',
      '检查竖屏字幕进度',
      '查看最新git更新'
    ]);
    expect(conversations[0]?.projectId).toBe('content-design');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @clawee/web test -- src/features/projects/project-model.test.ts
```

Expected: FAIL，提示找不到 `project-model.js` 或导出函数。

- [ ] **Step 3: 实现项目模型**

创建 `apps/web/src/features/projects/project-model.ts`：

```ts
export type ProjectPermission = 'follow-global' | 'workspace-write' | 'danger-full-access';

export type ClaweeProject = {
  id: string;
  name: string;
  cwd: string;
  pinned: boolean;
  defaultProfile: string;
  defaultModel: string;
  defaultReasoning: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  defaultSandbox: ProjectPermission;
};

export type ClaweeConversation = {
  id: string;
  projectId: string;
  threadId: string;
  title: string;
  relativeTime: string;
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
};

export function createDefaultProjects(): ClaweeProject[] {
  const names = ['Playground', 'content-design', 'bili', 'default', 'feigua', 'cover'];
  return names.map(name => ({
    id: name,
    name,
    cwd: `/Users/wulien/develop/${name}`,
    pinned: true,
    defaultProfile: 'default',
    defaultModel: '5.5',
    defaultReasoning: 'xhigh',
    defaultSandbox: name === 'content-design' ? 'danger-full-access' : 'follow-global'
  }));
}

export function findProjectById(projects: ClaweeProject[], projectId: string): ClaweeProject | undefined {
  return projects.find(project => project.id === projectId);
}

export function listRecentConversations(): ClaweeConversation[] {
  return [
    {
      id: 'conv_codex_runtime',
      projectId: 'content-design',
      threadId: 'thread_codex_runtime',
      title: '分析 Codex 接入方案',
      relativeTime: '4 天',
      status: 'idle'
    },
    {
      id: 'conv_packaging',
      projectId: 'content-design',
      threadId: 'thread_packaging',
      title: '分析打包后使用困难',
      relativeTime: '5 天',
      status: 'idle'
    },
    {
      id: 'conv_review',
      projectId: 'content-design',
      threadId: 'thread_review',
      title: '评审项目设计',
      relativeTime: '1 周',
      status: 'idle'
    },
    {
      id: 'conv_subtitle',
      projectId: 'content-design',
      threadId: 'thread_subtitle',
      title: '检查竖屏字幕进度',
      relativeTime: '1 周',
      status: 'idle'
    },
    {
      id: 'conv_git',
      projectId: 'content-design',
      threadId: 'thread_git',
      title: '查看最新git更新',
      relativeTime: '3 周',
      status: 'idle'
    }
  ];
}
```

- [ ] **Step 4: 扩展 app state 测试**

修改 `apps/web/src/app/app-state.test.ts`，新增断言：

```ts
it('tracks current project and active view', () => {
  const selectedProject = reduceAppState(initialAppState, { type: 'select_project', projectId: 'bili' });
  expect(selectedProject.currentProjectId).toBe('bili');
  expect(selectedProject.activeView).toBe('conversation');

  const settings = reduceAppState(selectedProject, { type: 'open_settings' });
  expect(settings.activeView).toBe('settings');

  const returned = reduceAppState(settings, { type: 'back_to_app' });
  expect(returned.activeView).toBe('conversation');
});
```

- [ ] **Step 5: 实现 app state 扩展**

修改 `apps/web/src/app/app-state.ts`：

```ts
import type { PublicRunStatus } from '@clawee/protocol';

export type RightPanelMode = 'closed' | 'file' | 'change' | 'run_detail';
export type ActiveView = 'conversation' | 'search' | 'schedules' | 'plugins' | 'settings';

export type AppState = {
  activeView: ActiveView;
  currentProjectId: string;
  selectedThreadId?: string;
  selectedRunId?: string;
  selectedFilePath: string;
  selectedChangeId?: string;
  rightPanelMode: RightPanelMode;
  activeRunByThreadId: Record<string, string>;
  currentSseRunId?: string;
};

export type AppAction =
  | { type: 'select_project'; projectId: string }
  | { type: 'set_active_view'; view: ActiveView }
  | { type: 'open_settings' }
  | { type: 'back_to_app' }
  | { type: 'select_thread'; threadId: string }
  | { type: 'select_file'; path: string }
  | { type: 'select_change'; changeId: string }
  | { type: 'select_run_detail'; runId: string }
  | { type: 'close_detail' }
  | { type: 'run_started'; threadId: string; runId: string; status: PublicRunStatus }
  | { type: 'run_done'; threadId: string; runId: string };

export const initialAppState: AppState = {
  activeView: 'conversation',
  currentProjectId: 'content-design',
  selectedFilePath: 'docs/atoms.md',
  rightPanelMode: 'closed',
  activeRunByThreadId: {}
};

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'select_project':
      return { ...state, currentProjectId: action.projectId, activeView: 'conversation', rightPanelMode: 'closed' };
    case 'set_active_view':
      return { ...state, activeView: action.view, rightPanelMode: action.view === 'conversation' ? state.rightPanelMode : 'closed' };
    case 'open_settings':
      return { ...state, activeView: 'settings', rightPanelMode: 'closed' };
    case 'back_to_app':
      return { ...state, activeView: 'conversation' };
    case 'select_thread':
      return { ...state, selectedThreadId: action.threadId, activeView: 'conversation' };
    case 'select_file':
      return { ...state, selectedFilePath: action.path, rightPanelMode: 'file' };
    case 'select_change':
      return { ...state, selectedChangeId: action.changeId, rightPanelMode: 'change' };
    case 'select_run_detail':
      return { ...state, selectedRunId: action.runId, rightPanelMode: 'run_detail' };
    case 'close_detail':
      return { ...state, rightPanelMode: 'closed' };
    case 'run_started':
      if (action.status === 'succeeded' || action.status === 'failed' || action.status === 'canceled') return state;
      return { ...state, activeRunByThreadId: { ...state.activeRunByThreadId, [action.threadId]: action.runId } };
    case 'run_done': {
      const next = { ...state.activeRunByThreadId };
      if (next[action.threadId] === action.runId) delete next[action.threadId];
      return { ...state, activeRunByThreadId: next };
    }
  }
}
```

- [ ] **Step 6: 运行相关测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/features/projects/project-model.test.ts src/app/app-state.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/features/projects/project-model.ts apps/web/src/features/projects/project-model.test.ts apps/web/src/app/app-state.ts apps/web/src/app/app-state.test.ts
git commit -m "feat(web): add Clawee project UI model"
```

---

## Task 2: 桌面 App 布局 Shell

**Files:**
- Modify: `apps/web/src/components/layout/WorkbenchLayout.tsx`
- Modify: `apps/web/src/components/layout/WorkbenchLayout.test.tsx`
- Create: `apps/web/src/features/shell/ClaweeSidebar.tsx`
- Create: `apps/web/src/features/shell/ClaweeSidebar.test.tsx`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: 写布局测试**

更新 `apps/web/src/components/layout/WorkbenchLayout.test.tsx`，断言只有左侧栏、主区域、可选详情抽屉，不再有常驻文件树第四栏：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkbenchLayout } from './WorkbenchLayout.js';

describe('WorkbenchLayout', () => {
  it('renders Clawee desktop shell with optional detail panel', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>侧栏</div>}
        main={<div>主对话</div>}
        detail={<div>详情</div>}
        detailOpen={true}
      />
    );

    expect(screen.getByRole('complementary', { name: 'Clawee 导航' })).toHaveTextContent('侧栏');
    expect(screen.getByRole('main', { name: 'Clawee 工作区' })).toHaveTextContent('主对话');
    expect(screen.getByRole('complementary', { name: '详情' })).toHaveTextContent('详情');
  });

  it('hides the detail panel when closed', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>侧栏</div>}
        main={<div>主对话</div>}
        detail={<div>详情</div>}
        detailOpen={false}
      />
    );

    expect(screen.queryByRole('complementary', { name: '详情' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 修改布局组件**

将 `apps/web/src/components/layout/WorkbenchLayout.tsx` 改为：

```tsx
import type { ReactNode } from 'react';

export function WorkbenchLayout(props: {
  sidebar: ReactNode;
  main: ReactNode;
  detail?: ReactNode;
  detailOpen?: boolean;
}) {
  return (
    <main className={`clawee-shell ${props.detailOpen ? 'has-detail' : ''}`}>
      <aside className="clawee-sidebar-pane" aria-label="Clawee 导航">
        {props.sidebar}
      </aside>
      <section className="clawee-main-pane" aria-label="Clawee 工作区">
        {props.main}
      </section>
      {props.detailOpen ? (
        <aside className="clawee-detail-pane" aria-label="详情">
          {props.detail}
        </aside>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 3: 写侧栏测试**

创建 `apps/web/src/features/shell/ClaweeSidebar.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultProjects, listRecentConversations } from '../projects/project-model.js';
import { ClaweeSidebar } from './ClaweeSidebar.js';

describe('ClaweeSidebar', () => {
  it('renders global actions, projects, conversations and bottom actions', () => {
    render(
      <ClaweeSidebar
        projects={createDefaultProjects()}
        conversations={listRecentConversations()}
        currentProjectId="content-design"
        activeView="conversation"
        onNewConversation={() => undefined}
        onSelectProject={() => undefined}
        onSelectConversation={() => undefined}
        onOpenView={() => undefined}
        onOpenSettings={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '新对话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜索' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已安排' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByText('项目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'content-design' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /分析 Codex 接入方案/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置 账户' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新' })).toBeInTheDocument();
  });

  it('calls handlers for project and settings actions', async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <ClaweeSidebar
        projects={createDefaultProjects()}
        conversations={listRecentConversations()}
        currentProjectId="content-design"
        activeView="conversation"
        onNewConversation={() => undefined}
        onSelectProject={onSelectProject}
        onSelectConversation={() => undefined}
        onOpenView={() => undefined}
        onOpenSettings={onOpenSettings}
      />
    );

    await user.click(screen.getByRole('button', { name: 'bili' }));
    await user.click(screen.getByRole('button', { name: '设置 账户' }));

    expect(onSelectProject).toHaveBeenCalledWith('bili');
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: 实现侧栏**

创建 `apps/web/src/features/shell/ClaweeSidebar.tsx`：

```tsx
import { CalendarClock, MessageSquarePlus, Plug, Search, Settings, SquarePen } from 'lucide-react';
import type { ActiveView } from '../../app/app-state.js';
import type { ClaweeConversation, ClaweeProject } from '../projects/project-model.js';

type ClaweeSidebarProps = {
  projects: ClaweeProject[];
  conversations: ClaweeConversation[];
  currentProjectId: string;
  activeView: ActiveView;
  onNewConversation(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenSettings(): void;
};

export function ClaweeSidebar(props: ClaweeSidebarProps) {
  return (
    <div className="clawee-sidebar">
      <div className="window-controls" aria-hidden="true">
        <span className="traffic-light red" />
        <span className="traffic-light yellow" />
        <span className="traffic-light green" />
      </div>

      <nav className="sidebar-primary" aria-label="全局导航">
        <button type="button" onClick={props.onNewConversation}>
          <SquarePen size={18} />
          <span>新对话</span>
        </button>
        <button type="button" aria-current={props.activeView === 'search'} onClick={() => props.onOpenView('search')}>
          <Search size={18} />
          <span>搜索</span>
        </button>
        <button type="button" aria-current={props.activeView === 'schedules'} onClick={() => props.onOpenView('schedules')}>
          <CalendarClock size={18} />
          <span>已安排</span>
        </button>
        <button type="button" aria-current={props.activeView === 'plugins'} onClick={() => props.onOpenView('plugins')}>
          <Plug size={18} />
          <span>插件</span>
        </button>
      </nav>

      <div className="sidebar-scroll">
        <section className="sidebar-section" aria-label="项目">
          <h2>项目</h2>
          {props.projects.map(project => (
            <button
              type="button"
              key={project.id}
              className="sidebar-row"
              aria-current={props.currentProjectId === project.id}
              onClick={() => props.onSelectProject(project.id)}
            >
              <span className="row-icon">▣</span>
              <span>{project.name}</span>
            </button>
          ))}
        </section>

        <section className="sidebar-section" aria-label="对话">
          <h2>对话</h2>
          {props.conversations.length === 0 ? (
            <p className="sidebar-empty">暂无聊天</p>
          ) : (
            props.conversations.map(conversation => (
              <button
                type="button"
                key={conversation.id}
                className="sidebar-row conversation-row"
                onClick={() => props.onSelectConversation(conversation.id)}
              >
                <span>{conversation.title}</span>
                <time>{conversation.relativeTime}</time>
              </button>
            ))
          )}
        </section>
      </div>

      <div className="sidebar-bottom">
        <button type="button" className="settings-button" aria-label="设置 账户" onClick={props.onOpenSettings}>
          <span className="settings-avatar">设</span>
          <span>
            <strong>设置</strong>
            <small>账户</small>
          </span>
        </button>
        <button type="button" className="update-button">更新</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 添加基础布局样式**

在 `apps/web/src/styles/app.css` 中新增或替换与 shell/sidebar 相关样式：

```css
.clawee-shell {
  width: 100vw;
  height: 100vh;
  min-height: 680px;
  display: grid;
  grid-template-columns: 252px minmax(720px, 1fr);
  overflow: hidden;
  background: #fbfbfa;
}

.clawee-shell.has-detail {
  grid-template-columns: 252px minmax(520px, 1fr) minmax(420px, 38vw);
}

.clawee-sidebar-pane,
.clawee-main-pane,
.clawee-detail-pane {
  min-width: 0;
  min-height: 0;
}

.clawee-sidebar-pane {
  background: #dbe8ec;
  border-right: 1px solid rgba(46, 64, 71, 0.12);
}

.clawee-main-pane,
.clawee-detail-pane {
  background: #fbfbfa;
}

.clawee-detail-pane {
  border-left: 1px solid #e7e4de;
}

.clawee-sidebar {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  padding: 14px 8px 10px;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 28px;
  padding-left: 6px;
}

.traffic-light {
  width: 12px;
  height: 12px;
  border-radius: 999px;
}

.traffic-light.red { background: #ff5f57; }
.traffic-light.yellow { background: #febc2e; }
.traffic-light.green { background: #28c840; }

.sidebar-primary,
.sidebar-section {
  display: grid;
  gap: 4px;
}

.sidebar-primary {
  padding: 10px 2px 22px;
}

.sidebar-primary button,
.sidebar-row {
  min-height: 34px;
  width: 100%;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  padding: 0 10px;
  color: #243136;
  font-size: 14px;
  font-weight: 650;
  text-align: left;
}

.sidebar-primary button:hover,
.sidebar-row:hover,
.sidebar-primary button[aria-current="true"],
.sidebar-row[aria-current="true"] {
  background: rgba(55, 76, 84, 0.09);
}

.sidebar-scroll {
  min-height: 0;
  overflow: auto;
}

.sidebar-section {
  margin-bottom: 22px;
}

.sidebar-section h2 {
  margin: 0 0 8px;
  padding: 0 10px;
  color: rgba(36, 49, 54, 0.46);
  font-size: 13px;
  font-weight: 700;
}

.conversation-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.conversation-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-row time {
  color: rgba(36, 49, 54, 0.48);
}

.sidebar-empty {
  margin: 0;
  padding: 8px 10px;
  color: rgba(36, 49, 54, 0.42);
}

.sidebar-bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 10px 4px 0;
  border-top: 1px solid rgba(46, 64, 71, 0.1);
}

.settings-button {
  min-width: 0;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  text-align: left;
}

.settings-avatar {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #d7c8ff;
  color: #7657d8;
  font-weight: 800;
}

.settings-button strong,
.settings-button small {
  display: block;
}

.settings-button small {
  color: rgba(36, 49, 54, 0.5);
}

.update-button {
  height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: #3aa0ff;
  color: #fff;
  font-weight: 750;
}
```

- [ ] **Step 6: 运行测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/components/layout/WorkbenchLayout.test.tsx src/features/shell/ClaweeSidebar.test.tsx
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src/components/layout/WorkbenchLayout.tsx apps/web/src/components/layout/WorkbenchLayout.test.tsx apps/web/src/features/shell/ClaweeSidebar.tsx apps/web/src/features/shell/ClaweeSidebar.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): add Clawee desktop shell"
```

---

## Task 3: 主会话页和输入框

**Files:**
- Create: `apps/web/src/features/conversation/ConversationHeader.tsx`
- Create: `apps/web/src/features/conversation/ConversationHeader.test.tsx`
- Create: `apps/web/src/features/conversation/ConversationEmptyState.tsx`
- Create: `apps/web/src/features/conversation/ConversationEmptyState.test.tsx`
- Modify: `apps/web/src/features/runs/Composer.tsx`
- Modify: `apps/web/src/features/runs/Composer.test.tsx`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: 写 ConversationHeader 测试**

创建 `apps/web/src/features/conversation/ConversationHeader.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationHeader } from './ConversationHeader.js';

describe('ConversationHeader', () => {
  it('renders the conversation title and open location action', async () => {
    const user = userEvent.setup();
    const onOpenLocation = vi.fn();

    render(
      <ConversationHeader
        title="分析 Codex 接入方案"
        projectName="content-design"
        onOpenLocation={onOpenLocation}
        onToggleDetail={() => undefined}
      />
    );

    expect(screen.getByRole('heading', { name: '分析 Codex 接入方案' })).toBeInTheDocument();
    expect(screen.getByText('content-design')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '打开位置' }));
    expect(onOpenLocation).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 实现 ConversationHeader**

创建 `apps/web/src/features/conversation/ConversationHeader.tsx`：

```tsx
import { FolderOpen, LayoutList } from 'lucide-react';

export function ConversationHeader(props: {
  title: string;
  projectName: string;
  onOpenLocation(): void;
  onToggleDetail(): void;
}) {
  return (
    <header className="conversation-header">
      <div className="conversation-title">
        <span className="conversation-title-icon">▣</span>
        <h1>{props.title}</h1>
      </div>
      <div className="conversation-actions">
        <button type="button" className="toolbar-button" onClick={props.onOpenLocation}>
          <FolderOpen size={16} />
          <span>打开位置</span>
        </button>
        <button type="button" className="icon-button" aria-label="详情" onClick={props.onToggleDetail}>
          <LayoutList size={18} />
        </button>
      </div>
      <span className="conversation-project">{props.projectName}</span>
    </header>
  );
}
```

- [ ] **Step 3: 写空状态测试**

创建 `apps/web/src/features/conversation/ConversationEmptyState.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationEmptyState } from './ConversationEmptyState.js';

describe('ConversationEmptyState', () => {
  it('uses the current project in the empty state prompt', () => {
    render(<ConversationEmptyState projectName="content-design" />);
    expect(screen.getByRole('heading', { name: '要在 content-design 中处理什么？' })).toBeInTheDocument();
  });

  it('falls back to the generic Clawee prompt without a project', () => {
    render(<ConversationEmptyState />);
    expect(screen.getByRole('heading', { name: '今天要让 Clawee 处理什么？' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 实现空状态**

创建 `apps/web/src/features/conversation/ConversationEmptyState.tsx`：

```tsx
export function ConversationEmptyState(props: { projectName?: string }) {
  const title = props.projectName === undefined
    ? '今天要让 Clawee 处理什么？'
    : `要在 ${props.projectName} 中处理什么？`;

  return (
    <div className="conversation-empty-state">
      <h2>{title}</h2>
    </div>
  );
}
```

- [ ] **Step 5: 写 Composer 测试**

更新 `apps/web/src/features/runs/Composer.test.tsx`，覆盖上下文和权限：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

describe('Composer', () => {
  it('renders Clawee composer context and submits trimmed prompt', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <Composer
        projectName="content-design"
        branchName="open-clawee"
        permission="danger-full-access"
        modelLabel="5.5 超高"
        disabled={false}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText('content-design')).toBeInTheDocument();
    expect(screen.getByText('本地模式')).toBeInTheDocument();
    expect(screen.getByText('open-clawee')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完全访问' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5.5 超高' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '输入任务' }), '  整理日报  ');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSubmit).toHaveBeenCalledWith('整理日报');
  });

  it('shows running placeholder and disables submit while busy', () => {
    render(
      <Composer
        projectName="content-design"
        branchName="open-clawee"
        permission="danger-full-access"
        modelLabel="5.5 超高"
        disabled={true}
        onSubmit={() => undefined}
      />
    );

    expect(screen.getByPlaceholderText('当前对话有任务运行中')).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  });
});
```

- [ ] **Step 6: 实现 Composer**

修改 `apps/web/src/features/runs/Composer.tsx`：

```tsx
import { ShieldAlert, Plus, Send, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { ProjectPermission } from '../projects/project-model.js';

function permissionLabel(permission: ProjectPermission): string {
  if (permission === 'danger-full-access') return '完全访问';
  if (permission === 'workspace-write') return '工作区读写';
  return '跟随全局配置';
}

export function Composer(props: {
  disabled?: boolean;
  projectName: string;
  branchName: string;
  permission: ProjectPermission;
  modelLabel: string;
  onSubmit(prompt: string): void;
}) {
  const [prompt, setPrompt] = useState('');
  const trimmed = prompt.trim();

  return (
    <form
      className="clawee-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.disabled || trimmed.length === 0) return;
        props.onSubmit(trimmed);
        setPrompt('');
      }}
    >
      <textarea
        aria-label="输入任务"
        value={prompt}
        disabled={props.disabled}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={props.disabled ? '当前对话有任务运行中' : '随心输入'}
      />
      <div className="composer-toolbar">
        <div className="composer-left-actions">
          <button type="button" className="composer-icon-button" aria-label="添加">
            <Plus size={20} />
          </button>
          <button type="button" className="composer-pill warning">
            <ShieldAlert size={16} />
            <span>{permissionLabel(props.permission)}</span>
          </button>
        </div>
        <div className="composer-right-actions">
          <button type="button" className="composer-pill">{props.modelLabel}</button>
          <button type="submit" className="composer-send" aria-label="发送" disabled={props.disabled || trimmed.length === 0}>
            <Send size={18} />
          </button>
        </div>
      </div>
      <div className="composer-context">
        <span>▣ {props.projectName}</span>
        <span>▭ 本地模式</span>
        <span><GitBranch size={14} /> {props.branchName}</span>
      </div>
    </form>
  );
}
```

- [ ] **Step 7: 添加主会话样式**

在 `apps/web/src/styles/app.css` 添加：

```css
.conversation-page {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.conversation-header {
  min-height: 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border-bottom: 1px solid #ece9e3;
}

.conversation-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.conversation-title h1 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  line-height: 1.2;
}

.conversation-project {
  grid-column: 1 / -1;
  margin-top: -12px;
  color: #8d8a84;
  font-size: 12px;
}

.conversation-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-button,
.icon-button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #e4e0d8;
  border-radius: 8px;
  background: #fff;
  color: #292b2f;
  font-weight: 650;
}

.toolbar-button {
  padding: 0 12px;
}

.icon-button {
  width: 34px;
}

.conversation-body {
  min-height: 0;
  overflow: auto;
  display: grid;
}

.conversation-empty-state {
  align-self: center;
  justify-self: center;
  width: min(980px, calc(100% - 48px));
  text-align: center;
  padding-bottom: 96px;
}

.conversation-empty-state h2 {
  margin: 0;
  font-size: 30px;
  line-height: 1.25;
  font-weight: 720;
  letter-spacing: 0;
}

.composer-wrap {
  padding: 0 32px 34px;
}

.clawee-composer {
  width: min(980px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-rows: minmax(80px, auto) auto auto;
  border: 1px solid #e7e3dc;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 18px 42px rgba(26, 28, 32, 0.08);
  overflow: hidden;
}

.clawee-composer textarea {
  width: 100%;
  min-height: 86px;
  resize: vertical;
  border: 0;
  padding: 18px;
  color: #27292d;
  font-size: 15px;
  outline: none;
}

.clawee-composer textarea::placeholder {
  color: #b7b2aa;
}

.composer-toolbar,
.composer-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.composer-toolbar {
  padding: 0 14px 10px;
}

.composer-left-actions,
.composer-right-actions,
.composer-context {
  display: flex;
  align-items: center;
  gap: 10px;
}

.composer-icon-button,
.composer-send {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 999px;
}

.composer-send {
  background: #999;
  color: #fff;
}

.composer-send:not(:disabled) {
  background: #8b8d91;
}

.composer-pill {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 0 10px;
  color: #5b5b5b;
  font-weight: 650;
}

.composer-pill.warning {
  color: #ff6b2b;
}

.composer-context {
  justify-content: flex-start;
  padding: 10px 18px;
  background: #f4f3f1;
  color: #8b8883;
  font-size: 13px;
}

.composer-context span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
```

- [ ] **Step 8: 运行测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/features/conversation/ConversationHeader.test.tsx src/features/conversation/ConversationEmptyState.test.tsx src/features/runs/Composer.test.tsx
```

Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/web/src/features/conversation apps/web/src/features/runs/Composer.tsx apps/web/src/features/runs/Composer.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): add Clawee conversation surface"
```

---

## Task 4: Timeline 品牌和任务卡

**Files:**
- Modify: `apps/web/src/components/timeline/Timeline.tsx`
- Modify: `apps/web/src/components/timeline/Timeline.test.tsx`
- Modify: `apps/web/src/components/timeline/timeline-model.ts`
- Modify: `apps/web/src/components/timeline/timeline-model.test.ts`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: 写 timeline 品牌测试**

更新 `apps/web/src/components/timeline/Timeline.test.tsx`，新增：

```tsx
it('labels assistant messages as Clawee and avoids Codex branding', () => {
  render(
    <Timeline
      items={[
        {
          kind: 'assistant_message',
          id: 'assistant_1',
          text: '已完成分析',
          source: 'runtime'
        }
      ]}
    />
  );

  expect(screen.getByText('Clawee')).toBeInTheDocument();
  expect(screen.queryByText('Codex')).not.toBeInTheDocument();
});

it('renders change cards with a review action', async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();

  render(
    <Timeline
      items={[
        {
          kind: 'change_card',
          id: 'change_1',
          title: '已编辑 atoms.md',
          path: 'docs/atoms.md',
          delta: '+903 -0',
          source: 'mock'
        }
      ]}
      onOpenChange={onOpenChange}
    />
  );

  await user.click(screen.getByRole('button', { name: '审查' }));
  expect(onOpenChange).toHaveBeenCalledWith('change_1');
});
```

确保测试文件 import：

```ts
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
```

- [ ] **Step 2: 修改 Timeline props 和文案**

修改 `apps/web/src/components/timeline/Timeline.tsx`：

```tsx
import type { TimelineItem } from './timeline-model.js';

function canOpenRunDetail(item: TimelineItem): item is TimelineItem & { runId: string } {
  if (!('runId' in item)) return false;
  return item.source === 'runtime' && typeof item.runId === 'string' && item.runId.length > 0;
}

function getTimelineTitle(item: TimelineItem): string {
  switch (item.kind) {
    case 'user_message':
      return '你';
    case 'assistant_message':
      return 'Clawee';
    case 'tool_step':
      return `本地能力 ${item.name}`;
    case 'change_card':
      return '文件变更';
    case 'diagnostic':
      return item.severity === 'error' ? '错误' : '诊断';
    case 'run_status':
      return `运行 ${item.label}`;
    case 'done':
      return `完成 ${item.status}`;
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function getTimelineAvatar(item: TimelineItem): string {
  if (item.kind === 'user_message') return '你';
  if (item.kind === 'change_card') return '文';
  if (item.kind === 'diagnostic') return '!';
  if (item.kind === 'run_status') return '●';
  if (item.kind === 'done') return '✓';
  return 'C';
}

function renderTimelineItemContent(item: TimelineItem, onOpenChange?: (changeId: string) => void) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return <p>{item.text}</p>;
    case 'tool_step':
      return <p>{item.name}</p>;
    case 'change_card':
      return (
        <div className="change-card-content">
          <div>
            <strong>{item.title}</strong>
            <span>{item.path}</span>
            <em>{item.delta}</em>
          </div>
          {onOpenChange ? (
            <button type="button" className="inline-action" onClick={() => onOpenChange(item.id)}>
              审查
            </button>
          ) : null}
        </div>
      );
    case 'diagnostic':
      return (
        <>
          <p>{item.message}</p>
          <pre>{item.content}</pre>
        </>
      );
    case 'run_status':
      return <p>{item.label}</p>;
    case 'done':
      return (
        <>
          <p>{item.status}</p>
          {item.terminationReason ? <p>{item.terminationReason}</p> : null}
        </>
      );
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

export function Timeline(props: {
  items: TimelineItem[];
  onOpenRunDetail?(runId: string): void;
  onOpenChange?(changeId: string): void;
}) {
  return (
    <div className="timeline-list">
      {props.items.length === 0 ? (
        <div className="timeline-empty">
          <strong>暂无任务记录</strong>
          <span>发送任务后，Clawee 会在这里展示处理过程和结果。</span>
        </div>
      ) : (
        <div className="timeline-stack">
          {props.items.map(item => (
            <article key={item.id} className={`timeline-item timeline-${item.kind}`}>
              <div className="timeline-item-header">
                <span className="timeline-avatar">{getTimelineAvatar(item)}</span>
                <span className="timeline-kind">{getTimelineTitle(item)}</span>
              </div>
              <div className="timeline-bubble">
                {renderTimelineItemContent(item, props.onOpenChange)}
                {props.onOpenRunDetail && canOpenRunDetail(item) ? (
                  <button type="button" className="inline-action" onClick={() => props.onOpenRunDetail?.(item.runId)}>
                    查看运行详情
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 保持 event mapping 测试通过**

如果 `timeline-model.test.ts` 断言了 `content` 原始 payload，保留 `timeline-model.ts` 当前结构，不删除字段。Timeline 只是不默认展示 raw content。

- [ ] **Step 4: 添加 Timeline 样式**

在 `apps/web/src/styles/app.css` 添加或调整：

```css
.timeline-list {
  min-height: 0;
  overflow: auto;
  padding: 28px 32px;
}

.timeline-stack {
  width: min(860px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 20px;
}

.timeline-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: #98948c;
  text-align: center;
}

.timeline-item {
  display: grid;
  gap: 8px;
}

.timeline-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8b8882;
  font-size: 13px;
}

.timeline-avatar {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #ece9e2;
  color: #4a4946;
  font-size: 12px;
  font-weight: 800;
}

.timeline-bubble {
  width: fit-content;
  max-width: min(760px, 100%);
  border-radius: 12px;
  padding: 12px 14px;
  background: #fff;
  color: #292b2f;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.timeline-user_message .timeline-bubble {
  justify-self: end;
  background: #f0f0ee;
}

.timeline-bubble p {
  margin: 0;
}

.timeline-bubble pre {
  max-width: 100%;
  overflow: auto;
  margin: 10px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: #f6f5f2;
  color: #5f5d58;
}

.change-card-content {
  min-width: min(520px, 70vw);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
}

.change-card-content strong,
.change-card-content span,
.change-card-content em {
  display: block;
}

.change-card-content span {
  color: #77736b;
}

.change-card-content em {
  color: #19a45b;
  font-style: normal;
}
```

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/components/timeline
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/timeline apps/web/src/styles/app.css
git commit -m "feat(web): align timeline with Clawee task flow"
```

---

## Task 5: 右侧详情抽屉

**Files:**
- Create: `apps/web/src/features/details/DetailPanel.tsx`
- Create: `apps/web/src/features/details/DetailPanel.test.tsx`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: 写 DetailPanel 测试**

创建 `apps/web/src/features/details/DetailPanel.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DetailPanel } from './DetailPanel.js';

describe('DetailPanel', () => {
  it('renders file preview mode', () => {
    render(
      <DetailPanel
        mode="file"
        title="atoms.md"
        subtitle="content-design > docs > atoms.md"
        content="# First-party atom catalog"
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole('heading', { name: 'atoms.md' })).toBeInTheDocument();
    expect(screen.getByText('# First-party atom catalog')).toBeInTheDocument();
  });

  it('renders change review mode and calls review actions', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onRevert = vi.fn();

    render(
      <DetailPanel
        mode="change"
        title="已编辑 atoms.md"
        subtitle="+903 -0"
        content="docs/atoms.md"
        onApprove={onApprove}
        onRevert={onRevert}
        onClose={() => undefined}
      />
    );

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '审核' }));

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('renders run detail mode', () => {
    render(
      <DetailPanel
        mode="run"
        title="运行详情"
        subtitle="run_1"
        content="状态：succeeded"
        onClose={() => undefined}
      />
    );

    expect(screen.getByRole('heading', { name: '运行详情' })).toBeInTheDocument();
    expect(screen.getByText('状态：succeeded')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 实现 DetailPanel**

创建 `apps/web/src/features/details/DetailPanel.tsx`：

```tsx
import { Check, RotateCcw, X } from 'lucide-react';

type DetailPanelProps = {
  mode: 'file' | 'change' | 'run';
  title: string;
  subtitle?: string;
  content: string;
  onClose(): void;
  onApprove?(): void;
  onRevert?(): void;
};

export function DetailPanel(props: DetailPanelProps) {
  return (
    <div className={`detail-panel detail-${props.mode}`}>
      <header className="detail-header">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle ? <p>{props.subtitle}</p> : null}
        </div>
        <button type="button" className="icon-button" aria-label="关闭详情" onClick={props.onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="detail-content">
        <pre>{props.content}</pre>
      </div>
      {props.mode === 'change' ? (
        <footer className="detail-actions">
          <button type="button" className="toolbar-button" onClick={props.onRevert}>
            <RotateCcw size={16} />
            <span>撤销</span>
          </button>
          <button type="button" className="toolbar-button primary" onClick={props.onApprove}>
            <Check size={16} />
            <span>审核</span>
          </button>
        </footer>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: 添加详情样式**

在 `apps/web/src/styles/app.css` 添加：

```css
.detail-panel {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: #fbfbfa;
}

.detail-header {
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid #e8e4dd;
}

.detail-header h2,
.detail-header p {
  margin: 0;
}

.detail-header h2 {
  font-size: 16px;
}

.detail-header p {
  color: #8b8882;
}

.detail-content {
  min-height: 0;
  overflow: auto;
  padding: 22px;
}

.detail-content pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: 13px/1.55 var(--font-mono);
}

.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid #e8e4dd;
}

.toolbar-button.primary {
  border-color: #292b2f;
  background: #292b2f;
  color: #fff;
}
```

- [ ] **Step 4: 运行测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/features/details/DetailPanel.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/details/DetailPanel.tsx apps/web/src/features/details/DetailPanel.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): add Clawee detail panel"
```

---

## Task 6: 极简设置页

**Files:**
- Create: `apps/web/src/features/settings/ClaweeSettingsView.tsx`
- Create: `apps/web/src/features/settings/ClaweeSettingsView.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsView.tsx`
- Modify: `apps/web/src/features/settings/SettingsView.test.tsx`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: 写设置页测试**

创建 `apps/web/src/features/settings/ClaweeSettingsView.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClaweeSettingsView } from './ClaweeSettingsView.js';

describe('ClaweeSettingsView', () => {
  it('renders simplified settings navigation and default general settings', () => {
    render(
      <ClaweeSettingsView
        runtimeStatus={{
          connected: true,
          runtimeVersion: '0.1.0',
          codexVersion: 'codex-cli test',
          codexPath: '/usr/local/bin/codex',
          codexHome: '/Users/wulien/.codex',
          lastCheckedAt: '2026-07-07 10:00'
        }}
        onBack={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: '返回应用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '常规' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关于 Clawee' })).toBeInTheDocument();
    expect(screen.getByText('默认权限')).toBeInTheDocument();
    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(screen.getByText('中文')).toBeInTheDocument();
    expect(screen.queryByText('工作模式')).not.toBeInTheDocument();
    expect(screen.queryByText('适用于编程')).not.toBeInTheDocument();
  });

  it('shows Codex CLI only in about advanced information', async () => {
    const user = userEvent.setup();

    render(
      <ClaweeSettingsView
        runtimeStatus={{
          connected: true,
          runtimeVersion: '0.1.0',
          codexVersion: 'codex-cli test',
          codexPath: '/usr/local/bin/codex',
          codexHome: '/Users/wulien/.codex',
          lastCheckedAt: '2026-07-07 10:00'
        }}
        onBack={() => undefined}
      />
    );

    expect(screen.queryByText('Codex CLI 版本')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关于 Clawee' }));

    expect(screen.getByText('Codex CLI 版本')).toBeInTheDocument();
    expect(screen.getByText('codex-cli test')).toBeInTheDocument();
    expect(screen.getByText('CODEX_HOME')).toBeInTheDocument();
  });

  it('calls back action', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();

    render(
      <ClaweeSettingsView
        runtimeStatus={{ connected: false }}
        onBack={onBack}
      />
    );

    await user.click(screen.getByRole('button', { name: '返回应用' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 实现 ClaweeSettingsView**

创建 `apps/web/src/features/settings/ClaweeSettingsView.tsx`：

```tsx
import { ArrowLeft, Info, Plug, Settings } from 'lucide-react';
import { useState } from 'react';

type SettingsTab = 'general' | 'plugins' | 'about';

type RuntimeStatus = {
  connected: boolean;
  runtimeVersion?: string;
  codexVersion?: string;
  codexPath?: string;
  codexHome?: string;
  lastCheckedAt?: string;
};

export function ClaweeSettingsView(props: { runtimeStatus: RuntimeStatus; onBack(): void }) {
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="window-controls" aria-hidden="true">
          <span className="traffic-light red" />
          <span className="traffic-light yellow" />
          <span className="traffic-light green" />
        </div>
        <button type="button" className="settings-back" onClick={props.onBack}>
          <ArrowLeft size={18} />
          <span>返回应用</span>
        </button>
        <label className="settings-search">
          <span>搜索设置...</span>
          <input aria-label="搜索设置" />
        </label>
        <nav className="settings-nav" aria-label="设置导航">
          <button type="button" aria-current={tab === 'general'} onClick={() => setTab('general')}>
            <Settings size={18} />
            <span>常规</span>
          </button>
          <button type="button" aria-current={tab === 'plugins'} onClick={() => setTab('plugins')}>
            <Plug size={18} />
            <span>插件</span>
          </button>
          <button type="button" aria-current={tab === 'about'} onClick={() => setTab('about')}>
            <Info size={18} />
            <span>关于 Clawee</span>
          </button>
        </nav>
      </aside>
      <main className="settings-content">
        {tab === 'general' ? <GeneralSettings /> : null}
        {tab === 'plugins' ? <PluginSettings connected={props.runtimeStatus.connected} /> : null}
        {tab === 'about' ? <AboutSettings runtimeStatus={props.runtimeStatus} /> : null}
      </main>
    </div>
  );
}

function GeneralSettings() {
  return (
    <section className="settings-section">
      <h1>常规</h1>
      <div className="settings-card">
        <SettingRow title="默认权限" description="新对话默认使用的本地访问权限" value="跟随全局配置" />
        <SettingRow title="默认文件打开方式" description="打开文件和文件夹的位置" value="VS Code" />
        <SettingRow title="语言" description="应用 UI 语言" value="中文" />
        <SettingRow title="菜单栏显示" description="关闭主窗口后，仍在菜单栏中保留 Clawee" value="开启" />
      </div>
    </section>
  );
}

function PluginSettings(props: { connected: boolean }) {
  return (
    <section className="settings-section">
      <h1>插件</h1>
      <div className="settings-card">
        <SettingRow title="Skills 状态" description="来自本机配置的技能能力" value={props.connected ? '可用' : '未检测'} />
        <SettingRow title="MCP 服务状态" description="来自本机配置的服务能力" value={props.connected ? '可用' : '未检测'} />
        <SettingRow title="最近检测时间" description="本地能力状态刷新时间" value="随应用启动检测" />
      </div>
    </section>
  );
}

function AboutSettings(props: { runtimeStatus: RuntimeStatus }) {
  return (
    <section className="settings-section">
      <h1>关于 Clawee</h1>
      <div className="settings-card">
        <SettingRow title="Clawee 版本" description="当前应用版本" value="0.1.0" />
        <SettingRow title="Runtime 版本" description="本地服务版本" value={props.runtimeStatus.runtimeVersion ?? '未检测'} />
        <SettingRow title="数据目录" description="Clawee 本地数据位置" value="应用数据目录" />
        <SettingRow title="检查更新" description="检查 Clawee 是否有新版本" value="可用" />
      </div>
      <h2>高级信息</h2>
      <div className="settings-card">
        <SettingRow title="Codex CLI 版本" description="底层运行内核版本" value={props.runtimeStatus.codexVersion ?? '未检测'} />
        <SettingRow title="Codex CLI 路径" description="底层运行内核路径" value={props.runtimeStatus.codexPath ?? '未检测'} />
        <SettingRow title="CODEX_HOME" description="底层配置目录" value={props.runtimeStatus.codexHome ?? '未检测'} />
        <SettingRow title="本地运行内核状态" description="Clawee 调用本机能力的状态" value={props.runtimeStatus.connected ? '正常' : '未连接'} />
        <SettingRow title="最近一次检测时间" description="状态刷新时间" value={props.runtimeStatus.lastCheckedAt ?? '未检测'} />
      </div>
    </section>
  );
}

function SettingRow(props: { title: string; description: string; value: string }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{props.title}</strong>
        <p>{props.description}</p>
      </div>
      <span>{props.value}</span>
    </div>
  );
}
```

- [ ] **Step 3: 保持 SettingsView 兼容**

将 `apps/web/src/features/settings/SettingsView.tsx` 改成 re-export，避免旧 import 断裂：

```tsx
export { ClaweeSettingsView as SettingsView } from './ClaweeSettingsView.js';
```

旧 `SettingsView.test.tsx` 如果和新 props 冲突，改为只验证 re-export 可渲染，或删除旧测试并只保留 `ClaweeSettingsView.test.tsx`。

- [ ] **Step 4: 添加设置样式**

在 `apps/web/src/styles/app.css` 添加：

```css
.settings-page {
  width: 100vw;
  height: 100vh;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  background: #fbfbfa;
}

.settings-sidebar {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 14px;
  padding: 14px 8px;
  background: #dbe8ec;
}

.settings-back,
.settings-nav button {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  padding: 0 12px;
  color: #263238;
  font-weight: 650;
  text-align: left;
}

.settings-nav {
  display: grid;
  gap: 4px;
}

.settings-nav button[aria-current="true"] {
  background: rgba(55, 76, 84, 0.1);
}

.settings-search {
  display: block;
  position: relative;
}

.settings-search span {
  position: absolute;
  left: 14px;
  top: 8px;
  color: #9a9690;
}

.settings-search input {
  width: 100%;
  height: 36px;
  border: 1px solid #dfe3e3;
  border-radius: 10px;
  background: #fff;
  padding: 0 12px;
}

.settings-content {
  min-height: 0;
  overflow: auto;
  padding: 74px min(96px, 7vw);
}

.settings-section {
  width: min(920px, 100%);
  display: grid;
  gap: 28px;
}

.settings-section h1 {
  margin: 0;
  font-size: 24px;
}

.settings-section h2 {
  margin: 10px 0 -10px;
  font-size: 18px;
}

.settings-card {
  border: 1px solid #e7e3dc;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
}

.settings-row {
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 20px;
  padding: 14px 18px;
  border-bottom: 1px solid #eeeae3;
}

.settings-row:last-child {
  border-bottom: 0;
}

.settings-row strong,
.settings-row p {
  margin: 0;
}

.settings-row p {
  color: #86827a;
}

.settings-row > span {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #5c5a55;
  font-weight: 650;
}
```

- [ ] **Step 5: 运行测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/features/settings
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/features/settings apps/web/src/styles/app.css
git commit -m "feat(web): add simplified Clawee settings"
```

---

## Task 7: App 组装和真实 Runtime 保留

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/index.html`

- [ ] **Step 1: 更新 App 集成测试断言**

修改 `apps/web/src/app/App.test.tsx` 中现有测试文案：

1. 首页应显示 `要在 content-design 中处理什么？`。
2. 主 UI 不应显示 `Codex Runtime Workbench`。
3. 连接成功后可在关于页高级信息看到 `codex-cli test`。
4. 不存在 Runtime 地址、Runtime Token、连接 Runtime 按钮。
5. 发送 prompt 仍可走 mock 或 runtime。

新增测试：

```tsx
it('renders the Clawee desktop app shell without Codex product branding', async () => {
  render(<App />);

  expect(await screen.findByRole('button', { name: '新对话' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '要在 content-design 中处理什么？' })).toBeInTheDocument();
  expect(screen.queryByText('Codex Runtime Workbench')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Runtime 地址' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Runtime Token')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '连接 Runtime' })).not.toBeInTheDocument();
});
```

更新连接测试中的期望：

```ts
expect(await screen.findByText('本地运行内核正常')).toBeInTheDocument();
```

如果连接状态仅在关于页展示，则通过点击 `设置 账户` 和 `关于 Clawee` 后再断言 `codex-cli test`。

- [ ] **Step 2: 组装 App**

修改 `apps/web/src/app/App.tsx`，核心结构应为：

```tsx
const projects = useMemo(() => createDefaultProjects(), []);
const conversations = useMemo(() => listRecentConversations(), []);
const currentProject = findProjectById(projects, state.currentProjectId) ?? projects[0];
const activeConversation = conversations.find(conversation => conversation.id === state.selectedThreadId);
const conversationTitle = activeConversation?.title ?? '';
const mainTitle = conversationTitle || '';
```

`return` 分支：

```tsx
if (state.activeView === 'settings') {
  return (
    <ClaweeSettingsView
      runtimeStatus={{
        connected: connectionState.status === 'connected',
        runtimeVersion: '0.1.0',
        codexVersion: connectionState.status === 'connected' ? connectionState.codexStatus.codexVersion : undefined,
        codexPath: connectionState.status === 'connected' ? connectionState.codexStatus.codexBin : undefined,
        codexHome: connectionState.status === 'connected' ? connectionState.codexStatus.codexHome : undefined,
        lastCheckedAt: new Date().toLocaleString('zh-CN')
      }}
      onBack={() => dispatch({ type: 'back_to_app' })}
    />
  );
}

return (
  <WorkbenchLayout
    sidebar={
      <ClaweeSidebar
        projects={projects}
        conversations={conversations}
        currentProjectId={state.currentProjectId}
        activeView={state.activeView}
        onNewConversation={() => dispatch({ type: 'back_to_app' })}
        onSelectProject={projectId => dispatch({ type: 'select_project', projectId })}
        onSelectConversation={conversationId => dispatch({ type: 'select_thread', threadId: conversationId })}
        onOpenView={view => dispatch({ type: 'set_active_view', view })}
        onOpenSettings={() => dispatch({ type: 'open_settings' })}
      />
    }
    main={
      <div className="conversation-page">
        <ConversationHeader
          title={conversationTitle || '新对话'}
          projectName={currentProject?.name ?? '未选择项目'}
          onOpenLocation={() => {
            if (currentProject) void hostBridge.revealPath(currentProject.cwd);
          }}
          onToggleDetail={() => {
            if (state.rightPanelMode === 'closed') dispatch({ type: 'select_file', path: state.selectedFilePath });
            else dispatch({ type: 'close_detail' });
          }}
        />
        <div className="conversation-body">
          {timelineItems.length === 0 ? (
            <ConversationEmptyState projectName={currentProject?.name} />
          ) : (
            <Timeline
              items={timelineItems}
              onOpenRunDetail={openRunDetail}
              onOpenChange={changeId => dispatch({ type: 'select_change', changeId })}
            />
          )}
        </div>
        <div className="composer-wrap">
          <Composer
            disabled={runtimeBusy}
            projectName={currentProject?.name ?? '未选择项目'}
            branchName="open-clawee"
            permission={currentProject?.defaultSandbox ?? 'follow-global'}
            modelLabel="5.5 超高"
            onSubmit={submitPrompt}
          />
        </div>
      </div>
    }
    detail={renderDetailPanel()}
    detailOpen={state.rightPanelMode !== 'closed'}
  />
);
```

实现 `renderDetailPanel()`：

```tsx
function renderDetailPanel() {
  if (state.rightPanelMode === 'run_detail') {
    return (
      <DetailPanel
        mode="run"
        title="运行详情"
        subtitle={state.selectedRunId}
        content={runDiagnostics === undefined ? '正在加载运行详情...' : JSON.stringify(runDiagnostics, null, 2)}
        onClose={() => dispatch({ type: 'close_detail' })}
      />
    );
  }

  if (state.rightPanelMode === 'change') {
    return (
      <DetailPanel
        mode="change"
        title="已编辑 docs/atoms.md"
        subtitle="+903 -0"
        content="docs/atoms.md"
        onClose={() => dispatch({ type: 'close_detail' })}
        onApprove={() => dispatch({ type: 'close_detail' })}
        onRevert={() => dispatch({ type: 'close_detail' })}
      />
    );
  }

  return (
    <DetailPanel
      mode="file"
      title={selectedFilePath.split('/').at(-1) ?? selectedFilePath}
      subtitle={selectedFilePath}
      content={selectedDraftContent || '暂无预览内容'}
      onClose={() => dispatch({ type: 'close_detail' })}
    />
  );
}
```

保留现有 `submitPrompt`、`submitRuntimePrompt`、`subscribeToRunEvents`、`loadRunDiagnostics` 逻辑。删除旧 `rightPanel`、`fileTree` 四栏组装。

- [ ] **Step 3: 修正连接状态文案**

在 `submitPrompt` mock fallback 中把：

```ts
'本机 Runtime 暂未就绪，已在 mock workspace 中记录本次任务。'
```

改成：

```ts
'本地服务暂未就绪，已先记录本次任务。'
```

连接失败文案把 `Runtime 连接失败` 改成 `本地服务连接失败`，等待文案把 `正在等待本机 Runtime` 改成 `正在等待本地服务`。

- [ ] **Step 4: 更新 index title**

修改 `apps/web/index.html`：

```html
<title>Clawee</title>
```

- [ ] **Step 5: 运行 App 测试**

Run:

```bash
pnpm --filter @clawee/web test -- src/app/App.test.tsx
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/app/App.tsx apps/web/src/app/App.test.tsx apps/web/index.html
git commit -m "feat(web): assemble Clawee desktop app UI"
```

---

## Task 8: 品牌、禁用项和全量测试

**Files:**
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/app.css`
- Modify: docs if implementation reveals small design corrections

- [ ] **Step 1: 扫描主 UI 品牌泄漏**

Run:

```bash
rg -n "Codex Runtime Workbench|Mock Agent|连接 Runtime|Runtime 地址|Runtime Token|API Key|适用于编程|工作模式|English|自动检测" apps/web/src apps/web/index.html
```

Expected: 无匹配。允许测试 fixture 中出现 `codex-cli test`，允许关于页高级信息出现 `Codex CLI`、`CODEX_HOME`。

- [ ] **Step 2: 扫描允许的 Codex 诊断文案**

Run:

```bash
rg -n "Codex|CODEX_HOME|codex-cli" apps/web/src apps/web/index.html
```

Expected: 只在 `ClaweeSettingsView` 关于页高级信息、测试 fixture、runtime type/变量名中出现。不得在主导航、空状态、composer、timeline title 中出现。

- [ ] **Step 3: 运行前端全量测试**

Run:

```bash
pnpm --filter @clawee/web test
```

Expected: PASS。

- [ ] **Step 4: 类型检查**

Run:

```bash
pnpm --filter @clawee/web typecheck
```

Expected: PASS。

- [ ] **Step 5: 构建**

Run:

```bash
pnpm --filter @clawee/web build
```

Expected: PASS，生成 `apps/web/dist`。

- [ ] **Step 6: 启动本地预览自测**

Run:

```bash
pnpm --filter @clawee/web dev
```

Expected: Vite 输出 `http://127.0.0.1:<port>/`。打开页面后检查：

1. 左侧栏有 `新对话 / 搜索 / 已安排 / 插件`。
2. 项目列表和截图一致。
3. 空状态显示 `要在 content-design 中处理什么？`。
4. 输入框显示 `随心输入`、`完全访问`、`5.5 超高`、`content-design`、`本地模式`、`open-clawee`。
5. 点击设置进入极简设置页。
6. 主界面无 Codex 产品名。

完成后停止 dev server。

- [ ] **Step 7: 提交**

```bash
git add apps/web/src apps/web/index.html
git commit -m "test(web): verify Clawee desktop UI"
```

如果 Step 1-6 没有产生代码改动，不要创建空提交。

---

## Self-Review

### Spec Coverage

- Clawee 品牌：Task 6、Task 7、Task 8 覆盖。
- 企业日常工作单模式：Task 6 设置页不显示工作模式，Task 8 扫描防回归。
- 中文默认：Task 6 设置页固定中文。
- 左侧栏结构：Task 2 覆盖。
- 主对话和空状态：Task 3、Task 7 覆盖。
- 输入框权限/模型/项目/本地模式：Task 3 覆盖。
- 右侧按需详情：Task 5、Task 7 覆盖。
- Runtime 真实能力保留：Task 7 保留现有 run/SSE/diagnostics 逻辑，Task 8 全量测试。
- 不显示 runtime URL/token/API Key：Task 7、Task 8 覆盖。
- Codex 只在高级信息出现：Task 6、Task 8 覆盖。

### Placeholder Scan

本计划没有 `TBD`、`TODO` 或“以后实现”式步骤。Mock 能力在 spec 中明确允许，计划中只用于当前 Runtime 缺口。

### Type Consistency

`ProjectPermission`、`ActiveView`、`RightPanelMode`、`ClaweeProject`、`ClaweeConversation` 在 Task 1 定义，后续任务复用同名类型。`WorkbenchLayout` props 在 Task 2 修改，Task 7 按新签名组装。
