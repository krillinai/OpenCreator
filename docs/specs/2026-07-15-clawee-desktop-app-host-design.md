# Clawee 桌面版 App 宿主与 Codex 启动门禁规格

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 文档状态 | 待实施 |
| 版本 | 1.0 |
| 创建日期 | 2026-07-15 |
| 适用范围 | Clawee Desktop Host、Local Runtime Daemon、Web UI、Protocol、通知、打包与发布 |
| 技术路线 | Electron 薄宿主 + 现有 React Web UI + 独立 Clawee Daemon |
| 首要平台 | macOS；架构保持 Windows 可移植 |
| 规格优先级 | 本文档覆盖现有文档中尚未实现的原生 Desktop Host 部分 |

本文是 Clawee 桌面版第一阶段的产品、架构和实施规格。开发必须按照本文定义的进程边界、启动门禁和验收标准执行。

如实现过程中需要改变以下原则，必须先更新本文档：

1. Clawee 依赖用户本机已经安装并可用的 Codex CLI。
2. Clawee 不内置 Codex CLI，不管理 Codex 登录。
3. Codex 是否可用只通过一次真实最小模型调用判断。
4. 只有真实调用成功后，才加载 Clawee 主工作台。
5. 页面刷新、切换项目和从托盘重新打开窗口不能重复执行启动探测。
6. 启动探测不得加载 Clawee Skills、Skill Market 或 MCP 页面数据。

## 1. 一句话定义

**Clawee Desktop 是本机 Codex CLI 的桌面 Agent 工作台，由 Electron 托管现有 Web UI 和 Clawee Daemon，并在冷启动时通过一次真实 Codex `hello` 调用确认完整运行链可用。**

## 2. 已确认决策

### 2.1 产品决策

1. Clawee 不是 Codex 安装器。
2. Clawee 不提供 Codex 登录页面。
3. 用户应当在安装 Clawee 前，自行完成 Codex CLI 的安装和本机配置。
4. Clawee 启动后先显示轻量环境检查界面，不立即加载主工作台。
5. Codex CLI 能完成一次真实最小请求并返回有效 assistant 消息，才视为可用。
6. 探测失败时只进入诊断界面，不允许跳过后进入主工作台。
7. 探测失败不推断为“未登录”，也不调用 `codex login status`。
8. 探测成功后，现有项目、会话、任务、插件、Skills、MCP 和设置功能保持不变。

### 2.2 技术决策

1. 桌面宿主采用 Electron。
2. 不重写 `apps/web`，桌面版直接承载现有 React Web UI。
3. 不把 Daemon 逻辑合并进 Renderer 或 Electron Main。
4. Clawee Daemon 作为 Electron 管理的独立 Utility Process 运行。
5. Electron Main 负责 Codex 路径解析、Daemon 生命周期、窗口、托盘、通知、深链接和更新。
6. Renderer 不允许直接访问 Node.js、Electron、文件系统或 Shell。
7. Desktop Host 通过现有 `HostBridge` 方向向 Web UI 暴露有限原生能力。
8. Daemon 继续只监听 `127.0.0.1` 的随机端口，并使用每次启动生成的临时 token。
9. Web 开发服务器继续固定使用 `127.0.0.1:9000`；该端口只用于开发环境，不用于生产 Daemon。

### 2.3 Codex 可用性决策

以下项目不是独立启动门禁：

1. Codex 登录状态。
2. Codex 版本是否位于预设白名单。
3. `CODEX_HOME` 中是否存在某个特定认证文件。
4. `codex doctor` 的单项诊断结果。
5. MCP 是否可用。
6. Skills 是否可用。
7. Skill Market 是否可访问。

唯一硬门禁是：

```text
Clawee Daemon
  -> 使用目标 Codex CLI 和目标 CODEX_HOME
  -> 发起一次临时、只读、无工具的最小请求
  -> 收到至少一条非空 assistant 消息
```

## 3. 当前实现基线

### 3.1 已有模块

当前仓库已经具备：

1. `apps/web`
   - React 18、TypeScript、Vite。
   - 已按桌面工作台形态实现主界面。
   - 已有项目、会话、任务、插件、文件、设置和审批交互。
2. `apps/daemon`
   - Node.js、Fastify、`better-sqlite3`。
   - 已有 Thread、Run、Scheduler、Skills、MCP、附件、搜索、记忆、通知和诊断。
   - 已支持 `codex exec` 和 Codex `app-server` 两种执行链。
3. `packages/protocol`
   - 已定义前后端共享协议。
4. `apps/harness`
   - 已有通知 outbox 消费和深链接参考实现。
5. `apps/web/src/host/bridge.ts`
   - 已定义 `browser | desktop` Host 类型。
   - 已定义连接配置、外部链接、文件定位、通知和后台通知配置。
6. Daemon 启动协议
   - Daemon 监听随机本地端口。
   - 启动成功后 stdout 输出 `address` 和 `token`。

### 3.2 当前缺口

当前仓库没有真实原生 Desktop Host，因此缺少：

1. Electron 应用入口。
2. Codex 路径解析和 GUI Shell 环境恢复。
3. 冷启动真实 Codex 探测。
4. Daemon Utility Process 托管。
5. 启动检查界面。
6. 主窗口生命周期管理。
7. 系统托盘和后台驻留。
8. 原生通知和通知点击跳转。
9. 外部深链接和单实例。
10. macOS 应用打包、签名、公证和自动更新。
11. 原生 Desktop Host 实机验收。

### 3.3 必须复用的现有能力

桌面版不能重写以下能力：

1. Web 主工作台和现有业务页面。
2. Daemon 的 Thread、Run、Scheduler、Skills 和 MCP 服务。
3. Daemon 的 bearer token 鉴权。
4. 通知 outbox 数据模型和确认语义。
5. 现有 Thread、Run、Approval 深链接格式。
6. `CLAWEE_CODEX_BIN`、`CLAWEE_CODEX_HOME` 和 `CLAWEE_DATA_DIR` 环境入口。

## 4. 目标与成功标准

### 4.1 产品目标

1. 用户点击 Clawee 后立即看到启动检查界面。
2. Clawee 自动找到用户在终端中实际使用的 Codex CLI。
3. Clawee 通过真实 Codex 请求判断环境是否可用。
4. 探测成功后自动进入现有主工作台。
5. 探测失败时提供明确、可操作且不误判登录状态的诊断。
6. 用户刷新页面时不会再次等待 Codex 探测。
7. 用户关闭主窗口后，正在执行的任务和计划任务可以继续运行。
8. 系统通知可以打开正确的 Thread、Run 或 Approval。
9. 应用重新打开时复用正在运行的 Daemon。
10. 应用真正退出时可以有序关闭 Daemon。

### 4.2 技术成功标准

1. Electron Main、Preload、Renderer 和 Daemon 进程边界明确。
2. `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`。
3. Renderer 只能通过固定 IPC 白名单访问原生能力。
4. Daemon 只监听 `127.0.0.1`，端口由系统分配。
5. Daemon token 不写入磁盘和日志。
6. Desktop Host 能从 Daemon stdout 可靠获取连接配置。
7. 冷启动时最多执行一次自动 Codex 探测。
8. 自动探测失败后不自动循环重试。
9. 探测使用临时会话，不进入 Clawee Thread、Run 或通知历史。
10. 探测不启动 Clawee Scheduler，直到探测成功。
11. 探测不调用 `codex login status` 或 `codex doctor`。
12. 探测不调用 MCP 管理 API、Skills 扫描或 Skill Market。
13. 页面刷新不会重启 Daemon，也不会再次调用 Codex。
14. Daemon 崩溃后 Host 能展示故障状态并执行受控重启。
15. `better-sqlite3` 能在打包后的 Utility Process 中正常加载。

### 4.3 性能目标

1. 点击应用后 500ms 内显示启动检查窗口。
2. 本机 Codex 路径解析目标耗时不超过 2 秒，硬超时 5 秒。
3. Codex 真实探测硬超时 30 秒。
4. 探测成功后 1.5 秒内开始显示 Clawee 主工作台。
5. 主工作台刷新不执行 Codex 探测，目标恢复时间不超过 2 秒。
6. 从托盘重新打开窗口不执行 Codex 探测，目标显示时间不超过 500ms。

## 5. 非目标

第一阶段不做：

1. 内置或自动下载 Codex CLI。
2. Clawee 内部的 Codex 登录、退出或账号切换。
3. API Key、ChatGPT 账号或访问令牌管理。
4. Codex 版本自动更新。
5. 独立于 `$CODEX_HOME` 的第二套 Codex 配置。
6. 启动时加载全部 MCP。
7. 启动时扫描全部 Skills。
8. 启动时加载 Skill Market。
9. 多个主窗口。
10. 内置终端、Git 面板或 IDE 级编辑器。
11. 云同步、多人协作和团队账号。
12. 将 Daemon 安装为独立系统服务。
13. 移动端桌面伴侣。

## 6. 总体架构

```text
┌────────────────────────────────────────────┐
│ Clawee Desktop Host / Electron Main        │
│                                            │
│  Codex Resolver      Bootstrap Controller  │
│  Daemon Manager      Window Manager        │
│  Tray Manager        Notification Manager  │
│  Deep Link Manager   Update Manager        │
└───────────────────────┬────────────────────┘
                        │ Utility Process
                        ▼
┌────────────────────────────────────────────┐
│ Clawee Daemon                              │
│                                            │
│  Codex Probe       Runtime API             │
│  Thread / Run      Scheduler               │
│  Skills / MCP      SQLite / Notifications  │
└───────────────────────┬────────────────────┘
                        │ child process
                        ▼
┌────────────────────────────────────────────┐
│ 用户本机 Codex CLI                         │
│ 用户本机 CODEX_HOME                        │
└────────────────────────────────────────────┘

Electron Renderer
  -> 只加载本地打包的现有 apps/web
  -> 通过 Preload Bridge 获取连接配置和原生能力
  -> 通过 HTTP/SSE 访问 127.0.0.1 Daemon
```

### 6.1 Electron Main 职责

1. 保证单实例。
2. 创建启动检查窗口和主工作台窗口。
3. 解析 Codex CLI 路径和 Shell 环境。
4. 启动、监控、重启和关闭 Daemon。
5. 解析 Daemon stdout 启动协议。
6. 保存 Desktop 专属设置。
7. 管理托盘、系统通知和外部深链接。
8. 管理自动更新。
9. 记录 Desktop Host 日志。

Electron Main 不负责：

1. Thread、Run 或 Schedule 数据。
2. Codex 会话协议。
3. Skills 或 MCP 业务逻辑。
4. React 页面状态。
5. 直接访问 Clawee SQLite。

### 6.2 Preload 职责

1. 通过 `contextBridge` 暴露固定 API。
2. 对 Renderer 输入做基础类型校验。
3. 将 IPC 结果映射为 `HostBridge`。
4. 不暴露 `ipcRenderer`、Shell 或任意文件读取能力。

### 6.3 Renderer 职责

1. 运行现有 `apps/web`。
2. 从 Desktop Host 获取 Daemon 连接配置。
3. 使用现有 RuntimeClient 调用 Daemon。
4. 处理 Host 发出的连接更新和深链接导航事件。
5. 不参与冷启动 Codex 探测。

### 6.4 Daemon 职责

1. 使用 Host 指定的 `CLAWEE_CODEX_BIN` 和 `CLAWEE_CODEX_HOME`。
2. 在 Desktop 模式下先完成真实 Codex 探测。
3. 探测成功后再启动完整 Runtime 和 Scheduler。
4. 继续承载所有现有业务能力。
5. 输出结构化启动状态和最终连接配置。

## 7. 桌面应用产品形态

### 7.1 窗口模型

第一版只使用一个主 BrowserWindow：

1. 启动时加载 Desktop 自带的轻量 Bootstrap 页面。
2. 探测成功后，同一个窗口切换到打包后的 `apps/web`。
3. 不创建登录窗口。
4. 不创建独立设置窗口。
5. 不创建独立审批窗口。
6. 通知点击后复用并聚焦主窗口。

使用同一个窗口的原因：

1. 避免 Splash 窗口和主窗口切换闪烁。
2. 避免两个窗口之间同步尺寸和焦点。
3. 启动失败时可以直接保留诊断界面。
4. 主工作台加载前不会挂载现有 Web App。

### 7.2 启动检查页面

正常状态依次展示：

1. `正在查找本机 Codex`
2. `正在启动本地运行服务`
3. `正在验证 Codex 是否可用`
4. `正在打开 Clawee`

页面要求：

1. 只展示当前阶段，不展示 Skills、MCP 或项目加载状态。
2. 3 秒内完成时保持简洁，不展示技术细节。
3. 超过 3 秒后显示当前阶段和已等待时间。
4. 不显示“正在登录”。
5. 不显示账号头像、验证码、API Key 输入框。
6. 不提供跳过按钮。

### 7.3 启动失败页面

失败页面统一使用：

```text
Codex CLI 暂时无法完成调用

Clawee 已尝试通过本机 Codex 发送一条测试消息，
但没有收到有效响应。
```

主要动作：

1. `重新检测`
2. `选择 Codex 路径`
3. `查看诊断`
4. `退出 Clawee`

诊断信息：

1. Codex 实际路径。
2. `CODEX_HOME`。
3. 探测阶段。
4. 调用耗时。
5. 退出码或终止信号。
6. 脱敏后的 stderr 摘要。
7. Desktop Host 日志目录。

禁止出现：

1. `尚未登录`
2. `登录已过期`
3. `请在 Clawee 中登录`
4. 未经 Codex 明确返回的认证原因推断

## 8. Codex 路径与环境解析

### 8.1 解析原则

GUI 应用不能假设能继承用户终端中的完整 `PATH`。Desktop Host 必须解析并保存实际 Codex 路径，同时将匹配的环境传给 Daemon。

解析优先级：

1. 用户手动选择并且上次探测成功的 Codex 路径。
2. Desktop 设置中保存的上次成功路径。
3. 当前 Electron 进程环境中的 `PATH`。
4. 用户登录 Shell 环境中的 `PATH`。
5. macOS 常见本地可执行目录。
6. 找不到时进入路径选择状态。

macOS 常见目录只作为候选来源，不作为可用性证明：

```text
/opt/homebrew/bin
/usr/local/bin
~/.local/bin
~/.local/node-current/bin
~/.npm-global/bin
```

### 8.2 Shell 环境恢复

Desktop Host 可以通过用户默认 Shell 获取登录环境，但必须满足：

1. 命令内容固定，不拼接用户输入。
2. 使用 5 秒硬超时。
3. 限制输出大小。
4. 忽略 Shell 初始化脚本产生的额外文本。
5. 失败后继续使用现有环境和常见路径，不导致 Main 进程退出。
6. 不使用 `shell: true` 执行动态命令。

### 8.3 路径持久化

Desktop 设置只保存：

```ts
type DesktopRuntimeSettings = {
  codexBin?: string;
  closeBehavior: 'hide' | 'quit';
  launchAtLogin: boolean;
};
```

规则：

1. 只在真实探测成功后将候选路径标记为“上次成功路径”。
2. 手动选择但探测失败的路径可以保留为当前候选，但不能覆盖成功路径。
3. 不保存 token。
4. 不复制 Codex 配置。
5. 不保存 Codex 登录状态。

### 8.4 传递给 Daemon 的环境

Desktop Host 至少传递：

```text
CLAWEE_CODEX_BIN=<absolute path>
CLAWEE_CODEX_HOME=<resolved CODEX_HOME>
CLAWEE_DATA_DIR=<app userData>/daemon
CLAWEE_REQUIRE_CODEX_PROBE=1
HOME=<user home>
PATH=<resolved shell path>
SHELL=<user shell>
```

Daemon 及其 Codex 子进程必须使用同一组环境，避免探测和真实 Run 使用不同 Codex。

## 9. 冷启动门禁

### 9.1 触发时机

自动探测只在以下情况触发：

1. Desktop Host 冷启动并创建新的 Daemon。
2. Daemon 异常退出后执行受控重启。
3. 用户选择新的 Codex 路径。
4. 用户在失败页面点击 `重新检测`。

以下操作不能触发：

1. Renderer 刷新。
2. 前端路由切换。
3. 打开插件页面。
4. 打开设置页面。
5. 切换项目或会话。
6. 隐藏窗口后从托盘重新打开。
7. 系统通知点击。

### 9.2 启动状态机

```text
IDLE
  -> RESOLVING_CODEX
  -> STARTING_DAEMON
  -> PROBING_CODEX
  -> STARTING_RUNTIME
  -> READY

任意非 READY 阶段
  -> FAILED

FAILED
  -> RETRYING
  -> RESOLVING_CODEX
```

状态类型：

```ts
type DesktopBootstrapPhase =
  | 'idle'
  | 'resolving_codex'
  | 'starting_daemon'
  | 'probing_codex'
  | 'starting_runtime'
  | 'ready'
  | 'failed';

type DesktopBootstrapState = {
  phase: DesktopBootstrapPhase;
  startedAt: string;
  updatedAt: string;
  attempt: number;
  codexBin?: string;
  codexHome?: string;
  durationMs?: number;
  error?: DesktopBootstrapError;
};
```

### 9.3 Daemon Bootstrap 模式

当 `CLAWEE_REQUIRE_CODEX_PROBE=1` 时，Daemon 启动顺序必须改为：

```text
读取环境
  -> 输出 probing_codex 状态
  -> 执行真实 Codex Probe
  -> Probe 成功
  -> 收集非阻断 capability 信息
  -> buildServer()
  -> 启动 Scheduler
  -> listen(127.0.0.1, 0)
  -> 输出 address + token
```

Probe 失败时：

1. 不调用 `buildServer()`。
2. 不打开 SQLite。
3. 不启动 Scheduler。
4. 不扫描 Skills。
5. 不创建 MCP Manager。
6. 输出结构化失败事件。
7. 以非零退出码结束 Daemon。

普通 Web 开发模式不设置 `CLAWEE_REQUIRE_CODEX_PROBE`，避免每次开发启动都产生真实模型调用。

### 9.4 Daemon stdout 协议

Bootstrap 进度行：

```json
{
  "type": "clawee_daemon_bootstrap",
  "phase": "probing_codex",
  "at": "2026-07-15T00:00:00.000Z"
}
```

探测成功：

```json
{
  "type": "clawee_daemon_bootstrap",
  "phase": "probe_succeeded",
  "durationMs": 1840,
  "responseReceived": true
}
```

探测失败：

```json
{
  "type": "clawee_daemon_bootstrap_error",
  "code": "CODEX_PROBE_TIMEOUT",
  "message": "Codex CLI did not return an assistant message before timeout",
  "durationMs": 30000,
  "details": {
    "exitCode": null,
    "signal": "SIGTERM"
  }
}
```

最终就绪行继续兼容现有协议：

```json
{
  "address": "http://127.0.0.1:60855",
  "token": "runtime-token"
}
```

规则：

1. 最终连接行的 `address` 和 `token` 字段不能改名。
2. token 只能通过父子进程管道传递。
3. 日志模块必须识别并删除 token 后再落盘。
4. Desktop Host 忽略未知 Bootstrap 事件，保证向后兼容。

## 10. Codex Probe 设计

### 10.1 Probe 服务

新增独立的 `CodexProbeService`：

```ts
type CodexProbeInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
};

type CodexProbeResult = {
  ready: boolean;
  responseReceived: boolean;
  markerMatched: boolean;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  terminationReason: string;
  stderrSummary?: string;
};
```

Probe 服务必须：

1. 复用 `startCodexExec()` 的进程托管、超时和强制终止能力。
2. 使用独立 Probe argv builder。
3. 解析 Codex JSONL 中的 assistant message。
4. 不使用 `RunManager`。
5. 不写 Clawee SQLite。
6. 不创建 Clawee Thread 或 Run。
7. 不生成通知。
8. 不调用 Scheduler。
9. 对 stderr 做脱敏和长度限制。

### 10.2 Probe 请求

每次探测生成随机 challenge：

```text
CLAWEE_READY_<random nonce>
```

Prompt：

```text
This is a Clawee startup availability probe.
Do not call tools and do not modify files.
Reply briefly to this hello message.
If possible, include this marker: CLAWEE_READY_<nonce>
```

成功标准：

1. Codex 进程正常完成。
2. JSONL 中至少出现一条非空 `agent_message`。

`markerMatched` 只作为诊断字段，不作为硬门禁。只要收到真实 assistant 消息，就证明 Codex CLI 能够完成调用。

### 10.3 Probe argv

目标命令语义：

```text
codex exec
  --json
  --ephemeral
  --skip-git-repo-check
  --ignore-rules
  --sandbox read-only
  -C <empty probe directory>
  -c mcp_servers={}
```

要求：

1. Prompt 通过 stdin 传入，不拼入 Shell 命令。
2. 使用用户真实 `CODEX_HOME`。
3. 使用用户真实 provider、model 和认证配置。
4. 使用空 Probe 工作目录，避免加载项目 `AGENTS.md`。
5. 使用 `--ephemeral`，避免持久化 Codex session。
6. 使用 `read-only`，禁止文件修改。
7. 使用 `mcp_servers={}` 覆盖关闭 MCP server。
8. 不传图片、Skills、附件或项目目录。
9. 不调用 `codex login status`。
10. 不调用 `codex doctor`。

如果目标 Codex CLI 不接受 Probe 必需参数，则 Probe 失败并展示真实错误；不根据版本号提前推断。

### 10.4 Probe 工作目录

目录位于：

```text
<app userData>/probe
```

规则：

1. 目录由 Desktop Host 或 Daemon 创建。
2. 目录中不能包含项目文件、`AGENTS.md` 或用户内容。
3. 每次启动前清理 Clawee 自己生成的临时 Probe 文件。
4. Probe 不允许访问用户项目 cwd。

### 10.5 超时和重试

1. 总超时：30 秒。
2. Spawn 首次活动超时：5 秒。
3. 进程终止宽限：2 秒。
4. 自动探测只执行一次。
5. 失败后不自动重试，避免重复模型调用。
6. 用户点击 `重新检测` 后执行新 attempt。
7. 新 attempt 开始前必须终止并回收旧 Daemon。
8. 同一 attempt 内禁止并发 Probe。

### 10.6 Probe 错误码

```ts
type CodexProbeErrorCode =
  | 'CODEX_NOT_FOUND'
  | 'CODEX_PATH_INVALID'
  | 'CODEX_PROBE_SPAWN_FAILED'
  | 'CODEX_PROBE_SPAWN_TIMEOUT'
  | 'CODEX_PROBE_TIMEOUT'
  | 'CODEX_PROBE_EXIT_NON_ZERO'
  | 'CODEX_PROBE_INVALID_OUTPUT'
  | 'CODEX_PROBE_NO_RESPONSE'
  | 'DAEMON_START_FAILED'
  | 'DAEMON_EXITED_BEFORE_READY';
```

禁止定义：

```text
CODEX_NOT_LOGGED_IN
CODEX_LOGIN_EXPIRED
CODEX_AUTH_REQUIRED
```

除非未来 Codex CLI 提供稳定、明确且本产品决定使用的结构化错误协议，否则 Clawee 不推断认证状态。

## 11. Daemon 生命周期

### 11.1 启动

Desktop Host：

1. 解析 Codex 路径和环境。
2. 使用 Electron Utility Process 启动打包后的 Daemon 入口。
3. 订阅 stdout、stderr 和 exit。
4. 解析 Bootstrap 状态。
5. 收到最终 `address + token` 后保存内存连接配置。
6. 将 Bootstrap 状态切换为 `ready`。
7. 通知 Window Manager 加载主工作台。

### 11.2 正常退出

用户选择 `退出 Clawee` 时：

1. 停止通知 outbox 消费。
2. 停止接受新的深链接导航。
3. 请求 Daemon 优雅关闭。
4. 最多等待 5 秒。
5. 超时后发送 `SIGTERM`。
6. 再等待 2 秒后强制终止。
7. 清理内存 token。
8. 退出 Electron。

### 11.3 窗口关闭

默认行为：

1. 点击关闭按钮只隐藏主窗口。
2. Daemon 和 Scheduler 继续运行。
3. 托盘继续显示。
4. 系统通知继续消费。

设置允许切换为：

```text
关闭窗口时退出 Clawee
```

### 11.4 Daemon 异常退出

规则：

1. Host 记录退出码和信号。
2. 主窗口仍存在时显示运行服务中断状态。
3. 第一次异常退出允许自动重启一次。
4. 自动重启必须重新执行 Codex Probe。
5. 第二次连续失败停止自动重启，进入诊断状态。
6. 不允许无限重启循环。
7. 恢复成功后通过 Host 事件更新 Web UI 连接配置。

连续失败计数在以下情况清零：

1. Daemon 稳定运行超过 5 分钟。
2. 用户手动点击重新检测并成功。

## 12. Renderer 与 Host Bridge

### 12.1 Desktop Bridge

新增 Desktop Bridge 实现，并保持现有 `HostBridge` 兼容：

```ts
type DesktopHostBridge = HostBridge & {
  kind: 'desktop';
  subscribeConnectionConfig?(
    listener: (connection: ConnectionConfig | null) => void
  ): () => void;
  restartRuntime?(): Promise<HostBridgeResult>;
};
```

现有方法继续支持：

1. `readConnectionConfig()`
2. `openExternal()`
3. `revealPath()`
4. `notify()`
5. `configureBackgroundNotifications()`

### 12.2 连接配置

规则：

1. 主工作台首次加载时，`readConnectionConfig()` 必须立即返回当前 Daemon 配置。
2. Renderer 刷新只重新读取内存配置。
3. Renderer 不负责启动 Daemon。
4. Renderer 不负责执行 Codex Probe。
5. Daemon 重启后通过订阅事件下发新 `address + token`。
6. Browser Bridge 行为保持不变。

### 12.3 内部页面协议

生产环境不直接使用 `file://` 加载主工作台。Desktop Host 注册安全的内部 scheme：

```text
clawee-app://app/
```

外部深链接使用：

```text
clawee://
```

两者不能混用：

1. `clawee-app://` 只服务打包后的本地静态资源。
2. `clawee://` 只接收系统外部唤起。
3. Daemon CORS 只增加对精确内部 origin 的允许。
4. 不允许任意自定义 scheme origin 访问 Daemon。

### 12.4 IPC 安全

BrowserWindow 固定配置：

```ts
{
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    preload: '<absolute preload path>'
  }
}
```

必须满足：

1. 不暴露 `require`。
2. 不暴露完整 `ipcRenderer`。
3. 不允许 Renderer 传入任意命令。
4. 不允许 Renderer 传入任意 Shell 参数。
5. `openExternal` 只允许 `https:` 和明确允许的协议。
6. `revealPath` 由 Main 校验路径存在性。
7. 所有 IPC channel 在共享类型文件中静态定义。
8. 所有监听函数返回取消订阅方法。
9. 窗口销毁时释放全部 listener。

## 13. 主窗口、托盘和系统集成

### 13.1 主窗口

1. 保存上次窗口尺寸和位置。
2. 恢复时校验窗口仍位于当前显示器可见范围。
3. 最小尺寸必须保证现有桌面工作台不重叠。
4. 启动阶段和主工作台阶段复用同一 BrowserWindow。
5. 主工作台加载失败时显示本地错误页，不能加载远程页面。
6. 外部链接统一交给系统浏览器。

### 13.2 系统托盘

托盘菜单：

1. 打开 Clawee。
2. 新建任务。
3. 查看运行中任务。
4. 暂停全部计划任务。
5. 恢复计划任务。
6. 退出 Clawee。

托盘本身不能直接读取 SQLite，所有状态通过 Daemon API 获取。

### 13.3 系统通知

Desktop Host 复用现有 outbox 语义：

1. 轮询或订阅待展示通知。
2. 成功交给系统通知中心后确认。
3. 展示失败不确认，下次重试。
4. 通知点击后打开并聚焦主窗口。
5. 跳转到目标 Thread。
6. 可选定位 Run 和 Approval。
7. Renderer 关闭或刷新不影响通知消费。

### 13.4 深链接

支持：

```text
clawee://thread/<threadId>
clawee://thread/<threadId>?runId=<runId>
clawee://thread/<threadId>?runId=<runId>&approvalId=<approvalId>
clawee://new
clawee://tasks
```

规则：

1. 只允许已知 route。
2. 所有 ID 都要 URL decode 后再做格式校验。
3. 应用未启动时缓存深链接，Probe 成功后再导航。
4. Probe 失败时保留待处理深链接。
5. 多次点击同一通知不创建新窗口。
6. Windows 第二实例参数和 macOS `open-url` 统一映射到同一解析器。

## 14. 本地数据与日志

### 14.1 数据目录

```text
<Electron userData>/
├── desktop-settings.json
├── window-state.json
├── logs/
│   ├── desktop-main.log
│   └── daemon.log
├── probe/
└── daemon/
    ├── app.sqlite
    ├── runs/
    ├── workspaces/
    └── attachments/
```

Codex 数据继续位于用户真实 `$CODEX_HOME`，不复制到 Clawee `userData`。

### 14.2 日志规则

1. token 永不落盘。
2. Authorization header 永不落盘。
3. Probe prompt 只记录固定模板，不记录随机完整 challenge。
4. Probe assistant 原始回复默认不落盘。
5. stderr 最多保留脱敏后的末尾 8KB。
6. Desktop 日志按大小轮转。
7. 日志目录可以从诊断页面打开。
8. 用户项目内容不写入 Desktop Main 日志。

## 15. 打包与发布

### 15.1 构建结构

新增：

```text
apps/desktop
├── package.json
├── tsconfig.json
├── electron-builder.yml
├── src/
│   ├── main/
│   │   ├── main.ts
│   │   ├── bootstrap-controller.ts
│   │   ├── codex-resolver.ts
│   │   ├── daemon-manager.ts
│   │   ├── window-manager.ts
│   │   ├── tray-manager.ts
│   │   ├── notification-manager.ts
│   │   ├── deep-link-manager.ts
│   │   ├── settings-store.ts
│   │   ├── protocol-handler.ts
│   │   └── updater.ts
│   ├── preload/
│   │   └── index.ts
│   ├── bootstrap/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── BootstrapView.tsx
│   └── shared/
│       ├── ipc.ts
│       └── types.ts
└── resources/
    ├── icons/
    └── entitlements.mac.plist
```

### 15.2 Daemon 打包

1. Daemon TypeScript 编译为生产 JavaScript。
2. Electron Main 不直接 import Daemon 业务模块。
3. Daemon 通过 Utility Process 加载独立入口。
4. `better-sqlite3` 针对 Electron 使用的 Node ABI 重建。
5. `.node` 原生文件放入 `asarUnpack`。
6. 打包后不依赖用户安装 Node.js。
7. 打包后仍依赖用户安装 Codex CLI。

### 15.3 平台顺序

P0：

1. macOS Apple Silicon 开发包。
2. macOS Intel 构建结构保持可用。

P1：

1. macOS 签名和公证。
2. macOS 自动更新。

P2：

1. Windows x64 安装包。
2. Windows Codex 路径解析。
3. Windows 深链接和托盘实机验收。

## 16. 实施任务

以下任务按依赖顺序执行。每个批次完成后必须保持全仓可构建、可测试。

### P0-B1：建立 Electron Desktop 工程骨架

**目标：** 新增可启动的安全 Electron Host，并能在开发环境加载固定 `9000` 端口的现有 Web UI。

**主要文件：**

- `apps/desktop/package.json`
- `apps/desktop/tsconfig.json`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/shared/ipc.ts`
- `package.json`
- `pnpm-lock.yaml`

**实现内容：**

1. 将 `apps/desktop` 接入 pnpm workspace。
2. 配置 Electron Main、Preload 和 Bootstrap 构建。
3. 创建单实例锁。
4. 使用安全 BrowserWindow 配置。
5. 开发环境加载 `http://127.0.0.1:9000`。
6. 生产环境暂时加载占位 Bootstrap 页面。
7. 增加 `desktop:dev`、`desktop:build` 和 `desktop:test` 脚本。

**验收标准：**

- [ ] `pnpm --filter @clawee/desktop typecheck` 通过。
- [ ] Electron 启动后只有一个主窗口。
- [ ] 第二次启动不会创建第二个主实例。
- [ ] Renderer 中不存在 `window.require`。
- [ ] `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true` 有自动化断言。
- [ ] 开发模式始终连接 `127.0.0.1:9000`。

**验证：**

```bash
pnpm --filter @clawee/desktop typecheck
pnpm --filter @clawee/desktop test
pnpm desktop:dev
```

**依赖：** 无。

**规模：** M。

### P0-B2：实现 Desktop 设置和 Codex 路径解析

**目标：** 在 GUI 环境中找到用户终端实际使用的 Codex，并保存上次成功路径。

**主要文件：**

- `apps/desktop/src/main/codex-resolver.ts`
- `apps/desktop/src/main/settings-store.ts`
- `apps/desktop/src/shared/types.ts`
- `apps/desktop/test/codex-resolver.test.ts`

**实现内容：**

1. 实现路径候选优先级。
2. 实现登录 Shell 环境恢复。
3. 实现超时、输出限制和路径规范化。
4. 实现手动选择可执行文件。
5. 保存候选路径和上次成功路径。
6. 将完整解析环境传给 DaemonManager。

**验收标准：**

- [ ] 能解析当前机器上的 `~/.local/node-current/bin/codex` 类路径。
- [ ] Electron 原始 `PATH` 不含 Codex 时，仍能从登录 Shell 找到。
- [ ] Shell 环境读取超过 5 秒会终止。
- [ ] 无效保存路径不会阻断后续候选搜索。
- [ ] 未经真实 Probe 成功的路径不会覆盖成功路径。
- [ ] 测试不调用真实模型。

**验证：**

```bash
pnpm --filter @clawee/desktop test -- codex-resolver
pnpm --filter @clawee/desktop typecheck
```

**依赖：** P0-B1。

**规模：** M。

### P0-B3：实现 Daemon Codex Probe 服务

**目标：** 在 Daemon 中通过真实 `codex exec --ephemeral` 请求判断 Codex 是否能返回 assistant 消息。

**主要文件：**

- `apps/daemon/src/codex/probe.ts`
- `apps/daemon/src/codex/probe-argv.ts`
- `apps/daemon/src/codex/runner.ts`
- `apps/daemon/test/unit/codex-probe.test.ts`
- `apps/daemon/test/unit/codex-probe-argv.test.ts`

**实现内容：**

1. 新增 `CodexProbeService`。
2. 生成固定模板和随机 marker。
3. 构建临时、只读、禁用 MCP 的 Probe argv。
4. 复用 `startCodexExec()`。
5. 解析 JSONL `agent_message`。
6. 按成功、超时、退出非零、无响应和非法输出映射结果。
7. 对 stderr 脱敏并截断。
8. 使用 fake Codex executable 完成单元测试。

**验收标准：**

- [ ] 收到任意非空 assistant 消息即成功。
- [ ] marker 未匹配但有 assistant 消息仍成功。
- [ ] `--ephemeral`、`read-only` 和空 cwd 被传入。
- [ ] argv 中明确禁用 MCP。
- [ ] 不调用 `login status`。
- [ ] 不调用 `doctor`。
- [ ] 不创建 Clawee Thread、Run、通知或 SQLite 文件。
- [ ] 超时后进程被完整回收。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- codex-probe
pnpm --filter @clawee/daemon typecheck
```

**依赖：** 无，可与 P0-B1 并行。

**规模：** M。

### P0-B4：接入 Daemon Bootstrap 协议

**目标：** Desktop 模式下先 Probe，成功后再构建完整 Runtime。

**主要文件：**

- `apps/daemon/src/main.ts`
- `apps/daemon/src/startup.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/unit/startup.test.ts`
- `apps/daemon/test/integration/desktop-bootstrap.test.ts`

**实现内容：**

1. 解析 `CLAWEE_REQUIRE_CODEX_PROBE`。
2. 在 `buildServer()` 前执行 Probe。
3. 输出结构化 Bootstrap 事件。
4. Probe 失败时输出结构化错误并退出。
5. Probe 成功后再收集 capabilities、打开数据库和启动 Scheduler。
6. 保持最终 `{ address, token }` 协议兼容。
7. 普通 Web 开发模式保持原启动行为。

**验收标准：**

- [ ] Probe 失败时不会调用 `buildServer()`。
- [ ] Probe 失败时不会创建 `app.sqlite`。
- [ ] Probe 失败时 Scheduler 不启动。
- [ ] Probe 成功时最终输出连接配置。
- [ ] 最终连接行 token 不进入日志快照。
- [ ] 未设置 Desktop Probe 环境变量时不产生真实模型调用。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- desktop-bootstrap
pnpm --filter @clawee/daemon test -- startup
pnpm --filter @clawee/daemon typecheck
```

**依赖：** P0-B3。

**规模：** M。

### P0-B5：实现 Desktop DaemonManager

**目标：** Electron Main 能启动、监控和关闭打包后的 Daemon Utility Process。

**主要文件：**

- `apps/desktop/src/main/daemon-manager.ts`
- `apps/desktop/src/main/bootstrap-controller.ts`
- `apps/desktop/src/shared/types.ts`
- `apps/desktop/test/daemon-manager.test.ts`

**实现内容：**

1. 使用 Utility Process 启动 Daemon。
2. 传入 Codex、数据目录和 Probe 环境。
3. 解析多行 JSON stdout。
4. 将进度、失败和连接配置转换为 Bootstrap 状态。
5. 保存 token 到 Main 进程内存。
6. 实现优雅退出和强制终止。
7. 实现单 attempt 去重。
8. 实现最多一次异常自动重启。

**验收标准：**

- [ ] 同一 attempt 只启动一个 Daemon。
- [ ] 未收到最终连接行前不产生可用连接配置。
- [ ] stdout 非 JSON 噪声不会导致 Main 崩溃。
- [ ] token 不进入 Desktop 日志。
- [ ] Daemon 超时和提前退出能映射到稳定错误码。
- [ ] 退出 Clawee 后没有残留 Daemon 进程。

**验证：**

```bash
pnpm --filter @clawee/desktop test -- daemon-manager
pnpm --filter @clawee/desktop typecheck
```

**依赖：** P0-B2、P0-B4。

**规模：** M。

### P0-B6：实现 Bootstrap 页面和主窗口切换

**目标：** 用户先看到环境检查，Probe 成功后同窗口进入 Clawee 主工作台。

**主要文件：**

- `apps/desktop/src/bootstrap/index.html`
- `apps/desktop/src/bootstrap/main.tsx`
- `apps/desktop/src/bootstrap/BootstrapView.tsx`
- `apps/desktop/src/main/window-manager.ts`
- `apps/desktop/src/main/bootstrap-controller.ts`
- `apps/desktop/test/bootstrap-view.test.tsx`

**实现内容：**

1. 创建 Bootstrap UI。
2. 将 Bootstrap 状态通过 IPC 推送到页面。
3. 实现正常阶段、慢等待和失败状态。
4. 实现重新检测、选择路径、查看日志和退出。
5. Probe 成功后切换到 Web UI。
6. 保持 BrowserWindow 不销毁。

**验收标准：**

- [ ] 主工作台不会在 Probe 成功前挂载。
- [ ] 页面不出现登录、API Key 或账号输入。
- [ ] 页面不出现 Skills 或 MCP 加载状态。
- [ ] 失败页面没有跳过按钮。
- [ ] 重新检测不会并发启动多个 Daemon。
- [ ] 成功后窗口只切换内容，不创建第二个窗口。

**验证：**

```bash
pnpm --filter @clawee/desktop test -- bootstrap
pnpm --filter @clawee/desktop typecheck
```

**依赖：** P0-B5。

**规模：** M。

### P0-B7：实现生产内部协议和 Desktop Preload Bridge

**目标：** 安全加载打包后的 Web UI，并接入现有 HostBridge。

**主要文件：**

- `apps/desktop/src/main/protocol-handler.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/shared/ipc.ts`
- `apps/web/src/host/bridge.ts`
- `apps/web/src/host/desktop-bridge.ts`
- `apps/web/src/main.tsx`
- `apps/daemon/src/api/server.ts`

**实现内容：**

1. 注册 `clawee-app://app` 内部协议。
2. 安全映射 `apps/web/dist` 静态资源。
3. Daemon CORS 允许精确内部 origin。
4. Preload 暴露固定 Desktop API。
5. Web 启动时根据 Preload 能力选择 Desktop Bridge。
6. 实现连接配置读取和连接更新订阅。
7. 保持 Browser Bridge 和 `9000` 开发模式不变。

**验收标准：**

- [ ] 生产包不使用远程 URL 加载 UI。
- [ ] 内部协议不能读取 `apps/web/dist` 外的文件。
- [ ] Renderer 无法访问任意 IPC channel。
- [ ] Desktop Bridge 能立即读到连接配置。
- [ ] Browser Bridge 全部测试继续通过。
- [ ] Daemon 只允许精确 Desktop origin 和既有本地 Web origin。

**验证：**

```bash
pnpm --filter @clawee/web test -- browser-bridge
pnpm --filter @clawee/desktop test -- protocol-handler
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/desktop typecheck
```

**依赖：** P0-B1、P0-B5、P0-B6。

**规模：** L，实施时应先完成内部协议，再完成 Bridge。

### P0-B8：完成主工作台连接与刷新行为

**目标：** 主工作台复用 Daemon 连接，刷新时不重启或重新 Probe。

**主要文件：**

- `apps/web/src/app/AppController.tsx`
- `apps/web/src/host/bridge.ts`
- `apps/web/src/host/desktop-bridge.ts`
- `apps/web/src/services/connection-service.ts`
- `apps/web/src/app/App.test.tsx`
- `apps/desktop/test/electron-refresh.e2e.ts`

**实现内容：**

1. 支持 Desktop Host 推送新的连接配置。
2. 连接更新后重建 RuntimeClient 和 SSE。
3. Renderer 刷新时只读取现有连接。
4. Daemon 重启期间展示连接恢复状态。
5. 恢复后重新订阅当前 Run。
6. 不触发 Skills、MCP 的全局阻塞加载。

**验收标准：**

- [ ] 冷启动成功后主工作台正常加载。
- [ ] 连续刷新 5 次只发生一次 Codex Probe。
- [ ] 刷新不重启 Daemon PID。
- [ ] 刷新后当前 Thread 路由保持。
- [ ] Daemon 连接更新后 Web 能恢复 API 调用。
- [ ] 插件页面加载失败不影响主工作台启动。

**验证：**

```bash
pnpm --filter @clawee/web test
pnpm --filter @clawee/desktop test -- electron-refresh
pnpm --filter @clawee/web typecheck
```

**依赖：** P0-B7。

**规模：** M。

### P0 检查点：桌面版最小可运行闭环

- [ ] macOS 上可以启动 Electron。
- [ ] 能找到本机 Codex。
- [ ] 能通过真实 hello Probe。
- [ ] Probe 成功后进入现有 Clawee 主工作台。
- [ ] Probe 失败时停留在诊断页面。
- [ ] 刷新不重复 Probe。
- [ ] Daemon token 不落盘。
- [ ] 全仓测试、类型检查和构建通过。

### P1-B1：实现窗口生命周期和系统托盘

**目标：** 关闭窗口后任务继续执行，用户可以从托盘恢复或真正退出。

**主要文件：**

- `apps/desktop/src/main/window-manager.ts`
- `apps/desktop/src/main/tray-manager.ts`
- `apps/desktop/src/main/settings-store.ts`
- `apps/desktop/test/tray-manager.test.ts`

**实现内容：**

1. 默认关闭窗口时隐藏。
2. 保存和恢复窗口状态。
3. 创建托盘菜单。
4. 实现打开、新建任务、任务页、暂停/恢复计划任务和退出。
5. 支持设置切换为关闭即退出。

**验收标准：**

- [ ] 关闭窗口后 Daemon PID 不变。
- [ ] 关闭窗口后正在运行的 Run 不被取消。
- [ ] 托盘点击可以恢复同一窗口。
- [ ] 托盘退出可以有序关闭 Daemon。
- [ ] 窗口位置在显示器变化后仍可见。

**依赖：** P0 检查点。

**规模：** M。

### P1-B2：实现原生通知 outbox 消费

**目标：** 页面隐藏或刷新时，Desktop Host 仍能展示系统通知。

**主要文件：**

- `apps/desktop/src/main/notification-manager.ts`
- `apps/desktop/src/main/daemon-client.ts`
- `apps/harness/src/notification-host.ts`
- `apps/desktop/test/notification-manager.test.ts`

**实现内容：**

1. 按现有 outbox 协议拉取通知。
2. 展示成功后确认。
3. 展示失败时保留 cursor。
4. 去除 Renderer 和 Main 的重复通知。
5. 点击通知进入统一深链接解析器。
6. Daemon 重启后恢复 cursor。

**验收标准：**

- [ ] 窗口隐藏时通知仍能展示。
- [ ] 同一通知只展示一次。
- [ ] 未成功展示的通知不会被确认。
- [ ] 通知点击打开正确 Thread、Run 和 Approval。
- [ ] Renderer 刷新不会造成重复通知。

**依赖：** P1-B1。

**规模：** M。

### P1-B3：实现单实例和外部深链接

**目标：** 系统通知和外部协议始终聚焦现有实例并导航到正确页面。

**主要文件：**

- `apps/desktop/src/main/deep-link-manager.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/window-manager.ts`
- `apps/web/src/app/routes.ts`
- `apps/desktop/test/deep-link-manager.test.ts`

**实现内容：**

1. 注册 `clawee://`。
2. 统一 macOS 和 Windows 参数解析接口。
3. 校验允许 route 和 ID。
4. 启动未就绪时缓存导航。
5. 就绪后通过 IPC 导航。
6. 第二实例只传递参数并退出。

**验收标准：**

- [ ] 深链接不会创建第二个主窗口。
- [ ] 未完成 Probe 时点击通知不会绕过门禁。
- [ ] Probe 成功后自动处理缓存导航。
- [ ] 非法 scheme 和 route 被拒绝。
- [ ] Thread、Run、Approval 特殊字符能正确编码和解码。

**依赖：** P0-B7、P1-B2。

**规模：** M。

### P1-B4：实现文件和外部应用集成

**目标：** 完成现有 HostBridge 的原生文件定位和外部链接能力。

**主要文件：**

- `apps/desktop/src/main/native-actions.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/web/src/host/desktop-bridge.ts`
- `apps/desktop/test/native-actions.test.ts`

**实现内容：**

1. 实现 `revealPath`。
2. 实现 `openExternal` 协议白名单。
3. 路径不存在时返回稳定错误。
4. 拒绝 Renderer 请求执行任意命令。

**验收标准：**

- [ ] 文件和目录能在 Finder 中正确定位。
- [ ] 不存在路径返回 `FAILED`，不导致 Main 崩溃。
- [ ] `javascript:`、`file:` 和未知协议被拒绝。
- [ ] `https:` 链接交给默认浏览器。

**依赖：** P0-B7。

**规模：** S。

### P1-B5：实现故障恢复和诊断导出

**目标：** Daemon 或 Codex Probe 失败后，用户能恢复并获得脱敏诊断。

**主要文件：**

- `apps/desktop/src/main/daemon-manager.ts`
- `apps/desktop/src/main/diagnostics.ts`
- `apps/desktop/src/bootstrap/BootstrapView.tsx`
- `apps/desktop/test/recovery.e2e.ts`

**实现内容：**

1. 实现一次自动重启和熔断。
2. 实现手动重新检测。
3. 实现日志目录打开。
4. 实现脱敏诊断 JSON 导出。
5. 记录 Codex 路径、阶段、耗时、退出码和信号。
6. 不记录 token、认证内容和 assistant 原文。

**验收标准：**

- [ ] Daemon 首次崩溃后自动恢复。
- [ ] 连续失败后停止重启循环。
- [ ] 手动重新检测可以恢复。
- [ ] 诊断文件不包含 daemon token。
- [ ] 诊断文案不推断登录状态。

**依赖：** P0-B5、P0-B6、P0-B8。

**规模：** M。

### P1 检查点：完整原生桌面体验

- [ ] 关闭窗口后后台任务继续。
- [ ] 系统通知在页面隐藏时可用。
- [ ] 通知点击进入正确页面。
- [ ] 单实例和深链接可用。
- [ ] 文件定位和外部链接可用。
- [ ] Daemon 崩溃恢复和诊断可用。

### P2-B1：完成生产打包和原生依赖验证

**目标：** 生成不依赖用户 Node.js 的 macOS 安装包。

**主要文件：**

- `apps/desktop/electron-builder.yml`
- `apps/desktop/package.json`
- `apps/desktop/resources/entitlements.mac.plist`
- `scripts/verify-desktop-package.mjs`
- `package.json`

**实现内容：**

1. 配置 Electron Builder。
2. 打包 Web、Desktop 和 Daemon 产物。
3. 重建并 unpack `better-sqlite3`。
4. 校验资源路径和内部 scheme。
5. 校验安装包内不包含开发依赖和源码映射。
6. 增加安装包烟测脚本。

**验收标准：**

- [ ] 未安装 Node.js 的干净用户环境可以启动 Clawee。
- [ ] 已安装 Codex CLI 时 Probe 可以成功。
- [ ] `better-sqlite3` 正常打开数据库。
- [ ] 打包后 Web 静态资源完整。
- [ ] Daemon 和 Renderer 不从开发目录读取文件。

**依赖：** P1 检查点。

**规模：** L，实施时拆成打包和原生模块两个提交。

### P2-B2：完成 macOS 签名、公证和自动更新

**目标：** 交付可正常安装和升级的 macOS 正式包。

**主要文件：**

- `apps/desktop/electron-builder.yml`
- `apps/desktop/src/main/updater.ts`
- `apps/desktop/resources/entitlements.mac.plist`
- `.github/workflows/desktop-release.yml` 或现有 CI 等价文件
- `docs/operations/clawee-desktop-release-runbook.md`

**实现内容：**

1. 配置 Developer ID 签名。
2. 配置 Hardened Runtime 和 entitlements。
3. 配置 notarization。
4. 配置更新元数据和增量更新。
5. 更新下载完成后提示用户重启。
6. 更新期间不强制终止正在运行的任务。

**验收标准：**

- [ ] Gatekeeper 不提示应用已损坏。
- [ ] 公证验证通过。
- [ ] 从上一版本升级后数据库和设置保留。
- [ ] 有运行中任务时不会静默强制重启。
- [ ] 更新失败不影响当前版本继续使用。

**依赖：** P2-B1。

**规模：** M。

### P2-B3：补齐 Windows 适配

**目标：** 在不改变产品模型的前提下支持 Windows x64。

**主要文件：**

- `apps/desktop/src/main/codex-resolver.ts`
- `apps/desktop/src/main/deep-link-manager.ts`
- `apps/desktop/electron-builder.yml`
- `apps/desktop/test/windows-paths.test.ts`
- `docs/operations/clawee-desktop-windows-release.md`

**实现内容：**

1. 支持 `where.exe codex` 和常见 npm 路径。
2. 支持 `.cmd`、`.exe` 可执行入口。
3. 支持 Windows 单实例参数和协议注册。
4. 支持托盘和通知。
5. 构建 NSIS 安装包。

**验收标准：**

- [ ] Windows 终端可运行 Codex 时 Desktop 能找到同一 Codex。
- [ ] Probe 成功后进入主工作台。
- [ ] 关闭窗口后后台任务继续。
- [ ] 深链接和通知点击可用。
- [ ] 安装、升级和卸载不删除用户 Clawee 数据。

**依赖：** P2-B1。

**规模：** L，应作为独立平台里程碑。

### P2-B4：最终真实环境验收

**目标：** 对真实 Codex、真实桌面宿主和发布包执行端到端验收。

**主要文件：**

- `docs/test-reports/clawee-desktop-final-acceptance.md`
- `docs/operations/clawee-desktop-release-runbook.md`
- `apps/desktop/e2e/`

**验收场景：**

1. Codex 可用，冷启动 Probe 成功。
2. Codex 路径不在 Electron 原始 `PATH` 中，仍能解析成功。
3. Codex 返回非 marker assistant 消息，仍视为成功。
4. Codex 进程超时，进入诊断页面。
5. Codex 退出非零，进入诊断页面。
6. Probe 成功后刷新五次，不产生新 Probe。
7. 从托盘打开五次，不产生新 Probe。
8. Daemon 崩溃一次，自动恢复。
9. Daemon 连续崩溃，停止循环重启。
10. 窗口关闭后计划任务继续执行并发送通知。
11. 通知点击进入正确 Thread、Run 和 Approval。
12. 打包环境中 `better-sqlite3` 正常。
13. 更新后数据保留。
14. 日志和诊断中不存在 token。

**验收标准：**

- [ ] 自动化测试全部通过。
- [ ] 真实 Codex 冷启动通过。
- [ ] macOS 安装包实机通过。
- [ ] 后台通知和深链接实机通过。
- [ ] 所有失败项有明确状态：`PASS`、`FAIL` 或 `BLOCKED_ENV`。

**依赖：** P2-B2；Windows 验收依赖 P2-B3。

**规模：** M。

## 17. 依赖关系

```text
P0-B1 Desktop 骨架
  ├── P0-B2 Codex 解析
  └── P0-B7 内部协议与 Bridge

P0-B3 Codex Probe
  -> P0-B4 Daemon Bootstrap
      -> P0-B5 DaemonManager

P0-B2 + P0-B5
  -> P0-B6 Bootstrap UI
      -> P0-B7 Desktop Bridge
          -> P0-B8 主工作台刷新与恢复

P0 检查点
  -> P1-B1 托盘
      -> P1-B2 通知
          -> P1-B3 深链接

P0-B7
  -> P1-B4 文件与外部应用

P0-B5 + P0-B6 + P0-B8
  -> P1-B5 故障恢复

P1 检查点
  -> P2-B1 生产打包
      ├── P2-B2 macOS 发布
      └── P2-B3 Windows

P2-B2
  -> P2-B4 最终验收
```

## 18. 测试策略

### 18.1 单元测试

必须覆盖：

1. Codex 路径候选和优先级。
2. Shell 环境解析和超时。
3. Probe argv。
4. JSONL assistant 消息解析。
5. Probe 超时和进程回收。
6. Daemon stdout 协议解析。
7. token 日志脱敏。
8. 深链接解析。
9. IPC 参数校验。
10. 通知 cursor 和确认语义。

### 18.2 集成测试

使用 fake Codex executable 覆盖：

1. 正常返回 assistant JSONL。
2. 返回非 marker 消息。
3. 无输出退出 0。
4. 输出非法 JSON。
5. 退出非零。
6. 永不退出。
7. stderr 包含模拟 secret。
8. 验证传入的 argv、cwd 和环境。
9. 验证没有 `login status` 和 `doctor`。
10. 验证没有 MCP 子进程。

### 18.3 Electron E2E

使用 Playwright Electron 能力覆盖：

1. Bootstrap 成功进入主工作台。
2. Bootstrap 失败停留诊断页面。
3. 重新检测。
4. 选择 Codex 路径。
5. Renderer 刷新不 Probe。
6. 关闭到托盘。
7. 通知点击。
8. 深链接。
9. Daemon 崩溃恢复。
10. 安全配置和 IPC 暴露面。

### 18.4 真实 Codex 验收

真实 Codex 测试只在明确的 smoke 或发布验收中运行，不能混入普通单元测试。

至少记录：

1. Codex 路径。
2. Codex 版本，仅作诊断。
3. Probe 耗时。
4. 是否收到 assistant 消息。
5. 是否持久化了新 Codex session。
6. 是否产生 MCP 子进程。
7. Renderer 刷新前后 Probe 次数。

## 19. 发布门禁

### 19.1 P0 发布门禁

1. 冷启动真实 Probe 成功。
2. Probe 失败不加载主工作台。
3. 页面刷新不 Probe。
4. Desktop 安全配置通过。
5. Daemon 可完整退出。

### 19.2 P1 发布门禁

1. 关闭窗口后任务继续。
2. 原生通知可用。
3. 深链接可用。
4. Daemon 崩溃恢复可用。
5. 日志脱敏通过。

### 19.3 P2 发布门禁

1. 签名和公证通过。
2. 干净机器安装通过。
3. 原生依赖加载通过。
4. 自动更新通过。
5. 最终验收报告无未解释的 `FAIL`。

## 20. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| GUI 环境找不到终端中的 Codex | 无法启动 | 恢复登录 Shell PATH、保存成功绝对路径、支持手动选择 |
| Codex Probe 产生启动延迟 | 用户等待 | 立即显示 Bootstrap、30 秒硬超时、不自动重复调用 |
| Probe 每次产生真实模型调用 | 有少量调用成本 | 只在冷启动或 Daemon 重启执行，刷新和托盘恢复不执行 |
| 全局 MCP 配置拖慢 Probe | 启动长时间卡住 | Probe argv 明确覆盖 `mcp_servers={}` |
| Probe 污染 Codex 历史 | 产生无意义会话 | 使用 `--ephemeral`，发布验收检查 session 目录 |
| Electron Main 泄漏 Daemon token | 本地 API 风险 | token 仅内存保存，日志层结构化删除 |
| `better-sqlite3` ABI 不匹配 | 打包后 Daemon 无法启动 | Electron ABI 重建、`asarUnpack`、安装包 smoke |
| Daemon 无限崩溃重启 | 资源消耗和糟糕体验 | 最多自动重启一次，连续失败熔断 |
| Renderer XSS 获取本地 token | 本地数据风险 | 只加载本地资源、CSP、sandbox、严格 IPC、禁止远程导航 |
| 自动更新中断任务 | 用户任务丢失 | 只提示安装，用户确认退出后更新 |

## 21. 明确禁止的实现

1. 在 Renderer 中使用 `child_process` 启动 Codex。
2. 在 Renderer 中执行 `codex login`。
3. 使用 `codex login status` 作为启动门禁。
4. 使用认证文件存在性作为启动门禁。
5. 只运行 `codex --version` 就判定环境可用。
6. Probe 成功前加载主工作台。
7. 页面刷新时重新 Probe。
8. Probe 过程中扫描 Skills 或请求 Skill Market。
9. Probe 过程中启动 MCP server。
10. 将 token 写入 localStorage、配置文件或日志。
11. Electron Main 直接访问 Clawee SQLite。
12. 使用 `nodeIntegration=true`。
13. 向 Renderer 暴露完整 `ipcRenderer`。
14. 使用用户系统 Node.js 运行打包后的 Daemon。
15. Daemon Probe 失败后仍启动 Scheduler。

## 22. 最终验收定义

桌面版第一阶段只有同时满足以下条件才算完成：

1. 用户本机已经安装且可调用 Codex CLI。
2. 启动 Clawee 后先出现环境检查页面。
3. Clawee 通过 Daemon 向 Codex 发送一次临时 hello 请求。
4. Codex 返回非空 assistant 消息。
5. Clawee 随后加载现有主工作台。
6. 刷新主工作台不会再次调用 Codex。
7. 关闭窗口后 Daemon 和计划任务可以继续运行。
8. 系统通知可以唤起正确会话。
9. 真正退出时 Daemon 被完整关闭。
10. 安装包不依赖用户 Node.js，不内置 Codex CLI，也不提供 Codex 登录。
