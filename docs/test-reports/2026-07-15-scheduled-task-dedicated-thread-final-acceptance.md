# 定时任务专属会话最终验收报告

## 1. 结论

定时任务专属会话重构的仓库内实现、自动化测试、真实 Codex smoke、桌面与移动
Playwright、100 任务性能门禁、旧数据库升级和应用代码回滚兼容演练均通过。

最终状态为 `PARTIAL / BLOCKED_ENV`，不能标记为 `COMPLETE`：

- 24 个实现批次为 `PASS`。
- 最终批次 P2-B7 为 `BLOCKED_ENV`。
- 唯一阻塞是仓库不包含真实原生 Desktop Host，无法实机验证页面关闭后的系统通知展示
  和点击后打开正确 `threadId/runId/approvalId`。
- 持久 outbox、HostBridge 契约、harness 消费器和浏览器通知降级路径已有自动化证据，
  但这些证据不替代原生 Host 实机验收。

## 2. 验收环境

| 项目 | 值 |
|---|---|
| 日期 | 2026-07-15 |
| 操作系统 | Darwin 25.3.0 arm64 |
| Node.js | v24.16.0 |
| pnpm | 9.15.0 |
| Codex CLI | codex-cli 0.144.1 |
| 分支 | `codex-native-runtime-kernel` |
| P2-B7 前提交 | `decd604 perf(tasks): 建立百任务列表性能门禁` |

## 3. 自动化门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | `PASS`：daemon 651 项通过、14 项 gated smoke 跳过；Web 521 项；Skill Market 6 项；harness 3 项 |
| `pnpm release:verify-scheduled-task-upgrade` | `PASS` |
| `pnpm typecheck` | `PASS` |
| `pnpm build` | `PASS` |
| `pnpm e2e` | `PASS`：桌面与移动共 14/14，1.9 分钟 |
| `OPENCREATOR_PERFORMANCE_RESULTS_REQUIRED=1 pnpm perf:check` | `PASS` |
| 真实 Codex smoke | `PASS`：14/14，98.13 秒 |
| `git diff --check` | `PASS` |

全仓首次并行测试发现一个既有 MCP timeout 测试时序抖动：重负载下 fake Codex 进程在
3 秒内尚未写出 stderr。测试夹具改为同步写入 stderr，并把该断言的进程超时放宽到
5 秒；生产 `runMcpCommand()` 和默认 30 秒超时未修改。定向测试和根级并行全量测试均
复验通过。

## 4. 真实 Codex

真实 smoke 使用 `codex-cli 0.144.1`，覆盖：

1. Codex 版本、exec、resume 和 MCP 命令能力。
2. 最小真实模型 Run。
3. 全局与隔离 `$CODEX_HOME` 的 Profile、Skill 和 MCP。
4. 同一 Schedule 连续运行两次，复用同一 OpenCreator Thread 和 Codex thread。
5. ConversationSummary 驱动的 Codex thread 轮换，OpenCreator Thread 保持不变。
6. 命令执行 JSONL 和普通 `codex exec resume` 上下文连续性。

## 5. 升级与回滚演练

演练命令只创建临时 SQLite，不读取或修改用户 `.runtime/app.sqlite`。

| 指标 | 迁移前 | 迁移后 |
|---|---:|---:|
| Schedule 总数 | 3 | 3 |
| 活动 Schedule | 2 | 2 |
| 已删除 Schedule | 1 | 1 |
| Thread 总数 | 1 | 3 |
| `schedule_task` Thread | 0 | 2 |
| 旧孤立 Schedule Run | 1 | 1 |
| 缺失活动绑定 | 不适用 | 0 |
| 重复活动绑定 | 不适用 | 0 |
| Schedule/Thread 配置偏差 | 不适用 | 0 |
| 剩余 `parallel` | 1 | 0 |

首次 `ensureBindings()`：

```text
scanned=2 repaired=2 failed=0 unchanged=0
```

第二次执行和旧代码风格列读取后的新版恢复：

```text
scanned=2 repaired=0 failed=0 unchanged=2
```

旧列清单可以读取升级后的 3 条 Schedule、3 条 Thread 和 1 条旧孤立 Run。演练未删除
新增列、索引、Thread、Run、操作记录或 Codex session。

## 6. 浏览器与功能矩阵

| 场景 | 证据 | 结果 |
|---|---|---|
| Agent 创建任务 | Playwright 真实 daemon/API/SSE + fake Codex app-server 工具调用 | `PASS_AUTOMATED` |
| 手动创建并进入任务会话 | 桌面、移动 Playwright | `PASS` |
| 暂停、恢复、编辑、删除 | 桌面、移动 Playwright | `PASS` |
| 连续立即执行 | 同 Thread queue 合并和结果追加 | `PASS` |
| 同一任务连续运行 | Playwright + 真实 Codex smoke | `PASS` |
| 切换普通会话再返回 | Timeline 不串线 | `PASS` |
| 运行中刷新 | 活动 Run 和 SSE 恢复 | `PASS` |
| 审批 | 通知进入正确任务，批准后同一 Run 继续 | `PASS` |
| 通知深链 | 成功、失败、审批定位 Thread/Run/Approval | `PASS` |
| HTML 文件结果 | 通知打开任务会话并进入安全预览 | `PASS` |
| Codex 上下文轮换 | 真实 Codex + ConversationSummary | `PASS` |
| 旧数据升级 | 临时旧 Schema 迁移和二次幂等 | `PASS` |
| 100 个任务 | 摘要加载、历史懒加载和请求上限 | `PASS` |
| 页面关闭后的原生通知 | 仓库无真实原生 Desktop Host | `BLOCKED_ENV` |

Agent 创建使用真实产品工具链和确定性 fake Codex tool call 验证。自然语言本身由 Codex
模型解释，不作为仓库内确定性断言；真实 Codex smoke 已验证 MCP、Schedule 执行和
上下文连续性。

## 7. 性能结果

| 指标 | 桌面 | 移动 | 阈值 |
|---|---:|---:|---:|
| 首屏 runtime 请求 | 10 | 10 | 12 |
| 刷新 runtime 请求 | 10 | 10 | 12 |
| Thread 列表请求 | 2 | 2 | 2 |
| 选中任务前历史请求 | 0 | 0 | 0 |
| 选中任务后历史请求 | 1 | 1 | 1 |
| DOM 节点峰值 | 3868 | 3868 | 4500 |
| Long Task 数量 | 0 | 0 | 10 |
| 任务打开延迟 | 65ms | 231ms | 1500ms |

构建产物：

| 资源 | 当前值 | 预算 |
|---|---:|---:|
| 主入口 JavaScript | 580680 B / 168587 B gzip | 600000 B / 180000 B |
| FilesPage JavaScript | 569220 B / 200343 B gzip | 600000 B / 220000 B |
| SettingsPage JavaScript | 49250 B / 12693 B gzip | 60000 B / 18000 B |
| 主 CSS | 74862 B / 13551 B gzip | 80000 B / 16000 B |

Vite 仍提示主入口和 FilesPage 超过 500 kB，但两者均低于仓库硬预算。

## 8. 发布决定

仓库内代码可以进入需要原生 Host 之外的发布流程。若目标发行物包含原生 Desktop Host，
发布负责人必须按运行手册补做：

1. 页面关闭后触发计划任务。
2. 系统通知真实展示。
3. 点击成功、失败和审批通知。
4. 应用打开正确任务 Thread，并定位 Run 或审批。
5. Host 完整提交通知后再确认 outbox 游标。

完成并记录上述实机证据后，才能把 P2-B7 改为 `PASS`，并把总体实施状态改为
`COMPLETE`。
