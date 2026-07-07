# Clawee 桌面 Agent Web UI 设计

日期：2026-07-07

## 1. 背景

Clawee 的目标是一个本机运行的企业 Agent 桌面应用。它可以依赖本机 Codex CLI 和现有 Agent Runtime 作为执行内核，但产品表达不能显示成 Codex，也不能让用户感知为“连接一个远端 runtime 的开发工具”。

第一版实现载体仍然可以是 Web App，后续由 Electron 或 Tauri 桌面壳承载同一套前端。Web App 阶段必须按最终桌面应用的信息架构和交互设计实现，不能再做一个临时工作台。

本设计参考 Codex App 的窗口结构、左侧导航、项目/对话组织、输入框和文件审查交互，但品牌、文案和默认体验统一为 Clawee。Codex 只作为底层依赖，在“关于 Clawee / 高级信息”中允许展示 CLI 版本、路径和 `CODEX_HOME`。

## 2. 产品定位

Clawee 是企业日常工作 Agent，不是编程 IDE，也不是 Codex TUI 的图形化版本。

第一版 UI 采用三层结构：

1. 左侧：全局入口、项目、对话、设置。
2. 中间：任务对话和 Agent 执行流。
3. 右侧：按需打开的详情区，用于文件预览、变更审查和运行详情。

默认体验应降低技术噪声。命令、工具调用、底层事件、diagnostics 不直接铺在主对话中，只在详情区或高级信息中查看。

## 3. 设计目标

第一版需要做到：

1. 主界面形态贴近用户截图中的桌面 App：左侧栏 + 中间会话 + 按需右侧详情。
2. 品牌统一为 Clawee，主界面不出现 Codex App、Codex Runtime 等产品化文案。
3. 自动使用本机 Agent Runtime 和本机 Codex 环境，不出现手动 runtime 地址、token、登录 API Key 配置。
4. 项目 = 本机工作目录 + 默认运行配置，项目下聚合对话。
5. 每个对话对应一个 runtime thread。
6. 输入框可选择项目、权限、模型和运行上下文。
7. 文件卡、变更卡、审查入口进入主任务流。
8. 右侧详情区支持文件预览、变更审查、运行详情。
9. 设置第一版极简，只保留能跑起来所需的默认项和诊断信息。
10. Runtime 已支持能力接真实 API；未支持但原型需要的能力允许前端 mock，但必须通过 adapter 隔离，不能污染组件。

## 4. 非目标

第一版不做：

1. 完整桌面打包和系统级自动更新。
2. 账号体系、登录态管理、API Key 管理。
3. 手动输入 runtime 地址或 token。
4. 独立于 `~/.codex` 的第二套 Codex 配置系统。
5. 完整 `~/.codex/config.toml` 编辑器。
6. IDE 级文件编辑器、终端、Git 面板。
7. 外观主题、快捷键自定义、宠物、浏览器、电脑操控等高级设置。
8. 移动端适配。
9. 将 mock 文件保存伪装成真实磁盘写入。

## 5. 信息架构

```text
Clawee
├── 新对话
├── 搜索
├── 已安排
├── 插件
├── 项目
│   ├── Playground
│   ├── content-design
│   ├── bili
│   ├── default
│   ├── feigua
│   └── cover
├── 对话
│   ├── 最近对话
│   └── 暂无聊天
└── 底部
    ├── 设置 / 账户
    └── 更新
```

### 5.1 左侧栏

左侧栏是固定主导航，宽度参考截图，采用浅色半透明背景。

顶部入口：

1. `新对话`：打开当前项目的新任务输入。
2. `搜索`：搜索项目、对话、消息和文件卡。
3. `已安排`：展示计划任务。
4. `插件`：展示 Skills 和 MCP 能力。

项目区域：

1. 展示固定/最近项目。
2. 点击项目后切换当前项目。
3. 项目下可展开最近对话。
4. 项目名称来自用户定义或工作目录名。

对话区域：

1. 展示跨项目最近对话。
2. 空状态显示 `暂无聊天`。
3. 对话条目显示标题和相对时间。

底部区域：

1. `设置 / 账户`：进入设置页。第一版账户仅作为占位身份区域，不做登录。
2. `更新`：检查 Clawee 版本和本地运行内核状态。

### 5.2 中间会话区

空状态文案：

```text
要在 content-design 中处理什么？
```

当未选项目时：

```text
今天要让 Clawee 处理什么？
```

会话区包含：

1. 顶部标题：当前对话标题。
2. 顶部操作：打开位置、详情按钮、窗口/布局按钮。
3. 消息流：用户消息、Clawee 回复、状态摘要。
4. 文件卡：由 Agent 引用或生成的文件。
5. 变更卡：展示文件变更摘要和审查入口。
6. 底部输入框：输入任务、选择权限、模型、项目和上下文。

主消息流不直接展示 raw event、完整 stderr、完整命令输出。需要排障时通过详情区查看。

### 5.3 右侧详情区

右侧详情区默认关闭，只有用户触发时打开。它不是常驻 IDE。

触发入口：

1. 点击文件卡：打开文件预览。
2. 点击变更卡的 `审查`：打开变更审查。
3. 点击顶部 `打开位置`：打开项目位置或文件树。
4. 点击运行状态：打开运行详情。

第一版详情区支持三种模式：

1. 文件预览：Markdown、纯文本、JSON 等基础预览。
2. 变更审查：展示文件名、增删行数、diff 摘要、确认/撤销入口。
3. 运行详情：展示状态、关键事件、诊断文件和错误信息。

文件树可以作为右侧详情区的一种视图出现，但第一版不把它做成常驻第四栏。

## 6. 主路径流程

### 6.1 新对话

1. 用户点击 `新对话` 或选择项目后输入任务。
2. UI 使用当前项目的 cwd、默认权限、模型和 profile 创建 thread/run。
3. Runtime 返回 run 后，UI 立即显示用户消息和运行状态。
4. UI 建立 SSE 订阅，持续更新任务状态和消息流。
5. Run 完成后，对话归档到项目和最近对话列表。

### 6.2 继续对话

1. 用户在已有对话中继续输入。
2. UI 使用 threadId 调用 `/runs`，不覆盖 thread 固化的 cwd/profile/model/reasoning/sandbox。
3. 如果 Runtime 返回 resume 相关错误，UI 提供 `开启新上下文继续` 的降级动作。
4. 同一 thread 有 running/queued run 时，composer 禁用，避免并发打乱上下文。

### 6.3 文件与变更

Runtime 当前不提供完整文件树、文件读取、保存、diff review API。第一版处理方式：

1. Runtime 事件中能识别到的文件引用，展示为文件卡。
2. 能从 diagnostics 或事件中提取的变更摘要，展示为变更卡。
3. 缺口能力使用 mock adapter 补齐展示形态。
4. mock 文件内容必须标记为草稿，不得显示为已写入真实磁盘。
5. 未来接入真实文件 API 时替换 adapter，不改主组件结构。

### 6.4 已安排

`已安排` 使用 Runtime schedules 能力。

第一版展示：

1. 任务名称。
2. 所属项目。
3. cron 或执行时间。
4. 下次运行时间。
5. 最近结果。
6. 启用/停用。
7. 立即运行。

睡眠唤醒后不补跑错过任务。错过即错过，避免唤醒后瞬间触发多个任务导致负载不可控。

### 6.5 插件

`插件` 是 Clawee 的本地能力页，聚合：

1. Skills。
2. MCP 服务。
3. 本机配置状态。

文案使用 `本地能力`、`本机配置`、`服务状态`，不在普通页面强调 Codex。

## 7. 输入框设计

输入框参考截图中的大输入框，包含两层：

1. 上层：多行文本输入。
2. 下层：动作和上下文状态。

左侧动作：

1. `+`：添加附件或引用文件。第一版可 mock。
2. 权限选择：`跟随全局配置`、`工作区读写`、`完全访问`。

右侧动作：

1. 模型选择：如 `5.5 超高`。
2. 发送按钮。

底部上下文：

1. 当前项目。
2. 本地模式。
3. 当前分支。

权限选择是会话级覆盖。设置里的默认权限只决定新会话默认值。

## 8. 设置简化方案

设置页采用截图中的全屏设置结构，但第一版只保留少量真实有用的内容。

### 8.1 设置导航

只保留：

1. `常规`
2. `插件`
3. `关于 Clawee`

不显示未实现的高级入口，避免空壳。

### 8.2 常规

常规页包含：

1. 默认权限
   - `跟随全局配置`
   - `工作区读写`
   - `完全访问`
2. 默认文件打开方式
   - `VS Code`
   - `系统默认`
   - `打开所在文件夹`
3. 语言
   - 固定 `中文`
   - 第一版不可编辑
4. 菜单栏显示
   - 关闭主窗口后是否保留 Clawee

不提供工作模式切换。Clawee 只有一种模式：企业日常工作。

### 8.3 插件

插件设置页只做状态和入口：

1. Skills 状态。
2. MCP 服务状态。
3. 最近检测时间。
4. 跳转主导航 `插件` 页。

真实管理能力仍在主 `插件` 页，设置里不重复做一套。

### 8.4 关于 Clawee

展示：

1. Clawee 版本。
2. Runtime 版本。
3. 数据目录。
4. 检查更新。

高级信息允许展示：

1. Codex CLI 版本。
2. Codex CLI 路径。
3. `CODEX_HOME`。
4. 本地运行内核状态。
5. 最近一次检测时间。

Codex 相关信息只能出现在高级诊断语境中。

## 9. Runtime 接入边界

真实接入：

1. `/healthz`
2. `/codex/status`
3. `/threads`
4. `/runs`
5. `/runs/:id/events`
6. `/runs/:id/cancel`
7. `/runs/:id/diagnostics`
8. `/codex/skills`
9. `/codex/mcp`
10. `/schedules`
11. `/runtime/cleanup`

允许 mock：

1. 项目管理。
2. 文件树。
3. 文件预览内容。
4. 文件保存。
5. diff 审查。
6. 附件。
7. 顶部窗口布局按钮。

Mock 必须满足：

1. 通过 service/adapter 隔离。
2. 数据对象标记来源。
3. UI 文案不能暗示已经真实写盘。
4. 未来接真实 API 时不改页面主结构。

## 10. 连接与本机应用约束

Clawee 是本机应用，不应让用户手动连接 runtime。

Web App 开发阶段可以由开发脚本或 HostBridge 注入 runtime address/token。桌面阶段由桌面壳启动或发现 daemon，并把连接信息注入前端。

用户界面不提供：

1. Runtime URL 输入框。
2. Token 输入框。
3. API Key 设置页。
4. 登录 Codex 的入口。

连接异常时，UI 显示：

1. `本地服务未启动`
2. `正在重新连接`
3. `本地运行内核异常`

排障详情可在关于页高级信息中查看。

## 11. 前端架构

```text
React UI
  -> feature state / hooks
    -> services
      -> runtime client
      -> mock adapters
      -> host bridge
```

建议目录：

```text
apps/web/src/
  app/
  runtime/
  host/
  services/
  features/
    shell/
    conversation/
    projects/
    search/
    schedules/
    plugins/
    settings/
    details/
  components/
    primitives/
    composer/
    sidebar/
    cards/
    details/
  styles/
```

组件不直接调用 fetch，不直接读写 localStorage，不直接假设浏览器或桌面环境。

### 11.1 HostBridge

HostBridge 收拢本机能力：

1. 读取 runtime 连接信息。
2. 打开文件或目录。
3. 打开外部编辑器。
4. 发送桌面通知。
5. 获取应用版本。

浏览器实现可以降级为 no-op 或 mock；桌面实现再接系统能力。

### 11.2 SSE

浏览器原生 `EventSource` 不能带 Authorization header。第一版应使用 fetch + ReadableStream 解析 SSE。

要求：

1. 支持 Authorization header。
2. 支持 heartbeat。
3. 支持 `id`、`event`、`data`。
4. 支持 `fromSeq` 续传。
5. 切换 thread 时关闭旧连接。
6. 只为当前查看的 thread 的最新非终态 run 保持活跃订阅。

## 12. 数据模型

核心 UI 模型：

```ts
type Project = {
  id: string;
  name: string;
  cwd: string;
  pinned: boolean;
  defaultProfile: string;
  defaultModel?: string;
  defaultReasoning?: string;
  defaultSandbox: "follow-global" | "workspace-write" | "danger-full-access";
};

type Conversation = {
  id: string;
  projectId: string;
  threadId: string;
  title: string;
  updatedAt: string;
  status: "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled";
};

type DetailPanel =
  | { kind: "closed" }
  | { kind: "file"; fileId: string }
  | { kind: "change"; changeId: string }
  | { kind: "run"; runId: string };
```

项目数据第一版可以从最近 thread 的 cwd 聚合，也可以提供固定 mock 项目列表。后续桌面版应支持用户手动添加本机目录并固定项目。

## 13. 错误处理

面向用户的错误要用 Clawee 语言表达：

1. Runtime 未启动：`Clawee 本地服务未启动`
2. Codex CLI 缺失：`本地运行内核不可用`
3. 401：不显示 token，提示 `本地连接已失效，请重新启动 Clawee`
4. thread 已归档：提示 `这个对话已归档`
5. resume 失败：提供 `开启新上下文继续`
6. MCP/Skills 失败：提示 `本地能力检测失败`
7. mock 保存失败：提示 `草稿保存失败`

只有高级详情中展示底层错误码和 Codex CLI 信息。

## 14. 视觉原则

1. 使用浅色、安静、桌面应用质感。
2. 侧栏和设置页参考截图中的布局密度。
3. 主会话留足空白，避免后台系统感。
4. 卡片圆角控制在 8px 左右，避免过度圆润。
5. 按钮优先使用图标加 tooltip。
6. 不使用大面积渐变、营销 hero、装饰图形。
7. 中文作为默认 UI 语言。
8. 主界面所有品牌显示为 Clawee。

## 15. 测试策略

第一版验收测试覆盖：

1. 空状态：未选项目和选中项目两种文案。
2. 新对话：创建 thread/run，SSE 状态正常更新。
3. 继续对话：同 thread 追加消息，活跃 run 时禁用 composer。
4. 项目切换：项目列表、对话列表、输入框上下文同步变化。
5. 变更卡：展示增删行数，点击打开审查详情。
6. 文件卡：点击打开右侧文件预览。
7. 运行详情：点击状态打开事件/diagnostics。
8. 已安排：列表、启停、立即运行、错过不补跑。
9. 插件：Skills/MCP 状态展示和失败提示。
10. 设置：常规、插件、关于 Clawee 三页可用。
11. 品牌检查：主 UI 不出现 Codex 产品名。
12. 高级信息：允许展示 Codex CLI 版本、路径、`CODEX_HOME`。
13. 连接异常：不出现手动 URL/token 输入。
14. Mock 边界：mock 文件不显示为真实写盘成功。

## 16. 第一版验收标准

1. 打开应用后看到 Clawee 桌面 App 风格主界面。
2. 左侧栏结构与截图方向一致。
3. 选中项目后能发起新任务。
4. 对话消息和运行状态能从 Runtime 更新。
5. 文件卡、变更卡和右侧详情区形成完整任务流。
6. 设置页只包含常规、插件、关于 Clawee。
7. 主界面无 Codex 品牌露出。
8. 关于页高级信息可看到 Codex CLI 诊断。
9. 不要求用户输入 runtime token 或 API Key。
10. Runtime 缺口能力通过 adapter mock，不影响后续替换。

## 17. 后续阶段

后续再逐步补：

1. 桌面壳。
2. 自动启动 daemon。
3. 真实项目管理。
4. 真实文件树和文件读取。
5. 真实 diff/patch review。
6. 系统通知。
7. 自动更新。
8. 更完整的企业配置和策略管理。
