# OpenCreator 定时任务专属会话重构规格

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 文档状态 | 已实施；真实原生 Desktop Host 验收阻塞 |
| 版本 | 1.1 |
| 创建日期 | 2026-07-14 |
| 最近更新 | 2026-07-15 |
| 适用范围 | OpenCreator Web、Local Runtime Daemon、Protocol、Scheduler、Thread、Run、通知 |
| 规格优先级 | 本文档覆盖并替代 `docs/2026-07-03-codex-native-agent-runtime-design.md` 中 Scheduler 的旧会话模型 |
| 执行计划 | `docs/plans/2026-07-14-scheduled-task-dedicated-thread-design-plan.md` |
| 发布运行手册 | `docs/operations/2026-07-15-scheduled-task-dedicated-thread-release-runbook.md` |
| 最终验收报告 | `docs/test-reports/2026-07-15-scheduled-task-dedicated-thread-final-acceptance.md` |

本文是可直接实施的产品和技术规格。后续开发应按本文的 P0、P1、P2 顺序执行。实现过程中如需改变数据模型、接口或关键交互，必须先更新本文，再修改代码。

### 0.1 实施结果

- P0、P1 和 P2 的 24 个实现批次为 `PASS`。
- 全仓测试、类型检查、构建、14 个桌面/移动 Playwright、100 任务性能门禁、旧库升级
  与回滚演练、真实 Codex 14/14 smoke 均通过。
- 最终批次 P2-B7 为 `BLOCKED_ENV`，总体状态为 `PARTIAL`。
- 仓库没有真实原生 Desktop Host，页面关闭后的系统通知展示和点击深链无法在当前环境
  实机验收。outbox、Bridge 契约和 harness 已通过，但不替代 Host 实机证据。
- 下文未勾选项保留为原始验收清单；实际执行证据以最终验收报告为准。

## 1. 一句话定义

**定时任务不是独立的提醒系统，而是一个带定时触发器的 OpenCreator 长期会话。**

一个定时任务必须对应一个专属 OpenCreator 会话。同一个定时任务的每次自动执行、立即执行、审批、失败和结果，都进入同一个会话。定时系统只决定何时向该会话发起下一次 Agent 执行，实际能力继续由 OpenCreator 的普通 Run 和 Codex CLI 提供。

## 2. 已确认需求

1. 用户可以用自然语言让 AI 创建定时任务，也可以手动创建。
2. 每个定时任务创建一个专属会话。
3. 同一个定时任务始终复用同一个 OpenCreator 会话。
4. 同一个 OpenCreator 会话底层优先复用同一个 Codex thread。
5. 每次触发的任务输入、执行过程、审批和最终结果都追加到该专属会话。
6. 左侧最底部增加“任务”区域，展示定时任务对应的专属会话。
7. “任务”不是旧的技术 Run 中心，不向普通用户展示底层 Run 列表。
8. “已安排”负责创建、编辑、暂停、恢复、立即运行和删除。
9. “任务”负责查看执行历史、最新结果以及继续和 AI 对话。
10. 通知点击后直接进入任务专属会话，并定位到最新一次执行。
11. 喝水提醒、每日工作总结、定时生成文稿、读取项目、生成文件等都走同一套执行机制。
12. 原则上 OpenCreator 普通会话可以完成的任务，定时任务也可以完成。
13. OpenCreator 自己存储和调度任务，Codex CLI 只作为 Agent 执行引擎。

## 3. 目标与成功标准

### 3.1 产品目标

1. 普通用户不需要理解 cron、Run、Codex session、source id 等技术概念。
2. 用户看到的是一个长期任务，以及这个任务持续产生的对话和结果。
3. 用户可以在任务会话中继续提出要求，例如“以后控制在 300 字以内”或“改到晚上 8 点执行”。
4. 用户离开任务会话后，任务继续执行；再次进入时立即看到当前运行状态和最新结果。
5. 不同任务互不污染上下文，同一个任务保留连续上下文。

### 3.2 技术成功标准

1. 每条未删除的 `schedule` 都有唯一的 `thread_id`。
2. 每次 Schedule Run 都同时写入 `runs.source_id` 和 `runs.thread_id`。
3. 同一 Schedule 的所有新 Run 的 `thread_id` 相同。
4. 同一任务会话内禁止并行写入，任务触发必须串行。
5. 定时触发、立即执行和用户在会话中发消息都使用同一个 `RunManager`。
6. Schedule Run 可以使用对应会话的项目、Profile、模型、推理强度、权限、Skills 和 MCP。
7. 服务重启后可以恢复 Schedule 和 Thread 的绑定，不创建重复会话。
8. 点击成功、失败或待审批通知，都能进入正确的任务会话。
9. 旧版没有 `thread_id` 的 Schedule 可以自动补齐专属会话。
10. 旧版孤立的 Schedule Codex session 不会重新出现在普通会话列表中。

## 4. 非目标

本轮重构不包含以下能力：

1. 不把调度迁移到 Codex 官方“已安排”产品。
2. 不实现云端调度服务。
3. 不实现多人共享任务。
4. 不实现跨设备同步。
5. 不允许定时任务绕过既有 Sandbox、审批和 Profile 约束。
6. 不承诺浏览器页面完全关闭时仍能展示浏览器系统通知；原生后台通知属于 P2。
7. 不重写 Codex Agent loop、Skills runtime 或 MCP runtime。
8. 不把旧技术 TaskCenter 重新作为普通用户菜单展示。

## 5. 当前实现与问题

### 5.1 当前数据模型

当前 `schedules` 表保存：

- `name`
- `cron`
- `timezone`
- `prompt`
- `profile`
- `cwd`
- `model`
- `reasoning`
- `sandbox`
- `timeout_ms`
- `concurrency_policy`
- `next_run_at`
- `last_run_id`
- `last_status`

当前缺少：

- `thread_id`
- 任务专属会话类型
- Agent 创建任务时的结构化工具入口
- 通知到任务会话的稳定深链接

### 5.2 当前触发流程

```text
Schedule 到期
  -> SchedulerService.handleTrigger()
  -> RunManager.startRun()
  -> 不传 threadId
  -> 创建独立 Run
  -> Codex 创建独立 session
  -> 完成后通知跳到“已安排”
```

这导致：

1. 每次执行可能产生新的 Codex session。
2. 同一任务没有连续上下文。
3. 任务结果无法自然沉淀到一个可继续对话的页面。
4. 通知只能打开“已安排”或诊断信息。
5. 旧逻辑为了隐藏重复会话，会归档所有 `created_by='schedule'` 的会话。
6. 自然语言创建器目前是提醒语句正则解析，不是真正的 Agent 创建。

### 5.3 必须移除的错误假设

以下假设不再成立：

1. Schedule Run 是独立 Run。
2. Schedule 产生的 Codex session 都应该隐藏。
3. 通知的目标页面是“已安排”。
4. 定时任务只用于提醒。
5. `parallel` 可以用于同一个任务会话。

## 6. 核心设计决策

### 6.1 OpenCreator 持有调度状态

定时任务继续保存在 OpenCreator SQLite 中，由 OpenCreator Daemon 计算下次执行时间并触发。

Codex CLI 的职责只有：

1. 接收本次任务输入。
2. 恢复或创建 Codex thread。
3. 使用工具完成任务。
4. 返回事件和最终结果。

### 6.2 Schedule 与 Thread 一对一

关系定义：

```text
Schedule 1 ---- 1 Thread
Schedule 1 ---- N Run
Thread   1 ---- N Run
Run      N ---- 1 Schedule
Run      N ---- 1 Thread
```

约束：

1. 一个未删除 Schedule 必须绑定一个 Thread。
2. 一个 Thread 最多绑定一个未删除 Schedule。
3. Schedule Run 的 `source_id` 必须等于 Schedule ID。
4. Schedule Run 的 `thread_id` 必须等于 Schedule 的 `thread_id`。

### 6.3 OpenCreator Thread 与 Codex Thread 分层

OpenCreator 的任务会话 ID 是稳定的产品身份。

Codex thread ID 是可更换的执行身份：

```text
稳定的 OpenCreator thread_id
  -> 当前 codex_thread_id
  -> 必要时因恢复失败、上下文轮换而切换
```

即使未来底层 Codex thread 因上下文过长需要轮换，用户看到的 OpenCreator 任务会话仍然不变。

### 6.4 “已安排”和“任务”同时保留

两者职责不同：

| 入口 | 用户目标 | 主要内容 |
|---|---|---|
| 已安排 | 管理什么时候执行 | 创建、编辑、暂停、恢复、立即运行、删除 |
| 任务 | 查看执行了什么 | 任务会话、运行状态、历史结果、继续对话 |

“任务”不复用旧的技术 TaskCenter 页面。旧 TaskCenter 可以继续作为内部诊断组件，但不出现在普通用户导航中。

### 6.5 同一任务只允许串行执行

同一个 Thread 不能同时被两个 Codex Run 写入。

新任务只支持：

- `queue`：默认。当前运行结束后补执行一次，重复触发合并为一个待执行状态。
- `skip`：如果当前任务会话正在运行，本次触发跳过。

不再允许新建 `parallel` Schedule。旧数据中的 `parallel` 在迁移时转换为 `queue`。

### 6.6 Schedule 配置是任务执行配置的真相源

Schedule 保存时间和任务内容，同时绑定的 Thread 保存执行上下文。

以下字段必须保持同步：

| Schedule | Thread |
|---|---|
| `name` | `title` |
| `cwd` | `cwd` |
| `canonical_cwd` | `canonical_cwd` |
| `profile` | `profile` |
| `model` | `model` |
| `reasoning` | `reasoning` |
| `sandbox` | `sandbox` |

时间、启停、Prompt、超时和并发策略只属于 Schedule。

所有配置更新通过 Schedule 协调服务完成，不能只更新一侧。

## 7. 信息架构和页面设计

### 7.1 左侧导航

建议结构：

```text
新对话
搜索
已安排
插件

项目
  项目 A
    普通会话 1
    普通会话 2

任务
  喝水提醒                 下次 10:30
  每日工作总结             正在运行
  每日生成 100 字文稿      失败

设置
```

规则：

1. “任务”固定在左侧靠下位置。
2. 任务会话不再混入项目普通会话列表。
3. 每个任务行显示名称、状态图标和未读标记。
4. 正在运行时显示旋转状态。
5. 等待审批时显示醒目的审批状态。
6. 失败时显示失败状态，但不直接展开技术错误。
7. 已暂停任务仍显示，标记“已暂停”。
8. 已删除任务不显示，其会话进入归档。
9. 点击任务立即清空旧会话内容并显示加载状态，避免短暂显示上一个会话。

### 7.2 “已安排”页面

列表行至少包含：

- 任务名称
- 任务内容摘要
- 友好执行频率
- 下次执行时间
- 当前状态
- 最近结果状态
- 打开任务会话
- 立即执行
- 暂停或恢复
- 编辑
- 删除

任务名称或“打开会话”按钮进入专属任务会话。

“查看上次运行”不再默认打开诊断抽屉，而是进入任务会话并定位到对应 Run。诊断信息保留为二级操作。

### 7.3 任务会话头部

任务会话顶部显示一个紧凑任务栏：

- 任务名称
- 已启用或已暂停
- 下次执行时间
- 正在运行、等待审批或失败状态
- 立即执行按钮
- 暂停或恢复按钮
- 编辑按钮

不得使用大面积卡片或教学说明占用对话空间。

### 7.4 手动创建

手动表单保留普通用户需要的字段：

1. 任务名称
2. OpenCreator 要做什么
3. 执行频率
4. 项目
5. 是否启用

高级设置折叠展示：

- 时区
- Profile
- 模型
- 推理强度
- 权限
- 超时
- 冲突策略

提交成功后：

1. 创建 Schedule。
2. 创建专属 Thread。
3. 返回 `threadId`。
4. 前端自动进入任务会话。
5. 左侧“任务”立即出现新任务。

### 7.5 使用 OpenCreator 创建

用户点击“使用 OpenCreator 创建”后：

1. 创建一个 `schedule_draft` 会话。
2. 自动进入该会话。
3. 用户用自然语言描述任务。
4. Agent 判断信息是否完整。
5. 信息不足时，Agent 只追问缺少的信息。
6. 信息完整时，Agent 调用 OpenCreator Schedule Tool 创建任务。
7. 创建成功后，当前草稿会话转换为 `schedule_task` 会话。
8. 当前页面不跳走，直接显示创建结果和任务状态栏。
9. 任务出现在左侧“任务”和“已安排”页面。

这条流程必须删除当前基于标题和正则表达式的特殊提交逻辑。

## 8. 完整用户流程

### 8.1 AI 创建任务

示例：

```text
用户：每天晚上 6 点总结今天项目里的工作，控制在 300 字以内。
Agent：调用 schedule_create
OpenCreator：创建 Schedule + 绑定当前 draft Thread
Agent：已创建“每日工作总结”，下次将在今天 18:00 执行。
```

如果缺少时间：

```text
用户：每天帮我生成一篇 100 字文稿。
Agent：你希望每天几点生成？
```

如果缺少项目：

```text
Agent：这项任务要在哪个项目中执行？
```

Agent 不应让用户填写 cron。

### 8.2 手动创建任务

```text
用户打开已安排
  -> 创建
  -> 手动设置
  -> 填写内容和时间
  -> 提交
  -> 后端原子创建 Schedule 和 Thread
  -> 前端进入 Thread
```

### 8.3 到时自动执行

```text
Scheduler 发现到期
  -> 查询 Schedule.thread_id
  -> 检查 Thread 是否有活动 Run
  -> 根据 queue 或 skip 决定
  -> RunManager.startRun({ threadId, createdBy: "schedule", sourceId })
  -> 首次执行创建 Codex thread
  -> 后续执行 resume 同一 Codex thread
  -> 事件进入同一 OpenCreator Thread
  -> 结果完成
  -> 更新 Schedule.last_*
  -> 发送通知
```

### 8.4 喝水提醒

任务 Prompt：

```text
提醒我喝水
```

到时后 Agent 在任务会话中产生简短结果：

```text
该喝水了。
```

该文本同时作为通知正文。它不是特殊提醒代码路径，只是普通 Agent 任务的简短结果。

### 8.5 每日生成文稿

任务 Prompt：

```text
生成一篇 100 字左右的产品文稿，保存到 docs/daily 下，并告诉我文件路径。
```

到时后：

1. Agent 读取同一个项目。
2. 使用相同 Skills、MCP、文件和 Shell 能力。
3. 生成文件。
4. 在任务会话中返回文件链接。
5. 用户点击链接直接预览。

### 8.6 用户进入正在运行的任务

1. 左侧任务显示旋转状态。
2. 用户点击后立即显示该任务的加载状态。
3. 历史加载完成后显示当前 Run 的流式事件。
4. 用户可以等待、打断并继续或发送排队消息。
5. 切换走再回来时，必须恢复当前 Run 和实时事件订阅。

### 8.7 修改任务

页面修改：

```text
任务会话头部 -> 编辑 -> 保存
```

对话修改：

```text
用户：以后改成晚上 8 点执行，控制在 200 字以内。
Agent：调用 schedule_update
OpenCreator：原子更新 Schedule 和 Thread 配置
Agent：已更新，下次将在今天 20:00 执行。
```

如果任务正在运行，涉及项目、Profile、模型、权限的配置更新返回 `SCHEDULE_HAS_ACTIVE_RUN`。只修改时间、名称或 Prompt 可以在当前 Run 完成后生效。

### 8.8 暂停和恢复

暂停：

1. `enabled=false`
2. `next_run_at=null`
3. 专属 Thread 保留
4. 左侧任务继续显示“已暂停”
5. 用户仍可进入会话和手动发送消息

恢复：

1. 重新计算 `next_run_at`
2. 不补执行暂停期间错过的任务
3. 继续使用原 Thread

### 8.9 立即执行

1. 点击后立即进入或保持在任务会话。
2. 创建 Schedule Run，并携带固定 `threadId`。
3. 如果当前 Thread 正在运行：
   - `queue`：合并为一个待执行触发。
   - `skip`：明确提示本次已跳过。
4. 前端不能只显示无限转圈，必须展示“正在运行”“已排队”或“已跳过”。

### 8.10 删除任务

删除采用软删除：

1. Schedule 设置 `deleted_at`。
2. Schedule 禁用并清空 `next_run_at`。
3. 绑定 Thread 归档。
4. 历史 Run 和诊断数据保留。
5. 左侧“任务”和“已安排”不再显示。

如果存在活动 Run，删除返回 `SCHEDULE_HAS_ACTIVE_RUN`。用户需要先取消或等待完成。

## 9. 目标架构

```text
┌────────────────────────────────────────────────────────────┐
│                         OpenCreator Web                          │
│ 已安排管理 | 左侧任务 | 任务会话 | 通知跳转 | 审批          │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTP + SSE
                            ▼
┌────────────────────────────────────────────────────────────┐
│                    OpenCreator Runtime Daemon                   │
│                                                            │
│ ScheduleCoordinator                                        │
│   ├─ ScheduleRepository                                    │
│   ├─ ThreadManager                                         │
│   ├─ ScheduleThreadRepair                                  │
│   └─ SQLite transaction                                    │
│                                                            │
│ SchedulerService                                           │
│   ├─ cron / next_run_at                                    │
│   ├─ queue / skip                                          │
│   └─ RunManager.startRun(threadId)                         │
│                                                            │
│ Agent Schedule Tools                                       │
│   ├─ create                                                │
│   ├─ update                                                │
│   ├─ pause / resume                                        │
│   └─ run_now                                               │
└───────────────────────────┬────────────────────────────────┘
                            │ spawn / resume
                            ▼
┌────────────────────────────────────────────────────────────┐
│                         Codex CLI                          │
│ Agent loop | Skills | MCP | Shell | Files | Web | Tools    │
└────────────────────────────────────────────────────────────┘
```

## 10. 数据模型

### 10.1 `schedules` 新字段

```sql
ALTER TABLE schedules ADD COLUMN thread_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_thread_id
  ON schedules(thread_id)
  WHERE thread_id IS NOT NULL AND deleted_at IS NULL;
```

运行期约束：

1. 新 Schedule 创建完成后 `thread_id` 不允许为空。
2. 更新 Schedule 不允许替换 `thread_id`。
3. 删除只归档绑定 Thread，不清空 `thread_id`。
4. 旧数据迁移期间允许短暂为空。

### 10.2 `threads` 新字段

```sql
ALTER TABLE threads
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'conversation';
```

允许值：

```ts
type ThreadPurpose =
  | 'conversation'
  | 'schedule_draft'
  | 'schedule_task';
```

含义：

| purpose | 含义 |
|---|---|
| `conversation` | 普通用户会话 |
| `schedule_draft` | 使用 OpenCreator 创建任务的草稿会话 |
| `schedule_task` | 已绑定 Schedule 的任务会话 |

### 10.3 现有表的复用

`runs` 不增加新的关系字段，继续使用：

- `thread_id`
- `codex_thread_id`
- `created_by`
- `source_id`

Schedule Run 必须满足：

```text
created_by = "schedule"
source_id = schedules.id
thread_id = schedules.thread_id
```

`schedule_operations` 继续记录：

- 创建
- 更新
- 删除
- 立即执行
- 定时触发
- 跳过
- 排队
- 执行失败

P2 增加审计字段：

```sql
ALTER TABLE schedule_operations ADD COLUMN actor_type TEXT;
ALTER TABLE schedule_operations ADD COLUMN actor_run_id TEXT;
```

`actor_type` 允许：

- `user`
- `agent`
- `timer`
- `migration`

### 10.4 Protocol 类型

```ts
export type ThreadPurpose =
  | 'conversation'
  | 'schedule_draft'
  | 'schedule_task';

export type ThreadResponse = {
  // 现有字段
  purpose: ThreadPurpose;
  scheduleId?: string;
};

export type ScheduleResponse = {
  // 现有字段
  threadId: string;
};
```

`CreateScheduleRequest` 不允许普通客户端指定任意 `threadId`。绑定已有草稿 Thread 只通过受保护的 Agent Tool 内部接口完成。

## 11. 服务职责

### 11.1 `ScheduleCoordinator`

新增协调层，负责跨 Schedule 和 Thread 的原子操作。

建议文件：

```text
apps/daemon/src/scheduler/coordinator.ts
```

接口：

```ts
type ScheduleCoordinator = {
  createManual(input: CreateScheduleRequest): ScheduleResponse;
  createFromAgent(input: AgentCreateScheduleInput): ScheduleResponse;
  update(id: string, input: UpdateScheduleRequest): ScheduleResponse;
  delete(id: string): void;
  ensureBindings(): ScheduleBindingRepairResult;
};
```

职责：

1. 创建 Schedule 时创建或绑定 Thread。
2. 在一个 SQLite transaction 内写入两张表。
3. 更新 Schedule 配置时同步 Thread 配置。
4. 删除 Schedule 时归档 Thread。
5. 启动时修复缺少 Thread 的旧数据。
6. 验证 Thread purpose 和 Schedule 关系。

### 11.2 `SchedulerService`

SchedulerService 只负责：

1. 计算下一次执行时间。
2. 检查到期任务。
3. 根据并发策略决定 queue 或 skip。
4. 创建 Schedule Run。
5. 更新最后运行状态。

不再负责 Schedule 和 Thread 的创建事务。

触发调用必须变为：

```ts
runManager.startRun({
  threadId: schedule.threadId,
  prompt: schedule.prompt,
  executionPrompt: createScheduleExecutionPrompt(schedule, ranAt),
  createdBy: 'schedule',
  sourceId: schedule.id,
  timeoutMs: schedule.timeoutMs ?? undefined
});
```

当传入 `threadId` 后，不再重复传入 `cwd/profile/model/reasoning/sandbox`，由 RunManager 从 Thread 固定配置读取。

### 11.3 `ThreadManager`

需要增加内部能力：

```ts
createThread({
  purpose,
  title,
  cwd,
  workspaceMode: 'external',
  profile,
  model,
  reasoning,
  sandbox
});

updateScheduleThread(threadId, {
  title,
  cwd,
  canonicalCwd,
  profile,
  model,
  reasoning,
  sandbox
});

setPurpose(threadId, 'schedule_task');
```

普通 `PATCH /threads/:id` 不允许绕过 ScheduleCoordinator 修改 `schedule_task` 的执行配置。

### 11.4 `RunManager`

继续承担：

1. 同一 Thread 串行队列。
2. Codex thread 创建和恢复。
3. SSE 事件。
4. 取消、打断和继续。
5. 审批。
6. 失败恢复。

Schedule Run 不增加第二套执行逻辑。

## 12. Agent 创建和管理任务

### 12.1 设计原则

当前 `schedule-natural-language.ts` 是本地正则解析器，只能识别“提醒我”类语句。目标实现必须让 Agent 理解任务并调用结构化工具。

Agent 不直接写 SQLite，不直接调用公开 Bearer Token，也不执行拼接 SQL。

### 12.2 内置 Schedule MCP Tool

新增 OpenCreator 内置 MCP 工具服务，只在 OpenCreator 启动的 Codex Run 中注入，不修改用户全局 Codex 配置。

建议目录：

```text
apps/daemon/src/agent-tools/
  capability-token.ts
  internal-routes.ts
  schedule-tools.ts
  stdio-server.ts
```

工具：

```text
opencreator_schedule_create
opencreator_schedule_update
opencreator_schedule_pause
opencreator_schedule_resume
opencreator_schedule_run_now
opencreator_schedule_get
```

删除任务不在第一批 Agent Tool 中开放，先通过 UI 明确确认。

### 12.3 工具注入方式

1. Daemon 为每个用户发起的 Run 创建短期能力令牌。
2. 令牌只允许访问 Schedule Tool 内部接口。
3. 令牌绑定 `runId` 和 `threadId`，Run 终止后失效。
4. Codex 子进程通过临时 MCP 配置启动 `stdio-server.ts`。
5. MCP 子进程使用短期令牌访问 Daemon 的内部 Schedule Tool 路由。
6. 令牌不得写入 Prompt、事件、诊断导出或普通日志。
7. `createdBy='schedule'` 的自动执行 Run 不注入任务修改工具，避免任务自行修改或重复创建 Schedule。
8. 用户在任务会话中主动发送的普通 Run 可以使用更新、暂停、恢复和立即执行工具。

### 12.4 创建工具输入

```ts
type AgentCreateScheduleInput = {
  name: string;
  task: string;
  timing:
    | {
        type: 'interval';
        everyMinutes: number;
        startTime?: string;
        endTime?: string;
      }
    | {
        type: 'daily';
        time: string;
        weekdaysOnly?: boolean;
      }
    | {
        type: 'weekly';
        weekdays: number[];
        time: string;
      }
    | {
        type: 'cron';
        expression: string;
      };
  timezone?: string;
  enabled?: boolean;
  concurrencyPolicy?: 'queue' | 'skip';
};
```

规则：

1. Tool 不接受任意 `threadId`。
2. 如果当前 Thread 是 `schedule_draft`，绑定当前 Thread。
3. 如果当前 Thread 是普通会话，创建新的 `schedule_task` Thread。
4. `schedule_draft` 使用 OpenCreator 管理的独立工作区，默认 Profile 为 `default`、
   Sandbox 为 `danger-full-access`，不继承创建前选中的项目。
5. Agent 创建工具不接受任意 `cwd`；需要绑定代码仓库或业务目录的任务，应从对应项目
   的普通会话发起，或使用“手动设置”。普通会话发起时，项目、Profile、模型和权限继承
   当前 Thread。
6. 服务端转换 timing 为 cron 并执行最终校验。
7. Tool 返回 `scheduleId`、`threadId`、名称和下次执行时间。

### 12.5 更新工具输入

```ts
type AgentUpdateScheduleInput = {
  scheduleId?: string;
  name?: string;
  task?: string;
  timing?: AgentCreateScheduleInput['timing'];
  timezone?: string;
  enabled?: boolean;
};
```

在 `schedule_task` Thread 中，`scheduleId` 可以省略，由 Thread 绑定关系确定。

普通会话中如未指定任务且存在多个候选，Tool 返回候选列表，Agent 必须询问用户，不能猜测。

## 13. 执行 Prompt 设计

### 13.1 原则

1. 不根据“喝水”“总结”“文稿”等关键词进入不同执行器。
2. Schedule Prompt 始终是普通 Agent 任务。
3. 执行包装只负责说明当前是一次已经到时的执行。
4. 包装内容不能在用户时间线中原样显示。

### 13.2 建议执行包装

```text
这是 OpenCreator 已经触发的一次计划任务执行。

执行规则：
1. 立即完成本次任务，不要重新创建或修改计划任务。
2. 不要询问执行时间，也不要只解释如何完成。
3. 可以使用当前会话可用的文件、Shell、Skills 和 MCP。
4. 如果需要用户审批，正常发起审批并等待。
5. 完成后直接给出本次结果；如果生成了文件，给出可点击的文件路径。

任务名称：{schedule.name}
本次触发时间：{ranAt}
任务内容：
{schedule.prompt}
```

### 13.3 时间线展示

用户时间线展示：

```text
定时执行 · 2026-07-14 18:00
每日总结项目进展，控制在 300 字以内
```

不得把内部执行规则显示成用户消息。

实现方式：

1. Run 保存原始 `prompt` 作为公开输入。
2. `executionPrompt` 只进入 Codex。
3. 历史解析器识别 Schedule Run，根据 Run 元数据替换内部包装的展示文本。
4. Run 详情仍可在诊断信息中显示脱敏后的执行模式，但不展示完整内部 Prompt。

## 14. 并发、排队和中断

### 14.1 活动状态判断

并发判断必须基于 Thread，而不是只检查相同 `source_id` 的 Schedule Run。

原因：

1. 用户可能正在任务会话中主动发送消息。
2. 定时触发不能与用户 Run 同时写入同一会话。
3. 立即执行和自动执行也不能并行。

使用：

```ts
runManager.hasActiveRunForThread(schedule.threadId)
```

### 14.2 `queue`

1. 当前 Thread 有活动或排队 Run 时，设置 `pending_trigger=1`。
2. 多次触发只保留一个 pending trigger。
3. Thread 空闲后创建一次新 Run。
4. 创建 Run 后清空 pending trigger。
5. 页面显示“等待运行”。

### 14.3 `skip`

1. 当前 Thread 有活动或排队 Run 时不创建 Run。
2. 写入 `skip_concurrency` 操作记录。
3. 页面显示“上次已跳过”。

### 14.4 用户打断

任务会话复用现有 `interrupt_and_enqueue`：

1. 用户点击停止或发送“打断并继续”。
2. 当前 Run 取消。
3. 用户新消息作为同一 Thread 的下一个 Run。
4. Schedule 的 pending trigger 继续保留，用户 Run 完成后再执行。

## 15. 审批和无人值守边界

任务页通过“使用 OpenCreator 创建”生成的任务以无人值守执行为默认目标，使用
`danger-full-access`，不进入审批流程。其他入口创建的任务继续遵循其绑定 Thread 的
Sandbox 和审批策略。

规则：

1. `danger-full-access` 映射为 Codex app-server
   `approvalPolicy='never'`，并在 `thread/start`、`thread/resume` 和 `turn/start`
   三处保持一致。
2. 完全访问模式不创建 OpenCreator Approval 记录、不展示审批卡，也不进入
   `waiting_approval`。
3. 如果 app-server 在 `never` 模式下仍发送 command、file、permissions 或
   MCP tool elicitation 审批请求，runner 直接返回批准结果，避免无人值守 Run
   因等待用户操作触发 inactivity timeout。
4. `read-only` 和 `workspace-write` 继续使用 `approvalPolicy='on-request'`，保留
   现有审批卡、通知、批准、拒绝、过期和 queue/skip 处理。
5. 普通 MCP form elicitation 不属于工具审批；当前版本返回 `cancel`，不伪造表单输入。

## 16. 通知设计

### 16.1 通知内容

成功：

```text
标题：每日工作总结
正文：已完成今天的工作总结，共 286 字。
```

提醒：

```text
标题：喝水提醒
正文：该喝水了。
```

失败：

```text
标题：每日工作总结执行失败
正文：项目目录不存在，点击查看详情。
```

等待审批：

```text
标题：每日工作总结等待审批
正文：需要允许执行文件写入操作。
```

### 16.2 通知目标

```ts
type HostNotification = {
  title: string;
  body: string;
  threadId: string;
  runId: string;
};
```

不再为 Schedule 通知使用：

```ts
target: 'schedules'
```

点击流程：

```text
打开 #/thread/{threadId}
  -> 立即显示加载状态
  -> 加载 Thread 历史
  -> 恢复 Run
  -> 定位 runId 对应的最新执行
```

### 16.3 结果摘要

通知正文优先使用：

1. 最后一条 `assistant_message` 的前 120 个字符。
2. 如果没有最终消息，使用任务状态摘要。
3. 不使用内部执行 Prompt。
4. 不在通知中展示敏感诊断信息。

### 16.4 浏览器限制

P0 和 P1 中，浏览器通知依赖页面仍在运行。

P2 增加 Host 后台通知：

1. Daemon 产生通知事件。
2. Desktop Host 或系统适配器订阅。
3. 页面关闭时仍能显示。
4. 点击后启动或聚焦 OpenCreator 并打开任务会话。

## 17. 会话列表、搜索和历史

### 17.1 普通会话与任务会话分组

前端按 `ThreadResponse.purpose` 分组：

- `conversation`：项目普通会话区域。
- 未完成的 `schedule_draft` 和正式 `schedule_task`：左侧“任务”区域。
- “使用 OpenCreator 创建”生成的 `schedule_draft` 使用 `workspaceMode='managed'`，不携带
  当前项目 `cwd`，默认 Profile 为 `default`、Sandbox 为 `danger-full-access`。
- 新建 managed Thread 必须持久化绝对工作区路径；兼容历史相对 `cwd` 时，Run 执行必须
  使用 Thread 的绝对 `canonicalCwd`，避免 Codex app-server 二次相对解析导致 MCP
  启动目录不存在。
- 任务草稿和正式任务的 Composer 不显示普通项目选择器；需要项目目录时，从对应项目
  普通会话发起任务创建，或使用“手动设置”。项目只是任务执行配置，不是任务侧栏归属。

### 17.2 Codex session 索引

旧逻辑会把所有 Schedule 创建的 Codex session 标记为 `kind='schedule'` 并隐藏。新逻辑必须改为：

1. 只有 `runs.created_by='schedule' AND runs.thread_id IS NULL` 的旧孤立 session 标记为 legacy schedule。
2. 有 OpenCreator `thread_id` 的 Schedule session 保持可索引和可搜索。
3. 不再归档绑定 Schedule 的 OpenCreator Thread。
4. 搜索结果可以返回任务会话，并标注“任务”。

### 17.3 历史加载

任务会话使用现有懒加载规则：

1. 刷新页面只加载可见会话列表。
2. 不预加载所有任务历史。
3. 点击任务后才加载对应历史。
4. 切换任务时立即清空旧时间线并显示加载状态。
5. 正在运行时恢复 SSE，不依赖历史加载完成后才订阅。

## 18. 启动修复和旧数据迁移

### 18.1 Schema 迁移

在 `migrate()` 中使用现有 `ensureColumn()` 风格：

1. 增加 `schedules.thread_id`。
2. 增加 `threads.purpose`。
3. 创建唯一部分索引。
4. 将旧 `parallel` 转换为 `queue`。

### 18.2 数据回填

Schema 迁移完成后、Scheduler 启动前执行：

```ts
scheduleCoordinator.ensureBindings();
```

对每条 `deleted_at IS NULL AND thread_id IS NULL` 的 Schedule：

1. 根据 Schedule 配置创建 `workspaceMode='external'` 的 Thread。
2. Thread title 使用 Schedule name。
3. Thread purpose 设置为 `schedule_task`。
4. Schedule 写入 Thread ID。
5. 写入 `schedule_operations.operation='binding_repair'`。
6. 每条 Schedule 单独 transaction，单条失败不阻塞其他 Schedule。
7. 修复失败的 Schedule 自动禁用，并记录错误。

需要扩展操作类型：

```ts
type ScheduleOperationType =
  | ...现有类型
  | 'binding_repair'
  | 'binding_repair_failed';
```

### 18.3 旧 Run

旧版 Run 没有 `thread_id`，不尝试伪造到新会话中，因为底层 Codex session 不同，强行合并会产生错误上下文。

处理方式：

1. 旧 Run 和诊断继续保留。
2. 新专属会话从迁移后的第一次执行开始形成连续历史。
3. “已安排”的高级运行记录中可以查看旧 Run。
4. 旧 Codex session 继续隐藏，避免重复会话。

### 18.4 启动顺序

```text
打开数据库
  -> migrate schema
  -> 构建 ThreadManager
  -> 构建 ScheduleCoordinator
  -> ensureBindings
  -> 修复 Codex session 分类
  -> 构建 SchedulerService
  -> 注册 API
  -> Scheduler.start()
```

Scheduler 不得在绑定修复之前启动。

## 19. API 设计

### 19.1 创建 Schedule

```http
POST /schedules
```

响应增加：

```json
{
  "id": "sch_xxx",
  "threadId": "thread_xxx",
  "name": "每日工作总结"
}
```

服务端必须完成 Schedule + Thread 创建后才返回 `201`。

### 19.2 获取和列表

```http
GET /schedules
GET /schedules/:id
```

每条记录必须包含 `threadId`。

### 19.3 更新

```http
PATCH /schedules/:id
```

更新 Schedule 和 Thread 配置必须处于同一 transaction。

可能错误：

| HTTP | code | 场景 |
|---|---|---|
| 404 | `SCHEDULE_NOT_FOUND` | Schedule 不存在 |
| 409 | `SCHEDULE_HAS_ACTIVE_RUN` | 活动 Run 阻止配置变更 |
| 409 | `SCHEDULE_THREAD_MISSING` | 绑定损坏且自动修复失败 |
| 409 | `SCHEDULE_THREAD_ARCHIVED` | Thread 被异常归档 |
| 422 | `SCHEDULE_INVALID` | 时间或配置无效 |

### 19.4 立即执行

```http
POST /schedules/:id/run-now
```

成功创建 Run：

```json
{
  "run": {
    "id": "run_xxx",
    "threadId": "thread_xxx",
    "status": "running"
  },
  "schedule": {
    "id": "sch_xxx",
    "threadId": "thread_xxx"
  },
  "skipped": false,
  "queued": false
}
```

### 19.5 Thread API

`POST /threads` 增加内部可用字段：

```ts
purpose?: 'conversation' | 'schedule_draft';
```

普通调用默认 `conversation`。

`ThreadResponse` 增加：

```ts
purpose: ThreadPurpose;
scheduleId?: string;
```

## 20. 错误处理

### 20.1 绑定损坏

发现 Schedule 有 `thread_id`，但 Thread 不存在：

1. 不直接创建 Run。
2. 尝试一次自动修复。
3. 修复成功后继续。
4. 修复失败则禁用 Schedule。
5. 写入错误操作记录。
6. 页面显示“任务会话需要修复”。

### 20.2 项目目录不存在

1. 本次 Run 失败。
2. Schedule 保持启用。
3. 通知用户。
4. 页面提供“编辑项目”操作。
5. 连续三次相同错误后显示建议暂停，但不自动删除。

### 20.3 Codex resume 失败

1. RunManager 按现有恢复策略尝试。
2. 如果 Codex thread 无法恢复，使用 OpenCreator 对话摘要重新建立 Codex thread。
3. 更新 `threads.codex_thread_id`。
4. OpenCreator `thread_id` 不变。
5. 在会话中显示一次非阻断诊断：“执行上下文已重新连接”。

### 20.4 Daemon 重启

1. 运行中的 Run 按现有 orphan 规则收敛为失败。
2. Schedule 绑定不变。
3. pending trigger 保留。
4. 重启后根据 misfire 规则处理错过时间。
5. 不创建新的任务 Thread。

## 21. 安全边界

1. Schedule Run 继承 Thread 的 Sandbox，不提升权限。
2. Schedule Tool 使用短期、按 Run 绑定的能力令牌。
3. 自动执行 Run 不拥有修改 Schedule 的工具。
4. Schedule Tool 输入全部经过 Daemon 校验。
5. Tool 不能传入任意 `threadId`。
6. Tool 不能访问其他 Daemon 实例。
7. 通知正文必须经过脱敏。
8. Prompt 和结果中的密钥不得进入通知。
9. 删除仍需 UI 确认。
10. 任务审批不能自动通过。

## 22. 可观测性

每次触发至少记录：

- `schedule_id`
- `thread_id`
- `run_id`
- `trigger_type`
- `scheduled_at`
- `started_at`
- `ended_at`
- `status`
- `queue_reason`
- `error_code`

建议诊断事件：

```text
SCHEDULE_TRIGGERED
SCHEDULE_TRIGGER_QUEUED
SCHEDULE_TRIGGER_SKIPPED
SCHEDULE_THREAD_REPAIRED
SCHEDULE_THREAD_REPAIR_FAILED
SCHEDULE_RUN_STARTED
SCHEDULE_RUN_COMPLETED
SCHEDULE_RUN_WAITING_APPROVAL
```

不得把完整 Prompt、能力令牌或未脱敏结果写入普通日志。

## 23. 测试策略

### 23.1 单元测试

Daemon：

- ScheduleRepository 保存和读取 `thread_id`
- ThreadRepository 保存 `purpose`
- ScheduleCoordinator 原子创建
- ScheduleCoordinator 更新同步
- ScheduleCoordinator 删除归档
- ensureBindings 回填
- Scheduler 传入固定 `threadId`
- queue 和 skip 基于 Thread 活动状态
- legacy session 分类
- Schedule Tool 输入校验和权限

Web：

- 左侧任务分组
- 运行状态旋转
- 点击任务立即显示加载状态
- “已安排”打开任务会话
- 通知跳到 thread + run
- AI 创建草稿会话
- 创建成功后 draft 转 task
- 页面不显示 cron

### 23.2 集成测试

1. 手动创建 Schedule 后同时存在 Thread。
2. 连续两次 `run-now` 使用同一 `threadId`。
3. 第二次 Run 使用同一 Codex thread 或正确恢复。
4. 正在执行时触发 queue，只补执行一次。
5. Schedule 更新同步 Thread。
6. 删除 Schedule 后 Thread 归档。
7. 服务重启后不重复创建 Thread。
8. Agent Tool 创建任务并绑定 draft Thread。
9. Schedule Run 无权调用 Schedule mutation tools。
10. 通知包含正确 `threadId` 和 `runId`。

### 23.3 浏览器端到端测试

使用 Playwright 验证：

1. 创建一个每分钟任务。
2. 左侧“任务”立即出现。
3. 点击立即执行。
4. 任务行显示正在运行。
5. 切换到普通会话，再切回任务。
6. 不显示上一个会话内容。
7. 任务完成后结果出现在同一会话。
8. 再次立即执行，结果追加到同一会话。
9. 点击通知模拟事件，进入正确任务。
10. 桌面和移动视口都能滚动、审批和查看结果。

### 23.4 必跑命令

```bash
pnpm --filter @opencreator/protocol typecheck
pnpm --filter @opencreator/daemon test
pnpm --filter @opencreator/daemon typecheck
pnpm --filter @opencreator/web test
pnpm --filter @opencreator/web typecheck
pnpm build
```

## 24. 分阶段实施计划

所有批次必须：

1. 先补测试，再修改实现。
2. 每批完成后运行该批相关测试和 typecheck。
3. 每批单独提交一次 Git。
4. 不等待中间人工验收，按顺序继续。
5. P0、P1、P2 全部完成后统一验收。

## 25. P0：专属会话执行闭环

P0 目标：从手动创建到定时执行，Schedule 必须稳定复用专属 Thread。

### P0-1：Schema 和 Protocol

**修改内容**

- 为 `schedules` 增加 `thread_id`
- 为 `threads` 增加 `purpose`
- 增加唯一索引
- 扩展 Protocol 类型

**可能修改文件**

- `apps/daemon/src/storage/migrations.ts`
- `packages/protocol/src/api.ts`
- `apps/daemon/src/threads/types.ts`
- `apps/daemon/src/scheduler/types.ts`
- 对应测试文件

**验收**

- [ ] 旧数据库可以无损升级
- [ ] 新数据库字段存在
- [ ] `ScheduleResponse.threadId` 为必填
- [ ] `ThreadResponse.purpose` 为必填
- [ ] 旧 `parallel` 已转换为 `queue`

**验证**

```bash
pnpm --filter @opencreator/protocol typecheck
pnpm --filter @opencreator/daemon test -- scheduler-repository thread-manager
```

### P0-2：Thread purpose 和任务 Thread 查询

**修改内容**

- ThreadManager 支持创建 `schedule_draft` 和 `schedule_task`
- Thread 查询返回 `scheduleId`
- 普通线程配置接口拒绝直接修改 Schedule Thread

**可能修改文件**

- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/threads/types.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/routes.threads.ts`
- `apps/daemon/test/unit/thread-manager.test.ts`

**验收**

- [ ] 默认 Thread purpose 为 `conversation`
- [ ] Schedule Thread 可以被单独识别
- [ ] `scheduleId` 通过绑定关系返回
- [ ] Schedule Thread 不会被普通配置更新破坏

### P0-3：ScheduleCoordinator 创建事务

**修改内容**

- 新增 ScheduleCoordinator
- 手动创建时同时创建外部项目 Thread
- Schedule 和 Thread 在一个 transaction 内提交

**可能修改文件**

- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/threads/manager.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/unit/scheduler-coordinator.test.ts`

**验收**

- [ ] 创建 Schedule 返回 `threadId`
- [ ] Thread title 与 Schedule name 一致
- [ ] Thread 执行配置与 Schedule 一致
- [ ] 任一写入失败时数据库不留下半成品

### P0-4：Schedule 更新和删除事务

**修改内容**

- Schedule 配置更新同步 Thread
- 删除 Schedule 归档 Thread
- 活动 Run 阻止危险配置变更和删除

**可能修改文件**

- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/routes.schedules.ts`
- `apps/daemon/test/unit/scheduler-coordinator.test.ts`

**验收**

- [ ] 修改名称同步 Thread title
- [ ] 修改项目和权限同步 Thread
- [ ] 删除后 Thread 归档
- [ ] 活动 Run 时返回明确 409

### P0-5：Scheduler 使用固定 Thread

**修改内容**

- `startRun()` 传入 `schedule.threadId`
- 不再重复传执行配置
- 并发判断改为 Thread 级别
- 新任务只允许 queue 或 skip

**可能修改文件**

- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/scheduler/validator.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/test/unit/scheduler-service.test.ts`
- `apps/daemon/test/unit/scheduler-validator.test.ts`

**验收**

- [ ] 同一 Schedule 连续 Run 的 `threadId` 相同
- [ ] 第一次运行创建 Codex thread
- [ ] 后续运行恢复 Codex thread
- [ ] 用户 Run 活动时 Schedule 不并行执行
- [ ] queue 重复触发只合并一次

### P0-6：旧 Schedule 绑定修复

**修改内容**

- 增加 `ensureBindings()`
- 启动时回填旧 Schedule
- 失败任务自动禁用并记录

**可能修改文件**

- `apps/daemon/src/scheduler/coordinator.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/src/scheduler/repository.ts`
- `apps/daemon/src/scheduler/types.ts`
- `apps/daemon/test/unit/scheduler-binding-repair.test.ts`

**验收**

- [ ] 每条旧 Schedule 只创建一个 Thread
- [ ] 重复启动不重复创建
- [ ] 单条失败不阻塞其他修复
- [ ] Scheduler 在修复后启动

### P0-7：修正旧 Schedule session 隐藏逻辑

**修改内容**

- 只隐藏没有 OpenCreator Thread 的旧孤立 Schedule session
- 不再归档新任务 Thread
- 新任务会话可以搜索

**可能修改文件**

- `apps/daemon/src/codex/sessions/index-repository.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/server.ts`
- 对应索引和服务器测试

**验收**

- [ ] 新 Schedule Thread 保持 active
- [ ] 旧孤立 session 不进入普通列表
- [ ] 新任务历史可以正常加载和搜索

### P0 检查点

- [ ] 所有 Daemon 单元和集成测试通过
- [ ] 手动创建任务返回专属 Thread
- [ ] 连续立即执行两次进入同一会话
- [ ] 重启后绑定不变
- [ ] 数据库无重复绑定

## 26. P1：完整用户交互

P1 目标：用户可以从“已安排”、左侧“任务”和自然语言完整使用专属任务会话。

### P1-1：前端数据模型和服务

**修改内容**

- 接入 `ScheduleResponse.threadId`
- 接入 `ThreadResponse.purpose`
- 增加任务 Thread 选择器

**可能修改文件**

- `apps/web/src/services/schedule-service.ts`
- `apps/web/src/services/thread-service.ts`
- `apps/web/src/features/projects/project-model.ts`
- `apps/web/src/app/AppController.tsx`
- 对应测试

**验收**

- [ ] 普通会话和任务会话可以稳定分组
- [ ] 缺少 Thread 的异常状态有明确提示

### P1-2：左侧“任务”区域

**修改内容**

- 在侧栏底部增加任务区域
- 显示运行、排队、审批、失败、暂停和未读状态
- 点击时立即进入加载态

**可能修改文件**

- `apps/web/src/features/shell/OpenCreatorSidebar.tsx`
- `apps/web/src/features/shell/opencreator-sidebar.css`
- `apps/web/src/app/AppController.tsx`
- 对应组件测试

**验收**

- [ ] Schedule Thread 不出现在项目普通会话中
- [ ] 正在运行显示旋转图标
- [ ] 点击其他任务不残留上一个会话内容
- [ ] 已暂停任务仍可进入

### P1-3：“已安排”打开任务会话

**修改内容**

- 创建后自动进入 `threadId`
- 任务标题打开专属会话
- 立即执行后进入或保持任务会话
- 诊断信息降为二级入口

**可能修改文件**

- `apps/web/src/features/schedules/SchedulesView.tsx`
- `apps/web/src/features/schedules/ScheduleEditor.tsx`
- `apps/web/src/app/AppController.tsx`
- `apps/web/src/features/schedules/SchedulesView.test.tsx`

**验收**

- [ ] 手动创建后进入专属会话
- [ ] “查看上次运行”定位到同一任务会话
- [ ] 立即执行不会无限转圈

### P1-4：任务会话头部

**修改内容**

- 增加紧凑任务状态栏
- 支持立即执行、暂停、恢复和编辑

**可能修改文件**

- `apps/web/src/features/conversation/ConversationPage.tsx`
- `apps/web/src/features/schedules/ScheduleThreadHeader.tsx`
- 对应 CSS
- `apps/web/src/app/AppController.tsx`
- 对应测试

**验收**

- [ ] 不离开会话即可管理任务
- [ ] 状态变化后及时刷新
- [ ] 移动端不遮挡对话和审批

### P1-5：内置 Schedule Tool 能力令牌

**修改内容**

- 实现短期能力令牌
- 实现内部 Agent Tool 路由
- Run 完成后令牌失效

**可能修改文件**

- `apps/daemon/src/agent-tools/capability-token.ts`
- `apps/daemon/src/agent-tools/internal-routes.ts`
- `apps/daemon/src/api/server.ts`
- 对应安全测试

**验收**

- [ ] 无令牌不能调用
- [ ] 令牌不能跨 Run 或 Thread 使用
- [ ] 令牌不进入日志

### P1-6：Schedule MCP 工具

**修改内容**

- 实现 create、update、pause、resume、run-now、get
- 增加 timing 到 cron 的服务端转换
- 自动执行 Run 不注入修改工具

**可能修改文件**

- `apps/daemon/src/agent-tools/schedule-tools.ts`
- `apps/daemon/src/agent-tools/stdio-server.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/scheduler/coordinator.ts`
- 对应工具测试

**验收**

- [ ] Agent 能创建通用任务，不限提醒
- [ ] Agent 能在任务会话中修改时间和任务内容
- [ ] 自动执行不能修改自身 Schedule
- [ ] 不修改全局 Codex 配置

### P1-7：替换正则创建流程

**修改内容**

- “使用 OpenCreator 创建”创建 `schedule_draft`
- 用户消息走普通 Agent Run
- 删除标题匹配和正则拦截
- Tool 成功后转换为 `schedule_task`

**可能修改文件**

- `apps/web/src/app/AppController.tsx`
- `apps/web/src/features/schedules/schedule-natural-language.ts`
- `apps/web/src/features/schedules/schedule-natural-language.test.ts`
- `apps/web/src/features/schedules/SchedulesView.tsx`
- 相关 App 测试

**验收**

- [ ] “每天生成 100 字文稿”可以创建
- [ ] 缺少时间时 Agent 会追问
- [ ] 创建后当前会话成为任务会话
- [ ] 不再依赖“提醒我”关键词

### P1-8：通知深链接和结果摘要

**修改内容**

- Schedule 通知携带 `threadId` 和 `runId`
- 点击进入任务会话
- 通知正文使用最终结果摘要

**可能修改文件**

- `apps/web/src/features/tasks/task-monitor.ts`
- `apps/web/src/host/bridge.ts`
- `apps/web/src/host/browser-bridge.ts`
- `apps/web/src/app/AppController.tsx`
- 对应测试

**验收**

- [ ] 成功通知显示结果摘要
- [ ] 失败和审批通知进入正确会话
- [ ] 不再跳转到“已安排”

### P1-9：时间线公开输入

**修改内容**

- Schedule Run 展示友好的触发消息
- 隐藏内部执行包装
- 文件链接继续可点击预览

**可能修改文件**

- `apps/daemon/src/scheduler/service.ts`
- `apps/daemon/src/codex/sessions/parser.ts`
- `apps/web/src/features/conversation/*`
- 对应历史和时间线测试

**验收**

- [ ] 用户只看到任务内容和触发时间
- [ ] 不显示内部调度指令
- [ ] HTML 等生成文件可以直接打开预览

### P1 检查点

- [ ] AI 和手动两种方式都能创建任务
- [ ] 左侧任务列表、已安排和会话状态一致
- [ ] 通知可以准确打开任务会话
- [ ] 喝水提醒和生成文稿使用同一执行路径
- [ ] 用户可以在任务会话中修改任务

## 27. P2：长期运行和发布质量

P2 目标：让任务适合长期运行、后台通知和故障恢复。

### P2-1：等待审批和失败体验

**修改内容**

- 任务行显示待审批
- 通知定位审批卡片
- 连续失败展示建议操作

**验收**

- [ ] 无人值守任务不会自动批准
- [ ] 审批恢复后继续同一 Run
- [ ] 错误不只显示技术代码

### P2-2：长期上下文轮换

**修改内容**

- 使用已有会话摘要
- Codex resume 失败或上下文过长时重建 Codex thread
- OpenCreator thread 不变

**验收**

- [ ] 长期任务不会因单个 Codex thread 失效而永久中断
- [ ] 用户历史和任务入口不变化
- [ ] 新 Codex thread 获得必要摘要

### P2-3：后台通知适配

**修改内容**

- Daemon 发出持久通知事件
- Desktop Host 或系统适配器展示通知
- 页面关闭后仍可提醒

**验收**

- [ ] 浏览器页面关闭时，受支持 Host 仍能通知
- [ ] 点击后打开正确任务会话

### P2-4：操作审计和诊断

**修改内容**

- 增加 actor 字段
- 增加 Schedule 诊断事件
- 导出时脱敏

**验收**

- [ ] 可以区分用户、Agent、Timer 和 Migration 操作
- [ ] 可以追踪一次 Trigger 到 Run 和 Thread

### P2-5：完整 E2E 和性能检查

**修改内容**

- 增加两次连续执行 E2E
- 增加切换会话和刷新恢复 E2E
- 检查任务数量较多时的列表性能

**验收**

- [x] 100 个任务时侧栏不预加载全部历史
- [x] 页面刷新只加载任务摘要
- [x] 点击后按需加载会话
- [x] 不出现主线程长时间卡死

### P2 检查点

- [x] 完整自动化测试通过
- [ ] 手动验收矩阵通过
- [x] 升级旧数据库通过
- [x] 回滚演练通过
- [x] 文档和 API 文档更新完成

## 28. 手动验收矩阵

| 场景 | 操作 | 预期 |
|---|---|---|
| AI 创建提醒 | “每 30 分钟提醒我喝水” | 创建任务会话，按时产生简短提醒 |
| AI 创建内容任务 | “每天 9 点生成 100 字文稿” | 无需项目时使用独立任务工作区；需要目录时从项目会话发起或手动设置，生成内容进入同一会话 |
| 手动创建 | 表单提交 | 自动进入专属会话 |
| 连续立即执行 | 连点两次 | 第二次排队或跳过，不并行 |
| 自动执行两次 | 等待两个周期 | 两次结果在同一会话 |
| 切换会话 | 运行时切走再回来 | 不丢输入，不显示旧会话内容 |
| 页面刷新 | 任务运行中刷新 | 会话恢复，Run 状态继续显示 |
| 审批 | 定时任务请求写文件 | 通知并进入审批，不自动批准 |
| 暂停 | 点击暂停 | 不再自动触发，会话仍可进入 |
| 修改 | 在会话说“改成 20:00” | Schedule 更新，下次时间变化 |
| 删除 | 删除无活动任务 | Schedule 隐藏，Thread 归档 |
| 旧数据升级 | 使用现有数据库启动 | 每个旧 Schedule 补一个 Thread，不重复 |
| 通知 | 点击完成通知 | 进入正确 Thread 并定位最新 Run |
| 文件结果 | 生成 HTML | 会话中链接可点击并以预览方式打开 |

## 29. 发布和回滚

### 29.1 发布前

1. 备份本地 SQLite。
2. 记录旧 Schedule 数量。
3. 运行 Schema 迁移。
4. 运行绑定修复。
5. 对比 Schedule 数量和新增 Thread 数量。
6. Scheduler 最后启动。

### 29.2 灰度检查

启动后检查：

```sql
SELECT COUNT(*) FROM schedules
WHERE deleted_at IS NULL AND thread_id IS NULL;
```

结果必须为 `0`。

检查重复绑定：

```sql
SELECT thread_id, COUNT(*)
FROM schedules
WHERE deleted_at IS NULL
GROUP BY thread_id
HAVING COUNT(*) > 1;
```

结果必须为空。

### 29.3 回滚

回滚代码时：

1. 不删除新字段。
2. 停止新版 Scheduler。
3. 回滚应用代码。
4. 旧代码可以忽略新增字段。
5. 已创建的任务 Thread 保留。
6. 不反向删除或合并 Codex session。

数据库迁移只增列和增索引，不执行破坏性降级。

## 30. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 旧隐藏逻辑归档新任务 Thread | 用户看不到任务会话 | P0 优先修正 session 分类和归档条件 |
| 同一 Thread 并行写入 | 历史错乱、恢复失败 | 禁止 parallel，基于 Thread 判断活动状态 |
| Schedule 和 Thread 配置不一致 | 执行项目或权限错误 | 使用 ScheduleCoordinator transaction |
| Agent Tool 泄露 Daemon Token | 本地权限扩大 | 使用短期作用域令牌，不传完整 Token |
| Agent 创建错误时间 | 任务执行时间错误 | 结构化 timing、服务端校验、回复下次执行时间 |
| 页面关闭后无通知 | 用户错过提醒 | P2 后台 Host 通知，P1 明确浏览器限制 |
| Codex thread 过长 | 长期任务失败 | P2 摘要和底层 thread 轮换 |
| 迁移创建重复 Thread | 任务列表重复 | 唯一索引、逐条 transaction、幂等 repair |
| 正则创建逻辑残留 | 通用任务仍无法创建 | P1 删除特殊提交分支和标题判断 |

## 31. 实施边界

### 必须始终做到

1. Schedule 新建和 Thread 绑定必须原子化。
2. 每个实现批次必须有测试。
3. Schedule Run 必须使用固定 `threadId`。
4. 同一任务会话必须串行。
5. 通知必须携带 Thread 和 Run。
6. 所有用户文案使用普通用户可理解的语言。

### 修改前必须更新本文

1. 改成一对多 Schedule 与 Thread 关系。
2. 恢复 `parallel`。
3. 让 Codex 官方调度替代 OpenCreator Scheduler。
4. 允许自动审批。
5. 改变删除和历史保留策略。

### 禁止

1. 重新用标题字符串识别 Schedule Thread。
2. 继续用正则表达式冒充 AI 创建任务。
3. 为提醒、总结、文稿分别建立独立执行器。
4. Schedule Run 不传 `threadId`。
5. 通知只跳到“已安排”。
6. 为了隐藏旧孤立 session 而归档所有 Schedule Thread。

## 32. 最终完成定义

只有同时满足以下条件，整个任务才算完成：

1. AI 创建和手动创建都可用。
2. 每个 Schedule 有且只有一个专属 Thread。
3. 同一 Schedule 多次运行始终进入同一 Thread。
4. 定时任务使用 OpenCreator 普通 Agent 的完整执行能力。
5. 左侧“任务”正确展示长期任务会话。
6. “已安排”与任务会话职责清晰且可以互相跳转。
7. 通知点击进入任务会话。
8. 正在运行、排队、审批、失败、暂停状态一致。
9. 旧数据升级不丢 Schedule，不生成重复 Thread。
10. 页面刷新和会话切换不丢运行状态。
11. P0、P1、P2 的自动化测试和手动验收矩阵全部通过。
