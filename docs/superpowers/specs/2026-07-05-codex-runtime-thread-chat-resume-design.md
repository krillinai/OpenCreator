# Codex Runtime R2 Thread / Chat Resume 设计

## 0. 文档状态

状态：待评审。

本文是 `docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md` 之后的 R2 专项设计。R0/R1 已经建立基础 Run、事件、SSE、取消、超时、诊断和部分真实 Codex smoke 能力；R2 的目标是在不引入 UI、Profile 管理、Skills 管理、MCP 管理和 Scheduler 的前提下，把 Runtime 的会话内核补齐到可承载多轮 Chat Resume 的状态。

本文只设计 Agent Runtime 内核能力，不设计产品 UI。

## 1. 背景与判断

当前 Runtime 已经能把一次 `codex exec --json` 包装成可创建、可观察、可取消、可诊断的 run，但它还不能承诺“Chat”。原因是 Chat 的核心不是 HTTP 上有一个 thread id，而是后续用户输入必须能恢复到同一个 Codex session，并且 Runtime 必须知道何时恢复成功、何时失败、何时能力不可用。

Codex CLI 本身已经提供 `codex exec resume` 能力，但这是外部 ABI。Runtime 不能假设它永远兼容，也不能在 resume 失败时偷偷开一个新 session 伪装连续对话。R2 的核心设计取向是：Runtime thread 是产品侧权威对象，Codex thread id 是外部执行内核的会话绑定；两者必须显式绑定、显式验证、显式失败。

因此，R2 不只是新增 thread CRUD，而是把 thread、run、Codex resume、串行调度、能力矩阵、错误诊断和验收测试作为一个完整闭环实现。

## 1.1 当前 Codex ABI 复验记录

2026-07-05 已在本机升级后的 `codex-cli 0.142.5` 上做过最小复验：

1. `codex exec --json --skip-git-repo-check --sandbox read-only -C <cwd>` 可以通过 stdin prompt 启动，并输出合法 JSONL。
2. 第一轮事件包含 `thread.started`、`turn.started`、`item.completed agent_message` 和 `turn.completed`。
3. 可以从 `thread.started.thread_id` 捕获 Codex session id。
4. `codex exec resume <thread_id> --json` 可以恢复同一上下文；第二轮要求复述第一轮 marker，返回结果一致。
5. 裸 `-` stdin 哨兵已验证可用，但 R2 默认仍可以直接通过 stdin 写入 prompt，不依赖该形态作为唯一输入方式。
6. `codex exec resume --help` 支持 `SESSION_ID`、prompt、`--last`、`--all`、`--json`、`-m/--model`、`-c/--config`、`--skip-git-repo-check`、`--ephemeral`、`--ignore-user-config`、`--ignore-rules` 和 `--output-schema`。
7. `codex exec resume --help` 未显示 `-C/--cd`、`-p/--profile`、`--sandbox` 或 `--add-dir`，因此 R2 仍必须坚持 thread 配置固化，不能允许后续 run 覆盖 cwd/profile/sandbox。
8. smoke 中 stderr 出现 auth refresh 401 诊断，但进程 exit code 为 0 且 stdout JSONL 完整成功；stderr 中出现 `ERROR` 不能单独决定 run 失败。

该复验增强了 R2 方向的可信度，但不替代实现期的 gated real Codex smoke。R2 仍必须把能力检测结果写入 capability matrix，并通过 `/codex/status` 暴露。

## 2. 目标

R2 必须完成以下目标：

1. 创建 Runtime thread，并固化该 thread 的运行配置：`cwd`、`profile`、`model`、`reasoning`、`sandbox`、`workspaceMode`。
2. 支持 thread 第一轮 run：当 thread 尚未绑定 `codexThreadId` 时，使用普通 `codex exec --json` 启动新 Codex session。
3. 捕获 Codex 原始事件 `thread.started.thread_id`，写入 `threads.codex_thread_id` 和 `runs.codex_thread_id`。
4. 支持 thread 后续 run：当 thread 已绑定 `codexThreadId` 时，使用 `codex exec resume <codexThreadId> --json` 续接。
5. 同一个 Runtime thread 内的 run 必须串行执行，避免并发 resume 同一 Codex session。
6. 支持 thread 详情、thread 列表、thread run 历史查询和归档。
7. 真实 Codex resume 能力必须可检测、可验证、可通过 `/codex/status` 暴露。
8. resume 不可用、未验证、失败或目标不存在时必须明确失败，并写入结构化 diagnostics。
9. R2 不破坏 R0/R1 独立 run、SSE replay、取消、超时、诊断和 fake Codex 测试。

## 3. 非目标

R2 不做以下事情：

1. 不设计或实现 UI。
2. 不实现 Profile / `CODEX_HOME` 写入管理；thread 只引用已有 profile 名称。
3. 不实现 Skills 管理。
4. 不实现 MCP 管理。
5. 不实现 Scheduler。
6. 不自建完整消息数据库；Chat 消息视图先由 run events 和 `events.ndjson` 派生。
7. 不做 transcript reseed 自动降级。
8. 不在 resume 失败时自动 fresh `exec`。
9. 不做跨设备、云同步或多租户治理。
10. 不做 workspace 写冲突全局锁；R2 只保证同 thread 串行。

## 4. 核心原则

### 4.1 Runtime thread 是产品权威对象

`threads.id` 是 Runtime API、后续 UI 和本地索引使用的稳定 id。客户端不直接依赖 Codex thread id，也不能用 Codex thread id 代替 Runtime thread id。

### 4.2 Codex thread id 是外部会话绑定

`codex_thread_id` 只表示 Runtime thread 已经绑定到某个 Codex session。它来自 Codex 原始 JSONL 事件，不由 Runtime 生成。

### 4.3 配置在 thread 创建时固化

同一个 thread 的后续 run 必须使用 thread 固化配置。run 请求不能临时覆盖 `cwd`、`profile`、`model`、`reasoning`、`sandbox` 或 `workspaceMode`。如果请求试图覆盖，Runtime 返回 `THREAD_CONFIG_IMMUTABLE`。

这样做的原因是 resume 的 ABI 并不保证所有参数都能安全覆盖；即使 Codex 当前版本支持部分 override，也不应让同一 Chat session 的执行环境在产品侧隐式漂移。

### 4.4 不静默伪装连续性

如果 resume 未验证、不可用、失败或目标不存在，Runtime 必须让 run 失败。除非用户显式请求 `resumeMode: "new_thread"`，否则 Runtime 不自动开新 Codex session。

### 4.5 R2 优先可靠，不追求完整 Chat UI 模型

R2 只解决 Runtime 内核的会话连续性、历史可查询性和失败可诊断性。消息列表、富文本渲染、用户输入框、会话侧栏等 UI 体验留给后续 UI 设计。

## 5. 数据模型

### 5.1 `threads`

新增或补齐 `threads` 表作为 Runtime thread 权威表。

字段要求：

| 字段 | 含义 |
|---|---|
| `id` | Runtime thread id |
| `title` | 可选标题，R2 可由第一条 prompt 截断生成 |
| `status` | `active` 或 `archived` |
| `cwd` | 固化工作目录 |
| `profile` | 固化 Codex profile |
| `model` | 固化模型 |
| `reasoning` | 固化 reasoning effort |
| `sandbox` | 固化 sandbox 策略 |
| `workspace_mode` | 固化 workspace 模式 |
| `codex_thread_id` | Codex session id，第一轮 run 捕获后写入 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |
| `archived_at` | 归档时间，未归档为空 |

索引：

1. `threads.status`
2. `threads.codex_thread_id`
3. `threads.updated_at`

约束：

1. `id` 全局唯一。
2. `codex_thread_id` 可以为空。
3. `status = archived` 后不允许创建新的 thread run。

### 5.2 `runs`

R2 需要强化现有 `runs` 表中的 thread 关联。

字段要求：

| 字段 | 含义 |
|---|---|
| `thread_id` | Runtime thread id，独立 run 为空 |
| `codex_thread_id` | 本 run 使用或捕获到的 Codex session id |
| `resume_mode` | `independent`、`new_thread`、`resume_thread` |
| `queue_state` | `none`、`queued`、`started` |

索引：

1. `runs.thread_id`
2. `runs.codex_thread_id`
3. `runs.thread_id, created_at`
4. `runs.thread_id, public_status`

规则：

1. 独立 run 的 `thread_id` 为空，行为保持 R0/R1。
2. thread 第一轮 run 的 `resume_mode = new_thread`。
3. thread 后续 run 的 `resume_mode = resume_thread`。
4. 显式重置 Codex session 的 run 也使用 `resume_mode = new_thread`，并写入 diagnostic `THREAD_CODEX_SESSION_RESET`。

### 5.3 不新增 `messages` 表

R2 不新增独立 `messages` 表。原因：

1. 当前 Runtime 已经有归一化事件和 per-run `events.ndjson`。
2. R2 的核心风险在 Codex resume ABI 和串行执行，不在消息视图。
3. 过早引入消息表会带来消息补偿、重复消费、版本迁移和 UI 状态设计问题。

R2 的消息视图可以由以下来源派生：

1. run 请求中的 user prompt。
2. Runtime 归一化的 `assistant_message` event。
3. Runtime 归一化的 `tool_use` 和 `tool_result` event。
4. terminal `done` event。

后续 UI 版本如需高性能消息查询，可以在 R2 稳定后基于事件日志建立派生索引。

## 6. 模块边界

### 6.1 `ThreadRepository`

负责 thread 数据持久化：

1. `createThread(config)`
2. `listThreads(filter)`
3. `getThread(id)`
4. `archiveThread(id)`
5. `setCodexThreadId(threadId, codexThreadId)`
6. `touchThread(threadId)`
7. `assertActiveThread(threadId)`

`ThreadRepository` 不负责 spawn Codex，不负责 run 状态机。

### 6.2 `RunRepository`

继续负责 run、run event、diagnostics 索引持久化。R2 增加：

1. 按 `thread_id` 查询 run 历史。
2. 写入 `codex_thread_id`。
3. 写入 `resume_mode`。
4. 写入 queued 状态。

### 6.3 `RunManager`

负责 thread run 的调度和状态机：

1. 接收 `threadId`。
2. 读取 thread 固化配置。
3. 判断 `new_thread` 还是 `resume_thread`。
4. 做同 thread 串行。
5. 创建 queued run。
6. 启动 Codex runner。
7. 捕获 `thread.started.thread_id` 并通知 repository。
8. 处理 resume 失败和诊断。

### 6.4 `CodexArgvBuilder`

集中构建两类命令：

普通 thread 第一轮：

```bash
codex exec --json ...
```

thread resume：

```bash
codex exec resume <codexThreadId> --json ...
```

R2 不允许业务调用点自行拼接 Codex argv。

### 6.5 `CodexCapabilityService`

负责检测和持久化能力矩阵，并通过 `/codex/status` 返回。

R2 必须重点检测：

1. `codex exec --json`
2. stdin prompt
3. profile / cwd / sandbox / model / config override
4. `codex exec resume --json`
5. resume by session id
6. resume 不存在 id 的失败形态
7. resume 对 `-m`、`-c`、`-C`、`-p`、`--sandbox` 的支持情况
8. resume 上下文连续性是否通过真实 smoke 验证

## 7. API 设计

### 7.1 创建 Thread

```http
POST /threads
```

请求体：

```json
{
  "title": "可选标题",
  "cwd": "/path/to/project",
  "profile": "default",
  "model": "gpt-5",
  "reasoning": "high",
  "sandbox": "workspace-write",
  "workspaceMode": "existing"
}
```

响应：

```json
{
  "thread": {
    "id": "thr_...",
    "title": "可选标题",
    "status": "active",
    "cwd": "/path/to/project",
    "profile": "default",
    "model": "gpt-5",
    "reasoning": "high",
    "sandbox": "workspace-write",
    "workspaceMode": "existing",
    "codexThreadId": null,
    "createdAt": "2026-07-05T00:00:00.000Z",
    "updatedAt": "2026-07-05T00:00:00.000Z",
    "archivedAt": null
  }
}
```

创建 thread 只创建 Runtime 侧对象，不立即启动 Codex。

### 7.2 查询 Thread 列表

```http
GET /threads?status=active&limit=50
```

规则：

1. 默认返回 active thread。
2. `status` 支持 `active`、`archived`、`all`。
3. 默认按 `updated_at` 倒序。
4. `limit` 有上限，避免一次性加载过多本地历史。

### 7.3 查询 Thread 详情

```http
GET /threads/:id
```

返回 thread 固化配置、Codex 绑定状态、统计信息和最近 run 摘要。

### 7.4 查询 Thread Run 历史

```http
GET /threads/:id/runs?limit=50
```

返回该 thread 下的 run 列表。每个 run 仍通过现有 run 详情和 events API 查看完整事件。

### 7.5 归档 Thread

```http
POST /threads/:id/archive
```

规则：

1. archived thread 不允许新建 run。
2. archive 不删除 run、event、diagnostics 或 workspace。
3. 如果存在 queued/running run，返回 `THREAD_HAS_ACTIVE_RUN`。
4. 清理策略留给 R7 或单独维护任务。

### 7.6 创建 Thread Run

R2 复用现有 run 创建 API，新增可选 `threadId` 和 `resumeMode`。

请求体示例：

```json
{
  "threadId": "thr_...",
  "prompt": "继续实现 R2 的测试",
  "resumeMode": "auto"
}
```

`resumeMode` 取值：

| 值 | 含义 |
|---|---|
| `auto` | 默认值；无 `codexThreadId` 时 `new_thread`，有 `codexThreadId` 时 `resume_thread` |
| `new_thread` | 显式重置 Codex session，仍归属同一个 Runtime thread |
| `resume_thread` | 强制 resume；如果 thread 没有 `codexThreadId`，run 失败 |

规则：

1. 未传 `threadId`：保持独立 run。
2. 传 `threadId`：请求体不能包含任何与 thread 固化配置冲突的字段；如果出现覆盖意图，返回 `THREAD_CONFIG_IMMUTABLE`。
3. thread 已归档：返回 `THREAD_ARCHIVED`。
4. 同 thread 有 active run：新 run 必须入队。
5. queued run 立即返回 run id，并可通过现有事件 API 观察。

## 8. 执行流

### 8.1 独立 Run

未传 `threadId` 时，流程保持 R0/R1：

1. 创建 run。
2. 构建普通 `codex exec --json` argv。
3. 启动 Codex。
4. 归一化事件。
5. 写入 run events、文件日志和 diagnostics。
6. 终态 done。

R2 不改变该路径。

### 8.2 Thread 第一轮 Run

当请求传入 `threadId`，但 thread 尚未有 `codex_thread_id`：

1. API 校验 thread 存在且 active。
2. `RunManager` 使用 thread 固化配置创建 run。
3. run 状态进入 queued 或 running。
4. 构建普通 `codex exec --json` argv。
5. prompt 通过 stdin 输入。
6. Codex 输出 `thread.started.thread_id` 时，Runtime 捕获该值。
7. Runtime 写入 `runs.codex_thread_id`。
8. Runtime 写入 `threads.codex_thread_id`。
9. 后续事件按现有 normalizer 处理。
10. run 成功时写 `done(succeeded)`。

如果第一轮没有捕获到 `thread.started.thread_id`，即使有 assistant message，也不能认为 thread 已绑定。该 run 应按核心事件缺失处理为失败，错误码为 `CODEX_THREAD_ID_MISSING` 或 `CODEX_INCOMPATIBLE`，具体取决于 parser 是否确认事件形状不兼容。

### 8.3 Thread 后续 Run

当 thread 已有 `codex_thread_id`：

1. API 校验 thread 存在且 active。
2. `RunManager` 检查 resume capability 是否 verified。
3. 创建 run，`resume_mode = resume_thread`。
4. 同 thread 队列确保前序 run 已终止。
5. 构建 `codex exec resume <codexThreadId> --json` argv。
6. prompt 通过 stdin 输入。
7. Codex 正常输出事件后进入 running。
8. `turn.completed` 到达后成功终止。

如果 Codex 返回 resume 目标不存在，run 失败，错误码 `RESUME_TARGET_NOT_FOUND`。

如果 Codex resume 进程非零退出但无法归类为目标不存在，run 失败，错误码 `RESUME_FAILED`。

如果当前 Codex 版本的 resume capability 未验证，run 失败，错误码 `RESUME_CAPABILITY_UNVERIFIED`。

### 8.4 显式重置 Codex Session

当请求 `resumeMode = new_thread` 且 thread 已有旧 `codex_thread_id`：

1. Runtime 创建新的普通 `codex exec --json` run。
2. 捕获新的 `thread.started.thread_id`。
3. 更新 `threads.codex_thread_id` 为新值。
4. run diagnostics 写入 `THREAD_CODEX_SESSION_RESET`。
5. 历史 run 保留旧 `runs.codex_thread_id`。

该能力用于用户明确知道要在同一个 Runtime thread 下重置 Codex 内部上下文的场景。R2 不自动触发该能力。

## 9. 同 Thread 串行策略

R2 采用内存队列加持久状态。

规则：

1. 同一个 `thread_id` 同时最多一个 running run。
2. 第二个及之后的 thread run 进入 queued。
3. queued run 已经有 run id，可查询、可订阅事件、可取消。
4. queued run 取消时不启动 Codex 子进程。
5. running run 取消沿用 R0/R1 的 SIGTERM 后 SIGKILL 策略。
6. 前一个 run 进入 terminal 状态后，队列启动下一个 run。
7. 不同 thread 可以并行。
8. 独立 run 不受 thread 队列限制。

R2 不做同 workspace 全局写锁。原因是 workspace 写冲突需要更完整的项目模型、写权限策略和 UI 提示。R2 只解决同一个 Codex session 的并发安全。

## 10. Daemon Restart 与 Orphan 策略

R2 不自动恢复 queued/running run。daemon 重启时：

1. 发现 `queued` run：标记 failed/orphaned。
2. 发现 `running` run：标记 failed/orphaned。
3. 已完成 run 不受影响。
4. thread 的 `codex_thread_id` 保留。
5. thread 若仍 active，后续可以继续创建新的 run。

失败诊断必须说明原因是 daemon restart/orphan recovery，而不是 Codex 本身失败。

不自动恢复的原因：

1. Runtime 无法确认旧进程是否仍存在、是否已经执行了写操作。
2. 自动重放 prompt 可能造成重复修改。
3. R2 的优先级是确定性和可诊断性。

## 11. Capability Matrix

R2 需要补齐 Runtime capability matrix。结构如下：

```ts
type RuntimeCapabilityMatrix = {
  codexVersion: string;
  checkedAt: string;
  execJson: boolean;
  execStdinPrompt: boolean;
  execProfile: boolean;
  execCwd: boolean;
  execSandbox: boolean;
  execSkipGitRepoCheck: boolean;
  resumeJson: boolean;
  resumeByThreadId: boolean;
  resumeLast: boolean;
  resumeModelOverride: boolean;
  resumeConfigOverride: boolean;
  resumeCwdOverride: boolean;
  resumeProfileOverride: boolean;
  resumeSandboxOverride: boolean;
  resumeContextContinuityVerified: boolean;
  mcpHelp: boolean;
  mcpAddEnv: boolean;
  warnings: string[];
};
```

`/codex/status` 至少返回：

1. Codex 版本。
2. 当前 `CODEX_HOME`。
3. 是否支持 `exec --json`。
4. 是否支持 `exec resume --json`。
5. resume ABI 是否已验证。
6. resume 上下文连续性是否已验证。
7. 当前 Runtime 是否允许创建 thread resume run。
8. warnings。

如果 resume capability 未验证，Runtime 可以允许创建 thread 和第一轮 run，但不允许后续 `resume_thread` 成功执行。后续 run 应失败并返回 `RESUME_CAPABILITY_UNVERIFIED`。

## 12. 错误处理

### 12.1 请求级错误

以下错误不创建 run：

| 错误码 | 场景 |
|---|---|
| `THREAD_NOT_FOUND` | thread id 不存在 |
| `THREAD_ARCHIVED` | thread 已归档 |
| `THREAD_CONFIG_IMMUTABLE` | run 请求试图覆盖 thread 固化配置 |
| `THREAD_HAS_ACTIVE_RUN` | archive 时 thread 存在 active run |

### 12.2 Run 级错误

请求合法但执行失败时，应创建 failed run：

| 错误码 | 场景 |
|---|---|
| `RESUME_CAPABILITY_UNVERIFIED` | resume ABI 未验证 |
| `CODEX_THREAD_ID_MISSING` | 第一轮 thread run 未捕获 Codex thread id |
| `RESUME_TARGET_NOT_FOUND` | Codex 报告 session 不存在 |
| `RESUME_FAILED` | Codex resume 失败但无法细分 |
| `CODEX_STREAM_ERROR` | JSONL 解析失败 |
| `CODEX_INCOMPATIBLE` | 核心事件形状不兼容 |
| `THREAD_RUN_ORPHANED` | daemon restart 标记 queued/running run 失败 |
| `THREAD_CONCURRENCY_CONFLICT` | 队列状态与持久状态冲突 |

Run 级失败必须写入：

1. `runs.public_status = failed`
2. `runs.internal_status = failed`
3. `termination_reason`
4. `error_code`
5. `error_message`
6. `diagnostics.json`
7. `error` event
8. `done(status=failed)` event

### 12.3 Diagnostics 内容

R2 diagnostics 应包含：

1. Runtime thread id。
2. Codex thread id。
3. `resume_mode`。
4. capability matrix 快照。
5. argv 脱敏快照。
6. exit code。
7. stderr 摘要。
8. stdout JSONL 解析错误摘要。
9. queue 状态。
10. orphan recovery 原因。

敏感信息继续沿用现有 redaction 策略。

## 13. 事件语义

R2 尽量复用现有 Runtime event envelope，不引入新的客户端协议。

R2 规范以下事件细节：

1. queued run 创建后写 `status(queued)`。
2. queued run 开始执行时写 `status(initializing)`。
3. 捕获 Codex thread id 时写一条 `status(initializing)` event，metadata 包含 `threadId` 和 `codexThreadId`。
4. resume 失败写 `error` event。
5. 所有终态继续写 `done` event。

客户端只依赖 Runtime 归一化事件，不直接依赖 Codex 原始 JSONL。

## 14. 测试验收矩阵

### 14.1 DB / Repository 测试

覆盖：

1. `threads` 创建、查询、列表、归档。
2. `codex_thread_id` 从空更新为真实值。
3. `runs.thread_id` 和 `runs.codex_thread_id` 写入正确。
4. archived thread 不删除 run/event/workspace。
5. thread 固化配置不可变。
6. 迁移可重复执行，旧 run 不受影响。

验收标准：

1. Runtime thread 是权威对象。
2. Codex thread id 只是外部绑定。
3. 数据迁移不破坏 R0/R1。

### 14.2 Thread API 测试

覆盖：

1. `POST /threads`
2. `GET /threads`
3. `GET /threads/:id`
4. `GET /threads/:id/runs`
5. `POST /threads/:id/archive`
6. `THREAD_NOT_FOUND`
7. `THREAD_ARCHIVED`
8. `THREAD_HAS_ACTIVE_RUN`
9. `THREAD_CONFIG_IMMUTABLE`

验收标准：

1. archived thread 不能继续创建 run。
2. active thread 可以查询历史 run。
3. thread run 使用 thread 固化配置。

### 14.3 RunManager Thread 测试

覆盖：

1. 无 `threadId` 时保持独立 run。
2. 有 `threadId` 且无 `codexThreadId` 时走 `new_thread`。
3. 有 `threadId` 且有 `codexThreadId` 时走 `resume_thread`。
4. 第一轮捕获 `thread.started.thread_id` 后更新 `runs` 和 `threads`。
5. resume 失败时 run failed，不伪装成功。
6. 显式 `resumeMode = new_thread` 时重置 Codex session 并记录 diagnostic。

验收标准：

1. 独立 run 不退化。
2. thread 第一轮和后续轮次路径清晰可测。
3. 没有 `codexThreadId` 时不会误调用 resume。
4. 有 `codexThreadId` 时不会误开新 session，除非显式请求。

### 14.4 Argv Builder 测试

覆盖：

1. `codex exec --json`。
2. `codex exec resume <codexThreadId> --json`。
3. thread config 进入 argv。
4. 请求覆盖 thread config 被拒绝。
5. capability 不支持的 resume 参数不会被盲目传递。

验收标准：

1. argv 构建可独立测试。
2. 业务调用点不拼接 Codex 命令。

### 14.5 Fake Codex 流测试

覆盖：

1. 第一轮输出 `thread.started.thread_id`。
2. 第二轮 resume 输出连续上下文事件。
3. resume 目标不存在。
4. malformed JSON。
5. 缺失 `turn.completed`。
6. stdout/stderr 分离保存。
7. run done seq 连续。

验收标准：

1. Runtime 状态转换确定可测。
2. 异常路径写 `error` 和 `done(status=failed)`。
3. 不依赖本机 Codex 版本变化。

### 14.6 真实 Codex Gated Smoke

使用环境变量显式启用，例如 `CLAWEE_RUN_REAL_CODEX_SMOKE=1`。

覆盖：

1. `codex exec --json` 可以启动。
2. 可以捕获真实 `thread.started.thread_id`。
3. `codex exec resume <thread_id> --json` 可以恢复上下文。
4. 不存在 resume id 返回可识别失败。
5. resume 对 `-m`、`-c`、`-C`、`-p`、`--sandbox` 的支持情况被记录。
6. stdout/stderr 分离保存。
7. `/codex/status` 暴露 resume capability 和 compatibility 状态。

验收标准：

1. R2 发布前在目标开发机至少跑通一次真实 Codex smoke。
2. Codex ABI 变化时 Runtime 显示 incompatible 或 unverified。
3. Runtime 不在 ABI 未验证时假装 Chat Resume 可用。

### 14.7 Queue / Cancel / Restart 测试

覆盖：

1. 同 thread 同时提交两个 run，第二个进入 queued。
2. 第一个完成后第二个启动 resume。
3. queued run 被取消，不启动 Codex。
4. running run 被取消，沿用现有进程终止策略。
5. 不同 thread 可并行。
6. 独立 run 不受 thread 队列限制。
7. daemon restart 时 queued/running 标记 failed/orphaned。
8. restart 后 thread `codexThreadId` 不丢失。

验收标准：

1. 同一 Codex session 不会被并发 resume。
2. queue 行为 API 可观察。
3. cancel 不留下僵尸 run。
4. daemon restart 不会留下 running/queued 卡死状态。

### 14.8 回归测试

R2 合入前必须继续通过：

1. 普通 run 创建、查询、取消。
2. SSE `fromSeq`、`afterSeq`、`Last-Event-ID`。
3. heartbeat。
4. stdout/stderr 保存。
5. spawn timeout。
6. run timeout。
7. inactivity timeout。
8. 缺 `turn.completed` 判失败。
9. daemon restart orphan 恢复。

## 15. 交付边界

R2 完成后，项目可以声明：

1. 支持创建 Runtime thread。
2. 支持 thread 固化配置。
3. 支持 thread 第一轮绑定真实 Codex thread id。
4. 支持后续 run 通过 Codex resume 延续上下文。
5. 支持同 thread 严格串行。
6. 支持 thread 查询、run 历史查询和归档。
7. 支持 resume capability 检测和 `/codex/status` 暴露。
8. 支持 resume 失败、未验证、目标不存在和 ABI 不兼容的结构化诊断。
9. 支持 fake Codex 自动化测试和真实 Codex gated smoke。

R2 完成后，项目仍不能声明：

1. 完整 Codex 产品 UI 已完成。
2. Profile / `CODEX_HOME` 管理已完成。
3. Skills 管理已完成。
4. MCP 管理已完成。
5. Scheduler 已完成。
6. 跨 workspace 写冲突治理已完成。
7. 云同步或多设备同步已完成。

## 16. 实施顺序

R2 的实施计划应按以下顺序拆分：

1. DB migration 和 repository。
2. Thread API。
3. Codex resume argv builder。
4. RunManager thread 第一轮绑定。
5. RunManager resume 执行。
6. 同 thread queue/cancel。
7. capability matrix 和 `/codex/status`。
8. diagnostics/error mapping。
9. fake Codex 集成测试。
10. real Codex gated smoke。
11. R0/R1 回归测试。

该顺序的理由是先稳定数据和 API，再打通执行路径，最后补齐真实 ABI 验证和回归。不要先做 UI，也不要先做 Profile/Skills/MCP/Scheduler，否则会把尚未稳定的会话内核变成更多上层功能的隐性依赖。

## 17. 风险与缓解

### 17.1 Codex Resume ABI 变化

风险：Codex CLI 版本变化导致 `resume` 参数、事件形状或失败输出变化。

缓解：

1. capability matrix 持久化。
2. gated real Codex smoke。
3. `/codex/status` 显示 unverified/incompatible。
4. 未验证时 run 明确失败。

### 17.2 同 Thread 并发导致上下文污染

风险：两个 run 同时 resume 同一 Codex session，造成上下文顺序不可预测。

缓解：

1. 同 thread 串行队列。
2. queued 状态持久化。
3. queued run 可取消。
4. restart 后 queued/running 标记 orphaned。

### 17.3 配置漂移

风险：同一 thread 的后续 run 使用不同 cwd/profile/model/sandbox，导致 Chat 语义不可解释。

缓解：

1. thread 创建时固化配置。
2. run 覆盖配置返回 `THREAD_CONFIG_IMMUTABLE`。
3. run diagnostics 记录 thread config 快照。

### 17.4 误把失败 Resume 当成功 Chat

风险：resume 失败后 Runtime 自动开新 session，用户以为上下文仍连续。

缓解：

1. R2 禁止自动 fresh exec 降级。
2. 只有显式 `resumeMode = new_thread` 才重置 session。
3. diagnostics 写入 `THREAD_CODEX_SESSION_RESET`。

### 17.5 过早引入消息表和 UI 状态

风险：消息模型提前固化，后续事件协议和 UI 需求变化时迁移成本高。

缓解：

1. R2 不新增 `messages` 表。
2. 消息视图从 run events 派生。
3. UI 设计阶段再决定是否需要派生索引。

## 18. 开放决策

R2 不保留会阻塞实施的开放项。以下问题已在本文中给出第一版取舍：

1. thread run 并发策略：采用同 thread 队列，不立即拒绝。
2. resume 失败降级策略：不自动降级，显式失败。
3. 消息存储策略：不新增 messages 表，从 events 派生。
4. restart 策略：queued/running 标记 failed/orphaned，不自动恢复。
5. 配置策略：thread 创建时固化，后续不可覆盖。

这些取舍如需调整，应在 R2 实施计划开始前修改本文。
