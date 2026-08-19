# 100 个已安排任务性能基线

## 结论

固定创建 100 个 Schedule 及其专属 Thread 后，桌面和移动视口均满足以下约束：

- 首屏和刷新只进行 2 次有界 Thread 摘要查询，不预加载任何任务历史。
- 已安排页面只有固定数量的 Schedule 请求，搜索页面只有 1 次搜索请求。
- 点击一个任务后，只请求该任务 Thread 的 1 页历史和运行摘要。
- 100 个任务全部可进入，不再因 Thread 列表 `limit=50` 被误标为“需修复”。
- DOM、长任务和任务切换延迟均低于门禁阈值。

## 场景

- 数据：100 个启用的 Schedule，每个 Schedule 绑定一个 `schedule_task` Thread。
- 桌面视口：`1440x900`。
- 移动视口：`390x844`。
- 运行方式：隔离 SQLite、Codex Home、临时工作目录和 fake Codex。
- 采样：Playwright 请求事件、DOM 节点数、Long Tasks API、任务点击到标题可见延迟。

普通会话仍可按当前选中状态加载自身历史；门禁关注的是任务列表不得预加载 100 个
任务 Thread 的历史正文。

## 结果

| 指标 | 阈值 | 桌面 | 移动 |
|---|---:|---:|---:|
| 首屏 runtime 请求 | `<= 12` | 11 | 10 |
| 刷新 runtime 请求 | `<= 12` | 10 | 10 |
| 每次加载 Thread 列表请求 | `<= 2` | 2 | 2 |
| 已安排页面请求 | `<= 3` | 2 | 2 |
| 搜索页面请求 | `<= 2` | 1 | 1 |
| 选中任务前的任务历史请求 | `0` | 0 | 0 |
| 选中任务后的任务历史请求 | `<= 1` | 1 | 1 |
| DOM 节点峰值 | `<= 4500` | 3868 | 3868 |
| Long Task 数量 | `<= 10` | 0 | 0 |
| 单次 Long Task | `<= 500ms` | 0ms | 0ms |
| Long Task 累计 | `<= 1500ms` | 0ms | 0ms |
| 任务打开延迟 | `<= 1500ms` | 71ms | 249ms |

机器负载会影响延迟和 Long Task 数值，因此阈值保留 CI 调度余量；请求数和历史加载数量
属于确定性约束，不留额外 N+1 余量。

## 自动化

```bash
pnpm perf:measure
pnpm --filter @opencreator/web build
pnpm perf:check
```

`perf:measure` 生成 `test-results/performance/*.json`。`perf:check` 始终校验提交的基线，
存在本次测量文件时同时校验本次结果；CI 要求桌面和移动结果都存在。

结构化阈值和原始基线位于
`docs/performance/2026-07-15-scheduled-task-100-baseline.json`。

为保持既有构建预算，任务会话工具栏及其已安排页面样式改为按需加载。最终主入口
JavaScript 为 580,509 字节，主样式为 74,862 字节，均回到原有预算以内。
