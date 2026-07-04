# Codex-native Runtime Contract 覆盖审计

审计对象：`docs/superpowers/specs/2026-07-03-codex-native-runtime-contract-design.md`

审计时间：2026-07-04

## 结论

当前项目不能声明“完整 Codex-native Runtime 全功能通过”。当前可声明范围是：

1. R0/R1 的基础 run 闭环通过：create run、SSE replay、fromSeq/Last-Event-ID、cancel、terminal cancel 错误码、history、diagnostics、fake Codex 异常路径和 real Codex smoke 子集。
2. R2-R7 中的 thread/chat resume、profiles、skills、MCP pass-through、scheduler 和 release readiness 大部分还没有实现。
3. R-1 真实 Codex ABI 验证已覆盖 version/help/resume help/MCP help/最小 JSONL/command execution smoke，并在 gated smoke 运行时生成本地 stdout/stderr fixture；尚未产出完整能力矩阵和可提交的版本化 fixture。

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
7. `resume_thread` 缺 threadId 失败路径返回 `RESUME_FAILED`。
8. 未授权 `/runs` 返回 401。
9. `/healthz` 和 `/codex/status` 可用。

## 覆盖矩阵

| Contract 区域 | 代码位置 | 测试位置 | 状态 | 缺口 |
|---|---|---|---|---|
| Codex exec argv | `apps/daemon/src/codex/argv.ts` | `apps/daemon/test/unit/codex-argv.test.ts` | `PASS` | resume argv 未实现 |
| Codex capability parser | `apps/daemon/src/codex/capabilities.ts` | `apps/daemon/test/unit/codex-capabilities.test.ts` | `PARTIAL` | 未接 daemon 启动检测和 `/codex/status` |
| CODEX_HOME 解析 | `apps/daemon/src/codex/home.ts` | `apps/daemon/test/unit/codex-home.test.ts` | `PASS` | 隔离模式 e2e、配置缓存、冲突处理未实现 |
| Codex runner | `apps/daemon/src/codex/runner.ts` | `apps/daemon/test/integration/codex-runner.test.ts` | `PARTIAL` | 已覆盖 SIGTERM 后 SIGKILL 兜底、spawn fail、spawnTimeout、timeout、inactivity；缺进程树强杀专项 |
| JSONL parser | `apps/daemon/src/events/parser.ts` | `apps/daemon/test/unit/events.test.ts` | `PASS` | 真实 fixture 回归不足 |
| Event normalizer | `apps/daemon/src/events/normalizer.ts` | `apps/daemon/test/unit/events.test.ts` | `PARTIAL` | usage、MCP、patch、web search、reasoning 事件未覆盖 |
| Run manager | `apps/daemon/src/runs/manager.ts` | `apps/daemon/test/integration/run-manager.test.ts` | `PARTIAL` | 已覆盖 events 文件/DB seq 一致性、done 连续 seq、inactivity、daemon restart orphan 恢复、关键成功终态缺失判失败；缺同 workspace/thread 串行 |
| Run API | `apps/daemon/src/api/routes.runs.ts` | `apps/daemon/test/integration/api.test.ts` | `PARTIAL` | 已覆盖 `fromSeq`、`afterSeq`、`Last-Event-ID`、terminal cancel 错误码、大量事件 replay、content-type；缺更真实的断线重连 e2e |
| SSE formatter | `apps/daemon/src/api/sse.ts` | `apps/daemon/test/integration/api.test.ts` | `PARTIAL` | 已覆盖 full replay、`fromSeq`、`afterSeq`、`Last-Event-ID`、done 后关闭、运行中 tail、heartbeat；缺更真实的断线重连 e2e |
| Diagnostics | `apps/daemon/src/api/routes.diagnostics.ts` | `apps/daemon/test/integration/diagnostics.test.ts` | `PARTIAL` | `/codex/status` 快照、raw.redacted 策略、二次脱敏、清理策略缺失 |
| Thread manager | `apps/daemon/src/threads/manager.ts` | `apps/daemon/test/unit/thread-manager.test.ts` | `PARTIAL` | 只有 create；没有持久化、list/get/runs/archive、resume |
| Scheduler helper | `apps/daemon/src/scheduler/scheduler.ts` | `apps/daemon/test/unit/scheduler.test.ts` | `PARTIAL` | 没有 schedule CRUD/run-now/cron/timezone/concurrency |
| MCP argv | `apps/daemon/src/codex/mcp.ts` | `apps/daemon/test/unit/mcp-argv.test.ts` | `PARTIAL` | 没有 pass-through API、真实 codex mcp、env 响应脱敏 |
| Redaction | `apps/daemon/src/security/redaction.ts` | 间接覆盖 | `PARTIAL` | 缺独立脱敏规则矩阵 |
| Storage schema | `apps/daemon/src/storage/migrations.ts` | `apps/daemon/test/unit/storage.test.ts` | `PARTIAL` | runtime_capabilities、schedules、archived_at、settings 缺失 |
| Harness CLI | `apps/harness/src/cli.ts` | 手动 smoke | `PARTIAL` | 缺自动化 CLI 测试 |
| Real Codex smoke | `apps/daemon/src/codex/smoke.ts` | `apps/daemon/test/smoke/real-codex-smoke.test.ts` | `PARTIAL` | 已覆盖 resume help、mcp help、mcp add help、command execution，并生成本地 ignored fixture；缺 usage/failure/sandbox/image 和版本化 fixture 回归 |

## 第一版完成定义逐条审计

| 完成定义 | 状态 | 说明 |
|---|---|---|
| run 可创建、观察、取消、恢复和诊断 | `PARTIAL` | 创建、观察、取消、诊断通过；恢复/resume 未实现 |
| Codex 版本和能力可检测 | `PARTIAL` | 有 parser 和 smoke；未持久化 capability matrix，`/codex/status` 仍是静态 unknown |
| 事件协议稳定，SSE 可 replay | `PARTIAL` | 基础 replay、`fromSeq`、`afterSeq`、`Last-Event-ID`、大量事件顺序、运行中 tail、heartbeat 通过；真实 fixture 回归不足 |
| 本地 API 不裸露给未授权调用方 | `PASS` | 非 healthz 接口有 bearer token |
| 配置写入有锁、原子性和缓存同步 | `MISSING_IMPL` | profile/config 写入未实现 |
| Scheduler 行为可预测 | `MISSING_IMPL` | 只有 helper |
| R-1 真实 Codex 验证通过，并保存 stdout/stderr 分离 fixture | `PARTIAL` | version/help/resume help/MCP help/JSONL/command execution smoke 通过；已生成本地 ignored fixture，未形成版本化 fixture 回归 |
| 支持的 Codex 版本区间已明确，版本超界行为可验证 | `MISSING_IMPL` | 没有版本区间 gate |
| fake Codex 测试覆盖主要异常路径 | `PARTIAL` | 覆盖基础异常、强杀兜底、spawnTimeout、inactivity、orphan 恢复；缺进程树强杀专项 |
| 真实 Codex smoke 覆盖 assistant message、command execution、usage、stderr warning 和失败路径 | `PARTIAL` | assistant/stderr 间接覆盖，command execution 已覆盖；usage/failure 缺失 |
| 如果承诺 Chat，多轮 thread/resume 已通过真实 Codex 验证 | `MISSING_IMPL` | 当前不能承诺 Chat resume |
| 如果不承诺 resume Chat，Runtime capability 和文档明确标注独立 run 模式 | `MISSING_TEST` | 需要 capability/status 明确表达 |
| create/resume argv、skip git、stdin `-`、rollout usage、config normalize、平台 sandbox 进入能力矩阵 | `MISSING_IMPL` | 能力矩阵未实现 |

## 下一步优先级

1. 继续补 R0 剩余异常路径：进程树强杀专项、同 workspace/thread 串行。
2. 继续补 R-1 失败路径和 fixture 回归：usage、failure、sandbox、可提交的脱敏版本化 fixture。
3. 补 R1 剩余 contract 细节：更真实的断线重连 e2e。
4. 再决定是否进入 R2 Thread/Chat resume 实现。
5. R3-R7 不应再被口头归为已完成，必须作为独立 milestone 实现和验收。
