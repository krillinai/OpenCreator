# Codex-native Runtime Contract 覆盖审计

审计对象：`docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md`

审计时间：2026-07-04

## 结论

当前项目不能声明“完整 Codex-native Runtime 全功能通过”。当前可声明范围是：

1. R0/R1 的基础 run 闭环通过：create run、SSE replay、fromSeq/Last-Event-ID、cancel、terminal cancel 错误码、history、diagnostics、fake Codex 异常路径和 real Codex smoke 子集。
2. R2 Thread/Chat resume 的后端最小闭环已通过：thread 持久化、list/detail/history/archive、`thread.started` 捕获、resume argv、fake resume、同 thread queue、diagnostics metadata、gated real resume smoke。仍不能声明完整 Chat 产品能力，因为 UI、messages 表和 workspace 全局写锁还没有实现。
3. R3-R7 中的 Profile 管理、Skills 管理、MCP pass-through 管理、Scheduler 行为和 release readiness 大部分还没有实现。
4. R-1 真实 Codex ABI 验证已覆盖 version/help/resume help/MCP help/最小 JSONL/command execution/真实 resume continuity smoke，并在 gated smoke 运行时生成本地 stdout/stderr fixture；尚未产出完整能力矩阵和可提交的版本化 fixture。

## 当前自动化结果基线

最近一次已执行并通过：

```bash
pnpm typecheck
pnpm test
CLAWEE_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @clawee/daemon test -- test/smoke/real-codex-smoke.test.ts
```

最近一次功能 smoke 已验证：

1. `pnpm daemon:dev` 能启动。
2. harness `history` 能查询。
3. harness `run` 能创建真实 Codex run。
4. harness `events` 能 replay SSE。
5. harness `diagnostics --output` 能导出诊断包。
6. harness `cancel` 能取消运行中 run。
7. `resume_thread` 缺 threadId 失败路径按独立 run 处理；已有 Codex thread 但目标缺失时返回 `RESUME_TARGET_NOT_FOUND`，其他 resume 非零退出返回 `RESUME_FAILED`。
8. 真实 Codex `exec resume <thread_id> --json` 上下文连续性已通过 gated smoke：第二轮回复包含第一轮 marker。
9. 未授权 `/runs` 返回 401。
10. `/healthz` 和 `/codex/status` 可用。

## 覆盖矩阵

| Contract 区域 | 代码位置 | 测试位置 | 状态 | 缺口 |
|---|---|---|---|---|
| Codex exec argv | `apps/daemon/src/codex/argv.ts` | `apps/daemon/test/unit/codex-argv.test.ts` | `PASS` | 已覆盖 exec argv、resume argv 不携带 cwd/profile/sandbox；缺能力矩阵持久化 |
| Codex capability parser | `apps/daemon/src/codex/capabilities.ts` | `apps/daemon/test/unit/codex-capabilities.test.ts` | `PARTIAL` | 未接 daemon 启动检测和 `/codex/status` |
| CODEX_HOME 解析 | `apps/daemon/src/codex/home.ts` | `apps/daemon/test/unit/codex-home.test.ts` | `PASS` | 隔离模式 e2e、配置缓存、冲突处理未实现 |
| Codex runner | `apps/daemon/src/codex/runner.ts` | `apps/daemon/test/integration/codex-runner.test.ts` | `PARTIAL` | 已覆盖 SIGTERM 后 SIGKILL 兜底、spawn fail、spawnTimeout、timeout、inactivity；缺进程树强杀专项 |
| JSONL parser | `apps/daemon/src/events/parser.ts` | `apps/daemon/test/unit/events.test.ts` | `PASS` | 真实 fixture 回归不足 |
| Event normalizer | `apps/daemon/src/events/normalizer.ts` | `apps/daemon/test/unit/events.test.ts` | `PARTIAL` | usage、MCP、patch、web search、reasoning 事件未覆盖 |
| Run manager | `apps/daemon/src/runs/manager.ts` | `apps/daemon/test/integration/run-manager.test.ts` | `PARTIAL` | 已覆盖 events 文件/DB seq 一致性、done 连续 seq、inactivity、daemon restart orphan 恢复、关键成功终态缺失判失败、`thread.started` 捕获、fake resume、同 thread queue、queued cancel、resume 失败映射；缺 workspace 全局写锁和进程树强杀专项 |
| Run API | `apps/daemon/src/api/routes.runs.ts` | `apps/daemon/test/integration/api.test.ts` | `PARTIAL` | 已覆盖 `fromSeq`、`afterSeq`、`Last-Event-ID`、terminal cancel 错误码、大量事件 replay、content-type、thread run 绑定、自动 resume、thread config immutable、archived/missing thread 拒绝；缺更真实的断线重连 e2e 和 UI |
| SSE formatter | `apps/daemon/src/api/sse.ts` | `apps/daemon/test/integration/api.test.ts` | `PARTIAL` | 已覆盖 full replay、`fromSeq`、`afterSeq`、`Last-Event-ID`、done 后关闭、运行中 tail、heartbeat；缺更真实的断线重连 e2e |
| Diagnostics | `apps/daemon/src/api/routes.diagnostics.ts` | `apps/daemon/test/integration/diagnostics.test.ts` | `PARTIAL` | 已覆盖 resume diagnostics metadata、queued thread cancel metadata；`/codex/status` 快照、raw.redacted 策略、二次脱敏、清理策略缺失 |
| Thread manager/API | `apps/daemon/src/threads/manager.ts`, `apps/daemon/src/api/routes.threads.ts` | `apps/daemon/test/unit/thread-manager.test.ts`, `apps/daemon/test/integration/api.test.ts` | `PARTIAL` | 已覆盖 thread 持久化、managed/external cwd、list/detail/history/archive、archive active-run guard、codexThreadId 绑定；缺 UI、messages 表、全局 workspace 写锁和更完整的 Chat transcript 模型 |
| Scheduler helper | `apps/daemon/src/scheduler/scheduler.ts` | `apps/daemon/test/unit/scheduler.test.ts` | `PARTIAL` | 没有 schedule CRUD/run-now/cron/timezone/concurrency |
| MCP argv | `apps/daemon/src/codex/mcp.ts` | `apps/daemon/test/unit/mcp-argv.test.ts` | `PARTIAL` | 有 argv helper 和 help smoke；没有 MCP 管理/pass-through API、真实 codex mcp 执行、env 响应脱敏 |
| Redaction | `apps/daemon/src/security/redaction.ts` | 间接覆盖 | `PARTIAL` | 缺独立脱敏规则矩阵 |
| Storage schema | `apps/daemon/src/storage/migrations.ts` | `apps/daemon/test/unit/storage.test.ts` | `PARTIAL` | 已有 threads/runs 关联和 archived_at；缺 messages 表、runtime_capabilities、schedules、settings |
| Harness CLI | `apps/harness/src/cli.ts` | 手动 smoke | `PARTIAL` | 缺自动化 CLI 测试 |
| Real Codex smoke | `apps/daemon/src/codex/smoke.ts` | `apps/daemon/test/smoke/real-codex-smoke.test.ts` | `PASS` | 已覆盖 version、exec help、resume help、mcp help、mcp add help、最小 JSONL、command execution、真实 resume context continuity；缺 usage/failure/sandbox/image 和版本化 fixture 回归 |

## 第一版完成定义逐条审计

| 完成定义 | 状态 | 说明 |
|---|---|---|
| run 可创建、观察、取消、恢复和诊断 | `PARTIAL` | 创建、观察、取消、诊断通过；thread resume 后端闭环和真实 Codex resume smoke 通过；UI、messages 表、workspace 全局写锁未实现 |
| Codex 版本和能力可检测 | `PARTIAL` | 有 parser 和 smoke；未持久化 capability matrix，`/codex/status` 仍是静态 unknown |
| 事件协议稳定，SSE 可 replay | `PARTIAL` | 基础 replay、`fromSeq`、`afterSeq`、`Last-Event-ID`、大量事件顺序、运行中 tail、heartbeat 通过；真实 fixture 回归不足 |
| 本地 API 不裸露给未授权调用方 | `PASS` | 非 healthz 接口有 bearer token |
| 配置写入有锁、原子性和缓存同步 | `MISSING_IMPL` | profile/config 写入未实现 |
| Scheduler 行为可预测 | `MISSING_IMPL` | 只有 helper |
| R-1 真实 Codex 验证通过，并保存 stdout/stderr 分离 fixture | `PASS` | version/help/resume help/MCP help/JSONL/command execution/真实 resume continuity smoke 通过；已生成本地 ignored fixture，未形成版本化 fixture 回归 |
| 支持的 Codex 版本区间已明确，版本超界行为可验证 | `MISSING_IMPL` | 没有版本区间 gate |
| fake Codex 测试覆盖主要异常路径 | `PARTIAL` | 覆盖基础异常、强杀兜底、spawnTimeout、inactivity、orphan 恢复；缺进程树强杀专项 |
| 真实 Codex smoke 覆盖 assistant message、command execution、usage、stderr warning 和失败路径 | `PARTIAL` | assistant/stderr 字段、command execution 和真实 resume continuity 已覆盖；usage/failure/sandbox 缺失 |
| 如果承诺 Chat，多轮 thread/resume 已通过真实 Codex 验证 | `PARTIAL` | 后端真实 resume continuity 已通过；UI、messages 表和完整 Chat transcript 尚未实现，不能声明完整 Chat 产品能力 |
| 如果不承诺 resume Chat，Runtime capability 和文档明确标注独立 run 模式 | `MISSING_TEST` | 需要 capability/status 明确表达当前 thread resume 能力边界 |
| create/resume argv、skip git、stdin `-`、rollout usage、config normalize、平台 sandbox 进入能力矩阵 | `PARTIAL` | create/resume argv、skip git、stdin 写入已覆盖；rollout usage、config normalize、平台 sandbox 能力矩阵未实现 |

## 下一步优先级

1. 继续补 workspace 全局写锁、进程树强杀专项和更真实的断线重连 e2e。
2. 继续补 R-1 失败路径和 fixture 回归：usage、failure、sandbox、可提交的脱敏版本化 fixture。
3. 补 R2 产品面缺口：UI、messages 表、完整 Chat transcript 模型和 capability/status 边界表达。
4. 将 Profile 管理、Skills 管理、MCP 管理/pass-through、Scheduler 行为作为独立 milestone 实现和验收。
5. R3-R7 不应再被口头归为已完成，必须作为独立 milestone 实现和验收。
