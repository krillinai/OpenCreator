# index.html 原型与当前 Agent Runtime 能力审查

## 1. 总体结论

`index.html` 的四区 Dashboard 方向是合适的：左侧组织 thread/history/capability，中央承载 run 对话和事件流，右侧展示当前产物，最右侧展示项目文件树。这个信息架构适合接当前 Runtime。

但当前原型里有一部分能力超出了 Runtime 已实现范围，不能直接作为第一版可交付承诺。第一版 UI 应先围绕 Runtime 已稳定的 API 落地：Thread、Run、SSE、Skills、MCP、Schedules、Diagnostics、Cleanup、Codex Status。文件树、文件编辑保存、权限审批、项目管理可以保留视觉占位，但需要明确为后续阶段。

另外，当前 `index.html` 仍是静态 mock：会话、文件树、文件内容和发送消息都在前端内存里模拟，没有调用 Runtime API，也没有 EventSource/SSE 订阅。真正接入时需要把它重构为数据驱动页面，而不是在现有 mock 数据上继续叠加交互。

## 2. 原型中与 Runtime 匹配的部分

### 2.1 左侧会话列表

可以映射到：

1. `GET /threads?status=active&limit=50`
2. `GET /runs?limit=50`
3. `GET /threads/:id/runs`

建议：

1. 左侧“今天/更早”按 `thread.updatedAt` 分组。
2. 会话状态来自最近 run 的 `status`。
3. “新对话”先创建 thread，再发送第一条 run。

### 2.2 中央聊天流

可以映射到：

1. `POST /runs`
2. `GET /runs/:id/events`
3. `GET /runs/:id`

事件渲染：

| Runtime 事件 | UI 渲染 |
|---|---|
| `status` | 运行状态条 |
| `assistant_message` | Agent 文本消息 |
| `tool_use` | 工具调用步骤卡 |
| `tool_result` | 工具结果折叠卡 |
| `usage` | 用量摘要，默认放详情里 |
| `diagnostic` | warning/info 卡 |
| `error` | 错误卡 |
| `unknown_event` | 诊断模式显示 |
| `done` | 结束 loading，刷新列表 |

### 2.3 插件 / Skills / MCP 入口

可以映射到：

1. `GET /codex/skills`
2. `POST /codex/skills/install`
3. `DELETE /codex/skills/:id`
4. `GET /codex/mcp`
5. `POST /codex/mcp/add`
6. `DELETE /codex/mcp/:name`
7. `GET /codex/skills/operations`
8. `GET /codex/mcp/operations`

建议：

1. 左侧“插件”入口改名为“能力”，内部 tab 分为 Skills、MCP、Profiles。
2. 全局写入动作必须展示确认弹窗：目标 `CODEX_HOME`、目标路径、备份策略。
3. MCP secrets 只展示 env key，不展示 value。

### 2.4 计划任务入口

可以映射到：

1. `GET /schedules`
2. `POST /schedules`
3. `PATCH /schedules/:id`
4. `DELETE /schedules/:id`
5. `POST /schedules/:id/run-now`
6. `GET /schedules/:id/operations`

建议：

1. 计划任务页不放在聊天主路径里，适合作为左侧主入口。
2. `run-now` 创建的 run 应跳回聊天/运行详情页面，继续订阅 SSE。
3. 文案必须说明睡眠/离线错过任务不会补跑。

### 2.5 设置入口

可以映射到：

1. `GET /codex/status`
2. `GET /codex/profiles`
3. `GET /runtime/cleanup/preview`
4. `POST /runtime/cleanup`

建议：

1. 设置页第一屏显示 Codex 状态、版本、`CODEX_HOME`、认证诊断。
2. Profiles 第一版只做读取和选择，不开放创建/编辑/删除。
3. Cleanup 必须先 preview，再 confirm delete。

## 3. 当前原型中超出 Runtime 能力的部分

### 3.1 右侧文件树

问题：Runtime 当前没有文件树 API。

原型中最右侧“文件”树、搜索、刷新、新建文件都没有后端支撑。当前 Runtime 只管理 run/thread/workspace 路径，不提供目录枚举、文件读取、文件保存。

建议：

1. 第一版把右侧文件树作为“运行产物/诊断文件”面板，而不是完整项目文件树。
2. 可先接 `GET /runs/:id/diagnostics`，展示 diagnostics 文件。
3. 真正文件树需要新增后端 API：`GET /workspace/tree`、`GET /workspace/file`、`PUT /workspace/file`。

### 3.2 文件编辑和保存

问题：Runtime 当前没有保存文件 API。

原型中“保存”按钮只是改内存状态。UI 如果直接做真实保存，会缺后端能力，也会绕过 Runtime 安全边界。

建议：

1. 第一版右侧编辑器只做只读预览：assistant 输出、tool result、diagnostics 文件。
2. 如果必须编辑文件，需要先设计文件 API、路径边界、external/managed workspace 权限、备份和保存冲突策略。

### 3.3 权限审批卡

问题：当前 Runtime 没有 approval API。

Codex exec 当前由 CLI 决定 sandbox 和工具行为；Runtime 没有“暂停 run 等用户批准”的协议。

建议：

1. 不要在第一版 UI 里承诺“写文件前确认”。
2. 可以展示 sandbox 模式和风险提示。
3. 后续如果接审批，需要新增 run interrupt/approval 协议。

### 3.4 项目管理

问题：Runtime 当前没有 project API。

原型左侧有“项目”列表，但后端只有 `cwd`、thread workspace 和 run history，没有项目实体。

建议：

1. 第一版项目可以是前端本地配置或“最近 cwd”概念。
2. 不要把项目数量、项目切换、项目上下文读取做成后端能力承诺。
3. 后续新增 project API 时再固化项目模型。

### 3.5 Profile 编辑

问题：当前全局 `CODEX_HOME` 下 profile 写入仍返回 `CODEX_HOME_READ_ONLY`。

建议：

1. UI 只展示 profile 列表。
2. 创建 thread/run 时允许选择 valid profile。
3. 编辑、删除、创建 profile 按钮隐藏或 disabled，并标记“待后端开放全局写入确认”。

## 4. 信息架构优化方案

建议第一版 UI 收敛为 4 个主区域：

### 4.1 左侧：Thread 和 Runtime 导航

保留：

1. 新对话。
2. 搜索。
3. 会话列表。
4. 计划任务。
5. 能力。
6. 设置。

调整：

1. “项目”区域第一版改为“工作目录”或隐藏。
2. 会话列表来自 `/threads`，而不是静态 sessions。
3. 每个会话行展示最近 run 状态。

### 4.2 中间：Run Timeline

核心组件：

1. Composer。
2. User message。
3. Agent message。
4. Tool call/result step。
5. Diagnostic/error card。
6. Done summary。
7. Cancel button。

数据流：

1. 发送时 `POST /runs`。
2. 打开 SSE。
3. 按事件追加 timeline。
4. 终态刷新 run/thread。

### 4.3 右侧：Run Detail / Artifact Preview

第一版不要做完整文件编辑器，建议改为 tab：

1. Output：assistant message 汇总。
2. Events：事件列表。
3. Diagnostics：`GET /runs/:id/diagnostics` 文件预览。
4. Raw：可选显示 raw redacted。

这样可以完全由当前 Runtime 支撑。

### 4.4 最右侧：Context / Capabilities

替代完整项目文件树，第一版展示：

1. 当前 thread 配置：cwd、profile、sandbox、model、reasoning。
2. Codex status。
3. Skills 概览。
4. MCP 概览。
5. Schedule/source 信息。

后续有文件 API 后，再切回文件树。

## 5. 页面级建议

### 5.1 首页默认状态

不要默认展示静态 mock 文档。建议启动后：

1. 调 `GET /codex/status`。
2. 调 `GET /threads?status=active&limit=50`。
3. 如果有 thread，打开最近 thread。
4. 如果没有 thread，显示空状态和“新对话”。

### 5.2 新对话流程

推荐流程：

1. 用户输入 prompt。
2. 如果没有 active thread，先 `POST /threads`。
3. `POST /runs` with `threadId`。
4. UI optimistic append user message。
5. SSE append agent events。

### 5.3 继续对话流程

1. 保留当前 `threadId`。
2. `POST /runs` with `resumeMode: "auto"`。
3. 如果 resume 失败，展示“开启新上下文继续”按钮。
4. 点击后用同 prompt 重试 `resumeMode: "new_thread"`。

### 5.4 取消流程

运行中显示 cancel button：

1. 点击 `POST /runs/:id/cancel`。
2. UI 状态改为 canceling。
3. 等 SSE `done`。

### 5.5 错误和诊断流程

错误卡片应提供：

1. 错误码和 message。
2. “查看诊断”按钮。
3. “复制诊断摘要”按钮。
4. 如果是 resume 失败，提供 new_thread 重试。

## 6. 视觉和交互审查

### 6.1 优点

1. 四区布局清晰，适合 Agent Dashboard 。
2. 视觉密度比营销页合理，偏工具型。
3. 中间聊天和右侧产物同屏，方向正确。
4. 搜索/替换、保存状态、文件树这些控件表达了目标工作流。

### 6.2 需要调整

1. 当前 `body min-height: 720px` 和 `.app` 四列在小屏会较重；桌面 App 可以接受，但 Web 版需要更强响应式。
2. UI 使用了较多字符图标，例如 `▸`、`◷`、`▣`、`↑`。实现阶段建议用 lucide 图标，提升一致性和可访问性。
3. “企业 Agent Dashboard”命名偏大。当前产品是本地 Codex Runtime UI，建议标题收敛为“OpenCreator Agent”或“Agent Runtime”。
4. 右侧文件编辑器现在视觉占比过大，但后端第一版无法保存文件。建议先改为 Run Detail。
5. 顶部“本地工作区已连接”需要绑定 `/codex/status` 和 daemon health，不应静态显示。
6. 发送按钮缺少 running disabled/loading 状态。
7. 没有 run cancel affordance。
8. 没有 token 失效、daemon 断开、Codex 未安装、Codex 配置 invalid 的状态页。

## 7. 第一版 UI 实施切片

### Slice 1：Runtime 连接和状态

1. 输入/保存 daemon address 和 token。
2. `GET /healthz`。
3. `GET /codex/status`。
4. 展示连接状态。

### Slice 2：Thread + Run + SSE

1. `/threads` 列表。
2. 新建 thread。
3. 创建 run。
4. SSE timeline。
5. cancel。

### Slice 3：Diagnostics

1. run 详情。
2. diagnostics 文件列表。
3. stderr/events/meta 预览。

### Slice 4：Skills/MCP

1. skills list/detail/install/delete。
2. MCP list/detail/add/remove。
3. operations 日志。
4. 全局写确认弹窗。

### Slice 5：Schedules

1. schedule list/create/edit/delete。
2. run-now。
3. operation log。
4. run-now 跳转 run timeline。

### Slice 6：Cleanup 和设置

1. cleanup preview/delete。
2. profiles 只读选择。
3. Codex status diagnostics。

## 8. 需要后端补齐后才能实现的 UI 能力

### 文件系统 API

建议新增：

```http
GET /workspaces/:threadId/tree
GET /workspaces/:threadId/files?path=...
PUT /workspaces/:threadId/files
```

必须设计：

1. managed/external workspace 边界。
2. symlink/path traversal 防护。
3. 二进制文件拒绝策略。
4. 保存前备份。
5. 与 Codex run 并发写入冲突处理。

### 权限审批 API

建议后续单独设计：

```http
GET /runs/:id/approvals
POST /runs/:id/approvals/:approvalId/approve
POST /runs/:id/approvals/:approvalId/reject
```

但这依赖 Codex CLI 是否有可暂停审批协议，不能先在 UI 承诺。

### Project API

建议后续单独设计：

```http
GET /projects
POST /projects
PATCH /projects/:id
DELETE /projects/:id
```

第一版可以先用 thread.cwd 代替 project。

## 9. 审查结论

`index.html` 可以作为视觉和信息架构原型继续使用，但第一版 UI 接入时需要把右侧“文件编辑器/文件树”降级为“Run 详情/诊断/能力上下文”，否则会落到当前 Runtime 没有的文件 API 上。

推荐第一版目标：

1. 先做可真实运行的 Codex Chat/Run UI。
2. 接入 thread/resume/SSE/cancel/history。
3. 接入 diagnostics、skills、MCP、schedules。
4. 文件编辑、项目文件树、权限审批作为下一阶段设计。
