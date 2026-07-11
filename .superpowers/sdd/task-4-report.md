# Task 4 报告：daemon 市场安装/更新用例和 Fastify API

## 实现

- 新增 `SkillMarketManager`，公开 `installSkill(id)`、`updateSkill(id)`、`listInstallRecords()`。
- 安装/更新共用 `mutateSkill(id, overwrite)`，只读取 `@clawee/skill-market` 固定目录中的 `repository`、`commit`、`skillPath`、`marketRevision`。
- 更新前先检查真实 Skill 是否存在。
- 下载在 `dataDir/skill-market-downloads/` 下创建本次外层临时 workDir，并在 `finally` 中 best-effort 删除。
- 安装写入 `SkillManager.installSkill()` 时传入 `confirmWriteToCodexHome: true`；更新额外传入 `overwrite: true`。
- 安装成功后写入市场安装记录；记录写入失败会调用 `rollbackSkillInstall(id, backupPath)`。
- rollback 失败时抛出 `AggregateError`，错误消息同时包含原始记录写入失败和 rollback 失败上下文。
- 新增 Fastify 路由：
  - `GET /codex/skill-market/install-records`
  - `POST /codex/skill-market/:id/install`
  - `POST /codex/skill-market/:id/update`
- `BuildServerInput.marketArchiveDownloader` 用于测试注入；默认使用现有真实 `MarketArchiveDownloader`。

## RED / GREEN

- RED 命令：
  - `pnpm --filter @clawee/daemon test -- codex-skill-market-manager api`
- RED 结果：
  - `codex-skill-market-manager` suite 因 `market-manager` 文件不存在加载失败。
  - 新增 API 用例返回 404，确认新路由未注册。
- GREEN 结果：
  - 同一命令通过，`94 passed`。

## 测试结果

- `pnpm --filter @clawee/daemon typecheck`
  - 通过。
- `pnpm --filter @clawee/daemon test`
  - 通过：`38 passed | 1 skipped` test files，`446 passed | 13 skipped` tests。

## 修改文件

- `apps/daemon/src/codex/skills/market-manager.ts`
- `apps/daemon/src/api/routes.skill-market.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/unit/codex-skill-market-manager.test.ts`
- `apps/daemon/test/integration/api.test.ts`
- `.superpowers/sdd/task-4-report.md`

## 自检

- 临时目录：成功、记录写入失败、rollback 失败路径均覆盖外层 workDir 清理测试。
- rollback：记录写入失败会 rollback；fresh install 删除目标，update 恢复旧版本。
- 错误映射：覆盖未知 ID 404、不可安装 422、更新目标不存在 404、下载失败 502。
- 测试隔离：API 集成测试只使用 fake downloader；global CODEX_HOME 用临时 `process.env.CODEX_HOME`，不写用户真实 CODEX_HOME。
- 范围控制：未修改 apps/web；未修改 Task 2/3 report；提交只暂存 Task 4 文件。

## 关注点

- Task 3 当前导出真实 `MarketArchiveDownloader` 常量，而 brief 文案提到 `createMarketArchiveDownloader()`；为遵守 Task 4 文件边界，server 默认使用现有真实 downloader 常量。
