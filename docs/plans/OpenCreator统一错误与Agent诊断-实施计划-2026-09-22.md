# OpenCreator 统一错误与 Agent 诊断实施计划

> 交互修订（2026-09-23）：用户要求所有运行错误只在 Agent 区域以文字展示，并取消独立错误卡和可见诊断编号。本计划中冲突的 FR-1、FR-7、DEC-2、TASK-8、AC-1 等展示断言，以[错误仅在 Agent 区展示方案](OpenCreator错误仅在Agent区展示-交互修订-2026-09-23.md)为准；原有协议、持久化和输出校验门禁不因此豁免。

> 状态：审核完成，等待执行授权
> 体量判断：复杂。执行同时跨协议、Runtime 错误边界、SQLite 迁移、Creator 状态机、SSE、共享 Panel、Agent Context、模板输出校验、全产品页面迁移和 Desktop 发布门禁；各部分共享同一 Issue 身份与生命周期，不能独立发布，因此保持单一 Plan。
> 来源方案：[OpenCreator统一错误与Agent诊断方案-2026-09-22.md](../specs/OpenCreator统一错误与Agent诊断方案-2026-09-22.md)
> 用户批准：已批准（2026-09-22，原话：“没问题，继续”）
> 方案 Reviewer 原始结论：`REVISE`；R-01、R-02、R-03 已按关闭条件修订，方案流程结论为 `PASS`
> Plan Reviewer 原始结论：`REVISE`
> Plan 流程结论：`PASS`（PLAN-R-01 至 PLAN-R-04 已按 Reviewer 关闭条件修订；未伪造复审）
> 执行授权：未授权；用户看到本 Plan 的审核状态、修订和遗留风险后明确要求“开始执行”或等价指令，才允许修改业务代码

## 契约快照

### 目标与可观察行为

目标是建立全产品唯一的结构化错误语义：已发出的操作失败必须留下可理解、可再次查看、带诊断编号和真实动作的 Issue；Creator Job 的失败由 Daemon 持久化，并作为系统 Issue 项进入唯一的 `CreatorCollaborationPanel`，用户可聚焦该 Issue 追问原因、执行受控修复并观察 `open -> resolving -> resolved`；Stage 只有在候选输出通过结构与模板语义校验后才能提交 Artifact、结果版本、快照和成功状态。

非目标：不在非 Creator 页面新增 Agent；不把 Issue 写成 Activity 或 Assistant Message；不复制模板专属 Panel/SSE/审批逻辑；不替代日志、遥测和运维监控；不允许 Issue 动作绕过现有 Creator Runtime Action、能力判断和审批；不处理与错误交互无关的历史问题和通用 UI 重构。

### 需求与规则

| ID | 优先级 | 不可降低的执行约束 |
| --- | --- | --- |
| FR-1 | P0 | 已发出的页面操作失败必须显示本地化说明、诊断编号和实际可用下一步，原始异常不能成为唯一反馈。 |
| FR-2 | P0 | Creator API、上传、Preflight、Stage、Provider、Agent、客户端操作或阻塞输出验证失败后，共享 Panel 必须显示关联 Issue。 |
| FR-3 | P0 | 用户可选择具体 Issue 询问原因或修复办法，请求引用同一权威 Issue，Agent 不得根据客户端错误全文猜测。 |
| FR-4 | P0 | Issue 提供受控重试、打开设置、重新选择输入或聚焦 Agent，并显示修复处理中与解决状态。 |
| FR-5 | P0 | Stage 成功前校验必要输出；目标中文但结果仍主要为英文原文时使用 `creator_translation_output_language_mismatch` 阻止成功。 |
| FR-6 | P1 | Creator Issue 跨刷新和 Daemon 重启保留，记录发生次数、解决和复发历史。 |
| FR-7 | P1 | 非 Creator 页面复用同一 Issue/Presenter 语义，但仅在页面组件会话保存，不持久化且不新增 Agent。 |
| BR-1 | P0 | 请求发出前的必填、格式等字段错误仍就近显示，不创建 Issue。 |
| BR-2 | P0 | 已发出的操作失败创建 Issue；Toast 只能是即时提醒，不能是唯一载体。 |
| BR-3 | P0 | 用户主动取消、暂停或拒绝审批是正常状态，不创建红色错误 Issue。 |
| BR-4 | P0 | 同 Job 同指纹始终复用同一 Issue ID；重复失败增加次数，解决后复发清除 `resolvedAt`、重开并追加 `reopened` 事件。 |
| BR-5 | P0 | Agent 输出必须分为系统已确认事实、可能原因、下一步，不把推测写成确定根因。 |
| BR-6 | P0 | Agent 发起的付费调用、覆盖结果、改设置或写文件继续走现有审批；直接重试按钮只批准本次已显示动作。 |
| BR-7 | P1 | 非阻塞质量建议不进入错误时间线；只有阻止继续执行的 Warning 才生成 Issue。 |
| BR-8 | P1 | 旧 Stage 只从最新未恢复失败派生兼容 Issue；存在后续成功运行时不再派生开放 Issue。 |
| NFR-1 | P0 | API、Issue、Panel、Agent Context 和统计投影不得暴露密钥、请求头、完整敏感路径、原始堆栈或供应商原文。 |
| NFR-2 | P0 | 相同数据、偏好和内容视口下，Web/Desktop 的文案、状态、动作、Runtime 请求和持久化结果一致。 |
| NFR-3 | P1 | Job 快照、时间线和 Agent Context 只投影有界字段；完整 Issue 事件历史通过分页接口读取。 |
| NFR-4 | P1 | 协议和数据库只做加法迁移；旧客户端可忽略新增字段/事件，回滚保留新增表，不做破坏性逆迁移。 |
| NFR-5 | P1 | 可观测字段仅包含 code、source、status、retry result 等白名单维度，不包含用户原文或敏感详情。 |

### 关键决策

| ID | 不得改变的决定 |
| --- | --- |
| DEC-1 | `ApiError.error.issue?` 是唯一 API 错误信封增量；`ApiClientError.issue` 保留合法投影；`creator-job` Scope 持久化，`page` Scope 只在页面组件会话存在。 |
| DEC-2 | Issue 与 Activity、Agent Message、Stage 分离，只在唯一 `CreatorCollaborationPanel` 增加系统 Issue 时间线项。 |
| DEC-3 | 生命周期固定为 `open -> resolving -> resolved`；修复尝试关联 Command Receipt、Provider Request 或新 Stage Run；终态、启动恢复和复发由 Daemon 原子对账，并发布 `issue_changed`。 |
| DEC-4 | `CreatorAgentTurnRequest.focusedIssueId` 只传身份，Daemon 验证归属后由 Agent Context Builder读取权威详情。 |
| DEC-5 | 修复动作只允许协议联合类型，使用注册标识符和现有 Runtime Action/能力/审批；后端不下发命令、URL 或任意回调。 |
| DEC-6 | 通用结构校验和模板语义校验在执行器返回后、Artifact/快照/成功提交前执行；阻塞发现固定为 Stage=`failed`、Dispatch=`finished`、Issue=`open`，Job 按 `user-action/terminal` 进入 `needs_input/failed`。 |
| DEC-7 | 旧 Stage 错误字段继续写入；不批量改写历史 Job；旧失败按规则派生兼容 Issue；回滚保留新增表。 |

### 公共接口与数据模型

协议新增 `packages/protocol/src/issues.ts`，并由 `packages/protocol/src/index.ts` 导出。公开联合类型必须精确为：

```ts
export type IssueScope =
  | { kind: 'creator-job'; jobId: string }
  | { kind: 'page'; surface: string };

export type IssueSource =
  | 'api' | 'network' | 'upload' | 'preflight' | 'stage'
  | 'provider' | 'agent' | 'output-validator' | 'client';

export type IssueCategory =
  | 'configuration' | 'input' | 'permission' | 'network'
  | 'provider' | 'execution' | 'output-validation' | 'unknown';

export type CreatorRepairAction =
  | { kind: 'retry-operation'; operationId: string; requiresConfirmation: boolean; risk: 'normal' | 'paid' | 'overwrite' }
  | { kind: 'open-settings'; settingsRouteId: string }
  | { kind: 'select-input'; inputField: string }
  | { kind: 'focus-agent' };

export type OpenCreatorIssue = {
  id: string;
  diagnosticId: string;
  code: string;
  scope: IssueScope;
  source: IssueSource;
  category: IssueCategory;
  severity: 'warning' | 'error' | 'fatal';
  status: 'open' | 'resolving' | 'resolved';
  operation?: string;
  stageId?: string;
  stageRunId?: string;
  scopeKey?: string;
  summaryKey: string;
  summaryParams: Record<string, string | number>;
  fallbackMessage: string;
  technicalDetail?: string;
  retryable: boolean;
  repairActions: CreatorRepairAction[];
  fingerprint: string;
  occurrenceCount: number;
  occurredAt: string;
  lastOccurredAt: string;
  resolvedAt?: string;
};
```

协议守卫允许对象携带未来的附加字段，但必须拒绝未知枚举值、未知 `repairActions.kind`、非注册标识符形状和缺失必填字段。`technicalDetail`、`fallbackMessage`、`summaryParams` 在服务端归一化后才可进入 `creator-job` Issue；客户端上报不能覆盖服务端 code/category/severity/action 决策。

现有公开接口只做以下加法变化：

```ts
export type ApiError = {
  error: {
    code: RuntimeErrorCode;
    message: string;
    details?: Record<string, unknown>;
    issue?: OpenCreatorIssue;
  };
};

export type CreatorJob = {
  // 现有字段保持不变
  issues?: OpenCreatorIssue[]; // 新 Daemon 始终填充；旧快照缺失时新客户端按 [] 读取
};

export type CreatorAgentTurnRequest = {
  // 现有字段保持不变
  focusedIssueId?: string;
};

export type CreatorActionRequest = {
  // 现有字段保持不变
  repairIssueId?: string; // 只用于把注册的 Stage或非 Stage修复操作关联到权威 Issue
  resolutionAttemptId?: string; // 非 Stage retry 与 repairIssueId 同时必填；UUID幂等键，首次由真实 endpoint 持久化
};

export type AgentContextEnvelope = {
  // 现有字段保持不变
  focusedIssue: OpenCreatorIssue | null;
  issues: OpenCreatorIssue[]; // 全部开放问题，最多 5 个最近解决问题；不含原始供应商响应
};

export type CreatorIssueStatsResponse = {
  jobId: string;
  from?: string;
  to?: string;
  rows: Array<{
    code: string;
    source: IssueSource;
    status: 'open' | 'resolving' | 'resolved';
    retryResult: 'none' | 'succeeded' | 'failed' | 'canceled' | 'timeout' | 'interrupted' | 'unknown';
    count: number;
  }>;
};
```

`creatorEventKinds` 增加 `issue_changed`。新增分页响应 `CreatorIssueListResponse { issues, events, nextCursor }` 和受限 `CreatorClientIssueReportRequest`；后者只接受 `clientIssueId/code/source/operation/stageId/scopeKey/fallbackMessage`，限制长度并由 Daemon 重新分类、脱敏、生成诊断号、指纹和动作。Creator 错误若已经在 Daemon 持久化，API 响应的 `error.issue.id`、快照和 SSE 必须是同一 ID。

`creator_issues` 每个 `(job_id, fingerprint)` 只保存一个逻辑问题；`creator_issue_events` 追加 `occurrence | resolving | resolved | reopened | attempt_succeeded | attempt_failed | attempt_canceled | attempt_timeout | attempt_interrupted | attempt_unknown`。Issue 行同时保存当前 `resolution_attempt_id`、关联类型/ID和最近一次 `last_retry_result`，以便启动恢复与白名单统计。并发命中使用 SQLite 事务和唯一索引原子增加 `occurrence_count`，不能先查后写制造重复 ID。

状态转换固定为：首次失败创建 `open/1`；开放中重复保持 ID并 `+1`；修复开始进入 `resolving` 且次数不变；修复失败或 resolving 中同指纹再发回 `open/+1`；成功且业务输出通过才 `resolved`；取消/超时/interrupted 回 `open` 且不因取消本身增加 occurrence；远端接收未知回 `open` 并移除可能重复付费的 retry action；resolved 后复发复用 ID、`+1`、清除 `resolvedAt` 并写 `reopened`。

修复闭环只有以下权威关联方式；`CreatorIssueService.beginResolutionAttempt/finishResolutionAttempt` 是唯一状态入口，业务边界必须在自己的持久化事务中调用它，Panel/Session 不得根据 Promise 成败直接写 Issue 状态：

| Issue 来源 | 允许的修复关联身份 | `resolving` 写入点 | 终态写入点 | 可发布 retry action |
| --- | --- | --- | --- | --- |
| `stage` / `output-validator` | 新 `StageRun.id` | `run-stage/retry-stage` 成功创建新 Run 的 transaction | Stage Runner 在候选输出通过全部 validator 并提交结果时写 `resolved/succeeded`；Run 失败、取消、超时或中断时写对应 attempt 终态并回 `open` | 是，`creator.retry-stage` |
| `provider` | `ProviderRequest.id` | Provider Request 持久化为 queued/running 的 transaction | Provider Request 确认 succeeded/failed/canceled/timeout；无法确认远端接收时写 `unknown`、回 `open` 并移除付费 retry | 仅存在受控 Provider Runtime Action 且可证明幂等时；否则否 |
| `preflight` | 受控 `run-stage`/Runtime Action 生成的 `StageRun.id` 或 `CommandReceipt.id` | Runtime Action 接受并持久化关联身份的 transaction | 对应 Stage Run/Command Receipt 终态；不得由前端收到 2xx 直接解决 | 是，仅注册的受控 Runtime Action |
| 可重试 `api` / `upload` | `resolutionAttemptId` + endpoint 自身请求/上传记录 ID | 真实 endpoint 校验 `repairIssueId` 归属并接受本次尝试后 | 同一 endpoint 在业务成功、失败、取消、超时分别调用 finish；进程中断由启动对账写 `interrupted` | 是，仅 operation 注册表内的真实 endpoint |
| `agent` / `client` 及其他无法由 Daemon 验证结果的来源 | 无 | 不进入 `resolving` | 无自动闭环；后续可验证的成功业务操作可按其自身关联身份解决 | 否；只允许设置、重新选择输入或聚焦 Agent |

非 Stage endpoint 重试请求只允许携带受限的 `repairIssueId` 和 `resolutionAttemptId`；后者是 Runtime Client 为一次用户动作生成的 UUID 幂等键，真实 endpoint 首次接受时原子持久化，重复提交只能复用同一 attempt。endpoint 必须校验二者、Job、operation 和当前状态一致，不能接受客户端自定义关联类型。以 upload 为公开边界基准：上传路由在接收并落库上传记录时 begin，保存有效 Artifact 后 success，解析/传输失败时 failure，用户中止时 cancel，期限届满时 timeout，Daemon 重启发现未终结记录时 interrupted；每种终态都发布同一 Issue 的 `issue_changed`。

快照投影只包含固定字段、全部当前开放 Issue 和最近 5 个已解决 Issue；每个文本字段与参数数量有硬上限。完整历史只从分页接口读取。Panel 时间线仍使用当前有限窗口，Agent Context 不读取完整事件历史。若长期任务出现开放问题数量异常增长，必须先证明指纹/归并规则失效并修复，不能用静默丢弃开放 Issue 规避 NFR-3。

NFR-5 的唯一统计公开边界为 `CreatorRepository.aggregateIssueStats(jobId, { from, to })` 与 `GET /creator/jobs/:id/issues/stats?from=&to=`，返回上述 `CreatorIssueStatsResponse`。统计单元是逻辑 Issue：按 `last_occurred_at` 落入 `[from,to)` 的 Issue 行过滤，`retryResult` 取最近一次 attempt 终态、从未尝试为 `none`，`count=COUNT(issue_id)`；occurrence总量不在该接口内混算。时间参数只接受 UTC ISO-8601，缺省为最近24小时，最大31天。Repository 只能按 `code/source/status/last_retry_result` 聚合计数；API 校验 Job 归属与时间范围，不返回 summary、fallback、technicalDetail、路径、事件 payload 或任意自由文本。该接口不是通用日志查询，也不得从客户端缓存推导。

### 输出验证契约

`apps/daemon/src/creator/templates/types.ts` 增加内部 `CreatorStageOutputValidator`：输入为权威 `job/stage/stageRun/inputArtifacts/candidateOutputs`，输出 `CreatorOutputValidationFinding[]`。Finding 固定包含 `code`、`blocking`、`recoveryDisposition: 'user-action' | 'terminal'`、白名单 `evidence`、`fallbackMessage` 和 `repairActions`。结构验证器始终运行，模板验证器由 `CreatorTemplateStage.outputValidators` 注册；非阻塞 Finding 不创建错误 Issue。

视频翻译语言验证读取候选 `target_subtitle` 与来源 `source_subtitle`，先使用现有 SRT parser 去除时间码/序号，再去除 HTML/ASS 标记、URL、数字和纯符号。源目标标准化语言相同直接跳过；少于 3 个有效 cue 或少于 40 个有效字母/汉字只做结构校验。目标中文时，只有“汉字占比低于 15%、拉丁字母占比高于 70%，且与英文源文本的规范化 3-gram Dice 相似度不低于 0.75”同时成立才阻塞；固定混合语言、专有名词和短样本 Fixture 必须通过。阈值只能通过新增失败 Fixture和方案变更调整，不能为通过测试临时放宽。

阻塞 Finding 必须在一个 Repository 事务中完成：不插入候选 Artifact、不增加 `latestResultVersion`、不追加结果快照；Stage=`failed` 且写入 finding code/message；Dispatch=`finished`；创建或重开 Issue；`user-action` 令 Job=`needs_input` 并让 `needsInput` 引用 issue/stage，`terminal` 令 Job=`failed`。重试必须创建新 Stage Run，原 Stage 保持失败；新 Run 开始时同一 Issue=`resolving`，通过所有验证后才提交 Artifact/快照并解决同一 Issue。

## 基线与文件地图

### 生成基线

- Git 分支：`optimize-functions`
- Git commit：`92d45879c05b74d66c9299b64d56b4310a56b809`
- 生成 Plan 前 `git status --short` 无输出；后续出现的无关变化不得回退，只记录偏差。
- 项目根目录：`D:\develop\github\open-creator`
- 方案：`docs/specs/OpenCreator统一错误与Agent诊断方案-2026-09-22.md`
- 项目规则：`AGENTS.md`；本次已批准方案的 AC-7 和用户本轮给出的门禁明确要求实际打包 App E2E 与内嵌 Web 哈希校验，不得按纯 Web 快速路径降级。

### 权威代码入口

- 协议：`packages/protocol/src/errors.ts` 的 `ApiError`，`packages/protocol/src/creator.ts` 的 `CreatorJob`、`AgentContextEnvelope`、`CreatorAgentTurnRequest`、`CreatorActionRequest`、`creatorEventKinds`，`packages/protocol/src/index.ts`。
- API 错误链：`apps/daemon/src/api/errors.ts` 的 `apiError`；`apps/web/src/runtime/client.ts` 的 `RuntimeClient.rawRequest/readSuccessfulJson/parseApiError`；`apps/web/src/runtime/errors.ts` 的 `ApiClientError`。
- Creator 存储：`apps/daemon/src/storage/migrations.ts`；`apps/daemon/src/creator/repository.ts` 的 `CreatorRepository/createCreatorRepository/hydrateJob/recoverInterruptedStageRuns`。
- 运行与恢复：`apps/daemon/src/creator/stage-runner.ts` 的 `createCreatorStageRunner.execute`；`stage-scheduler.ts` 的 `finishStageRunDispatch`；`command-dispatcher.ts`；`provider-requests.ts`；`apps/daemon/src/api/server.ts` 的 Creator 装配与启动恢复。
- API/SSE：`apps/daemon/src/api/routes.creator.ts` 的 Creator 路由、`sendCreatorError/persistentCreatorEvents/snapshotEvent`；`apps/daemon/src/creator/events.ts`。
- Agent：`apps/daemon/src/creator/agent/agent-service.ts` 的 `runTurn`；`context-builder.ts` 的 `build`；`codex-adapter.ts` 的 Prompt 投影；`apps/daemon/runtime/opencreator-runtime/SKILL.md`。
- 模板验证：`apps/daemon/src/creator/templates/types.ts`、`video-translation.ts`；`apps/daemon/src/creator/executor.ts`；`apps/daemon/src/creator/krillin/adapter.ts` 的 `validateResultArtifacts`；`apps/daemon/src/creator/validators/srt.ts`。
- Web Creator：`apps/web/src/services/creator-service.ts`；`apps/web/src/features/dashboard/creator-session-store.tsx`；`CreatorCollaborationPanel.tsx`；`dashboard.css`；各 Creator Workspace。
- 页面操作迁移入口：`app/AppController.tsx`、`app/use-runtime-dependencies.ts`，`components/tts/TtsVoicePicker.tsx`，`features/connections/ConnectionsPage.tsx`，`conversation/MemorySuggestion.tsx`、`conversation/CreatorDashboard.tsx`，`dashboard/DashboardPage.tsx`，`files/FileWorkspaceView.tsx`，`projects/ProjectsPage.tsx`，`schedules/SchedulesView.tsx`、`schedules/ScheduleThreadHeader.tsx`，`search/SearchView.tsx`，`tasks/TaskCenter.tsx`，`runs/RunDetailPanel.tsx`、`runs/Composer.tsx`，以及 `settings/CleanupSettingsView.tsx`、`CodexRuntimeSettingsView.tsx`、`CreatorServicesSettingsView.tsx`、`McpSettingsView.tsx`、`MemorySettingsView.tsx`、`OpenCreatorSettingsView.tsx`、`ProfileSettingsView.tsx`、`RuntimeComponentsSettingsView.tsx`。Creator Job 创建/恢复尚未获得 Job ID 的失败属于 `page` Scope，固定 `surface='creator-launch'`；只有拿到权威 Job ID 后才转入 Creator 持久化链路。
- Desktop 门禁：`apps/web/e2e/web-desktop-parity.spec.ts`、`apps/desktop/e2e/creator-packaged-app.spec.ts`、`apps/desktop/scripts/package-release.mjs`、`verify-package.mjs`。

### 公共命令

以下命令均从仓库根目录执行；TASK 只引用命令编号，不重复命令正文：

| 命令 | 用途 | 命令行与成功条件 |
| --- | --- | --- |
| C1 | 协议定向测试 | `pnpm --filter @opencreator/protocol test -- test/creator-contract.test.ts`，退出码 0 |
| C2 | Runtime Client 定向测试 | `pnpm --filter @opencreator/web test -- src/runtime/client.test.ts src/features/issues`，退出码 0 |
| C3 | Creator 存储/生命周期/并发统计 | `pnpm --filter @opencreator/daemon test -- test/unit/creator-storage.test.ts test/unit/creator-issues.test.ts`，退出码 0；其中真实双连接竞争测试和统计脱敏断言不得 skip |
| C4 | Creator API/SSE | `pnpm --filter @opencreator/daemon test -- test/integration/creator-api.test.ts`，退出码 0 |
| C5 | Agent 诊断 | `pnpm --filter @opencreator/daemon test -- test/unit/creator-agent-context.test.ts test/unit/creator-agent-service.test.ts test/unit/creator-codex-adapter.test.ts`，退出码 0 |
| C6 | 输出验证/翻译 | `pnpm --filter @opencreator/daemon test -- test/unit/creator-output-validation.test.ts test/unit/creator-video-translation-workflow.test.ts test/unit/creator-stage-scheduler.test.ts`，退出码 0 |
| C7 | 共享 Panel/Session | `pnpm --filter @opencreator/web test -- src/features/dashboard/creator-session-store.test.tsx src/features/dashboard/CreatorCollaborationPanel.test.tsx src/features/dashboard/VideoTranslationAgentPanel.test.tsx`，退出码 0 |
| C8 | 包类型检查 | 分别执行 `pnpm --filter @opencreator/protocol typecheck`、`pnpm --filter @opencreator/daemon typecheck`、`pnpm --filter @opencreator/web typecheck`，三条均退出码 0 |
| C9 | 当前 Web 构建 | `pnpm --filter @opencreator/web build`，退出码 0，产生本次 `apps/web/dist` |
| C10 | Browser/Desktop 同视口一致性 | `pnpm exec playwright test apps/web/e2e/web-desktop-parity.spec.ts --project=chromium-desktop --workers=1`，退出码 0 |
| C11 | 实际 Desktop 包与哈希门禁 | `pnpm desktop:package`，退出码 0；该脚本重新准备 Daemon/Web、生成构建清单并调用 `verify-package.mjs` 比较 `apps/web/dist` 与 App 内资源 |
| C12 | 实际打包 App E2E | `pnpm --filter @opencreator/desktop e2e:package -- creator-packaged-app.spec.ts`，退出码 0 |
| C13 | Web/Daemon 开发服务 | 先用 `Get-NetTCPConnection -LocalPort 19861` 和进程命令确认目标；只停止当前 OpenCreator Vite/受管 Daemon，再运行 `pnpm web:dev`；`http://127.0.0.1:19861/` 与 `http://127.0.0.1:19861/.opencreator/runtime/healthz` 返回成功 |

页面迁移测试使用 TASK-8 枚举的现有 `*.test.tsx`，按文件传给 `pnpm --filter @opencreator/web test -- <paths>`；不得用开放式 `rg`、全量 Web 测试或目标单元测试的二次运行代替迁移表逐行验收和功能验收。

## 追踪矩阵

| 实施任务 | 需求/规则 | 关键决策 | 自动化测试 | 功能验收 |
| --- | --- | --- | --- | --- |
| TASK-1 错误信封跨边界 | FR-1、FR-7、BR-2、BR-3、NFR-1、NFR-4、NFR-5 | DEC-1、DEC-7 | C1、C2 | AC-1、AC-6、AC-7 |
| TASK-2 Page Issue State/Presenter | FR-1、FR-7、BR-1、BR-2、BR-3 | DEC-1、DEC-5 | C2 + Presenter 测试 | AC-1 |
| TASK-3 Creator 生命周期存储 | FR-6、BR-3、BR-4、BR-7、BR-8、NFR-1、NFR-3、NFR-4、NFR-5 | DEC-3、DEC-7 | C3 | AC-2、AC-4、AC-6、AC-7 |
| TASK-4 Creator API/SSE 统一采集 | FR-2、FR-6、BR-2、BR-3、BR-4、BR-7、BR-8、NFR-5 | DEC-1、DEC-2、DEC-3、DEC-7 | C3、C4 | AC-2、AC-4、AC-6、AC-7 |
| TASK-5 共享 Panel 与受控动作 | FR-2、FR-4、BR-3、BR-4、BR-6、BR-7、NFR-2、NFR-3 | DEC-2、DEC-3、DEC-5 | C7 | AC-2、AC-4、AC-7 |
| TASK-6 Agent 聚焦诊断 | FR-3、FR-4、BR-5、BR-6、NFR-1、NFR-3 | DEC-4、DEC-5 | C5、C7 | AC-3、AC-4、AC-6 |
| TASK-7 输出与翻译语义校验 | FR-5、BR-4、BR-7、NFR-1 | DEC-3、DEC-6 | C3、C4、C6 | AC-5、AC-6 |
| TASK-8 非 Creator 页面迁移 | FR-1、FR-7、BR-1、BR-2、BR-3、NFR-2 | DEC-1、DEC-5 | 页面定向测试、C8 | AC-1、AC-7 |
| TASK-9 Creator 客户端失败迁移 | FR-2、FR-4、BR-1、BR-2、BR-3、BR-4、BR-7、NFR-1、NFR-2 | DEC-2、DEC-3、DEC-5 | Workspace 定向测试、C7、C8 | AC-2、AC-4、AC-6、AC-7 |
| TASK-10 兼容迁移、恢复与发布 | FR-6、FR-7、BR-8、NFR-2、NFR-4、NFR-5 | DEC-3、DEC-7 | C1 至 C12、C13 健康检查 | AC-6、AC-7 |
| TASK-11 完整功能验收 | FR-1 至 FR-7、BR-1 至 BR-8、NFR-1 至 NFR-5 | DEC-1 至 DEC-7 | 最后修改后的全部相关命令 | AC-1 至 AC-7 |

## 执行任务

### TASK-0：确认 Plan 仍然有效

核对当前分支、commit、工作区变化、方案批准记录、上述文件/符号、包脚本和 AC-7 门禁。重点确认：`ApiError` 仍是唯一错误信封；Creator 仍使用同一 SQLite Repository、SSE、Session Store 和 `CreatorCollaborationPanel`；Stage Runner 仍在 Artifact/快照提交前拥有候选输出；Desktop 打包脚本仍生成 Web 哈希清单。

无关变化或不改变契约的路径/局部命名变化：记录偏差并更新实际路径后继续。若 `DEC-N`、职责、公开接口、数据状态、唯一 Panel 约束或 AC 已失效，停止执行并更新方案/Plan；不得边写代码边静默重设计。

### TASK-1：让同一个结构化 Issue 穿过 API 与 Runtime Client `[FR-1, FR-7, BR-2, BR-3, NFR-1, NFR-4, NFR-5, DEC-1, DEC-7, AC-1, AC-6, AC-7]`

**交付结果**

- 新旧 API 错误、非 JSON、成功响应中的错误信封、网络拒绝和非用户超时都成为合法 `ApiClientError.issue`；用户主动 Abort 仍是取消，不生成 Issue。
- Daemon 可在唯一 `ApiError.error.issue?` 位置携带已归一化 Issue，旧响应保持合法。

**文件与符号**

- 创建：`packages/protocol/src/issues.ts` - 上述公开联合类型、分页/上报/`CreatorIssueStatsResponse` 类型、`isOpenCreatorIssue`。
- 修改：`packages/protocol/src/errors.ts` - `ApiError.error.issue?`；`creator.ts` - Creator 增量字段与 `issue_changed`；`index.ts` - 公开导出。
- 修改：`apps/daemon/src/api/errors.ts` - `apiError(code, message, details?, issue?)`，只接受已经归一化的 Issue。
- 修改：`apps/web/src/runtime/errors.ts` - `ApiClientError` 增加只读 `issue?: OpenCreatorIssue` 和取消识别，不改变现有 `status/code/details`。
- 修改：`apps/web/src/runtime/client.ts`、`runtime/types.ts` - 解析守卫、本地 page Issue 归一化、fetch/JSON/timeout/Abort 分流。
- 测试：`packages/protocol/test/creator-contract.test.ts`、`apps/web/src/runtime/client.test.ts`。

该行为必须跨 7 个文件才能证明线协议在服务端和真实 Client 之间只存在一个权威入口；按技术层拆开会产生短暂第二套信封，因此作为一个不可拆行为切片。

**实施步骤**

1. 先增加公开守卫测试，再定义 Issue 联合类型；守卫容忍附加字段但拒绝未知联合分支，避免旧/新组合失效或执行未知动作。
2. 扩展 `ApiError`、Creator 请求/快照/Event 类型；保持所有新增字段可选或加法，除 `CreatorJob.issues` 由服务端 hydration 统一补空数组。
3. `apiError` 只负责把调用方给出的安全 Issue 放入信封，不在通用 API 层读取 Creator Repository。
4. 把 Runtime Client 的错误读取统一为一个 async 归一化边界：合法 `error.issue` 原样保留；旧错误、顶层 Fastify 错误、非 JSON、成功响应中的错误、JSON 解析失败、fetch 拒绝生成本地 `page` Issue；`AbortError` 且调用方 signal 已由用户取消时原样抛出取消，`TimeoutError`/非用户中断归类 network。
5. 本地 Issue 的 `id/diagnosticId/fingerprint` 不包含响应正文；fallback 先走固定 catalog key，不能把 HTML、堆栈或请求头直接展示。

**TDD**

- 策略：必须。
- RED：`creator contract accepts ApiError.error.issue and rejects unknown repair action kinds`，通过 namespace import 加载协议，构造完整合法 Issue、额外字段、`CreatorIssueStatsResponse`、合法/非法 `resolutionAttemptId` 和 `kind:'shell-command'`；当前没有导出/字段，业务断言失败。
- RED：`RuntimeClient preserves server issue and normalizes legacy network and parse failures without turning user abort into an issue`；依次返回新信封、旧信封、HTML 500、非法 JSON 200、fetch `TypeError`、用户 `AbortError` 和 `TimeoutError`，断言 issue 身份/Scope/分类/取消分流；当前 Client 不保留 Issue且网络/解析异常裸抛。
- GREEN：实现最小协议、守卫和 Client 归一化，运行 C1、C2；现有 authorization、binary upload、Fastify details 测试继续通过。
- REFACTOR：只合并错误读取和本地 ID/诊断号辅助函数，不建立第二个错误模型；重跑 C1、C2。

**任务完成门**

- C1、C2 通过；旧载荷和现有 Client API 无破坏性变化；AC-1/AC-6 的协议边界具备自动化证据。

### TASK-2：建立页面会话级 Issue State 与共享 Presenter `[FR-1, FR-7, BR-1, BR-2, BR-3, DEC-1, DEC-5, AC-1]`

**交付结果**

- 普通页面可按 `surface + operationId` 保存最近开放问题，并在成功、关闭或页面卸载时清理；字段校验仍由原字段组件展示。
- 共享 Presenter 固定显示本地化标题/说明、诊断编号和已注册动作；找不到动作处理器时不显示无效按钮。

**文件与符号**

- 创建：`apps/web/src/features/issues/issue-catalog.ts` - `presentIssue(issue, language)`，只按 `summaryKey/summaryParams` 与安全 fallback 生成文案。
- 创建：`apps/web/src/features/issues/page-issue-state.ts` - `usePageIssueState(surface)`、`captureOperationFailure`、`resolveOperation`、`dismissIssue`。
- 创建：`apps/web/src/features/issues/IssuePresenter.tsx`、`issue-presenter.css` - `IssuePresenter`、`IssueActionRegistry`。
- 测试：`apps/web/src/features/issues/page-issue-state.test.tsx`、`IssuePresenter.test.tsx`。

**实施步骤**

1. `usePageIssueState` 只接收 `ApiClientError.issue` 或由 TASK-1 Normalizer 产生的同型对象；调用方传入稳定 operationId，不保存原始异常。
2. success/dismiss 删除对应项；组件卸载自然释放 state，不写 localStorage/IndexedDB/Daemon。
3. Presenter 用 `role="alert"` 宣告新开放 Issue，用普通状态语义展示 resolving/resolved；按钮只从 `retryOperations/settingsRoutes/inputFields/onFocusAgent` 注册表解析。
4. `requiresConfirmation` 或 `risk !== 'normal'` 不由 Presenter 自动执行；普通页面未知动作只保留诊断号，不伪造成功。

**TDD**

- 策略：必须。
- RED：`page issue remains visible until success dismiss or unmount and field validation never enters the store`；触发已发出请求失败、普通字段错误、成功重试、关闭和重挂载，当前无共享 state 时失败。
- RED：`IssuePresenter hides unregistered actions and localizes a known issue without exposing technicalDetail`；提供 retry/open-settings/select-input/focus-agent 与缺失 handler，当前无 Presenter 时失败。
- GREEN：实现 hook/catalog/Presenter，运行 C2；断言诊断编号可复制/选择，technicalDetail 不直接渲染。
- REFACTOR：仅抽取纯 presenter model，避免 UI 状态进入协议；重跑目标测试。

**任务完成门**

- 新测试和 C2 通过；Page Issue 无跨刷新持久化、无 Agent UI、无无效动作，覆盖 AC-1 共享展示基础。

### TASK-3：持久化 Creator Issue、生命周期事件和启动恢复 `[FR-6, BR-3, BR-4, BR-7, BR-8, NFR-1, NFR-3, NFR-4, NFR-5, DEC-3, DEC-7, AC-2, AC-4, AC-6, AC-7]`

**交付结果**

- 同 Job 同指纹的逻辑问题在首次、重复、解决和复发中保持一个 ID；Daemon 重启可把无法证明仍活跃的 `resolving` 原子恢复为 `open`。
- Job hydration 包含有界 Issue 投影，完整历史分页读取；旧数据库只新增表/索引。
- Repository 提供只含白名单维度的权威统计聚合；同一指纹的并发创建由数据库原子 UPSERT 保证单行、同 ID、次数与事件不丢失。

**文件与符号**

- 修改：`apps/daemon/src/storage/migrations.ts` - `creator_issues`、`creator_issue_events`、唯一/分页/状态索引。
- 创建：`apps/daemon/src/creator/issues.ts` - `normalizeCreatorIssue`、`creatorIssueFingerprint`、`sanitizeIssueDetail`、状态转换输入类型和投影上限。
- 修改：`apps/daemon/src/creator/repository.ts` - `CreatorRepository` 的 create-or-occurrence、begin/finish attempt、resolve/reopen、list/paginate/reconcile、`aggregateIssueStats` 方法与 `hydrateJob.issues`；暴露仅供测试/Worker 复用的内部 `CREATOR_ISSUE_UPSERT_SQL`，生产 Repository 与竞争测试必须执行同一 SQL。
- 测试：`apps/daemon/test/unit/creator-issues.test.ts`、`creator-storage.test.ts`。

**实施步骤**

1. Migration 只 `CREATE TABLE/INDEX IF NOT EXISTS`；`creator_issues` 包含受约束的 `last_retry_result`，对 `(job_id,fingerprint)` 建唯一索引，并为 `(job_id,last_occurred_at)` 统计范围建索引；事件按 `(issue_id,created_at,id)` 分页。JSON 列 hydration 失败沿用 `CreatorRepositoryDataError`，不静默吞损坏数据。
2. Normalizer 用稳定 Scope/Source/Code/Operation/StageId/ScopeKey 生成 SHA-256 指纹，不含动态 message；诊断号从 Issue ID 的随机部分派生，用户可引用但不可反推出内容。
3. 脱敏移除 credential/header/stack/home path/provider body；fallback、technicalDetail、summary param、action count 和单字段长度设硬上限。`aggregateIssueStats` 只选择/分组 `code/source/status/retry_result` 与 `COUNT(*)`，不先 hydrate 完整 Issue，也不接受客户端指定 group-by 字段。
4. Repository 在单个 SQLite transaction 内用 `INSERT ... ON CONFLICT(job_id,fingerprint) DO UPDATE ... RETURNING id` 原子 upsert occurrence，再 append 与返回 ID 对应的 event；不得先 SELECT 再决定 INSERT/UPDATE。resolved 命中走 `reopened`，resolving 命中失败走 attempt terminal + occurrence。
5. `beginResolutionAttempt` 必须写 attempt ID、association kind/id；只有能查询到 queued/running 的 Stage/Receipt/Provider Request 才保持 resolving。启动时在 Stage interrupted/Job needs_input 恢复之后调用 `reconcileResolvingIssues`，缺失、失败、取消、超时、interrupted 或 unknown 的关联回 open，已成功且验证通过才 resolved。
6. `hydrateJob` 投影全部开放和最近 5 个已解决；完整事件不进入 Job、Panel快照或 Agent Prompt。
7. 并发测试用同一临时 SQLite 文件、WAL/busy timeout、两个独立 `better-sqlite3` 连接和 Worker Threads；主线程屏障令所有 Worker 在读取参数后同时执行同一 UPSERT+事件事务，不能用单连接嵌套 transaction、串行 Promise 或 mock 证明并发。

**TDD**

- 策略：必须。
- RED：`creator issue upsert is atomic under competing sqlite connections`；固定 Job/指纹并启动至少两个 Worker/独立连接，用同步屏障竞争同一创建路径；断言所有请求成功、数据库只有一行、所有返回 ID相同、`occurrenceCount` 等于请求数且 occurrence/reopened事件无丢失；当前表、共享 UPSERT 和方法不存在，连续或嵌套 transaction 不能替代该 RED。
- RED：`daemon reopen reconciles resolving attempts against stage receipt and provider terminal states`；重开临时 SQLite，准备 running、interrupted、succeeded、unknown_remote_acceptance 关联，断言 open/resolved 与 attempt 终态；当前仅恢复 Stage。
- RED：`creator issue projections and stats redact secrets and bound resolved history`；写含 API key、Authorization、用户原文、完整 home path、stack、供应商详情的 Issue 和 8 个 resolved Issue，断言 hydration 无敏感串、只含最近 5 个 resolved，`aggregateIssueStats` 每行只有 `code/source/status/retryResult/count`；当前无投影/统计。
- GREEN：完成 Migration/Repository/Normalizer，运行 C3；现有 legacy job、snapshot repair、interrupted stage 恢复测试继续通过。
- REFACTOR：只在保持事务边界的前提下抽取 row hydration/event append；重跑 C3。

**任务完成门**

- C3 通过且真实双连接竞争用例未 skip；数据库升级前后可读、一个指纹一个 ID、并发次数/事件完整、统计只含白名单、恢复无永久 resolving、无破坏性逆迁移；覆盖 AC-2/AC-4/AC-6 的存储基础。

### TASK-4：在 Creator API、失败边界和 SSE 中统一采集 Issue `[FR-2, FR-6, BR-2, BR-3, BR-4, BR-7, BR-8, NFR-5, DEC-1, DEC-2, DEC-3, DEC-7, AC-2, AC-4, AC-6, AC-7]`

**交付结果**

- API、上传、Preflight、Stage、Provider 和 Agent 服务端失败在权威失败事务创建/更新一次，响应、快照与 SSE 使用同一 Issue ID。
- 客户端专属错误可经受限接口报告；旧 Stage 最新未恢复失败可派生兼容 Issue，后续成功不再开放。
- Stats API 从 Repository 权威聚合返回白名单维度；非 Stage retry 由真实 endpoint 写完整 attempt 生命周期，不能由 Panel 猜测解决。

**文件与符号**

- 修改：`apps/daemon/src/creator/issues.ts` - `CreatorIssueService`，负责持久化、API 投影、SSE 回调和兼容派生。
- 修改：`apps/daemon/src/creator/stage-runner.ts` - 所有非取消失败在现有失败 transaction 调用 Issue Service；取消不创建 Issue。
- 修改：`apps/daemon/src/api/routes.creator.ts` - `sendCreatorError` 接收 job/operation context；新增 list/report/stats 路由；upload/retry endpoint 校验 `repairIssueId/resolutionAttemptId` 并写闭环；`persistentCreatorEvents` 重放 Issue 事件。
- 修改：`apps/daemon/src/creator/source-upload.ts`、`reference-image-upload.ts`、`document-upload.ts` - 将真实上传记录/Artifact终态返回路由事务，确保同一 attempt 可区分 success/failure/cancel/timeout；不在 service 内生成第二个 Issue。
- 修改：`apps/daemon/src/creator/provider-requests.ts`、`command-dispatcher.ts`、`preflight.ts` - Provider Request、Command Receipt/Stage Run 与 Issue attempt 的 begin/finish关联及 unknown远端语义。
- 修改：`apps/daemon/src/creator/events.ts` - 稳定 `creatorIssueEventId` 和 `issue_changed` 发布。
- 修改：`apps/daemon/src/api/server.ts` - 装配同一 Issue Service 到 Runner、Agent、路由、启动恢复。
- 测试：`apps/daemon/test/integration/creator-api.test.ts`、`test/unit/creator-issues.test.ts`。

该切片跨 6 个实现文件，因为“响应、快照、SSE 同 ID且只创建一次”必须从真实失败边界贯通到公开 API；把采集和传播拆开会允许客户端二次上报。

**实施步骤**

1. `CreatorIssueService.capture` 明确接收 jobId/source/operation/stage identity和受控 Error；路由只对已发出的失败调用，字段解析失败且尚无 Job Scope 使用普通 API Issue，不写 Creator 表。
2. `sendCreatorError` 若 Error 已带持久化 issueId则读取该 Issue；否则在有 Job context 时 capture 一次。返回 `apiError(..., issue)`，不把 Repository 失败伪装为持久化成功。
3. `POST /creator/jobs/:id/issues/report` 只接受 TASK-1 定义的白名单请求，校验 job 存在、长度/来源/operation 注册项，重新归一化后返回正式 Issue；本地 ID只用于客户端对账，不进入指纹。
4. `GET /creator/jobs/:id/issues?cursor&limit&status` 返回分页 Issue/Event；limit 有上限。`GET /creator/jobs/:id/issues/stats?from=&to=` 校验 Job 归属、时间格式/范围后调用 `aggregateIssueStats`，响应严格匹配 `CreatorIssueStatsResponse`。SSE 的 `issue_changed` 载荷仅含当前安全 Issue 投影，重连从持久事件/快照恢复并按 event ID去重。
5. 按公共契约映射写状态：Stage/output-validator 在新 Run transaction begin、Stage 终态 finish；Provider 在 Request transaction begin/finish；Preflight 经受控 Runtime Action 的 StageRun/Receipt闭环；upload 等注册 endpoint 接受 `repairIssueId/resolutionAttemptId` 后 begin 并在 success/failure/cancel/timeout 写 finish，启动恢复未终结请求为 interrupted。Agent/client 无 Daemon 可验证终态时不发布 retry action。
6. Stage、Provider、Preflight 和 Agent 服务的取消/拒绝路径显式标记 normal termination；只有实际失败 capture。非阻塞 validator finding 不调用 capture。
7. 当 Job 没有持久 Issue 时，从每个 Stage 最新运行中派生确定性兼容 Issue；若同 Stage 有更新的 succeeded Run 则不派生。持久 Issue 优先，避免新旧重复。

**TDD**

- 策略：必须。
- RED：`Creator API returns and streams the same persisted issue for upload preflight stage provider and agent failures`；逐类触发后比较响应 `error.issue.id`、GET job、SSE `issue_changed`，当前 API无 Issue。
- RED：`client issue report replaces a temporary id after server validation and rejects forged actions or foreign jobs`；提交白名单与伪造 paid action/错误 job，断言正式 ID、403/400和脱敏；当前路由不存在。
- RED：`upload retry drives the same issue through resolving to resolved or open`；从公开 upload endpoint 创建失败 Issue，再用受控 `repairIssueId/resolutionAttemptId` 分别完成成功、失败、取消、超时和重启中断；断言 `open -> resolving -> resolved/open`、始终复用同一 Issue ID、事件/occurrence符合契约且 Session 未直接写状态；当前 endpoint 无闭环字段。
- RED：`issue stats API exposes only whitelisted aggregate dimensions`；数据库写入含用户原文、路径、API key、Authorization和供应商详情的多种 Issue，经真实 GET stats 读取并枚举每个 key，断言只有 `jobId/from/to/rows` 与 row 白名单字段且计数正确；当前接口不存在。
- RED：`legacy latest stage failure derives once and disappears after a newer success`；准备仅旧 Stage 字段的 job，读取两次与追加成功 run，断言稳定兼容 ID和关闭规则；当前无兼容投影。
- GREEN：贯通 Issue Service/API/SSE，运行 C3、C4；现有 Creator SSE cursor、上传、Preflight、Agent timeline 回归通过。
- REFACTOR：保持服务端单点创建，删除任何“收到带 ID响应后再 report”的客户端要求；重跑 C3、C4。

**任务完成门**

- C3、C4 通过；同一失败在 API/快照/SSE 只有一个 ID，upload 非 Stage retry 完成全部终态且复用该 ID，统计 API 只有白名单字段，取消/非阻塞建议无红色卡，SSE 重连不重复；覆盖 AC-2/AC-4/AC-6/AC-7 服务边界。

### TASK-5：在唯一共享 Panel 展示 Issue 并执行受控修复 `[FR-2, FR-4, BR-3, BR-4, BR-6, BR-7, NFR-2, NFR-3, DEC-2, DEC-3, DEC-5, AC-2, AC-4, AC-7]`

**交付结果**

- `CreatorCollaborationPanel` 时间线新增独立系统 Issue 卡，与 Stage/Activity/Message 关联但不重复错误全文；所有 Creator 模板自动复用。
- 支持已注册的重试、设置、选输入和聚焦 Agent；重试进入 resolving 并以新 Stage Run/Receipt 终结，危险或未知远端状态不会重复执行。

**文件与符号**

- 修改：`apps/web/src/services/creator-service.ts` - issue list/report、SSE 解析、`repairIssueId` 透传。
- 修改：`apps/web/src/features/dashboard/creator-session-store.tsx` - issues/local temporary queue、ID 对账、`repairIssue`、`focusIssue` 和 reconnect 补报。
- 修改：`apps/web/src/features/dashboard/CreatorCollaborationPanel.tsx` - `CollaborationTimelineItem` 增加 `issue`、`CollaborationIssueView`、排序/去重/Stage关联。
- 修改：`apps/web/src/features/dashboard/dashboard.css` - Issue 卡、状态、动作和聚焦标签；不新建模板 Panel。
- 测试：`creator-session-store.test.tsx`、`CreatorCollaborationPanel.test.tsx`、`VideoTranslationAgentPanel.test.tsx`。

**实施步骤**

1. Session 以 `job.issues` 为权威；`issue_changed` 按 ID替换，SSE 断线用快照恢复。纯客户端失败先插入 `local:<uuid>`，Daemon 不可用时显示“Agent 暂不可诊断”；恢复后 report 并用正式 ID原位替换。
2. 时间线排序使用 `lastOccurredAt/occurredAt`，同 ID只一项；Stage 卡通过 `stageRunId` 关联后仅保留状态/进度，完整错误在 Issue 卡。Activity 列表不注入 Issue。
3. `IssueActionRegistry` 在 Session 内只注册真实能力：`creator.retry-stage` 映射现有 `applyAction({action:'run-stage', repairIssueId})`；upload/API retry 调用注册表内的真实 endpoint，并为一次用户动作生成受限 UUID `resolutionAttemptId`、在重复提交时复用；设置路由和输入 focus 由 Workspace 提供 capability；未注册动作不显示。`agent/client` 等无法由 Daemon验证闭环的来源不得注册 retry。
4. 点击 retry 用现有 idempotency/command dispatcher，只允许一次在途调用；normal 可直接执行，paid/overwrite 必须显示确认且 Agent 发起仍走审批。关联 Provider Request 为 `unknown_remote_acceptance` 时隐藏 retry，只保留对账/Agent 入口。
5. Session 只能显示 Daemon通过快照/SSE返回的 `resolving/resolved/open`，不得在点击、HTTP 2xx或 Promise reject时本地写权威状态。open-settings/select-input/focus-agent 只是导航/聚焦，不伪造 resolved；真实 Stage/Provider/Preflight/upload endpoint 按契约 begin/finish 后由 Daemon事件更新 Issue。

**TDD**

- 策略：必须。
- RED：`shared panel renders one issue item for repeated failures and keeps stage activity and agent messages separate`；同 ID occurrence 3、同 Stage 失败和 Activity/消息并存，断言一张 Issue 卡、次数 3、Stage 不重复全文；当前 timeline union 无 issue。
- RED：`temporary client issue is visible offline and replaced in place after reconnect report`；report 首次网络失败、恢复成功，断言 ID对账且无双卡；当前 Session 只存瞬时 `error`。
- RED：`retry action enters resolving once and paid or unknown-remote actions cannot bypass confirmation`；点击 normal 两次、paid、unknown，断言一次 Runtime Action、状态变化和无危险重试；当前无动作注册。
- RED：`panel never resolves an issue from a retry promise before the daemon terminal event`；令 upload retry HTTP 先返回、`issue_changed` 后到达并覆盖 success/failure，断言 Panel 在权威事件前不改变状态且始终显示同一 ID；当前无权威状态链。
- GREEN：完成 Service/Session/Panel/样式，运行 C7；所有现有 Adapter/Stage/Activity过滤测试继续通过。
- REFACTOR：Issue UI 只能进共享 Panel，Workspace 仅注入局部动作 capability；重跑 C7和 `creator-panel-adapters.test.ts`。

**任务完成门**

- C7 通过；Panel 无重复 Issue、无 Activity 污染、无模板私有 Panel，不发布无法闭环的 retry，也不从客户端 Promise写权威状态；受控动作和状态覆盖 AC-2/AC-4。

### TASK-6：让 Agent 聚焦权威 Issue 并区分事实、推测和下一步 `[FR-3, FR-4, BR-5, BR-6, NFR-1, NFR-3, DEC-4, DEC-5, AC-3, AC-4, AC-6]`

**交付结果**

- 用户从 Issue 卡选择“为什么失败/如何修复”后，Composer 保留可移除的聚焦标签，Turn 请求只携带 `focusedIssueId`；Daemon 校验归属并把安全权威投影放入 Context。
- Agent 指令要求按“已确认事实/可能原因/下一步”回答；Agent 自身失败也生成 Issue，不能生成假回复。

**文件与符号**

- 修改：`apps/web/src/features/dashboard/CreatorCollaborationPanel.tsx`、`creator-session-store.tsx`、`services/creator-service.ts` - focused state、默认可编辑问题、请求字段。
- 修改：`apps/daemon/src/creator/agent/agent-service.ts` - `runTurn` 的 Issue 归属/状态校验、Agent 失败 capture、现有审批保持。
- 修改：`apps/daemon/src/creator/agent/context-builder.ts` - `build(job, selection, focusedIssueId?)` 与有界 safe Issue projection。
- 修改：`apps/daemon/src/creator/agent/codex-adapter.ts`、`apps/daemon/runtime/opencreator-runtime/SKILL.md` - 诊断回答结构、不可信数据边界。
- 测试：`creator-agent-context.test.ts`、`creator-agent-service.test.ts`、`creator-codex-adapter.test.ts`、`VideoTranslationAgentPanel.test.tsx`。

**实施步骤**

1. Panel 选择 Issue 后填入可编辑问题但不伪造 User Message；实际发送才创建 Turn。Agent 正忙时不把新的 focused Issue 静默塞进旧 Turn，保留标签直到可启动新 Turn。
2. Service 在创建 user turn 前读取 `creator.getJob` 并校验 Issue ID属于该 job；不存在、已越权或已从投影淘汰时返回结构化 `creator_issue_not_found/forbidden`，并按规则生成当前 Job Issue，而不调用模型。
3. Context Builder 投影 focused Issue、开放 Issue 和最多 5 个 resolved Issue；`technicalDetail`/fallback/provider text标记为 untrusted data，不进入 instruction 区。路径继续只用 basename。
4. Codex prompt 和内置 Runtime Skill 明确输出三个语义段；“系统确认原因”只来自 code/evidence/关联状态，其他内容归入可能原因。只读分析无需批准；写操作继续由现有 `creator_apply_action`、sandbox 和 approval 实现。
5. runtime unavailable/turn failed 时持久化 Agent Issue 并在 Panel显示恢复入口；不创建替代 Assistant 内容。

**TDD**

- 策略：必须。
- RED：`focusedIssueId selects one of multiple job issues and rejects a foreign issue before runtime invocation`；两个本 Job Issue和一个外部 ID，断言 Context 只聚焦选择项、外部请求不调用 runtime；当前请求无字段。
- RED：`diagnostic prompt treats provider text as untrusted and requires confirmed possible and next-step sections`；包含伪指令/API key的 technical data，断言投影脱敏且 prompt 有三段规则；当前 prompt 无诊断边界。
- RED：`panel keeps focused issue identity while allowing the question to be edited`；选择“为什么失败”、编辑文本、发送，断言 request ID正确且 timeline 不出现伪消息；当前 Panel无聚焦。
- GREEN：完成校验、Context、Prompt 和 Composer，运行 C5、C7；现有 sandbox、approval、steer和 revision conflict 测试继续通过。
- REFACTOR：不把完整 Issue JSON 拼进用户 message；保持 ID引用和权威 Context；重跑 C5、C7。

**任务完成门**

- C5、C7 通过；多 Issue 可精确选择，外部/不存在 ID不进模型，回答结构与审批边界覆盖 AC-3/AC-4/AC-6。

### TASK-7：在提交前验证候选输出并阻止英文回退冒充中文翻译 `[FR-5, BR-4, BR-7, NFR-1, DEC-3, DEC-6, AC-5, AC-6]`

**交付结果**

- 所有 Stage 候选输出先做结构校验，视频翻译 subtitle Stage 额外做确定性语言/源文相似度校验；阻塞 Finding 不产生 Artifact、结果版本或快照。
- `creator_translation_output_language_mismatch` 令 Stage failed、Dispatch finished、Job needs_input、Issue open；合法重试新建 Run并在通过后解决同一 Issue。

**文件与符号**

- 创建：`apps/daemon/src/creator/output-validation.ts` - Finding/validator runner、通用文件/声明校验、`validateTranslationOutputLanguage`。
- 修改：`apps/daemon/src/creator/templates/types.ts` - `CreatorStageOutputValidator` 与 `outputValidators`。
- 修改：`apps/daemon/src/creator/templates/video-translation.ts` - subtitle Stage 注册语言验证器。
- 修改：`apps/daemon/src/creator/stage-runner.ts` - 在 `outputHashes` 和 transaction 插入前运行验证；阻塞 Finding 原子失败；成功后解决关联 Issue。
- 修改：`apps/daemon/src/creator/repository.ts`、`stage-scheduler.ts` - terminal Stage 与 `dispatch_status='finished'` 的幂等原子完成方法。
- 修改：`apps/daemon/src/creator/validators/srt.ts` - 复用 cue 提取，不重复手写 SRT 解析。
- 测试：创建 `apps/daemon/test/unit/creator-output-validation.test.ts`；扩展 `creator-video-translation-workflow.test.ts`、`creator-stage-scheduler.test.ts`、`creator-storage.test.ts`。

该切片超过 5 个实现文件，因为验证顺序、Stage/Dispatch/Job/Artifact/Snapshot/Issue 必须在同一行为和事务中证明，拆成“验证器”和“提交”会允许错误产物短暂成为权威结果。

**实施步骤**

1. 将当前 executor 输出声明检查保留为第一层；通用 validator 检查 completed 文件非空、可读和可解析，模板 validators 按声明顺序返回 Finding。
2. 语言 validator 使用契约快照中的清洗、样本门槛、脚本比例与 3-gram Dice 规则；证据只保留比例/样本数/阈值，不保留字幕原文。
3. Runner 在任何 `setArtifactStatus/insertArtifact/appendCreatorResultSnapshot/update succeeded` 前 await validators。非阻塞 Finding只进入受控质量结果，不创建 Issue。
4. 阻塞时用 Repository transaction 原子 `completeStageRun(failed, finished)`、capture Issue、更新 Job/needsInput；候选文件可留在私有 workdir供诊断，但不能注册为 Artifact。
5. `run-stage/retry-stage` 带 `repairIssueId` 创建新 Run并开始 attempt；新 Run失败重开同一 ID，成功通过 validators 后才在结果提交 transaction 解决。

**TDD**

- 策略：必须。
- RED：`target Chinese validator rejects unchanged English source but accepts Chinese mixed proper-noun and short fixtures`；固定正确中文、英文原文、合理中英混合、OpenAI/YouTube 专名、2 cue短样本和同语言输入；当前无语义 validator。
- RED：`blocking output finding commits failed finished needs_input issue without artifact snapshot or result version`；executor 返回英文 target candidate，断言 Stage/Dispatch/Job/Issue 和数据库 Artifact/state；当前会先插入 Artifact并成功。
- RED：`retry creates a new run and resolves the same issue only after valid output commits`；先失败后中文成功，断言旧 run终态、新 run ID、同 Issue ID resolved、Artifact/快照只增加一次；当前无 Issue关联。
- GREEN：实现 validator与 Runner transaction，运行 C6、C3、C4；现有 Krillin输出路径/媒体校验和 workflow continuation 回归通过。
- REFACTOR：清洗/脚本统计/Dice 为纯函数，阈值集中常量；不得调用外部语言检测服务；重跑 C6。

**任务完成门**

- C3、C4、C6 通过；错误字幕从未成为 completed Artifact/版本/快照，合法边界无误杀，重试解决同一 Issue；完整覆盖 AC-5。

### TASK-8：把非 Creator 的已发出操作失败迁移到共享 Page Issue `[FR-1, FR-7, BR-1, BR-2, BR-3, NFR-2, DEC-1, DEC-5, AC-1, AC-7]`

**交付结果**

- 普通页面不再仅渲染 raw `Error.message` 或临时 Toast；已发出失败统一显示 Issue，成功/关闭/离页清理；字段校验保持原交互且不产生 Issue。
- 非 Creator 页面不出现 Agent、Creator Repository 调用或跨刷新持久化。
- Creator Job 创建/恢复在取得权威 Job ID前使用 `page` Scope `surface='creator-launch'`；取得 ID后清理成功操作对应的 launch Issue，后续失败才进入 Session 的 `creator-job` Scope，临时 launch Issue不得转换/复制到错误 Job或跨刷新保留。

**文件与符号**

迁移清单是封闭验收表；实现时逐行记录 `字段校验保留位置 / 已发出操作 operationId / Presenter 挂载位置 / 成功清理点 / 定向测试结果`，不得只用开放式 `rg` 宣称完成：

| 批次 | 实现文件 | Scope / surface | 最近定向测试 |
| --- | --- | --- | --- |
| App 入口 | `apps/web/src/app/AppController.tsx` | `page:app-controller` | `apps/web/src/app/App.test.tsx` |
| Runtime 依赖 | `apps/web/src/app/use-runtime-dependencies.ts` | 调用页面 surface；无调用上下文时 `page:runtime` | `apps/web/src/app/use-runtime-dependencies.test.tsx` |
| 会话辅助 | `apps/web/src/features/conversation/MemorySuggestion.tsx` | `page:memory-suggestion` | `apps/web/src/features/conversation/MemorySuggestion.test.tsx` |
| Creator 启动 | `apps/web/src/features/conversation/CreatorDashboard.tsx` | Job ID前 `page:creator-launch`，ID后 `creator-job` | `apps/web/src/features/conversation/CreatorDashboard.test.tsx` |
| Creator 启动页 | `apps/web/src/features/dashboard/DashboardPage.tsx` | Job ID前 `page:creator-launch`，ID后交给 Session | `apps/web/src/features/dashboard/DashboardPage.test.tsx` |
| 文件 | `apps/web/src/features/files/FileWorkspaceView.tsx` | `page:files` | `apps/web/src/features/files/FileWorkspaceView.test.tsx` |
| 项目 | `apps/web/src/features/projects/ProjectsPage.tsx` | `page:projects` | `apps/web/src/features/projects/ProjectsPage.test.tsx` |
| 日程列表 | `apps/web/src/features/schedules/SchedulesView.tsx` | `page:schedules` | `apps/web/src/features/schedules/SchedulesView.test.tsx` |
| 日程会话头 | `apps/web/src/features/schedules/ScheduleThreadHeader.tsx` | `page:schedule-thread` | `apps/web/src/features/schedules/ScheduleThreadHeader.test.tsx` |
| 搜索 | `apps/web/src/features/search/SearchView.tsx` | `page:search` | `apps/web/src/features/search/SearchView.test.tsx` |
| 任务 | `apps/web/src/features/tasks/TaskCenter.tsx` | `page:tasks` | `apps/web/src/features/tasks/TaskCenter.test.tsx` |
| 连接 | `apps/web/src/features/connections/ConnectionsPage.tsx` | `page:connections` | `apps/web/src/features/connections/ConnectionsPage.test.tsx` |
| Run 详情 | `apps/web/src/features/runs/RunDetailPanel.tsx` | `page:run-detail` | `apps/web/src/features/runs/RunDetailPanel.test.tsx` |
| Composer | `apps/web/src/features/runs/Composer.tsx` | `page:composer` | `apps/web/src/features/runs/Composer.test.tsx` |
| TTS 音色 | `apps/web/src/components/tts/TtsVoicePicker.tsx` | 调用页面 surface + `tts-voice` operation | `apps/web/src/components/tts/TtsVoicePicker.test.tsx` |
| 设置 | `apps/web/src/features/settings/CleanupSettingsView.tsx`、`CodexRuntimeSettingsView.tsx`、`CreatorServicesSettingsView.tsx`、`McpSettingsView.tsx`、`MemorySettingsView.tsx`、`OpenCreatorSettingsView.tsx`、`ProfileSettingsView.tsx`、`RuntimeComponentsSettingsView.tsx` | 各自稳定的 `page:settings-*` | 同目录同名 `*.test.tsx` 八个文件 |

TASK-0 若发现新的“请求已发出后直接展示异常”入口，必须先在本表新增明确行、scope、测试和操作 ID，再实施；纯字段校验或 Creator Workspace 不进入本表，后者由 TASK-9 负责。

该任务文件较多但只有一个不可拆的产品行为：FR-7 要求全产品普通页面使用同一语义；只迁移部分页面会留下用户明确要求消除的 raw error 路径。执行时按“核心/设置/局部操作”三个 RED/GREEN 批次推进，每批独立运行最近测试。

**实施步骤**

1. 对每个文件区分 field error 与 operation issue：同步格式/必填校验保留 string state；await/fetch/service/文件操作进入 `captureOperationFailure(surface, operationId, cause)`。
2. 在现有错误区域替换为 `IssuePresenter`，不叠加卡中卡；原有特殊语义（如 Profile in-use counts、目录冲突、任务活跃）转换为 catalog `summaryKey/summaryParams`，不从 `details` 拼接用户可见原文。
3. 成功后调用 `resolveOperation`；主动取消、暂停和拒绝审批调用正常状态分支，不 capture。Toast 可保留即时提醒，但页面 Issue 区必须持久可见。
4. 注册动作仅限真实存在的 retry handler、设置 route或输入 ref；Browser/Desktop 共享页面不得按 `hostBridge.kind` 分叉通用 Issue 文案和主体布局。
5. `CreatorDashboard/DashboardPage` 创建或恢复 Job失败时，由 `creator-launch` Page Issue承载；拿到服务端 Job ID后清理对应 launch operation，后续失败只接受该 Job 的持久 Issue。不得用临时 ID猜测 Job Scope，也不得把创建前错误经 `/creator/jobs/:id/issues/report` 上报。

**TDD**

- 策略：必须，分三批真实 RED/GREEN。
- RED：`Projects Schedules Tasks and Files keep an issued failure with diagnostic action until retry succeeds`；各页面 mock真实 service 失败后成功，断言 Issue、诊断号、retry与清理；当前多处只显示 message/string。
- RED：`settings operation failures use the shared presenter while validation stays beside the field`；覆盖 CreatorServices/Profile/Memory/CodexRuntime 的字段错误和提交失败，断言前者无 Issue、后者有 Issue；当前混为字符串。
- RED：`AppController MemorySuggestion Connections TTS and export failures do not expose raw runtime details`；输入带 stack/key/path，断言脱敏与真实动作；当前路径可能直出 message。
- RED：`ScheduleThreadHeader SearchView Composer and runtime dependencies retain operation failures in their page scope`；逐一触发已发出的失败并成功重试，断言稳定 surface/operation、诊断号、清理及字段校验不建 Issue；当前清单外路径直接展示异常或瞬时 Toast。
- RED：`creator launch failures stay in page scope until an authoritative job id exists`；创建/恢复先失败再成功，断言失败为 `page:creator-launch`、未调用 Creator issue report；成功获得 Job ID后 launch Issue清理，后续 Job失败进入该 ID 的持久 Issue；当前无分界。
- GREEN：逐批迁移并运行对应页面测试，再运行 C8；不得一次机械替换所有 `setError`，每个 catch 必须先判断是否已发出操作。
- REFACTOR：删除只为拼 raw error存在的重复 formatter，但保留领域参数映射；重跑所有修改页面测试和 C8。

**任务完成门**

- 上述迁移表每行均填写五项验收记录，列出的 23 个实现文件与对应定向测试全部通过，C8通过；补充 `rg` 只作为发现新行的手段，不作为完成证据；不存在“已发出操作只显示 raw message/Toast”，且 Creator launch 的 page/Job边界由测试证明；AC-1 及相关 AC-7 可验收。

### TASK-9：让所有 Creator 客户端操作失败进入共享 Panel `[FR-2, FR-4, BR-1, BR-2, BR-3, BR-4, BR-7, NFR-1, NFR-2, DEC-2, DEC-3, DEC-5, AC-2, AC-4, AC-6, AC-7]`

**交付结果**

- Session 统一捕获 applyAction、上传、保存、打开 Artifact、Agent、Preflight等失败；Workspace 内浏览器文件读取/解析等纯客户端失败也报告到同一 Panel。
- Workspace 只保留字段级校验和当前任务短摘要，不再维护第二套权威错误事实。
- 本任务只接管已经获得权威 Job ID 的 `creator-job` Issue；创建/恢复前的 `creator-launch` Page Issue 由 TASK-8处理，成功后不得复制进 Panel。

**文件与符号**

- 修改：`apps/web/src/features/dashboard/creator-session-store.tsx` - `reportClientIssue/captureCreatorFailure/resolveOperation` 公共入口覆盖所有现有 service catch。
- 修改：`CreatorArtifactDetails.tsx`、`CreatorResultVersionMenu.tsx`、`VideoTranslationSubtitleImport.tsx`。
- 修改 Creator Workspace：`AutoClipWorkspace.tsx`、`CoverGeneratorWorkspace.tsx`、`DigitalAvatarWorkspace.tsx`、`ImageGenerationWorkspace.tsx`、`ShortVideoScriptWorkspace.tsx`、`SmartDubbingWorkspace.tsx`、`StickmanVideoWorkspace.tsx`、`VideoDownloadWorkspace.tsx`、`VideoGenerationWorkspace.tsx`、`VideoTranslationWorkspace.tsx`、`WechatArticleWorkspace.tsx`、`XiaohongshuPostWorkspace.tsx`。
- 测试：`creator-session-store.test.tsx` 和每个受影响 Workspace最近的 `*.test.tsx`；`VideoTranslationAgentPanel.test.tsx` 作为共享 Panel入口回归。

该任务按 Session 公共捕获、文件/Artifact 操作、Workspace 纯客户端操作三个批次执行；文件多是因为项目铁律要求所有 Creator 模板共用一个 Panel，不能以保留各 Workspace 私有错误面板来缩小改动。

**实施步骤**

1. Session 的每个已发出 service 操作传稳定 `source/operation/stageId/scopeKey`；若 `ApiClientError.issue.scope=creator-job` 直接合并权威 ID，不二次 report；page/local Issue 转临时 Creator Issue并走受限上报。
2. 浏览器 FileReader、JSON/SRT解析、Canvas/下载等客户端实际操作失败调用 `reportClientIssue`；输入为空、格式未提交等校验仍贴近字段，不上报。
3. Workspace 的 `currentIssue/visibleError` 改为 `job.issues/session issue` 派生的短摘要；不写 Activity，不复制 Panel 卡、SSE、审批或状态机。
4. 成功重试只通过 Daemon权威事件解决；离线临时问题在恢复后补报。主动 cancel/pause/reject 不 capture。
5. Adapter 仅负责 Stage label、模板字段/动作映射；不得读取 Issue存储或改变生命周期。未知模板使用共享 fallback文案，不暴露内部 executor/Stage ID。
6. `captureCreatorFailure/reportClientIssue` 必须先验证当前存在权威 Job ID且 issue scope匹配；没有 Job ID时返回给 TASK-8 的 `creator-launch` Page Issue入口。Session 只根据 Daemon快照/SSE更新持久 Issue状态，upload/API retry 的 Promise结果不直接 resolve/reopen。

**TDD**

- 策略：必须，按三个批次。
- RED：`session routes action upload preflight artifact and agent failures to one creator issue without double reporting server issues`；逐类失败并混入权威 server Issue，断言 Panel Issue集合和 report 次数；当前只写 `CreatorSessionError`。
- RED：`client-side subtitle import failure appears in the Agent panel and remains local while daemon is offline`；非法读取/解析发生在请求前但属于已发出的用户操作，断言临时卡和恢复补报；当前只在 Workspace字符串显示。
- RED：`all creator workspaces keep field validation local and send operation failures through the session reporter`；用表驱动渲染代表性字段错误/operation error，断言前者无 Issue、后者共享 Panel可见；当前多个 Workspace各自 `setError`。
- RED：`creator session rejects pre-job reports and waits for daemon issue terminal events`；无 Job ID时触发 launch失败、获得 ID后触发 upload retry，断言前者仅 Page Issue、后者同一持久 ID在 Daemon事件前不改状态；当前 Session无该边界。
- GREEN：逐批迁移并运行受影响 Workspace测试、C7、C8。
- REFACTOR：删除重复 format error只保留 catalog参数适配；不新建 Panel/Issue store；重跑 C7、Workspace测试和 C8。

**任务完成门**

- C7、C8和所有修改 Workspace定向测试通过；Creator 实际失败可在共享 Panel追问，字段校验不污染 Panel，覆盖 AC-2/AC-4/AC-6/AC-7。

### TASK-10：完成兼容迁移、恢复、服务重启与发布门禁 `[FR-6, FR-7, BR-8, NFR-2, NFR-4, NFR-5, DEC-3, DEC-7, AC-6, AC-7]`

**交付结果**

- 新/旧 Daemon与 Web组合按加法协议降级；旧数据库/Stage可读，回滚不删 Issue表；Daemon重启恢复 Issue/Stage一致。
- 当前源码经服务重启、同视口 parity、实际 Desktop 打包 App E2E与内嵌 Web哈希门禁验证。

**文件与符号**

- 修改：`apps/web/e2e/web-desktop-parity.spec.ts` - 同 Fake Daemon 的普通 Page Issue、Creator Issue、聚焦 Agent、修复结果和 Browser/Desktop请求对比。
- 修改：`apps/desktop/e2e/creator-packaged-app.spec.ts` - `opencreator-app://` 下 Issue、Preload、Runtime代理、刷新持久化和修复流程。
- 按测试需要修改 Fake Daemon fixture；不修改 Desktop 页面、Preload或 Bridge业务分支，除非 TASK-0 发现实际共享协议兼容缺口。
- 验证：`apps/desktop/scripts/package-release.mjs` 和 `verify-package.mjs` 只作为现有门禁执行；本功能不绕过或复制哈希脚本。

**实施步骤**

1. 添加旧载荷/旧数据库 characterization：新 Web连接无 issue的旧错误时本地展示且标明不持久；新 Daemon继续写 Stage error字段并允许旧客户端忽略 `issue_changed`。
2. 用旧 schema fixture启动新 Daemon，确认只新增表/索引；模拟应用回滚只读取旧表，保留新增表，再升级能继续读 Issue。禁止 DROP/清空或批量重写历史 Job/Stage。
3. 在真实运行前执行最后相关定向测试和 C8；确认 19861端口进程后按 C13重启 Web/受管 Daemon，检查根页面与 runtime health，并通过真实浏览器走一次 Issue主流程。
4. 用同一 Fake Daemon、项目、偏好、语言和 1440x900内容视口运行 C10；比较可见文案、状态、动作、Runtime request payload和持久化结果，不比较 OS窗口外框。
5. 运行 C9后执行 C11；检查构建清单含 commit、dirty、平台、架构、时间和 webBuildHash，`verify-package` 必须证明 App内嵌 Web文件列表/哈希与本次 dist相同。再运行 C12验证实际 App。

**TDD**

- 策略：迁移/恢复/一致性逻辑必须先 RED；真实打包配置本身豁免单元 RED，因为只能由现有打包链验证。
- RED：`new web degrades old error envelopes and new daemon preserves legacy stage errors without duplicate open issues`；新旧组合 fixture 当前无 Issue兼容路径时失败。
- RED：`browser and desktop bridges submit identical focused issue and repair requests`；Fake Daemon记录 body/state，当前无新请求字段时失败。
- RED：`packaged creator issue survives refresh and daemon restart`；实际包 spec先增加场景，未实现时失败；它是功能 RED而非打包基础设施失败。
- GREEN：完成兼容/E2E fixture，运行 C1至 C10；重启服务并健康检查；运行 C11、C12。
- REFACTOR：不得为 parity在共享 UI中读取 `hostBridge.kind`；只保留真实 capability差异；相关改动后重跑 C10至 C12。

**发布与回滚**

- 发布顺序：协议加法与 Daemon migration随同一个 Desktop/Web版本交付；Web dev可先连接旧 Daemon并降级，不能假定事件一定存在。
- 回滚：停止新版本，启动旧版本；保留 `creator_issues/creator_issue_events`，旧版本忽略它们和新增 JSON字段；不运行逆迁移。再次升级后由新版本恢复读取。
- 阻止发布：任一 P0 AC失败/阻塞、存在重复 Issue、resolving无法恢复、错误 Artifact已提交、Browser/Desktop请求不一致、App嵌入旧 Web、packaged App E2E失败。

**任务完成门**

- C1至 C12均在最后相关改动后通过，C13健康检查通过；迁移/回滚演练无数据破坏；AC-6/AC-7具备本次运行证据。

### TASK-11：执行完整功能验收 `[FR-1 至 FR-7, BR-1 至 BR-8, NFR-1 至 NFR-5, DEC-1 至 DEC-7, AC-1 至 AC-7]`

**本地实现差异自审**

1. 主 Agent检查最终 `git diff --stat` 和所有相关 `git diff`，不得启动 Reviewer或子 Agent。
2. 对照契约快照、追踪矩阵和 TASK-1至 TASK-10逐项确认：无漏项/范围外功能；ApiError、Issue身份、状态/失败/恢复语义未漂移；没有第二套 Panel/Activity错误；AC未降低。
3. 检查重复/过度抽象、敏感信息、任意命令/URL动作、并发 upsert、事件去重、分页/投影上限、旧协议/回滚、测试是否只断言 mock内部。
4. 自审发现本次交付问题时先增加或确认失败测试，再做最小修复并重跑受影响命令；任何相关业务代码/测试修改都会使此前验收证据失效。

**验收环境与证据协议**

- 普通 Web与 Desktop parity使用同一 Fake Daemon、同一项目/Job/偏好/语言和 1440x900前端内容视口；外部 Provider使用受控 fake upstream，不产生费用。
- Creator持久化/恢复使用临时 SQLite和临时 dataDir；每个场景记录创建数据、清理目录和回滚结果。
- 真实浏览器使用 C13服务；服务端改动后必须先重启并通过 health。实际 App使用 C11新包，不复用旧 `apps/web/dist`。
- 每项证据记录：`PASS | FAIL | BLOCKED`、执行时间、工作目录、完整命令/交互入口、退出码、关键输出摘要，以及 Playwright trace/screenshot或 API响应/数据库断言位置。单元测试只能补充，不能替代公开边界验收。

| AC ID | 优先级 | 场景 | 前置条件 | 操作 | 预期结果 | 验证方式 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AC-1 | P0 | 普通页面新/旧/网络错误与非错误输入 | Fake Runtime分别返回带 `error.issue`、仅 code/message/details、HTML 500、非法 JSON、fetch拒绝、用户取消；准备字段校验 | 从 Projects/Settings等真实页面发起操作，观察失败，执行成功重试/关闭/离页并刷新 | 所有实际失败进入同一 Presenter并保留本地化说明、诊断号和真实动作；success/dismiss/unmount清理；刷新不恢复；用户取消和字段校验无 Issue；无 Agent | 真实浏览器 + Runtime公开 Client/API；定向测试作补充 | 记录页面截图/DOM、请求、状态清理和执行时间 |
| AC-2 | P0 | Creator各来源失败、并发去重、刷新与重启 | 准备 API/upload/preflight/stage/provider/agent/output-validator错误、取消、非阻塞 finding、resolved复发和 resolving重启；同一临时DB准备两个独立连接 | 逐类触发；用屏障并发提交同指纹；刷新页面；修复中重启 Daemon | 每个逻辑问题只有一个稳定 ID；并发请求全成功、occurrence等于请求数且事件不丢；刷新/重启仍在；resolving中断回 open；resolved复发同 ID并写 reopened；取消/非阻塞建议无新错误卡 | 真实 Creator API + Worker双连接临时DB + Daemon重启 + 浏览器 Panel | API/SSE/DB/Panel四处同 ID，并发返回/行数/事件数和重启前后状态 |
| AC-3 | P0 | 多 Issue下精确追问 | 同 Job存在至少两个开放 Issue且Agent fake runtime可记录 Context | 选择第二个 Issue，编辑“为什么失败/如何修复”并发送；再提交外部Job Issue ID | 请求携带正确 focusedIssueId；Context只聚焦权威第二项；回答区分已确认/可能/下一步；外部 ID在调用模型前被拒绝 | Agent Service公开API + Panel真实交互 | Turn请求、Context安全投影、回答结构、runtime调用次数 |
| AC-4 | P0 | Stage与非 Stage免费/危险修复及各终态 | 准备normal stage、upload/API retry、paid Provider、overwrite/file/settings动作、失败、取消、超时、interrupted和unknown remote acceptance | 直接点击normal；经真实 upload endpoint携带 `repairIssueId/resolutionAttemptId`；让Agent发起危险动作并审批；逐类终结attempt与重启 | normal只执行一次；upload/API由 endpoint 写 `open -> resolving -> resolved/open`并复用 ID；危险动作必须确认/审批；成功resolved；失败open且+1；取消/超时/interrupted回open并记录终态；unknown禁止重复付费；client/agent无不可验证retry | Runtime Action/API/upload endpoint/审批/恢复公开边界 | Upload/Receipt/Stage/Provider与Issue event关联、请求次数、状态截图 |
| AC-5 | P0 | 中文翻译输出语义 | 使用固定正确中文、英文原文回退、合理中英混合、专有名词、短样本和同语言Fixture | 运行subtitle Stage；对英文回退Issue执行合法retry并返回正确中文 | 英文回退为 Stage failed、Dispatch finished、Job needs_input、Issue open且无completed Artifact/版本/快照；合法边界成功；retry新 Run通过后才提交并解决同 ID | 真实 Stage Runner/API + 临时DB；validator单元补充 | Stage/dispatch/job/issue行、Artifact数量、resultSnapshots前后 |
| AC-6 | P0 | 安全、有界与统计投影 | 错误含API key、Authorization、用户原文、用户目录、stack、供应商伪指令/详情；准备长Issue事件历史和多种 retry终态 | 查看API、Panel、Agent Context、日志允许投影和分页结果；调用真实 `GET /creator/jobs/:id/issues/stats?from=&to=` | 所有敏感值消失；fallback不执行伪指令；Job/Panel/Context有界且完整历史可分页；stats响应逐 key枚举后仅含 `jobId/from/to/rows` 与 `code/source/status/retryResult/count`，计数正确 | 真实 stats/list API + 浏览器 + Agent Context + 数据库分页 | 原始HTTP响应负向字符串搜索、响应键集合、数量上限、分页游标和聚合计数 |
| AC-7 | P0 | 新旧协议与Web/Desktop交付一致 | 同Fake Daemon、数据、偏好、视口；准备旧Stage；C9生成当前dist；C11生成实际包 | Web/Desktop执行同一失败、聚焦、重试、刷新流程；运行C10/C11/C12并读取构建清单 | 通用文案/状态/动作/Runtime请求/持久化一致；旧数据可读且兼容Issue按成功关闭；Preload、`opencreator-app://`、Runtime代理可用；App Web文件列表/哈希等于当前dist | Browser/Desktop parity + 实际packaged App E2E + verify-package | Playwright报告/trace、构建清单、hash校验输出、退出码 |

任一 P0 AC为 `FAIL` 或 `BLOCKED`，不得宣布完成、两端一致或可发布。所有 AC通过后仍只报告实际执行的平台和包，不外推未运行的 OS。

## 失败熔断

- 预期 RED不计失败次数；必须确认它因目标能力缺失而失败，不得把 import/语法/fixture错误伪装成 RED。
- 进入 GREEN后，每次修复前记录失败命令、关键输出、根因假设和本次最小改动。
- 同一测试或命令因同一根因经过两次有实质差异的修复仍失败，立即停止当前 TASK并标记 `BLOCKED`。
- 熔断后判定属于实现、测试/fixture、环境或 Plan/契约；把证据和下一步交给用户。不得继续盲试、放宽断言、删除失败用例、静默改设计或启动子 Agent。
- 外部Provider/远端接收状态未知不以自动重试解决；保留 open并禁用可能重复付费的动作。

## 偏差规则

- 不改变契约的文件位置、局部命名和实现细节可调整，但在最终报告记录原因、影响和替代验证。
- 发现需要改变任何 FR/BR/NFR/DEC/AC、公开 Issue联合、状态转换、数据迁移、Agent权限或Panel唯一性时立即停止，更新方案/Plan。
- 不得为通过测试降低脱敏、去重、持久化、输出校验、Web/Desktop parity、实际打包App或hash门禁。
- 不处理无关历史失败；仅记录其命令、证据和与本次改动无关的判断。

## 最终报告格式

执行完成后最终回复必须包含：实施结果与未完成项；Plan偏差及是否改变契约；本地 diff自审结论和修复项；每个TASK的RED/GREEN/回归命令与结果；AC-1至AC-7的 `PASS/FAIL/BLOCKED`、实际结果和本次新鲜证据；服务重启、打包、hash与回滚状态；遗留风险。不得用“全量测试通过”描述未执行的范围。

## 风险与控制

| 风险 | 控制与关闭证据 |
| --- | --- |
| 多层捕获造成 Issue风暴 | 服务端单点capture优先、同指纹唯一索引、客户端收到权威ID不再report；AC-2比较API/SSE/DB/Panel ID。 |
| 唯一索引仍因先查后写产生竞争失败或事件丢失 | Repository使用单条UPSERT RETURNING；C3/AC-2以Worker屏障和两个独立SQLite连接验证所有请求、行数、ID、occurrence和事件数。 |
| resolving永久卡住 | attempt强制关联业务身份，终态与启动恢复原子对账；C3和AC-2/AC-4覆盖。 |
| 非 Stage retry由前端误判成功或永不闭环 | 来源到StageRun/ProviderRequest/Receipt/endpoint attempt映射固定；upload公开边界覆盖success/failure/cancel/timeout/interrupted，client/agent禁发retry。 |
| 语言检测误伤混合/专名/短句 | 固定样本门槛和多类Fixture；阈值改动必须新增RED并回到方案。 |
| 技术详情泄密或提示注入 | 服务端白名单/长度限制、统一脱敏、Agent不可信数据边界；AC-6负向搜索。 |
| 全产品迁移遗漏 | TASK-8的23文件封闭枚举表逐行记录五项证据，`rg`只能发现并新增行；Creator launch在Job ID前后分别测试page/persistent边界；字段错误显式排除。 |
| 统计接口泄露自由文本或敏感详情 | Repository只聚合四个枚举维度，真实stats API测试逐键检查并以敏感fixture做负向搜索；AC-6从HTTP响应验收。 |
| 新旧协议/旧数据重复显示 | 持久Issue优先、最新Stage兼容派生、后续成功关闭；兼容组合测试和AC-7。 |
| App使用旧Web产物 | C11必须重新构建并由现有verify-package比较文件列表与hash；失败阻止发布。 |
| 实际打包耗时或环境依赖失败 | 记录为AC-7 `BLOCKED`并报告环境证据，不得以单元测试/parity替代。 |

## 独立审核记录

Plan 第一版 Reviewer 原始结论为 `REVISE`。主 Agent已按关闭条件修订一次，未启动第二个 Reviewer；以下记录保留原始问题与可检查关闭证据，不把主 Agent修订伪装为独立复审。

| 问题 ID | 严重程度 | 处理决定 | 修改位置 | 关闭证据或不采纳理由 | 遗留风险 |
| --- | --- | --- | --- | --- | --- |
| PLAN-R-01 | Major | 采纳：固定每类来源的修复关联身份、begin/finish写入责任和禁用条件，并用upload证明非Stage闭环 | 公共接口与数据模型；TASK-4/5/9；AC-4 | 映射表覆盖Stage/output-validator、provider、preflight、API/upload、agent/client；公开 `repairIssueId/resolutionAttemptId`；C4 RED从真实upload endpoint断言同ID的 `open -> resolving -> resolved/open`及五类终态 | 首个实现只强制upload作为非Stage公开样板；其他API只有进入operation注册表并增加同级测试后才能发布retry |
| PLAN-R-02 | Major | 采纳：把遗漏页面加入封闭迁移表，并锁定Creator创建/恢复前后的Scope切换 | 基线文件地图；TASK-8/9；AC-1/AC-7 | 表中明确新增 `ScheduleThreadHeader`、`SearchView`、`Composer`、`use-runtime-dependencies`、`CreatorDashboard`、`DashboardPage`及六个同名测试；完成门要求23文件逐行五项证据，`rg`不能替代 | TASK-0若发现新入口仍需显式新增表行；数量随基线合法变化时必须记录Plan偏差 |
| PLAN-R-03 | Major | 采纳：固定最小统计响应、Repository聚合和真实GET API | 公共接口与数据模型；TASK-1/3/4；AC-6 | `CreatorIssueStatsResponse`、`aggregateIssueStats`、`GET .../issues/stats`均有文件/符号、敏感fixture RED和HTTP逐键验收；只允许四个白名单维度与count | 当前只提供Job级时间范围聚合，不承诺跨Job/租户运营报表 |
| PLAN-R-04 | Major | 采纳：用真实多连接竞争替换串行/嵌套transaction证明 | TASK-3；C3；AC-2；风险表 | 同一UPSERT SQL由生产Repository与Worker复用；WAL下两个独立 `better-sqlite3`连接经屏障竞争，断言全部成功、单行、同ID、occurrence等于请求数、事件不丢且不得skip | SQLite会串行提交写事务；测试证明的是并发调用下的原子结果，不声称存在并行物理写入 |
