# Codex-native Runtime 契约详细设计

## 1. 背景

本设计是 `docs/2026-07-03-codex-native-agent-runtime-design.md` 的补充设计。基础方案定义产品方向和总体架构，本设计补齐第一版 Local Runtime Daemon 的运行契约，使其可以被实现、测试、诊断和长期演进。

核心原则保持不变：Codex CLI 是执行内核，Runtime 是产品契约层。Runtime 不重新实现 Agent loop、Skills runtime 或 MCP runtime，只托管输入、输出、配置、进程生命周期、事件、日志和本地调度。

## 2. 目标

第一版 Runtime 契约目标：

1. 固化 `codex exec --json` 作为唯一执行内核。
2. 定义 Local Runtime Daemon 对 UI 暴露的稳定 API 和 SSE 事件协议。
3. 定义 Run 生命周期、并发、取消、超时和崩溃恢复语义。
4. 定义 Codex CLI 版本检测、能力检测和 JSONL 兼容策略。
5. 定义 `CODEX_HOME` 的托管、原子写入、缓存同步和故障诊断策略。
6. 定义 Scheduler 的时区、错过触发和并发策略。
7. 定义本地 HTTP API 的安全边界。
8. 定义日志、脱敏和诊断包策略。
9. 调整 P0-P7 里程碑，使 P0-P2 能优先压实 Runtime 基座。

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
| 原始层 | `raw.ndjson` | 保存 Codex stdout 原始行 |
| 产品层 | `events.ndjson` 和 `run_events` | 保存 Runtime 归一化事件 |
| 兼容层 | `unknown_event` | 保存合法但无法识别的 Codex 事件 |

规则：

1. JSON 解析失败记为 `CODEX_STREAM_ERROR`。
2. 未知事件不导致 run 失败。
3. 缺失关键字段的合法 JSON 降级为 `unknown_event`。
4. `Event Normalizer` 带 `normalizerVersion`。
5. UI 只依赖 Runtime 的 `AgentEventEnvelope`，不依赖 Codex 原始事件。

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
3. 页面打开时可以触发轻量刷新。
4. 外部文件变化如果被检测到，以 `CODEX_HOME` 内容刷新缓存。
5. 缓存刷新失败不应导致 daemon 崩溃，应返回可诊断错误。

## 8. Run 生命周期

Run 是 Runtime 的基本原子单元。每个 run 必须拥有固化执行计划、状态机、事件日志、Codex 快照和终止原因。

### 8.1 状态模型

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

### 8.2 Run 执行计划

创建 run 时固化执行计划：

```ts
type RunExecutionPlan = {
  runId: string;
  prompt: string;
  cwd: string;
  workspaceMode: 'managed' | 'external';
  profile: string;
  model?: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'never' | 'on-request' | 'untrusted';
  images: string[];
  timeoutMs?: number;
  codexSnapshot: RunCodexSnapshot;
  createdBy: 'user' | 'schedule' | 'api';
  sourceId?: string;
};
```

run 开始后不再依赖可变配置。profile 后续改变只影响新 run。

### 8.3 并发策略

第一版默认策略：

1. 不同 managed workspace 的 run 可以并发。
2. 同一个 external `cwd` 的写入型 run 默认串行。
3. `read-only` run 可以并发。
4. `workspace-write` 和 `danger-full-access` 对同一 `cwd` 默认排队。
5. 配置写操作使用全局配置锁，不杀正在运行的 run。

```ts
type RunConcurrencyPolicy = {
  sameCwdPolicy: 'queue' | 'reject' | 'parallel';
  defaultSameCwdPolicy: 'queue';
};
```

### 8.4 取消和进程清理

取消规则：

1. spawn 时尽量创建独立 process group。
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

### 8.5 超时

第一版支持两个 timeout：

1. `spawnTimeoutMs`：Codex 子进程长时间未进入 running。
2. `runTimeoutMs`：run 总时长限制。

普通用户 run 可以不设置默认总超时。schedule run 应支持 timeout，避免长期挂起。

### 8.6 崩溃恢复

daemon 启动时执行恢复扫描：

1. 查询 SQLite 中 `spawning`、`running`、`canceling` 的 run。
2. 如果没有可接管进程，标记为 `orphaned`。
3. 写入 `error` 事件和 `done` 事件，其中 `done.status = failed`，同时保留 `internal_status = orphaned`。
4. 检查 raw log 和 events 是否完整。
5. Scheduler 根据 misfire 策略处理错过触发。

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
  payload: unknown;
  normalizerVersion: number;
  rawEventId?: string;
};
```

`seq` 在单个 run 内单调递增，用于排序和 SSE replay。

### 9.2 事件类型

```ts
type AgentEventType =
  | 'status'
  | 'text_delta'
  | 'tool_use'
  | 'tool_result'
  | 'usage'
  | 'error'
  | 'unknown_event'
  | 'done';
```

规则：

1. `unknown_event` 不表示失败。
2. `error` 表示 Codex 或 Runtime 出现可展示错误。
3. `done` 是每个进入终态的 run 的最终事件。
4. `done.status` 只能是 `succeeded`、`failed` 或 `canceled`。

### 9.3 SSE replay

`GET /runs/:id/events` 支持按序号恢复：

```http
GET /runs/:id/events?fromSeq=42
Last-Event-ID: 42
```

规则：

1. 首次连接默认从最新事件开始。
2. UI 可以指定 `fromSeq=0` 拉取全量。
3. 断线重连使用 `Last-Event-ID` 或 `fromSeq` 继续。
4. SSE `id` 使用事件 `seq`。
5. run 已结束时，重放历史事件后发送最终 `done` 并关闭连接。
6. 服务端发送心跳事件，避免空闲连接中断。
7. run 不存在返回 `RUN_NOT_FOUND`。

SSE 示例：

```text
id: 43
event: text_delta
data: {"id":"evt_...","runId":"run_...","seq":43,"ts":"...","type":"text_delta","payload":{"text":"..."}}
```

## 10. 日志、脱敏和诊断

### 10.1 per-run 文件

每个 run 保存：

```text
runs/run-<id>/
  meta.json
  raw.ndjson
  events.ndjson
  stderr.log
  diagnostics.json
```

职责：

| 文件 | 职责 |
|---|---|
| `meta.json` | 执行计划、Codex 快照、终止原因、开始结束时间 |
| `raw.ndjson` | Codex stdout 原始 JSONL |
| `events.ndjson` | Runtime 归一化事件 |
| `stderr.log` | Codex stderr |
| `diagnostics.json` | 解析错误、未知事件统计、退出码、信号、runtime 版本 |

SQLite 保存索引和查询字段，不替代文件日志。

### 10.2 脱敏策略

Runtime 分存储层和展示层处理敏感信息：

1. 存储层默认保存原始日志，便于本地诊断。
2. 展示层和诊断包导出必须脱敏。
3. 后续可以增加隐私模式，不保存 raw。

第一版脱敏规则至少覆盖：

1. env key 包含 `KEY`、`TOKEN`、`SECRET`、`PASSWORD`、`COOKIE`、`AUTH`。
2. MCP env values。
3. Authorization headers。
4. 常见 API key 模式。
5. 用户配置中显式标记为 secret 的字段。

MCP 展示规则：

1. command 和 args 可展示。
2. env key 可展示。
3. env value 默认隐藏，用户显式展开后才显示。

### 10.3 诊断包

诊断包默认包含：

1. `meta.json`
2. `events.ndjson`
3. `stderr.log`
4. `diagnostics.json`
5. `/codex/status` 快照

默认不包含 `raw.ndjson`。如果用户选择包含原始日志，UI 必须二次确认。

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

1. `timezone` 使用系统当前时区。
2. `concurrencyPolicy` 默认为 `skip`。
3. `misfirePolicy` 默认为 `skip`。
4. `sandbox` 默认为 `workspace-write`。

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

## 12. 本地 API 安全

Local Runtime Daemon 默认只作为本机服务，不提供远程访问能力。

### 12.1 监听和鉴权

规则：

1. 默认监听 `127.0.0.1`。
2. 不监听 `0.0.0.0`。
3. daemon 启动时生成随机 `runtimeAuthToken`。
4. Electron main 进程持有 token，并注入给 UI。
5. 所有非健康检查接口要求 `Authorization: Bearer <token>`。
6. SSE 也必须鉴权。
7. token 只保存在当前 daemon 生命周期内。
8. CORS 默认关闭，或只允许 Electron app origin。
9. 写接口校验 `Content-Type: application/json`。

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
3. `POST /codex/update`
4. `POST /codex/login`
5. `POST /codex/mcp/add`
6. `POST /codex/mcp/:name/login`
7. `POST /schedules`
8. `PATCH /schedules/:id`

高风险接口必须记录操作日志，并在 UI 层提供必要的确认和风险提示。

## 13. 数据模型补充

### 13.1 `runs`

```text
runs
  id
  public_status
  internal_status
  created_by
  source_id
  profile
  cwd
  workspace_mode
  prompt_hash
  prompt_preview
  model
  sandbox
  approval_policy
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

完整 prompt 放入 `meta.json`。SQLite 存 hash 和 preview，减少敏感内容扩散。

### 13.2 `run_events`

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

### 13.3 `schedules`

```text
schedules
  id
  name
  cron
  timezone
  enabled
  profile
  cwd
  prompt_hash
  prompt_preview
  model
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

### 13.4 `runtime_capabilities`

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
  checked_at
  raw_json
```

### 13.5 `settings`

`settings` 继续保留，用于非结构化轻量配置。

## 14. 测试策略

第一版测试重点是 Runtime 契约，不是 UI 细节。

### 14.1 单元测试

覆盖：

1. Codex args 构建。
2. Codex capability parser。
3. JSONL parser。
4. Event Normalizer。
5. Run 状态机。
6. Scheduler cron、timezone、misfire、concurrency。
7. redaction 脱敏规则。
8. `CODEX_HOME` profile TOML 读写和原子写入。

### 14.2 集成测试

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

### 14.3 端到端测试

覆盖：

1. 创建 run 并实时展示事件。
2. 断线后恢复事件。
3. cancel run。
4. 查看历史 run。
5. 创建 schedule 并 run-now。
6. 安装 skill。
7. 添加 MCP。

## 15. 里程碑调整

### P0：Runtime Kernel

目标：

1. Codex CLI 检测和能力快照。
2. 独立 `CODEX_HOME` 初始化。
3. Codex Runner。
4. stdin prompt。
5. raw、stdout、stderr 落盘。
6. JSONL parser。
7. Run 状态机。
8. cancel、timeout、process cleanup。
9. fake Codex 集成测试。

验收：

1. 通过本地 API 创建 run，能完整记录 raw、events、stderr、meta。
2. 非法 JSON、非零退出、cancel、timeout 都能进入确定状态。
3. daemon 重启后 running run 标记为 `orphaned`。

### P1：Run API + SSE

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

### P2：Desktop UI Chat + Runs

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

### P3：Profiles / Settings / `CODEX_HOME` 管理

目标：

1. profile 列表、创建、编辑、删除。
2. config 原子写入和备份。
3. `CODEX_BIN` 配置。
4. capability status 页面。
5. 配置缓存同步。

验收：

1. 修改 profile 只影响新 run。
2. 配置损坏可诊断，不会让 daemon 崩溃。

### P4：Skills Pass-through

目标：

1. 扫描 skills。
2. 安装本地 skill 目录。
3. 删除 skill。
4. 展示元数据。
5. 操作日志。

验收：

1. 安装后新 run 能由 Codex 原生发现 skill。
2. 无效 skill 被标记为 `invalid`。

### P5：MCP Pass-through

目标：

1. `codex mcp list/get/add/remove/login/logout`。
2. MCP command 和 env 展示。
3. MCP env 脱敏。
4. 命令失败诊断。

验收：

1. UI 添加 MCP 后，新 run 可由 Codex 原生使用。
2. MCP env value 默认不明文展示。

### P6：Scheduler

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

### P7：Packaging + Diagnostics

目标：

1. Electron 打包。
2. daemon 生命周期托管。
3. 初始化向导。
4. 诊断包导出。
5. 日志清理策略。

验收：

1. 安装包环境可完整使用 P0-P6。
2. 用户可导出脱敏诊断包。

## 16. 第一版完成定义

第一版完成定义：

1. run 可创建、观察、取消、恢复和诊断。
2. Codex 版本和能力可检测。
3. 事件协议稳定，SSE 可 replay。
4. 本地 API 不裸露给未授权调用方。
5. 配置写入有锁、原子性和缓存同步。
6. Scheduler 行为可预测。
7. fake Codex 测试覆盖主要异常路径。
