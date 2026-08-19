# 定时任务专属会话发布、迁移与回滚运行手册

## 1. 适用范围

本文用于发布“一个 Schedule 对应一个长期 OpenCreator Thread”的定时任务模型，覆盖：

- 旧 SQLite Schema 向前迁移。
- 旧活动 Schedule 补齐专属任务 Thread。
- 发布前后数据不变量检查。
- 应用代码回滚和新版恢复。
- 真实 Codex、浏览器、性能与 Desktop Host 验收边界。

迁移只增加字段、表和索引，并把旧 `parallel` 策略转换为 `queue`。回滚时不得删除
新增字段、索引、任务 Thread、历史 Run、通知 outbox 或 Codex session。

## 2. 安全约束

1. 必须先停止 Web、daemon 和 Scheduler，再复制 Runtime 数据。
2. 必须备份整个 `.runtime/` 或 `OPENCREATOR_DATA_DIR`，不能只复制 `app.sqlite`。
3. 不得直接在用户唯一数据库上试跑迁移；先使用脱敏副本或仓库内置临时演练。
4. 不得通过删列、删 Thread、合并 Codex session 或修改历史 Run 实现降级。
5. Scheduler 只能在 Schema 迁移、`ensureBindings()` 和旧会话分类完成后启动。
6. 绑定修复失败的 Schedule 会被禁用并清空 `next_run_at`，必须先处理失败记录再放量。

## 3. 发布前自动演练

在仓库根目录运行：

```bash
pnpm release:verify-scheduled-task-upgrade
```

该命令只创建临时 SQLite，不读取 `.runtime/app.sqlite`，并验证：

1. 旧 `schedules`、`threads`、`runs` 和 `schedule_operations` 可以无损迁移。
2. 旧 `parallel` 全部转换为 `queue`。
3. 每条活动 Schedule 只补一个 `schedule_task` Thread。
4. Schedule 和 Thread 的名称、项目、Profile、模型、推理强度和 Sandbox 一致。
5. 两条发布 SQL 不变量通过。
6. 第二次 `ensureBindings()` 不再创建 Thread。
7. 旧代码风格的列清单仍能读取升级后的数据库。
8. 旧孤立 Schedule Run、已删除 Schedule 和历史操作不被删除。
9. 恢复新版代码后再次迁移和修复仍保持幂等。

成功时末行输出：

```text
Scheduled task upgrade and rollback rehearsal passed.
```

需要保留临时数据库排查时可以运行：

```bash
pnpm --filter @opencreator/daemon verify:schedule-upgrade -- --keep
```

## 4. 生产升级

### 4.1 停止与备份

停止当前 Web、daemon 和任何独立 Scheduler 进程。确认没有进程继续写入 SQLite 后执行：

```bash
export OPENCREATOR_DATA_DIR="${OPENCREATOR_DATA_DIR:-$PWD/.runtime}"
export RELEASE_BACKUP="$PWD/backups/runtime-before-schedule-thread-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$(dirname "$RELEASE_BACKUP")"
cp -R "$OPENCREATOR_DATA_DIR" "$RELEASE_BACKUP"
```

记录备份路径、应用提交、Codex CLI 版本和数据库摘要：

```bash
git rev-parse HEAD
codex --version
sqlite3 "$OPENCREATOR_DATA_DIR/app.sqlite" <<'SQL'
SELECT sqlite_version() AS sqlite_version;
PRAGMA user_version;
SELECT COUNT(*) AS schedule_count FROM schedules;
SELECT COUNT(*) AS active_schedule_count
FROM schedules
WHERE deleted_at IS NULL;
SELECT COUNT(*) AS thread_count FROM threads;
SELECT COUNT(*) AS orphan_schedule_run_count
FROM runs
WHERE created_by = 'schedule' AND thread_id IS NULL;
SQL
```

`PRAGMA user_version` 当前可能为 `0`，因此发布记录还必须包含应用提交和 Schema 列清单：

```bash
sqlite3 "$OPENCREATOR_DATA_DIR/app.sqlite" \
  "PRAGMA table_info(schedules); PRAGMA table_info(threads);"
```

### 4.2 启动新版

按部署方式启动新版 daemon 或 `pnpm web:dev`。生产入口会按以下顺序执行：

```text
打开 SQLite
  -> 执行向前 Schema 迁移
  -> ensureBindings()
  -> 分类旧 Schedule session
  -> 注册 API
  -> 启动 Scheduler
```

如果启动日志或 API 显示绑定修复失败，立即停止新版，不要让 Scheduler 继续触发任务。

### 4.3 升级后不变量

活动 Schedule 缺少绑定的数量必须为 `0`：

```sql
SELECT COUNT(*) AS missing_active_bindings
FROM schedules
WHERE deleted_at IS NULL AND thread_id IS NULL;
```

活动 Schedule 重复绑定必须返回空集：

```sql
SELECT thread_id, COUNT(*) AS binding_count
FROM schedules
WHERE deleted_at IS NULL
GROUP BY thread_id
HAVING COUNT(*) > 1;
```

任务配置偏差必须为 `0`：

```sql
SELECT COUNT(*) AS configuration_mismatches
FROM schedules AS schedule
LEFT JOIN threads AS thread ON thread.id = schedule.thread_id
WHERE schedule.deleted_at IS NULL
  AND (
    thread.id IS NULL
    OR thread.purpose <> 'schedule_task'
    OR thread.title IS NOT schedule.name
    OR thread.cwd IS NOT schedule.cwd
    OR thread.canonical_cwd IS NOT schedule.canonical_cwd
    OR thread.profile IS NOT schedule.profile
    OR thread.model IS NOT schedule.model
    OR thread.reasoning IS NOT schedule.reasoning
    OR thread.sandbox IS NOT schedule.sandbox
  );
```

绑定修复失败记录必须为空；若非空，对应 Schedule 应保持禁用：

```sql
SELECT schedule_id, error_code, error_message, created_at
FROM schedule_operations
WHERE operation = 'binding_repair_failed'
ORDER BY created_at DESC;
```

对比升级前后：

- Schedule 总数和已删除 Schedule 数量不得减少。
- 新增任务 Thread 数量应等于需要修复的活动 Schedule 数量。
- 旧孤立 Schedule Run 数量不得减少。
- `parallel` 数量必须为 `0`。
- 再次重启新版后不得新增第二批任务 Thread。

## 5. 灰度检查

至少完成以下检查后再扩大使用：

1. 手动创建任务后立即进入返回的 `threadId`。
2. 同一任务连续立即执行两次，第二次排队或跳过，不并行。
3. 自动执行和用户在任务会话内发送消息都进入同一 Thread。
4. 暂停、恢复、编辑和删除同步更新“已安排”、侧栏“任务”和任务会话头部。
5. 成功、失败和待审批通知都携带正确的 `threadId/runId/approvalId`。
6. 模拟 Codex resume 失败后 OpenCreator Thread 不变，底层 Codex thread 可以轮换。
7. 桌面和移动视口无旧会话残留、横向溢出或控制台新增错误。
8. 受支持的原生 Desktop Host 在页面关闭后仍能消费 outbox 并打开正确深链接。

仓库本身不包含真实原生 Desktop Host。仅完成 outbox、Bridge 契约和 harness 验证时，
必须把第 8 项记录为 `BLOCKED_ENV`，不能写成实机通过。

## 6. 应用代码回滚

### 6.1 回滚步骤

1. 停止新版 Web、daemon 和 Scheduler。
2. 保留升级后的 Runtime 数据，不删除任何新增列、索引、Thread、Run 或 Codex session。
3. 回滚应用代码或部署旧版本。
4. 使用旧版只读取旧列，确认 Schedule、Thread 和 Run 仍可读取。
5. 明确告知用户：旧版本会恢复旧任务行为，不再提供专属任务会话完整闭环。
6. 如果需要恢复新版，停止旧版后重新部署新版并再次执行第 4.3 节不变量。

SQLite 允许旧查询忽略新增列。代码回滚的目标是恢复旧应用，不是把数据库破坏性降级。

### 6.2 何时使用备份恢复

只有在迁移启动前后立即失败、且确认备份后没有任何有效新写入时，才能考虑整目录恢复。
恢复必须同时覆盖 SQLite、WAL/SHM、Run 日志、附件和托管工作区。

如果新版已经产生有效任务 Thread、Run、审批或通知，不得用旧备份覆盖；应保留数据并
通过代码回滚或前向修复处理。

## 7. 发布门禁

```bash
pnpm test
pnpm release:verify-scheduled-task-upgrade
pnpm typecheck
pnpm build
pnpm e2e
OPENCREATOR_PERFORMANCE_RESULTS_REQUIRED=1 pnpm perf:check
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- \
  --pool=forks --maxWorkers=1 \
  test/smoke/real-codex-smoke.test.ts
git diff --check
```

构建警告只有在仍低于仓库固化体积预算时才允许发布。真实 Codex smoke 必须记录实际
Codex 版本和 14 个场景结果。

## 8. 2026-07-15 演练基线

仓库临时数据库演练结果：

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
| 配置偏差 | 不适用 | 0 |
| 剩余 `parallel` | 1 | 0 |

首次绑定修复结果为 `scanned=2, repaired=2, failed=0, unchanged=0`；第二次和代码回滚
兼容读取后的新版恢复均为 `repaired=0, failed=0, unchanged=2`。
