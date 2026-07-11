# Task 2 实现报告

## 实现内容

- 在 `packages/protocol/src/api.ts` 增加：
  - `CodexSkillMarketInstallRecordResponse`
  - `CodexSkillMarketInstallRecordListResponse`
  - `CodexSkillMarketMutationResponse`
- 在 `packages/protocol/src/errors.ts` 增加错误码：
  - `CODEX_SKILL_MARKET_ENTRY_NOT_FOUND`
  - `CODEX_SKILL_MARKET_NOT_INSTALLABLE`
  - `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`
- 在 `apps/daemon/src/storage/migrations.ts` 增加 SQLite 表 `codex_skill_market_installs` 和索引 `idx_codex_skill_market_installs_updated_at`
- 新建 `apps/daemon/src/codex/skills/market-records.ts`，实现 `SkillMarketRecordRepository`
  - `upsertRecord()`
  - `getRecord()`
  - `listRecords()`
- 测试覆盖：
  - `apps/daemon/test/unit/protocol-shape.test.ts`
  - `apps/daemon/test/unit/storage.test.ts`
  - `apps/daemon/test/unit/codex-skill-market-records.test.ts`

## RED

命令：

```bash
pnpm --filter @clawee/daemon test -- codex-skill-market-records storage protocol-shape
```

关键输出：

```text
FAIL test/unit/codex-skill-market-records.test.ts
Error: Failed to load ... market-records.js. Does the file exist?

FAIL test/unit/storage.test.ts > runtime storage > creates codex skill market install table and updated-at index
AssertionError: expected [] to deeply equal [{ name: 'codex_skill_market_installs' }]
```

结论：

- repository 文件不存在
- migration 尚未创建市场安装记录表和索引

## GREEN

命令：

```bash
pnpm --filter @clawee/protocol test
pnpm --filter @clawee/daemon test -- codex-skill-market-records storage protocol-shape
pnpm --filter @clawee/protocol typecheck
pnpm --filter @clawee/daemon typecheck
```

关键输出：

```text
@clawee/protocol test: No test files found, exiting with code 0

@clawee/daemon test:
Test Files  3 passed (3)
Tests  29 passed (29)

@clawee/protocol typecheck:
tsc -p tsconfig.json --noEmit

@clawee/daemon typecheck:
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
```

## 测试结果

- 协议 shape 测试通过
- 存储 schema 测试通过
- 市场安装记录 repository 测试通过
- protocol / daemon typecheck 通过

## 修改文件

- `packages/protocol/src/api.ts`
- `packages/protocol/src/errors.ts`
- `apps/daemon/src/storage/migrations.ts`
- `apps/daemon/src/codex/skills/market-records.ts`
- `apps/daemon/test/unit/codex-skill-market-records.test.ts`
- `apps/daemon/test/unit/storage.test.ts`
- `apps/daemon/test/unit/protocol-shape.test.ts`

## 自检

- 只修改了简报要求的代码文件，未触碰 `apps/web` 用户未提交修改
- `upsertRecord()` 使用简报指定 SQL，冲突更新时不覆盖 `installed_at`
- 测试中通过手动将 `updated_at` 改成固定旧值，再执行二次 upsert，可靠证明 `updatedAt` 被刷新，不依赖 SQLite 同秒时间戳自然变化
- `listRecords()` 按 `updated_at DESC, skill_id ASC` 返回，和索引设计一致
- 报告文件位于 `.superpowers`，但不会加入提交

## 关注点

- 初版曾直接返回 SQLite 时间字符串；审查后已在 repository 协议映射边界统一为 UTC ISO 8601，当前无遗留时间格式问题。

## 审查修复追加

### 修复内容

- 在 `apps/daemon/src/codex/skills/market-records.ts` 增加 repository 私有的 SQLite UTC 时间解析函数，只接受 `YYYY-MM-DD HH:MM:SS`
- 在映射 `CodexSkillMarketInstallRecordResponse` 时，把 `installed_at` / `updated_at` 统一转换为 UTC ISO 8601，例如 `2026-07-11T00:00:00.000Z`
- 对异常时间值显式抛错，避免返回 `Invalid Date` 字符串
- 保持 migration 默认值和简报要求的 upsert SQL 不变

### 覆盖测试

- 新增断言：首次 `upsertRecord()` 返回的 `installedAt` / `updatedAt` 必须匹配 ISO 8601 UTC
- 更新冲突测试：手动把 `installed_at` 固定为 `2026-07-11 00:00:00`，确认二次 upsert 后仍保留为 `2026-07-11T00:00:00.000Z`
- 继续验证 `updatedAt` 在二次 upsert 后刷新，且输出为 ISO 8601 UTC
- `listRecords()` 现在同时断言排序和返回时间的 ISO 8601 转换结果
- 新增异常路径测试：数据库中时间值非法时，repository 抛出明确错误

### 命令

```bash
pnpm --filter @clawee/daemon test -- codex-skill-market-records
pnpm --filter @clawee/daemon typecheck
```

### 关键输出

```text
@clawee/daemon test -- codex-skill-market-records:
Test Files  1 passed (1)
Tests  4 passed (4)

@clawee/daemon typecheck:
tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json
```
