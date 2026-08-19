# OpenCreator Agent P0 运行正确性测试报告

> 测试日期：2026-07-12
> 测试结论：`PASS`
> 对应计划：`docs/superpowers/plans/2026-07-12-opencreator-agent-complete-optimization.md`
> 覆盖批次：`P0-B1` 至 `P0-B5`

## 1. 测试目标

本轮验证 OpenCreator Agent 的 P0 运行正确性，确保 daemon 是 Run 状态真相源，并覆盖：

- Scheduler 生产启动和到期触发。
- Run 正常完成、失败、取消和同线程排队。
- 页面刷新、SSE 断流、事件重放和重复事件抑制。
- 跨会话后台运行、Timeline 隔离和定向取消。
- daemon 重启后非终态 Run 的确定性收敛。

## 2. 测试环境

| 项目 | 值 |
|---|---|
| 操作系统 | Darwin 25.3.0 arm64 |
| Node.js | v24.16.0 |
| pnpm | 9.15.0 |
| Codex CLI | codex-cli 0.144.1 |
| 分支 | `codex-native-runtime-kernel` |
| 基线提交 | `de220f7` |
| Web 地址 | `http://127.0.0.1:9000/` |

## 3. P0 回归矩阵

| 场景 | 自动化证据 | 真实环境证据 | 结果 |
|---|---|---|---|
| 正常完成 | Run manager、API SSE、App 完整 Run 测试 | 真实 Codex smoke；双线程 B 最终 `succeeded` | `PASS` |
| 执行失败 | Codex 非零退出、缺终态、超时和 inactivity 测试 | daemon 重启 Run 确定性转为失败 | `PASS` |
| 运行中取消 | Run manager、API cancel、App Composer cancel 测试 | 双线程 A cancel API 返回 `202`，最终 `canceled` | `PASS` |
| 排队和排队取消 | 同线程 queue、dequeue、queued cancel 测试 | Scheduler queue/skip/parallel 策略由测试和 smoke 覆盖 | `PASS` |
| 切换会话 | App 后台订阅、加载态、Timeline 隔离测试 | 用户真实页面手动验收 | `PASS` |
| 后台完成 | App 后台 `done` 更新 Registry 和侧栏状态测试 | 双线程运行时 B 独立完成 | `PASS` |
| 页面刷新恢复 | App 选中历史恢复、活动 Run 恢复测试 | 用户桌面和移动尺寸手动验收 | `PASS` |
| SSE 意外断流 | Run Event Controller 有限重连测试 | 收到事件 `1,2` 后断开，从 `fromSeq=2` 只收到 `3,4,5,6` | `PASS` |
| SSE 去重 | Registry 序号去重、replay deduper 测试 | 真实续传前后事件无重叠 | `PASS` |
| daemon 重启 | running/queued orphan recovery 测试 | `run_uD9Pyv3IfY` 从 `running` 收敛为 `failed` | `PASS` |
| Scheduler 到期 | Scheduler timer、misfire、并发策略测试 | `sch_SJHnGR557z75rnv2GFQ-5` 到期自动触发 Run | `PASS` |
| 取消竞态 | pending start、迟到失败、already terminal 测试 | 定向取消只影响 A，B 不受影响 | `PASS` |

## 4. 自动化验证

### 4.1 仓库门禁

```bash
pnpm test
pnpm typecheck
pnpm build
```

结果：

- `pnpm test`：`PASS`
  - daemon：40 个测试文件通过，1 个真实 smoke 文件按默认开关跳过。
  - daemon：465 个测试通过，13 个测试按默认 smoke 开关跳过。
  - Web：45 个测试文件、333 个测试通过。
  - Skill Market：2 个测试文件、6 个测试通过。
  - 仓库常规测试合计 804 个测试通过。
- `pnpm typecheck`：`PASS`。
- `pnpm build`：`PASS`。
- 构建仅保留既有 Web 主包超过 500 kB 的告警，不属于 P0 正确性回归。

### 4.2 P0 专项

```bash
pnpm --filter @opencreator/daemon test -- \
  test/integration/run-manager.test.ts \
  -t "queues same-thread|cancels queued|left running before daemon restart|queued thread runs left|can cancel a running|exits non-zero"

pnpm --filter @opencreator/daemon test -- \
  test/integration/api.test.ts \
  -t "scheduler|replays events after fromSeq|tails a running run|cancels a running run"
```

结果：

- Run manager 相关 6 个场景通过。
- API 和 Scheduler 相关 9 个场景通过。
- 完整测试同时覆盖运行中取消、queued cancel、失败映射、SSE heartbeat 和终态取消冲突。

### 4.3 真实 Codex smoke

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

结果：`PASS`，13 个测试全部通过，耗时约 106 秒。

覆盖：

- Codex 版本和命令能力。
- 最小 `codex exec --json`。
- Runtime 安装 Skill 后的真实发现。
- MCP 配置管理。
- Scheduler run-now。
- 命令执行 JSONL。
- `codex exec resume` 上下文连续性。

## 5. 真实服务验证

### 5.1 SSE 断流续传

1. 启动真实 Run。
2. 收到事件 `1,2` 后主动中止第一段 SSE。
3. 使用 `fromSeq=2` 重新连接。
4. 第二段只返回 `3,4,5,6`。
5. 最终状态为 `succeeded`，收到一次 `done`，前后无重复。
6. `fromSeq=-1` 返回 `400 VALIDATION_FAILED`。

### 5.2 双线程运行和定向取消

1. 同时启动 A、B 两个真实 Codex 线程。
2. 只对 A 调用取消 API。
3. A 取消返回 `202`，最终状态为 `canceled`。
4. B 不受影响，最终状态为 `succeeded`。
5. B 输出预期标记 `P0-B4-B-SUCCEEDED`。

### 5.3 daemon 重启收敛

1. 创建线程并启动 `run_uD9Pyv3IfY`。
2. 确认重启前状态为 `running`。
3. 停止整套 Web/daemon。
4. 重新启动当前代码并查询同一 Run。
5. Run 自动收敛为：
   - `status=failed`
   - `terminationReason=daemon_restart`
   - `errorCode=THREAD_RUN_ORPHANED`
6. 事件流包含一条 `error` 和一条 `done`，不存在永久 `running`。

### 5.4 Scheduler 到期触发

1. 创建 Schedule `sch_SJHnGR557z75rnv2GFQ-5`。
2. Cron 设置为下一分钟的 UTC 时间。
3. 未调用 run-now。
4. 到期后自动创建 `run_oaqeTozOZH`。
5. Run 最终状态为 `succeeded`，输出 `P0-B5-SCHEDULER-OK`。
6. 测试 Schedule 已删除。

所有真实验证产生的临时线程均已归档。

## 6. 浏览器验收

用户已在真实页面完成以下手动验证，并确认继续后续批次：

- 桌面和移动尺寸刷新恢复。
- 运行中会话刷新后继续追加事件且不重复。
- 会话 A 运行中切换 B，再返回 A。
- B 不显示 A 的 Timeline 或运行状态。
- A 后台完成后侧栏运行状态自动消失。
- 停止操作只命中当前会话的活动 Run。
- 会话切换时立即显示目标会话加载态，不残留上一会话内容。

## 7. 结论和遗留风险

P0 回归矩阵全部通过，没有发现以下已知缺陷：

- 页面显示空闲但 daemon 仍持续运行。
- Run 永久停留在 `running`。
- 跨会话 Timeline 污染。
- SSE 无限高频重连或重复渲染。
- 取消请求命中错误会话。

遗留项：

- Web 主包约 1 MB，代码分割属于 `P1-B10`，不阻塞 P0。
- 长会话历史扫描和 Timeline 大数据性能属于 P1。
- daemon 重启采用确定性失败收敛，而不是恢复底层 Codex 子进程；该行为符合当前 P0 契约。

**最终结论：P0 运行正确性门禁通过。**
