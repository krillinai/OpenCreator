# Codex Runtime UI Web App 设计

## 1. 背景

Agent Runtime 已经完成第一版后端内核，具备 Codex status、thread、run、SSE、diagnostics、profiles、skills、MCP、schedules 和 cleanup 能力。当前仓库只有根目录 `index.html` 静态原型，还没有真正的数据驱动前端应用。

最终产品目标是桌面版 App，但第一阶段先实现 Web App。Web App 不与桌面目标冲突：后续桌面壳可以复用同一套前端，把它加载到 Tauri/Electron WebView，并补充 daemon 生命周期、本机通知、打开文件、系统菜单等 host 能力。

本设计以 `index.html` 原型为 UI 功能目标。Runtime 已支持的能力接真实 API；Runtime 暂不支持的能力先通过前端 mock adapter 补齐，避免为了适配当前后端缺口改变产品形态，导致后续补能力时返工。

## 2. 目标

第一版 UI 需要完成：

1. 新增 `apps/web` workspace 应用。
2. 使用真实 Runtime API 接入：
   - daemon connection
   - `/healthz`
   - `/codex/status`
   - `/threads`
   - `/runs`
   - `/runs/:id/events`
   - `/runs/:id/cancel`
   - `/runs/:id/diagnostics`
   - `/codex/profiles`
   - `/codex/skills`
   - `/codex/mcp`
   - `/schedules`
   - `/runtime/cleanup`
3. 以 `index.html` 原型为准实现四区工作台：
   - 左侧导航、项目、会话、计划任务、能力、设置。
   - 中间 Agent 对话 timeline。
   - 右侧文件编辑器。
   - 最右项目文件树。
4. Runtime 暂不支持的项目、文件树、文件读取、文件保存、审批、变更卡能力先接前端 mock adapter。
5. mock 文件编辑状态持久化到 localStorage，刷新页面后不丢失。
6. 保留桌面版扩展点 `HostBridge`，但第一版不实现桌面壳。
7. 前端组件不直接依赖 mock 数据，必须通过 service/adapter 接口访问数据源。

## 3. 非目标

第一版 UI 不做：

1. Tauri/Electron 桌面打包。
2. daemon 自动启动、停止、重启和 token 注入。
3. 真实本机文件树读取。
4. 真实文件保存到磁盘。
5. git diff、patch review、rollback。
6. Runtime 权限审批协议。
7. Runtime project API。
8. Profile 创建、编辑、删除。
9. 图片输入。
10. 移动端完整体验。

这些能力可以在 UI 里保留目标形态或 disabled 状态，但不能伪装成已经写入真实磁盘或已经由 Runtime 审批。

## 4. 设计原则

1. **原型优先**：页面结构和功能目标以 `index.html` 为准，不为了当前 Runtime 缺口改成中间态界面。
2. **真实能力真实接入**：Run、Thread、SSE、Skills、MCP、Schedules 等已有 Runtime 能力必须走真实 API。
3. **缺口能力 mock adapter 化**：文件、项目、审批、变更卡等能力先走 mock service，未来替换 Runtime API 时不改组件结构。
4. **不混淆真实和 mock 状态**：每个数据对象保留 `source: "runtime" | "mock"`，开发诊断可见。
5. **桌面兼容**：Web App 通过 `HostBridge` 预留桌面能力，不把本机能力散落在 React 组件里。
6. **不直接操作 Codex**：前端不调用 Codex CLI，不直接读写 `~/.codex`，不直接管理 Runtime 数据库。

## 5. 技术选型

第一版建议：

1. Vite + React + TypeScript。
2. 复用 `@clawee/protocol` 类型。
3. 图标使用 `lucide-react`。
4. 样式先使用普通 CSS 与设计 token，不引入大型 UI 框架。
5. 状态管理先使用 hooks + reducer；如果实现中 server state 缓存和并发刷新明显复杂，再引入 TanStack Query。
6. 测试使用 Vitest；端到端测试后续可加 Playwright。

## 6. 项目结构

新增：

```text
apps/web/
  package.json
  index.html
  src/
    main.tsx
    app/
      App.tsx
      routes.ts
      app-state.ts
    runtime/
      client.ts
      sse.ts
      errors.ts
      types.ts
    host/
      bridge.ts
      browser-bridge.ts
    services/
      connection-service.ts
      thread-service.ts
      run-service.ts
      diagnostics-service.ts
      capability-service.ts
      schedule-service.ts
      settings-service.ts
      project-service.ts
      file-service.ts
      approval-service.ts
      change-service.ts
    features/
      connection/
      threads/
      runs/
      editor/
      files/
      capabilities/
      schedules/
      settings/
    components/
      layout/
      timeline/
      editor/
      forms/
      primitives/
    styles/
      tokens.css
      app.css
```

根目录 `index.html` 继续作为视觉原型参考，不作为第一版真实应用入口。

## 7. 总体架构

```text
UI Components
  -> Feature Hooks / Reducers
    -> Runtime-backed Services
      -> RuntimeClient HTTP/SSE
    -> Mock-backed Services
      -> localStorage
    -> HostBridge
      -> browser no-op/localStorage now
      -> desktop implementation later
```

### 7.1 RuntimeClient

职责：

1. 管理 base URL 和 token。
2. 为除 `/healthz` 外的请求注入 `Authorization: Bearer <token>`。
3. 统一解析 JSON。
4. 统一解析 `ApiError`。
5. 提供 SSE 订阅和重连工具。

### 7.2 HostBridge

第一版接口预留：

```ts
type HostBridge = {
  kind: "browser" | "desktop";
  readConnectionConfig(): Promise<ConnectionConfig | null>;
  writeConnectionConfig(config: ConnectionConfig): Promise<void>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<HostBridgeResult>;
  notify(message: HostNotification): Promise<void>;
};
```

浏览器版：

1. connection config 使用 localStorage。
2. `openExternal` 使用 `window.open`。
3. `revealPath` 返回 unsupported。
4. `notify` 可先 no-op。

桌面版后续替换实现，不影响 UI 组件。

## 8. 页面信息架构

### 8.1 四区工作台

```text
左侧：项目 / 会话 / 计划任务 / 能力 / 设置
中间：Agent 对话 timeline
右侧：文件编辑器
最右：项目文件树
```

左侧保留原型目标：

1. 新对话。
2. 搜索。
3. 项目区域。
4. 会话列表。
5. 计划任务入口。
6. 插件/能力入口。
7. 设置入口。

中间保留原型目标：

1. 用户消息。
2. Agent message。
3. 运行状态卡。
4. tool step。
5. 文件卡。
6. 变更卡。
7. 审批卡。
8. 错误和诊断卡。
9. composer。

右侧保留原型目标：

1. 文件路径。
2. 保存状态。
3. 保存按钮。
4. 搜索。
5. 替换。
6. 文本编辑器。

最右保留原型目标：

1. 文件树。
2. 文件搜索。
3. 当前文件高亮。
4. 新建文件。
5. 刷新。

### 8.2 页面入口

第一版使用 hash route：

```text
#/
#/thread/:threadId
#/schedules
#/capabilities
#/settings
```

hash route 足够支撑桌面 WebView 和普通浏览器；后续如需 browser history 再升级。

## 9. 数据源和服务边界

### 9.1 Runtime-backed services

```text
ConnectionService
CodexStatusService
ThreadService
RunService
DiagnosticsService
SkillsService
McpService
ScheduleService
CleanupService
```

这些服务必须调用真实 Runtime API。Runtime disconnected 时，返回 disconnected 状态，不使用 mock 假装真实运行。

### 9.2 Mock-backed services

```text
ProjectService
FileService
EditorService
ApprovalService
ChangeService
```

这些服务第一版使用 localStorage 持久化。后续 Runtime 文件 API、project API、approval API 完成后，替换 service 实现。

### 9.3 通用数据模型

```ts
type DataSource = "runtime" | "mock";

type Project = {
  id: string;
  name: string;
  rootPath: string;
  source: DataSource;
};

type WorkspaceFile = {
  path: string;
  name: string;
  language: "markdown" | "srt" | "html" | "text" | "json" | "unknown";
  content: string;
  saved: boolean;
  dirty: boolean;
  updatedAt: string;
  source: DataSource;
};

type TimelineItem =
  | { kind: "user_message"; id: string; text: string; createdAt: string; source: DataSource }
  | { kind: "assistant_message"; id: string; text: string; createdAt: string; source: DataSource }
  | { kind: "tool_step"; id: string; name: string; status: string; content?: string; source: DataSource }
  | { kind: "file_card"; id: string; path: string; changeSummary?: string; source: DataSource }
  | { kind: "change_card"; id: string; title: string; delta?: string; source: DataSource }
  | { kind: "approval_card"; id: string; title: string; risk: string; status: "pending" | "approved" | "rejected"; source: DataSource }
  | { kind: "diagnostic"; id: string; severity: "info" | "warning" | "error"; message: string; source: DataSource }
  | { kind: "run_status"; id: string; label: string; source: DataSource };
```

## 10. localStorage 设计

使用版本化 key：

```text
clawee.web.connection.v1
clawee.web.projects.v1
clawee.web.files.v1
clawee.web.editor.v1
clawee.web.timeline.mock.v1
clawee.web.ui.v1
```

规则：

1. mock 文件保存只写 localStorage。
2. Runtime run/thread 状态不写入 localStorage 作为真实状态。
3. localStorage 反序列化失败时重置对应 mock domain，并提示一次恢复默认数据。
4. 未来 schema 变化通过 key version 迁移，不就地猜测旧格式。

## 11. 核心流程

### 11.1 启动流程

1. 从 `HostBridge.readConnectionConfig()` 读取 daemon address/token。
2. 初始化 mock project/file/editor state。
3. 无连接配置时，进入 disconnected 工作台。
4. 有连接配置时调用 `/healthz`。
5. `/healthz` 成功后调用 `/codex/status`。
6. 拉取 threads、skills、MCP、schedules。
7. 任一步失败都显示连接错误，但不清空 mock 工作台。

### 11.2 新对话和发送消息

1. 用户输入 prompt。
2. UI 立即追加 user timeline item。
3. Runtime connected 时：
   - 如果没有当前 thread，先 `POST /threads`。
   - 再 `POST /runs`。
   - 建立 SSE 订阅。
   - Runtime event 转成 timeline item。
4. Runtime disconnected 时：
   - mock run 生成演示 timeline。
5. 不论 Runtime 是否有文件事件，`ChangeService` 可生成 mock 文件卡或变更卡，保持原型体验。
6. run `done` 后刷新 thread、run、diagnostics 状态。

### 11.3 SSE 渲染

事件映射：

| Runtime event | Timeline |
|---|---|
| `status` | `run_status` |
| `assistant_message` | `assistant_message` |
| `tool_use` | `tool_step` pending/running |
| `tool_result` | `tool_step` completed/failed |
| `usage` | run detail metadata |
| `diagnostic` | `diagnostic` |
| `error` | `diagnostic` error |
| `unknown_event` | diagnostics/debug view |
| `done` | run final state |

SSE 要求：

1. 每个 run 同时最多一个 EventSource。
2. 保存最后 `seq`。
3. 断线后用 `fromSeq=<lastSeq>` 重连一次。
4. 终态关闭连接。

### 11.4 文件打开、编辑和保存

1. 文件树或文件卡调用 `FileService.open(path)`。
2. 编辑器加载内容。
3. 输入后更新 editor buffer，文件变 dirty。
4. 搜索/替换只修改当前 buffer。
5. 保存调用 `FileService.save(path, content)`。
6. 第一版 save 写入 localStorage。
7. 保存成功后 `dirty=false`、`saved=true`、更新 `updatedAt`。
8. 保存失败时保持 dirty 并展示错误。

文案必须避免“已写入磁盘”。建议使用“已保存到本地工作区草稿”。

### 11.5 文件树

1. 从 `ProjectService` 获取当前 project。
2. 从 `FileService` 获取 tree。
3. 支持搜索。
4. 支持当前文件高亮。
5. 新建文件写 mock store。
6. 刷新从 localStorage 重新加载。

### 11.6 审批和变更卡

1. Runtime 暂无审批 API，因此第一版审批卡来自 mock `ApprovalService`。
2. approve/reject 只影响 mock timeline。
3. 不阻塞真实 Runtime run。
4. 开发诊断可显示 `source: mock`。

### 11.7 能力页

能力页包含：

1. Skills tab。
2. MCP tab。
3. Profiles tab。

connected 时拉真实 API；disconnected 时展示连接提示。Skills/MCP 写入动作必须带确认弹窗，并在确认后传 `confirmWriteToCodexHome: true`。

### 11.8 计划任务页

connected 时支持：

1. schedule list。
2. create。
3. update。
4. delete。
5. run-now。
6. operation log。

disconnected 时显示连接提示。第一版不 mock 真实 schedule 执行。

### 11.9 设置页

设置页包含：

1. daemon address/token。
2. connection test。
3. Codex status。
4. profiles 只读。
5. cleanup preview/delete。
6. diagnostics 信息。

## 12. 错误处理

1. 连接失败：标记 disconnected，真实功能 disabled，mock 工作台继续可用。
2. 401：标记 token invalid，打开连接设置，不自动重试。
3. 400：显示表单校验错误。
4. 404：刷新对应列表并提示资源不存在。
5. 409 confirmation required：打开确认弹窗，确认后重试。
6. 422：展示配置无效或 profile/skill/MCP invalid。
7. 502 MCP command failed：展示 operation command/errorCode/errorMessage。
8. SSE 断线：按 last seq 重连一次，仍失败则显示 run 连接中断。
9. localStorage 保存失败：保持 dirty，不显示保存成功。

## 13. 状态管理

状态分三类：

```text
Runtime State
- connection
- codexStatus
- threads
- runs
- sse events
- skills
- mcp
- schedules
- cleanup

Mock Workspace State
- projects
- fileTree
- file contents
- editor dirty/saved
- mock approvals
- mock changes

UI State
- selectedThreadId
- selectedRunId
- selectedProjectId
- selectedFilePath
- activePanel
- activeTab
- composerDraft
- search/filter
```

约束：

1. Runtime state 来源只能是 Runtime API/SSE。
2. Mock workspace state 来源只能是 mock services/localStorage。
3. UI state 可以写入 `clawee.web.ui.v1`。
4. 组件通过 hooks 使用状态，不直接读写 localStorage。

## 14. UI 细节要求

1. 保留工具型高密度布局，避免营销页和大卡片堆叠。
2. 使用稳定列宽和响应式约束，防止面板互相挤压。
3. 图标使用 lucide-react，不继续扩散字符图标。
4. 所有真实 Runtime 操作需要 loading、disabled、error 状态。
5. Composer 在同 thread 有 running/queued run 时第一版禁用，避免用户误以为同一会话可以并发运行；后续如要开放排队，需要补充明确的队列状态展示。
6. Cancel 只在 running/queued run 可用。
7. mock 文件保存文案必须明确为本地草稿。
8. disconnected 状态不能让页面空白。

## 15. 测试方案

### 15.1 类型和构建

1. `pnpm --filter @clawee/web typecheck`
2. `pnpm --filter @clawee/web build`
3. `pnpm typecheck`

### 15.2 RuntimeClient 单元测试

覆盖：

1. Authorization header。
2. JSON 请求。
3. ApiError 解析。
4. 401/404/409/422/502 映射。
5. SSE event 到 timeline item。
6. `fromSeq` 重连。

### 15.3 Mock adapter 测试

覆盖：

1. 初始 project/file 加载。
2. 打开文件。
3. 编辑 dirty。
4. 保存 localStorage。
5. 刷新恢复。
6. 搜索/替换。
7. 新建文件。
8. approval approve/reject。

### 15.4 组件测试

覆盖：

1. 连接设置。
2. Thread list。
3. Timeline。
4. Editor。
5. File tree。
6. Skills/MCP/Profiles。
7. Schedules。
8. Settings/Cleanup。

### 15.5 端到端验收

手动或 Playwright 覆盖：

1. 启动 daemon。
2. 启动 web dev server。
3. 配置 address/token。
4. 发送真实 prompt。
5. 创建 thread/run。
6. 收到 SSE assistant/done。
7. 取消 running run。
8. 打开 diagnostics。
9. 编辑 mock 文件并保存。
10. 刷新页面确认 mock 文件未丢。
11. 打开 Skills/MCP/Schedules 页面确认真实 API 可拉取。

## 16. 验收标准

第一版完成标准：

1. `apps/web` 可独立启动。
2. Runtime connected 时，Thread/Run/SSE/cancel/diagnostics 真实可用。
3. Skills/MCP/Schedules/Settings 接真实 API。
4. Runtime disconnected 时，工作台仍可浏览和编辑 mock 文件。
5. 文件树、文件编辑、搜索、替换、保存状态符合原型目标。
6. mock 文件保存刷新不丢。
7. UI 组件没有硬编码 mock 数据，mock 只存在 adapter 层。
8. 真实功能和 mock 功能不会在状态上混淆。
9. 文案不声称 mock 保存已写入真实磁盘。
10. 类型检查和构建通过。

## 17. 后续阶段

后续可按顺序推进：

1. `apps/desktop`：Tauri/Electron 壳，复用 `apps/web`。
2. Runtime 文件 API：tree/read/save/baseHash/conflict/external write confirm。
3. Runtime project API 或 desktop project bridge。
4. Runtime approval API。
5. file event / diff API。
6. git diff、review、rollback。
7. 桌面通知、托盘、daemon 生命周期管理。
