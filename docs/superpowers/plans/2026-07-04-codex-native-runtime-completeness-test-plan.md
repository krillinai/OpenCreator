# Codex-native Runtime 完备性测试方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项实现本测试方案。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 按 `2026-07-03-codex-native-runtime-contract-design.md` 验证 Codex-native Runtime 从 R-1 到 R7 的目标覆盖度，区分“已通过”“缺测试”“缺实现”“环境阻塞”。

**Architecture:** 测试分为四层：contract coverage audit、fake Codex 契约测试、真实 Codex ABI/smoke 测试、本地 daemon 端到端测试。测试结果必须产出能力矩阵和缺口清单，不能用 R0/R1 的基础闭环替代完整 Runtime 验收。

**Tech Stack:** pnpm, Vitest, TypeScript, Fastify inject, fake Codex binary, real Codex CLI, isolated `CODEX_HOME`, temporary workspaces, shell smoke scripts.

---

## 0. 测试结论口径

本方案使用以下状态标记：

| 状态 | 含义 |
|---|---|
| `PASS` | 功能已实现，且自动化或手动测试通过 |
| `PARTIAL` | 存在部分实现或部分测试，但未覆盖 contract 验收条件 |
| `MISSING_TEST` | 功能看起来存在，但缺少 contract 级测试 |
| `MISSING_IMPL` | contract 要求存在，但当前代码未实现 |
| `BLOCKED_ENV` | 需要外部环境、平台、凭据或真实 Codex fixture，当前机器无法完整验证 |
| `OUT_OF_SCOPE_R0R1` | 不属于当前已实现的 Runtime kernel 基础闭环，但属于完整 contract 后续里程碑 |

验收报告必须同时包含：

1. 当前代码通过了哪些测试。
2. contract 中哪些目标还没实现。
3. 哪些目标实现了但没测。
4. 哪些目标需要真实 Codex、平台矩阵或用户凭据。
5. 下一批应该补的测试和功能顺序。

## 1. 当前实现覆盖概览

| 里程碑 | contract 目标 | 当前状态 | 说明 |
|---|---|---|---|
| R-1 | Codex 行为验证 Spike | `PARTIAL` | 已测 version/help/resume help/MCP help/最小 JSONL/command execution，并生成本地 ignored fixture；缺 image、sandbox 平台、rollout usage、失败路径、版本化 fixture |
| R0 | Runtime Kernel Harness | `PARTIAL` | run 成功/失败/cancel/spawn timeout/timeout/inactivity/非法 JSON/stderr/SIGTERM 后 SIGKILL 兜底、done 连续 seq、daemon restart orphan、关键成功终态缺失判失败已覆盖；缺进程树强杀专项、config normalize、usage source |
| R1 | Run API + SSE | `PARTIAL/PASS` | create/get/list/cancel/events/auth、`fromSeq`、`afterSeq`、`Last-Event-ID`、terminal cancel 错误码、大量事件、运行中 tail、heartbeat 已覆盖；缺断线重连 e2e |
| R2 | Thread / Chat Runtime | `MISSING_IMPL` | 只有 `POST /threads` 内存创建；缺持久化、list/get/runs/archive、真实 resume、同 thread 串行锁 |
| R3 | Profiles / Settings / CODEX_HOME | `MISSING_IMPL` | 只有 `CODEX_HOME` 解析；缺 profile CRUD、写锁、原子写入、备份、config normalize、缓存同步 |
| R4 | Skills Pass-through | `PARTIAL/BLOCKED_ENV` | skills 扫描、元数据、安装、覆盖、删除、备份、invalid 诊断、写确认、操作日志、API 自动化测试通过；真实 Codex discovery smoke 已实现但当前机器 Codex auth 返回 401，标记 `BLOCKED_ENV`；真实模型按 skill 行为输出仍为 `UNVERIFIED_BEHAVIOR` |
| R5 | MCP Pass-through | `PASS` | R5 范围内 MCP 管理 API、fake Codex MCP command、env/API/log/diagnostics 脱敏、SQLite 操作审计、真实 `codex mcp add/get/list/remove` gated smoke 已通过；R5 不实现自研 MCP runtime 或托管 MCP server，真实模型调用 MCP tool 行为仍为 `UNVERIFIED_BEHAVIOR` |
| R6 | Scheduler | `PASS` | schedule CRUD/run-now、timer trigger、source metadata、per-run timeout、cron/timezone/DST、misfire skip、`run_once` 拒绝、concurrency skip/queue/parallel、API 错误映射和真实 Codex run-now smoke 已通过 |
| R7 | Diagnostics + Release Readiness | `PARTIAL` | diagnostics 导出和 symlink 防护已测；缺 `/codex/status` 快照打包、日志/workspace 清理 API、release smoke 脚本 |

当前已经通过的基础测试不能被描述为“完整 Codex 全功能通过”。准确表述是：**R0/R1 的最小 Runtime run 闭环通过，完整 contract 仍有 R2-R7 大量缺口。**

## 2. 测试环境矩阵

### 2.1 必备本地环境

- Node.js 22+
- pnpm 9+
- 可执行 `codex`
- 当前用户可读写临时目录
- 本项目依赖已安装

### 2.2 Codex 环境模式

| 模式 | 用途 | 风险控制 |
|---|---|---|
| 全局 `CODEX_HOME` | 验证默认复用用户 Codex 环境 | 只允许只读探测和非破坏性 run；写操作必须人工确认 |
| 隔离 `CODEX_HOME` | 验证 profile、skill、MCP、config normalize 写入 | 使用临时目录，测试结束删除 |

### 2.3 平台矩阵

| 平台 | 必测项 |
|---|---|
| macOS | read-only/workspace-write/danger-full-access、进程取消、MCP stdio、skills |
| Linux | sandbox 行为、进程树清理、cron/sleep/misfire |
| Windows | sandbox 降级或拒绝策略、进程树清理、路径 realpath |
| WSL | sandbox 和 Windows 路径边界 |

当前机器只能完成 macOS/当前平台子集。其它平台必须标记 `BLOCKED_ENV`，不能假装通过。

## 3. Contract Coverage Audit

### Task A1: 生成 contract 覆盖表

**目标：** 把 contract 文档每个章节映射到代码、测试和状态。

**输入：**
- `docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md`
- `apps/daemon/src/**`
- `apps/daemon/test/**`
- `apps/harness/src/cli.ts`

**输出：**
- `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`

**检查维度：**

| Contract 章节 | 覆盖点 | 状态字段 |
|---|---|---|
| 6 Codex CLI 兼容 | version/help/capability/resume/argv/sandbox | implemented/tested/fixture/platform |
| 7 CODEX_HOME | global/isolated/config write/normalize/cache | implemented/tested/write-safety |
| 8 Run/Thread | run/thread/resume/concurrency/cancel/timeout/orphan | implemented/tested/e2e |
| 9 Events/SSE | envelope/normalizer/usage/replay/version | implemented/tested/fixture |
| 10 Logs/Diagnostics | files/redaction/export/retention/cleanup | implemented/tested/security |
| 11 Scheduler | cron/timezone/misfire/concurrency/run-now | implemented/tested/time-control |
| 12 MCP | get/add/remove/login/logout/env/runtime events | implemented/tested/real-codex |
| 13 Security | loopback/auth/CORS/content-type/high-risk audit | implemented/tested/security |
| 14 Errors | HTTP status/error code/event error mapping | implemented/tested |
| 15 Data Model | tables/constraints/index/runtime capabilities | implemented/tested/migration |
| 16 Testing | unit/fake/real/e2e expected coverage | status |
| 17 R milestones | R-1 到 R7 验收项 | status |
| 18 Done | 第一版完成定义 13 条 | status |

## 4. R-1 Codex ABI 验证测试

### Task R-1.1: CLI capability probe

**测试命令：**

```bash
codex --version
codex exec --help
codex exec resume --help
codex mcp --help
codex mcp add --help
```

**验收：**

1. 保存 stdout/stderr 摘要。
2. 记录支持的 flags。
3. 记录不支持或 help 未显示的 flags。
4. 写入 `runtime_capability_matrix` 或临时 fixture report。

**当前状态：** `PARTIAL`。已有 version/exec help/resume help/MCP help/minimal JSONL/command execution 自动化 smoke，并生成本地 ignored fixture；缺能力矩阵持久化。

### Task R-1.2: stdout/stderr 分离 fixture

**测试场景：**

1. assistant message：`Reply with OK only.`
2. command execution：要求 Codex 执行只读命令，例如 `pwd`。
3. stderr warning：使用当前全局环境采集真实 warning，但不把 warning 当失败。
4. non-zero 或失败路径：构造只读失败命令。
5. auth/config invalid：隔离或伪造 `CODEX_HOME`，验证错误形态。

**验收：**

1. stdout 每行都是 JSONL 或明确记录异常。
2. stderr 独立保存。
3. fixture 保存到 `apps/daemon/test/fixtures/real-codex/<version>/`。
4. normalizer fixture test 使用这些样本回归。

**当前状态：** `PARTIAL`。已有最小 JSONL 和 command execution smoke，并保存 stdout/stderr 到本地 ignored fixture；缺版本化脱敏 fixture、usage 和失败路径。

### Task R-1.3: resume ABI fixture

**测试场景：**

1. create run 捕获 `thread.started.thread_id`。
2. `codex exec resume <thread_id> --json` 续接。
3. resume 是否支持/拒绝 `-C`。
4. resume 是否支持/拒绝 `--sandbox`。
5. resume 是否支持 `-m/--model`。
6. resume 是否支持 `-c model_reasoning_effort=...`。
7. resume 目标不存在。
8. resume 跨 cwd。

**验收：**

1. 明确第一版是否可承诺 resume Chat。
2. 如果可承诺，冻结 resume argv builder。
3. 如果不可承诺，Runtime capability 必须显示 `resume_unavailable` 或等价状态。

**当前状态：** `MISSING_IMPL/MISSING_TEST`。

### Task R-1.4: MCP ABI fixture

**测试场景：**

1. `codex mcp get <name>` 不存在和存在。
2. `codex mcp add <name> --env KEY=VALUE -- <command> <args...>`。
3. `codex mcp remove <name>`。
4. env value 不明文出现在 API 响应。
5. 可选：本地 echo MCP server 被 run 触发。

**验收：**

1. `codex mcp` 命令参数形态确认。
2. 管理命令超时和失败映射为 `MCP_COMMAND_FAILED`。
3. MCP runtime event 未采集前，不承诺 MCP 工具可视化。

**当前状态：** `PARTIAL`，只有 argv builder 单测。

### Task R-1.5: sandbox/platform fixture

**测试场景：**

1. `read-only` 尝试读文件和写文件。
2. `workspace-write` 尝试写 cwd 内、cwd 外。
3. `danger-full-access` 只在隔离临时目录人工确认后测试。
4. macOS/Linux/Windows/WSL 分平台记录。

**验收：**

1. API 返回产品 sandbox 意图和实际执行 sandbox。
2. 未验证平台的写模式必须拒绝或降级，不得静默执行。

**当前状态：** `MISSING_TEST/BLOCKED_ENV`。

## 5. R0 Runtime Kernel 契约测试

### Task R0.1: fake Codex 状态机矩阵

| 场景 | 预期 |
|---|---|
| 正常 JSONL + exit 0 | `succeeded/completed` |
| stderr + exit 0 | `succeeded/completed`，stderr 进入 diagnostics |
| stderr + exit non-zero | `failed/codex_exit_non_zero` |
| 非法 JSON | 关键事件缺失时应 `failed/stream_error`；非关键行应 diagnostic |
| unknown event | `unknown_event`，不失败 |
| spawn fail | `failed/spawn_failed` |
| run timeout | `failed/timeout` |
| inactivity timeout | `failed/inactivity_timeout` |
| cancel 后退出 | `canceled/user_canceled` |
| cancel 后不退出 | 强杀后 `canceled` 或 `failed/process_kill_failed`，必须无遗留进程 |
| daemon crash/restart | running run 标记 `orphaned` |

**当前状态：** `PARTIAL`。已覆盖 success/fail/invalid/stderr/关键成功终态缺失/spawn timeout/timeout/inactivity/cancel/忽略 SIGTERM 后强杀兜底/done 连续 seq/daemon restart orphan/resume missing；缺进程树强杀专项。

### Task R0.2: 日志一致性测试

**检查：**

1. `meta.json` 不保存完整敏感 prompt。
2. `raw.redacted.ndjson` JSON 结构合法。
3. `events.ndjson` 与 `run_events` seq 一致。
4. `stderr.redacted.log` 脱敏。
5. `diagnostics.json` 记录 exitCode/signal/terminationReason。
6. symlink/path traversal 不可导出。

**当前状态：** `PARTIAL`。diagnostics symlink 和 events 文件/DB seq 一致性已过；prompt/meta 脱敏缺专项。

## 6. R1 Run API + SSE 测试

### Task R1.1: API 行为矩阵

| API | 测试 |
|---|---|
| `GET /healthz` | 无鉴权只返回 `{ ok: true }` |
| `GET /codex/status` | 必须鉴权，返回 codexHome/capabilities |
| `POST /runs` | 创建 run，不等待完成 |
| `GET /runs` | 分页或 limit |
| `GET /runs/:id` | 状态、终止原因 |
| `POST /runs/:id/cancel` | running 可取消，terminal 返回 `RUN_ALREADY_TERMINAL` |
| `GET /runs/:id/events` | auth、full replay、tail、done 后关闭 |

**当前状态：** `PARTIAL`。基础 API、terminal cancel `RUN_ALREADY_TERMINAL`、`fromSeq`/`afterSeq`/`Last-Event-ID`、大量事件、运行中 tail、content-type 校验通过；断线重连 e2e 缺专项。

### Task R1.2: SSE replay 专项

**测试：**

1. 首次连接 replay 全量事件。
2. `?fromSeq=2` 从 seq 2 之后继续。
3. `Last-Event-ID: 2` 继续。
4. `?afterSeq=2` 当前兼容行为。
5. 已结束 run replay 后关闭。
6. 运行中 run replay 历史后 tail 新事件。
7. 大量事件不丢失、不乱序。

**当前状态：** `PARTIAL`。已自动测 full replay、`fromSeq`、`afterSeq`、`Last-Event-ID`、大量事件、运行中 tail、heartbeat；缺更真实的断线重连 e2e。

## 7. R2 Thread / Chat / Resume 测试

### Task R2.1: Thread API 完整矩阵

| API | 验收 |
|---|---|
| `POST /threads` | 创建 managed/external thread |
| `GET /threads` | 列表 |
| `GET /threads/:id` | 详情 |
| `GET /threads/:id/runs` | 线程 run 历史 |
| `PATCH /threads/:id` | 只允许安全字段 |
| `POST /threads/:id/archive` | archive 后 workspace 可进入清理状态 |

**当前状态：** `MISSING_IMPL`。

### Task R2.2: Chat resume e2e

**测试：**

1. 在线程下创建第一轮 run，捕获 `codexThreadId`。
2. 第二轮 run 使用 `resume_thread`。
3. 验证上下文连续。
4. 同 thread 同时提交两个 run，第二个排队。
5. resume target 失效时返回 `RESUME_TARGET_NOT_FOUND` 或 auto reseed diagnostic。

**当前状态：** `MISSING_IMPL`。

## 8. R3 CODEX_HOME / Profiles 测试

### Task R3.1: CODEX_HOME 模式

**测试：**

1. 未设置 `$CODEX_HOME` 时使用默认全局路径。
2. 设置 `$CODEX_HOME` 时使用环境路径。
3. 隔离模式使用临时目录。
4. SQLite 缓存与 `CODEX_HOME` 冲突时以 `CODEX_HOME` 为准。

**当前状态：** `PARTIAL`。只测解析，没有缓存冲突和隔离 e2e。

### Task R3.2: profile/config 写入安全

**测试：**

1. profile create/edit/delete。
2. 写锁串行。
3. 原子写入：temp + rename。
4. 写前备份。
5. 配置损坏返回 `CODEX_CONFIG_INVALID`。
6. 全局模式修复必须显式确认。

**当前状态：** `MISSING_IMPL`。

## 9. R4 Skills Pass-through 测试

### Task R4.1: skill 管理

**测试：**

1. 扫描全局和隔离 `CODEX_HOME` skills。
2. 安装本地 skill 目录。
3. 删除 skill。
4. 无效 skill 标记 `invalid`。
5. 操作日志。

**当前状态：** `PASS`。

已实现并通过自动化测试：

1. `CODEX_HOME/skills` 扫描和 `valid/invalid` 诊断。
2. 本地 skill 目录安装、覆盖、删除和备份。
3. 全局 `CODEX_HOME` 写操作显式确认。
4. symlink/path traversal 拒绝。
5. `codex_skill_operations` 写操作日志。
6. `/codex/skills` API 集成测试。

验证命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-skills-validator.test.ts test/unit/codex-skills-scanner.test.ts test/unit/codex-skills-installer.test.ts test/unit/codex-smoke.test.ts test/unit/storage.test.ts test/integration/api.test.ts
```

结果：`6` 个测试文件、`71` 个测试通过。

### Task R4.2: skill 触发真实 Codex 测试

**测试：**

1. 在隔离 `CODEX_HOME` 安装一个最小测试 skill。
2. 运行 prompt 显式引用该 skill。
3. 检查 Codex stdout/stderr 和事件是否能证明 skill 被发现或使用。

**当前状态：** `BLOCKED_ENV/UNVERIFIED_BEHAVIOR`。

已实现 gated smoke：Runtime 通过 `/codex/skills/install` 把测试 skill 安装到隔离 `CODEX_HOME/skills`，再运行真实 `codex exec --json` 验证 Codex 接受该目录布局并输出合法 JSONL。

当前机器复测结果：`BLOCKED_ENV`。`skills-discovery-jsonl.json` 显示真实 Codex 已启动并进入 JSONL 事件流，但请求 OpenAI API 时返回 `401 Unauthorized: Missing bearer or basic authentication`。额外探测只复制 `~/.codex/auth.json` 到隔离 home 后仍返回 `token_expired/refresh_token_reused`，需要重新登录或提供可用真实 Codex 凭据后复测。

真实模型是否按 `SKILL.md` 行为输出 marker 暂不作为 R4 第一版硬断言，状态为 `UNVERIFIED_BEHAVIOR`。

复测命令：

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## 10. R5 MCP Pass-through 测试

### R5 MCP pass-through

Status: `PASS`

Scope:

- MCP 管理 API：`PASS`
- fake Codex MCP command coverage：`PASS`
- env value API/log/diagnostics 脱敏：`PASS`
- SQLite MCP 操作审计：`PASS`
- real `codex mcp add/get/list/remove`：`PASS`
- real model MCP behavior：`UNVERIFIED_BEHAVIOR`

Verification:

- `pnpm --filter @clawee/daemon test -- test/unit/mcp-argv.test.ts test/unit/codex-mcp-validator.test.ts test/unit/codex-mcp-redaction.test.ts test/unit/codex-mcp-runner.test.ts test/unit/codex-mcp-parser.test.ts test/unit/codex-mcp-operations.test.ts test/unit/codex-mcp-manager.test.ts test/unit/storage.test.ts test/unit/codex-capabilities.test.ts test/integration/api.test.ts`
  - 结果：`10` 个测试文件、`121` 个测试通过。
- `pnpm typecheck`
  - 结果：通过。
- `pnpm test`
  - 结果：通过；daemon `25` 个测试文件通过、`1` 个真实 smoke 文件默认 gate 跳过，`216` 个测试通过、`11` 个 gated smoke 测试跳过。
- `git diff --check`
  - 结果：通过。
- `CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts -t "adds, gets, lists, and removes a stdio MCP server"`
  - 结果：通过；`1` 个真实 `codex mcp` command smoke 通过，`10` 个非目标 smoke 跳过。

Environment notes:

- `CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts` 当前整体结果为 `BLOCKED_ENV`：其中 R5 MCP command smoke 已通过，但 R4 skill/model smoke 在真实 Codex API 请求阶段返回 `401 Unauthorized: Missing bearer or basic authentication`。
- 因此 R5 command/config pass-through 范围判定为 `PASS`；真实模型是否能在运行中调用 MCP tool 不在 R5 第一版验收内，保留为后续 runtime behavior smoke。

Notes:

- R5 不实现自研 MCP runtime。
- R5 不托管 MCP server 进程。
- R5 不要求真实模型成功调用 MCP tool；该项归入后续 runtime behavior smoke。
- 当前真实 smoke 使用的是 stdio MCP server configuration 测试，只验证 Codex MCP 配置管理链路，不验证 MCP JSON-RPC handshake。

## 11. R6 Scheduler 测试

### Task R6.1: schedule API

**测试：**

1. create/list/get/update/delete schedule。
2. run-now。
3. 到点创建 run。
4. schedule run 写入 `createdBy=schedule/sourceId`。
5. schedule timeout 生效。

**当前状态：** `PASS`。

已实现并通过自动化测试：

1. `/schedules` create/list/get/update/delete。
2. `/schedules/:id/run-now` 通过 `SchedulerService -> RunManager.startRun()` 创建 independent run。
3. schedule run 持久化 `createdBy=schedule`、`sourceId=<scheduleId>` 和 `timeoutMs`。
4. disabled schedule 清空 `nextRunAt`。
5. schedule operation audit 覆盖 `create/update/delete/run_now/timer_trigger/skip_misfire/skip_concurrency/queue_trigger/run_queued`。
6. API 对 scheduler `INTERNAL_ERROR` 统一返回 `"Internal error"`，不泄漏内部路径或 secret。
7. gated 真实 Codex smoke 已验证 schedule run-now 能穿透 daemon 调起真实 `codex exec`，并产生 `done/succeeded` 事件。

验证命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/protocol-shape.test.ts test/unit/scheduler.test.ts test/unit/scheduler-cron.test.ts test/unit/scheduler-validator.test.ts test/unit/scheduler-repository.test.ts test/unit/scheduler-service.test.ts test/unit/storage.test.ts test/integration/run-manager.test.ts test/integration/api.test.ts
```

结果：`9` 个测试文件、`146` 个测试通过。

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts -t "creates a schedule run-now path through the daemon"
```

结果：通过；`1` 个真实 Codex scheduler smoke 通过，`11` 个非目标 smoke 跳过。生成的 ignored fixture 记录了 `createdBy=schedule`、`sourceId`、`run_now` operation、assistant marker 和 `done/succeeded` 事件。

### Task R6.2: time semantics

**测试：**

1. timezone 固化。
2. 系统时区变化不改变已有 schedule。
3. misfire `skip`。
4. misfire `run_once`。
5. concurrency `skip/queue/parallel`。
6. DST 切换日行为。

**当前状态：** `PASS`。

已实现并通过自动化测试：

1. cron adapter 使用固定 timezone 计算下一次运行时间。
2. UTC、Asia/Shanghai 和 America/New_York DST spring-forward 样例有确定性测试。
3. misfire 只支持 `skip`；睡眠/离线/长卡顿错过触发时跳过并推进 `nextRunAt`，不补跑。
4. `run_once` 不作为第一版能力实现；validator 对 `misfirePolicy: "run_once"` 返回 `SCHEDULE_INVALID`。
5. concurrency `skip` 在同 schedule 有 active run 时记录 skip，不启动新 run。
6. concurrency `queue` 合并 pending trigger，active run 结束后只补一个 queued run；queued trigger 失败会清理 pending 状态并继续处理其它 schedule。
7. concurrency `parallel` 允许同 schedule 重叠创建 run。
8. scheduler timer lifecycle 覆盖 start/stop、queue timer、失败隔离和失败后刷新 timer。

补充验证：

```bash
pnpm typecheck
pnpm test
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
git diff --check
```

结果：

1. `pnpm typecheck` 通过。
2. `pnpm test` 通过；daemon `29` 个测试文件通过、`1` 个真实 smoke 文件默认 gate 跳过，`264` 个测试通过、`12` 个 gated smoke 跳过。
3. 默认真实 smoke gate 关闭时通过，`12` 个 smoke 测试全部跳过。
4. `git diff --check` 通过。

## 12. R7 Diagnostics / Release Readiness 测试

### Task R7.1: diagnostics 包完整性

**测试：**

1. 包含 `meta.json/events.ndjson/stderr.redacted.log/diagnostics.json`。
2. 包含 `/codex/status` 快照。
3. 可选包含 `raw.redacted.ndjson`，但默认不包含未脱敏 raw。
4. path traversal/symlink 防护。
5. 导出层二次脱敏。

**当前状态：** `PARTIAL`。基础导出和 symlink 已过；缺 status 快照、raw 策略和二次脱敏专项。

### Task R7.2: 清理策略

**测试：**

1. run logs 保留策略。
2. independent managed run workspace 清理。
3. archived thread workspace 清理。
4. diagnostic raw 未脱敏日志短保留和一键删除。

**当前状态：** `MISSING_IMPL`。

## 13. 推荐执行顺序

### Phase 1: 不补功能，只补覆盖审计和现状测试

目标是避免继续误判“已完成”。

1. 生成 `runtime-contract-coverage.md`。
2. 补 R-1 real Codex help/resume/mcp smoke。
3. 补 R1 SSE `fromSeq/Last-Event-ID` 测试。
4. 补 R0 强杀、inactivity、events 一致性测试。
5. 产出缺口报告。

### Phase 2: 补 R0/R1 contract 缺口

1. daemon restart orphan 恢复。
2. run_events 与 events.ndjson 一致性恢复。
3. `fromSeq` 参数兼容 contract。
4. terminal cancel 返回 `RUN_ALREADY_TERMINAL`。
5. `/codex/status` 能力检测真实化。

### Phase 3: 实现 R2 Thread/Chat

1. thread 持久化和 API 完整化。
2. 同 thread 串行锁。
3. `codexThreadId` 捕获。
4. resume argv builder。
5. 真实 Codex resume e2e。

### Phase 4: 实现 R3-R5 Codex 原生生态透传

1. profile/config 安全写入。
2. skills scan/install/delete 已完成；真实 Codex discovery 需在可用 auth 环境下复测。
3. MCP pass-through API。
4. 隔离 `CODEX_HOME` 写操作测试。

### Phase 5: 实现 R6/R7

1. Scheduler CRUD/run-now。
2. timezone/misfire/concurrency。
3. diagnostics 包增强。
4. 清理策略。
5. release smoke 脚本。

## 14. 最小下一步执行计划

下一步不应直接补 R2-R7 大功能。建议先创建覆盖审计报告和测试骨架，让项目状态透明化。

### Task 1: Contract coverage report

**Files:**
- Create: `docs/superpowers/reports/2026-07-04-runtime-contract-coverage.md`

**Steps:**
- [x] 按本文第 3 节逐条映射 contract。
- [x] 给每条标记 `PASS/PARTIAL/MISSING_TEST/MISSING_IMPL/BLOCKED_ENV`。
- [x] 引用当前代码路径和测试路径。
- [x] 明确当前版本只能声明 R0/R1 子集。

### Task 2: R-1 smoke expansion

**Files:**
- Modify: `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- Create: `apps/daemon/test/fixtures/real-codex/.gitkeep`

**Steps:**
- [x] 增加 `codex exec resume --help` smoke。
- [x] 增加 `codex mcp --help` smoke。
- [x] 增加 `codex mcp add --help` smoke。
- [x] 增加 command execution run smoke。
- [x] 默认仍由 `CLAWEE_RUN_REAL_CODEX_SMOKE=1` gate 控制。

### Task 3: R1 SSE contract tests

**Files:**
- Modify: `apps/daemon/test/integration/api.test.ts`
- Modify: `apps/daemon/src/api/routes.runs.ts`

**Steps:**
- [x] 添加 `fromSeq` 测试，当前实现预期失败。
- [x] 添加 `Last-Event-ID` 测试。
- [x] 添加 terminal cancel 错误码测试。
- [x] 实现最小修复。

### Task 4: R0 recovery and consistency tests

**Files:**
- Modify: `apps/daemon/test/integration/run-manager.test.ts`
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/storage/repositories.ts`

**Steps:**
- [x] 添加 events.ndjson 与 run_events seq 一致性测试。
- [x] 添加 fake Codex 忽略 SIGTERM 的强杀测试。
- [x] 添加 daemon restart orphan 标记测试。
- [x] 实现或明确标记缺口。

## 15. 通过标准

只有当以下条件满足时，才能声称“完整 contract 第一版通过”：

1. R-1 到 R7 的每项验收都有 `PASS` 或明确 `OUT_OF_SCOPE`，不能是未解释的空白。
2. 所有 `MISSING_IMPL` 都被实现或从第一版范围移除并写入 contract。
3. 所有 `MISSING_TEST` 都补上测试。
4. 所有 `BLOCKED_ENV` 都有平台/凭据说明和复测计划。
5. `pnpm typecheck` 通过。
6. `pnpm test` 通过。
7. gated real Codex smoke 在目标 Codex 版本通过。
8. daemon + harness 能完成 run/thread/skills/MCP/scheduler/diagnostics 的端到端验收。

当前项目距离该标准还有明显距离。当前可声明的范围应收敛为：**R0/R1 基础 run 闭环已通过，完整 contract 仍在覆盖审计和后续实现阶段。**
