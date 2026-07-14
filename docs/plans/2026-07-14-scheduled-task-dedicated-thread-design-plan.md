# Clawee 定时任务专属会话重构执行计划

> **文档用途：** 本文档将
> `docs/specs/2026-07-14-scheduled-task-dedicated-thread-design.md`
> 转换为可连续执行、可验证、可提交、可回滚的工程批次。
>
> **执行铁律：** 所有开发必须在当前分支、当前工作区完成，不得创建或使用
> Git worktree。每个批次先写失败测试，再完成最小实现；每批独立提交，不夹带无关改动。

| 项目 | 内容 |
|---|---|
| 文档状态 | `READY` |
| 总体实施状态 | `IN_PROGRESS` |
| 制定日期 | 2026-07-14 |
| 来源规格 | `docs/specs/2026-07-14-scheduled-task-dedicated-thread-design.md` |
| 当前分支 | `codex-native-runtime-kernel` |
| 当前基线提交 | `fae1ecc docs: add scheduled task dedicated thread specification` |
| 当前 Codex CLI | `codex-cli 0.144.1` |
| 实施顺序 | `P0 -> P1 -> P2 -> 最终统一验收` |
| 计划规模 | 25 个独立批次 |
| 当前批次 | `P1-B3`，等待开始 |

基线提交只用于说明计划制定时的代码状态。执行者不得为了匹配该提交而回退、
重置或覆盖当前工作区已有改动。

---

## 1. 目标

将定时任务从“每次触发创建独立 Run 和独立 Codex session”的模型，重构为
“一个 Schedule 对应一个长期 Clawee Thread，所有触发、审批、结果和后续对话都进入
同一 Thread”的完整产品闭环。

完成后必须同时满足：

1. 每条未删除 Schedule 有且只有一个 `threadId`。
2. 同一 Schedule 的所有新 Run 都使用同一 Clawee Thread。
3. 同一任务会话内的用户 Run、立即执行和定时触发严格串行。
4. Schedule 配置与任务 Thread 执行配置保持一致。
5. 手动创建和 Agent 自然语言创建都能产生任务专属会话。
6. 左侧“任务”、已安排页面、任务会话和通知使用同一份状态。
7. 通知进入正确的任务会话，并定位对应 Run 或审批。
8. 旧 Schedule 自动补齐绑定，旧孤立 Schedule session 继续隐藏。
9. Codex thread 可以恢复或轮换，但 Clawee `threadId` 始终稳定。
10. P0、P1、P2 自动化门禁、手动验收、升级检查和回滚演练全部通过。

## 2. 范围与非目标

### 2.1 本计划包含

- SQLite Schema、Protocol、Thread、Schedule、Run 和启动迁移。
- `ScheduleCoordinator` 跨 Schedule/Thread 原子协调层。
- 固定 Thread 触发、Thread 级 queue/skip 和旧数据修复。
- 左侧任务区域、已安排页面跳转、任务会话头部和状态同步。
- 短期能力令牌、内部 Schedule 路由和内置 Schedule MCP 工具。
- Agent 创建、更新、暂停、恢复、立即执行任务。
- 通知深链接、结果摘要和 Schedule Run 公开时间线输入。
- 审批体验、连续失败提示、Codex thread 轮换、后台通知和审计。
- Playwright 端到端测试、100 个任务性能门禁、发布和回滚文档。

### 2.2 本计划不包含

- 云端调度、跨设备同步、多人共享任务。
- 使用 Codex 官方调度替换 Clawee Scheduler。
- 自动批准高风险操作。
- 为提醒、总结、文稿建立不同执行器。
- 重新向普通用户暴露旧技术 TaskCenter。
- 与本规格无关的大规模 UI 重做或基础框架替换。

## 3. 当前基线

### 3.1 已有能力

- `RunManager` 已按 `threadId` 维护串行队列，并支持
  `hasActiveRunForThread()`、`interrupt_and_enqueue`、SSE、审批、取消和重启孤儿收敛。
- `RunManager` 已支持 Clawee Thread 到 Codex thread 的创建与恢复。
- Web 已有 RunRegistry、会话切换立即清空、历史懒加载和活动 Run 恢复。
- `HostNotification` 已有可选 `threadId`、`runId` 字段。
- Run events 已持久化，可从最后一条 `assistant_message` 派生通知摘要。
- `codex exec`、`codex exec resume`、`codex app-server` 支持逐进程
  `-c key=value` 注入，可为单次 Run 注入内置 MCP，不需要修改用户全局 Codex 配置。

### 3.2 计划制定时的未提交改动

计划制定时工作区有 14 个与 P0 基础相关的未提交文件，已开始但未完成：

- `apps/daemon/src/storage/migrations.ts`
- `packages/protocol/src/api.ts`
- `apps/daemon/src/threads/types.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/routes.threads.ts`
- `apps/daemon/src/scheduler/types.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/test/unit/cleanup-service.test.ts`
- `apps/daemon/test/unit/storage.test.ts`
- `apps/daemon/test/unit/workspace-files.test.ts`
- `apps/web/src/app/App.test.tsx`
- `apps/web/src/features/search/SearchView.test.tsx`

现有改动已经加入：

- `threads.purpose`
- `schedules.thread_id`
- 未删除 Schedule 的 `thread_id` 唯一部分索引
- 旧 `parallel -> queue` 数据迁移
- Protocol `ThreadPurpose`
- `ThreadResponse.purpose`
- 暂时可空的 `ScheduleResponse.threadId`

这些改动属于 `P0-B1` 的工作内容。执行 `P0-B1` 时必须逐项审阅并在其上继续，
不得覆盖、回退或把它们误判为已完成。

### 3.3 计划制定时的验证结果

| 命令或门禁 | 当前结果 |
|---|---|
| `pnpm --filter @clawee/protocol typecheck` | 通过 |
| daemon 四个相关专项测试，共 50 项 | 通过 |
| `pnpm --filter @clawee/daemon typecheck` | 通过 |
| `pnpm --filter @clawee/web typecheck` | 失败 |

当前唯一已知 Web 类型错误：

```text
apps/web/src/features/files/FileWorkspaceView.test.tsx:756
测试 Thread fixture 缺少必填 purpose
```

`P0-B1` 必须先修复该 fixture，并完成数据库和内部可空迁移模型。为了避免
Coordinator 尚未上线时出现“Protocol 声称必填、运行时仍可能为空”的红色中间提交，
`ScheduleResponse.threadId` 在 `P0-B3` 原子创建路径上线的同一批次收敛为对外必填
`string`。

## 4. 架构原则

### 4.1 Schedule 与 Thread 一对一

- 新 Schedule 创建成功前，Schedule 和 Thread 必须在同一数据库事务内完成绑定。
- 未删除 Schedule 的 `thread_id` 不可为空，也不可被普通更新替换。
- 一个 Thread 最多绑定一个未删除 Schedule。
- 删除 Schedule 时归档 Thread，但保留绑定和历史。

### 4.2 Schedule 配置是真相源

以下字段由 `ScheduleCoordinator` 同步到任务 Thread：

| Schedule 字段 | Thread 字段 |
|---|---|
| `name` | `title` |
| `cwd` | `cwd` |
| `canonicalCwd` | `canonicalCwd` |
| `profile` | `profile` |
| `model` | `model` |
| `reasoning` | `reasoning` |
| `sandbox` | `sandbox` |

时间、启停、Prompt、超时和并发策略只属于 Schedule。

### 4.3 只复用一套 Run 执行系统

- Scheduler 不新增自己的 Run 队列。
- 定时触发、立即执行和用户消息都调用同一个 `RunManager`。
- Schedule Run 只传 `threadId`、公开 `prompt`、内部 `executionPrompt`、
  `createdBy`、`sourceId` 和 `timeoutMs`。
- Run 的项目、Profile、模型、推理强度和 Sandbox 从 Thread 解析。

### 4.4 Clawee Thread 稳定，Codex thread 可替换

- Clawee `threadId` 是产品身份和路由身份。
- `codexThreadId` 是底层执行身份，可以因恢复失败或上下文过长而轮换。
- 不得因为 Codex thread 变化而创建第二个任务会话。

### 4.5 内置 Agent Tool 使用最小权限

- Agent 不直接写 SQLite，不使用公开 Daemon Bearer Token。
- 能力令牌必须绑定 `runId`、`threadId`、作用域和失效时间。
- 自动 Schedule Run 不注入 Schedule 修改工具。
- 令牌不得进入 Prompt、事件、日志、诊断导出或通知。

### 4.6 Web 不从标题或关键词推断任务

- 任务会话只依据 `ThreadResponse.purpose` 判断。
- 删除 `"创建已安排任务"` 标题判断和本地提醒正则分支。
- “任务”区域只展示 `schedule_task`，不展示底层 Run 列表。

## 5. 状态定义与执行协议

### 5.1 批次状态

| 状态 | 含义 |
|---|---|
| `NOT_STARTED` | 尚未开始 |
| `IN_PROGRESS` | 已有实现或测试改动，但未通过全部批次门禁 |
| `PASS` | 实现、专项测试和受影响包检查通过；允许延后的真实环境验收已登记到 P2-B7 |
| `PARTIAL` | 部分完成，有明确剩余项，不得进入依赖批次 |
| `BLOCKED_ENV` | 代码已完成，但真实 Codex、浏览器或 Host 环境阻塞 |
| `FAILED` | 实现或验证失败，需要继续修复或回滚本批 |

只有 `PASS` 批次才允许其依赖批次开始。为满足 P0、P1、P2 连续实施要求，
真实 Codex、真实 Desktop Host 和最终浏览器人工检查可以按批次要求登记到 P2-B7，
不阻塞后续代码批次；但不得把未执行的真实验收写成“通过”。`BLOCKED_ENV` 用于连
自动化替代验证也无法完成，或最终统一验收仍被环境阻塞的情况。

### 5.2 每批开始前

1. 阅读本文的状态总览、目标批次和最近实施日志。
2. 运行 `git status --short --branch` 和 `git log -5 --oneline`。
3. 确认已有未提交改动的来源和归属，不回退用户改动。
4. 将当前批次改为 `IN_PROGRESS`，记录开始时间。
5. 只实现当前批次；发现规格偏差时先更新规格和计划。

### 5.3 每批实施中

1. 先增加或调整失败测试，确认测试能暴露目标缺口。
2. 完成满足测试的最小实现，避免顺手重构。
3. 运行批次专项测试。
4. 运行受影响包的 `typecheck` 和 `build`。
5. 检查 `git diff --check`。
6. 在批次执行结果中记录命令、结果和未覆盖风险；允许延后的真实环境验收必须登记到
   P2-B7。

### 5.4 每批完成后

1. 批次验收项全部满足后改为 `PASS`。
2. 使用建议提交信息独立提交。
3. 运行 `git status --short`，确认没有本批遗留。
4. 更新实施日志，记录提交 SHA、验证结果和下一批。
5. 阶段内按本文顺序继续，不等待中间人工验收。

## 6. 全局验证门禁

### 6.1 基础门禁

```bash
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon test
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
pnpm --filter @clawee/web test
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
pnpm build
git diff --check
```

### 6.2 真实 Codex smoke

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

必须记录实际 Codex 版本、执行模式、是否创建或恢复同一 Codex thread。环境阻塞时标记
`BLOCKED_ENV`，不得写成通过。

### 6.3 数据库发布检查

```sql
SELECT COUNT(*)
FROM schedules
WHERE deleted_at IS NULL AND thread_id IS NULL;
```

预期结果：`0`。

```sql
SELECT thread_id, COUNT(*)
FROM schedules
WHERE deleted_at IS NULL
GROUP BY thread_id
HAVING COUNT(*) > 1;
```

预期结果：空结果集。

### 6.4 浏览器视口

- 桌面：`1440x900`
- 移动：`390x844`

浏览器验收必须检查无横向溢出、无内容遮挡、无残留旧会话内容、控制台无新增错误、
网络无持续 4xx/5xx 或无限重试。

## 7. 依赖图

```text
P0-B1 Schema/Protocol 收敛
  -> P0-B2 Thread purpose 与保护
  -> P0-B3 Coordinator 原子创建
  -> P0-B4 Coordinator 更新/暂停/删除
  -> P0-B5 固定 Thread 触发与并发
  -> P0-B6 启动修复与绑定恢复
  -> P0-B7 legacy session 分类
  -> P0-B8 P0 集成门禁
      |
      v
P1-B1 前端模型
  -> P1-B2 左侧任务区域
  -> P1-B3 已安排跳转
  -> P1-B4 任务会话头部
  -> P1-B5 能力令牌与内部路由
  -> P1-B6 Schedule MCP 与逐 Run 注入
  -> P1-B7 Agent 创建/管理协调
  -> P1-B8 替换正则创建流程
  -> P1-B9 通知深链接与摘要
  -> P1-B10 公开时间线与 P1 门禁
      |
      v
P2-B1 审批和连续失败体验
  -> P2-B2 长期上下文轮换
  -> P2-B3 后台 Host 通知
  -> P2-B4 actor 审计与诊断
  -> P2-B5 Playwright E2E
  -> P2-B6 100 任务性能门禁
  -> P2-B7 发布、回滚和最终验收
```

虽然部分批次在代码上可以并行，实际实施仍按上述顺序连续进行，以减少当前脏工作区、
跨层类型变化和迁移逻辑同时扩散的风险。

## 8. 状态总览

| 批次 | 目标 | 状态 |
|---|---|---|
| P0-B1 | 收敛 Schema、Protocol 和当前 WIP | `PASS` |
| P0-B2 | Thread purpose、scheduleId 和配置保护 | `PASS` |
| P0-B3 | ScheduleCoordinator 手动创建事务 | `PASS` |
| P0-B4 | 原子更新、暂停恢复和删除 | `PASS` |
| P0-B5 | 固定 Thread 触发与 Thread 级并发 | `PASS` |
| P0-B6 | 旧绑定修复和启动顺序 | `PASS` |
| P0-B7 | legacy Schedule session 分类 | `PASS` |
| P0-B8 | P0 集成、重启和真实 smoke | `PASS` |
| P1-B1 | 前端模型、服务和任务摘要模型 | `PASS` |
| P1-B2 | 左侧“任务”区域 | `PASS` |
| P1-B3 | “已安排”与任务会话互跳 | `NOT_STARTED` |
| P1-B4 | 任务会话头部 | `NOT_STARTED` |
| P1-B5 | 能力令牌和内部路由 | `NOT_STARTED` |
| P1-B6 | Schedule MCP 工具和逐 Run 注入 | `NOT_STARTED` |
| P1-B7 | Agent 创建和管理任务协调 | `NOT_STARTED` |
| P1-B8 | 删除正则创建流程 | `NOT_STARTED` |
| P1-B9 | 通知深链接和结果摘要 | `NOT_STARTED` |
| P1-B10 | Schedule Run 公开时间线和 P1 门禁 | `NOT_STARTED` |
| P2-B1 | 等待审批和连续失败体验 | `NOT_STARTED` |
| P2-B2 | Codex thread 轮换和摘要恢复 | `NOT_STARTED` |
| P2-B3 | 后台 Host 通知 | `NOT_STARTED` |
| P2-B4 | actor 审计和诊断事件 | `NOT_STARTED` |
| P2-B5 | Playwright 端到端测试 | `NOT_STARTED` |
| P2-B6 | 100 个任务性能门禁 | `NOT_STARTED` |
| P2-B7 | 发布、回滚和最终验收 | `NOT_STARTED` |

---

## 9. P0：专属会话执行闭环

### P0-B1：收敛 Schema、Protocol 和当前 WIP

**状态：** `PASS`

**依赖：** 无。

**目标：** 完成当前 14 个未提交文件对应的基础迁移和内部类型闭环，使旧数据库、
新数据库、daemon 和 Web fixture 都接受 `ThreadPurpose`，并为 P0-B3 的强绑定响应准备
可空迁移模型。

**主要文件：**

- `apps/daemon/src/storage/migrations.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/types.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/threads/types.ts`
- `apps/daemon/src/api/routes.threads.ts`
- `packages/protocol/src/api.ts`
- `apps/daemon/test/unit/storage.test.ts`
- `apps/daemon/test/unit/scheduler-repository.test.ts`
- `apps/daemon/test/unit/thread-manager.test.ts`
- `apps/daemon/test/unit/protocol-shape.test.ts`
- 当前受 `ThreadResponse` 影响的 Web 和 daemon fixture

**测试先行：**

1. 增加旧数据库升级测试：已有 schedules/threads 表能无损增加字段。
2. 增加默认值测试：旧 Thread 的 `purpose='conversation'`。
3. 增加数据迁移测试：旧 `parallel` 全部转换为 `queue`。
4. 增加唯一索引测试：两个未删除 Schedule 不能绑定同一 Thread，已删除记录不阻塞新绑定。
5. 增加 Protocol shape 测试：`ThreadResponse.purpose` 为必填；
   `ScheduleResponse.threadId` 在本批仍保留迁移期可空形状。
6. 修复 `FileWorkspaceView.test.tsx` 等全部缺少 `purpose` 的 fixture。

**实现步骤：**

1. 保留 `ScheduleRecord.threadId` 在迁移修复前的内部可空状态。
2. 新增 `BoundScheduleRecord` 或等价内部类型，为 P0-B3 的必填响应准备类型边界。
3. 本批不使用空字符串、Schedule ID 或非空断言伪造绑定。
4. `CreateScheduleRequest` 不增加公开 `threadId` 输入。
5. 检查当前 14 个文件的差异，只补齐本批缺口，不重写用户已有实现。

**专项验证：**

```bash
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon test -- \
  test/unit/protocol-shape.test.ts \
  test/unit/storage.test.ts \
  test/unit/scheduler-repository.test.ts \
  test/unit/thread-manager.test.ts
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/web typecheck
git diff --check
```

**验收标准：**

- 旧数据库和新数据库迁移测试通过。
- 内部明确区分未绑定迁移记录和已绑定 Schedule。
- `ThreadResponse.purpose` 对外为必填。
- Web 不再有缺少 `purpose` 的类型错误。
- 未删除 Schedule 的唯一绑定约束生效。

**执行结果（2026-07-14）：**

- `ScheduleRecord.threadId` 已收敛为始终存在的 `string | null`，未绑定迁移记录使用
  `null`，不伪造绑定；正式 `BoundScheduleRecord` 仍按计划在 P0-B3 引入。
- 新旧数据库均包含 `threads.purpose`、`schedules.thread_id` 和唯一部分索引。
- 旧 `parallel` Schedule 迁移为 `queue`。
- Schedule Repository 已覆盖空绑定、保存绑定和更新绑定。
- 所有受影响 Thread fixture 已补齐 `purpose='conversation'`。
- `pnpm --filter @clawee/protocol typecheck`：通过。
- `pnpm --filter @clawee/daemon typecheck`：通过。
- `pnpm --filter @clawee/web typecheck`：通过。
- daemon 受影响测试：6 个文件、128 项通过。
- Web 受影响测试：3 个文件、86 项通过。
- daemon 全量测试：557 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Web 全量测试：479 项通过。
- `pnpm build`：通过；Vite 仅保留既有大 chunk 警告。
- `git diff --check`：通过。

**回滚边界：** 仅回滚本批类型、迁移和 fixture；已执行数据库只增列和增索引，不做破坏性
降级，不删除新增字段。

**建议提交：**

```text
feat(runtime): 建立 Schedule 与 Thread 绑定基础模型
```

### P0-B2：Thread purpose、scheduleId 和配置保护

**状态：** `PASS`

**依赖：** `P0-B1`

**目标：** 让 ThreadManager 正式支持任务草稿和任务会话，并禁止公开 Thread API
绕过 ScheduleCoordinator 修改或归档任务会话。

**主要文件：**

- `packages/protocol/src/api.ts`
- `packages/protocol/src/errors.ts`
- `apps/daemon/src/threads/types.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/routes.threads.ts`
- `apps/daemon/test/unit/thread-manager.test.ts`
- `apps/daemon/test/integration/api.test.ts`

**测试先行：**

1. 默认创建 Thread 得到 `conversation`。
2. 内部创建可指定 `schedule_draft`、`schedule_task`。
3. 公开 `POST /threads` 只允许 `conversation` 或 `schedule_draft`，拒绝直接创建
   `schedule_task`。
4. 绑定后的 Thread 响应包含正确 `scheduleId`。
5. 普通 `PATCH /threads/:id` 和归档接口对 `schedule_task` 返回 409。
6. 内部 `updateScheduleThread()`、`setPurpose()` 和 `archiveScheduleThread()` 不受公开保护影响。

**实现步骤：**

1. 扩展 `CreateRuntimeThreadInput` 和内部 ThreadManager 接口。
2. 在 Repository 增加整组执行配置更新、purpose 更新和按 `threadId` 查询活动 Schedule。
3. ThreadManager 的 get/list 响应携带活动绑定的 `scheduleId`。
4. 公开路由增加 `THREAD_MANAGED_BY_SCHEDULE` 或规格约定的等价错误。
5. 普通 Thread 的现有更新和归档行为保持不变。

**专项验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/thread-manager.test.ts \
  test/integration/api.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：**

- 任务 Thread 可被稳定识别，不依赖标题。
- `scheduleId` 由数据库绑定关系返回。
- 普通 Thread API 无法破坏 Schedule Thread 配置或生命周期。

**执行结果（2026-07-14）：**

- `CreateThreadRequest` 对外只允许 `conversation` 和 `schedule_draft`，内部
  `CreateRuntimeThreadInput` 可显式创建 `schedule_task`。
- Thread Repository 通过活动 Schedule 的 `LEFT JOIN` 返回 `scheduleId`，Thread get/list
  无需额外逐条查询。
- ThreadManager 已增加 `updateScheduleThread()`、`setPurpose()` 和
  `archiveScheduleThread()` 内部接口。
- 普通 Thread 更新和归档对 `schedule_task` 抛出 `THREAD_MANAGED_BY_SCHEDULE`，公开路由
  返回 409；普通会话行为保持不变。
- P0-B2 专项测试：4 个文件、145 项通过。
- daemon 全量测试：564 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Web 全量测试：479 项通过。
- Protocol、daemon、Web typecheck 均通过。
- daemon build 和 `pnpm build` 均通过；Vite 仅保留既有大 chunk 警告。
- `git diff --check`：通过。

**回滚边界：** 仅回滚 Thread 内部接口、路由保护和查询装饰，不回滚 P0-B1 Schema。

**建议提交：**

```text
feat(threads): 支持任务会话类型和绑定保护
```

### P0-B3：ScheduleCoordinator 手动创建事务

**状态：** `PASS`

**依赖：** `P0-B2`

**目标：** 新增 `ScheduleCoordinator`，让公开手动创建在一个 SQLite transaction 中
创建 Schedule 和 `schedule_task` Thread。

**主要文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/test/unit/protocol-shape.test.ts`
- 新增 `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/scheduler/types.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/api/routes.schedules.ts`
- `apps/daemon/src/api/server.ts`
- 新增 `apps/daemon/test/unit/scheduler-coordinator.test.ts`
- `apps/daemon/test/integration/api.test.ts`

**测试先行：**

1. `createManual()` 同时创建 Schedule 和 `schedule_task` Thread。
2. Thread 标题、cwd、canonical cwd、Profile、模型、推理强度和 Sandbox 与 Schedule 一致。
3. 返回的 Schedule `threadId` 必填。
4. Thread 写入失败时不留下 Schedule。
5. Schedule 写入失败时不留下 Thread。
6. 创建响应只有在事务提交后返回 201。
7. Protocol 编译测试证明 `ScheduleResponse.threadId` 为必填 `string`。

**实现步骤：**

1. 将 Schedule CRUD 与计时触发职责分开：Coordinator 负责创建，SchedulerService 保留计时。
2. `ScheduleCoordinator` 持有同一数据库连接、ScheduleRepository 和 ThreadManager。
3. 使用 `better-sqlite3` transaction 包裹两张表写入。
4. 手动创建只创建 `workspaceMode='external'` 的任务 Thread。
5. `registerScheduleRoutes()` 改为分别依赖 Coordinator 和 Scheduler 的只读/触发接口。
6. 将 `ScheduleResponse.threadId` 从迁移期可空形状收敛为必填 `string`。
7. `toScheduleResponse()` 只接受已绑定记录；未绑定记录返回明确绑定错误。
8. 保持当前 API URL 和请求形状兼容。

**专项验证：**

```bash
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon test -- \
  test/unit/protocol-shape.test.ts \
  test/unit/scheduler-coordinator.test.ts \
  test/integration/api.test.ts
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
```

**验收标准：**

- 创建 Schedule 后数据库不存在半成品。
- 新 Schedule 的 Thread 配置完整且 purpose 正确。
- API 返回 `threadId`，现有客户端字段保持兼容。

**执行结果（2026-07-14）：**

- 新增 `ScheduleCoordinator.createManual()`，在同一个 `better-sqlite3` transaction 中
  创建 `schedule_task` Thread、绑定 Schedule 和 `create` 操作记录。
- Schedule 写入失败会回滚已创建 Thread；Thread 创建失败不会留下 Schedule 或操作记录。
- Scheduler 刷新回调只在事务提交后执行。
- SchedulerService 已移除创建职责，公开 `POST /schedules` 改由 Coordinator 处理。
- 新 Schedule 的 Thread 标题、cwd、canonical cwd、Profile、模型、推理强度和 Sandbox
  与 Schedule 一致，且 `workspaceMode='external'`。
- `ScheduleResponse.threadId` 已收敛为必填 `string`，新增 `BoundScheduleRecord`；
  未绑定迁移记录对外转换时抛出明确 `INTERNAL_ERROR`，不使用非空断言伪造绑定。
- P0-B3 专项测试：5 个文件、161 项通过。
- daemon 全量测试：569 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Web 全量测试：479 项通过。
- Protocol、daemon、Web typecheck 均通过。
- `pnpm build` 和 `git diff --check` 均通过；Vite 仅保留既有大 chunk 警告。

**回滚边界：** 回滚 Coordinator 和路由接线即可恢复旧创建路径；不删除已创建 Thread，
不执行反向数据清理。

**建议提交：**

```text
feat(scheduler): 原子创建任务及专属会话
```

### P0-B4：原子更新、暂停恢复和删除

**状态：** `PASS`

**依赖：** `P0-B3`

**目标：** 所有 Schedule 配置变更通过 Coordinator 同步任务 Thread；删除任务时归档
Thread，并对活动 Run 给出稳定冲突错误。

**主要文件：**

- `packages/protocol/src/errors.ts`
- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/api/routes.schedules.ts`
- `apps/daemon/test/unit/scheduler-coordinator.test.ts`
- `apps/daemon/test/integration/api.test.ts`

**测试先行：**

1. 修改 name 同步 Thread title。
2. 修改 cwd/Profile/model/reasoning/sandbox 在同一事务同步 Thread。
3. 任一侧更新失败时两侧都保持原值。
4. `enabled=false/true` 实现暂停和恢复，不归档 Thread。
5. 删除无活动 Run 的 Schedule 后 Thread 归档，Schedule 保留软删除和绑定。
6. 活动 Run 时，执行配置修改和删除返回 `SCHEDULE_HAS_ACTIVE_RUN`。
7. Thread 缺失或异常归档分别返回
   `SCHEDULE_THREAD_MISSING`、`SCHEDULE_THREAD_ARCHIVED`。

**实现步骤：**

1. Coordinator 统一处理 update/delete，SchedulerService 不再直接修改绑定配置。
2. 明确活动 Run 期间的更新规则：
   `enabled`、name、prompt、timing、timeout、concurrency 只影响后续执行，可以更新；
   cwd/Profile/model/reasoning/sandbox 和删除必须返回 409。
3. 删除前再次验证绑定和活动状态，事务内软删除 Schedule 并归档 Thread。
4. 所有冲突错误加入 Protocol 闭集和 HTTP 映射。
5. 更新成功后刷新 Scheduler timer。

**专项验证：**

```bash
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon test -- \
  test/unit/scheduler-coordinator.test.ts \
  test/integration/api.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：**

- Schedule 和 Thread 配置不会出现单边更新。
- 暂停不影响查看历史和继续进入会话。
- 删除保留历史，不允许活动 Run 被静默遗弃。
- 错误码与规格一致且有 API 测试。

**执行结果：**

- Schedule 更新、暂停恢复和删除已统一迁移到 Coordinator，并在同一 SQLite transaction
  内同步任务 Thread 配置或归档任务 Thread。
- 活动 Run 期间允许更新只影响后续执行的元数据；执行配置修改和删除稳定返回
  `SCHEDULE_HAS_ACTIVE_RUN`。Thread 缺失和异常归档分别返回对应稳定冲突错误。
- P0-B4 四文件专项测试：160 项通过。
- daemon 全量测试：580 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Web 全量测试：479 项通过。
- Protocol、daemon、Web typecheck、全仓 build 和 `git diff --check` 均通过；
  Vite 仅保留既有大 chunk 警告。

**回滚边界：** 回滚更新/删除协调逻辑，不反向恢复已经软删除的任务；如需恢复，使用显式
数据修复脚本而不是自动回滚。

**建议提交：**

```text
feat(scheduler): 原子同步任务配置和会话生命周期
```

### P0-B5：固定 Thread 触发与 Thread 级并发

**状态：** `PASS`

**依赖：** `P0-B4`

**目标：** Scheduler 的自动触发和立即执行始终复用 Schedule 的固定 Thread，并基于
Thread 的全部活动/排队 Run 执行 queue 或 skip。

**主要文件：**

- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/scheduler/validator.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/runs/types.ts`
- `apps/daemon/test/unit/scheduler-service.test.ts`
- `apps/daemon/test/unit/scheduler-validator.test.ts`
- `apps/daemon/test/integration/run-manager.test.ts`

**测试先行：**

1. `startRun()` 收到固定 `threadId`、公开 prompt、内部 executionPrompt、
   `createdBy='schedule'` 和 `sourceId=schedule.id`。
2. Scheduler 不再重复传 cwd/Profile/model/reasoning/sandbox。
3. 用户 Run 活动时，Schedule trigger 也被视为冲突。
4. `queue` 多次重叠触发只保留一个 `pending_trigger`。
5. Thread 空闲后只补执行一次并清空 pending。
6. `skip` 不创建 Run，并记录 `skip_concurrency`。
7. Validator 拒绝新建或更新为 `parallel`。
8. 用户 `interrupt_and_enqueue` 不清除 Schedule pending trigger。

**实现步骤：**

1. 将并发判断替换为 `runManager.hasActiveRunForThread(schedule.threadId)`。
2. 调用 `RunManager.startRun({ threadId, prompt, executionPrompt, ... })`。
3. 内部执行包装加入任务名称和本次触发时间，不暴露到公开 prompt。
4. 继续复用现有 Thread 队列；Scheduler 只维护 coalesced pending 标记。
5. pending 轮询或完成回调必须同时覆盖用户 Run、立即执行和定时 Run。
6. 对迁移后仍出现的 `parallel` 记录按 `queue` 防御性处理并记录诊断。

**专项验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/scheduler-service.test.ts \
  test/unit/scheduler-validator.test.ts \
  test/integration/run-manager.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：**

- 同一 Schedule 连续触发的 Clawee `threadId` 完全一致。
- 同一任务会话不存在两个并行写入 Run。
- queue 合并、skip 记录和用户打断行为符合规格。
- RunManager 仍是唯一执行和排队系统。

**执行结果：**

- Scheduler 自动触发、立即执行和 pending 补执行均只向 RunManager 传固定 `threadId`、
  公开 prompt、内部 executionPrompt 和 Schedule 来源元数据；执行配置统一从 Thread 解析。
- 并发判断已改为 Thread 级活动/排队 Run。`queue` 重复触发合并为一个 pending 标记，
  `skip` 不创建 Run，用户 `interrupt_and_enqueue` 期间 pending 保持不变。
- 新 Schedule 默认使用 `queue`，创建和更新均拒绝 `parallel`；异常遗留 `parallel`
  记录按 `queue` 执行并输出不含任务内容的诊断警告。
- P0-B5 六文件专项测试：197 项通过。
- daemon 全量测试：582 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Web 全量测试：479 项通过。
- Protocol、daemon、Web typecheck、全仓 build 和 `git diff --check` 均通过；
  Vite 仅保留既有大 chunk 警告。

**回滚边界：** 可回滚 Scheduler 触发逻辑；不得重新开放 `parallel`，不得删除已生成 Run。

**建议提交：**

```text
feat(scheduler): 使用固定任务会话串行触发
```

### P0-B6：旧绑定修复和启动顺序

**状态：** `PASS`

**依赖：** `P0-B5`

**目标：** 在 Scheduler 启动前幂等修复旧 Schedule 的 Thread 绑定，单条失败不阻塞其他
任务，并确保重启不创建重复 Thread。

**主要文件：**

- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/types.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/src/startup.ts`
- 新增 `apps/daemon/test/unit/scheduler-binding-repair.test.ts`
- `apps/daemon/test/unit/startup.test.ts`
- `apps/daemon/test/integration/api.test.ts`

**测试先行：**

1. 无 `thread_id` 的活动 Schedule 每条创建一个 `schedule_task` Thread。
2. 重复调用 `ensureBindings()` 不创建第二个 Thread。
3. Schedule 指向不存在 Thread 时尝试一次修复并替换绑定。
4. 单条修复失败时禁用该 Schedule，记录 `binding_repair_failed`，继续修复其他记录。
5. 成功记录 `binding_repair`。
6. Scheduler 的 `start()` 严格发生在全部绑定修复和 session 分类之后。
7. 依赖注入 fake scheduler/coordinator 的既有服务器测试继续可用。

**实现步骤：**

1. 每条 Schedule 使用独立 transaction，避免一条失败回滚全部修复。
2. 扩展 `ScheduleOperationType`：
   `binding_repair`、`binding_repair_failed`。
3. 按 Schedule 配置创建 external Thread，并保留稳定 title 和 purpose。
4. 失败时写错误码、禁用 Schedule、保留原记录供诊断。
5. 调整 `buildServer()` 构建顺序：
   ThreadManager -> Coordinator -> ensureBindings -> session 分类 -> Scheduler -> API -> start。
6. 关闭顺序保持 Scheduler 先停、RunManager 再收敛。

**专项验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/scheduler-binding-repair.test.ts \
  test/unit/startup.test.ts \
  test/integration/api.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：**

- 活动旧 Schedule 启动后全部有唯一 Thread。
- 重启不重复建 Thread。
- 单条坏数据不会阻止 daemon 启动和其他任务修复。
- Scheduler 永远不会在修复前触发。

**执行结果：**

- `ensureBindings()` 已按活动 Schedule 逐条独立 transaction 修复空绑定、失效绑定和异常
  Thread；重复调用只统计 unchanged，不重复创建 Thread。
- 单条绑定写入失败会回滚同事务内新建的 Thread，再禁用 Schedule、清空 `nextRunAt`，
  记录 `binding_repair_failed` 和底层错误码，并继续处理其他记录。
- Server 支持注入 fake Coordinator/Scheduler；生产自动启动顺序已固定为
  `ensureBindings -> session 索引/分类 -> Scheduler 构造 -> API 注册 -> start`。
- 为避免在 P0-B7 前扩大既有误归档问题，启动前 session 同步暂不执行 legacy Schedule
  标记/归档；普通路由同步行为保持不变，下一批统一收窄 legacy 分类 SQL。
- P0-B6 四文件专项测试：133 项通过。
- daemon 全量测试：587 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Web 全量测试：479 项通过。
- Protocol、daemon、Web typecheck、全仓 build 和 `git diff --check` 均通过；
  Vite 仅保留既有大 chunk 警告。

**回滚边界：** 停止新版 Scheduler 后可以回滚应用代码；保留新增 Thread 和绑定，不执行
反向删除。

**建议提交：**

```text
feat(scheduler): 启动时修复旧任务会话绑定
```

### P0-B7：legacy Schedule session 分类

**状态：** `PASS`

**依赖：** `P0-B6`

**目标：** 只隐藏旧版没有 Clawee Thread 的孤立 Schedule Codex session，不再归档或跳过
新任务会话。

**主要文件：**

- `apps/daemon/src/codex/sessions/index-repository.ts`
- `apps/daemon/src/codex/sessions/indexer.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/unit/codex-session-indexer.test.ts`
- `apps/daemon/test/unit/codex-sessions-scanner.test.ts`
- `apps/daemon/test/integration/search-api.test.ts`

**测试先行：**

1. `created_by='schedule' AND runs.thread_id IS NULL` 的 session 标记为 legacy schedule。
2. 有 `runs.thread_id` 的 Schedule session 不标记为 legacy。
3. 新 `schedule_task` Thread 不被 `archiveThreadsCreatedBy('schedule')` 归档。
4. session 同步不会为已有任务 Thread 导入重复 Clawee Thread。
5. 新任务历史可索引、可搜索，旧孤立 session 不进入普通会话列表。

**实现步骤：**

1. 用精确 SQL 替换当前全量 `markScheduledSessions()` 条件。
2. 删除或收窄 `archiveThreadsCreatedBy('schedule')`，改为只处理 legacy 无 Thread 记录。
3. session 导入前先检查现有 `codexThreadId` 绑定，避免重复 Thread。
4. 保留旧 Run 和诊断数据，不伪造到新任务 Thread。

**专项验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/codex-session-indexer.test.ts \
  test/unit/codex-sessions-scanner.test.ts \
  test/integration/search-api.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：**

- 新任务会话保持 active，并可加载历史和参与搜索。
- 旧孤立 Schedule session 继续隐藏。
- session 同步不会创建重复任务会话。

**执行结果：**

- session 分类改为双向收敛：只有 `created_by='schedule' AND thread_id IS NULL` 的旧 Run
  对应 session 标记为 `schedule`；曾被旧逻辑误标、但已有绑定 Run 的 session 恢复为
  `user`。
- legacy Thread 归档只命中无 `thread_id` 的旧 Schedule Run，并显式排除
  `purpose='schedule_task'`，不再归档任务专属会话。
- session 同步在导入前检查现有 Codex thread 绑定；已有 `schedule_task` Thread 时保持
  Schedule 配置真相源，不更新标题、工作目录，也不创建重复 Thread。
- 索引、Thread 列表和搜索集成用例覆盖：新任务历史保持可见且可搜索，旧孤立 session
  不进入普通列表或搜索结果。
- P0-B7 四文件专项测试：126 项通过。
- daemon 全量测试：589 项通过，13 项真实 Codex smoke 按环境开关跳过。
- Protocol/daemon typecheck、daemon build 和 `git diff --check` 均通过。

**回滚边界：** 只回滚分类 SQL 和同步流程；不得批量恢复或归档 Thread，避免再次误伤。

**建议提交：**

```text
fix(sessions): 仅隐藏旧版孤立 Schedule 会话
```

### P0-B8：P0 集成、重启和真实 smoke

**状态：** `PASS`

**依赖：** `P0-B7`

**目标：** 用 API、fake Codex、数据库重启和真实 Codex smoke 证明后端闭环成立。

**主要文件：**

- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/integration/run-manager.test.ts`
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- 必要的 `apps/daemon/test/helpers/fake-codex.ts`
- 本计划的 P0 执行结果和实施日志

**测试先行与场景：**

1. 手动创建 Schedule 同时得到任务 Thread。
2. 连续两次 `run-now` 的 `threadId` 相同。
3. 第二次 Run 恢复同一 Codex thread，或按既有恢复策略正确重连。
4. 用户 Run 活动时 Schedule queue 只补执行一次。
5. 服务关闭重启后绑定、pending trigger 和任务 Thread 均不变。
6. 删除后 Thread 归档且历史仍可读取。
7. 旧数据库升级后 SQL 不变量查询通过。
8. 真实 Codex 至少完成两次同任务执行，并验证第二次具有前次上下文。

**验证：**

```bash
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon test
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
git diff --check
```

**验收标准：**

- P0 所有 daemon 单元和集成测试通过。
- 两次执行进入同一 Clawee Thread。
- 重启不改变绑定，不产生重复 Thread。
- SQL 不变量查询通过。
- fake Codex 集成必须通过；真实 smoke 未执行时记录实际阻塞和 P2-B7 重跑命令，
  不得写成通过，但不阻塞 P1 代码实施。

**执行结果：**

- API 集成覆盖 Schedule 创建、更新、连续两次 `run-now`、固定 Clawee/Codex thread、
  第二次 `codex exec resume`、删除后 Thread 归档，以及两个 Run 和历史路由继续可读。
- Scheduler 重启测试覆盖两个并发触发合并为一个持久化 pending trigger；新实例保持原
  Thread 绑定并只消费一次。
- 旧数据库修复后执行 SQL 不变量断言：活动 Schedule 不存在空 `thread_id`，也不存在
  重复 `thread_id`。
- 真实 Codex smoke 按生产启动路径收集能力矩阵；同一 Schedule 连续两次执行进入同一
  Clawee/Codex thread，第二次读取前次上下文并返回第二阶段 marker。
- P0-B8 专项测试 184 项通过，13 项真实 smoke 在未启用开关时按预期跳过。
- 真实 Codex smoke 13 项全部通过；daemon 全量测试 590 项通过，常规套件中的 13 项真实
  smoke 按环境开关跳过。
- Protocol/daemon typecheck、daemon build 和 `git diff --check` 均通过。

**回滚边界：** 本批主要是测试和缺陷修复；任何修复按所属前序批次回滚，不删除测试覆盖。

**建议提交：**

```text
test(scheduler): 覆盖任务专属会话后端闭环
```

---

## 10. P1：完整用户交互和 Agent Tool

### P1-B1：前端模型、服务和任务摘要模型

**状态：** `PASS`

**依赖：** `P0-B8`

**目标：** Web 完整接入必填 `ScheduleResponse.threadId`、Thread purpose 和 scheduleId，
并建立不加载历史的任务摘要视图模型。

**主要文件：**

- `apps/web/src/services/schedule-service.ts`
- `apps/web/src/services/thread-service.ts`
- `apps/web/src/features/projects/project-model.ts`
- 新增 `apps/web/src/features/schedules/schedule-task-model.ts`
- `apps/web/src/app/AppController.tsx`
- 对应 service/model/App 测试

**测试先行：**

1. 普通会话、草稿会话和任务会话按 purpose 正确分组。
2. 任务摘要由 Schedule、Thread 和 RunRegistry 合并，不读取会话历史。
3. 缺失绑定或旧 daemon 返回空 threadId 时显示明确异常状态。
4. 所有 mock service 和 fixture 都包含新必填字段。

**实现步骤：**

1. 删除前端对 `schedule.threadId` 的可空正常路径。
2. 保留运行时防御：异常响应进入“任务会话需要修复”状态，不生成伪 Thread。
3. 任务摘要至少包含 name、threadId、enabled、nextRunAt、lastStatus、
   pendingTrigger 和当前 Run 状态。
4. AppController 统一加载 Schedule 摘要和 Thread 列表，不预取任务历史。

**验证：**

```bash
pnpm --filter @clawee/web test -- \
  src/services/schedule-service.test.ts \
  src/services/thread-service.test.ts \
  src/features/projects/project-model.test.ts
pnpm --filter @clawee/web typecheck
```

**验收标准：** Web 类型模型与 daemon 一致，任务列表数据不依赖 cron 文本或标题推断。

**执行结果：**

- 前端按 `ThreadResponse.purpose` 将 `conversation`、`schedule_draft` 与
  `schedule_task` 稳定分组，任务 Thread 不再进入项目普通会话列表。
- 新增任务摘要模型，由 Schedule、绑定 Thread 和 RunRegistry 合并 name、threadId、
  enabled、nextRunAt、lastStatus、pendingTrigger 和当前 Run 状态，不读取会话历史。
- 对旧 daemon 空 `threadId`、绑定 Thread 缺失、purpose 不匹配和 scheduleId 不匹配
  返回 `repair_required` 与“任务会话需要修复”，不创建伪 Thread。
- AppController 连接后独立加载 Schedule 摘要和活动 Thread；普通会话仍按既有懒加载
  规则工作，任务历史只在选中 Thread 后加载。
- Schedule/Thread service 测试固定必填 `threadId`、purpose 和 scheduleId 字段。
- P1-B1 专项测试 76 项、Web 全量测试 486 项、最终相关回归 70 项通过。
- Web typecheck、生产 build 和 `git diff --check` 通过；build 仅有既有大 chunk 警告。

**回滚边界：** 回滚前端模型和选择器，不改变后端 Protocol。

**建议提交：**

```text
feat(web): 接入任务会话绑定模型
```

### P1-B2：左侧“任务”区域

**状态：** `PASS`

**依赖：** `P1-B1`

**目标：** 在侧栏底部、设置上方增加面向用户的“任务”区域，并从项目普通会话中移除
`schedule_task`。

**主要文件：**

- `apps/web/src/features/shell/ClaweeSidebar.tsx`
- `apps/web/src/features/shell/ClaweeSidebar.test.tsx`
- `apps/web/src/styles/app.css`
- `apps/web/src/styles/app-css.test.ts`
- `apps/web/src/app/AppController.tsx`
- `apps/web/src/app/App.test.tsx`

**测试先行：**

1. `schedule_task` 不出现在项目普通会话树。
2. 任务区域显示运行、排队、等待审批、失败、暂停和未读状态。
3. 正在运行使用旋转图标，状态变化不改变行高。
4. 点击任务立即清空旧时间线并进入加载状态。
5. 暂停任务仍可进入。
6. 折叠侧栏不出现文本溢出，移动端可滚动。

**实现步骤：**

1. 为 Sidebar 增加明确的 task summary props，不传底层 TaskCenter 数据结构。
2. 任务区域位于侧栏底部内容区和设置按钮之间。
3. 状态使用图标、简短标签和下次时间，不显示 cron。
4. 保持旧 TaskCenter 仅作为内部诊断组件，不加入普通导航。

**验证：**

```bash
pnpm --filter @clawee/web test -- \
  src/features/shell/ClaweeSidebar.test.tsx \
  src/app/App.test.tsx \
  src/styles/app-css.test.ts
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

**验收标准：** 用户能从侧栏识别任务和状态，项目会话与任务会话不混排。

**执行结果：**

- 新增独立 Sidebar task 展示模型，合并 Schedule 绑定摘要、全局 Task 轮询和未读集合，
  按修复、审批、运行、排队、暂停、失败和空闲的优先级生成稳定状态。
- 侧栏设置上方新增任务区域，支持运行旋转图标、排队、待审批、失败、暂停、需修复、
  下次运行时间和未读标记；修复状态禁用，暂停任务保持可进入。
- AppController 保留 Task 轮询快照；点击任务会清除该 Thread 未读、切换项目和 Thread、
  立即清空旧时间线并导航到任务会话历史加载态。
- 任务区高度上限 220px，列表独立滚动，行高固定 44px；折叠侧栏完全隐藏任务文本，
  reduced-motion 下停止旋转动画。
- P1-B2 专项测试 107 项、Web 全量测试 492 项通过；Web typecheck、生产 build 和
  `git diff --check` 通过，build 仅有既有大 chunk 警告。
- 受控 Chrome 在 1440x900、390x844 和折叠侧栏下验证通过：7 条任务均保持 44px，
  列表滚动区 190px、无横向溢出，控制台无错误或警告。

**回滚边界：** 只回滚侧栏任务区域；保留 P1-B1 数据模型。

**建议提交：**

```text
feat(web): 在侧栏增加任务会话区域
```

### P1-B3：“已安排”与任务会话互跳

**状态：** `NOT_STARTED`

**依赖：** `P1-B2`

**目标：** 手动创建、点击任务标题、查看上次运行和立即执行都进入同一个专属任务会话。

**主要文件：**

- `apps/web/src/features/schedules/SchedulesView.tsx`
- `apps/web/src/features/schedules/ScheduleEditor.tsx`
- `apps/web/src/features/schedules/SchedulesView.test.tsx`
- `apps/web/src/app/AppController.tsx`
- `apps/web/src/app/App.test.tsx`
- `apps/web/src/app/routes.ts`

**测试先行：**

1. 创建成功后刷新列表并导航到响应 `threadId`。
2. 点击任务标题进入任务会话。
3. `run-now` 成功、queued 或 skipped 都保持或进入 Schedule 的 `threadId`。
4. “查看上次运行”进入同一 Thread 并定位 `lastRunId`。
5. 请求失败或切换页面时 loading 状态必定收敛。
6. 诊断详情保留为二级入口，不替代任务会话。

**实现步骤：**

1. 将 `onOpenRun(runId, threadId?)` 收敛为稳定的任务导航接口。
2. 路由支持可选 `runId` 定位信息。
3. 创建和立即执行完成后同时刷新 Schedule、Thread 和 RunRegistry 摘要。
4. 不在 SchedulesView 本地伪造长期任务状态。

**验证：**

```bash
pnpm --filter @clawee/web test -- \
  src/features/schedules/SchedulesView.test.tsx \
  src/app/routes.test.ts \
  src/app/App.test.tsx
pnpm --filter @clawee/web typecheck
```

**验收标准：** “已安排”负责管理，任务会话负责查看结果，两者能稳定互跳。

**回滚边界：** 回滚导航接线和路由扩展，不改变已创建 Schedule。

**建议提交：**

```text
feat(web): 从已安排进入任务专属会话
```

### P1-B4：任务会话头部

**状态：** `NOT_STARTED`

**依赖：** `P1-B3`

**目标：** 在任务会话中提供紧凑状态和立即执行、暂停、恢复、编辑操作，不要求用户返回
已安排页面。

**主要文件：**

- 新增 `apps/web/src/features/schedules/ScheduleThreadHeader.tsx`
- 新增对应组件测试
- `apps/web/src/features/conversation/ConversationHeader.tsx`
- `apps/web/src/features/conversation/ConversationHeader.test.tsx`
- `apps/web/src/app/AppController.tsx`
- `apps/web/src/styles/app.css`
- `apps/web/src/styles/app-css.test.ts`

**测试先行：**

1. 只在 `schedule_task` 显示任务状态栏。
2. 显示启停、运行、排队、等待审批、失败和下次执行状态。
3. 立即执行、暂停、恢复和编辑调用正确 Schedule API。
4. 活动请求期间按钮禁用并有稳定进度状态。
5. 移动端操作不遮挡标题、Timeline 和审批卡片。

**实现步骤：**

1. 保持 ConversationHeader 主标题尺度，任务操作使用紧凑工具栏。
2. 使用 lucide 图标和 tooltip，不新增说明性大卡片。
3. 编辑动作复用 ScheduleEditor，不复制表单逻辑。
4. 操作完成后刷新统一摘要模型。

**验证：**

```bash
pnpm --filter @clawee/web test -- \
  src/features/conversation/ConversationHeader.test.tsx \
  src/features/schedules/ScheduleThreadHeader.test.tsx \
  src/styles/app-css.test.ts
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

**验收标准：** 用户不离开任务会话即可管理任务，桌面和移动布局稳定。

**回滚边界：** 回滚任务头部组件，不回滚任务导航和绑定。

**建议提交：**

```text
feat(web): 增加任务会话状态与管理工具栏
```

### P1-B5：能力令牌和内部路由

**状态：** `NOT_STARTED`

**依赖：** `P1-B4`

**目标：** 建立按 Run 和 Thread 绑定的短期能力令牌，为内置 Schedule MCP 提供最小权限
内部 HTTP 接口。

**主要文件：**

- 新增 `apps/daemon/src/agent-tools/capability-token.ts`
- 新增 `apps/daemon/src/agent-tools/internal-routes.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/src/runs/manager.ts`
- 新增对应 unit/integration 安全测试
- `apps/daemon/src/diagnostics/redactor.ts` 或现有等价脱敏模块

**测试先行：**

1. 无令牌、过期令牌、已撤销令牌全部返回 401/403。
2. 令牌不能跨 Run、Thread 或作用域使用。
3. Run 终止、取消或 daemon 关闭后令牌失效。
4. 自动 Schedule Run 不能签发 mutation scope。
5. 令牌不出现在普通日志、run events、meta、diagnostics 和错误响应。
6. 内部路由不能使用公开客户端传入的任意 `threadId` 覆盖令牌绑定。

**实现步骤：**

1. 使用加密安全随机值，只在内存保存令牌摘要和绑定元数据。
2. 定义 get/create/update/pause/resume/run-now 的最小作用域。
3. 内部路由单独执行 capability auth；不得回退到公开 Bearer Token。
4. 令牌设置短 TTL，并在 Run 完成回调中主动撤销。
5. 为清理过期令牌增加无阻塞定时器，并在 server close 清理。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/agent-capability-token.test.ts \
  test/integration/agent-tool-api.test.ts \
  test/unit/diagnostics-redactor.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：** 内部 Schedule Tool 具备可测试的最小权限边界，令牌没有持久化或泄露。

**回滚边界：** 回滚内部路由和令牌签发；未完成 P1-B6 前不会影响普通 Run。

**建议提交：**

```text
feat(agent-tools): 增加按 Run 绑定的短期能力令牌
```

### P1-B6：Schedule MCP 工具和逐 Run 注入

**状态：** `NOT_STARTED`

**依赖：** `P1-B5`

**目标：** 使用标准 MCP SDK 实现 Schedule 工具，并通过 Codex 逐进程配置注入，不修改
用户全局 Codex 配置。

**主要文件：**

- `apps/daemon/package.json`
- `pnpm-lock.yaml`
- 新增 `apps/daemon/src/agent-tools/schedule-tools.ts`
- 新增 `apps/daemon/src/agent-tools/schedule-timing.ts`
- 新增 `apps/daemon/src/agent-tools/stdio-server.ts`
- `apps/daemon/src/codex/argv.ts`
- `apps/daemon/src/codex/runner.ts`
- `apps/daemon/src/codex/app-server-runner.ts`
- `apps/daemon/src/runs/manager.ts`
- 新增工具、timing 和 argv 测试

**测试先行：**

1. interval、daily、weekdays、weekly 和 cron timing 正确转换并校验时区。
2. create/update/pause/resume/run-now/get 工具 schema 严格拒绝未知或危险字段。
3. Tool 不接受任意 `threadId`。
4. exec、resume 和 app-server 三条启动路径都注入同一临时 MCP 配置。
5. 配置只作用于当前 Codex 子进程，不写入 `~/.codex/config.toml`。
6. 自动 Schedule Run 不注入 mutation 工具；用户 Run 按 Thread purpose 获得允许作用域。
7. MCP 子进程退出、Daemon 不可达和 Tool 超时都有明确错误。

**实现步骤：**

1. 引入官方 `@modelcontextprotocol/sdk`，不手写 MCP 帧协议。
2. stdio server 从环境读取内部地址和短期令牌，绝不输出令牌。
3. 建立统一的逐 Run Codex config builder，供 exec/resume/app-server 复用。
4. 使用 Codex `-c key=value` 注入内置 MCP server 配置。
5. 对配置值、命令路径和环境变量做日志脱敏。
6. Tool 返回 scheduleId、threadId、名称和 nextRunAt。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/agent-schedule-timing.test.ts \
  test/unit/agent-schedule-tools.test.ts \
  test/unit/codex-argv.test.ts \
  test/unit/codex-app-server-runner.test.ts
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
```

**验收标准：** Codex Run 可以调用结构化 Schedule 工具，且用户全局配置无任何改动。

**回滚边界：** 移除逐 Run MCP 注入和依赖即可；能力令牌模块可保留但不签发。

**建议提交：**

```text
feat(agent-tools): 注入内置 Schedule MCP 工具
```

### P1-B7：Agent 创建和管理任务协调

**状态：** `NOT_STARTED`

**依赖：** `P1-B6`

**目标：** 将 Agent Tool 接到 ScheduleCoordinator，支持从草稿会话绑定、从普通会话新建，
以及在任务会话中更新、暂停、恢复和立即执行。

**主要文件：**

- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/agent-tools/internal-routes.ts`
- `apps/daemon/src/agent-tools/schedule-tools.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/test/unit/scheduler-coordinator.test.ts`
- `apps/daemon/test/integration/agent-tool-api.test.ts`
- `apps/daemon/test/integration/run-manager.test.ts`

**测试先行：**

1. 当前 Thread 为 `schedule_draft` 时，创建 Tool 原子绑定当前 Thread 并转成
   `schedule_task`。
2. 当前 Thread 为普通会话时，创建新的 `schedule_task`，继承当前 Thread 执行配置。
3. `schedule_task` 中 update 未传 scheduleId 时通过绑定关系解析。
4. 普通会话有多个候选且未指定 scheduleId 时返回候选，不猜测。
5. 自动 Schedule Run 调用 mutation 路由被拒绝。
6. Agent 更新执行配置时仍遵守活动 Run 冲突和 Coordinator 事务。

**实现步骤：**

1. 实现 `createFromAgent()`，只信任能力令牌中的 actor Run/Thread。
2. draft 绑定时在同一 transaction 写 Schedule、更新 purpose 和同步配置。
3. 普通会话创建新 Thread 时继承 cwd/Profile/model/reasoning/sandbox。
4. Tool 的 pause/resume/run-now 复用 Coordinator/Scheduler 公开用例，不复制逻辑。
5. 操作记录保存 actor Run，正式 actor 字段迁移留到 P2-B4。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/scheduler-coordinator.test.ts \
  test/integration/agent-tool-api.test.ts \
  test/integration/run-manager.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：** Agent 可以创建通用任务并管理已有任务，绑定关系不会被 Tool 输入伪造。

**回滚边界：** 关闭 Tool mutation scope 即可停止 Agent 管理；保留已创建 Schedule/Thread。

**建议提交：**

```text
feat(scheduler): 支持 Agent 创建和管理任务
```

### P1-B8：删除正则创建流程

**状态：** `NOT_STARTED`

**依赖：** `P1-B7`

**目标：** “使用 Clawee 创建”改为真正的 `schedule_draft` + 普通 Agent Run，删除标题匹配和
本地提醒正则拦截。

**主要文件：**

- `apps/web/src/app/AppController.tsx`
- `apps/web/src/features/schedules/SchedulesView.tsx`
- `apps/web/src/features/schedules/SchedulesView.test.tsx`
- 删除 `apps/web/src/features/schedules/schedule-natural-language.ts`
- 删除对应 `schedule-natural-language.test.ts`
- `apps/web/src/services/thread-service.ts`
- `apps/web/src/app/App.test.tsx`

**测试先行：**

1. “使用 Clawee 创建”创建 purpose 为 `schedule_draft` 的 Thread。
2. “每天生成 100 字文稿”走普通 Run，不要求“提醒我”关键词。
3. 缺少时间时由 Agent 追问，不由前端正则报错。
4. Tool 创建成功后刷新 Thread/Schedule，当前 draft 变为任务会话。
5. Run 完成但未创建 Schedule 时，draft 仍是普通可继续对话的草稿。
6. 附件遵循普通 Composer 能力，不再被 Schedule 特殊分支拒绝。

**实现步骤：**

1. 删除 `SCHEDULE_CREATION_TITLE` 和
   `createNaturalLanguageScheduleRequest()` 提交拦截。
2. SchedulesView 的入口只负责创建 draft 并导航。
3. Composer 始终调用普通 Run 创建路径。
4. Run terminal 后刷新 Thread purpose 和 Schedule 摘要。
5. 删除正则源文件、测试和所有引用。

**验证：**

```bash
pnpm --filter @clawee/web test -- \
  src/features/schedules/SchedulesView.test.tsx \
  src/app/App.test.tsx
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
rg -n "创建已安排任务|createNaturalLanguageScheduleRequest|schedule-natural-language" apps/web/src
```

最后一条 `rg` 预期无结果。

**验收标准：** Agent 创建不限于提醒语句，不再存在标题或正则驱动的隐藏分支。

**回滚边界：** 可以恢复旧入口按钮行为，但不得重新启用正则作为正式创建路径。

**建议提交：**

```text
refactor(web): 使用 Agent Tool 替换任务创建正则
```

### P1-B9：通知深链接和结果摘要

**状态：** `NOT_STARTED`

**依赖：** `P1-B8`

**目标：** Schedule 成功、失败和等待审批通知都携带正确 threadId/runId，正文使用持久化
结果摘要，点击后进入并定位任务会话。

**主要文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/src/tasks/service.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/web/src/features/tasks/task-monitor.ts`
- `apps/web/src/features/tasks/task-monitor.test.ts`
- `apps/web/src/host/bridge.ts`
- `apps/web/src/host/browser-bridge.ts`
- `apps/web/src/host/browser-bridge.test.ts`
- `apps/web/src/app/routes.ts`
- `apps/web/src/app/AppController.tsx`

**测试先行：**

1. Schedule TaskItem 使用 Schedule name 作为通知标题。
2. 成功通知正文取最后一条持久化 `assistant_message` 的前 120 个字符。
3. 无 assistant message 时使用状态摘要。
4. 失败和等待审批通知都携带 threadId/runId。
5. Browser bridge 点击后打开带 run 定位信息的任务路由。
6. 通知不再使用 `target: 'schedules'`。
7. 摘要经过脱敏，不包含内部 executionPrompt、令牌和诊断详情。

**实现步骤：**

1. TaskService 从 run_events 派生可选 `resultSummary`，并关联 Schedule name。
2. `HostNotification` 对任务通知要求 threadId/runId，逐步移除 schedules target。
3. 路由解析可选 runId；进入 Thread 后并行恢复历史和活动 Run，再滚动定位。
4. 页面正在显示同一 Thread/Run 时继续抑制重复系统通知。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- test/unit/task-service.test.ts
pnpm --filter @clawee/web test -- \
  src/features/tasks/task-monitor.test.ts \
  src/host/browser-bridge.test.ts \
  src/app/routes.test.ts \
  src/app/App.test.tsx
pnpm --filter @clawee/web typecheck
```

**验收标准：** 所有 Schedule 通知进入任务会话，成功通知展示真实结果摘要。

**回滚边界：** 回滚通知内容和路由参数，不影响任务运行；禁止回退为只跳已安排。

**建议提交：**

```text
feat(notifications): 深链接任务会话并展示结果摘要
```

### P1-B10：Schedule Run 公开时间线和 P1 门禁

**状态：** `NOT_STARTED`

**依赖：** `P1-B9`

**目标：** 历史和实时 Timeline 只显示任务公开输入及触发时间，不显示内部执行包装；完成
P1 全链路自动化门禁。

**主要文件：**

- `apps/daemon/src/storage/migrations.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/runs/types.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/api/routes.threads.ts`
- `apps/daemon/src/codex/sessions/parser.ts`
- `apps/daemon/src/codex/sessions/index-repository.ts`
- `apps/web/src/components/timeline/timeline-model.ts`
- `apps/web/src/components/timeline/Timeline.tsx`
- 对应 daemon/Web 历史和 Timeline 测试

**测试先行：**

1. Schedule Run 持久化本次公开 prompt 和触发时间。
2. 普通 Run 不因该字段改变现有隐私和历史行为。
3. 历史中内部 executionPrompt 被替换为：
   `定时执行 · 时间` + 原始任务内容。
4. Schedule 更新 Prompt 后，旧 Run 仍显示执行当时的输入。
5. 实时 Timeline 和刷新后历史文本一致。
6. 生成文件链接仍可点击打开工作区预览。
7. 内部执行规则不出现在搜索结果和通知中。

**实现步骤：**

1. 为 `runs` 增加可空 `public_prompt` 和 `triggered_at`，只在 Schedule Run 写入原文。
2. 不把 capability token 或 executionPrompt 写入这两个字段。
3. Thread 历史响应根据 Run 元数据映射 Schedule 用户输入，不直接修改原始 Codex JSONL。
4. 搜索索引使用公开输入，排除内部包装。
5. Timeline 使用独立的 Schedule trigger 展示模型，不按关键词特殊渲染。

**验证：**

```bash
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon test
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/web test
pnpm --filter @clawee/web typecheck
pnpm build
git diff --check
```

**P1 最终验收待办：**

以下场景在本批登记到最终验收矩阵，不要求停下等待人工操作；统一在 P2-B7 执行：

1. 用“每 30 分钟提醒我喝水”创建任务。
2. 用“每天 9 点生成 100 字文稿”创建内容任务。
3. 立即执行两次，确认进入同一会话且第二次排队或跳过。
4. 在任务会话说“改到晚上 8 点”，确认 Schedule 更新。
5. 点击成功通知，确认进入对应 Run。

**验收标准：**

- AI 和手动创建都可用。
- 左侧任务、已安排和会话状态一致。
- 通知和公开时间线不泄露内部包装。
- 喝水提醒和内容生成使用同一执行路径。

**回滚边界：** `runs` 新增字段保留；回滚映射代码时原始 Codex JSONL 不受影响。

**建议提交：**

```text
feat(history): 展示任务执行公开输入
```

---

## 11. P2：长期运行和发布质量

### P2-B1：等待审批和连续失败体验

**状态：** `NOT_STARTED`

**依赖：** `P1-B10`

**目标：** 任务摘要、侧栏、通知和会话准确呈现等待审批及连续失败，并提供可操作提示。

**主要文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/src/tasks/service.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/web/src/features/schedules/schedule-task-model.ts`
- `apps/web/src/features/shell/ClaweeSidebar.tsx`
- `apps/web/src/features/approvals/ApprovalPanel.tsx`
- `apps/web/src/app/AppController.tsx`
- 对应测试

**测试先行：**

1. `waiting_approval` 优先于普通 running 状态展示。
2. 审批通知进入正确 Thread 并定位审批卡片。
3. 批准后继续同一 Run，拒绝或过期后状态正确收敛。
4. 等待审批期间后续触发按 queue/skip 处理。
5. 连续三次相同项目目录错误显示“编辑项目/建议暂停”，但不自动暂停。
6. 用户可理解的文案不只显示技术错误码。

**实现步骤：**

1. Task/Schedule 摘要增加审批定位和同类连续失败计数。
2. 状态优先级统一为：等待审批 -> 运行 -> 排队 -> 失败 -> 暂停 -> 空闲。
3. 失败建议只影响 UI，不改变 Schedule enabled。
4. 审批恢复继续复用现有 ApprovalManager 和 RunManager。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/integration/approval-runtime.test.ts \
  test/unit/task-service.test.ts
pnpm --filter @clawee/web test -- \
  src/features/approvals/ApprovalPanel.test.tsx \
  src/features/shell/ClaweeSidebar.test.tsx \
  src/app/App.test.tsx
```

**验收标准：** 无人值守任务不会自动批准，用户能从通知和侧栏完成审批或处理失败。

**回滚边界：** 回滚状态聚合和提示，不改变审批安全策略。

**建议提交：**

```text
feat(tasks): 完善任务审批和连续失败体验
```

### P2-B2：Codex thread 轮换和摘要恢复

**状态：** `NOT_STARTED`

**依赖：** `P2-B1`

**目标：** Codex resume 失败或上下文超过阈值时，使用 Clawee 会话摘要建立新的 Codex
thread，同时保持 Clawee Thread、Schedule 和页面路由不变。

**主要文件：**

- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/runs/types.ts`
- `apps/daemon/src/memory/service.ts`
- `apps/daemon/src/memory/repository.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/test/integration/run-manager.test.ts`
- `apps/daemon/test/integration/memory-api.test.ts`
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`

**测试先行：**

1. fake Codex resume 失败时只重试一次新 thread。
2. 新 thread 首次输入包含脱敏摘要和本次公开任务输入。
3. `threads.codex_thread_id` 只在新 thread 成功建立后更新。
4. Clawee threadId、Schedule threadId 和历史入口不变化。
5. 轮换失败时本次 Run 失败，但 Schedule 仍可后续重试。
6. 会话中只出现一次非阻断“执行上下文已重新连接”诊断。
7. 阈值触发可配置、可关闭，默认值有文档。

**实现步骤：**

1. 复用现有 ConversationSummary，不建立第二套摘要系统。
2. 将恢复策略封装为 `resume -> summary reseed -> new thread` 的有限状态流程。
3. 摘要只进入 Codex 上下文，不伪装成用户消息。
4. 记录 rotation reason、旧/新 codexThreadId 的脱敏诊断。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/integration/run-manager.test.ts \
  test/integration/memory-api.test.ts
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

**验收标准：** 单个 Codex thread 失效不会永久中断长期任务，用户入口和历史身份稳定。

**回滚边界：** 可关闭轮换策略并恢复既有 resume 行为；不回写旧 codexThreadId。

**建议提交：**

```text
feat(runtime): 使用会话摘要轮换 Codex thread
```

### P2-B3：后台 Host 通知

**状态：** `NOT_STARTED`

**依赖：** `P2-B2`

**目标：** Daemon 持久化待发送通知，受支持 Desktop Host 在页面关闭时仍能展示，并在点击
后打开正确任务会话。

**主要文件：**

- `apps/daemon/src/storage/migrations.ts`
- 新增 `apps/daemon/src/notifications/repository.ts`
- 新增 `apps/daemon/src/notifications/service.ts`
- 新增 `apps/daemon/src/api/routes.notifications.ts`
- `apps/daemon/src/api/server.ts`
- `apps/web/src/host/bridge.ts`
- `apps/web/src/services/notification-service.ts`
- `apps/harness/src/cli.ts`
- 对应 daemon/Web/harness 测试

**测试先行：**

1. Schedule terminal/approval 状态生成持久通知事件。
2. Host 可按游标读取并确认消费，重启后未消费事件仍存在。
3. 重复订阅不会重复展示已确认事件。
4. 通知载荷只含脱敏 title/body/threadId/runId。
5. fake desktop Host 点击通知打开正确路由。
6. Browser 模式继续遵循页面存活和权限限制。

**实现步骤：**

1. 新增轻量 notification outbox，不把浏览器当作状态数据库。
2. 提供本地认证的读取/确认接口或 SSE。
3. HostBridge 增加后台通知订阅能力，保持 browser fallback。
4. harness 提供可自动化验证的 desktop adapter。
5. 若实际原生 Host 不在本仓库，记录外部适配版本和 P2-B7 的真实验收环境；outbox、
   bridge contract 和 harness 自动化通过后可以继续后续代码批次，但最终总体状态在真实
   Host 验收前不得改为 `COMPLETE`。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- test/integration/notification-api.test.ts
pnpm --filter @clawee/web test -- \
  src/services/notification-service.test.ts \
  src/host/browser-bridge.test.ts
pnpm --filter @clawee/harness test
pnpm --filter @clawee/harness typecheck
```

**验收标准：** 页面关闭不丢通知，受支持 Host 点击后进入正确任务 Thread/Run。

**回滚边界：** 停止 Host 消费并保留 outbox 表；不得删除未消费通知数据。

**建议提交：**

```text
feat(notifications): 增加任务后台通知 outbox
```

### P2-B4：actor 审计和诊断事件

**状态：** `NOT_STARTED`

**依赖：** `P2-B3`

**目标：** 可以追踪用户、Agent、Timer、Migration 对 Schedule 的操作，以及一次 Trigger
到 Thread 和 Run 的完整链路。

**主要文件：**

- `apps/daemon/src/storage/migrations.ts`
- `apps/daemon/src/scheduler/types.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/diagnostics/collector.ts`
- `apps/daemon/src/diagnostics/redactor.ts`
- `packages/protocol/src/api.ts`
- 对应 migration/repository/diagnostics 测试

**测试先行：**

1. 操作记录支持 `actor_type` 和 `actor_run_id`。
2. 手动 API、Agent Tool、Timer 和 binding repair 分别记录 user/agent/timer/migration。
3. Trigger 操作能关联 scheduleId、threadId、runId 和 trigger type。
4. 诊断导出包含状态与错误码，但不含完整 Prompt、令牌和未脱敏结果。
5. 旧 operation 行迁移后仍可读取。

**实现步骤：**

1. 使用 `ensureColumn()` 增加 actor 字段和必要索引。
2. 扩展操作写入上下文，禁止调用方自行拼接 actor。
3. 统一发出规格中的 Schedule 诊断事件。
4. 在诊断导出中只保留安全摘要和关联 ID。

**验证：**

```bash
pnpm --filter @clawee/daemon test -- \
  test/unit/storage.test.ts \
  test/unit/scheduler-repository.test.ts \
  test/integration/diagnostics.test.ts \
  test/unit/diagnostics-redactor.test.ts
pnpm --filter @clawee/daemon typecheck
```

**验收标准：** 任一任务触发都可从 Schedule 追踪到 Thread、Run 和 actor，导出保持脱敏。

**回滚边界：** 新字段和历史数据保留，回滚只停止新 actor 写入。

**建议提交：**

```text
feat(diagnostics): 增加任务操作 actor 和触发链路
```

### P2-B5：Playwright 端到端测试

**状态：** `NOT_STARTED`

**依赖：** `P2-B4`

**目标：** 建立可重复运行的浏览器端到端环境，覆盖桌面和移动端完整任务工作流。

**主要文件：**

- 根 `package.json`
- `pnpm-lock.yaml`
- 新增 `playwright.config.ts`
- 新增 `apps/web/e2e/scheduled-task-thread.spec.ts`
- 新增 E2E fixture、启动脚本和 fake Codex 支持文件
- 必要的稳定 `data-testid`，仅用于无法稳定语义定位的元素

**测试场景：**

1. 手动创建任务后左侧立即出现并自动进入会话。
2. AI 创建通用内容任务并完成 draft -> task。
3. 立即执行两次，第二次 queue/skip，不并行。
4. 两次结果追加到同一任务会话。
5. 运行时切换普通会话再切回，不显示旧会话内容。
6. 页面刷新后恢复活动 Run 和 SSE。
7. 暂停、恢复、编辑、删除符合预期。
8. 等待审批通知进入审批卡片，批准后继续。
9. 成功/失败通知进入正确 Thread/Run。
10. HTML 文件结果可打开预览。
11. 桌面 `1440x900` 和移动 `390x844` 均可滚动和操作。

**实现步骤：**

1. 引入 `@playwright/test`，增加明确的 `e2e` 脚本。
2. 测试启动隔离 daemon 数据目录、fake Codex 和 Vite 端口。
3. 使用可控时钟或 run-now，避免真实等待 cron。
4. 每个测试独立数据库和清理流程，不复用用户本地数据。
5. 收集失败截图、trace、控制台错误和网络错误。

**验证：**

```bash
pnpm exec playwright install chromium
pnpm e2e
```

**验收标准：** 全部场景在两个视口通过，页面无重叠、溢出、空白 Timeline 和状态残留。

**回滚边界：** E2E 基础设施可独立回滚，不回滚产品实现；已发现回归必须先修复。

**建议提交：**

```text
test(e2e): 覆盖任务专属会话完整工作流
```

### P2-B6：100 个任务性能门禁

**状态：** `NOT_STARTED`

**依赖：** `P2-B5`

**目标：** 验证 100 个任务时列表只加载摘要、历史按需加载，交互和主线程保持可用。

**主要文件：**

- `scripts/check-performance-baseline.mjs`
- 新增任务数据 seed/benchmark 脚本
- `apps/web/e2e/scheduled-task-performance.spec.ts`
- 必要的 Schedule list 查询和前端 memo/虚拟化实现
- 性能基线报告文档

**测试先行与指标：**

1. 首屏请求不包含 100 个任务的历史正文。
2. 点击单个任务后只请求该 Thread 历史。
3. 刷新只加载 Thread/Schedule/Run 摘要。
4. 侧栏滚动和任务切换无超过既定阈值的长任务。
5. DOM 数量、请求数量和 JS 长任务写入可复现基线。
6. 搜索和已安排页面不会因任务数量产生 N+1 历史请求。

**实现步骤：**

1. 建立固定 100 Schedule/Thread 的 seed。
2. 使用 Playwright trace 和 Performance API 采样。
3. 如列表确有压力，优先 memo、稳定 key 和摘要分页；只有证据需要时再引入虚拟化。
4. 将阈值写入 `scripts/check-performance-baseline.mjs`，CI 超阈值失败。

**验证：**

```bash
pnpm e2e -- scheduled-task-performance.spec.ts
pnpm perf:check
pnpm --filter @clawee/web build
```

**验收标准：**

- 100 个任务时不预加载历史。
- 页面刷新和任务切换请求数量有上限。
- 无持续主线程卡死或明显布局抖动。
- 性能基线可在后续提交中自动回归。

**回滚边界：** 保留 benchmark 和基线；性能优化按具体提交回滚，不降低门禁阈值掩盖回归。

**建议提交：**

```text
perf(tasks): 建立百任务列表性能门禁
```

### P2-B7：发布、回滚和最终统一验收

**状态：** `NOT_STARTED`

**依赖：** `P2-B6`

**目标：** 完成全量自动化、真实环境验收、旧数据库升级、回滚演练和用户/运行文档，
达到规格最终完成定义。

**主要文件：**

- `README.md`
- `docs/runtime-api-for-ui-v1.md`
- 来源规格和本计划的最终状态
- 新增迁移/发布运行手册
- 必要的 changelog 或版本说明

**发布前步骤：**

1. 备份真实或脱敏副本 SQLite。
2. 记录升级前活动 Schedule 数量、旧孤立 Run 数量和数据库版本。
3. 运行新版迁移和 `ensureBindings()`。
4. 执行两条 SQL 不变量查询。
5. 抽查创建的任务 Thread 配置与 Schedule 一致。
6. 最后启动 Scheduler。

**全量自动化：**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm e2e
pnpm perf:check
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
git diff --check
```

**手动验收矩阵：**

| 场景 | 操作 | 预期 |
|---|---|---|
| AI 创建提醒 | “每 30 分钟提醒我喝水” | 创建任务会话，按时产生简短提醒 |
| AI 创建内容任务 | “每天 9 点生成 100 字文稿” | Agent 理解任务，结果进入同一会话 |
| 手动创建 | 提交表单 | 自动进入专属会话 |
| 连续立即执行 | 连续触发两次 | 第二次排队或跳过，不并行 |
| 自动执行两次 | 触发两个周期 | 两次结果进入同一会话 |
| 切换会话 | 运行时切走再回来 | 不丢 Run，不显示旧会话内容 |
| 页面刷新 | 运行中刷新 | 恢复会话和活动状态 |
| 审批 | 定时任务请求写文件 | 通知并进入审批，不自动批准 |
| 暂停恢复 | 点击暂停再恢复 | 触发状态正确，会话始终可进入 |
| 会话内修改 | “改成 20:00” | Schedule 更新时间和下次执行 |
| 删除 | 删除无活动任务 | Schedule 隐藏，Thread 归档，历史保留 |
| 旧数据升级 | 现有数据库启动 | 每个旧 Schedule 补一个 Thread，不重复 |
| 通知 | 点击完成/失败/审批通知 | 进入正确 Thread 并定位 Run |
| 文件结果 | 生成 HTML | 会话链接可点击并打开预览 |
| 上下文轮换 | 模拟 resume 失败 | Clawee Thread 不变，新 Codex thread 继续 |
| 后台通知 | 关闭页面触发任务 | 支持的 Host 仍通知并可深链 |

**回滚演练：**

1. 停止新版 Scheduler。
2. 回滚应用代码，不删除新增列、索引、Thread 或 Codex session。
3. 使用旧版代码打开数据库，确认能忽略新增字段。
4. 验证旧 Schedule 仍可读取。
5. 恢复新版代码，再次运行 ensureBindings，确认幂等。

**最终验收标准：**

- 25 个批次全部为 `PASS`。
- 自动化、E2E、性能和真实 Codex smoke 全部通过。
- 手动验收矩阵全部通过。
- 旧数据库升级无 Schedule 丢失、无重复绑定。
- 回滚演练不删除或合并历史。
- API、迁移、运维和用户行为文档已更新。

**回滚边界：** 数据库迁移只向前兼容，不做破坏性降级；回滚以停止新版 Scheduler 和
回滚应用代码为主。

**建议提交：**

```text
docs(release): 完成任务专属会话发布与回滚说明
```

---

## 12. 风险登记

| 风险 | 最早控制批次 | 缓解措施 |
|---|---|---|
| 当前 WIP 被误覆盖或拆散 | P0-B1 | 在现有 14 个文件上继续，先审阅再补齐，不回退用户改动 |
| 对外 threadId 必填与迁移期可空冲突 | P0-B3 | P0-B1 保留内部迁移类型，Coordinator 上线时再收敛公开类型 |
| Schedule/Thread 写入一边成功 | P0-B3 | 同连接 transaction 和失败注入测试 |
| 活动 Run 中修改执行配置 | P0-B4 | 危险字段返回 409，非执行字段只影响后续 Run |
| 同一 Thread 并行写入 | P0-B5 | 基于 Thread 判断，复用 RunManager 队列，禁用 parallel |
| 启动修复重复建 Thread | P0-B6 | 唯一索引、逐条事务、幂等测试、Scheduler 后启动 |
| 旧隐藏逻辑归档新任务 | P0-B7 | 仅匹配 schedule Run 且 thread_id 为空 |
| Agent Tool 泄露权限 | P1-B5 | 短期作用域令牌、Run 绑定、脱敏和撤销 |
| MCP 修改用户全局配置 | P1-B6 | 只使用逐进程 `-c` 注入并测试配置文件不变 |
| 正则创建逻辑残留 | P1-B8 | 删除文件和引用，使用 rg 作为门禁 |
| 通知展示内部 Prompt | P1-B9/P1-B10 | 仅使用公开输入和持久化 assistant 摘要 |
| Codex thread 过长或失效 | P2-B2 | 摘要 reseed 和底层 thread 轮换 |
| 仓库缺少真实原生 Host | P2-B3 | outbox + bridge contract + harness；真实环境未验收则最终总体状态不可 COMPLETE |
| 100 个任务触发 N+1 历史加载 | P2-B6 | 摘要模型、网络断言和性能门禁 |

## 13. 禁止事项

1. 禁止使用 Git worktree。
2. 禁止用标题字符串判断 Schedule Thread。
3. 禁止保留正则提醒解析作为正式 Agent 创建路径。
4. 禁止新建 Schedule 时允许 `parallel`。
5. 禁止 Schedule Run 不传 `threadId`。
6. 禁止为 Schedule 再实现一套 Run 队列、审批或 SSE。
7. 禁止 Agent Tool 接受任意 `threadId` 或公开 Daemon Token。
8. 禁止自动 Schedule Run 修改或创建 Schedule。
9. 禁止通知只跳到“已安排”。
10. 禁止为了隐藏旧 session 归档所有 Schedule Thread。
11. 禁止在迁移回滚时删除新增字段、任务 Thread 或 Codex session。
12. 禁止将真实 Prompt、能力令牌或未脱敏结果写入普通日志。

## 14. 实施日志

### 2026-07-14 12:36 CST - P0-B1

- 状态：`PASS`
- 提交：`feat(runtime): 建立 Schedule 与 Thread 绑定基础模型`
  （SHA 以包含本日志的提交为准）
- 已完成：Schema、Repository、Protocol、Thread purpose、旧 parallel 迁移、唯一部分索引
  和全部受影响 fixture。
- 验证：Protocol/daemon/Web typecheck、daemon/Web 全量测试、仓库全量 build 和
  `git diff --check` 均通过。
- 未完成：`ScheduleResponse.threadId` 对外必填和 BoundScheduleRecord 留到 P0-B3；
  Schedule Thread 创建、查询和保护从 P0-B2 开始。
- 风险或偏差：真实 Codex smoke 13 项按环境开关跳过，不属于 P0-B1 完成门禁。
- 下一步：执行 P0-B2，补 Thread purpose 创建能力、scheduleId 查询和 Schedule Thread
  配置保护。

### 2026-07-14 13:38 CST - P0-B2

- 状态：`PASS`
- 提交：`feat(threads): 支持任务会话类型和绑定保护`
  （SHA 以包含本日志的提交为准）
- 已完成：内部 Thread purpose 创建、公开 draft 创建、活动 Schedule 绑定查询、任务会话
  配置更新接口，以及公开更新和归档保护。
- 验证：Protocol/daemon/Web typecheck、P0-B2 专项测试、daemon/Web 全量测试、daemon
  build、全仓 build 和 `git diff --check` 均通过。
- 未完成：Schedule 与任务 Thread 的原子创建、对外必填 `ScheduleResponse.threadId` 和
  `BoundScheduleRecord` 留到 P0-B3。
- 风险或偏差：daemon 首次与 Web 测试并行运行时，一个既有 MCP 子进程超时用例未及时
  捕获 stderr；该用例隔离重跑通过，daemon 在无并行负载下全量重跑通过。
- 下一步：执行 P0-B3，新增 ScheduleCoordinator 并在同一 SQLite transaction 中创建
  Schedule 与 `schedule_task` Thread。

### 2026-07-14 13:52 CST - P0-B3

- 状态：`PASS`
- 提交：`feat(scheduler): 原子创建任务及专属会话`
  （SHA 以包含本日志的提交为准）
- 已完成：ScheduleCoordinator 手动创建事务、任务 Thread 配置继承、操作记录原子写入、
  Scheduler 提交后刷新、公开创建路由接线，以及 `ScheduleResponse.threadId` 必填收敛。
- 验证：Protocol/daemon/Web typecheck、P0-B3 专项测试、daemon/Web 全量测试、全仓 build
  和 `git diff --check` 均通过。
- 未完成：Schedule 更新、暂停恢复和删除时同步/归档任务 Thread 留到 P0-B4。
- 风险或偏差：旧数据库中的未绑定 Schedule 目前会返回明确内部绑定错误，启动自动修复
  在 P0-B6 完成前尚未上线。
- 下一步：执行 P0-B4，把更新、暂停恢复和删除迁移到 Coordinator 的原子事务。

### 2026-07-14 14:11 CST - P0-B4

- 状态：`PASS`
- 提交：`feat(scheduler): 原子同步任务配置和会话生命周期`
  （SHA 以包含本日志的提交为准）
- 已完成：Coordinator 原子更新/删除、Schedule 与 Thread 配置同步、暂停恢复、删除归档、
  活动 Run 冲突保护、绑定异常错误码和公开 API 接线。
- 验证：P0-B4 四文件专项测试 160 项、daemon 全量 580 项、Web 全量 479 项通过；
  Protocol/daemon/Web typecheck、全仓 build 和 `git diff --check` 均通过。
- 未完成：Scheduler 固定 Thread 触发、Thread 级 queue/skip 和 pending trigger 合并留到
  P0-B5。
- 风险或偏差：真实 Codex smoke 13 项按环境开关跳过，继续登记到最终统一验收；构建仅有
  既有 Vite 大 chunk 警告。
- 下一步：执行 P0-B5，使自动触发和立即执行复用固定任务 Thread，并按 Thread 串行。

### 2026-07-14 14:57 CST - P0-B5

- 状态：`PASS`
- 提交：`feat(scheduler): 使用固定任务会话串行触发`
  （SHA 以包含本日志的提交为准）
- 已完成：Schedule Run 固定 Thread 触发、RunManager Thread 配置解析、Thread 级
  queue/skip、pending 合并、用户打断期间 pending 保留、默认 queue 和 parallel 禁用。
- 验证：P0-B5 六文件专项测试 197 项、daemon 全量 582 项、Web 全量 479 项通过；
  Protocol/daemon/Web typecheck、全仓 build 和 `git diff --check` 均通过。
- 未完成：旧 Schedule 自动绑定修复和 Scheduler 启动顺序留到 P0-B6。
- 风险或偏差：真实 Codex smoke 13 项按环境开关跳过，继续登记到最终统一验收；构建仅有
  既有 Vite 大 chunk 警告。
- 下一步：执行 P0-B6，在 Scheduler 启动前幂等修复旧 Schedule 的任务 Thread 绑定。

### 2026-07-14 15:36 CST - P0-B6

- 状态：`PASS`
- 提交：`feat(scheduler): 启动时修复旧任务会话绑定`
  （SHA 以包含本日志的提交为准）
- 已完成：幂等旧绑定修复、失效 Thread 替换、逐条事务、失败禁用与诊断操作、Server
  Coordinator 注入，以及修复/分类/启动顺序编排。
- 验证：P0-B6 四文件专项测试 133 项、daemon 全量 587 项、Web 全量 479 项通过；
  Protocol/daemon/Web typecheck、全仓 build 和 `git diff --check` 均通过。
- 未完成：legacy Schedule session 的精确 SQL 分类、任务 Thread 防误归档和搜索可见性留到
  P0-B7。
- 风险或偏差：启动前 session 同步暂不执行旧的 Schedule 标记/归档，避免误伤
  `schedule_task`；真实 Codex smoke 13 项继续登记到最终统一验收。
- 下一步：执行 P0-B7，只隐藏无 Clawee Thread 的旧孤立 Schedule session。

### 2026-07-14 16:07 CST - P0-B7

- 状态：`PASS`
- 提交：`fix(sessions): 仅隐藏旧版孤立 Schedule 会话`
  （SHA 以包含本日志的提交为准）
- 已完成：legacy Schedule session 精确分类、误标恢复、任务 Thread 防误归档、已有绑定
  导入去重，以及任务历史搜索可见性。
- 验证：P0-B7 四文件专项测试 126 项、daemon 全量 589 项通过；13 项真实 Codex smoke
  按环境开关跳过；Protocol/daemon typecheck、daemon build 和 `git diff --check` 通过。
- 未完成：P0 固定 Thread 多次执行、重启、SQL 不变量和真实 Codex 上下文连续性统一门禁
  留到 P0-B8。
- 风险或偏差：本批没有修改原始 JSONL scanner；索引不可用时仍由数据库中的 legacy Run
  判定过滤，真实 Codex smoke 继续登记到最终统一验收。
- 下一步：执行 P0-B8，补齐后端闭环、重启和真实 Codex smoke 门禁。

### 2026-07-14 16:50 CST - P0-B8

- 状态：`PASS`
- 提交：`test(scheduler): 覆盖任务专属会话后端闭环`
  （SHA 以包含本日志的提交为准）
- 已完成：Schedule 连续执行与删除后历史 API 闭环、Scheduler 重启后 pending trigger
  单次消费、旧库 SQL 不变量，以及真实 Codex 同 Thread 上下文连续性 smoke。
- 验证：P0-B8 专项测试 184 项通过；真实 Codex smoke 13 项全部通过；daemon 全量测试
  590 项通过，常规套件中的 13 项真实 smoke 按开关跳过；Protocol/daemon typecheck、
  daemon build 和 `git diff --check` 通过。
- 未完成：P0 后端闭环已完成；前端任务摘要、任务分组和页面接入从 P1-B1 开始。
- 风险或偏差：真实 smoke 首次运行因测试直接构造 Server、未传生产入口的 Codex 能力
  矩阵而触发 `RESUME_CAPABILITY_UNVERIFIED`；改为按生产路径收集能力后，目标用例和
  全部 13 项真实 smoke 均通过。
- 下一步：执行 P1-B1，收敛前端 Schedule/Thread 模型并建立不加载历史的任务摘要模型。

### 2026-07-14 17:12 CST - P1-B1

- 状态：`PASS`
- 提交：`feat(web): 接入任务会话绑定模型`
  （SHA 以包含本日志的提交为准）
- 已完成：Thread purpose 分组、Schedule 任务摘要模型、四类绑定修复状态、
  AppController Schedule/Thread 首屏加载和任务 Thread 普通会话过滤。
- 验证：P1-B1 专项测试 76 项、Web 全量测试 486 项、最终相关回归 70 项通过；
  Web typecheck、生产 build 和 `git diff --check` 通过。
- 未完成：任务摘要尚未渲染为侧栏“任务”区域，交互和视觉状态留到 P1-B2。
- 风险或偏差：Schedules 页面仍保留自己的按需列表请求，AppController 的请求只服务于
  全局任务摘要；build 继续报告两个既有主 chunk 超过 500 kB。
- 下一步：执行 P1-B2，在侧栏底部接入任务摘要，并覆盖运行、排队、审批、失败、暂停和
  未读状态。

### 2026-07-14 17:45 CST - P1-B2

- 状态：`PASS`
- 提交：`feat(web): 在侧栏增加任务会话区域`
  （SHA 以包含本日志的提交为准）
- 已完成：Sidebar task 展示模型、全局 Task 状态接入、任务区域渲染、未读聚合、
  任务会话导航、历史加载切换和桌面/移动/折叠布局。
- 验证：P1-B2 专项测试 107 项、Web 全量 492 项、Web typecheck、生产 build 和
  `git diff --check` 通过；受控 Chrome 三种视口检查无溢出、重叠或控制台错误。
- 未完成：“已安排”页面创建、任务标题、立即执行和查看上次运行进入同一任务会话留到
  P1-B3。
- 风险或偏差：任务区状态依赖 `/tasks?status=all&limit=50` 提供全局活动状态，终态失败
  仍以 Schedule 摘要为准；build 继续报告两个既有主 chunk 超过 500 kB。
- 下一步：执行 P1-B3，统一“已安排”页面到任务会话的导航和 Run 定位行为。

### 日志模板

每个批次完成或中断时追加一条：

```markdown
### YYYY-MM-DD HH:mm - P0-Bx

- 状态：IN_PROGRESS / PASS / PARTIAL / BLOCKED_ENV / FAILED
- 提交：<SHA 或“未提交”>
- 已完成：
  - ...
- 验证：
  - `<命令>`：通过/失败，摘要
- 未完成：
  - ...
- 风险或偏差：
  - ...
- 下一步：
  - ...
```

## 15. 最终完成定义

只有以下条件全部满足，才可将总体实施状态改为 `COMPLETE`：

1. AI 创建和手动创建均可用。
2. 每个活动 Schedule 有且只有一个专属 Thread。
3. 同一 Schedule 多次运行始终进入同一 Thread。
4. 定时任务使用普通 Clawee Agent 的完整执行能力和安全边界。
5. 左侧“任务”正确展示长期任务会话及状态。
6. 已安排与任务会话职责清晰且可互相跳转。
7. 通知点击进入正确任务会话和 Run。
8. 运行、排队、审批、失败、暂停状态跨页面一致。
9. 旧数据升级不丢 Schedule、不生成重复 Thread。
10. 页面刷新和会话切换不丢活动 Run。
11. Codex thread 轮换不改变 Clawee Thread。
12. P0、P1、P2 自动化、E2E、性能、真实 smoke 和手动验收全部通过。
