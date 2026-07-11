# Task 4 报告：daemon 市场安装/更新用例和 Fastify API

## 本轮修复

- 恢复 `.superpowers/sdd/task-4-report.md` 提交边界：
  - 修复提交中该文件内容恢复为 base `c09c3c44f5aefddaa44de5032ddb8a7e18fc5935` 版本。
  - 提交后 `git diff --name-only c09c3c44f5aefddaa44de5032ddb8a7e18fc5935..HEAD | rg '^\.superpowers' || true` 无输出。
  - 本报告仅保留在工作区，未暂存、未提交。
- cleanup 纳入安装补偿事务：
  - `SkillManager.installSkill()` 成功后先显式清理本次外层 workDir。
  - cleanup 成功后才写 market record 并返回成功。
  - cleanup 失败会调用 `rollbackSkillInstall(id, operation.backupPath ?? null)`，跳过 record 写入并抛 `CODEX_SKILL_WRITE_FAILED`。
  - cleanup 与 rollback 双失败时抛 `AggregateError`，消息保留两个错误上下文。
  - `finally` 仍对下载、解析、安装前失败做 best-effort cleanup，且不覆盖主错误。
- update TOCTOU 修复：
  - 保留 update 前 `getSkill(id)` 检查。
  - `installSkill(overwrite: true)` 返回后校验 `operation.operation === 'overwrite'`。
  - 若返回 `install`，立即 rollback fresh install，抛 `CODEX_SKILL_NOT_FOUND`，不写 market record。
  - update rollback 失败时用 `AggregateError` 保留语义错误和 rollback 错误。
- 新增 manager 单测覆盖：
  - post-install cleanup 失败会 rollback、不会写 record。
  - cleanup + rollback 双失败保留两个错误。
  - update 预检存在但 install 返回 `install` 时 rollback、不会写 record、抛 `CODEX_SKILL_NOT_FOUND`。
  - update TOCTOU rollback 失败保留两个错误。

## 验证

- RED：
  - `pnpm --filter @clawee/daemon test -- codex-skill-market-manager api`
  - 新增 4 个 manager 用例在旧实现下失败，表现为错误成功返回或未保留错误上下文。
- GREEN：
  - `pnpm --filter @clawee/daemon test -- codex-skill-market-manager api`
  - 通过：`98 passed`。
- 全量：
  - `pnpm --filter @clawee/daemon test`
  - 通过：`38 passed | 1 skipped` test files，`450 passed | 13 skipped` tests。
- 类型：
  - `pnpm --filter @clawee/daemon typecheck`
  - 通过。

## 修改文件

- 提交内：
  - `apps/daemon/src/codex/skills/market-manager.ts`
  - `apps/daemon/test/unit/codex-skill-market-manager.test.ts`
  - `.superpowers/sdd/task-4-report.md` 恢复为 base 内容，用于移出最终 diff。
- 工作区未提交：
  - `.superpowers/sdd/task-4-report.md` 本报告。

## 自检

- 未触碰 apps/web。
- 未暂存或提交 `.superpowers/sdd/task-2-report.md`、`.superpowers/sdd/task-3-report.md`。
- 未修改 Task 3 或现有 `SkillManager` API。
- 未向 HTTP 或 `BuildServerInput` 暴露 cleanup 测试依赖。

## 关注点

- 本报告按审查要求留在工作区未提交，因此 `git status` 会显示 `.superpowers/sdd/task-4-report.md` 修改。
