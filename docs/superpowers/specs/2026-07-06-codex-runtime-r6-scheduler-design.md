# Codex Runtime R6 Scheduler 设计

## 1. 状态

状态：草案，等待实施计划。

本设计补充 `2026-07-03-codex-native-runtime-contract-design.md` 的 R6 里程碑。R6 只处理本地 daemon 内的 schedule 管理和触发能力，不实现 UI、系统级后台常驻安装、分布式调度或 Agent runtime。

## 2. 目标

R6 第一版目标：

1. 提供 schedule CRUD API。
2. 提供 `run-now` API。
3. daemon 运行期间按 cron 和固化 timezone 自动触发 schedule。
4. schedule 到点后通过 `RunManager` 创建普通 Codex run。
5. schedule run 写入 `createdBy = "schedule"` 和 `sourceId = scheduleId`。
6. 支持 schedule run 独立 `timeoutMs`。
7. 支持 `concurrencyPolicy = skip | queue | parallel`。
8. 电脑睡眠、daemon 关闭或长时间卡顿导致错过触发时默认跳过，不补跑。
9. 使用 SQLite 保存 schedule 真相源、下一次触发时间和操作审计。
10. 使用 cron 计算库验证 cron、timezone 和 DST 行为。
11. 为后续 UI 提供稳定 API，但 R6 不实现 UI。
12. 自动化测试覆盖 CRUD、run-now、timer 触发、sleep/wake skip、并发策略和 timeout。

## 3. 非目标

R6 第一版不做：

1. 不实现 UI。
2. 不绑定已有 thread；schedule run 全部是 independent run。
3. 不实现 Chat resume 定时任务。
4. 不实现系统级开机启动、LaunchAgent、systemd service 或后台服务安装。
5. 不实现多 daemon leader election 或分布式锁。
6. 不把 Scheduler 变成 Agent runtime；Scheduler 不执行任务逻辑。
7. 不补跑 daemon 离线、电脑睡眠或系统长时间卡顿期间错过的触发。
8. 不支持 `misfirePolicy = run_once` 作为可用 API。
9. 不无限排队重叠触发；`queue` 第一版只合并成一个 pending trigger。
10. 不要求真实 Codex 模型网络请求成功作为 R6 第一版硬验收。

## 4. 设计决策

### 4.1 SQLite 是 schedule 真相源

R6 使用 SQLite 保存 schedule 配置、`nextRunAt`、最近触发状态和操作审计。进程内 timer 只是当前 daemon 实例的执行机制，不是真相源。

这样 daemon 重启或系统睡眠唤醒后可以用 SQLite 中的 `nextRunAt` 判断是否错过触发，并按桌面安全策略跳过，而不是依赖 cron 库或 timer 的补触发行为。

### 4.2 cron 库只做时间计算

新增依赖 `cron-parser`。它只负责：

1. 校验 cron 表达式。
2. 根据固定 timezone 计算下一次触发时间。
3. 在测试中验证 DST 边界行为。

Runtime 不使用 cron 库作为内存 job scheduler。调度循环、misfire、安全策略和状态更新都由 R6 自己控制。

### 4.3 睡眠和离线错过触发一律跳过

桌面本地 scheduler 和云端 scheduler 的风险不同。电脑睡眠唤醒后批量补跑会导致 Codex 进程、模型请求、文件写入和用户工作区负载突然放大。

R6 第一版采用保守策略：

1. `misfirePolicy` API 只接受 `skip`。
2. 如果请求 `run_once`，返回 `SCHEDULE_INVALID`。
3. 如果 `now - nextRunAt` 超过 `triggerGraceMs`，视为 sleep/restart/misfire，跳过本次触发。
4. 跳过后把 `nextRunAt` 推进到 `now` 之后的下一次。
5. 不创建 catch-up run。

默认值：

```ts
const DEFAULT_TRIGGER_GRACE_MS = 30_000;
```

`triggerGraceMs` 是 daemon 内部策略，不在第一版 API 暴露。

### 4.4 所有 run 必须通过 RunManager 创建

Scheduler 不直接写 `runs` 表，不直接启动 Codex 进程。它只调用 `RunManager.startRun()`。

需要扩展 `CreateRunInput`：

```ts
type CreateRunInput = {
  prompt: string;
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  threadId?: string;
  resumeMode?: "auto" | "new_thread" | "resume_thread";
  codexThreadId?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  createdBy?: "api" | "schedule";
  sourceId?: string;
  timeoutMs?: number;
};
```

默认值保持兼容：

1. `createdBy` 默认为 `"api"`。
2. `sourceId` 默认为 `null`。
3. `timeoutMs` 默认为现有 RunManager 默认 timeout。

`insertInitialRun()` 写入 `created_by/source_id/timeout_ms`。`startCodexExec()` 使用：

```ts
input.timeoutMs ?? options.timeoutMs ?? EXEC_TIMEOUT_MS
```

普通 API run 不传 `timeoutMs`，行为保持不变。只有 schedule run 或未来显式扩展的 run 请求会设置 per-run timeout。

### 4.5 schedule run 不绑定 thread

R6 第一版 schedule run 全部是 independent run。这样可以避免定时任务和交互式 Chat thread 争用同一个 Codex session，也避免 thread archived、thread config immutable 和 resume capability 失败等复杂边界进入 R6。

后续如果需要 schedule 继续某个 thread，应作为单独里程碑设计。

## 5. 数据模型

新增 `schedules` 表：

```text
schedules
  id
  name
  cron
  timezone
  enabled

  prompt
  prompt_hash
  prompt_preview_redacted
  profile
  cwd
  canonical_cwd
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
  pending_trigger

  created_at
  updated_at
  deleted_at
```

字段说明：

| 字段 | 说明 |
|---|---|
| `prompt` | schedule 触发 run 所需完整 prompt。第一版明文保存在本地 SQLite。 |
| `prompt_hash` | prompt hash，用于比对和审计。 |
| `prompt_preview_redacted` | 脱敏后的短预览，用于列表展示。 |
| `timezone` | 创建或更新时固化的 IANA timezone。 |
| `next_run_at` | 下一次计划触发时间，ISO UTC 字符串。 |
| `last_run_at` | 最近一次成功创建 run 的时间。 |
| `last_run_id` | 最近一次由该 schedule 创建的 run id。 |
| `last_status` | 最近一次 schedule 触发结果，使用 `succeeded/failed/canceled/skipped/queued`。 |
| `pending_trigger` | `queue` 并发策略下合并出的待执行触发，取值 `0/1`。 |
| `deleted_at` | 软删除标记。 |

虽然原 contract 表中只列了 `prompt_hash/prompt_preview_redacted`，但 schedule 真正触发 run 必须保存完整 prompt。R6 第一版使用 `prompt TEXT NOT NULL`，不在本阶段引入加密或外部 secret store。

新增 `schedule_operations` 表：

```text
schedule_operations
  id
  operation
  schedule_id
  status
  run_id
  error_code
  error_message
  created_at
```

`schedule_operations` 只做审计，不是 schedule 真相源。

操作类型：

```ts
type ScheduleOperationType =
  | "create"
  | "update"
  | "delete"
  | "run_now"
  | "timer_trigger"
  | "skip_misfire"
  | "skip_concurrency"
  | "queue_trigger"
  | "run_queued";
```

状态：

```ts
type ScheduleOperationStatus = "succeeded" | "failed" | "skipped" | "queued";
```

索引：

```text
idx_schedules_enabled_next_run_at(enabled, next_run_at)
idx_schedules_deleted_at(deleted_at)
idx_schedule_operations_created_at(created_at DESC, id DESC)
idx_schedule_operations_schedule_id(schedule_id, created_at DESC)
idx_runs_schedule_source(created_by, source_id, public_status)
```

## 6. API 设计

### 6.1 路由

```http
GET    /schedules
POST   /schedules
GET    /schedules/:id
PATCH  /schedules/:id
DELETE /schedules/:id
POST   /schedules/:id/run-now
GET    /schedules/:id/operations
```

`GET /schedules/:id/operations` 用于审计和后续 UI 诊断。它属于 R6 第一版范围。

### 6.2 创建请求

```ts
type CreateScheduleRequest = {
  name: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;

  prompt: string;
  profile?: string;
  cwd?: string;
  model?: string;
  reasoning?: "default" | "low" | "medium" | "high" | "xhigh";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  timeoutMs?: number;

  concurrencyPolicy?: "skip" | "queue" | "parallel";
  misfirePolicy?: "skip";
};
```

默认值：

| 字段 | 默认值 |
|---|---|
| `timezone` | 系统当前 IANA timezone；取不到则 `UTC` |
| `enabled` | `true` |
| `profile` | `default` |
| `cwd` | daemon 当前 cwd |
| `sandbox` | `workspace-write` |
| `concurrencyPolicy` | `skip` |
| `misfirePolicy` | `skip` |
| `timeoutMs` | `null`，使用 RunManager 默认 timeout |

校验规则：

1. `name` 必须为非空字符串，最长 120。
2. `prompt` 必须为非空字符串。
3. `cron` 必须可由 cron adapter 计算下一次触发。
4. `timezone` 必须是可用 IANA timezone。
5. `cwd` 必须存在并可解析 realpath。
6. `profile` 必须通过 `ProfileManager.validateProfileForRun()`。
7. `timeoutMs` 如果设置，必须在 `1_000` 到 `86_400_000` 之间。
8. `misfirePolicy` 只允许 `skip`；传 `run_once` 返回 `SCHEDULE_INVALID`。

### 6.3 响应

```ts
type ScheduleResponse = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;

  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;

  concurrencyPolicy: "skip" | "queue" | "parallel";
  misfirePolicy: "skip";
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: PublicRunStatus | "skipped" | "queued" | null;
  pendingTrigger: boolean;

  createdAt: string;
  updatedAt: string;
};
```

列表和写入响应不返回完整 prompt。单项详情返回完整 prompt，供后续 UI 编辑使用。

1. `GET /schedules` 不返回完整 prompt。
2. `GET /schedules/:id` 返回完整 prompt。
3. `POST/PATCH` 返回不含完整 prompt 的 `ScheduleResponse`。

```ts
type ScheduleDetailResponse = ScheduleResponse & {
  prompt: string;
};
```

### 6.4 更新

`PATCH /schedules/:id` 支持修改：

```ts
name
cron
timezone
enabled
prompt
profile
cwd
model
reasoning
sandbox
timeoutMs
concurrencyPolicy
misfirePolicy
```

规则：

1. 修改 `cron/timezone/enabled` 后重新计算 `nextRunAt`。
2. 修改 `prompt` 后重新生成 hash 和 redacted preview。
3. 修改 `cwd` 后重新保存 `canonicalCwd`。
4. 修改 `profile` 时重新校验 profile。
5. 更新不影响已创建 run。
6. 更新后调用 `SchedulerService.refreshTimer()`。

### 6.5 删除

`DELETE /schedules/:id` 使用软删除：

1. 设置 `deleted_at`。
2. 清理该 schedule 的 `pending_trigger`。
3. 停止未来 timer。
4. 不删除历史 run。
5. `GET /schedules` 默认不返回 deleted schedule。

### 6.6 run-now

`POST /schedules/:id/run-now` 使用 schedule 当前配置立即创建 run。

规则：

1. 不改变 `nextRunAt`。
2. 遵守 schedule 的 `concurrencyPolicy`。
3. 不支持 concurrency override。
4. 返回 `{ run, schedule }`。
5. 如果因 `skip` 并发策略跳过，返回 `202` 和 `{ run: null, schedule, skipped: true }`。
6. 如果因 `queue` 并发策略合并成 pending trigger，返回 `202` 和 `{ run: null, schedule, queued: true }`。

## 7. 模块边界

新增：

```text
apps/daemon/src/api/routes.schedules.ts
apps/daemon/src/scheduler/cron.ts
apps/daemon/src/scheduler/repository.ts
apps/daemon/src/scheduler/service.ts
apps/daemon/src/scheduler/validator.ts
```

现有文件扩展：

```text
apps/daemon/src/scheduler/types.ts
apps/daemon/src/scheduler/scheduler.ts
apps/daemon/src/runs/types.ts
apps/daemon/src/runs/manager.ts
apps/daemon/src/storage/migrations.ts
apps/daemon/src/storage/repositories.ts
apps/daemon/src/api/server.ts
packages/protocol/src/api.ts
packages/protocol/src/errors.ts
```

职责：

| 模块 | 职责 |
|---|---|
| `routes.schedules.ts` | HTTP 请求解析、错误码映射、响应组装 |
| `validator.ts` | 创建/更新请求校验、默认值、profile/cwd/timeout 检查 |
| `cron.ts` | 封装 cron 解析和下一次触发计算 |
| `repository.ts` | schedule CRUD、due 查询、operation log |
| `service.ts` | timer loop、run-now、due 处理、misfire 和 concurrency |
| `runs/manager.ts` | 接收 `createdBy/sourceId/timeoutMs` 并统一创建 run |
| `storage/repositories.ts` | 为 RunRepository 增加 `hasActiveRunForSource()` |
| `server.ts` | 创建 `SchedulerService`，注册 routes，onClose 停止 timer |

## 8. 调度引擎

### 8.1 启动

```text
buildServer
  -> createScheduleRepository(db)
  -> createSchedulerService({ repository, runManager, profileValidator, clock })
  -> scheduler.start()
  -> registerScheduleRoutes(server, { scheduler })
  -> onClose scheduler.stop()
```

### 8.2 单 timer 模型

R6 第一版维护一个最近触发 timer，而不是每个 schedule 一个 timer。

```text
refreshTimer()
  1. 清理当前 timer
  2. 查询 enabled、not deleted、next_run_at 最早的 schedule
  3. 如果不存在，返回
  4. delay = clamp(nextRunAt - now, 0, MAX_TIMER_DELAY_MS)
  5. setTimeout(processDueSchedules, delay)
```

`MAX_TIMER_DELAY_MS` 固定为 `2_147_000_000`，避免 Node timer 上限问题。超过上限时使用分段 timer。

### 8.3 due 处理

```text
processDueSchedules(now)
  1. 查询 next_run_at <= now 的 enabled schedules
  2. 逐个 processDueSchedule(schedule, now)
  3. 处理 pending_trigger 的 queue schedules
  4. refreshTimer()
```

### 8.4 单个 schedule 处理

```text
processDueSchedule(schedule, now)
  1. 如果 now - schedule.nextRunAt > triggerGraceMs：
       skipMisfire(schedule, now)
       advanceNextRunAt(schedule, now)
       return
  2. handleTrigger(schedule, "timer", now)
  3. advanceNextRunAt(schedule, now)
```

`advanceNextRunAt` 必须把 `nextRunAt` 推进到 `now` 之后，而不是只加一次 cron interval。这样错过多次触发时不会循环补跑。

### 8.5 pending queue 检查

`queue` 策略产生的 `pending_trigger` 不能依赖下一次 cron 到点才被处理。否则当没有未来近期 timer 时，pending trigger 可能长期停留。

R6 使用第二个轻量 queue check timer：

```text
refreshQueueTimer()
  1. 如果不存在 pending_trigger = true 的 enabled schedule，清理 queue timer
  2. 如果存在，setTimeout(processPendingTriggers, QUEUE_CHECK_INTERVAL_MS)
```

默认：

```ts
const QUEUE_CHECK_INTERVAL_MS = 5_000;
```

`processPendingTriggers` 查询 pending schedules。如果同 schedule 已无 active run，则执行 `runQueuedTrigger(schedule)`；如果仍有 active run，保留 `pending_trigger = true` 并继续下一轮检查。

`create/update/delete/run-now/timer-trigger/stop` 后都必须刷新 main timer 和 queue timer。

## 9. concurrency 语义

并发判断基于 `runs` 表和 RunManager 当前非终态状态。repository 需要支持：

```ts
hasActiveRunForSource(createdBy: "schedule", sourceId: string): boolean;
```

active run 包括：

```text
queued
running
canceling
internal_status in created/queued/spawning/running/canceling
```

### 9.1 skip

```text
if active run exists:
  - 不创建 run
  - 记录 schedule_operations skip_concurrency
  - lastStatus = skipped
  - pendingTrigger = false
else:
  - 创建 run
```

### 9.2 queue

R6 第一版使用 coalesced queue。

```text
if active run exists:
  - pendingTrigger = true
  - 记录 schedule_operations queue_trigger
  - lastStatus = queued
else:
  - 创建 run
```

当 `processPendingTriggers` 发现 `pendingTrigger = true` 且没有 active run：

```text
runQueuedTrigger(schedule)
  - 创建一个 run
  - pendingTrigger = false
  - 记录 schedule_operations run_queued
```

多个重叠触发只合并为一个 pending trigger，避免无限积压。

### 9.3 parallel

不检查 active run，直接创建 run。

## 10. misfire 语义

R6 第一版只有 `skip`。

```text
if nextRunAt <= now and now - nextRunAt > triggerGraceMs:
  - 不创建 run
  - 记录 schedule_operations skip_misfire
  - lastStatus = skipped
  - nextRunAt = computeNextRunAt(cron, timezone, now)
```

`run_once` 被产品策略禁用。请求中出现 `run_once` 时返回：

```text
SCHEDULE_INVALID: run_once misfire is disabled for desktop-safe scheduler
```

## 11. 错误处理

新增协议错误码：

```ts
| "SCHEDULE_NOT_FOUND"
```

复用：

| 错误码 | HTTP | 场景 |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | 请求 body shape 不合法 |
| `SCHEDULE_INVALID` | 422 | cron、timezone、policy、timeout、cwd 或 schedule 配置无效 |
| `SCHEDULE_NOT_FOUND` | 404 | schedule 不存在或已删除 |
| `CODEX_PROFILE_NOT_FOUND` | 404 | profile 不存在 |
| `CODEX_PROFILE_INVALID` | 422 | profile 文件无效 |
| `CODEX_CONFIG_INVALID` | 422 | Codex config 无法解析 |
| `INTERNAL_ERROR` | 500 | 未预期内部错误 |

后台 timer 触发失败不能导致 daemon 崩溃。失败必须写入 `schedule_operations`，并尽可能更新 `lastStatus = failed`。

## 12. 测试策略

### 12.1 单元测试

`validator`：

1. 非法 cron 返回 `SCHEDULE_INVALID`。
2. 非法 timezone 返回 `SCHEDULE_INVALID`。
3. `run_once` 返回 `SCHEDULE_INVALID`。
4. timeout 超范围返回 `SCHEDULE_INVALID`。
5. 默认值正确。
6. cwd realpath 失败返回 `SCHEDULE_INVALID`。

`cron`：

1. 可计算下一次 `nextRunAt`。
2. timezone 固化：同一 cron 在不同时区 next 不同。
3. DST 切换日有确定断言。
4. 计算结果总是推进到 `from` 之后。

`repository`：

1. create/list/get/update/soft delete。
2. `due` 查询。
3. `pendingTrigger` 更新。
4. operation log newest first。
5. active run source 查询。

`service`：

1. start 后注册最近 timer。
2. create/update/delete 后 refresh timer。
3. run-now 创建 schedule run。
4. grace window 内 timer due 创建 run。
5. grace window 外 missed trigger 跳过。
6. `concurrency = skip` 时 active run 存在则跳过。
7. `concurrency = queue` 时 active run 存在则合并 pending trigger。
8. `concurrency = queue` 在 active run 结束后创建一个 queued run。
9. `concurrency = parallel` 允许多个 run。
10. stop 后不再触发。

### 12.2 集成测试

API：

1. create/list/get/patch/delete schedule。
2. run-now 返回 run 和 schedule。
3. run-now 遵守 concurrency policy。
4. profile 不存在时 create/update/run-now 返回 profile 错误。
5. cron/timezone/timeout 错误映射为 `SCHEDULE_INVALID`。

Run metadata：

1. schedule run 写入 `created_by = schedule`。
2. schedule run 写入 `source_id = scheduleId`。
3. schedule run 写入 `timeout_ms = schedule.timeoutMs`。
4. schedule run 的 cwd/profile/model/reasoning/sandbox 来自 schedule 快照。

Daemon lifecycle：

1. `buildServer` 启动 scheduler。
2. `onClose` 调用 `scheduler.stop()`。
3. 关闭后 timer 不再创建 run。

### 12.3 真实 Codex smoke

R6 第一版不要求真实模型网络成功。必须增加 gated smoke：

1. 使用 isolated data dir 和 workspace。
2. 创建一个可立即 `run-now` 的 schedule。
3. 验证 Runtime 创建 run 并进入 Codex 执行路径。
4. 如果 Codex auth 返回 401 或网络不可用，标记 `BLOCKED_ENV`，不影响 fake Codex R6 后端验收。

## 13. 覆盖报告更新

R6 完成后更新 `docs/superpowers/plans/2026-07-04-codex-native-runtime-completeness-test-plan.md`：

```text
R6 Scheduler: PASS
```

说明必须包含：

1. schedule CRUD：`PASS`
2. run-now：`PASS`
3. cron/timezone：`PASS`
4. sleep/wake missed trigger skip：`PASS`
5. concurrency skip/queue/parallel：`PASS`
6. timeout：`PASS`
7. `run_once` misfire：`DISABLED_BY_DESKTOP_SAFETY`
8. thread-bound schedule：`OUT_OF_SCOPE_R6`
9. OS-level background service：`OUT_OF_SCOPE_R6`

不要把 `run_once` 被禁用描述为缺实现。它是 R6 第一版的桌面安全策略。

## 14. 实施顺序

1. Protocol types 和错误码。
2. `cron.ts` + validator。
3. migrations + repository + operation log。
4. RunManager 扩展 `createdBy/sourceId/timeoutMs`。
5. SchedulerService run-now。
6. API routes。
7. Timer loop、due processing、sleep/wake skip。
8. concurrency policies。
9. integration tests 和 coverage report。
10. gated real Codex smoke。

每个步骤都应先写 failing tests，再实现，再验证并单独提交。

## 15. 验收口径

R6 可验收的条件：

1. API 能创建、读取、更新、删除 schedule。
2. `run-now` 能创建 ordinary run。
3. timer 到点能创建 ordinary run。
4. schedule run 可在 runs 表中追踪来源。
5. schedule run timeout 生效。
6. cron/timezone/DST 行为有自动化测试。
7. sleep/wake 或 daemon 离线造成的 missed trigger 被跳过。
8. `skip/queue/parallel` 并发策略有自动化测试。
9. daemon stop 后不会继续触发。
10. 覆盖报告明确 R6 的通过项和不进入范围的项。
