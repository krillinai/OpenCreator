# OpenCreator app-server 常驻化实施计划

> 状态：已完成（2026-07-28）
> 来源方案：`docs/specs/opencreator-app-server常驻化方案-2026-07-28.md`
> 方案批准证据：用户在 Reviewer 风险披露后回复“没问题，继续”；来源方案记录为“已批准（2026-07-28）”
> 方案 Reviewer 原始结论：BLOCKED（Reviewer 无本地只读文件能力，用户已知情接受）
> 方案流程结论：PASS（用户知情批准）
> Plan Reviewer 原始结论：REVISE
> Plan 流程结论：PASS
> 执行授权：用户已明确“开始执行”（2026-07-28）
> 体量判断：标准 Plan。交付跨越 app-server 生命周期、全局串行执行、运行级权限映射和 Daemon 关闭顺序，但共享同一发布与验收边界，不满足拆分为多个独立 Plan 的条件。

## 契约快照

### 目标

让用户主动发起的 OpenCreator 对话复用一个由 Daemon 管理的常驻 `codex app-server --stdio`，消除同 profile 热路径中的重复进程启动、`initialize` 和固定 MCP 初始化；后台定时任务继续使用现有一次性 app-server。

### 非目标

- 不实现多 app-server 进程池或多 turn 并发。
- 不将后台定时任务常驻化。
- 不自动恢复或重放已经提交的 turn。
- 不合并会话查询 `app-server-client` 与执行客户端。
- 不接入 `codex app-server daemon/proxy`、系统服务或全局 socket。
- 不修改 Web/Desktop 页面、组件、样式或业务接口。
- 不迁移数据库、项目或会话数据。

### 需求与规则

| ID | 优先级 | 不可降低的执行约束 |
|---|---|---|
| FR-1 | P0 | 同 profile 的用户手动运行复用一个常驻执行 app-server；单个 turn 完成后进程保持运行。 |
| FR-2 | P0 | `cwd/model/sandbox/reasoning/approvalPolicy` 按运行发送；项目切换不重启，profile 改变时受控重启。 |
| FR-3 | P0 | 新建/续接会话、事件输出、两档权限、审批和取消的外部语义保持不变。 |
| FR-4 | P0 | 手动对话保留日程工具；后台定时任务继续使用一次性进程和受限运行令牌。 |
| FR-5 | P0 | 常驻进程异常只终止当前 run；下一次手动运行自动创建新进程。 |
| BR-1 | P0 | 常驻执行器同一时刻只有一个活动 turn；后续 run 必须保持 `queued`，直到真正获得执行槽。 |
| BR-2 | P0 | 已提交的 `turn/start` 不得自动重放；profile 切换和进程替换只在当前 turn 结束后发生。 |
| NFR-1 | P0 | 不扩大后台权限，不产生 Web/Desktop 分叉，Daemon 退出后不残留 Codex 子进程。 |
| NFR-2 | P1 | 可追踪 app-server 的启动、初始化、复用、重启、退出原因及关键运行时间点。 |

### 关键设计决策

| ID | 不得改变的决定 |
|---|---|
| DEC-1 | 用户手动运行走一个常驻执行器；后台定时任务继续走现有一次性 `startCodexAppServer`。 |
| DEC-2 | 第一版由 RunManager 维护唯一 FIFO 串行队列，执行器只维护唯一 `activeRun`，不实现并发事件路由表。 |
| DEC-3 | 交互式进程使用进程级凭证；凭证只有绑定当前活动 run 后才能授权，空闲时拒绝 MCP 请求。 |
| DEC-4 | 运行参数按 thread/turn 发送；profile 作为进程键，变化时关闭并重建进程。 |
| DEC-5 | 崩溃、协议错误或 interrupt 失败时不重放 turn；清除进程后由下一轮重新创建。 |

### 接口与状态约束

#### 进程凭证

在 `AgentCapabilityTokenStore` 上新增进程租约，不改变现有运行令牌的行为：

```ts
export type AgentCapabilityProcessLease = {
  token: string;
  activate(input: {
    runId: string;
    threadId: string;
    createdBy: 'api';
    scopes: AgentCapabilityScope[];
  }): AgentCapabilityGrant;
  deactivate(runId: string): boolean;
  revoke(): boolean;
};

export type AgentCapabilityTokenStore = {
  // 现有方法保持
  issueProcess(input: {
    createdBy: 'api';
    maxScopes: AgentCapabilityScope[];
  }): AgentCapabilityProcessLease;
};
```

约束：

- 租约 token 与活动 grant 是两个生命周期：token 只在 `lease.revoke()`、进程退出或 Store `close()` 时失效，不受五分钟活动 TTL 影响。
- `activate` 每次创建一个新的活动 grant；已有未过期活动 grant 时必须拒绝重复激活。
- scopes 必须是 `maxScopes` 的子集；自动后台身份不能创建进程租约。
- `inspect/authorize` 对进程 token 返回当前活动 grant；没有活动 grant时抛出新的 `CAPABILITY_CONTEXT_INACTIVE`（HTTP 403）。
- 活动 grant 沿用现有 TTL。过期只清除活动绑定；同一 token 在下一轮可以重新 `activate`。
- `deactivate(runId)` 只有在 runId 与当前 grant 完全匹配时才能清除；旧 run 的迟到清理不得影响新 run。
- `revokeRun(runId)` 对运行令牌保持撤销语义；对匹配的进程租约只清除活动 grant。
- 第一个 run 必须先 `activate`，再执行 spawn/initialize；每个 run 的所有终态都在 `finally` 中调用匹配 runId 的 `deactivate`。

#### 常驻日程工具注入

在 `run-injection.ts` 中增加：

```ts
export type AgentToolProcessInjection = {
  mcpServers: CodexMcpServerConfig[];
  env: Record<string, string>;
  activate(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api';
  }): {
    manifestKey: string;
  };
  deactivate(runId: string): void;
  close(): void;
};

export type AgentScheduleProcessInjector = {
  create(): AgentToolProcessInjection | undefined;
};
```

进程 MCP 配置不写静态 `enabled_tools`，避免把某一轮的工具目录固化到进程。每轮由 `allowedTools('api', thread)` 同时得到：

- 活动 grant 的 scopes。
- 排序后的工具名集合 `manifestKey`。
- MCP HTTP route 本轮实际注册的工具集合。

`authorizeMcpRequest` 返回当前 grant；`createAgentScheduleMcpServer` 新增 `enabledTools` 输入，只注册 grant scopes 对应的工具。Host 在 thread 已 start/resume、turn 尚未 start 时比较 `manifestKey`：

- 首轮或 manifest 变化：发送绑定 Codex 版本支持的 `config/mcpServer/reload`，等待成功后再发送 `turn/start`。
- manifest 未变化：直接复用已缓存工具目录，不重复 MCP refresh。
- refresh 失败：当前 run 失败并将 Host 标记为不可复用。

conversation thread 在“请求批准/完全访问权限”之间切换不会改变日程 manifest；`schedule_task` 等 scope 变化会刷新工具目录但不得重启进程。后台运行仍使用现有静态 `enabledTools` 和每轮令牌。

#### app-server Host

新增 `apps/daemon/src/codex/app-server-host-2026-07-28.ts`：

```ts
export type CodexAppServerHost = {
  readonly pid: number | undefined;
  run(input: CodexAppServerTurnInput): CodexAppServerProcess;
  close(reason?: string): Promise<void>;
};

export function createCodexAppServerHost(
  input: CodexAppServerHostInput
): CodexAppServerHost;
```

Host 拥有一个已初始化的子进程和 JSON-RPC pending map，只允许一个活动 turn。`turn/completed` 只结束当前 turn，不关闭 Host。进程关闭会拒绝当前 turn 和所有 pending 请求。

Host 状态固定为：

```text
starting -> ready -> turn_active -> ready
    |          |          |
    +----------+----------+-> closing -> closed
                           \-> failed -> closed
```

每轮 job 状态固定为：

```text
acquiring
-> thread_starting
-> mcp_refreshing（仅 manifest 变化）
-> turn_start_written
-> turn_active
-> interrupting（可选）
-> settled
```

状态规则：

- 每轮分配单调递增 `generation`；pending RPC 保存 generation。
- `turn/start` 写入 stdin 后即进入不可自动重放边界。
- 所有 response、notification 和 server request 必须匹配当前 generation；审批和 turn 通知还必须匹配活动 threadId/turnId。
- 迟到或无法归属的 server request 返回错误，通知丢弃并记录诊断，不能进入下一 run。
- initialize、thread start/resume、MCP refresh、turn start、审批等待或 interrupt 任一阶段出现进程退出，必须一次性拒绝全部 pending 和当前 job。
- JSON 解析错误、RPC 协议错误、interrupt 错误、interrupt 后未收到匹配 `turn/completed`，都把 Host 标记为不可复用并关闭。
- 只有收到当前 turn 的 `turn/completed`，包括成功 interrupt 后的 interrupted 终态，Host 才能回到 ready。
- job 的 resolve/reject/finalize 必须通过单一 `settleOnce`，禁止重复终态。

现有 `startCodexAppServer(input)` 改为兼容包装：创建 Host、执行一轮、在结果 settle 后关闭 Host。后台任务和旧测试继续调用该函数。

#### 常驻执行器

新增 `apps/daemon/src/runs/persistent-app-server-executor-2026-07-28.ts`：

```ts
export type PersistentAppServerExecution = CodexAppServerProcess & {
  started: Promise<{
    pid: number;
    reused: boolean;
  }>;
};

export type PersistentAppServerExecutor = {
  start(input: PersistentAppServerExecutionInput): PersistentAppServerExecution;
  isBusy(): boolean;
  close(input?: {
    interruptGraceMs?: number;
    terminateGraceMs?: number;
  }): Promise<void>;
};
```

执行器只拥有当前 profile、Host、进程工具注入和唯一活动 job，不再拥有第二套队列。RunManager 是全部手动 app-server run 的唯一排队所有者。执行器 busy 时拒绝第二个 `start`，使双重排队成为测试可见错误。

执行器在每轮开始时先激活进程 grant，再创建/复用 Host；Host 完成 thread start/resume 后按 `manifestKey` 决定是否刷新 MCP，再发送 turn。活动取消优先 interrupt；失败时关闭 Host。profile 比较使用已验证的精确 profile 名称，`default` 始终归一为同一个进程键。

#### RunManager 状态

RunManager 增加唯一的 `persistentRunQueue` 和 `runningPersistentRunId`：

- 所有符合常驻条件的手动 app-server run 在 `startRun` 时立即取得单调 `submissionSequence`。
- 当前无 persistent run 时直接启动；否则进入 `persistentRunQueue`，公开状态为 queued。
- 普通 `enqueue` 严格按 submissionSequence FIFO。
- `interrupt_and_enqueue` 和显式 `steerRun` 是保留现有用户语义的唯一重排入口；它们必须显式记录重排原因，普通 run 不得越序。
- 同线程 `threadQueues` 不再接收 persistent 手动 run，只继续服务 schedule、exec transport 和一次性回退路径。
- resume mode、Codex thread ID、profile 和运行参数在 run 真正出队时重新解析，保证同线程前一轮的绑定已经落库。
- `queuePosition` 只来自 `persistentRunQueue`；不存在第二个位置来源。
- `cancelRun` 能从唯一队列移除 queued run，且不调用执行器、不发送 Codex 请求。
- A1 执行中依次提交同线程 A2、另一线程 B1 时，普通 enqueue 的执行顺序必须是 A1、A2、B1。
- schedule run 或常驻执行器未启用时继续调用一次性 runner。

### 失败与回滚

- 启动/initialize 失败：当前 run 失败，全部 pending 结算，Host 和进程凭证清除。
- 活动 turn 中进程退出：当前 run 只失败一次；下一个出队 run 创建新 Host。
- 排队 run 取消：从 RunManager 唯一队列移除，不调用执行器。
- interrupt 请求成功且收到匹配 interrupted/completed 终态：当前 run 取消，Host 可复用。
- interrupt 失败、超时或无匹配终态：Host 进入 failed，执行 SIGTERM；宽限期后仍存活则 SIGKILL，并等待进程 close，禁止重放。
- profile 改变：当前 run 结束后关闭旧 Host并等待退出，再启动新 Host；A→B→A 队列会按顺序完成两次受控切换。
- Daemon 关闭由 RunManager/执行器单一拥有子进程终止：
  1. Server 标记 closing，停止 scheduler 和新 run。
  2. RunManager 取消 persistent/thread queued run 并写入终态。
  3. RunManager 请求活动 run interrupt。
  4. 执行器等待 `interruptGraceMs`，超时后 SIGTERM。
  5. 再等待 `terminateGraceMs`，超时后 SIGKILL，并等待 child close。
  6. 当前 run 完成 finalization、日志落盘，进程 grant deactivate，lease revoke。
  7. RunManager close 返回后关闭会话 `codexSessionProvider`。
  8. 关闭 capability Store。
  9. 最后关闭数据库。
- 所有 close 操作必须幂等；任一步错误不能跳过后续资源释放，最终聚合并抛出首个关闭错误。
- 无数据库迁移。回滚只需将手动 run 路由恢复到保留的一次性 runner；数据无需回滚。

### 已接受风险

来源方案没有获得实质性独立代码审核，因为 Reviewer 环境缺少文件读取能力。用户已知情批准。实施时必须把以下内容作为熔断项：

- 进程凭证出现后台权限扩大或 run/thread 归属错误。
- 排队 run 被错误显示为运行中或事件串线。
- 关闭顺序导致凭证提前失效或 Codex 子进程残留。
- 为实现常驻而改变 FR/BR/NFR/DEC/AC。

## 基线与文件地图

### Git 基线

- 分支：`codex-native-runtime-kernel`
- 生成 Plan 时 HEAD：`949662538b8b6a9311967310529f88fac2580708`
- 工作区存在与本任务无关的图标、Desktop、Web 资源、Skill 和 `.tmp/` 修改；执行者不得还原、覆盖或提交这些修改。

### 关键文件与符号

| 路径 | 当前符号/职责 | 本次动作 |
|---|---|---|
| `apps/daemon/src/codex/app-server-runner.ts` | `startCodexAppServer`、审批响应、thread/turn 协议 | 提取 Host 可复用协议状态，保留一次性包装 |
| `apps/daemon/src/codex/app-server-host-2026-07-28.ts` | 新文件 | 常驻子进程、JSON-RPC、单 turn 生命周期 |
| `apps/daemon/src/runs/persistent-app-server-executor-2026-07-28.ts` | 新文件 | 单活动 job、profile 重启、取消、进程注入、close |
| `apps/daemon/src/runs/manager.ts` | `createRunManager`、`startExistingRun`、`ActiveRun`、`close` | 手动/后台路由、排队状态、诊断和关闭 |
| `apps/daemon/src/api/server.ts` | `buildServer`、`onClose` | 创建常驻执行器和进程注入，调整关闭顺序 |
| `apps/daemon/src/main.ts` | 生产 Server 启动/关闭 | 接入默认启用和紧急回退环境开关 |
| `apps/daemon/src/agent-tools/capability-token.ts` | `createAgentCapabilityTokenStore` | 进程租约和活动 grant |
| `apps/daemon/src/agent-tools/run-injection.ts` | `createAgentScheduleRunInjector`、`allowedTools` | 增加交互式进程注入，保留后台运行注入 |
| `apps/daemon/src/agent-tools/stdio-server.ts` | `createAgentScheduleMcpServer` | 按活动 grant 动态注册本轮工具目录 |
| `apps/daemon/src/agent-tools/internal-routes.ts` | `authorizeRequest`、`toActor` | 映射 inactive 错误，继续使用活动 grant 构造 actor |
| `apps/daemon/src/agent-tools/mcp-routes.ts` | `authorizeMcpRequest` | 对 inactive 进程 token 返回 403 |
| `apps/daemon/test/unit/agent-capability-token.test.ts` | 运行令牌测试 | 增加进程租约状态测试 |
| `apps/daemon/test/unit/agent-tool-run-injection.test.ts` | 每轮注入测试 | 增加进程注入和动态 scope 测试 |
| `apps/daemon/test/unit/codex-app-server-runner.test.ts` | 一次性 app-server Fake | 增加 Host 多轮和兼容包装回归 |
| `apps/daemon/test/unit/persistent-app-server-executor-2026-07-28.test.ts` | 新文件 | 常驻复用、busy 拒绝、profile、取消、崩溃和 close |
| `apps/daemon/test/integration/run-manager.test.ts` | RunManager 行为 | 手动常驻、跨线程队列、schedule 单次、诊断 |
| `apps/daemon/test/integration/approval-runtime.test.ts` | app-server 审批/取消/旋转 | 常驻路径审批、全权限和续接回归 |
| `apps/daemon/test/integration/agent-tool-api.test.ts` | 能力路由和 MCP HTTP | 活动 run actor、后台隔离、关闭顺序 |
| `apps/daemon/test/smoke/real-codex-smoke.test.ts` | 真实 Codex Runtime | 连续多轮 PID/复用/关闭验证 |
| `codex-main/codex-rs/app-server/src/request_processors/mcp_processor.rs` | `config/mcpServer/reload` 本地绑定源码证据 | 只读核验，不修改 |
| `codex-main/codex-rs/app-server/src/mcp_refresh.rs` | reload 为已加载 thread 刷新 MCP runtime/tool cache | 只读核验，不修改 |

### 公共命令

所有命令在仓库根目录 `/Users/wulien/develop/opencreator/opencreator-agent` 执行。

| 名称 | 命令 | 预期 |
|---|---|---|
| Capability 测试 | `pnpm --filter @opencreator/daemon test -- test/unit/agent-capability-token.test.ts test/unit/agent-tool-run-injection.test.ts test/integration/agent-tool-api.test.ts` | 退出码 0 |
| Runner 测试 | `pnpm --filter @opencreator/daemon test -- test/unit/codex-app-server-runner.test.ts test/unit/persistent-app-server-executor-2026-07-28.test.ts` | 退出码 0 |
| RunManager 回归 | `pnpm --filter @opencreator/daemon test -- test/integration/run-manager.test.ts test/integration/approval-runtime.test.ts` | 退出码 0 |
| Daemon 全量测试 | `pnpm --filter @opencreator/daemon test` | 退出码 0 |
| Daemon 类型检查 | `pnpm --filter @opencreator/daemon typecheck` | 退出码 0 |
| 仓库类型检查 | `pnpm typecheck` | 退出码 0 |
| 真实 Codex smoke | `OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts` | 退出码 0 |
| Web 构建 | `pnpm --filter @opencreator/web build` | 退出码 0 |
| Desktop 测试 | `pnpm --filter @opencreator/desktop test` | 退出码 0 |
| Desktop 打包 | `pnpm --filter @opencreator/desktop package` | 退出码 0，生成目录包 |
| Desktop 包校验 | `pnpm --filter @opencreator/desktop verify:package` | 退出码 0 |
| Desktop E2E | `pnpm --filter @opencreator/desktop e2e:package` | 退出码 0 |
| Desktop 真实 Codex | `OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/desktop e2e:real-codex` | 退出码 0 |

## 追踪矩阵

| 实施任务 | 需求/规则 | 关键决策 | 自动化测试 | 功能验收 |
|---|---|---|---|---|
| TASK-1 | FR-4、NFR-1 | DEC-3 | capability、run-injection、agent-tool API | AC-5 |
| TASK-2 | FR-1、FR-2、FR-5、BR-2 | DEC-1、DEC-4、DEC-5 | Host、一次性 wrapper、persistent executor | AC-1、AC-2、AC-6、AC-7 |
| TASK-3 | FR-1、FR-2、FR-3、FR-4、FR-5、BR-1、BR-2、NFR-1 | DEC-1..DEC-5 | RunManager、approval runtime、agent-tool API | AC-1..AC-7 |
| TASK-4 | NFR-1、NFR-2 | DEC-1、DEC-4、DEC-5 | close、diagnostics、真实 Codex smoke、Desktop | AC-1、AC-2、AC-4、AC-6、AC-7 |
| TASK-5 | 全部 P0/P1 | 全部 DEC | 全量回归和真实边界 | AC-1..AC-7 |

## 实施任务

### TASK-0：确认 Plan 仍然有效

**交付结果**

- 确认执行起点仍满足已批准方案，且未误触用户现有修改。

**实施步骤**

1. 记录当前分支、HEAD 和 `git status --short`，与本 Plan 基线比较。
2. 定向确认文件地图中的路径和符号仍存在。
3. 确认 Codex 绑定版本仍支持 `initialize`、`thread/start|resume`、`turn/start|interrupt` 和 `config/mcpServer/reload`；通过 Fake 请求先验证 reload 方法存在并返回成功。
4. 固化现有一次性路径的工具目录基线：conversation thread 在请求批准/完全访问权限下工具集合一致；schedule_task 手动 run 不包含 create；后台 run 仅包含 get。
5. 确认工作区无其他修改已经改变 `AgentCapabilityTokenStore`、`startCodexAppServer`、`RunManagerOptions` 或 Server `onClose` 契约。
6. 若绑定 Codex 不支持 refresh，或同 PID 无法在 scope 变化后刷新准确工具目录，停止并返回 Brainstorm，不得用“暴露全部工具但后端 403”降低 FR-3。
7. 若仅有无关变化或局部路径变化，记录偏差并继续；若 DEC、权限、状态或 AC 失效，停止并更新方案/Plan。

**任务完成门**

- 基线有效，或者所有非契约偏差已经记录。

### TASK-1：实现进程凭证与活动 run 权限映射 `[FR-4, NFR-1, DEC-3, AC-5]`

**交付结果**

- 同一个交互式进程 token 可以在不同串行 run 之间复用，但任意时刻只授权当前活动 run/thread 的 scopes。
- 后台运行令牌、TTL、撤销和禁止 mutation 的现有行为不变。

**文件与符号**

- 修改：`apps/daemon/src/agent-tools/capability-token.ts` - `AgentCapabilityTokenStore`、`createAgentCapabilityTokenStore`
- 修改：`apps/daemon/src/agent-tools/run-injection.ts` - `allowedTools`、新增 `createAgentScheduleProcessInjector`
- 修改：`apps/daemon/src/agent-tools/stdio-server.ts` - `createAgentScheduleMcpServer`
- 修改：`apps/daemon/src/agent-tools/internal-routes.ts` - `capabilityErrorMessage`
- 修改：`apps/daemon/src/agent-tools/mcp-routes.ts` - `authorizeMcpRequest`
- 测试：`apps/daemon/test/unit/agent-capability-token.test.ts`
- 测试：`apps/daemon/test/unit/agent-tool-run-injection.test.ts`
- 测试：`apps/daemon/test/integration/agent-tool-api.test.ts`

这些文件共同定义一个不可拆的权限边界，虽然超过五个文件，但拆分会导致 token、注入和 HTTP 授权在中间状态不一致。

**实施步骤**

1. 将 token record 改为运行记录与进程记录的判别联合；保持现有 token 前缀和摘要存储。
2. 实现 `issueProcess`，限制 `createdBy` 为 `api`，保存最大 scopes，但不创建活动 grant；租约 record 本身没有 TTL。
3. 实现 lease 的 `activate/deactivate/revoke`；`activate` 拒绝越过最大 scopes和重复活动 grant，生成独立的带现有 TTL grant。
4. 让 `inspect/authorize` 对进程记录解析活动 grant；inactive 返回 `CAPABILITY_CONTEXT_INACTIVE` 403。
5. `cleanupExpired` 对进程记录只清除过期 active grant；使用同 token 的下一轮可重新激活。
6. 让 `revokeRun` 对匹配的进程活动 grant 执行 deactivate，而不是销毁租约；`deactivate` 必须匹配 runId。
7. 提取并复用 `allowedTools`，实现进程注入的固定 MCP 连接、动态 activate、`manifestKey` 和 close。
8. 让 MCP route 从当前 grant 计算 enabledTools，并只注册本轮允许工具；进程配置不再设置静态 enabledTools。
9. 内部路由继续只信任 token 中解析出的 grant，不接受请求体覆盖 run/thread。
10. 保持自动后台 run 只能使用原有每轮令牌，且 mutation scopes 在 Store 和 route 两层都拒绝。

**TDD**

- 策略：必须。
- RED：新增“process lease is inactive until a run is activated and cannot exceed max scopes”。创建进程租约后直接 `authorize` 应因 `CAPABILITY_CONTEXT_INACTIVE` 失败；activate conversation run 后 actor 匹配 run/thread；越权 scope 失败；deactivate 后再次 inactive。当前无 `issueProcess`，业务断言失败。
- RED：新增“reuses one process token across two sequential runs without leaking the previous actor”。同 token 依次激活 run-1/thread-1 和 run-2/thread-2，第二轮授权不得返回第一轮 actor。
- RED：使用可控时钟新增“process token survives active grant expiry and can be activated again”。时间跨过五分钟后旧 grant inactive，同 token 新 activation 成功。
- RED：新增“late deactivate from run-1 cannot clear run-2”和“double activation is rejected”。
- RED：新增 HTTP/MCP 集成场景：conversation active 时列出全部允许工具；schedule_task active 时同 token 不列出 create；deactivate 后同 token 返回 403；schedule token 仍不能 mutation。
- GREEN：只实现上述 lease、动态 grant 和进程注入，不修改日程 CRUD 或线程可访问规则。
- REFACTOR：统一运行令牌与进程 grant 的校验帮助函数，运行 Capability 测试和现有 agent-tool 回归。

**任务完成门**

- Capability 测试通过。
- 现有运行令牌测试无修改语义。
- AC-5 的权限前置行为可由自动化测试证明。

### TASK-2：实现可复用 Host 和单活动执行器 `[FR-1, FR-2, FR-5, BR-2, DEC-1, DEC-4, DEC-5, AC-1, AC-2, AC-6, AC-7]`

**交付结果**

- 同 profile 多轮只创建和初始化一个 Host。
- 项目和所有非 profile 参数变化复用；profile 切换重启。
- 崩溃和取消不重放 turn。

**文件与符号**

- 创建：`apps/daemon/src/codex/app-server-host-2026-07-28.ts` - `createCodexAppServerHost`
- 创建：`apps/daemon/src/runs/persistent-app-server-executor-2026-07-28.ts` - `createPersistentAppServerExecutor`
- 修改：`apps/daemon/src/codex/app-server-runner.ts` - `startCodexAppServer`
- 测试：`apps/daemon/test/unit/codex-app-server-runner.test.ts`
- 创建测试：`apps/daemon/test/unit/persistent-app-server-executor-2026-07-28.test.ts`

**实施步骤**

1. 从一次性 runner 中提取进程级 JSON-RPC、stdout frame、stderr、审批响应和 pending request 管理到 Host。
2. 实现 Host/job 状态机、generation 和 `settleOnce`；将 timer、thread/turn ID、回调和结果限制在当前活动 generation。
3. 进程 exit/close 必须拒绝全部 pending RPC 和活动 job；RPC response 按 request generation 结算。
4. Host 拒绝并发 `run()`，并验证审批请求、通知的 thread/turn 与活动 turn 一致；无法归属的请求返回错误或丢弃诊断。
5. thread start/resume 后，若进程工具 manifest 首次出现或变化，发送 `config/mcpServer/reload` 并等待成功；失败关闭 Host。
6. `turn/start` 写入后设置不可重放标志；任何不确定失败都关闭 Host。
7. 成功 interrupt 必须等待匹配 terminal notification；仅收到 interrupt RPC response 不足以复用。
8. 保留 `startCodexAppServer` 公共签名，内部用 Host 执行一次并在 settle 后 close，确保后台任务行为不变。
9. 执行器只允许一个活动 job；busy 时第二次 start 立即失败，队列由 RunManager 管理。
10. 第一个 job 或 profile 变化时创建 Host；同 profile 后续 job复用并返回 `reused: true`。
11. 首次创建 Host 前先 activate；所有 job 终态在 finally 中 deactivate。manifest 变化只 refresh，不重启。
12. Host 异常退出时拒绝当前 job、关闭进程注入并清空 Host；下一次 start 创建新 Host。
13. `close()` 幂等执行 interrupt→SIGTERM→SIGKILL 有界升级，并等待 child close、lease revoke。
14. 通过结构化生命周期事件记录 process_started、process_initialized、process_reused、mcp_refreshed、profile_restarted、process_exited、run_assigned、run_cleared。

**TDD**

- 策略：必须。
- RED：新增“reuses one initialized process for sequential turns with different cwd”。Fake app-server 记录 spawn/initialize/thread/turn；两轮不同 cwd 后断言 spawn=1、initialize=1、turn=2、cwd 分别正确。当前一次性 runner 会 spawn=2。
- RED：表驱动改变 model、sandbox、reasoning、approvalPolicy、cwd 和 manifest scopes，断言同 PID、一次 initialize、thread/turn payload 使用新值；manifest 变化只出现 MCP refresh。
- RED：新增“restarts exactly once after normalized profile changes”和 A→B→A 顺序切换；旧新 PID 不重叠。
- RED：分别在 initialize、thread/resume、MCP refresh、turn/start 写入前后、审批等待和 interrupt 超时注入失败；每个 job 只 settle 一次，pending 全部结算，失败后下一轮新 PID 成功。
- RED：新增“drops late notifications from an older generation”和“interrupt terminal success keeps the Host reusable”。
- RED：新增“same PID refreshes tools for conversation→schedule_task→conversation without exposing stale tools”。
- 基线：现有审批 payload、MCP elicitation、full-access auto approval 和一次性 MCP env 测试允许先通过，用于保护协议兼容。
- GREEN：完成 Host 与执行器最小状态机，不增加并发路由、进程池或自动重放。
- REFACTOR：只抽取重复的 request/response、timer 和 shutdown 帮助函数，运行 Runner 测试。

**任务完成门**

- Runner 测试通过。
- Fake app-server 可证明 AC-1、AC-2、AC-6、AC-7 的底层生命周期和所有 pending 结算。

### TASK-3：接入 RunManager，保持队列、审批、续接和后台路径 `[FR-1..FR-5, BR-1, BR-2, NFR-1, DEC-1..DEC-5, AC-1..AC-7]`

**交付结果**

- 手动 API run 走常驻执行器；schedule run 继续每轮 spawn。
- 等待执行槽的 run 对外保持 queued，审批和事件只进入当前 run。
- 现有 thread rotation、取消和运行终态保持兼容。

**文件与符号**

- 修改：`apps/daemon/src/runs/manager.ts` - `RunManagerOptions`、`ActiveRun`、`startExistingRun`、`cancelRun`、`decorateQueuePosition`、`close`
- 修改：`apps/daemon/src/api/server.ts` - `buildServer` 中 injector/executor 组装
- 测试：`apps/daemon/test/integration/run-manager.test.ts`
- 测试：`apps/daemon/test/integration/approval-runtime.test.ts`
- 测试：`apps/daemon/test/integration/agent-tool-api.test.ts`

**实施步骤**

1. 给 `RunManagerOptions` 注入可选 `PersistentAppServerExecutor`，由 RunManager 负责关闭。
2. 在 `startRun` 插入前确定 `usePersistentAppServer`：transport 为 app-server、`createdBy` 为 `api`、执行器存在。
3. 新增 `persistentRunQueue`、`runningPersistentRunId` 和单调 `submissionSequence`，成为 persistent 手动运行的唯一队列。
4. 当前无 persistent 活动 run 时调用 `startExistingRun`；否则写 queued 状态并加入全局队列。不得先进入同线程 `threadQueues`。
5. 普通 enqueue 按 submissionSequence；`interrupt_and_enqueue` 和 `steerRun` 仅按现有显式语义重排，并在 diagnostics 记录 `reorderReason`。
6. `decorateQueuePosition` 对 persistent queued run 只读取全局队列；`cancelRun` 从该队列移除并完成终态，不调用执行器。
7. persistent run 真正出队时重新读取 thread、Codex thread ID、resume mode、profile 和执行参数，再设置 `runningThreadRun`。
8. persistent 手动路径不得调用每轮 `agentToolInjector.prepare`；schedule、exec transport 和回退路径保持原注入。
9. 把现有 app-server 回调、resume rotation、结果和错误处理复用于两种 runner；不得复制不同的审批或事件语义。
10. executor `started` 后发布 running/initializing，记录 PID、reused 和 generation。
11. resume 失败的自动 rotation 只允许在线程未建立、turn/start 未写入时重试；rotation 保留原 run 的 submissionSequence，不重新排队、不允许其他普通 run 插队。
12. 当前 persistent run finalization 完成并写入 thread binding 后，RunManager 才启动全局队列下一项。
13. API Server 仅在默认 RunManager、app-server capability 可用时创建常驻执行器；后台 injector 和进程 injector共享同一 capability Store。
14. 保持 Web/Desktop Runtime API 和协议完全不变。

**TDD**

- 策略：必须。
- RED：新增“A1, A2, B1 ordinary submissions preserve one global FIFO”。A1 活动时依次提交同线程 A2 和另一线程 B1，断言公开顺序 A1→A2→B1、queuePosition 1/2，A2 出队时读取 A1 刚写入的 Codex thread ID。
- RED：分别取消 A2 和 B1，断言二者都不发送 thread/start 或 turn/start，剩余队列位置即时收敛。
- RED：新增“interrupt_and_enqueue and steer are the only explicit reorder paths”，验证重排原因和现有同线程语义，不允许普通 enqueue 越序。
- RED：新增“routes api runs to the persistent executor and schedule runs to one-shot app-server”。连续两次 API run 共用 PID；一次 schedule run 使用独立 PID并退出。
- RED：新增“preserves approval, full-access, cancellation and thread resume across reused turns”。
- RED：新增“does not persist process capability secret in meta, diagnostics, events or argv”。
- 基线：现有同线程 enqueue、interrupt_and_enqueue、steer 和 resume rotation 测试允许先通过，保护现有队列规则。
- GREEN：只增加 execution routing 和状态桥接，不改数据库 schema、Runtime API 或前端。
- REFACTOR：合并 persistent/one-shot 的公共结果处理，避免两套 finalization；运行 RunManager 回归。

**任务完成门**

- RunManager 回归通过。
- AC-1..AC-7 的集成层行为均有自动化覆盖。
- Web/Desktop 未新增平台分支。

### TASK-4：完成关闭顺序、诊断、真实 Codex 和回退控制 `[NFR-1, NFR-2, DEC-1, DEC-4, DEC-5, AC-1, AC-2, AC-4, AC-6, AC-7]`

**交付结果**

- Daemon 正确关闭常驻进程和凭证。
- 运行诊断可以证明 PID 复用、profile 重启及关键耗时。
- 提供默认启用、仅用于紧急回退的一次性模式开关。

**文件与符号**

- 修改：`apps/daemon/src/api/server.ts` - `BuildServerInput`、`onClose`
- 修改：`apps/daemon/src/main.ts` - `OPENCREATOR_PERSISTENT_APP_SERVER`
- 修改：`apps/daemon/src/runs/manager.ts` - diagnostics 时间点与 lifecycle metadata
- 测试：`apps/daemon/test/integration/agent-tool-api.test.ts`
- 测试：`apps/daemon/test/smoke/real-codex-smoke.test.ts`

**实施步骤**

1. `BuildServerInput` 增加 `persistentAppServerEnabled?: boolean`，默认 `true`。
2. 生产环境仅在 `OPENCREATOR_PERSISTENT_APP_SERVER=0` 时关闭常驻手动路径；不增加 UI 设置。
3. `RunManager.close` 设置 closing 后先取消 persistent/thread queued run，再取消活动 run；并调用 executor 的有界 close，使 interrupt 超时后升级 SIGTERM/SIGKILL并等待 child close。
4. Server `onClose` 串行执行：停止 scheduler/订阅/清理 timer → `runManager.close` → `codexSessionProvider.close` → `agentCapabilityTokens.close` → DB close。每步使用幂等 guard；错误时继续释放剩余资源并最终抛出首个错误。
5. 定义稳定的 `PersistentAppServerLifecycleEvent`：

   ```ts
   type PersistentAppServerLifecycleEvent = {
     source: 'persistent_app_server';
     event:
       | 'process_started'
       | 'process_initialized'
       | 'process_reused'
       | 'mcp_refreshed'
       | 'profile_restarted'
       | 'process_exited'
       | 'run_assigned'
       | 'run_cleared';
     at: string;
     runId?: string;
     pid?: number;
     profile: string;
     generation?: number;
     reason?: string;
   };
   ```

6. run 关联 lifecycle 写入该 run 的 `diagnostics.json.appServer.lifecycle`；无 run 的最终关闭事件只输出结构化控制台日志。
7. diagnostics 同时记录 `appServerPid`、`appServerReused`、`profile`、`submittedAt`、`executionStartedAt`、`turnStartSentAt`、`turnStartedAt`、`firstModelEventAt` 和 `turnStartWritten`。
8. 首个模型事件只在首次归一化后的 reasoning/assistant/tool 业务事件出现时记录，不能把 `turn/started` 当作模型事件。
9. lifecycle 和 diagnostics 不得包含 prompt、token、MCP bearer、env 或未脱敏 stderr。
10. 扩展真实 Codex smoke：同会话连续三轮、跨项目一轮、权限 manifest 变化一轮、取消一轮；从 diagnostics 断言 PID 复用、refresh 而非重启、profile 重启、不重放、Server close 后 PID 不存在。
11. 回退模式测试应证明手动 run 恢复每轮一次性进程，且不改变 API 数据。

**TDD**

- 策略：必须。
- RED：新增“bounded close interrupts, terminates, kills, and waits before closing credentials”。替身拒绝 interrupt、忽略 SIGTERM并存在 queued run；断言 queued 先终态、SIGKILL 后 PID 不存在、日志落库、lease revoke、session/store/DB 顺序正确。
- RED：新增“close is idempotent and releases remaining resources after an intermediate close error”。
- RED：新增“writes reuse and timing diagnostics without capability secrets”。
- RED：新增“uses one-shot manual execution only when OPENCREATOR_PERSISTENT_APP_SERVER=0”。
- GREEN：完成关闭顺序、诊断和回退开关，不增加监控页面或新持久化表。
- REFACTOR：统一时间戳和 lifecycle reason 名称，运行 Daemon 全量测试和类型检查。

**任务完成门**

- Daemon 全量测试、Daemon 类型检查通过。
- 真实 Codex smoke 通过，或因真实账号/网络不可用明确标记 BLOCKED，不得伪造完成。
- AC-7 有真实进程证据。

### TASK-5：执行完整功能验收

**交付结果**

- 从 HTTP Runtime、真实 Codex 和实际 Desktop 包证明全部 AC，形成可发布或阻止发布的结论。

**实施步骤**

1. 完成最后一次相关代码修改后，检查 `git diff --stat` 和本任务相关 `git diff`。
2. 对照契约快照、追踪矩阵和 TASK-1..TASK-4，检查漏项、范围外实现、接口漂移、权限扩大、重复状态机和无关修改。
3. 发现问题时按对应 TASK 的 TDD 规则修复并重跑受影响测试；相关修改后旧验收证据失效。
4. 依次运行 Daemon 全量测试、Daemon 类型检查、仓库类型检查和真实 Codex smoke。
5. 重新构建 Web，执行 Desktop 测试、目录包打包、包资源校验和 packaged E2E。
6. 使用实际包执行 Desktop 真实 Codex smoke，确认 Desktop 与 Web/Daemon 使用同一 Runtime 行为。
7. 对每个 AC 记录命令、目录、时间、退出状态、实际结果和可追溯输出摘要。
8. 任一 P0 AC 为 FAIL/BLOCKED 时阻止发布，不得宣布完成。

**TDD**

- 策略：功能验收任务不新增业务实现；此前 TDD 全部完成后执行最高可行公开边界验证。
- 回归：Daemon 全量、仓库类型检查、Web 构建、Desktop 测试及 package E2E。

**任务完成门**

- 下方验收矩阵全部 P0 为 PASS。
- 本地实现差异自审没有未处理的本任务问题。
- 最终报告包含 RED/GREEN、回归、功能验收、偏差、回滚和遗留风险。

## 最终功能验收矩阵

| AC ID | 优先级 | 场景 | 前置条件 | 操作 | 预期结果 | 验证方式 | 证据 |
|---|---|---|---|---|---|---|---|
| AC-1 | P0 | 同 profile 连续运行、跨项目和非 profile 参数变化 | Daemon 启用常驻模式；两个项目使用同 profile | 在项目 A 连续执行多轮并逐项改变 cwd/model/sandbox/reasoning/approvalPolicy，再在项目 B 执行一轮 | 全部成功；同一 PID；只初始化一次；每轮 thread/turn payload 使用当前值；manifest 变化只 refresh | RunManager 集成 + 真实 Codex smoke | 测试输出、diagnostics、Fake 请求载荷、PID |
| AC-2 | P0 | profile 切换 | 常驻 Host 空闲；存在第二个有效 profile | 按 A→B→A profile 队列运行 | 每次规范化 profile 变化产生一次受控重启；旧 PID 先退出；无进程重叠 | Fake app-server + 真实 Codex | lifecycle、diagnostics、进程检查 |
| AC-3 | P0 | 全局队列和事件隔离 | A1 可控挂起 | 依次提交同线程 A2、另一线程 B1，随后完成 A1/A2 | 普通执行顺序严格 A1→A2→B1；queuePosition 唯一准确；审批、通知、done 不串线；取消任一 queued run 不发送 Codex | RunManager 集成 | API 状态、事件序列、Fake 请求日志 |
| AC-4 | P0 | 审批、全权限、取消、续接及 Web/Desktop 一致 | Fake 与真实 Codex；已打包 Desktop | 分别执行请求批准、完全访问、取消和 thread resume；在 Web/包 App 发起相同 Runtime 行为 | 两端 API 和结果一致；审批策略正确；取消不杀可复用 Host（interrupt 失败除外）；续接 thread ID 正确 | approval 集成 + Web 构建 + packaged E2E + Desktop real smoke | 测试输出、App E2E 报告、运行 diagnostics |
| AC-5 | P0 | 动态工具目录与后台权限隔离 | agent tools enabled；conversation、schedule_task 和后台 run | 同 PID 依次运行 conversation→schedule_task→conversation；后台尝试 mutation；空闲 token 调用 MCP | 每轮 tools/list 与现有一次性路径一致；scope 变化产生 refresh 不重启；后台 mutation 403；空闲 token 403；actor 当前 run/thread | capability 单元 + agent-tool HTTP/MCP + 真实 smoke | tools/list、HTTP 状态、actor、lifecycle、token 泄漏检查 |
| AC-6 | P0 | 各协议阶段失败、排队取消和不重放 | Fake 支持在 initialize/thread/refresh/turn/approval/interrupt 阶段失败 | 逐阶段注入失败并提交下一轮 | 当前 run 只终态一次；pending 全结算；turn/start 写入后不重放；迟到事件不串线；下一轮新 PID 成功 | Host/executor 单元 + RunManager 集成 | Fake 消息日志、generation 诊断、状态、PID |
| AC-7 | P0 | 有界 Daemon 关闭 | queued run + 忽略 interrupt/SIGTERM 的活动 Host | 调用 Server close/退出实际 App | queued 先取消；活动进程最终 SIGKILL并确认退出；run/log 落库；lease/session/store/DB 按序关闭；重复 close 幂等 | Server 集成 + 真实 Codex + Desktop package E2E | close 顺序、lifecycle、PID、命令输出 |

## 实际执行与验收结果

### 实施结论

- 用户手动会话默认复用 Daemon 内唯一常驻 `codex app-server --stdio`；schedule 和紧急回退路径继续使用一次性 app-server。
- RunManager 维护唯一 persistent FIFO，进程 capability lease 与活动 run grant 分离，profile 切换、MCP manifest refresh、取消、崩溃恢复和有界关闭均已接入。
- `OPENCREATOR_PERSISTENT_APP_SERVER=0` 可恢复手动会话一次性执行；没有新增 Web/Desktop 平台分支、数据库迁移或旧 Codex 兼容层。
- 实现过程中自审并修复了五个边界问题：
  1. `cross-spawn` 成功时 `result.error` 可能为 `null`。
  2. `turn/start` 在 stdin 实际写入成功前被错误标记为已跨过不重放边界。
  3. profile 切换等待旧 Host 退出时并发关闭，可能在 `closing` 后创建替换 Host。
  4. 同线程一次性 schedule run 完成后没有唤醒等待中的 persistent run。
  5. MCP refresh 期间取消，成功 refresh 会被误判为 refresh 失败并杀掉健康 Host。

### 自动化与真实验收

| 门禁 | 实际结果 |
|---|---|
| Daemon 全量测试 | PASS：`714 passed / 23 skipped` |
| 仓库全量类型检查 | PASS：`pnpm typecheck` |
| 真实 Codex Daemon smoke | PASS：`14/14` |
| Web production build | PASS |
| Desktop 单元测试 | PASS：`69/69` |
| Desktop 目录包 | PASS：生成 `apps/desktop/release/mac-arm64/OpenCreator.app` |
| Desktop 独立包校验 | PASS：包 `530,546,953` 字节，Daemon `43,104,504` 字节，fuses/privacy verified |
| Desktop packaged E2E | PASS：`10/10` |
| Desktop 真实 Codex E2E | PASS：`2/2` |
| 差异格式检查 | PASS：`git diff --check` |

### AC 最终状态

| AC ID | 状态 | 实际证据摘要 |
|---|---|---|
| AC-1 | PASS | Fake、Server 集成和真实 Codex 验证同 profile 多轮复用、跨 cwd/参数发送、单次 initialize 和 PID 复用。 |
| AC-2 | PASS | 执行器测试验证规范化 profile A→B→A 每次只受控重启一次，旧 Host 关闭后才创建新 Host。 |
| AC-3 | PASS | RunManager 验证 A1→A2→B1 全局 FIFO、唯一 queuePosition、queued 取消不发送 Codex；补充同线程 schedule 完成后 persistent 队列唤醒。 |
| AC-4 | PASS | 审批、完全访问、取消、续接、Web build、packaged E2E 和 Desktop 真实 Codex E2E 全部通过。 |
| AC-5 | PASS | process lease inactive 403、活动 grant 工具目录、scope refresh、后台 mutation 隔离和 secret 不落盘均有单元/HTTP/MCP/真实 smoke 证据。 |
| AC-6 | PASS | 覆盖崩溃不重放、stdin 写失败边界、匹配 interrupt、refresh 中取消复用、Host 不可复用后下一轮新 PID。 |
| AC-7 | PASS | 覆盖 interrupt→SIGTERM→SIGKILL、关闭竞态、Server 资源顺序、包退出回收子进程和重复 close。 |

### 发布与遗留风险

- 发布结论：本地功能与目录包验收通过，可以进入签名发布流程。
- 当前 App 未签名：本机没有有效 `Developer ID Application` 身份，不应直接作为对外正式签名包发布。
- 本轮没有执行 Git 提交或推送；工作区中的图标、Skill、Web 资源和其他用户原有修改保持原状。

## 失败熔断

- RED 阶段的目标失败不计入熔断；必须确认失败来自目标行为缺失。
- 进入 GREEN 后，每次修复前记录失败证据、根因假设和最小修改。
- 同一命令或测试因同一根因经过两次有实质差异的修复仍失败，立即停止当前 TASK 并标记 BLOCKED。
- 权限扩大、事件串线、重复 `turn/start`、排队状态错误或残留进程任一出现时立即熔断，不得通过放宽断言继续。
- 若实现需要改变 DEC、公共 Runtime API、数据库或核心 AC，停止并返回方案修订。

## 偏差规则

- 允许：不改变职责的局部命名、测试夹具位置或帮助函数拆分；必须记录原因。
- 不允许：新增进程池、并发 turn、自动重放、前端平台分支、数据库迁移或旧 Codex 兼容层。
- 新建文件必须遵守项目全局命名要求，在文件名末尾保留日期；本 Plan 已明确的新文件使用 `2026-07-28`。
- 不得还原或提交用户现有的图标、Desktop、Web 资源、Skill 和 `.tmp/` 修改。

## 最终报告格式

执行结束时在最终回复中报告：

1. 实施结果和未完成项。
2. Plan 偏差及是否改变契约。
3. 本地实现差异自审结论和修复项。
4. 每个 TASK 的 RED、GREEN、回归命令与结果。
5. AC-1..AC-7 的 PASS/FAIL/BLOCKED、实际结果和新鲜证据。
6. Web/Desktop 一致性、实际打包 App 和真实 Codex 验证状态。
7. 发布/回滚状态及遗留风险。

## 风险与审核记录

### Plan Reviewer

> Reviewer 原始结论：REVISE（6 个 Major，1 个 Minor）
> Plan 流程结论：PASS
> 处理说明：同一版本不重复启动 Reviewer；以下问题已按 Reviewer 给出的关闭条件修订，并通过文档自检确认计划层闭环。代码、测试和真实进程证据仍须在执行阶段取得。

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
|---|---|---|---|---|---|
| PR-001 | Major | 采纳：移除执行器第二层 FIFO，由 RunManager 成为全部 persistent 手动 run 的唯一队列所有者。 | “RunManager 状态”、TASK-2、TASK-3、AC-3 | Plan 明确 `persistentRunQueue`、`submissionSequence`、唯一 `queuePosition` 来源；执行器 busy 时拒绝第二个 `start`；A1/A2/B1 跨线程顺序进入 P0 测试。 | 实现阶段仍需证明显式 steer/reorder 不破坏普通 FIFO。 |
| PR-002 | Major | 采纳：分离进程 token 与活动 grant 生命周期。 | “进程凭证”、TASK-1、AC-5 | Plan 明确 lease token 无活动 TTL、每轮 grant 沿用现有 TTL、inactive 403、匹配 runId 的 deactivate、迟到清理隔离和异常 revoke 顺序。 | 需以可控时钟和迟到 deactivate 测试证明无权限串线。 |
| PR-003 | Major | 采纳：取消固定全量工具目录，改为活动 grant 动态注册并按 manifest 刷新。 | “常驻日程工具注入”、TASK-0、TASK-1、TASK-2、AC-5 | Plan 明确进程配置不写静态 `enabled_tools`；scope 变化调用绑定 Codex 支持的 `config/mcpServer/reload`，manifest 不变不刷新，失败则 Host 不可复用。 | 真实 Codex 的 tools/list 刷新行为必须由 smoke 验证，失败时返回方案阶段。 |
| PR-004 | Major | 采纳：补全 Host/pending/取消/迟到事件状态机。 | “app-server Host”、TASK-2、AC-6 | Plan 明确 generation、pending 归属、threadId/turnId 校验、`turn/start` 不可重放边界、`settleOnce` 和 interrupt 终态匹配。 | 协议边界复杂，必须覆盖每个失败阶段和旧 generation 迟到事件。 |
| PR-005 | Major | 采纳：完整覆盖所有非 profile 参数，并增加 profile 往返切换验证。 | “常驻执行器”、TASK-2、AC-1、AC-2 | TDD 已要求对 model、sandbox、reasoning、approvalPolicy、cwd、manifest scopes 做表驱动复用测试，并验证 A→B→A 精确重启。 | 具体 Codex payload 字段仍需 Fake 请求日志和真实 smoke 双重确认。 |
| PR-006 | Major | 采纳：定义有界、幂等且不中断资源释放的关闭顺序。 | “失败与回滚”、TASK-2、TASK-4、AC-7 | Plan 明确停止接单、取消 queued、interrupt、SIGTERM、SIGKILL、等待 child close、finalization、lease revoke、session/store/DB 串行关闭。 | 实现阶段需验证中间 close 报错后后续资源仍释放，且无残留 PID。 |
| PR-007 | Minor | 采纳：稳定生命周期事件和 diagnostics 字段。 | TASK-4、AC-1、AC-2、AC-7 | Plan 定义 `PersistentAppServerLifecycleEvent` 联合类型、字段、run 归属、敏感信息禁入和首模型事件口径。 | 字段属于内部诊断契约，后续变更需同步测试与验收证据。 |
