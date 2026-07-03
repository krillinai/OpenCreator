# Codex-native Runtime 契约草案与验证计划

## 0. 文档状态

状态：草案。

本设计不能直接作为 R0 编码输入。Codex CLI 是外部 ABI，必须先通过验证 spike 钉住真实行为，再冻结 Runtime 契约。验证 spike 完成前，本文中的事件映射、Chat 续接、sandbox 边界、审批策略和日志策略都属于候选设计。

已在本机做过的最小验证：

1. `codex --version` 返回 `codex-cli 0.139.0`。
2. `codex exec --help` 确认支持 `--json`、stdin prompt、`-p/--profile`、`-C/--cd`、`--sandbox`、`--image`、`--ephemeral`。
3. `codex exec --help` 未显示 `--ask-for-approval`，第一版不能把审批策略当成已验证的 `exec` 参数。
4. `codex exec resume --help` 确认存在 session resume 能力，支持 session id、`--last`、prompt、`--json`、`-m/--model` 和 `-c/--config`；未显示 `-C/--cd`、`-p/--profile` 或 `--sandbox`。
5. `codex mcp add --help` 确认支持 `--url`、stdio command、`--env`、bearer token env var。
6. 简单 `codex exec --json` 输出了 `thread.started`、`turn.started`、`item.completed agent_message`、`turn.completed usage`。
7. 只读 shell 样本输出了 `item.started command_execution` 和 `item.completed command_execution`，字段包括 `command`、`aggregated_output`、`exit_code`、`status`。
8. 已观察到的 assistant 文本是整块 `agent_message.text`，不是 token 级 delta。第一版 UI 不承诺 token 级打字机流式。

验证 spike 必须把 stdout 和 stderr 分离采集。本次终端采样视图同时显示了 Codex 诊断日志和 JSONL 事件，不能据此假设诊断日志一定来自 stdout。

## 1. 背景

本设计是 `docs/2026-07-03-codex-native-agent-runtime-design.md` 的补充设计。基础方案定义产品方向和总体架构，本设计补齐第一版 Local Runtime Daemon 的候选运行契约，使其在通过 Codex 行为验证后可以被实现、测试、诊断和长期演进。

核心原则保持不变：Codex CLI 是执行内核，Runtime 是产品契约层。Runtime 不重新实现 Agent loop、Skills runtime 或 MCP runtime，只托管输入、输出、配置、进程生命周期、事件、日志和本地调度。

## 2. 目标

第一版 Runtime 契约目标：

1. 在验证 spike 通过后，固化 `codex exec --json` 和 `codex exec resume --json` 作为第一版执行内核。
2. 定义 Local Runtime Daemon 对 UI 暴露的稳定 API 和 SSE 事件协议。
3. 定义 Run 生命周期、并发、取消、超时和崩溃恢复语义。
4. 定义 Codex CLI 版本检测、能力检测和 JSONL 兼容策略。
5. 定义 `CODEX_HOME` 的托管、原子写入、缓存同步和故障诊断策略。
6. 定义 Scheduler 的时区、错过触发和并发策略。
7. 定义本地 HTTP API 的安全边界。
8. 定义日志、脱敏和诊断包策略。
9. 调整 R-1 到 R7 里程碑，使验证 spike 先于 Runtime 编码。

## 3. 非目标

第一版不做：

1. 不重新设计产品 UI。
2. 不实现自研 Agent loop。
3. 不实现自研 Skills runtime。
4. 不实现自研 MCP runtime。
5. 不做远程执行、云端执行、多租户或企业权限治理。
6. 不做长期记忆系统。
7. 不做多 Agent 协作编排。
8. 不把 Codex 原始 JSONL 事件直接暴露给前端作为产品协议。
9. 第一版不承诺 token 级文本增量流式；如果 Codex 只输出整块 assistant message，UI 按消息级实时展示。

## 4. 与基础方案的关系

基础方案负责回答“产品是什么、总体分层是什么、第一版能力有哪些”。本设计负责回答“Runtime 如何可靠运行、如何对外承诺、如何处理异常、如何测试验收”。

两份文档的边界：

| 文档 | 职责 |
|---|---|
| 基础方案 | 产品入口、总体架构、模块职责、能力透传路线、长期企业演进 |
| 本设计 | Codex 兼容、Run 状态机、事件协议、SSE、日志、Scheduler、安全、数据模型和里程碑 |

如果两份文档存在冲突，以本设计中更具体的 Runtime 契约为准。

## 5. 运行时边界

系统分三层：

### 5.1 UI 层

UI 是产品入口，只调用 Runtime API 并订阅 SSE。

UI 不做：

1. 不直接 spawn Codex。
2. 不直接读写 `CODEX_HOME`。
3. 不直接解析 Codex 原始 JSONL。
4. 不直接修改 SQLite。

### 5.2 Runtime Daemon 层

Runtime Daemon 是产品契约层，负责：

1. HTTP API。
2. 本地鉴权。
3. Run 状态机。
4. Codex 子进程生命周期。
5. Event Normalizer。
6. SSE replay。
7. SQLite 索引。
8. per-run 文件日志。
9. Scheduler。
10. `CODEX_HOME` 配置锁、原子写入和缓存同步。

### 5.3 Codex CLI 层

Codex CLI 是执行内核，负责：

1. 模型调用。
2. Agent loop。
3. shell 和工具执行。
4. Skills 加载和触发。
5. MCP 调用。
6. sandbox 执行。
7. Codex 自有 session 状态。

Runtime 不解释 Codex 内部执行语义，只管理输入、输出、配置和生命周期。

## 6. Codex CLI 兼容策略

Runtime 必须把 Codex CLI 当作外部 ABI。Codex 版本、参数能力和 JSONL 事件格式都是 Runtime 需要记录和兼容的边界。

### 6.1 启动检测

daemon 启动时检测：

1. `codex --version`
2. `codex exec --help`
3. `codex mcp --help`
4. 当前 `CODEX_HOME`
5. 登录状态
6. doctor 状态

必须确认以下能力：

1. `codex exec --json`
2. stdin prompt 输入
3. `-p` 或 `--profile`
4. `-C` 或 `--cd`
5. `--sandbox`
6. `--image`
7. `codex mcp list`
8. `codex mcp get`
9. `codex mcp add`
10. `codex mcp remove`
11. `codex mcp login`
12. `codex mcp logout`
13. `codex exec resume --json`
14. `codex exec resume` 是否支持 model override。
15. `codex exec resume` 是否支持 config override。
16. `codex exec resume` 是否支持 cwd、profile、sandbox override。

检测结果写入 SQLite，并通过 `/codex/status` 返回给 UI。

### 6.2 Run Codex 快照

每个 run 创建时保存 Codex 快照：

```ts
type RunCodexSnapshot = {
  codexBin: string;
  codexVersion: string;
  codexHome: string;
  argv: string[];
  profile?: string;
  model?: string;
  sandbox?: string;
  capabilitySetId: string;
};
```

该快照用于诊断历史 run，不随之后的 Codex 更新或配置变化而改变。

### 6.3 JSONL 兼容

Codex stdout JSONL 分三层保存：

| 层 | 文件或事件 | 用途 |
|---|---|---|
| 原始流 | 进程 stdout 内存流 | 供 parser 逐行处理，不默认明文落盘 |
| 脱敏原始层 | `raw.redacted.ndjson` | 保存落盘前脱敏后的 Codex stdout JSONL |
| 产品层 | `events.ndjson` 和 `run_events` | 保存 Runtime 归一化事件 |
| 兼容层 | `unknown_event` | 保存合法但无法识别的 Codex 事件 |

规则：

1. JSON 解析失败记为 `CODEX_STREAM_ERROR`。
2. 未知事件不导致 run 失败。
3. 缺失关键字段的合法 JSON 降级为 `unknown_event`。
4. `Event Normalizer` 带 `normalizerVersion`。
5. UI 只依赖 Runtime 的 `AgentEventEnvelope`，不依赖 Codex 原始事件。

### 6.4 版本兼容 Gate

第一版必须维护已验证 Codex 版本区间。当前草案只验证过 `codex-cli 0.139.0` 的部分行为，不能代表完整兼容。

版本策略：

1. Runtime 启动时检查 Codex 版本是否落在 `verifiedCodexVersionRange`。
2. 版本落在区间内时，可以创建 run。
3. 版本高于已验证区间时，默认进入 `compatibility_warning`。
4. 版本高于已验证区间且 run 可能写入文件或调用写工具时，必须事前拒绝创建 run，或强制降级为 `read-only` 并提示用户。
5. 版本高于已验证区间的只读 run 可以执行，但核心事件缺失时 run 标记为 `CODEX_INCOMPATIBLE`。
6. 版本低于最小版本或缺少必需能力时，拒绝创建 run。
7. `POST /codex/update` 不进入第一版 API。Codex 升级由用户或系统包管理器负责，Runtime 只检测并提示。
8. `unknown_event` 只用于非核心事件。核心事件缺失或形状不兼容不能静默降级。
9. `verifiedCodexVersionRange` 由 R-1 产出的能力矩阵维护，第一版对 0.x Codex 采用精确版本或精确 minor 白名单，不使用宽松 semver range。

核心事件最小集合：

1. `thread.started`
2. `turn.started`
3. assistant message 完成事件
4. `turn.completed` 或等价终态事件

### 6.5 当前实测事件映射

以下映射来自 `codex-cli 0.139.0` 的最小样本，冻结契约前必须用验证脚本重新采集并保存 fixture。

| Codex JSONL | Runtime 事件 |
|---|---|
| `{ "type": "thread.started", "thread_id": "..." }` | `status(initializing)`，并记录 `codexThreadId` |
| `{ "type": "turn.started" }` | `status(running)` |
| `{ "type": "item.started", "item": { "type": "command_execution", ... } }` | `tool_use` |
| `{ "type": "item.completed", "item": { "type": "command_execution", ... } }` | `tool_result` |
| `{ "type": "item.completed", "item": { "type": "agent_message", "text": "..." } }` | `assistant_message(delivery=message)` |
| `{ "type": "turn.completed", "usage": { ... } }` | `usage` 后接 `done(succeeded)` |

工具事件当前已观察字段包括 `command`、`aggregated_output`、`exit_code`、`status`。文本输出当前已观察为整块 `agent_message.text`，未观察到 token 级文本 delta。

尚未验证的运行期事件：

1. MCP 工具调用 item。
2. file patch 或 apply patch item。
3. web search item。
4. reasoning 或 thinking item。

这些事件必须在 R-1 采集真实 fixture 后才能进入稳定映射。第一版如果未采集到 reasoning 内容事件，则不展示 reasoning 正文，仅保留 `usage.reasoningOutputTokens`。

### 6.6 危险参数禁止透传

第一版 Runtime 不允许通过 UI、API、profile、schedule 或 config override 透传会绕过安全边界的 Codex 参数。

禁止项：

1. `--dangerously-bypass-approvals-and-sandbox`
2. `--dangerously-bypass-hook-trust`
3. 等价的 config override 或 profile 字段。

如果未来需要支持这些能力，必须先新增独立设计，明确外部沙箱、用户确认、日志提示和风险隔离策略。第一版只能使用显式 `sandbox` 枚举：`read-only`、`workspace-write`、`danger-full-access`。

## 7. `CODEX_HOME` 管理契约

`CODEX_HOME` 是 Codex 原生配置、profile、skills、MCP 和 session 状态的真相源。Runtime 只托管它，不替代它。

### 7.1 基本约束

1. Runtime 使用独立目录，例如 `~/.your-agent/codex-home`。
2. UI 不直接读写 `CODEX_HOME`。
3. profile、skills、MCP 写操作必须经过 Runtime。
4. SQLite 只做索引和缓存，不作为执行真相源。
5. 如果 SQLite 与 `CODEX_HOME` 冲突，以 `CODEX_HOME` 为准。

### 7.2 配置写入

配置写入规则：

1. profile、MCP、skills 写操作使用全局配置写锁。
2. 写 TOML 文件使用原子写入：写临时文件，校验成功后 rename。
3. 每次写入前保留最近一次备份。
4. 文件损坏时标记资源为 `invalid`，不自动删除。
5. 配置变更只影响新 run，不影响已经创建的 run。

### 7.3 缓存同步

同步规则：

1. app 启动时全量扫描 `CODEX_HOME`。
2. profile、skill、MCP 操作成功后刷新对应缓存。
3. 页面打开时应触发轻量刷新，确保 UI 不长期展示陈旧缓存。
4. 外部文件变化如果被检测到，以 `CODEX_HOME` 内容刷新缓存。
5. 缓存刷新失败不应导致 daemon 崩溃，应返回可诊断错误。

## 8. Chat、Thread 和 Run 生命周期

Run 是 Runtime 的基本执行原子，一次 run 对应一次 Codex 子进程和一个最终状态。Chat 是产品入口，由一个 thread 串联多个 run。第一版多轮对话不重新实现上下文拼接，优先使用 Codex 原生 session resume。

### 8.1 Chat 和 thread 模型

```ts
type ChatThread = {
  id: string;
  codexThreadId?: string;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: 'managed' | 'external';
  profile: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  status: 'active' | 'archived' | 'resume_unavailable';
  createdAt: string;
  updatedAt: string;
};
```

规则：

1. 用户新建 Chat 时创建 Runtime thread。
2. managed 模式下，thread 使用固定 workspace：`workspaces/thread-<id>/`。
3. external 模式下，thread 使用创建时指定的 `cwd`，并保存 `canonicalCwd`。
4. 第一次消息创建普通 `codex exec --json` run。
5. Runtime 从 `thread.started` 事件记录 `codexThreadId`。
6. 同一 Chat 的后续消息使用 `codex exec resume <codexThreadId> --json`。
7. resume run 默认沿用 thread 创建时的 `cwd`、`profile`、`sandbox`、`model` 和 `reasoning` 语义；当前本机 help 未显示 resume 可直接覆盖 `cwd/profile/sandbox`，R-1 必须验证 Codex resume 实际继承或覆盖这些配置的行为。
8. 如果 Codex resume 失败，UI 明确提示“无法续接会话”，不能静默退化为全新上下文。
9. Runs 页面展示每次执行；Chat 页面按 thread 聚合这些 run。
10. schedule run 默认不属于 Chat thread，除非用户显式指定目标 thread。

### 8.2 Thread API

第一版需要显式 thread API 支撑 Chat：

```http
POST /threads
GET  /threads
GET  /threads/:id
GET  /threads/:id/runs
PATCH /threads/:id
POST /threads/:id/archive
```

创建 thread：

```ts
type CreateThreadRequest = {
  cwd?: string;
  workspaceMode?: 'managed' | 'external';
  profile?: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
};
```

向 thread 发消息通过 `/runs` 完成：

```ts
type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: 'new_thread' | 'resume_thread';
  cwd?: string;
  profile?: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  images?: string[];
};
```

规则：

1. 未传 `threadId` 时，`POST /runs` 创建独立 run。
2. 传入 `threadId` 时，Runtime 使用该 thread 的配置创建 run；`cwd/profile/model/reasoning/sandbox` 请求字段不得覆盖 thread 已固化配置。
3. `resumeMode = resume_thread` 要求 thread 已有 `codexThreadId`。
4. `resumeMode = new_thread` 可用于在现有 Runtime thread 内重新开始 Codex session，但必须记录新的 `codexThreadId`。
5. thread API 必须在 R1 或 R2 前实现，R2 不得在缺少 thread API 的情况下开工。

### 8.3 状态模型

对 UI 暴露的状态：

```ts
type PublicRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled';
```

Runtime 内部状态：

```ts
type InternalRunStatus =
  | 'created'
  | 'queued'
  | 'spawning'
  | 'running'
  | 'canceling'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'orphaned';
```

状态流转：

```text
created -> queued -> spawning -> running -> succeeded
                                      -> failed
                                      -> canceling -> canceled
daemon restart while running          -> orphaned
```

`orphaned` 表示 daemon 重启后无法确认或接管原 Codex 子进程。第一版不尝试跨平台接管旧进程。对 UI 而言，`orphaned` run 展示为失败或中断；数据库保留 `internal_status = orphaned` 作为诊断状态。

### 8.4 Run 执行计划

创建 run 时固化执行计划：

```ts
type RunExecutionPlan = {
  runId: string;
  threadId?: string;
  codexThreadId?: string;
  resumeMode: 'new_thread' | 'resume_thread';
  prompt: string;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: 'managed' | 'external';
  profile: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  images: string[];
  timeoutMs?: number;
  codexSnapshot: RunCodexSnapshot;
  createdBy: 'user' | 'schedule' | 'api';
  sourceId?: string;
};
```

run 开始后不再依赖可变配置。profile 后续改变只影响新 run。

如果 run 属于 thread，`profile`、`model`、`reasoning`、`sandbox` 和 `cwd` 必须来自 thread 固化配置，而不是每次 run 请求。`RunExecutionPlan` 记录的是实际传给 Codex 或由 Codex resume 继承的配置快照。

审批策略暂不进入第一版 `RunExecutionPlan`。`codex exec` 当前实测未显示 `--ask-for-approval` 参数；如果后续通过 config override 支持审批，必须先补双向审批协议，而不是只在 schema 中增加枚举。

### 8.5 并发策略

第一版默认策略：

1. 不同 managed workspace 的 run 可以并发。
2. external `cwd` 必须先经 `realpath` 归一化为 `canonicalCwd`。
3. 同一个 `canonicalCwd` 的写入型 run 默认串行。
4. `read-only` run 可以并发。
5. `workspace-write` 和 `danger-full-access` 对同一 `canonicalCwd` 默认排队。
6. 配置写操作使用全局配置锁，不杀正在运行的 run。
7. 如果 run 使用 `--add-dir` 或后续引入额外可写目录，必须把所有可写 realpath 纳入锁集合；第一版默认不开放 `--add-dir`。
8. 同一 `threadId` 或同一 `codexThreadId` 的 run 必须无条件串行，与 sandbox 模式无关。

```ts
type RunConcurrencyPolicy = {
  sameWorkspacePolicy: 'queue' | 'reject' | 'parallel';
  sameThreadPolicy: 'queue';
};
```

默认值为 `queue`。

### 8.6 取消和进程清理

取消规则：

1. spawn 时必须创建可清理的进程树边界；不同平台可以用不同实现。
2. cancel 时先发送温和终止信号。
3. grace period 后仍未退出，则强制 kill。
4. Windows、macOS、Linux 分别封装 ProcessTreeKiller。
5. cancel 中状态为 `canceling`。
6. 最终写入 `canceled` 或 `failed`。

```ts
type TerminationReason =
  | 'completed'
  | 'user_canceled'
  | 'timeout'
  | 'spawn_failed'
  | 'codex_exit_non_zero'
  | 'stream_error'
  | 'daemon_restart'
  | 'process_kill_failed';
```

daemon 正常退出时必须先尝试取消并清理所有子 Codex 进程。`orphaned` 只用于 daemon 崩溃、系统强杀或进程清理失败后无法确认状态的场景。

### 8.7 超时

第一版支持两个 timeout：

1. `spawnTimeoutMs`：Codex 子进程长时间未进入 running。
2. `runTimeoutMs`：run 总时长限制。

普通用户 run 可以不设置默认总超时。schedule run 应支持 timeout，避免长期挂起。

### 8.8 崩溃恢复

daemon 启动时执行恢复扫描：

1. 查询 SQLite 中 `spawning`、`running`、`canceling` 的 run。
2. 如果没有可接管进程，标记为 `orphaned`。
3. 写入 `error` 事件和 `done` 事件，其中 `done.status = failed`，同时保留 `internal_status = orphaned`。
4. 检查 `raw.redacted.ndjson` 和 `events.ndjson` 是否完整。
5. Scheduler 根据 misfire 策略处理错过触发。

### 8.9 最终状态判定

run 最终状态由 Runtime 综合 Codex 子进程退出状态、JSONL 终态事件和 Runtime 自身错误决定。

规则：

1. Codex 子进程 exit code 为 0，JSONL 中出现 `turn.completed` 或等价成功终态，且没有 `turn.failed`、`turn.aborted` 或等价 turn 级失败事件时，run 标记为 `succeeded`。
2. Codex 子进程非零退出时，run 标记为 `failed`，`terminationReason = codex_exit_non_zero`。
3. JSONL 中出现 `turn.failed`、`turn.aborted` 或等价失败终态时，即使 exit code 为 0，也标记为 `failed`。
4. stdout JSONL 非法或关键事件缺失时，run 标记为 `failed`，`terminationReason = stream_error` 或 `CODEX_INCOMPATIBLE`。
5. spawn 失败、timeout、用户取消、进程清理失败分别按对应 `TerminationReason` 判定。
6. resume 目标不存在、过期或不可读时，run 标记为 `failed`，错误码为 `RESUME_TARGET_NOT_FOUND` 或 `RESUME_FAILED`。
7. stderr 内容默认写入 `stderr.redacted.log` 和 `diagnostics.json`，但 stderr 中出现 `ERROR` 字样不能单独决定 run 失败。
8. stderr 中的认证、插件、MCP、analytics 警告应归类为 diagnostics warning；只有当它导致非零退出、关键 JSONL 缺失或 Codex 明确失败事件时，才影响最终状态。

## 9. 事件协议和 SSE

### 9.1 AgentEventEnvelope

UI 依赖 Runtime 自有事件 envelope：

```ts
type AgentEventEnvelope = {
  id: string;
  runId: string;
  seq: number;
  ts: string;
  type: AgentEventType;
  payload: AgentEventPayload;
  normalizerVersion: number;
  rawEventId?: string;
};
```

`seq` 在单个 run 内单调递增，用于排序和 SSE replay。

### 9.2 事件类型

```ts
type AgentEventType =
  | 'status'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'usage'
  | 'error'
  | 'unknown_event'
  | 'done';
```

```ts
type AgentEventPayload =
  | { type: 'status'; label: 'initializing' | 'running' | 'canceling' | 'finalizing' }
  | { type: 'assistant_message'; text: string; format: 'plain_text'; delivery: 'message' | 'delta' }
  | { type: 'tool_use'; toolCallId: string; name: string; input: { command?: string; args?: string[]; raw?: unknown } }
  | { type: 'tool_result'; toolCallId: string; output: string; exitCode?: number | null; isError: boolean }
  | { type: 'usage'; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number; reasoningOutputTokens?: number }
  | { type: 'error'; code: string; message: string; details?: Record<string, unknown> }
  | { type: 'unknown_event'; rawEventId: string; codexType?: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'canceled'; terminationReason: TerminationReason };
```

规则：

1. `unknown_event` 不表示失败。
2. `error` 表示 Codex 或 Runtime 出现可展示错误。
3. `done` 是每个进入终态的 run 的最终事件。
4. `done.status` 只能是 `succeeded`、`failed` 或 `canceled`。
5. 当前已验证 Codex 文本输出是消息级 `agent_message.text`，因此第一版默认发送 `assistant_message.delivery = message`。
6. 只有在验证到 Codex 确实输出文本增量时，才允许发送 `assistant_message.delivery = delta`。

### 9.3 事件序号和版本兼容

事件序号规则：

1. `seq` 由 Runtime 在持久化事件时生成，不来自 Codex。
2. 每个 run 的 `seq` 从 1 开始单调递增。
3. 写入 `run_events` 和 `events.ndjson` 必须在同一个持久化步骤中使用同一个 `seq`。
4. 崩溃恢复补写 `error` 和 `done` 时，必须先读取该 run 已持久化的最大 `seq`，再从 `max(seq) + 1` 继续。
5. 如果 `events.ndjson` 和 SQLite `run_events` 的最大 `seq` 不一致，恢复流程必须先进入诊断状态，不得盲目覆盖已有事件。

`normalizerVersion` 规则：

1. 每条 `AgentEventEnvelope` 保存生成它的 `normalizerVersion`。
2. UI 必须支持当前版本和至少上一个 normalizer 主版本生成的事件。
3. 已归一化的历史事件默认按原版本回放，不在读取时隐式重写。
4. 如果新版本需要重建历史事件，必须通过显式 migration 任务从 `raw.redacted.ndjson` 或原始诊断样本生成新事件，并保留原事件备份。
5. normalizer 主版本升级必须带真实 Codex fixture 回归测试。
6. 从 `raw.redacted.ndjson` 重建的历史事件保真度以脱敏后内容为上限，不能恢复已经被替换的敏感字段。

### 9.4 SSE replay

`GET /runs/:id/events` 支持按序号恢复：

```http
GET /runs/:id/events?fromSeq=42
Last-Event-ID: 42
```

规则：

1. 首次连接默认从 `fromSeq=0` 回放全量历史，然后继续 tail。
2. UI 可以指定 `fromSeq` 从某个序号继续。
3. 断线重连使用 `Last-Event-ID` 或 `fromSeq` 继续。
4. SSE `id` 使用事件 `seq`。
5. run 已结束时，重放历史事件后发送最终 `done` 并关闭连接。
6. 服务端发送 SSE comment 心跳（例如 `:\n\n`），避免空闲连接中断；心跳不进入 `AgentEventType`。
7. run 不存在返回 `RUN_NOT_FOUND`。
8. SSE replay 的权威数据源是 `events.ndjson`；SQLite `run_events` 只用于查询、定位和索引，不能作为完整回放数据源。

SSE 示例：

```text
id: 43
event: assistant_message
data: {"id":"evt_...","runId":"run_...","seq":43,"ts":"...","type":"assistant_message","payload":{"type":"assistant_message","text":"...","format":"plain_text","delivery":"message"}}
```

## 10. 日志、脱敏和诊断

### 10.1 per-run 文件

每个 run 保存：

```text
runs/run-<id>/
  meta.json
  raw.redacted.ndjson
  events.ndjson
  stderr.redacted.log
  diagnostics.json
```

职责：

| 文件 | 职责 |
|---|---|
| `meta.json` | 执行计划、Codex 快照、终止原因、开始结束时间；敏感字段脱敏或摘要化 |
| `raw.redacted.ndjson` | 落盘前脱敏后的 Codex stdout JSONL |
| `events.ndjson` | Runtime 归一化事件 |
| `stderr.redacted.log` | 落盘前脱敏后的 Codex stderr |
| `diagnostics.json` | 解析错误、未知事件统计、退出码、信号、runtime 版本 |

SQLite 保存索引和查询字段，不替代文件日志。

### 10.2 脱敏策略

Runtime 分落盘层、展示层和导出层处理敏感信息：

1. 默认落盘的是 redacted raw 和 redacted stderr。
2. 展示层和诊断包导出必须再次经过脱敏管道。
3. 真正原始 raw/stderr 只允许在显式诊断模式下短期保存，默认关闭。
4. 显式诊断模式必须有 UI 二次确认、保留期限和一键删除。
5. `prompt_preview` 默认关闭；如果开启，必须使用脱敏后的短摘要。
6. 脱敏是尽力而为，不承诺能识别任意命令输出中的所有秘密；UI 和诊断包必须继续提示残余泄漏风险。
7. 处理顺序为先解析 stdout JSONL，再对落盘内容脱敏；脱敏替换必须保持 JSON 结构合法。

第一版脱敏规则至少覆盖：

1. env key 包含 `KEY`、`TOKEN`、`SECRET`、`PASSWORD`、`COOKIE`、`AUTH`。
2. MCP env values。
3. Authorization headers。
4. 常见 API key 模式。
5. 用户配置中显式标记为 secret 的字段。
6. prompt、tool input、tool output 中匹配上述规则的内容。

MCP 展示规则：

1. command 和 args 可展示。
2. env key 可展示。
3. env value 默认隐藏，用户显式展开后才显示。

### 10.3 诊断包

诊断包默认包含：

1. `meta.json`
2. `events.ndjson`
3. `stderr.redacted.log`
4. `diagnostics.json`
5. `/codex/status` 快照

默认不包含原始日志。诊断包可以包含 `raw.redacted.ndjson`。如果用户选择包含未脱敏原始日志，必须先开启显式诊断模式并二次确认。

### 10.4 保留和清理

第一版必须定义 run 日志和 workspace 的保留策略，避免本地磁盘无限增长。

规则：

1. run 日志目录和 managed workspace 都必须记录创建时间、最后访问时间和所属 thread/run。
2. 默认不自动删除未归档 active thread 的 managed workspace。
3. archive thread 后，其 `workspaces/thread-<id>/` 可进入可清理状态，但必须允许用户确认或配置保留期。
4. 独立 managed run workspace 可按保留期清理。
5. 诊断模式下保存的未脱敏原始日志必须有更短保留期，并支持一键删除。
6. R7 打包诊断阶段必须提供日志和 workspace 清理入口。

## 11. Scheduler 语义

Scheduler 是薄触发器，只创建普通 Codex run，不执行任务逻辑。

### 11.1 Schedule 模型

```ts
type Schedule = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;

  prompt: string;
  profile: string;
  cwd?: string;
  model?: string;
  reasoning?: 'default' | 'low' | 'medium' | 'high' | 'xhigh';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  timeoutMs?: number;

  concurrencyPolicy: 'skip' | 'queue' | 'parallel';
  misfirePolicy: 'skip' | 'run_once';
  nextRunAt?: string;
  lastRunAt?: string;
  lastRunId?: string;
  lastStatus?: 'succeeded' | 'failed' | 'canceled' | 'orphaned';

  createdAt: string;
  updatedAt: string;
};
```

### 11.2 默认值

1. `timezone` 创建时使用系统当前时区，并固化到 schedule。
2. `concurrencyPolicy` 默认为 `skip`。
3. `misfirePolicy` 默认为 `skip`。
4. `sandbox` 默认为 `workspace-write`。
5. 系统时区变化后，已有 schedule 继续按创建时固化的 `timezone` 计算，除非用户显式修改。

### 11.3 策略语义

`concurrencyPolicy`：

| 值 | 语义 |
|---|---|
| `skip` | 上一次同 schedule 的 run 未结束时，跳过本次触发 |
| `queue` | 上一次未结束时，本次进入队列 |
| `parallel` | 允许并发创建 |

`misfirePolicy`：

| 值 | 语义 |
|---|---|
| `skip` | daemon 关闭或系统睡眠错过时间，不补跑 |
| `run_once` | 恢复时如果错过一次或多次，只补跑一次 |

第一版不默认补跑，避免本地桌面环境恢复后产生意外写操作。

### 11.4 调度库验证

Scheduler 实现前必须验证所选 cron 库是否能支持以下行为：

1. 进程关闭后重启，能根据 `nextRunAt` 判断是否 misfire。
2. 系统睡眠后唤醒，Runtime 能识别错过的 `nextRunAt`。
3. DST 切换日能给出确定行为。
4. 用户修改系统时区后，不会隐式改变已固化 schedule 的语义。

如果 cron 库不能直接提供 misfire 检测，Runtime 必须用 SQLite 中的 `nextRunAt` 自行判断，而不能依赖进程内 timer 的补触发行为。

## 12. 本地 API 安全

Local Runtime Daemon 默认只作为本机服务，不提供远程访问能力。

### 12.1 监听和鉴权

规则：

1. 默认监听 `127.0.0.1`。
2. 不监听 `0.0.0.0`。
3. Electron 托管模式下，daemon 启动时生成随机 `runtimeAuthToken`。
4. Electron main 进程持有 token，并注入给 UI。
5. 所有非健康检查接口要求 `Authorization: Bearer <token>`。
6. SSE 也必须鉴权。
7. Electron 托管模式下，token 只保存在当前 daemon 生命周期内。
8. CORS 默认关闭，或只允许 Electron app origin。
9. 写接口校验 `Content-Type: application/json`。
10. 后续常驻 daemon 模式必须改用 OS keychain 或 owner-only 权限文件分发 token，不能依赖 Electron 注入链路。
11. 多窗口 UI 必须通过 Electron main 获取当前 token，不能各自生成 token。

`GET /healthz` 可以不鉴权，但只返回：

```ts
type Healthz = {
  ok: boolean;
};
```

`GET /codex/status` 必须鉴权，因为它会暴露路径、版本和登录状态。

### 12.2 高风险接口

以下接口属于高风险接口：

1. `POST /runs`
2. `POST /runs/:id/cancel`
3. `POST /codex/login`
4. `POST /codex/mcp/add`
5. `POST /codex/mcp/:name/login`
6. `POST /schedules`
7. `PATCH /schedules/:id`

高风险接口必须记录操作日志，并在 UI 层提供必要的确认和风险提示。

`POST /codex/update` 不进入第一版。升级 Codex 会改变 Runtime 依赖的外部 ABI，必须由用户或系统包管理器处理，Runtime 只检测兼容性并提示。

## 13. 错误码和 HTTP 状态

API 错误结构：

```ts
type ApiError = {
  error: {
    code: RuntimeErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

第一版错误码：

| 错误码 | HTTP | 含义 |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | 请求参数不合法 |
| `UNAUTHORIZED` | 401 | 缺少或无效 runtime token |
| `RUN_NOT_FOUND` | 404 | run 不存在 |
| `THREAD_NOT_FOUND` | 404 | thread 不存在 |
| `RESUME_TARGET_NOT_FOUND` | 404 | Codex session/thread 不存在、过期或不可读 |
| `RUN_ALREADY_TERMINAL` | 409 | run 已结束，不能取消或修改 |
| `THREAD_BUSY` | 409 | 同一 thread 已有 run 在执行 |
| `WORKSPACE_BUSY` | 409 | 同一 workspace/canonical cwd 已有互斥 run |
| `CODEX_NOT_FOUND` | 503 | 找不到 Codex CLI |
| `CODEX_AUTH_REQUIRED` | 503 | Codex 未登录或凭证不可用 |
| `CODEX_INCOMPATIBLE` | 412 | Codex 版本或事件协议不在已验证能力矩阵中 |
| `CODEX_UNVERIFIED_WRITE_BLOCKED` | 412 | Codex 版本超出验证区间，写模式 run 被事前拦截 |
| `SPAWN_FAILED` | 500 | 启动 Codex 失败 |
| `CODEX_EXIT_NON_ZERO` | 502 | Codex 非零退出 |
| `CODEX_STREAM_ERROR` | 502 | stdout JSONL 非法或关键事件缺失 |
| `RESUME_FAILED` | 502 | resume 调用失败但不是目标缺失 |
| `PROCESS_KILL_FAILED` | 500 | cancel 后无法清理进程树 |
| `SCHEDULE_INVALID` | 422 | cron、timezone 或 schedule 配置无效 |
| `MCP_COMMAND_FAILED` | 502 | `codex mcp` 命令失败 |
| `SKILL_INVALID` | 422 | skill 缺失或格式无效 |

事件层 `error.payload.code` 应复用上述错误码。无法映射到 API 请求的后台错误也应使用同一错误码集合，并写入 diagnostics。

## 14. 数据模型补充

### 14.1 `threads`

```text
threads
  id
  codex_thread_id
  status
  workspace_mode
  cwd
  canonical_cwd
  profile
  model
  reasoning
  sandbox
  created_at
  updated_at
  archived_at
  last_run_id
  last_error_code
```

managed thread 的 `canonical_cwd` 指向 `workspaces/thread-<id>/`。thread archive 不立即删除 workspace，清理由保留策略处理。

### 14.2 `runs`

```text
runs
  id
  thread_id
  codex_thread_id
  public_status
  internal_status
  created_by
  source_id
  profile
  cwd
  canonical_cwd
  workspace_mode
  prompt_hash
  prompt_preview_redacted
  model
  reasoning
  sandbox
  codex_version
  codex_bin
  codex_home
  normalizer_version
  timeout_ms
  termination_reason
  exit_code
  signal
  started_at
  ended_at
  created_at
  updated_at
  error_code
  error_message
```

完整 prompt 默认不进入 SQLite。`meta.json` 中的 prompt 字段也必须按日志策略脱敏或显式诊断模式控制。SQLite 存 hash 和脱敏摘要，减少敏感内容扩散。

### 14.3 `run_events`

```text
run_events
  id
  run_id
  seq
  type
  payload_json
  raw_event_id
  created_at
```

唯一约束：

```text
unique(run_id, seq)
```

`run_events` 只保存状态、工具、usage、error、done 和消息级 assistant 事件索引。大体量回放数据以 `events.ndjson` 为准，避免 token 级或大文本事件把 SQLite 作为主回放存储。

### 14.4 `schedules`

```text
schedules
  id
  name
  cron
  timezone
  enabled
  profile
  cwd
  canonical_cwd
  prompt_hash
  prompt_preview_redacted
  model
  reasoning
  sandbox
  timeout_ms
  concurrency_policy
  misfire_policy
  next_run_at
  last_run_at
  last_run_id
  last_status
  created_at
  updated_at
```

### 14.5 `runtime_capabilities`

```text
runtime_capabilities
  id
  codex_bin
  codex_version
  supports_json
  supports_stdin_prompt
  supports_profiles
  supports_mcp
  supports_images
  supports_sandbox
  supports_resume
  verified_min_version
  verified_max_version
  capability_matrix_id
  checked_at
  raw_json
```

### 14.6 `runtime_capability_matrix`

```text
runtime_capability_matrix
  id
  codex_version
  verified_at
  source
  supports_resume_chat
  resume_supports_model_override
  resume_supports_config_override
  resume_supports_cwd_override
  resume_supports_profile_override
  resume_supports_sandbox_override
  supports_images
  supports_mcp_runtime_events
  supports_patch_events
  supports_scheduler_misfire
  write_mode_allowed
  notes_json
```

`source` 指向 R-1 产出的 fixture 和验证记录。0.x Codex 版本必须逐版本或逐 minor 显式登记。

### 14.7 `settings`

`settings` 继续保留，用于非结构化轻量配置。

## 15. 测试策略

第一版测试重点是 Runtime 契约，不是 UI 细节。

### 15.1 单元测试

覆盖：

1. Codex args 构建。
2. Codex capability parser。
3. JSONL parser。
4. Event Normalizer。
5. Run 状态机。
6. Scheduler cron、timezone、misfire、concurrency。
7. redaction 脱敏规则。
8. `CODEX_HOME` profile TOML 读写和原子写入。

### 15.2 fake Codex 集成测试

使用 fake Codex binary，模拟：

1. 正常 JSONL 输出。
2. 未知事件。
3. 非法 JSON 行。
4. stderr 输出但 exit 0。
5. stderr 输出且 exit non-zero。
6. 长 prompt stdin。
7. 慢启动触发 spawn timeout。
8. 长运行触发 run timeout。
9. cancel 后子进程退出。
10. cancel 后子进程不退出，需要强杀。
11. 大量事件输出时 SSE 仍可 replay。

fake Codex 用于验证 Runtime 实现是否符合契约，不能证明契约符合真实 Codex。

### 15.3 真实 Codex smoke 测试

每个支持的 Codex 版本至少保留一组真实 smoke 样本：

1. `codex --version`
2. `codex exec --help`
3. `codex exec resume --help`
4. `codex mcp --help`
5. `codex mcp add --help`
6. 简单 assistant message run 的 stdout/stderr 分离样本。
7. command execution run 的 stdout/stderr 分离样本。
8. 失败路径样本：认证失败、非零退出或非法配置。

这些样本用于冻结 normalizer fixture。没有真实样本覆盖的事件类型不得作为稳定产品事件承诺。

### 15.4 端到端测试

覆盖：

1. 创建 run 并实时展示事件。
2. 断线后恢复事件。
3. cancel run。
4. 查看历史 run。
5. 创建 schedule 并 run-now。
6. 安装 skill。
7. 添加 MCP。

## 16. 里程碑调整

基础方案中的 P0-P6 是方向性里程碑。本文档以 R-1 到 R7 作为 Runtime 落地里程碑；后续计划和实施以 R 编号为准。

### R-1：Codex 行为验证 Spike

目标：

1. 固化验证脚本，采集 stdout 和 stderr 分离样本。
2. 验证 `codex exec --json` 的真实事件粒度。
3. 验证 command execution、usage、错误路径事件结构。
4. 验证 `codex exec resume --json` 的 thread 续接行为。
5. 验证 resume 对 `cwd`、profile、sandbox、model、reasoning 的继承或覆盖行为，特别是当前 help 未显示 `-C/-p/--sandbox` 的场景。
6. 验证 resume 目标不存在、过期、跨 cwd 的失败形态和错误输出。
7. 验证 `--sandbox workspace-write` 的真实可写边界。
8. 验证 `--image` 多图、路径、格式和大小约束。
9. 验证 `codex mcp` 子命令参数。
10. 采集 run 期间 MCP 工具调用、file patch、web search、reasoning/thinking 等非 `command_execution` item 的真实事件结构。
11. 验证所选 cron 库的 sleep、misfire、timezone、DST 行为。

验收：

1. 文档中有真实 Codex 版本、help 输出摘要和 JSONL fixture。
2. 明确支持的 Codex 版本区间。
3. 明确第一版是否支持 resume Chat、image、approval、scheduler misfire。
4. 产出能力矩阵，映射 Codex 版本到第一版允许的能力、写模式策略和里程碑范围。
5. 未验证能力不得进入 R0 实现范围。

### R0：Runtime Kernel Harness

前置条件：

1. R-1 验证通过。
2. 已冻结第一版支持的 Codex 版本区间和 fixture。

目标：

1. Codex CLI 检测和能力快照。
2. 独立 `CODEX_HOME` 初始化。
3. Codex Runner。
4. stdin prompt。
5. redacted raw、events、redacted stderr 落盘。
6. JSONL parser。
7. Run 状态机。
8. cancel、timeout、process cleanup。
9. fake Codex 集成测试。

验收：

1. 通过命令行 harness 创建 run，能完整记录 redacted raw、events、redacted stderr、meta。
2. 非法 JSON、非零退出、cancel、timeout 都能进入确定状态。
3. daemon 重启后 running run 标记为 `orphaned`。

### R1：Run API + SSE

前置条件：

1. R0 的命令行 harness 已通过 fake Codex 和真实 Codex smoke 测试。

目标：

1. `/runs`
2. `/runs/:id`
3. `/runs/:id/events`
4. `/runs/:id/cancel`
5. SSE `fromSeq` 和 `Last-Event-ID`
6. 本地 token 鉴权
7. run history 查询

验收：

1. UI 或 curl 可以创建 run、订阅事件、断线重连、取消 run。
2. 已结束 run 可以重放完整事件。
3. 未授权请求被拒绝。

### R2：Desktop UI Chat + Runs

前置条件：

1. R1 完成。
2. Thread API 已实现。
3. 如果启用 resume Chat，R-1 已验证 resume 继承行为和同 thread 串行锁。

目标：

1. Electron 启动 daemon。
2. UI 注入 token。
3. Chat 发起 run。
4. 实时事件展示。
5. 历史 runs。
6. 日志查看。
7. 诊断基础信息展示。

验收：

1. 非开发用户可以通过桌面 UI 完成一次普通 run。
2. 用户可以看到 run 历史和基础诊断信息。
3. 如果 R-1 验证通过 resume，则 Chat 可以在同一 `workspaces/thread-<id>/` 或 external cwd 内续接同一 Codex thread。
4. 如果 R-1 验证不支持 resume，则 UI 明确标注为独立 run 模式，且 R2 不宣称多轮上下文连续。

### R3：Profiles / Settings / `CODEX_HOME` 管理

目标：

1. profile 列表、创建、编辑、删除。
2. config 原子写入和备份。
3. `CODEX_BIN` 配置。
4. capability status 页面。
5. 配置缓存同步。

验收：

1. 修改 profile 只影响新 run。
2. 配置损坏可诊断，不会让 daemon 崩溃。

### R4：Skills Pass-through

目标：

1. 扫描 skills。
2. 安装本地 skill 目录。
3. 删除 skill。
4. 展示元数据。
5. 操作日志。

验收：

1. 安装后新 run 能由 Codex 原生发现 skill。
2. 无效 skill 被标记为 `invalid`。

### R5：MCP Pass-through

目标：

1. `codex mcp list/get/add/remove/login/logout`。
2. MCP command 和 env 展示。
3. MCP env 脱敏。
4. 命令失败诊断。

验收：

1. UI 添加 MCP 后，新 run 可由 Codex 原生使用。
2. MCP env value 默认不明文展示。
3. 如果 R-1 已采集 MCP 运行期事件，则 UI 能展示 MCP 工具名、入参摘要、结果摘要和错误；未采集前不得把 MCP 运行期可视化列为 R5 验收。

### R6：Scheduler

目标：

1. schedule CRUD。
2. run-now。
3. cron 和 timezone。
4. misfire policy。
5. concurrency policy。
6. timeout。

验收：

1. 到点创建 run。
2. daemon 重启后按 misfire 策略处理。
3. 同 schedule 并发按 policy 执行。

### R7：Packaging + Diagnostics

目标：

1. Electron 打包。
2. daemon 生命周期托管。
3. 初始化向导。
4. 诊断包导出。
5. 日志清理策略。
6. managed workspace 清理策略。

验收：

1. 安装包环境可完整使用 R0-R6。
2. 用户可导出脱敏诊断包。
3. 用户可查看并清理历史 run 日志、独立 run workspace 和已归档 thread workspace。

## 17. 第一版完成定义

第一版完成定义：

1. run 可创建、观察、取消、恢复和诊断。
2. Codex 版本和能力可检测。
3. 事件协议稳定，SSE 可 replay。
4. 本地 API 不裸露给未授权调用方。
5. 配置写入有锁、原子性和缓存同步。
6. Scheduler 行为可预测。
7. R-1 真实 Codex 验证通过，并保存 stdout/stderr 分离 fixture。
8. 支持的 Codex 版本区间已明确，版本超界行为可验证。
9. fake Codex 测试覆盖主要异常路径。
10. 真实 Codex smoke 测试覆盖 assistant message、command execution、usage、stderr warning 和失败路径。
11. 如果第一版承诺 Chat，多轮 thread/resume 已通过真实 Codex 验证，并具备 thread API、thread workspace 和同 thread 串行锁。
12. 如果第一版不承诺 resume Chat，UI 和文档明确标注为独立 run 模式。
