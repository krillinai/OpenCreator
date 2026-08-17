# 企业知识库 Runtime 对话设计

## 背景与目标

企业知识库当前提供授权知识库列表、文档列表和文档上传。新增“对话知识库”视图后，用户可以在知识库页面内发起真实企业知识问答，同时继续使用项目任务对话已经具备的 Thread、Run、Codex app-server、SSE、队列、取消、审批和历史恢复能力。

知识库对话独立于项目，不出现在左侧项目会话列表，也不能访问或修改本地项目文件。Web 与 Desktop 使用同一套 `apps/web` 前端、Daemon API 和 Runtime Service。

## 产品交互

### 视图切换

- 企业知识库页面默认显示现有列表视图。
- 页面右上角保留刷新按钮，并新增带对话图标的“对话知识库”按钮。
- 点击后在同一路由内切换到对话视图，按钮文案变为“返回列表视图”。
- 点击“返回列表视图”恢复原知识库选择、移动端层级和已加载文档。
- 上传入口只在列表视图显示。
- 切换视图不会取消或销毁正在运行的知识 Run。

### 对话体验

- 对话视图复用项目任务对话的消息时间线、输入框、模型选择、发送、停止、排队、错误状态和历史恢复交互。
- 首次发送有效消息时才创建知识 Thread，空对话不落库。
- 再次进入知识库页面时恢复当前企业账号最近的活跃知识 Thread。
- 企业账号退出、切换或授权失效后，历史消息可以查看，但不能继续发送。

## Runtime 架构

### 专用 Thread 类型

协议新增 `knowledge_conversation` Thread purpose：

- `projectId = null`。
- 使用 Daemon 创建的隔离托管工作区。
- 不参与项目会话列表、项目会话计数、项目记忆和项目文件工作区。
- 通过专用查询获取当前企业账号可见的知识 Thread。
- 普通 `conversation`、`schedule_draft` 和 `schedule_task` 行为保持不变。

知识 Thread 仍使用现有 Thread Repository、Run Manager、Codex app-server runner、事件存储和 SSE API。不得新增第二套聊天执行器或只在 Browser/Desktop Bridge 中实现业务逻辑。

### 企业账号隔离

Daemon 从已验证企业会话中获取稳定且不透明的账户主体标识，并将其绑定到知识 Thread。Web 不提交、推导或覆盖该标识。

- 创建、查询、恢复和运行知识 Thread 时均验证当前企业主体。
- 不同企业账号不能发现、读取、恢复或运行彼此的知识 Thread。
- 展示名称和邮箱不作为授权主键。
- 登出不会删除历史，但会撤销继续运行能力。

如果现有企业 `/auth/me` 响应未提供稳定主体标识，必须先扩展企业会话契约；不得退化为使用可变邮箱作为隔离依据。

## 知识检索与工具边界

企业 HTTP API 中的 `permissions.search` 是预留授权字段，不代表 Agent 已获得 MCP 检索权限。知识问答必须使用当前企业 Agent 已获授权的 `knowledge.search` MCP Tool。

每次知识 Run 启动前，Daemon 必须验证：

1. 企业会话仍有效。
2. 当前企业主体与知识 Thread 绑定一致。
3. 当前会话绑定的 Agent 状态有效。
4. MCP 能力目录和 Agent Grant 允许调用 `knowledge.search`。

知识 Run 使用受限工具策略：

- 只允许企业知识检索所需的已授权 MCP Tool。
- 禁止 Shell、本地文件读写、项目目录、任意网络工具和未授权 MCP Tool。
- 不使用模型固有知识冒充企业知识检索结果。
- 回答应保留可展示的知识来源元数据，但不得暴露原始 Token、未授权资源标识或企业服务内部错误详情。

## 数据与请求流

### 首次发送

1. Web 请求创建 `knowledge_conversation` Thread，不传项目或企业主体标识。
2. Daemon 验证企业会话和 MCP Grant，绑定服务端主体，创建隔离工作区并持久化 Thread。
3. Web 使用现有 Run Service 向该 Thread 提交 prompt。
4. Run Manager 复用现有队列和 app-server runner，并应用知识专用工具策略。
5. 事件通过现有 SSE、事件存储和历史接口返回。

### 恢复与继续

1. 进入知识对话视图时，Web 查询当前主体最近的活跃知识 Thread。
2. Web 使用现有 Thread history、Thread runs 和 Run SSE 恢复时间线。
3. 新消息继续提交到同一 Thread；同 Thread 并发规则与项目任务对话一致。

## 错误处理

- 未登录或会话过期：阻止创建和发送，引导用户进入企业账户页。
- `knowledge.search` 未授权：明确显示当前 Agent 没有知识检索权限，不创建普通 Run 兜底。
- MCP 或企业知识服务暂不可用：保留草稿和历史，允许用户重试。
- 账号切换：立即停止向旧主体 Thread 发送新请求，并重新解析当前主体的知识 Thread。
- 权限在 Run 排队期间撤销：Run 启动前再次验证并确定性失败。
- 视图切换：不取消活动 Run；用户返回对话视图后继续订阅或恢复事件。

错误响应必须使用稳定错误码并经过现有 Runtime 错误映射与脱敏链路。

## Web 与 Desktop 一致性

- 列表/对话切换、文案、布局、状态、Runtime 请求和持久化结果必须由共享 Web 前端实现。
- 禁止按 `hostBridge.kind` 分叉知识对话。
- Browser Bridge 与 Desktop Bridge 调用相同 Daemon API。
- 相同内容视口下，两端的主要 DOM、按钮状态、时间线和输入区尺寸必须一致。

## 测试与发布门禁

### 协议与 Daemon

- `knowledge_conversation` 创建、持久化、查询和归属验证。
- 知识 Thread 不进入项目会话列表和项目级聚合。
- 不同企业主体之间的列表、详情、历史和 Run 全部隔离。
- MCP Grant 缺失、撤销、服务不可用和会话过期均阻止 Run。
- 工具白名单禁止本地命令、文件访问和未授权 MCP。
- 知识 Run 复用队列、取消、SSE 重放、Daemon 重启收敛和历史恢复。

### Web

- “对话知识库 / 返回列表视图”按钮切换正确并保留列表状态。
- 刷新按钮保留且继续刷新知识库数据。
- 首次有效发送懒创建 Thread，后续消息复用同一 Thread。
- 活动 Run 在切换视图后继续，返回时恢复时间线。
- 未登录、未授权、服务不可用和账号切换状态可见且不可误发送。

### 一致性与实际 App

- 使用同一个 Fake Daemon 分别在 Browser/Desktop Bridge 下验证页面、请求和持久化结果。
- 验证 390px 移动视口无页面级溢出。
- 运行实际打包 App E2E，覆盖 Preload Bridge、`clawee-app://`、Runtime 代理、知识 Thread 恢复和真实 MCP 权限门禁。
- 重新构建 Web，并校验 `apps/web/dist` 与 App 内嵌资源哈希完全一致。

未通过类型检查、相关单元/集成测试、一致性 E2E 和实际打包 App E2E 时，不得声明 Web/Desktop 已一致或可发布。

## 非目标

- 不把知识对话绑定到项目或显示在项目会话列表。
- 不新增独立于 Runtime 的企业聊天执行器。
- 不使用静态问答或模型固有知识作为真实检索的替代品。
- 不在本阶段提供多个知识会话的管理列表、重命名、归档入口或跨账号迁移。
- 不让知识对话访问本地项目文件或执行系统命令。
