# Clawee Agent 完整优化实施计划

> **文档用途：** 本文档是 Clawee Agent 从当前状态演进到完整可用 Agent 产品的唯一实施主计划。后续 Agent 应按批次逐项执行、验证、提交和更新状态，不得跳过阶段门禁。
>
> **执行约束：** 所有开发必须在当前分支、当前工作区完成，不得创建或使用 Git worktree。每个批次必须独立提交，不得夹带无关改动。

| 项目 | 内容 |
|---|---|
| 文档状态 | `APPROVED_FOR_EXECUTION` |
| 总体实施状态 | `IN_PROGRESS` |
| 制定日期 | 2026-07-12 |
| 当前基线分支 | `codex-native-runtime-kernel` |
| 当前基线提交 | `6899f8d feat(web): support interrupting active runs` |
| 实施优先级 | `P0 -> P1 -> P2` |
| 默认执行单位 | 一个批次、一次独立提交 |
| 目标平台 | 响应式 Web + 本地 daemon |

基线提交只用于说明计划制定时的代码状态。后续执行者不得为了匹配该 SHA 而回退、重置或覆盖已经完成的实施提交。

---

## 1. 目标

将 Clawee 从“已具备 Codex Runtime、会话、文件工作区、Skill 市场等主要模块，但运行状态、长会话性能和产品闭环仍不完整”的状态，分阶段建设为一个具备以下能力的完整 Agent：

1. 会话中的任务可在后台持续运行，刷新、切换会话和 daemon 重启后状态一致。
2. 长会话、会话搜索、历史分页和大量 Skill 数据能够稳定、流畅地使用。
3. Schedules、MCP、Profiles、Cleanup、Diagnostics 等已有后端能力都有正式产品入口。
4. 支持附件、多模态、排队发送、打断后继续、审批、安全预览、通知和任务中心。
5. 支持由用户显式管理的长期记忆和可控上下文摘要。
6. 代码结构、测试、文档、真实 smoke 和性能基线达到可持续发布的标准。

## 2. 当前基线与审查结论

### 2.1 已具备的能力

- daemon 已具备线程、Run、SSE 事件、取消、队列、Scheduler、Skill、Skill 市场、MCP、Profile、Cleanup、Diagnostics 和工作区文件 API。
- Web 已具备会话列表、对话 Timeline、Composer、Run 详情、文件工作区、HTML/图片/PDF 等文件预览、设置页、插件市场和基础响应式布局。
- Run 和 Run Event 已持久化到 SQLite；Run 日志同时写入 NDJSON。
- Web 已实现“切换会话时立即显示历史加载遮罩”，并避免刷新时一次加载所有会话正文。
- 当前测试体系包含 Vitest 单元测试、集成测试、Testing Library 组件测试和真实 Codex smoke 测试入口。

### 2.2 P0 级正确性问题

1. `buildServer()` 创建 Scheduler 时使用 `autostart: input.schedulerAutostart ?? false`，而生产入口 `apps/daemon/src/main.ts` 没有传入 `schedulerAutostart: true`。结果是定时任务 API 存在，但正常启动 daemon 后 Scheduler 不会正式调度。
2. Web 使用单个全局 `runtimeBusy`、`activeRunIdRef` 和 `sseAbortControllerRef` 表示运行状态。切换会话时会中止当前 SSE 并将 `runtimeBusy` 设为 `false`，但 daemon 中的 Run 仍在继续。
3. `threadService.listThreadRuns()` 已存在，但生产 UI 没有用它在刷新或切换会话后恢复活动 Run。
4. 慢 Run 在后台完成后，重新进入会话时可能只看到 Codex 历史或旧 Timeline，无法可靠恢复运行中、取消中、失败或刚完成状态。
5. 当前 Run 状态由页面生命周期间接决定，不是由 daemon 持久化状态决定，容易出现“页面看起来空闲，但后台任务仍在运行”的错觉。

### 2.3 P1 级性能和产品问题

- 真实长会话基线约为 379 个 Timeline 项、8265 个 DOM 节点、页面高度约 153662px。
- 移动端插件市场完整列表高度约 27578px。
- 当前 Web JavaScript 主包约 996KB，gzip 后约 325KB。
- Codex session 扫描和历史读取仍以文件遍历、全量 JSONL 解析为主，没有增量索引、游标分页和正文 FTS 搜索。
- Timeline 一次渲染全部历史项，长会话会带来高 DOM 数量、布局成本和滚动卡顿。
- `apps/daemon/src/runs/manager.ts` 在事件热路径上多次使用 `appendFileSync`，可能阻塞 daemon 事件循环。
- `apps/web/src/app/App.tsx` 约 1900 行，`apps/web/src/styles/app.css` 约 3500 行，页面状态、运行状态、数据加载和视图编排耦合较重。
- Search、MCP、Profile、Cleanup、Diagnostics 等能力存在 API 或局部组件，但缺少完整、可发现、可闭环的正式页面。

### 2.4 P2 级能力缺口

- 缺少完整附件选择、上传、预览、移除和多模态 Run 流程。
- Composer 在当前会话有 Run 时主要表现为禁用，缺少明确的“排队发送”和“立即打断并继续”。
- 审批仍未形成 daemon 到 Web 的真实安全闭环。
- HTML 预览需要明确默认禁用脚本，并提供受控的信任边界。
- 缺少跨页面任务中心、系统通知和 daemon 重启后的统一恢复体验。
- 缺少用户显式管理的长期记忆与上下文摘要。
- 缺少完整发布文档、依赖维护策略、真实环境 smoke 门禁和持续性能回归。

## 3. 范围

### 3.1 本计划包含

- 继续使用 React/Vite Web 和本地 Fastify daemon。
- 继续使用 SQLite 作为本地结构化状态和索引存储。
- 搜索覆盖会话标题、用户消息、助手消息、推理摘要、工具结果中的可索引文本。
- 长期记忆采用“用户显式保存、编辑、删除、启用”的管理模式。
- 保持现有 API 可增量兼容，优先增加字段、查询参数或新端点。
- 保持响应式 Web，在桌面和移动端均可完成主要 Agent 工作流。

### 3.2 本计划不包含

- 云账号、云同步、多人协作和团队权限系统。
- 原生 macOS、Windows 或 Linux 桌面打包。
- 无确认地自动提取并永久保存用户隐私信息。
- 在 HTML 预览中默认执行任意脚本。
- 大规模更换 React、Fastify、SQLite 或现有 Codex CLI 集成。
- 与本计划无关的视觉品牌重做。

## 4. 架构原则与不可破坏约束

### 4.1 daemon 是 Run 状态的唯一真相源

- Web 不得仅依据组件是否挂载、SSE 是否连接或本地布尔值判断 Run 是否活动。
- Run 的状态、所属线程、最后事件序号、开始时间和结束时间必须能够从 daemon 恢复。
- SSE 是实时增量通道，不是状态数据库。SSE 断开后必须能够从持久化事件继续。

### 4.2 Run 按 `threadId` 和 `runId` 管理

- 禁止继续扩展全局 `runtimeBusy` 作为所有会话的运行状态。
- Web 使用 `RunRegistry` 管理每个线程的活动 Run、排队 Run、最后事件序号、订阅状态和取消状态。
- 切换会话只改变当前可见订阅和视图，不改变 daemon 中 Run 的生命周期。

### 4.3 历史、事件和搜索建立在可分页索引上

- 不得让 Web 通过一次请求加载完整长会话。
- Codex JSONL 文件只作为原始数据源，SQLite 索引负责快速列表、分页和搜索。
- 增量索引必须保存文件身份、大小、修改时间和已解析偏移，避免每次全量重扫。

### 4.4 API 增量兼容

- 已有端点和响应字段默认保留。
- 历史分页优先通过可选查询参数和可选分页字段引入。
- 在新 Web 客户端切换完成前，不删除旧行为。
- 协议变更必须先修改 `@clawee/protocol`，再实现 daemon 和 Web。

### 4.5 先修行为，再拆分 `App.tsx`

- P0 不做大规模组件重构，先建立正确的 Run 状态模型。
- P1 在运行恢复、历史分页和页面能力稳定后，再进行路由、模块化和代码分割。
- 拆分过程中必须保持用户行为和 API 调用不变。

### 4.6 每批可验证、可提交、可回滚

- 每个批次只解决一个清晰目标。
- 每批必须有自动化测试、真实或浏览器验证、验收标准和回滚边界。
- 每批完成后工作区必须干净，下一批不得依赖未提交改动。

## 5. 状态定义

每个批次使用以下状态之一，并同时维护批次标题前的复选框：

| 状态 | 含义 |
|---|---|
| `NOT_STARTED` | 尚未开始 |
| `IN_PROGRESS` | 正在实施，尚未完成全部验证 |
| `PASS` | 实施、自动化测试和必要人工验收全部通过 |
| `PARTIAL` | 部分完成，但仍有明确剩余项，不得进入依赖批次 |
| `BLOCKED_ENV` | 代码已完成或已尽力验证，但被真实环境、外部程序或权限阻塞 |
| `FAILED` | 实施或验证失败，需要修复或回滚 |

状态规则：

1. 只有状态为 `PASS` 的批次才视为完成，并将标题复选框改为 `[x]`。
2. `PARTIAL`、`BLOCKED_ENV` 和 `FAILED` 的复选框保持 `[ ]`。
3. `BLOCKED_ENV` 必须记录阻塞命令、错误摘要、所需环境和解除阻塞后的验证步骤。
4. 不得因为测试“看起来应该通过”而标记 `PASS`。

## 6. 跨会话执行协议

后续任何 Agent 开始实施前，必须按以下流程执行。

### 6.1 开始前

1. 阅读本文档的“状态总览”“当前阶段”“当前批次”和最近实施日志。
2. 运行：

```bash
git status --short --branch
git log -5 --oneline
```

3. 确认当前工作区没有上一批未说明的改动。
4. 选择当前阶段中第一个状态不是 `PASS` 的批次。
5. 将该批次状态改为 `IN_PROGRESS`，在实施日志新增开始记录。
6. 只实施这个批次。除非文档明确允许，不得顺手开始下一批。

### 6.2 实施中

1. 先写或调整失败测试，确认测试能暴露目标问题。
2. 完成最小实现，避免无关重构。
3. 运行批次专项测试。
4. 运行受影响包的 `typecheck` 和 `build`。
5. 按批次要求完成浏览器或真实 daemon 验证。
6. 记录发现的设计偏差。若偏差改变 API、数据模型或验收标准，先更新本文档再继续。

### 6.3 完成后

1. 将验证命令和结果写入该批次的“执行结果”。
2. 满足全部验收标准后将状态改为 `PASS`，勾选批次。
3. 使用该批次推荐的提交信息独立提交。
4. 运行 `git status --short`，确认工作区干净。
5. 更新实施日志，记录提交 SHA、验证结果、遗留风险和下一批次。
6. 若当前阶段所有批次均为 `PASS`，执行阶段门禁；门禁通过后才进入下一阶段。

### 6.4 中断和恢复

- 会话结束前若批次未完成，状态必须保持 `IN_PROGRESS`、`PARTIAL`、`BLOCKED_ENV` 或 `FAILED`。
- 必须在实施日志记录已完成步骤、未完成步骤、当前失败命令和下一步。
- 不得留下无法解释的未提交文件。
- 若必须保留未提交改动，应在实施日志逐文件说明，不得标记批次完成。

## 7. 全局验证命令

### 7.1 基础门禁

```bash
pnpm test
pnpm typecheck
pnpm build
```

### 7.2 daemon 专项

```bash
pnpm --filter @clawee/daemon test
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
```

### 7.3 Web 专项

```bash
pnpm --filter @clawee/web test
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

### 7.4 真实 Codex smoke

```bash
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

真实 smoke 未运行或被环境阻塞时，不得写成通过。必须使用 `BLOCKED_ENV` 或在阶段门禁中明确记录豁免原因。

### 7.5 浏览器基线

每个涉及 Web 行为的批次至少验证：

- 桌面：1440x900。
- 移动：390x844。
- 页面无横向溢出、不可解释遮挡和无法滚动区域。
- 浏览器控制台无新增 error。
- daemon 请求无持续 4xx/5xx 或无限重试。

## 8. 依赖顺序

```text
P0 运行正确性
  P0-B1 Scheduler 启动
  P0-B2 RunRegistry
  P0-B3 SSE 恢复
  P0-B4 跨会话运行
  P0-B5 P0 验收
      |
      v
P1 性能和产品闭环
  P1-B1 Session 增量索引
  P1-B2 历史分页 API
  P1-B3 Timeline 分页与虚拟化
  P1-B4 NDJSON 异步写入
  P1-B5 全文搜索
  P1-B6 Schedules 页面
  P1-B7 MCP 与 Profiles 页面
  P1-B8 Cleanup 与 Diagnostics 页面
  P1-B9 响应式与 Skill 市场性能
  P1-B10 路由、模块化与代码分割
      |
      v
P2 完整 Agent 能力
  P2-B1 附件基础设施
  P2-B2 多模态 Composer
  P2-B3 排队发送与打断继续
  P2-B4 HTML 安全预览
  P2-B5 审批闭环
  P2-B6 通知、任务中心与恢复
  P2-B7 长期记忆与上下文摘要
  P2-B8 发布和持续质量
```

---

# 9. P0：运行正确性

## P0 阶段目标

建立以 daemon 为真相源、按线程管理 Run、可刷新恢复、可跨会话后台运行的正确运行模型。P0 完成前不得开始历史索引、虚拟化或大规模 UI 拆分。

## P0 状态总览

- [x] `P0-B1` Scheduler 在生产入口正式启动
- [x] `P0-B2` 建立 Web RunRegistry 与活动 Run 查询
- [x] `P0-B3` 实现 SSE 重连、事件去重与刷新恢复
- [x] `P0-B4` 修复跨会话后台运行和取消竞态
- [x] `P0-B5` 完成 P0 端到端回归验收

## P0-B1：Scheduler 在生产入口正式启动

- [x] **状态：** `PASS`

**目标：** 正常运行 `pnpm daemon:dev` 时自动启动 Scheduler；测试和显式嵌入场景仍可关闭自动启动。

**依赖：** 无。

**预计涉及文件：**

- `apps/daemon/src/main.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/unit/scheduler-service.test.ts`

**实施步骤：**

1. 增加生产入口配置测试或可测试的启动参数构造函数，先证明当前生产入口未开启 Scheduler。
2. 在 `apps/daemon/src/main.ts` 调用 `buildServer()` 时显式传入 `schedulerAutostart: true`。
3. 保持 `buildServer()` 的默认值为 `false`，避免集成测试创建后台定时器。
4. 验证 Scheduler 在 server close 时执行 `stop()`，没有悬挂定时器。
5. 增加一个到期 Schedule 的集成用例，确认 autostart 模式会触发 Run。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/unit/scheduler-service.test.ts
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "scheduler"
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
```

**真实环境验证：**

1. 启动 daemon。
2. 创建一个未来 1 至 2 分钟内到期的 Schedule。
3. 不调用手动触发 API，确认到期后自动创建 Run。
4. 关闭 daemon，确认进程可正常退出。

**验收标准：**

- 生产入口创建的 Scheduler 自动运行。
- 测试仍可通过 `schedulerAutostart: false` 保持确定性。
- server close 后无 Scheduler 定时器残留。
- 到期任务只触发一次，并遵守已有并发和 misfire 策略。

**推荐提交信息：**

```text
fix(daemon): start scheduler in production
```

**回滚边界：** 仅回滚生产入口 autostart 接线和对应测试，不改 Scheduler 数据模型或 API。

**执行结果：**

- 代码提交：`485a808 fix(daemon): start scheduler in production`
- 新增生产启动参数构造函数，生产入口固定传入 `schedulerAutostart: true`。
- `buildServer()` 统一负责 Scheduler 启停，默认仍不自动启动，server close 时调用 `stop()`。
- 失败测试已先确认：
  - 缺少生产启动参数模块。
  - autostart 模式未调用 Scheduler `start()`。
- 自动化验证：
  - `pnpm --filter @clawee/daemon test` -> PASS，460 个测试通过，13 个真实 smoke 测试按环境开关跳过。
  - `pnpm --filter @clawee/daemon typecheck` -> PASS。
  - `pnpm --filter @clawee/daemon build` -> PASS。
- 真实生产入口验证：
  - 使用 `pnpm daemon:dev` 启动真实 daemon。
  - 创建下一分钟到期的 Schedule，未调用手动触发 API。
  - Scheduler 自动创建 Run `run_oyCIthqvZ7`，最终状态为 `succeeded`。
  - 测试 Schedule 已删除，daemon 收到退出信号后无卡住。

## P0-B2：建立 Web RunRegistry 与活动 Run 查询

- [x] **状态：** `PASS`

**目标：** 用按 `threadId`、`runId` 管理的 RunRegistry 替代全局运行状态，能够从 daemon 查询指定线程的活动和排队 Run。

**依赖：** `P0-B1`。

**预计涉及文件：**

- 新增 `apps/web/src/features/runs/run-registry.ts`
- 新增 `apps/web/src/features/runs/run-registry.test.ts`
- `apps/web/src/services/thread-service.ts`
- `apps/web/src/services/run-service.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/App.test.tsx`

**实施步骤：**

1. 定义 `RunRegistryState`，至少包含：
   - `runsById`
   - `runIdsByThreadId`
   - `activeRunIdByThreadId`
   - `lastSeqByRunId`
   - `subscriptionStateByRunId`
   - `cancelStateByRunId`
2. 编写纯 reducer 或独立 model 测试，覆盖 Run 新建、排队、运行、取消中、完成、失败和事件序号更新。
3. 增加从 `listThreadRuns(threadId)` 响应合并 Registry 的逻辑。
4. 进入一个会话时，只查询该会话的 Runs；不得在刷新时为所有会话加载 Runs。
5. 将 Composer 的 `running`、`disabled` 和取消按钮状态改为读取当前线程 Registry。
6. 暂时保留旧 `runtimeBusy` 接线作为过渡时，应在本批结束前明确删除或只作为派生值，禁止继续作为真相源。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/features/runs/run-registry.test.ts
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "run registry"
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

**浏览器验证：**

1. 打开一个没有 Run 的会话，Composer 可发送。
2. 打开有 `queued`、`running` 或 `canceling` Run 的会话，Composer 和停止按钮状态正确。
3. 切换到无活动 Run 的其他会话，不受前一个会话影响。
4. 刷新后只请求当前可见会话的 Runs。

**验收标准：**

- 运行状态按线程隔离。
- UI 状态来自 daemon 查询结果和后续事件，而不是组件生命周期。
- 同一线程最多有一个当前 running Run，但可显示排队 Runs。
- 不新增一次性加载全部线程 Runs 的行为。

**推荐提交信息：**

```text
refactor(web): manage runs with a per-thread registry
```

**回滚边界：** 可整体回滚 RunRegistry 接线，daemon API 不变。

**执行结果：**

- 代码提交：`adc8815 refactor(web): manage runs with a per-thread registry`
- 刷新恢复回归修复：`5afd460 fix(web): restore selected history outside initial thread page`
  - active 会话共有 117 条，而首屏列表只请求最新 50 条；刷新前选中的旧会话不在首批结果时，旧逻辑会直接切换为新对话。
  - 修复后继续只加载 50 条列表元数据，并通过 `GET /threads/:id` 额外补取刷新前选中的单个会话，再按需加载其历史。
  - 不会因为恢复旧会话而一次性加载全部会话或其他会话正文。
- 新增 Web `RunRegistry`，按 `threadId` 和 `runId` 管理 Runs、活动 Run、最后事件序号、订阅状态和取消状态。
- 当前只在进入可见会话时调用 `listThreadRuns(threadId)`，没有刷新时批量加载全部会话 Runs。
- Composer 的运行中、停止中和禁用状态已改为从当前线程 Registry 派生，旧 `runtimeBusy`、`runCanceling` 和活动 Run 全局 ref 已删除。
- Run POST 返回前的停止请求继续可用，并改为按 pending request 隔离；线程 A 的异步回调不会清除线程 B 的 pending start。
- Runs 查询通过请求开始快照解决竞态：
  - 查询期间新建并由 daemon 返回确认的本地活动 Run 不会被旧空响应覆盖。
  - 查询开始前已知、但 daemon 后续明确不再返回的活动 Run 可以被清除。
- 失败测试已先确认：
  - 旧空查询无法清理查询开始前已知的活动 Run。
  - 线程 A 的 Run 创建请求返回时会错误清除线程 B 的 pending start。
- 自动化验证：
  - `pnpm --filter @clawee/web test -- src/features/runs/run-registry.test.ts` -> PASS，6 个测试通过。
  - `pnpm --filter @clawee/web test -- src/app/App.test.tsx` -> PASS，42 个测试通过。
  - `pnpm --filter @clawee/web test` -> PASS，43 个测试文件、319 个测试通过。
  - `pnpm --filter @clawee/web typecheck` -> PASS。
  - `pnpm --filter @clawee/web build` -> PASS；主包约 1024.60 kB，gzip 326.49 kB，保留既有大 chunk 警告。
- 真实服务验证：
  - 已重启 `pnpm web:dev`，页面 `http://127.0.0.1:9000/` 返回 `200`。
  - Vite runtime 代理和 daemon 直连 `/healthz` 均返回 `200`。
- 浏览器验证：
  - 2026-07-12 用户已在真实页面完成手动验收，确认无 Run 会话、活动 Run 会话、跨会话切换、刷新按需加载和移动尺寸均无问题。
- 遗留边界：SSE 自动恢复、断线重连和按 Run 管理订阅由 `P0-B3` 实施。

## P0-B3：SSE 重连、事件去重与刷新恢复

- [x] **状态：** `PASS`

**目标：** SSE 中断、页面刷新或重新进入运行中的会话后，从最后事件序号继续，且不重复渲染事件。

**依赖：** `P0-B2`。

**预计涉及文件：**

- `apps/web/src/runtime/sse.ts`
- `apps/web/src/runtime/sse.test.ts`
- `apps/web/src/features/runs/run-registry.ts`
- 新增 `apps/web/src/features/runs/run-event-controller.ts`
- 新增 `apps/web/src/features/runs/run-event-controller.test.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/App.test.tsx`
- `apps/daemon/src/api/routes.runs.ts`
- `apps/daemon/test/integration/api.test.ts`

**实施步骤：**

1. 验证 daemon 的 `fromSeq` 重放语义，补齐边界测试：`fromSeq=0`、中间序号、已到末尾、非法序号。
2. 在 Registry 保存每个 Run 的最大已处理 `seq`。
3. 将 SSE 订阅封装为 Run Event Controller，订阅时使用 `fromSeq=lastSeq`。
4. 对 `runId + seq` 去重，忽略小于等于最后序号的事件。
5. 对意外断流实现有上限的指数退避重连；主动 abort 不重连。
6. 进入会话时查询 Runs；若最新 Run 为非终态，则自动恢复订阅。
7. 若查询结果已为终态，不建立持续订阅，只加载缺失事件或历史。
8. 断线和重连状态只显示在对应 Run，不向 Timeline 重复插入相同错误。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "fromSeq"
pnpm --filter @clawee/web test -- src/runtime/sse.test.ts
pnpm --filter @clawee/web test -- src/features/runs/run-event-controller.test.ts
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "restore"
pnpm --filter @clawee/web typecheck
```

**浏览器验证：**

1. 启动一个至少运行 30 秒的任务。
2. 任务运行中刷新页面。
3. 页面恢复后显示正在运行，并继续追加新事件。
4. 人为断开 Web 网络 5 秒后恢复，Timeline 不重复。
5. Run 完成后刷新，状态保持完成且不持续重连。

**验收标准：**

- 刷新不会把运行中的 Run 误判为空闲。
- 每个 `runId + seq` 最多渲染一次。
- SSE 意外断开可恢复，主动切换或卸载不会触发后台重连。
- 重连失败有明确状态，不产生无限高频请求。

**推荐提交信息：**

```text
fix(web): resume run event streams after refresh
```

**回滚边界：** 回滚 Run Event Controller 和重连逻辑；保留 P0-B2 Registry。

**执行结果：**

- 代码提交：
  - `cdd7a97 fix(web): resume active run events after thread switching`
  - `648e11a fix(web): preserve live transcript across thread switching`
  - `91df841 feat(web): show active run status in conversation list`
  - `6364a64 fix(daemon): validate run event replay checkpoints`
  - `76c1306 feat(web): add resilient run event controller`
  - `bf35d8e fix(web): resume run event streams after refresh`
- daemon 已收口事件重放契约：
  - `fromSeq=0` 从首个事件重放。
  - 中间序号只返回后续事件。
  - 查询参数优先于 `Last-Event-ID`。
  - 已到末尾的终态 Run 立即关闭空响应。
  - 负数、小数、非数字和空值返回 `400 VALIDATION_FAILED`。
- Web 已建立独立 Run Event Controller：
  - 保存并使用最后已处理序号重连。
  - 按 `runId + seq` 忽略重复和过期事件。
  - 意外断流使用 `500/1000/2000/4000/8000ms` 有限退避。
  - 主动停止、切换订阅和收到 `done` 后不重连。
  - 旧订阅 generation 的迟到回调不会污染当前 Run。
- 硬刷新和重新进入会话时：
  - `ThreadRunsResponse` 提供持久化 `lastEventSeq`。
  - 历史 Timeline 与事件重放按最新一轮计数去重，保留合法的重复文本。
  - Registry 同步更新 Run 的 `lastEventSeq` 和终态。
- 自动化验证：
  - `pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "fromSeq|event replay|replays events"` -> PASS，8 个相关测试通过。
  - `pnpm --filter @clawee/web test -- src/features/runs/run-event-controller.test.ts` -> PASS，4 个测试通过。
  - `pnpm --filter @clawee/web test -- src/features/runs/run-event-replay.test.ts src/app/App.test.tsx -t "restore|disconnect|replay|refresh"` -> PASS，12 个相关测试通过。
  - `pnpm test` -> PASS。
  - `pnpm typecheck` -> PASS。
  - `pnpm build` -> PASS；仅保留既有主包体积警告。
- 真实服务验证：
  - 发现 9000 服务仍使用 2026-07-12 11:52 启动的旧 daemon，先重启 `pnpm web:dev`，避免使用旧进程验收新代码。
  - 通过 9000 同源代理创建临时线程并运行真实 Codex 任务。
  - 首段收到事件 `1,2` 后主动断开；从 `fromSeq=2` 续传只收到 `3,4,5,6`，前后无重叠。
  - 最终 Run 状态为 `succeeded`，续传流收到一次 `done`。
  - `fromSeq=-1` 返回 `400 VALIDATION_FAILED`。
  - 两个临时验收线程均已归档。
- 浏览器验证：
  - 2026-07-12 用户已在真实页面完成手动验收，确认运行中刷新恢复、切换后返回、事件无重复、终态收敛和移动尺寸均无问题。
- 遗留风险：
  - 自动化、真实 API 和用户手动页面验收均已覆盖本批验收标准。

## P0-B4：跨会话后台运行和取消竞态

- [x] **状态：** `PASS`

**目标：** 切换会话不停止后台 Run；用户回到原会话可立即看到真实状态并取消正确的 Run。

**依赖：** `P0-B3`。

**预计涉及文件：**

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/App.test.tsx`
- `apps/web/src/features/runs/run-registry.ts`
- `apps/web/src/features/runs/run-event-controller.ts`
- `apps/web/src/features/runs/Composer.tsx`
- `apps/web/src/features/runs/Composer.test.tsx`
- `apps/web/src/components/timeline/Timeline.tsx`

**实施步骤：**

1. 删除 `startNewConversation()`、`selectProject()`、`selectConversation()` 中将全局运行状态直接清空的行为。
2. 将“当前可见会话订阅”和“后台 Run 生命周期”分离。
3. 切换会话时立即显示目标会话加载状态，不保留上一个会话 Timeline。
4. 进入目标会话后合并历史、已持久化 Run Event 和实时事件，明确排序和去重规则。
5. 停止按钮使用当前线程的活动 `runId`，不得使用上一个线程的 ref。
6. 处理取消竞态：
   - Run 尚未返回 ID 时点击停止。
   - Run 已进入终态时点击停止。
   - 切换会话后旧取消请求返回。
   - daemon 返回取消失败。
7. 后台 Run 完成时更新 Registry；再次进入该线程时显示最终状态。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "switch"
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "cancel"
pnpm --filter @clawee/web test -- src/features/runs/Composer.test.tsx
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

**浏览器验证：**

1. 在会话 A 启动慢任务。
2. 立即切换到会话 B，B 不显示 A 的 Timeline 或运行状态。
3. 在 B 发起另一个允许的任务或保持空闲，状态互不污染。
4. 返回 A，立刻显示加载态，随后恢复 Run 状态。
5. 在 A 点击停止，只取消 A 的活动 Run。
6. 重复验证后台自然完成、后台失败和后台取消。

**验收标准：**

- 切换会话不会取消 daemon Run。
- 不会短暂显示上一个会话内容。
- 取消操作始终命中当前会话的正确 Run。
- 后台完成后回到会话能看到最终结果。
- 不存在由过期异步请求覆盖当前会话状态的竞态。

**推荐提交信息：**

```text
fix(web): keep runs active across conversation switches
```

**回滚边界：** 回滚会话切换和取消接线；保留 Registry 和 SSE 恢复基础。

**执行结果：**

- 代码提交：`75e5b9b fix(web): keep runs active across conversation switches`
- Web 事件订阅由单个当前会话控制器改为按 `runId` 管理的后台控制器集合：
  - 切换会话、项目或新对话不再中止其他线程的 Run。
  - 每个 Run 固定绑定所属 `threadId`，后台事件只写入该线程的 Timeline 缓存。
  - 当前可见 Timeline 与后台 Run 生命周期已解耦，不会将 A 的内容短暂显示到 B。
  - 后台收到 `done` 时立即更新 Registry、清除侧栏运行状态并收尾控制器。
  - 连接断开和组件卸载时统一停止全部控制器。
- Timeline 批处理改为按线程隔离：
  - 同时运行多个线程时各自维护事件批次。
  - 返回后台线程时直接显示已缓存的实时事件，并与历史响应继续去重合并。
- Run 启动和取消竞态已收口：
  - Run POST 在切换会话后才返回时，状态和后续事件仍写入发起线程。
  - 取消失败的诊断写回 Run 所属线程，不污染当前会话。
  - 取消失败后先查询最新 Run；若 Run 已终态，则忽略迟到的 `RUN_ALREADY_TERMINAL`。
  - Run ID 返回前点击停止的既有流程继续保留。
- 失败测试已先确认：
  - 切换到 B 会中止 A 的 SSE。
  - A 的迟到取消失败会显示在 B。
- 自动化验证：
  - `pnpm --filter @clawee/web test` -> PASS，45 个测试文件、333 个测试通过。
  - `pnpm --filter @clawee/web typecheck` -> PASS。
  - `pnpm --filter @clawee/web build` -> PASS；仅保留既有主包体积警告。
- 真实服务验证：
  - 页面 `http://127.0.0.1:9000/` 返回 `200`。
  - 同时创建并启动 A、B 两个真实 Codex 线程。
  - 只取消 A：取消 API 返回 `202`，A 最终状态为 `canceled`。
  - B 不受影响，最终状态为 `succeeded`，并输出预期文本 `P0-B4-B-SUCCEEDED`。
  - 两个临时线程均已归档。
- 浏览器验证：
  - 2026-07-12 用户确认继续下一批，视为真实页面跨会话后台运行、侧栏状态、返回恢复和定向停止验收通过。
- 遗留风险：
  - 自动化、真实双线程 API 和用户页面验收均已覆盖本批验收标准。

## P0-B5：P0 端到端回归验收

- [x] **状态：** `PASS`

**目标：** 对 Scheduler、刷新恢复、跨会话运行、后台完成、失败、取消和 daemon 重启进行完整回归，并固化测试。

**依赖：** `P0-B1` 至 `P0-B4`。

**预计涉及文件：**

- `apps/daemon/test/integration/run-manager.test.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- `apps/web/src/app/App.test.tsx`
- 新增 `docs/superpowers/test-reports/2026-07-12-clawee-p0-run-correctness.md`

**实施步骤：**

1. 建立 P0 回归矩阵：正常完成、失败、取消、排队、切换、刷新、SSE 断线、daemon 重启、Scheduler 触发。
2. 补齐能自动化的集成和组件测试。
3. 运行完整测试、类型检查和构建。
4. 运行真实 Codex smoke。
5. 使用真实浏览器完成至少两线程并行操作验证。
6. 记录 daemon 重启时对非终态 Run 的处理：
   - 能恢复则恢复。
   - 无法恢复则明确标记失败或中断。
   - 禁止永远保留为 `running`。
7. 形成测试报告并记录证据、失败项和环境信息。

**自动化测试：**

```bash
pnpm test
pnpm typecheck
pnpm build
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

**浏览器和真实环境验证：**

- 桌面和移动尺寸各执行一次刷新恢复。
- 会话 A 运行中切换 B，再返回 A。
- Run 运行中停止 daemon，再重新启动，确认状态收敛。
- Schedule 到期自动触发。
- 控制台和 daemon 日志无无限重试、未处理 Promise 或重复事件。

**验收标准：**

- P0 回归矩阵全部通过或有明确 `BLOCKED_ENV` 记录。
- 没有已知“页面空闲、daemon 仍运行”的状态分裂。
- 没有已知跨会话 Timeline 污染。
- P0 测试报告已提交。

**推荐提交信息：**

```text
test: lock down run recovery workflows
```

**回滚边界：** 本批原则上只增加测试和必要的小修复；若发现架构问题，应回到对应 P0 批次修复，不在本批引入新架构。

**执行结果：**

- 测试报告已提交：`fb5afe1 test: lock down run recovery workflows`。
- P0 回归矩阵全部通过，覆盖正常完成、失败、运行中取消、排队取消、切换会话、后台完成、刷新恢复、SSE 断流续传、事件去重、daemon 重启、Scheduler 到期和取消竞态。
- 仓库门禁：
  - `pnpm test` -> PASS；daemon 465 项、Web 333 项、Skill Market 6 项，常规测试合计 804 项通过，13 项真实 smoke 按默认开关跳过。
  - `pnpm typecheck` -> PASS。
  - `pnpm build` -> PASS；仅保留既有 Web 主包体积告警。
- 真实 Codex smoke：
  - `CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts` -> PASS，13 项全部通过。
- 真实服务验证：
  - SSE 从 `fromSeq=2` 续传时只收到后续事件，最终成功且无重复。
  - 双线程运行时定向取消 A 后，A 为 `canceled`，B 独立完成为 `succeeded`。
  - daemon 重启后，原 `running` Run 确定性收敛为 `failed`，`terminationReason=daemon_restart`，并产生唯一 `error` 和 `done` 事件。
  - Schedule 到期后自动创建 Run，最终输出 `P0-B5-SCHEDULER-OK`。
- 浏览器验收：
  - 用户已完成桌面和移动尺寸刷新恢复、跨会话后台运行、返回恢复、Timeline 隔离、侧栏状态和定向停止的真实页面手动验收。
- 遗留风险：
  - Web 主包代码分割、长会话历史扫描和 Timeline 大数据性能进入 P1。
  - daemon 重启当前采用确定性失败收敛，不恢复底层 Codex 子进程；符合 P0 契约。

## P0 阶段门禁

- [x] P0-B1 至 P0-B5 全部为 `PASS`。
- [x] `pnpm test` 通过。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm build` 通过。
- [x] 真实 Codex smoke 通过，或阻塞原因已被用户明确接受。
- [x] P0 测试报告存在并记录浏览器验证。
- [x] Git 工作区干净。

**P0 门禁结果：** `PASS`。P0 运行正确性阶段于 2026-07-12 完成，下一批为 `P1-B1`。

---

# 10. P1：性能和产品闭环

## P1 阶段目标

让长会话和大量数据保持流畅，建立可分页、可搜索的数据基础，并把已有 daemon 能力完整呈现在产品页面中。P1 结束时，Clawee 应具备稳定的日常 Agent 工作台体验。

## P1 状态总览

- [x] `P1-B1` Codex Session 增量索引
- [x] `P1-B2` 历史游标分页 API
- [x] `P1-B3` Timeline 向上加载与虚拟化
- [x] `P1-B4` daemon NDJSON 异步有序写入
- [ ] `P1-B5` 会话全文搜索
- [ ] `P1-B6` Schedules 正式页面
- [ ] `P1-B7` MCP 与 Profiles 正式页面
- [ ] `P1-B8` Cleanup 与 Diagnostics 设置页
- [ ] `P1-B9` 移动端导航与 Skill 市场性能
- [ ] `P1-B10` App 模块化、路由和代码分割

## P1-B1：Codex Session 增量索引

- [x] **状态：** `PASS`

**目标：** 将 Codex JSONL session 的元数据和历史项增量索引到 SQLite，避免会话列表和历史请求反复全量扫描文件。

**依赖：** P0 阶段门禁。

**预计涉及文件：**

- `apps/daemon/src/storage/migrations.ts`
- `apps/daemon/src/storage/repositories.ts`
- 新增 `apps/daemon/src/codex/sessions/index-repository.ts`
- 新增 `apps/daemon/src/codex/sessions/indexer.ts`
- 重构 `apps/daemon/src/codex/sessions/scanner.ts`
- 重构 `apps/daemon/src/codex/sessions/history.ts`
- 新增 `apps/daemon/test/unit/codex-session-indexer.test.ts`
- `apps/daemon/test/unit/codex-sessions-scanner.test.ts`
- `apps/daemon/test/unit/storage.test.ts`

**实施步骤：**

1. 设计并迁移：
   - `codex_sessions`
   - `codex_session_sources`
   - `codex_session_items`
2. 索引源记录至少保存路径、文件标识、大小、修改时间、已解析字节偏移、最后错误和索引版本。
3. 将 JSONL 单行解析抽为纯函数，先覆盖损坏行、未知事件、超长行和 UTF-8 边界。
4. 首次扫描全量导入，后续仅从上次偏移继续。
5. 检测文件截断、替换或 inode/身份变化时安全重建单个 session 索引。
6. 使用事务批量写入历史项，确保部分解析失败不会破坏已提交数据。
7. 保留原始读取实现作为短期降级路径，并记录降级告警。
8. 增加索引版本，未来解析规则变化时可重建。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/unit/codex-session-indexer.test.ts
pnpm --filter @clawee/daemon test -- test/unit/codex-sessions-scanner.test.ts
pnpm --filter @clawee/daemon test -- test/unit/storage.test.ts
pnpm --filter @clawee/daemon typecheck
```

**真实环境验证：**

1. 使用真实 `$CODEX_HOME/sessions` 建立首次索引并记录耗时。
2. 不修改文件再次扫描，确认解析行数接近零。
3. 向一个测试 session 追加事件，只索引新增内容。
4. 模拟截断或替换测试文件，确认单 session 重建。

**验收标准：**

- 重复扫描不再全量解析未变化 JSONL。
- 增量追加不会产生重复历史项。
- 单个损坏 session 不阻塞其他 session。
- 索引可通过删除数据库后从原始 JSONL 重建。

**推荐提交信息：**

```text
feat(daemon): index codex sessions incrementally
```

**回滚边界：** 新表为附加数据，可回滚索引读取接线并保留旧扫描器；不得删除原始 JSONL。

**执行结果：**

- 实现提交：`423d8b8 feat(daemon): index codex sessions incrementally`。
- 数据模型：
  - 新增 `codex_sessions`、`codex_session_sources`、`codex_session_items` 三张附加索引表。
  - 来源状态记录路径、设备/inode 文件标识、文件大小、修改时间、已解析字节偏移、已解析行数、解析器状态、头部指纹、最后错误和索引版本。
  - 原始 Codex JSONL 保持不变，可删除 SQLite 后完整重建。
- 增量索引：
  - 首次扫描分块导入元数据和历史项；重复扫描只遍历文件状态，不重新解析未变化内容。
  - 文件追加从上次字节偏移继续，SQLite 事务批量写入且使用来源偏移防止重复历史项。
  - 文件截断、设备/inode 变化、同 inode 原位重写、索引版本变化和解析状态损坏均只重建对应来源。
  - 64 MB 单行上限采用分段累积和一次合并，避免超长行的二次方内存复制。
- 解析兼容：
  - 列表扫描、历史降级读取和索引器共用纯行解析器。
  - 覆盖损坏 JSON、未知事件、超长行、UTF-8 分块边界、无尾换行追加和正在写入的末尾半行。
  - 子 Agent 会话仍被过滤并归档；历史项去重、工具名称关联、文件变更和 turn 完成项行为保持一致。
- 降级路径：
  - server 默认使用 SQLite 索引；同步或读取异常时记录告警并回退到原始扫描器和历史读取器。
- 自动化验证：
  - `pnpm --filter @clawee/daemon test` -> PASS；41 个测试文件、472 项通过，13 项真实 smoke 按默认开关跳过。
  - `pnpm --filter @clawee/daemon typecheck` -> PASS。
  - `pnpm --filter @clawee/daemon build` -> PASS。
  - 索引器、扫描器和存储专项共 21 项通过；API 专项验证索引表写入、重复列表不重复、历史请求只追加新行。
- 真实 `$CODEX_HOME/sessions` 基准：
  - 首次索引 2077 个 JSONL 文件、729859 行、约 3.44 GB，耗时 9438 ms。
  - 第二次扫描同一数据耗时 239 ms，`filesParsed=0`、`linesParsed=0`、`bytesRead=0`。
  - 临时数据库生成 2058 个 session、2077 个来源、380678 个历史项，索引错误为 0。
- 真实文件副本验证：
  - 追加事件只解析 1 行、没有重建，目标历史标记只出现 1 次。
  - 原位替换后只重建该来源，并正确删除旧 session 历史、切换到新 session。
- 实际服务验证：
  - 运行库包含 2077 个来源、2058 个 session、380705 个历史项，错误为 0。
  - 连续两次 `GET /threads?limit=50` 均返回 50 条，耗时约 61 至 70 ms。
  - `http://127.0.0.1:9000/` 和 `/healthz` 均返回 `200`。
- 遗留风险：
  - 当前机器 3.44 GB 历史的首次全量建库约需 9.4 秒；后续扫描已降至约 0.24 秒。首次建库后台化不属于本批验收范围。

## P1-B2：历史游标分页 API

- [x] **状态：** `PASS`

**目标：** 为会话历史提供稳定的向前游标分页，同时保持旧调用兼容。

**依赖：** `P1-B1`。

**预计涉及文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/src/api/routes.threads.ts`
- `apps/daemon/src/codex/sessions/index-repository.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/daemon/test/unit/protocol-shape.test.ts`
- `apps/web/src/services/thread-service.ts`
- `apps/web/src/services/run-service.test.ts` 或新增 `thread-service.test.ts`

**实施步骤：**

1. 定义稳定游标，至少包含排序键和 item ID，不使用数组下标。
2. 为 `GET /threads/:id/history` 增加可选 `limit` 和 `before`。
3. 不传分页参数时短期保留旧响应语义，确保旧客户端兼容。
4. 响应新增可选分页信息：
   - `hasMore`
   - `nextCursor`
   - `oldestItemAt`
5. 默认新客户端每页建议 50 至 100 项，daemon 设置最大值。
6. 明确排序为从旧到新返回，向上加载时请求更早一页。
7. 对非法、过期和跨线程游标返回稳定错误。
8. 为同时间戳、多类型项和索引重建后的排序补测试。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "history pagination"
pnpm --filter @clawee/daemon test -- test/unit/protocol-shape.test.ts
pnpm --filter @clawee/web test -- src/services
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/web typecheck
```

**真实环境验证：**

- 对超过 300 项的真实会话连续请求多页。
- 每页无重复、无缺失，拼接后顺序与原始会话一致。
- 首屏只返回最新一页。
- 旧的不带参数请求仍可工作。

**验收标准：**

- 新分页 API 可稳定向前遍历完整历史。
- 游标不暴露本地绝对路径或敏感信息。
- 单次响应大小受限。
- API 变更为增量兼容。

**推荐提交信息：**

```text
feat(runtime): add cursor pagination for thread history
```

**回滚边界：** 回滚分页参数和字段即可；旧无参数历史接口仍可使用。

**执行结果：** `PASS`。实现提交 `f908631`：

- `GET /threads/:id/history` 已支持可选 `limit`、`before`，仅在请求分页参数时返回分页元数据；无参数调用继续返回完整历史。
- 游标使用 Base64URL 编码的版本、Codex Thread ID、行号、源偏移和 item ID，不包含本地路径；非法、过期、跨线程游标分别返回稳定错误码。
- 分页查询以稳定复合键倒序取最新基础项，再按旧到新返回；读取前一条边界项处理相邻重复消息跨页去重，assistant 派生的 `done` 不会破坏遍历完整性。
- daemon 最大分页大小为 100，仅传 `before` 时默认 50；Web ThreadService 已支持安全编码分页参数。
- daemon 全量 `477` 项通过，Web 全量 `335` 项通过；协议、daemon、Web 类型检查和构建全部通过。
- 真实会话以 `23,101` 条索引记录连续读取 `232` 页，拼接得到 `28,107` 个最终历史项，与完整历史逐项一致，无重复、无缺失；单页最大 `133` 项（包含派生 `done`）。

**下一批：** `P1-B3` Timeline 向上加载与虚拟化。

## P1-B3：Timeline 向上加载与虚拟化

- [x] **状态：** `PASS`

**目标：** 首屏只加载最新历史，向上滚动加载旧内容，并将长会话 DOM 数量控制在稳定范围。

**依赖：** `P1-B2`。

**预计涉及文件：**

- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/services/thread-service.ts`
- 新增 `apps/web/src/features/conversation/use-thread-history.ts`
- 新增 `apps/web/src/features/conversation/use-thread-history.test.ts`
- `apps/web/src/components/timeline/Timeline.tsx`
- `apps/web/src/components/timeline/Timeline.test.tsx`
- `apps/web/src/components/timeline/timeline-model.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/styles/app.css`

**实施步骤：**

1. 选用支持可变高度、prepend 后保持滚动位置的成熟虚拟列表库，优先评估 `react-virtuoso`。
2. 将历史分页状态从 `App.tsx` 提取为专用 hook 或 controller。
3. 初次进入会话只请求最新一页。
4. 到达顶部阈值时加载更早一页，并保持用户当前视觉位置。
5. 实时 Run Event 继续追加到末尾；历史页与实时项按稳定 ID 去重。
6. 将同一 Run 内连续文件变更聚合，减少重复 Timeline 卡片。
7. 保留“自动跟随底部”规则：
   - 用户在底部时自动跟随。
   - 用户正在查看旧历史时不强制跳到底部。
   - 显示“有新内容”入口。
8. 为高度变化、Markdown 展开、图片加载和详情展开测试滚动稳定性。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/features/conversation/use-thread-history.test.ts
pnpm --filter @clawee/web test -- src/components/timeline/Timeline.test.tsx
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "history"
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

**浏览器验证：**

1. 打开 300 项以上真实会话。
2. 首屏加载期间可看到明确加载态。
3. 向上滚动连续加载到最早历史，无跳跃和重复。
4. 检查 DOM 节点数量，不随完整历史线性增长。
5. 新事件到达时，在底部自动跟随，在旧历史位置不抢滚动。

**验收标准：**

- 首屏不下载完整历史。
- 379 项基线会话的常驻 Timeline DOM 节点显著低于原 8265 节点。
- 向上加载后视觉位置稳定。
- 历史项与实时项无重复。
- 移动端滚动正常。

**推荐提交信息：**

```text
perf(web): virtualize paged conversation history
```

**回滚边界：** 可回滚虚拟列表和分页 hook，daemon 分页 API 保留。

**执行结果：** `BLOCKED_ENV`。实现提交 `9928c7c`。代码、自动化测试和构建已完成，当前执行环境没有可连接的浏览器实例，尚缺修复后的真实桌面与移动端验收：

- 历史分页：
  - 新增 `useThreadHistory`，首次只请求 `history?limit=50`，使用 `before` 游标向前加载。
  - 历史页按稳定 item ID 去重并前插，实时缓存继续合并到末尾。
  - 无 `turnId` 的历史 Run 改为基于用户消息 item ID 生成稳定身份，加载旧页后不会因页内序号变化而重建过程块。
- Timeline：
  - 引入 `react-virtuoso@4.18.10`，支持可变高度虚拟列表、顶部加载、底部自动跟随和“有新内容”入口。
  - prepend 判断改为基于原始 Timeline item ID，而不是可能因跨页分组变化的渲染 key；新增回归测试验证已有可见项逻辑索引保持不变。
  - 同一 Run 的连续文件变更聚合展示，减少重复卡片和 DOM。
  - 移除 App 外层按 Timeline 长度强制滚到底部的逻辑，滚动所有权统一交给虚拟列表。
- 自动化验证：
  - `pnpm --filter @clawee/web test -- src/features/conversation/use-thread-history.test.ts` -> PASS，2 项。
  - `pnpm --filter @clawee/web test -- src/components/timeline/Timeline.test.tsx` -> PASS，23 项。
  - `pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "history"` -> PASS，5 项。
  - `pnpm --filter @clawee/web test` -> PASS，47 个测试文件、343 项。
  - `pnpm test` -> PASS；daemon 477 项、Web 343 项、Skill Market 6 项，真实 Codex smoke 13 项按默认开关跳过。
  - `pnpm typecheck` -> PASS。
  - `pnpm build` -> PASS；仅保留既有 Vite 主包超过 500 kB 警告。
- 浏览器验证记录：
  - 修复前真实长会话首屏请求为 `history?limit=50`，第二页请求正确携带 `before`。
  - 修复前首屏 Timeline DOM 后代节点约 76 个，第二页后约 88 个，显著低于 8265 节点基线。
  - 修复前发现分页前插后 `scrollTop` 从 141 跳到 0，已通过原始 item ID prepend 判定和稳定 synthetic Run ID 修复，并补充失败后转绿的回归测试。
  - 修复后浏览器连接返回“无可用浏览器”，无法完成 1440x900、390x844、连续多页锚点和控制台复测。
- 用户验收：
  - 用户已于 2026-07-12 完成真实页面验证并确认通过，P1-B3 从 `BLOCKED_ENV` 更新为 `PASS`。
- 解除阻塞后的验收步骤：
  1. 打开 300 项以上真实会话，连续加载至少三页，确认加载前后的首个可见消息位置基本不变。
  2. 记录首屏和多页后的 Timeline DOM 节点数量，确认保持有界。
  3. 在旧历史位置等待新事件，确认不抢滚动并显示“有新内容”；回到底部后恢复自动跟随。
  4. 在 1440x900 和 390x844 下确认滚动、加载按钮、展开过程和文件变更聚合正常。
  5. 确认浏览器控制台无新增 error，历史请求无重复或持续失败。

## P1-B4：daemon NDJSON 异步有序写入

- [x] **状态：** `PASS`

**目标：** 移除 Run 热路径中的同步文件追加，保持日志顺序、可观测背压和安全关闭。

**依赖：** P0 阶段门禁；可在 `P1-B3` 后执行。

**预计涉及文件：**

- 新增 `apps/daemon/src/runs/ordered-log-writer.ts`
- 新增 `apps/daemon/test/unit/ordered-log-writer.test.ts`
- 新增 `apps/daemon/src/shutdown.ts`
- 新增 `apps/daemon/test/unit/shutdown.test.ts`
- `apps/daemon/package.json`
- `apps/daemon/src/codex/runner.ts`
- `apps/daemon/src/main.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/src/diagnostics/collector.ts`
- `apps/daemon/test/integration/codex-runner.test.ts`
- `apps/daemon/test/integration/run-manager.test.ts`

**实施步骤：**

1. 建立按 Run 隔离的有序异步写入器。
2. 每种日志文件保持调用顺序，不允许并发 append 打乱行。
3. 设置内存队列上限和高水位记录；超过上限时采用明确背压，不静默丢日志。
4. Run 进入终态前等待日志 drain。
5. server close 时等待全部 writer 关闭，设置有界超时。
6. 写入失败必须进入 diagnostics 和 Run 告警，不能形成未处理 Promise。
7. 记录队列峰值、写入耗时和 drain 耗时，供 Diagnostics 展示。
8. 保留元数据原子写入策略，不将所有同步写入机械替换。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/unit/ordered-log-writer.test.ts
pnpm --filter @clawee/daemon test -- test/integration/run-manager.test.ts
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/daemon build
```

**真实环境验证：**

- 运行高频事件任务，确认 daemon 仍能响应 `/healthz` 和其他请求。
- 对比 `events.ndjson` 的 `seq` 与 SQLite `run_events`，顺序一致。
- Run 完成后立即读取日志，尾部不缺失。
- 关闭 daemon 时无丢日志或长时间卡住。

**验收标准：**

- 事件热路径不再使用 `appendFileSync`。
- 日志顺序和内容完整。
- 背压、写入失败和 drain 可诊断。
- daemon 关闭可等待写入完成。

**推荐提交信息：**

```text
perf(daemon): write run logs asynchronously in order
```

**回滚边界：** 回滚 writer 接线可恢复同步写入；SQLite Run Event 持久化不变。

**执行结果：**

- 代码提交：`4779b6b perf(daemon): write run logs asynchronously in order`。
- 新增按 Run 隔离的 `OrderedLogWriter`：
  - append 按调用顺序串行执行，stdout、stderr 和事件文件不会并发打乱。
  - 默认高水位为 1 MiB，硬队列上限为 8 MiB；超过上限抛出明确背压错误，不静默丢弃。
  - 记录队列峰值、高水位命中、背压拒绝、写入数量、字节数、写入耗时、drain 耗时和失败明细。
  - `close()` 会阻止新 append 并等待已排队写入完成。
- Codex runner 的 stdout/stderr handler 支持异步返回：
  - 同一流严格串行处理，处理期间暂停流并在完成后恢复，形成真实背压。
  - 子进程退出后等待全部异步 handler 完成。
  - handler 失败映射为 `stream_handler_failed`，不会形成未处理 Promise。
- RunManager 已将 `raw.redacted.ndjson`、`events.ndjson` 和 `stderr.redacted.log` 迁移到异步 writer：
  - Run 发布终态、关闭 writer、写入 diagnostics 后才更新终态并完成 Promise。
  - SQLite 事件、文件事件和订阅通知顺序明确；订阅者异常不会影响持久化和 Run 执行。
  - 写入失败产生 `RUN_LOG_WRITE_FAILED` Run diagnostic，并在 `diagnostics.json` 保存 writer 指标。
  - 预启动失败和孤儿恢复的 detached writer 会在事件写入完成后关闭，不长期滞留。
  - `close()` 会阻止新 Run、取消活动和排队 Run、共享同一在途关闭 Promise，并支持每次调用独立设置等待超时。
- daemon 关闭链路已补全：
  - Fastify `onClose` 在关闭自有 SQLite 前等待 RunManager。
  - `SIGINT`、`SIGTERM` 会触发 `server.close()`，关闭完成前保留事件循环句柄。
  - daemon 开发入口改为 `node --import tsx src/main.ts`，避免 `tsx` CLI 信号代理提前终止应用。
- Diagnostics 收集器会展示 writer 写入失败和背压拒绝警告。
- `meta.json` 和 `diagnostics.json` 继续使用完整文件写入，没有机械替换所有同步元数据写入。
- 自动化验证：
  - `pnpm --filter @clawee/daemon test` -> PASS，43 个测试文件、491 个测试通过，13 个真实 Codex smoke 按配置跳过。
  - `pnpm --filter @clawee/daemon typecheck` -> PASS。
  - `pnpm --filter @clawee/daemon build` -> PASS。
  - `git diff --check` -> PASS。
  - Run 热路径源码中不存在 `appendFileSync`。
- 真实服务验证：
  - 已重启 `pnpm web:dev`，页面和 daemon `/healthz` 均返回 `200`。
  - 真实 Run `run_GiMHjcA8HF` 执行期间健康检查持续 `200`；完成后 `events.ndjson` 与 SQLite 序号均为 `1..9`。
  - 该 Run 共完成 64 次异步写入，队列峰值 841 字节，失败和背压拒绝均为 0，终态后队列为 0 且 writer 已关闭。
  - 对活动 Run `run_Y1t5yUsk1H` 通过开发服务真实父子进程路径发送 `SIGTERM`，daemon 在 131 ms 内退出。
  - 关闭时 Run 收敛为 `canceled`，写入 `canceling` 和 `done`；SQLite 与 NDJSON 序号均为 `1..6`，45 次写入全部完成，writer 已关闭且无失败。
- 已知边界：
  - 预启动失败和孤儿恢复会关闭 detached writer，但不二次重写 diagnostics 追加最终 writer 指标，避免恢复和测试清理阶段延长后台文件生命周期。
  - 硬队列上限触发时会明确失败当前 Run，而不是丢弃日志后继续伪装成功。

## P1-B5：会话全文搜索

- [ ] **状态：** `NOT_STARTED`

**目标：** 提供覆盖会话正文的本地全文搜索，并能从结果跳转到对应会话和消息。

**依赖：** `P1-B1`、`P1-B2`。

**预计涉及文件：**

- `apps/daemon/src/storage/migrations.ts`
- `apps/daemon/src/codex/sessions/index-repository.ts`
- 新增 `apps/daemon/src/search/service.ts`
- 新增 `apps/daemon/src/api/routes.search.ts`
- `apps/daemon/src/api/server.ts`
- `packages/protocol/src/api.ts`
- 新增 `apps/web/src/services/search-service.ts`
- 新增 `apps/web/src/features/search/SearchView.tsx`
- 新增 `apps/web/src/features/search/SearchView.test.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/src/features/shell/ClaweeSidebar.tsx`

**实施步骤：**

1. 建立 FTS5 索引，索引规范化后的标题和可搜索历史正文。
2. 明确不索引二进制、超大工具输出和已标记敏感的原始日志。
3. 增加分页搜索 API，支持 query、project/cwd、类型和时间筛选。
4. 返回高亮片段、线程 ID、item ID、时间和类型。
5. Web 搜索页实现防抖、加载、空结果、错误、分页和键盘导航。
6. 点击结果进入对应会话，加载包含目标 item 的历史窗口并定位。
7. 对中文、英文、路径、特殊字符和空白规范化补测试。
8. 索引更新和 session 增量索引在同一事务边界或可恢复流程中完成。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- -t "search"
pnpm --filter @clawee/web test -- src/features/search/SearchView.test.tsx
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/daemon typecheck
pnpm build
```

**浏览器验证：**

- 搜索真实会话中的中文短语、英文标识符和文件路径。
- 从结果跳转后目标消息可见且不会加载全部历史。
- 输入快速变化时旧请求不会覆盖新结果。
- 移动端搜索页可滚动、可返回会话。

**验收标准：**

- 搜索覆盖会话正文。
- 搜索结果分页且可定位到消息。
- 旧请求、空查询和特殊字符处理正确。
- 不泄露被排除的敏感原始日志。

**推荐提交信息：**

```text
feat: add full-text conversation search
```

**回滚边界：** 搜索表和路由为附加能力，可整体回滚，不影响历史读取。

**执行结果：** 待填写。

## P1-B6：Schedules 正式页面

- [ ] **状态：** `NOT_STARTED`

**目标：** 将已有 Scheduler API 建设为完整的计划任务管理页面。

**依赖：** P0 Scheduler 正确性已通过。

**预计涉及文件：**

- `apps/web/src/services/schedule-service.ts`
- `apps/web/src/features/schedules/SchedulesView.tsx`
- `apps/web/src/features/schedules/SchedulesView.test.tsx`
- 新增 `apps/web/src/features/schedules/ScheduleEditor.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/src/styles/app.css`
- 必要时修改 `packages/protocol/src/api.ts`

**实施步骤：**

1. 梳理已有 Schedule API 与 Web service 的字段差异。
2. 实现列表、创建、编辑、启用/停用、删除和手动触发。
3. 编辑器支持 cron、时区、项目目录、Profile、模型、推理级别、权限、并发策略和 misfire 策略。
4. 表单提供字段级验证，不把 daemon 错误只显示为通用失败。
5. 列表显示下一次运行、上次状态、上次 Run 和启用状态。
6. 手动触发后可跳转到对应 Run 或任务中心。
7. 移动端使用单列编辑和明确的保存/取消动作。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/features/schedules
pnpm --filter @clawee/daemon test -- test/unit/scheduler-service.test.ts
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
```

**浏览器验证：**

- 完成创建、编辑、停用、启用、手动触发和删除。
- 到期自动运行后列表状态更新。
- 无效 cron、无效目录和无效 Profile 有清晰提示。
- 桌面和移动端均可完成完整流程。

**验收标准：**

- Schedules 不再是占位页。
- 所有已有核心 Scheduler 操作有 UI 入口。
- 操作状态和 daemon 真实数据一致。
- 手动触发和自动触发可追踪到 Run。

**推荐提交信息：**

```text
feat(web): complete the schedules workspace
```

**回滚边界：** 回滚 Web 页面即可，Scheduler API 和数据不变。

**执行结果：** 待填写。

## P1-B7：MCP 与 Profiles 正式页面

- [ ] **状态：** `NOT_STARTED`

**目标：** 为 MCP Server 和 Codex Profile 提供真实管理页面，并让会话配置能够引用它们。

**依赖：** P0 阶段门禁。

**预计涉及文件：**

- 新增 `apps/web/src/services/mcp-service.ts`
- 新增 `apps/web/src/services/profile-service.ts`
- 新增 `apps/web/src/features/settings/McpSettingsView.tsx`
- 新增 `apps/web/src/features/settings/ProfileSettingsView.tsx`
- 对应测试文件
- `apps/web/src/features/settings/ClaweeSettingsView.tsx`
- `apps/web/src/features/runs/Composer.tsx`
- `apps/web/src/app/App.tsx`
- 必要时修改 `packages/protocol/src/api.ts`

**实施步骤：**

1. MCP 页面实现 list/get/add/remove/login/logout，并按 capability 控制可用操作。
2. 对 Token、环境变量值和 bearer 配置进行遮罩，禁止回显敏感值。
3. Profile 页面实现列表、创建、编辑、校验和删除。
4. Profile 编辑器支持模型、推理、Sandbox 和允许的 Codex 配置字段。
5. Composer 和 Schedule Editor 使用同一 Profile 数据源。
6. 删除正在被线程或 Schedule 使用的 Profile 时给出冲突提示。
7. 所有外部命令失败展示稳定错误码和可操作提示。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/features/settings
pnpm --filter @clawee/daemon test -- test/unit/codex-mcp-manager.test.ts
pnpm --filter @clawee/daemon test -- test/unit/codex-profile-config.test.ts
pnpm --filter @clawee/web typecheck
pnpm build
```

**浏览器验证：**

- 添加并删除 stdio MCP。
- 对支持的 MCP 完成登录或退出。
- 创建 Profile 并在新会话中选择使用。
- 无能力支持时按钮禁用且说明原因。
- 页面不显示 Secret 原文。

**验收标准：**

- MCP 和 Profiles 不再只有后端 API。
- Capability 检测决定 UI 操作。
- 敏感值不回显、不进入普通日志。
- Profile 可被 Composer 和 Schedule 共用。

**推荐提交信息：**

```text
feat(web): add mcp and profile management
```

**回滚边界：** 回滚 Web 页面和 service；daemon 既有接口不变。

**执行结果：** 待填写。

## P1-B8：Cleanup 与 Diagnostics 设置页

- [ ] **状态：** `NOT_STARTED`

**目标：** 提供可预览、可确认的清理流程和可导出的诊断信息。

**依赖：** P0 阶段门禁。

**预计涉及文件：**

- `apps/web/src/services/diagnostics-service.ts`
- 新增 `apps/web/src/services/cleanup-service.ts`
- 新增 `apps/web/src/features/settings/CleanupSettingsView.tsx`
- 新增 `apps/web/src/features/settings/DiagnosticsSettingsView.tsx`
- 对应测试文件
- `apps/web/src/features/settings/ClaweeSettingsView.tsx`
- `apps/web/src/features/runs/RunDetailPanel.tsx`
- `apps/web/src/styles/app.css`

**实施步骤：**

1. Cleanup 先预览再删除，显示数量、大小、路径类型和保留规则。
2. 删除动作必须二次确认，并清楚区分成功、失败和跳过。
3. Diagnostics 页面展示 Codex 状态、Capabilities、运行目录、日志告警和版本。
4. Run Detail 支持查看并导出已脱敏诊断包。
5. 复制或导出前再次确认不包含 Token、Secret 和未脱敏 Prompt。
6. 增加空状态、部分失败和 daemon 断线状态。
7. 为移动端长路径和大诊断文本提供可用布局。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/features/settings
pnpm --filter @clawee/daemon test -- test/unit/cleanup-service.test.ts
pnpm --filter @clawee/daemon test -- test/integration/diagnostics.test.ts
pnpm --filter @clawee/web typecheck
pnpm build
```

**浏览器验证：**

- 预览 0 项和多项清理结果。
- 取消确认时不删除。
- 部分删除失败时保留失败明细。
- 导出诊断后人工检查脱敏。

**验收标准：**

- 用户在删除前知道将删除什么。
- Cleanup 和 Diagnostics 有正式入口。
- 诊断导出默认脱敏。
- 部分失败不会被误报为全部成功。

**推荐提交信息：**

```text
feat(web): expose cleanup and diagnostics tools
```

**回滚边界：** 回滚 Web 页面，不改变 daemon 清理规则。

**执行结果：** 待填写。

## P1-B9：移动端导航与 Skill 市场性能

- [ ] **状态：** `NOT_STARTED`

**目标：** 让移动端主要工作流可用，并避免 Skill 市场完整渲染造成超长页面和滚动成本。

**依赖：** `P1-B3`。

**预计涉及文件：**

- `apps/web/src/components/layout/WorkbenchLayout.tsx`
- `apps/web/src/features/shell/ClaweeSidebar.tsx`
- `apps/web/src/features/plugins/SkillMarketView.tsx`
- `apps/web/src/features/plugins/skill-market-model.ts`
- `apps/web/src/features/plugins/skill-market.css`
- `apps/web/src/styles/app.css`
- 对应组件和 CSS 测试

**实施步骤：**

1. 移动端将项目/会话导航改为可关闭抽屉，不与主内容并排挤压。
2. 打开会话、搜索、Schedules、插件和设置后自动关闭抽屉。
3. 保证浏览器返回、页面返回和抽屉关闭语义一致。
4. Skill 市场使用分页、窗口化或“加载更多”，首屏不渲染全部卡片。
5. 保持筛选、收藏、安装状态和更新状态在分页后正确。
6. 详情使用适合移动端的全高面板，不嵌套卡片。
7. 修复长标题、平台标签和按钮在 390px 宽度下溢出。
8. 检查所有主视图的滚动容器，避免页面完全无法下滑。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/components/layout
pnpm --filter @clawee/web test -- src/features/shell
pnpm --filter @clawee/web test -- src/features/plugins
pnpm --filter @clawee/web test -- src/styles/app-css.test.ts
pnpm --filter @clawee/web build
```

**浏览器验证：**

- 390x844 下完成会话切换、搜索、Skill 安装和使用。
- 插件市场首屏高度和 DOM 数量显著低于原 27578px 全量页面。
- 抽屉打开时焦点受控，关闭后焦点返回触发按钮。
- 所有页面可正常纵向滚动，无横向溢出。

**验收标准：**

- 移动端主要导航形成抽屉闭环。
- Skill 市场不再一次渲染全部条目。
- 安装、更新、收藏、筛选和使用不因分页失效。
- 无页面无法下滑问题。

**推荐提交信息：**

```text
perf(web): improve mobile navigation and skill browsing
```

**回滚边界：** 移动导航和 Skill 列表优化可分别回滚，市场数据与安装 API 不变。

**执行结果：** 待填写。

## P1-B10：App 模块化、路由和代码分割

- [ ] **状态：** `NOT_STARTED`

**目标：** 在行为稳定后拆分 `App.tsx`，引入正式路由和页面级懒加载，降低主包和维护复杂度。

**依赖：** `P1-B3`、`P1-B5` 至 `P1-B9`。

**预计涉及文件：**

- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/main.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/routes.ts`
- 新增 `apps/web/src/app/AppProviders.tsx`
- 新增 `apps/web/src/app/AppRouter.tsx`
- 新增 `apps/web/src/features/conversation/ConversationPage.tsx`
- 新增 `apps/web/src/features/search/SearchPage.tsx`
- 新增 `apps/web/src/features/schedules/SchedulesPage.tsx`
- 新增 `apps/web/src/features/plugins/PluginsPage.tsx`
- 新增 `apps/web/src/features/settings/SettingsPage.tsx`
- 新增 `apps/web/src/features/files/FilesPage.tsx`
- 按领域拆分 CSS

**实施步骤：**

1. 先建立行为回归测试，锁定路由、会话选择、草稿插入、文件打开和返回行为。
2. 引入 `react-router-dom` 或等价稳定路由方案。
3. 定义可复制的 URL：
   - 会话
   - 搜索
   - Schedules
   - 插件
   - 设置
   - 文件
4. 将连接、项目、线程、RunRegistry 和用户偏好放入边界清晰的 Provider/controller。
5. 按页面提取组件，不在一次提交中重写所有业务逻辑。
6. 对非首屏页面使用 `React.lazy` 和页面级代码分割。
7. 清理已不再使用的 mock service、旧 ActiveView 分支和重复状态。
8. 拆分 `app.css`，保持 token 和领域样式边界。
9. 对比构建产物，记录主包和各 chunk 大小。

**自动化测试：**

```bash
pnpm --filter @clawee/web test
pnpm --filter @clawee/web typecheck
pnpm --filter @clawee/web build
pnpm test
```

**浏览器验证：**

- 直接打开每个页面 URL。
- 刷新会话 URL 后恢复正确会话。
- 浏览器前进/后退不丢失当前页面语义。
- 插件“使用”创建会话并插入草稿。
- 文件链接打开 Files 页面并定位文件。
- 检查 Network，非首屏页面 chunk 按需加载。

**验收标准：**

- `App.tsx` 只保留顶层编排，不再承载大部分页面业务。
- 每个主视图有稳定 URL。
- 页面级代码分割生效。
- 主包体积低于 P1 前基线，且无明显功能回归。
- 遗留 mock 和不可达代码被清理。

**推荐提交信息：**

```text
refactor(web): split app routes and feature controllers
```

**回滚边界：** 路由和模块拆分必须在同一批保持可运行；若失败可整体回滚到拆分前，不修改 daemon API。

**执行结果：** 待填写。

## P1 阶段门禁

- [ ] P1-B1 至 P1-B10 全部为 `PASS`。
- [ ] 300 项以上会话可分页、搜索和流畅滚动。
- [ ] Timeline 和 Skill 市场不再全量渲染。
- [ ] Search、Schedules、MCP、Profiles、Cleanup、Diagnostics 均有正式入口。
- [ ] 桌面和移动端主流程通过。
- [ ] 主包体积和 DOM 基线已重新记录。
- [ ] `pnpm test`、`pnpm typecheck`、`pnpm build` 全部通过。
- [ ] Git 工作区干净。

**P1 门禁结果：** 待填写。

---

# 11. P2：完整 Agent 能力

## P2 阶段目标

补齐多模态输入、任务 Steering、安全审批、通知恢复和显式记忆，使 Clawee 不仅能运行 Codex，还能完整管理用户任务、上下文和风险。

## P2 状态总览

- [ ] `P2-B1` 附件存储与安全 API
- [ ] `P2-B2` 多模态 Composer 与 Run
- [ ] `P2-B3` 排队发送与立即打断并继续
- [ ] `P2-B4` HTML 安全预览
- [ ] `P2-B5` 真实审批闭环
- [ ] `P2-B6` 通知、任务中心与 daemon 重启恢复
- [ ] `P2-B7` 用户显式长期记忆与上下文摘要
- [ ] `P2-B8` 发布、文档和持续质量

## P2-B1：附件存储与安全 API

- [ ] **状态：** `NOT_STARTED`

**目标：** 建立受控的附件导入、元数据、读取和清理能力，为多模态 Composer 提供安全基础。

**依赖：** P1 阶段门禁。

**预计涉及文件：**

- `packages/protocol/src/api.ts`
- `packages/protocol/src/errors.ts`
- `apps/daemon/src/storage/migrations.ts`
- 新增 `apps/daemon/src/attachments/service.ts`
- 新增 `apps/daemon/src/api/routes.attachments.ts`
- `apps/daemon/src/api/server.ts`
- 新增 `apps/daemon/test/unit/attachment-service.test.ts`
- `apps/daemon/test/integration/api.test.ts`
- 新增 `apps/web/src/services/attachment-service.ts`

**实施步骤：**

1. 定义附件模型：ID、原文件名、MIME、大小、哈希、存储路径、所属草稿/线程、创建时间和状态。
2. 只允许白名单类型和大小上限，首版优先图片和文本类附件。
3. 文件名只用于展示，实际存储使用生成 ID，禁止路径穿越。
4. 使用流式上传或受限 body，避免大文件一次进入内存。
5. 计算内容哈希并支持同一草稿内去重。
6. 提供上传、元数据、受权读取和删除 API。
7. 未发送草稿附件设置过期清理策略。
8. 诊断日志只记录元数据，不记录附件原始内容。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/unit/attachment-service.test.ts
pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "attachment"
pnpm --filter @clawee/daemon typecheck
pnpm --filter @clawee/web typecheck
```

**真实环境验证：**

- 上传合法图片、重复图片、超限文件、伪造 MIME 和路径型文件名。
- 删除草稿附件后文件不可再访问。
- daemon 重启后已提交附件元数据仍一致。

**验收标准：**

- 附件不能逃逸受控存储目录。
- 类型、大小和权限检查有效。
- 上传失败不留下孤立半文件。
- 附件生命周期可清理、可诊断。

**推荐提交信息：**

```text
feat(daemon): add secure attachment storage
```

**回滚边界：** 附件表和目录为附加数据；回滚 API 时保留数据，后续由 Cleanup 清理。

**执行结果：** 待填写。

## P2-B2：多模态 Composer 与 Run

- [ ] **状态：** `NOT_STARTED`

**目标：** 用户可以在 Composer 添加图片等附件，预览后随 Run 一起发送。

**依赖：** `P2-B1`。

**预计涉及文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/src/api/routes.runs.ts`
- `apps/daemon/src/codex/argv.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/web/src/features/runs/Composer.tsx`
- `apps/web/src/features/runs/Composer.test.tsx`
- 新增 `apps/web/src/features/runs/AttachmentTray.tsx`
- `apps/web/src/services/attachment-service.ts`
- `apps/web/src/services/run-service.ts`
- `apps/web/src/app/App.tsx`

**实施步骤：**

1. 明确 Codex CLI 当前版本支持的图片参数和能力检测。
2. RunRequest 使用附件 ID，不直接信任 Web 传入任意本地路径。
3. daemon 将附件 ID 解析为受控路径，再构造 Codex 参数。
4. Composer 支持文件选择、拖放、粘贴图片、预览、移除和上传进度。
5. 发送前等待附件上传完成；上传失败的附件不能进入 Run。
6. Capability 不支持多模态时禁用入口并提示更新 Codex。
7. Timeline 用户消息显示附件缩略图和元数据。
8. 发送成功后附件归属 Run；取消草稿时清理未使用附件。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- -t "images"
pnpm --filter @clawee/web test -- src/features/runs/Composer.test.tsx
pnpm --filter @clawee/web test -- src/features/runs/AttachmentTray.test.tsx
pnpm typecheck
pnpm build
```

**浏览器和真实环境验证：**

- 选择、拖入和粘贴图片。
- 删除附件后不发送。
- 使用真实 Codex 让模型描述图片内容。
- 刷新草稿页面时遵守既定草稿恢复策略。
- 移动端可使用系统文件选择器。

**验收标准：**

- 图片通过受控附件 ID 发送。
- 上传、预览、移除、失败和发送状态清楚。
- 不支持的 Codex 版本提示更新，而不是静默失败。
- 用户消息和 Run 详情可追踪附件。

**推荐提交信息：**

```text
feat: support multimodal run attachments
```

**回滚边界：** 回滚 Composer 和 Run 接线，保留附件基础 API。

**执行结果：** 待填写。

## P2-B3：排队发送与立即打断并继续

- [ ] **状态：** `NOT_STARTED`

**目标：** 当前会话正在运行时，用户可以选择排队新消息，或取消当前 Run 后立即继续新任务。

**依赖：** P0 RunRegistry、`P2-B2`。

**预计涉及文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/api/routes.runs.ts`
- `apps/daemon/test/integration/run-manager.test.ts`
- `apps/web/src/features/runs/Composer.tsx`
- `apps/web/src/features/runs/Composer.test.tsx`
- `apps/web/src/features/runs/run-registry.ts`
- `apps/web/src/app/App.tsx`

**实施步骤：**

1. 定义两种明确动作：
   - `enqueue`：当前 Run 继续，新消息进入同线程队列。
   - `interrupt_and_enqueue`：请求取消当前 Run，新消息排在其后，取消收敛后自动开始。
2. daemon 为队列项持久化顺序和请求类型，重启后不能丢失为未知状态。
3. Composer 在有活动 Run 时保持可输入，不再整体禁用。
4. 主发送动作默认使用用户最后选择或产品确定的默认策略；两种动作必须可发现。
5. Timeline 显示排队消息、队列位置、取消中和开始执行状态。
6. 用户可取消尚未开始的排队项。
7. 处理当前 Run 已在提交瞬间完成、取消失败、多个快速提交和附件排队。
8. 不允许同一线程出现两个同时运行的 Codex 进程。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- test/integration/run-manager.test.ts -t "queue"
pnpm --filter @clawee/daemon test -- test/integration/run-manager.test.ts -t "interrupt"
pnpm --filter @clawee/web test -- src/features/runs/Composer.test.tsx
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "queued prompt"
pnpm typecheck
```

**浏览器验证：**

- 慢 Run 中连续排队两条消息，按顺序执行。
- 慢 Run 中选择“立即打断并继续”，当前 Run 收敛后新 Run 开始。
- 取消一个尚未开始的队列项。
- 切换会话后队列状态仍正确。
- 刷新后队列和当前 Run 恢复。

**验收标准：**

- 运行中 Composer 可继续输入和提交。
- 队列顺序稳定且可恢复。
- 打断不会启动两个并行 Run。
- 用户能区分运行中、取消中、排队和已开始。

**推荐提交信息：**

```text
feat: add queued and interrupting follow-up prompts
```

**回滚边界：** 回滚新请求模式和 Web 控件；保留原有 daemon 单线程队列能力。

**执行结果：** 待填写。

## P2-B4：HTML 安全预览

- [ ] **状态：** `NOT_STARTED`

**目标：** HTML 文件默认以完整页面预览展示，但脚本、顶层导航和高风险能力默认禁用。

**依赖：** P1 阶段门禁。

**预计涉及文件：**

- `apps/web/src/features/files/FileEditorPane.tsx`
- 新增 `apps/web/src/features/files/HtmlPreview.tsx`
- 新增 `apps/web/src/features/files/HtmlPreview.test.tsx`
- `apps/web/src/services/workspace-file-service.ts`
- `apps/daemon/src/api/routes.workspace-files.ts`
- `apps/web/src/styles/app.css`

**实施步骤：**

1. 使用 sandboxed iframe 展示 HTML，默认不包含 `allow-scripts`。
2. 禁止顶层导航、弹窗、下载、表单提交和同源权限，除非有明确受控需求。
3. 为相对静态资源提供受限的 workspace preview URL 或安全重写机制。
4. 外链点击默认拦截，并通过明确动作在外部浏览器打开。
5. 增加源码/预览切换，默认 HTML 使用预览。
6. 增加“信任并临时启用脚本”时必须有风险确认，且仅对当前预览会话生效；首版可不提供启用脚本。
7. 大尺寸预览使用完整可用区域，不限制为过小卡片。
8. 对脚本、iframe、恶意导航、路径穿越资源和 CSP 补测试。

**自动化测试：**

```bash
pnpm --filter @clawee/web test -- src/features/files/HtmlPreview.test.tsx
pnpm --filter @clawee/web test -- src/features/files/FileEditorPane.test.tsx
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
pnpm --filter @clawee/web typecheck
pnpm build
```

**浏览器验证：**

- 普通 HTML 页面完整显示样式和布局。
- `<script>` 不执行。
- `window.top` 导航、弹窗和表单提交被阻止。
- 相对图片和 CSS 在允许范围内正常显示。
- 桌面和移动端预览区域足够大。

**验收标准：**

- HTML 默认展示页面而不是源码。
- 默认脚本不执行。
- 预览不能逃逸工作区或控制 Clawee 顶层页面。
- 用户可随时切换源码查看。

**推荐提交信息：**

```text
security(web): sandbox html file previews
```

**回滚边界：** 回滚 HtmlPreview 到源码模式，不能以放宽 sandbox 作为临时修复。

**执行结果：** 待填写。

## P2-B5：真实审批闭环

- [ ] **状态：** `NOT_STARTED`

**目标：** 将需要用户确认的高风险 Agent 操作从 daemon 传递到 Web，由用户批准或拒绝后继续执行。

**依赖：** P0 Run 事件恢复、`P2-B6` 前可独立实施。

**预计涉及文件：**

- `packages/protocol/src/events.ts`
- `packages/protocol/src/api.ts`
- `packages/protocol/src/errors.ts`
- 新增 `apps/daemon/src/approvals/manager.ts`
- 新增 `apps/daemon/src/api/routes.approvals.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/src/runs/manager.ts`
- 新增 daemon 审批测试
- `apps/web/src/services/approval-service.ts`
- 新增 `apps/web/src/features/approvals/ApprovalPanel.tsx`
- `apps/web/src/components/timeline/Timeline.tsx`
- `apps/web/src/app/App.tsx`

**实施步骤：**

1. 定义审批状态机：`pending -> approved/rejected/expired/canceled`。
2. 审批记录关联 `runId`、`threadId`、操作摘要、风险级别、请求时间和过期时间。
3. 只传递脱敏、可理解的操作摘要，不把 Secret 放入 Web。
4. daemon Run 在等待审批时进入可恢复状态，并通过事件通知 Web。
5. 提供批准和拒绝 API，保证幂等。
6. Web 在当前会话 Timeline 和全局任务中心显示待审批项。
7. 用户批准前明确展示将执行的命令、路径、网络目标或写操作范围。
8. 刷新和切换会话后待审批状态可恢复。
9. daemon 重启后不能把待审批操作自动视为批准。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- -t "approval"
pnpm --filter @clawee/web test -- src/features/approvals
pnpm --filter @clawee/web test -- src/app/App.test.tsx -t "approval"
pnpm test
pnpm typecheck
```

**浏览器和真实环境验证：**

- 触发文件写入或高风险命令审批。
- 批准后 Run 继续。
- 拒绝后 Run 收敛并显示原因。
- 刷新后待审批仍存在。
- daemon 重启后审批仍未被自动放行。

**验收标准：**

- 高风险操作有真实 daemon 到 Web 审批闭环。
- 审批幂等、可恢复、可过期。
- UI 显示足够决策信息但不泄密。
- 默认拒绝或无响应不会执行操作。

**推荐提交信息：**

```text
feat: add recoverable runtime approvals
```

**回滚边界：** 若审批链路不稳定，应回滚为阻止高风险操作，不得回滚为默认允许。

**执行结果：** 待填写。

## P2-B6：通知、任务中心与 daemon 重启恢复

- [ ] **状态：** `NOT_STARTED`

**目标：** 提供跨会话的任务中心和系统通知，并统一处理 daemon 重启后的非终态任务。

**依赖：** P0 阶段、`P2-B3`、`P2-B5`。

**预计涉及文件：**

- `apps/daemon/src/runs/manager.ts`
- `apps/daemon/src/storage/repositories.ts`
- `apps/daemon/src/api/routes.runs.ts`
- 新增 `apps/web/src/features/tasks/TaskCenter.tsx`
- 新增 `apps/web/src/features/tasks/TaskCenter.test.tsx`
- 新增 `apps/web/src/services/notification-service.ts`
- `apps/web/src/features/shell/ClaweeSidebar.tsx`
- `apps/web/src/features/runs/run-registry.ts`
- `apps/web/src/app/App.tsx`

**实施步骤：**

1. 定义任务中心展示范围：运行中、排队、等待审批、最近完成、失败和取消。
2. daemon 启动时扫描非终态 Run：
   - 可确认仍有进程并可恢复的，恢复监控。
   - 无法恢复的，收敛为明确中断状态并写 done 事件。
3. 提供分页任务列表 API，避免 Web 扫描所有线程。
4. Web 在任务中心显示线程、状态、开始时间、耗时和待处理动作。
5. 点击任务跳转到对应会话和 Run。
6. 对后台完成、失败和待审批发送可选系统通知。
7. 通知权限必须由用户主动开启；前台当前会话不重复通知。
8. 未读状态和已读状态本地持久化，并可清除。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- -t "non-terminal"
pnpm --filter @clawee/daemon test -- -t "restart recovery"
pnpm --filter @clawee/web test -- src/features/tasks
pnpm --filter @clawee/web test -- src/services/notification-service.test.ts
pnpm typecheck
pnpm build
```

**浏览器和真实环境验证：**

- 在会话 A 启动任务后切到 B，A 完成时出现任务中心更新。
- 获得权限后后台完成发送系统通知。
- 点击通知或任务项进入正确会话。
- Run 中停止 daemon 并重启，状态最终收敛。
- 待审批任务在任务中心可处理。

**验收标准：**

- 用户不必逐个打开会话检查任务状态。
- daemon 重启后无永久假 `running`。
- 通知是可选的，不在前台重复轰炸。
- 任务中心支持分页和状态筛选。

**推荐提交信息：**

```text
feat: add task center and restart recovery
```

**回滚边界：** 可回滚 Web 通知；daemon 非终态收敛修复应保留。

**执行结果：** 待填写。

## P2-B7：用户显式长期记忆与上下文摘要

- [ ] **状态：** `NOT_STARTED`

**目标：** 提供用户可见、可编辑、可删除、可选择启用的长期记忆，并对长会话生成可控摘要。

**依赖：** P1 历史索引和搜索。

**预计涉及文件：**

- `packages/protocol/src/api.ts`
- `apps/daemon/src/storage/migrations.ts`
- 新增 `apps/daemon/src/memory/repository.ts`
- 新增 `apps/daemon/src/memory/service.ts`
- 新增 `apps/daemon/src/api/routes.memory.ts`
- `apps/daemon/src/api/server.ts`
- 新增 daemon memory 测试
- 新增 `apps/web/src/services/memory-service.ts`
- 新增 `apps/web/src/features/settings/MemorySettingsView.tsx`
- 新增 `apps/web/src/features/conversation/MemorySuggestion.tsx`
- `apps/web/src/app/App.tsx`

**实施步骤：**

1. 定义记忆范围：全局、项目和线程。
2. 每条记忆保存正文、来源、范围、启用状态、创建时间、更新时间和用户确认信息。
3. 首版只允许：
   - 用户手动创建。
   - Agent 建议后用户明确保存。
   - 用户编辑、禁用和删除。
4. 禁止后台自动永久保存未确认内容。
5. 发送 Run 时按范围和启用状态选择记忆，设置数量和 Token 上限。
6. 长会话摘要作为独立可见对象，记录覆盖的历史游标范围和生成版本。
7. 摘要失败时回退到原始分页历史，不破坏会话。
8. 设置页提供记忆搜索、范围筛选、编辑、删除和全部停用。
9. 对敏感信息建议保存时显示警告，并允许用户拒绝。

**自动化测试：**

```bash
pnpm --filter @clawee/daemon test -- -t "memory"
pnpm --filter @clawee/daemon test -- -t "summary"
pnpm --filter @clawee/web test -- src/features/settings/MemorySettingsView.test.tsx
pnpm --filter @clawee/web test -- src/features/conversation/MemorySuggestion.test.tsx
pnpm test
pnpm typecheck
```

**浏览器和真实环境验证：**

- 手动创建项目记忆，在该项目新会话中生效。
- 在其他项目中不生效。
- Agent 建议记忆时拒绝，不产生持久记录。
- 编辑、停用和删除后后续 Run 不再使用旧内容。
- 对长会话生成摘要，刷新后仍可见覆盖范围。

**验收标准：**

- 长期记忆完全由用户显式管理。
- 记忆作用域和 Token 上限明确。
- 用户能知道某次 Run 使用了哪些记忆或摘要。
- 删除和停用能影响后续 Run。
- 不将个人长期记忆写入外部知识库。

**推荐提交信息：**

```text
feat: add user-managed memory and summaries
```

**回滚边界：** 回滚记忆注入时保留用户数据；不得静默丢弃已保存记忆。

**执行结果：** 待填写。

## P2-B8：发布、文档和持续质量

- [ ] **状态：** `NOT_STARTED`

**目标：** 完成最终发布准备，建立真实 smoke、性能回归、依赖维护和用户文档门禁。

**依赖：** `P2-B1` 至 `P2-B7`。

**预计涉及文件：**

- `README.md`
- `docs/runtime-api-for-ui-v1.md`
- 新增用户使用和故障排查文档
- `package.json`
- 各 workspace `package.json`
- CI 配置文件
- `apps/daemon/test/smoke/real-codex-smoke.test.ts`
- 新增 Web 性能回归脚本或测试
- 新增最终测试报告

**实施步骤：**

1. 更新 README：安装、启动、连接 daemon、主要页面、权限和数据目录。
2. 更新 Runtime API 文档，覆盖分页、搜索、附件、队列、审批、任务中心和记忆。
3. 增加数据备份、清理、诊断和恢复说明。
4. 审计依赖，升级安全和稳定性相关依赖，避免无关的大版本跳跃。
5. CI 执行测试、类型检查、构建和不依赖真实 Codex 的 smoke。
6. 真实 Codex smoke 在具备环境的发布流程中执行。
7. 固化性能基线：
   - 首屏包体积。
   - 长会话 DOM 数量。
   - 历史首屏响应时间。
   - 搜索响应时间。
   - daemon 高频事件响应性。
8. 完成桌面、移动、刷新、切换、附件、排队、审批、通知和记忆的最终回归。
9. 生成最终测试报告，列明已知限制和后续候选项。

**自动化测试：**

```bash
pnpm test
pnpm typecheck
pnpm build
CLAWEE_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

**浏览器和真实环境验证：**

- 在全新本地数据目录启动。
- 导入已有 Codex sessions 并完成索引。
- 完成一个文本任务、一个图片任务、一个排队任务和一个审批任务。
- 验证任务中心、搜索、Schedules、插件、文件预览、设置和记忆。
- 关闭并重启 daemon，检查状态恢复。
- 在 1440x900 和 390x844 完成核心流程。

**验收标准：**

- 文档可支持新用户从零启动并排查常见问题。
- 全局测试、类型检查、构建和真实 smoke 通过。
- 性能没有退回 P1 前基线。
- 最终测试报告完整。
- 没有未说明的 P0/P1 级缺陷。

**推荐提交信息：**

```text
docs: finalize clawee agent release readiness
```

**回滚边界：** 文档和 CI 可独立回滚；发布前发现功能问题必须回到对应批次修复。

**执行结果：** 待填写。

## P2 阶段门禁

- [ ] P2-B1 至 P2-B8 全部为 `PASS`。
- [ ] 文本、多模态、排队、打断、审批和后台通知主流程通过。
- [ ] HTML 默认安全预览通过安全测试。
- [ ] daemon 重启后所有非终态任务最终收敛。
- [ ] 用户可完整管理长期记忆。
- [ ] 全局测试、类型检查、构建和真实 smoke 通过。
- [ ] 最终测试报告已提交。
- [ ] README 和 API 文档已更新。
- [ ] Git 工作区干净。

**P2 门禁结果：** 待填写。

---

# 12. 最终完成定义

只有以下条件全部满足，本文档总体实施状态才能改为 `COMPLETE`：

1. P0、P1、P2 所有批次状态均为 `PASS`。
2. 三个阶段门禁全部通过。
3. 刷新、切换会话、后台完成、取消、排队和 daemon 重启不存在状态分裂。
4. 长会话采用分页和虚拟化，搜索覆盖会话正文。
5. Search、Schedules、MCP、Profiles、Cleanup、Diagnostics、插件、文件工作区和任务中心均可从正式导航进入。
6. 多模态、HTML 安全预览和审批闭环通过真实环境验证。
7. 长期记忆由用户显式管理，并可知道 Run 使用了哪些记忆。
8. `pnpm test`、`pnpm typecheck`、`pnpm build` 和真实 Codex smoke 全部通过。
9. 桌面和移动端最终验收通过。
10. README、API 文档、故障排查和最终测试报告齐全。
11. 所有实施提交已推送到目标远端分支。
12. Git 工作区干净。

## 12.1 最终验收矩阵

| 领域 | 核心场景 | 自动化 | 真实环境 | 结果 |
|---|---|---:|---:|---|
| Scheduler | 到期自动触发且只触发一次 | 待执行 | 待执行 | `NOT_STARTED` |
| Run 恢复 | 刷新后恢复运行中 Run | 待执行 | 待执行 | `NOT_STARTED` |
| 会话切换 | 后台运行、返回恢复、无内容污染 | 待执行 | 待执行 | `NOT_STARTED` |
| 取消与队列 | 取消当前 Run、排队、打断继续 | 待执行 | 待执行 | `NOT_STARTED` |
| daemon 重启 | 非终态 Run 最终收敛 | 待执行 | 待执行 | `NOT_STARTED` |
| 历史 | 游标分页、向上加载、无重复 | 待执行 | 待执行 | `NOT_STARTED` |
| Timeline | 300+ 项虚拟化和滚动稳定 | 待执行 | 待执行 | `NOT_STARTED` |
| 搜索 | 中英文正文搜索和结果定位 | 待执行 | 待执行 | `NOT_STARTED` |
| Schedules | 创建、编辑、启停、触发、删除 | 待执行 | 待执行 | `NOT_STARTED` |
| MCP/Profile | 管理、能力判断、敏感值遮罩 | 待执行 | 待执行 | `NOT_STARTED` |
| Cleanup/Diagnostics | 预览删除、脱敏导出 | 待执行 | 待执行 | `NOT_STARTED` |
| Skill 市场 | 分页、安装、更新、使用 | 待执行 | 待执行 | `NOT_STARTED` |
| 文件预览 | HTML、图片、PDF、文本 | 待执行 | 待执行 | `NOT_STARTED` |
| HTML 安全 | 脚本、导航、弹窗默认阻止 | 待执行 | 待执行 | `NOT_STARTED` |
| 多模态 | 上传图片并完成真实 Run | 待执行 | 待执行 | `NOT_STARTED` |
| 审批 | 批准、拒绝、刷新恢复、重启安全 | 待执行 | 待执行 | `NOT_STARTED` |
| 通知/任务中心 | 后台完成通知和任务跳转 | 待执行 | 待执行 | `NOT_STARTED` |
| 记忆 | 显式保存、范围、编辑、停用、删除 | 待执行 | 待执行 | `NOT_STARTED` |
| 响应式 | 1440x900 与 390x844 主流程 | 待执行 | 待执行 | `NOT_STARTED` |
| 性能 | 包体积、DOM、API、daemon 响应 | 待执行 | 待执行 | `NOT_STARTED` |

## 12.2 性能基线记录模板

| 指标 | 优化前 | P1 完成 | P2 完成 | 测量方式 |
|---|---:|---:|---:|---|
| Web 主包 | 约 996KB | 待填写 | 待填写 | Vite build 输出 |
| Web 主包 gzip | 约 325KB | 待填写 | 待填写 | Vite build 输出 |
| 长会话 Timeline 项 | 约 379 | 同数据集 | 同数据集 | 固定测试会话 |
| 长会话 DOM 节点 | 约 8265 | 待填写 | 待填写 | 浏览器 Elements/脚本 |
| 长会话页面高度 | 约 153662px | 待填写 | 待填写 | 浏览器测量 |
| 移动插件市场高度 | 约 27578px | 待填写 | 待填写 | 390x844 |
| 历史首屏响应 | 待补测 | 待填写 | 待填写 | daemon 计时 |
| 搜索 P95 | 不适用 | 待填写 | 待填写 | 固定索引数据集 |
| 高频事件 healthz 响应 | 待补测 | 待填写 | 待填写 | 并发 smoke |

---

# 13. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| RunRegistry 与历史合并产生重复 Timeline | 高 | 使用稳定事件 ID、`runId + seq` 和历史 item ID 去重，先写竞态测试 |
| Codex JSONL 格式变化 | 高 | 索引版本、容错解析、未知事件忽略、单 session 降级 |
| SQLite FTS5 在环境中不可用 | 中 | 启动时能力检测；必要时提供受限 LIKE 降级并标记性能限制 |
| 虚拟列表对动态 Markdown 高度处理不稳 | 高 | 使用成熟库，覆盖图片、详情展开、prepend 和滚动保持测试 |
| 异步日志写入丢失尾部 | 高 | Run 终态和 server close 强制 drain，顺序和故障注入测试 |
| `App.tsx` 拆分引入行为回归 | 高 | 放在 P1 最后，先锁定行为测试，按页面逐步提取 |
| 审批能力受 Codex CLI 事件协议限制 | 高 | 先做 capability 探测和协议 spike；无法可靠拦截时默认阻止，不伪造审批 |
| 多模态参数随 Codex 版本变化 | 中 | Capability 检测、版本提示和真实 smoke |
| 长期记忆造成隐私风险 | 高 | 仅用户显式保存，默认可见、可停用、可删除，不写外部知识库 |
| 计划跨多会话后状态失真 | 中 | 每批独立提交、本文档状态更新、实施日志和阶段门禁 |

---

# 14. 实施日志

每次开始、暂停、阻塞、完成批次时追加一行。不要覆盖历史记录。

| 日期 | 批次 | 状态变化 | 提交 SHA | 验证摘要 | 遗留问题 / 下一步 |
|---|---|---|---|---|---|
| 2026-07-12 | 计划制定 | `NOT_STARTED` | - | 已建立 P0/P1/P2 分批实施计划 | 从 `P0-B1` 开始 |
| 2026-07-12 | P0-B1 | `NOT_STARTED -> IN_PROGRESS` | - | 开始验证生产入口 Scheduler autostart 接线 | 先补失败测试 |
| 2026-07-12 | P0-B1 | `IN_PROGRESS -> PASS` | `485a808` | daemon 全量测试、类型检查、构建和真实定时触发通过 | 下一批 `P0-B2` |
| 2026-07-12 | P0-B2 | `NOT_STARTED -> IN_PROGRESS` | - | 开始建立按线程隔离的 Web RunRegistry | 先补 Registry 和当前会话查询失败测试 |
| 2026-07-12 | P0-B2 | `IN_PROGRESS -> BLOCKED_ENV` | `adc8815` | Web 319 个测试、类型检查、构建和真实服务健康检查通过；浏览器控制环境无可用浏览器 | 完成桌面/移动人工验收后改为 `PASS`，再进入 `P0-B3` |
| 2026-07-12 | P0-B2 回归修复 | `保持 BLOCKED_ENV` | `5afd460` | 修复首批 50 条之外的已选历史会话在刷新后被清空；Web 320 个测试通过 | 继续等待桌面/移动人工验收 |
| 2026-07-12 | P0-B3 前置修复 | `NOT_STARTED -> IN_PROGRESS` | `cdd7a97`, `648e11a`, `91df841` | 已完成重新进入活动 Run 后续订、会话级实时 Timeline 保留和侧栏运行状态展示 | 继续实现独立 Run Event Controller、有限重连和硬刷新去重 |
| 2026-07-12 | P0-B3 | `IN_PROGRESS -> BLOCKED_ENV` | `6364a64`, `76c1306`, `bf35d8e` | 全量测试、类型检查、构建和真实 daemon 断流续传通过；9000 已重启到当前代码 | 浏览器运行时无可用实例，等待桌面/移动刷新与离线恢复验收 |
| 2026-07-12 | P0-B2 / P0-B3 | `BLOCKED_ENV -> PASS` | `adc8815` 至 `bf35d8e` | 用户已完成真实页面手动验收，确认运行状态隔离、刷新恢复、切换恢复和移动尺寸无问题 | 下一批 `P0-B4` |
| 2026-07-12 | P0-B4 | `NOT_STARTED -> IN_PROGRESS` | - | 开始拆分当前会话 Timeline 订阅与后台 Run 生命周期，并收口取消竞态 | 先补后台完成、跨会话隔离和迟到取消响应失败测试 |
| 2026-07-12 | P0-B4 | `IN_PROGRESS -> BLOCKED_ENV` | `75e5b9b` | Web 333 项测试、类型检查、构建和真实双线程运行/定向取消通过 | 等待用户完成真实页面跨会话后台运行验收 |
| 2026-07-12 | P0-B4 | `BLOCKED_ENV -> PASS` | `75e5b9b` | 用户确认继续下一批，真实页面验收门禁解除 | 下一批 `P0-B5` |
| 2026-07-12 | P0-B5 | `NOT_STARTED -> IN_PROGRESS` | - | 开始建立 P0 回归矩阵、真实 Codex smoke、daemon 重启验证和测试报告 | 先审计已有覆盖并补缺失测试 |
| 2026-07-12 | P0-B5 | `IN_PROGRESS -> PASS` | `fb5afe1` | 804 项常规测试、类型检查、构建、13 项真实 Codex smoke、SSE 续传、双线程取消、daemon 重启、Scheduler 到期和用户页面验收全部通过 | P0 门禁 `PASS`；下一批 `P1-B1` |
| 2026-07-12 | P1-B1 | `NOT_STARTED -> IN_PROGRESS` | - | 开始设计 Codex Session SQLite 增量索引、版本化来源状态和原始 JSONL 降级路径 | 先补迁移、增量追加、截断替换和损坏文件隔离测试 |
| 2026-07-12 | P1-B1 | `IN_PROGRESS -> PASS` | `423d8b8` | daemon 472 项测试、类型检查、构建通过；真实 3.44 GB 首次索引 9.44 秒，重复扫描 239 ms 且解析 0 行；追加和替换验证通过 | 下一批 `P1-B2` |
| 2026-07-12 | P1-B2 | `NOT_STARTED -> IN_PROGRESS` | - | 开始设计线程绑定的稳定历史游标、旧响应兼容和 Web 服务分页契约 | 先补首屏最新页、连续向前遍历、非法/过期/跨线程游标测试 |
| 2026-07-12 | P1-B2 | `IN_PROGRESS -> PASS` | `f908631` | daemon 477 项、Web 335 项、类型检查和构建通过；真实 23,101 条索引记录遍历 232 页，与 28,107 项完整历史逐项一致 | 下一批 `P1-B3` |
| 2026-07-12 | P1-B3 | `NOT_STARTED -> IN_PROGRESS` | - | 开始抽取历史分页状态、引入可变高度虚拟列表并重构底部跟随规则 | 先补首屏分页、向上加载、实时去重和 DOM 上限失败测试 |
| 2026-07-12 | P1-B3 | `IN_PROGRESS -> BLOCKED_ENV` | `9928c7c` | 全项目测试、类型检查和构建通过；首屏和第二页 DOM 约 76/88；已修复 prepend 锚点跳跃并补回归测试 | 当前无可连接浏览器，待完成桌面/移动真实验收后改为 `PASS` |
| 2026-07-12 | P1-B3 | `BLOCKED_ENV -> PASS` | `9928c7c` | 用户已完成真实页面验证并确认通过 | 下一批 `P1-B4` |
| 2026-07-12 | P1-B4 | `NOT_STARTED -> IN_PROGRESS` | - | 开始移除 Run 热路径同步 append，建立按 Run 隔离的有序异步日志写入与关闭 drain | 先补顺序、背压、失败和关闭行为测试 |
| 2026-07-12 | P1-B4 | `IN_PROGRESS -> PASS` | `4779b6b` | daemon 491 项测试、类型检查、构建、真实 Run 顺序核对和活动 Run 信号关闭验证全部通过 | 下一批 `P1-B5` |

## 14.1 单批次执行记录模板

```markdown
### YYYY-MM-DD HH:mm - P0-B1

- 执行前状态：
- 执行后状态：
- 基线提交：
- 完成内容：
- 修改文件：
- 专项测试：
  - `command` -> PASS / FAIL / BLOCKED_ENV
- 全局验证：
  - `command` -> PASS / FAIL / BLOCKED_ENV
- 浏览器/真实环境：
- 提交 SHA：
- 遗留风险：
- 下一批次：
```

## 14.2 阻塞记录模板

```markdown
### BLOCKED_ENV - 批次编号

- 阻塞时间：
- 阻塞命令：
- 错误摘要：
- 已完成内容：
- 未完成验证：
- 所需环境或外部条件：
- 条件恢复后的第一条验证命令：
- 当前工作区状态：
```

---

# 15. 执行入口

第一次执行本文档时：

1. 确认 Git 工作区干净。
2. 将 `P0-B1` 状态改为 `IN_PROGRESS`。
3. 在实施日志追加开始记录。
4. 只实施 `P0-B1`。
5. 完成专项测试和真实 Scheduler 验证。
6. 将 `P0-B1` 标为 `PASS` 并独立提交。
7. 工作区干净后，下一次执行进入 `P0-B2`。

任何后续 Agent 都应从本文档中第一个未完成批次继续，而不是重新制定一套并行计划。
