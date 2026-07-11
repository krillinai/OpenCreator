# Task 3 报告：标准 YAML frontmatter、安装补偿回滚和安全 GitHub tar.gz 下载

## 实现内容

- `parseSkillMarkdown()` 改为使用 `yaml` 的 `parseDocument()` 解析首个 `---` frontmatter：
  - 先规范化 CRLF。
  - YAML parse errors 转为 diagnostics。
  - `name` 和 `description` 必须是非空字符串。
  - 合法扩展字段会被忽略，不再限制 `allowed-tools`、collections、metadata 等字段。
- `SkillInstaller` 新增 `rollback({ id, backupPath })`：
  - 与 install/delete 共用同一个 `withSkillsLock()`。
  - 先删除当前目标。
  - `backupPath === null` 时结束，用于撤销首次安装。
  - 有 backup 时先复制到 `.tmp-rollback-*`，再 `renameSync()` 到目标。
  - 失败统一抛出 `CODEX_SKILL_WRITE_FAILED`，保留 `cause`。
- `SkillManager` 新增 `rollbackSkillInstall(id, backupPath)` 并委托 installer rollback。
- 新增 `market-downloader.ts`：
  - `MarketArchiveDownloader.download({ repository, commit, workDir })`。
  - URL 固定为 `https://codeload.github.com/${repository}/tar.gz/${commit}`。
  - 流式写入 `archive.tar.gz`，按累计字节执行 `100 * 1024 * 1024` 上限。
  - 解压前用 `tar.t()` 完整扫描 entry。
  - 拒绝绝对路径、任意 `..` path segment、symlink、hard link。
  - 解压使用 `tar.x({ strip: 1, preservePaths: false })`，并额外按 strip 后路径校验目标仍在 `workDir` 内。
  - 网络、流、tar、归档校验错误统一包装为 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`，保留 `cause`。
  - `resolveMarketSkillSource(root, skillPath)` 使用分隔符边界校验，并拒绝 symlink root/target，确认目标是真实目录。
- 通过 `pnpm add --filter @clawee/daemon yaml@^2.8.1 tar@^7.4.3` 和 `pnpm add --filter @clawee/daemon '@clawee/skill-market@workspace:*'` 更新 daemon 依赖与 lockfile。

## RED 证据

先写失败测试后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skills-validator codex-skills-installer codex-skill-market-downloader
```

失败结果：

- `codex-skills-validator`：块文本 YAML frontmatter 测试失败，返回 `ok: false`。
- `codex-skills-installer`：`installer.rollback is not a function`。
- `codex-skill-market-downloader`：`market-downloader.js` 模块不存在。

## GREEN 证据

实现后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skills-validator codex-skills-installer codex-skill-market-downloader
pnpm --filter @clawee/daemon typecheck
```

通过结果：

- focused tests：3 个测试文件通过，19 个测试通过。
- daemon typecheck：`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json` 通过。

## 修改文件

- `apps/daemon/package.json`
- `pnpm-lock.yaml`
- `apps/daemon/src/codex/skills/validator.ts`
- `apps/daemon/src/codex/skills/installer.ts`
- `apps/daemon/src/codex/skills/manager.ts`
- `apps/daemon/src/codex/skills/market-downloader.ts`
- `apps/daemon/test/unit/codex-skills-validator.test.ts`
- `apps/daemon/test/unit/codex-skills-installer.test.ts`
- `apps/daemon/test/unit/codex-skill-market-downloader.test.ts`

## 安全自检

- 未使用或创建 git worktree。
- 未触碰、暂存或回退 `apps/web` 下用户未提交修改。
- 未触碰、暂存或回退 `.superpowers/sdd/task-2-report.md`。
- downloader 不执行下载仓库中的脚本或依赖安装。
- downloader 对响应体使用流式写入并累计大小；不是先完整读入内存。
- `content-length` 超过 100 MiB 会提前拒绝；流式读取超过 100 MiB 也会拒绝。
- 解压前扫描所有 tar entry；非法 entry 不会进入解压阶段。
- entry 规则已覆盖绝对路径、`..`、hard link、symlink。
- 解压阶段除 tar 默认安全选项外，还显式计算 strip 后输出路径并限制在 `workDir` 内。
- `resolveMarketSkillSource()` 使用 `resolve()`、分隔符前缀边界和 `realpathSync()` 后边界校验，避免不带分隔符的 `startsWith` 漏洞。
- rollback 与 install/delete 共用同一个 skills lock；恢复 backup 时先复制临时目录再原子 rename。
- rollback/downloader 临时文件在失败路径中清理：rollback 清理 `.tmp-rollback-*`，downloader finally 删除 `archive.tar.gz`。
- 错误包装保留原始 `cause`。

## 关注点

- `@clawee/skill-market` 通过 pnpm 添加时曾被本地 pnpm 记录为 `workspace:^`，已按 brief 和 daemon 现有约定调整为 `workspace:*`。
- 本任务只新增安全下载与 rollback 基础能力；市场安装端到端控制器接线不在 Task 3 brief 范围内。

## 安全复审修复追加

### 修复内容

- downloader 改为每次在 `workDir` 下创建 `.market-download-*` 私有子目录，并 `chmod 0700`；归档和解压都在该私有目录中执行，`download()` 返回该私有解压根目录。
- `archive.tar.gz` 只写入本次私有目录；finally 只删除本次创建的 archive，不再触碰调用方 `workDir/archive.tar.gz`。
- tar entry 扫描和解压共用 `canonicalizeArchiveEntry()`：
  - 同时拒绝 POSIX absolute、Windows absolute、drive/UNC/drive-relative 形式。
  - 按 `/` 与 `\` 切 segment，任何 `..` segment 都拒绝。
  - hard link、symlink 拒绝。
  - `strip: 1` 后无输出路径的普通文件拒绝；正常仓库顶层目录允许跳过。
- `tar.t()` 完成后、`tar.x()` 开始前记录并校验 archive 的 `dev/ino/size/mtimeMs`，归档被替换或改写会拒绝并包装为 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`。
- fetch 使用 `AbortController.signal`。
- `content-length` 提前超限会 cancel body 并 abort；流式读取实际超限会 cancel reader 并在失败路径 abort；cancel/abort 次级异常不会覆盖主错误。
- rollback 在 `backupPath !== null` 时先验证 backup 存在、不是 symlink、是目录且内部无 symlink，再复制到 `.tmp-rollback-*`；复制完整后才删除当前目标并 rename。
- rollback 应用阶段会先快照当前目标；rename 失败时尽力恢复当前目标，否则保留临时副本并在错误消息中给出路径。
- `backupPath === null` 仍只删除当前目标。

### RED 证据

追加失败测试后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skills-installer codex-skill-market-downloader
```

失败结果：

- rollback backup 缺失、backup 含 symlink 时当前 skill 被删除，测试读取当前 `SKILL.md` 失败。
- `workDir/archive.tar.gz` 已存在时 downloader 写固定路径失败并会触发清理风险。
- content-length 超限和流式超限未触发 cancel/abort 断言。
- Windows drive、UNC、strip 后空输出路径未拒绝。
- scan 后归档被替换未拒绝。

### GREEN 证据

修复后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skills-installer codex-skill-market-downloader
pnpm --filter @clawee/daemon typecheck
```

关键输出：

- `test/unit/codex-skills-installer.test.ts`：7 tests passed。
- `test/unit/codex-skill-market-downloader.test.ts`：17 tests passed。
- focused tests 总计：2 files passed，24 tests passed。
- daemon typecheck：`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json` 通过。

### 修改文件

- `apps/daemon/src/codex/skills/installer.ts`
- `apps/daemon/src/codex/skills/market-downloader.ts`
- `apps/daemon/test/unit/codex-skills-installer.test.ts`
- `apps/daemon/test/unit/codex-skill-market-downloader.test.ts`

### 关注点

- `.superpowers/sdd/task-3-report.md` 按要求追加报告，但不纳入代码提交范围。
- 既有 `.superpowers/sdd/task-2-report.md` 和 `apps/web` 未提交改动未触碰、未暂存。

## 第二轮安全复审修复追加

### 修复内容

- downloader 增加 `succeeded` 状态跟踪：
  - 任何下载、写入、scan、extract、validation 失败都会删除本次 `.market-download-*` 私有目录。
  - 成功时才保留私有解压根目录并返回。
  - `archive.tar.gz` 始终在 finally 中清理。
- archive 下载写入改为 `pipeline(limitArchiveBytes(body), createWriteStream(...))`：
  - 写流从创建进入 pipeline 开始就被观察 error。
  - 仍保留 content-length 提前上限和实际流式字节上限。
  - 实际流超限和写入失败路径仍 cancel reader/body 并 abort controller，次级异常不覆盖主错误。
- scan/extract 改为同一个已打开只读 archive fd：
  - 下载完成后 `openSync(archivePath, 'r')`。
  - `tar.t()` 和 `tar.x()` 都使用 `createReadStream(archivePath, { fd, start: 0, autoClose: false })` 的 stream parser 形式。
  - fd 在统一 finally 中关闭；路径在 scan 后被替换不会改变 extract 读取的原 inode。
  - 仍用 `fstatSync(fd)` 做同 fd 身份检查。
- rollback 应用阶段改为 rename 交换式：
  - prepared backup temp 完整准备后，如果当前 target 存在，先 `renameSync(targetPath, currentTempPath)`。
  - 再 `renameSync(tempPath, targetPath)`。
  - 第二步失败时尝试把 `currentTempPath` rename 回 target。
  - 恢复失败时保留 prepared backup/current snapshot，并在 `CODEX_SKILL_WRITE_FAILED` 消息中给出路径。
  - `backupPath === null` 首次安装回滚仍只删除当前目标。

### RED 证据

补测试后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skills-installer codex-skill-market-downloader
```

失败结果：

- scan failure 后 `.market-download-*` 私有目录残留。
- extract failure 未走失败清理路径。
- async write stream failure 后私有目录残留。
- scan 后替换 archive 路径时，旧实现按路径 identity 拒绝，未证明 extract 使用同一 fd。
- rollback 第二阶段 rename 失败时旧 target 未恢复。

### GREEN 证据

修复后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skills-installer codex-skill-market-downloader
pnpm --filter @clawee/daemon typecheck
```

关键输出：

- `test/unit/codex-skills-installer.test.ts`：8 tests passed。
- `test/unit/codex-skill-market-downloader.test.ts`：20 tests passed。
- focused tests 总计：2 files passed，28 tests passed。
- daemon typecheck：`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json` 通过。

### 修改文件

- `apps/daemon/src/codex/skills/installer.ts`
- `apps/daemon/src/codex/skills/market-downloader.ts`
- `apps/daemon/test/unit/codex-skills-installer.test.ts`
- `apps/daemon/test/unit/codex-skill-market-downloader.test.ts`

### 关注点

- 本轮提交仍只暂存 Task 3 源/测文件；报告追加留在工作区未提交。
- 既有 `.superpowers/sdd/task-2-report.md` 和 `apps/web` 未提交改动未触碰、未暂存。

## 第三轮安全复审修复追加

### 修复内容

- archive 下载完成后，先 `openSync(archivePath, 'r')` 获取只读 fd，随后立即 `rmSync(archivePath)` 删除路径，再执行 scan/extract。
- scan/extract 全程只通过已打开 fd 的 `createReadStream(..., { fd, start: 0, autoClose: false })` 读取；scan 钩子中重建同名恶意 archive 不会影响 extract 读取的旧 inode。
- archive 路径 unlink 失败会进入统一失败路径，包装为 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`，不会继续暴露可写 archive 路径。
- 下载私有目录创建与 chmod 纳入 `try/finally`：
  - `mkdtemp` 后 chmod 失败也会包装为 market download failed。
  - 失败时尽力清理部分创建的 `.market-download-*` 目录。
- 新增 `cleanupPrivateDownloadRoot()`：
  - 递归遍历本次私有目录。
  - 对真实目录 chmod `0700`，普通文件 chmod `0600`。
  - 使用 `lstatSync()`，不跟随 symlink。
  - 再 `rmSync(..., { recursive: true, force: true })`。
- cleanup 失败不会覆盖原始下载/校验错误；最终仍抛 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED`，message 包含残留 `.market-download-*` 路径，cause 使用 `AggregateError` 保留原始失败和 cleanup 失败。

### RED 证据

补测试后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skill-market-downloader codex-skills-installer
```

失败结果：

- 只读目录/文件导致 cleanup 原生 `rmSync` 失败并覆盖主错误。
- 模拟 cleanup 失败时抛出原生 `cleanup denied`，未保留 `CODEX_SKILL_MARKET_DOWNLOAD_FAILED` 和残留路径。
- 私有目录 chmod 失败时抛出原生 `chmod denied`，未包装、未清理部分目录。

### GREEN 证据

修复后运行：

```bash
pnpm --filter @clawee/daemon test -- codex-skill-market-downloader codex-skills-installer
pnpm --filter @clawee/daemon typecheck
```

关键输出：

- `test/unit/codex-skills-installer.test.ts`：8 tests passed。
- `test/unit/codex-skill-market-downloader.test.ts`：23 tests passed。
- focused tests 总计：2 files passed，31 tests passed。
- daemon typecheck：`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json` 通过。

### 修改文件

- `apps/daemon/src/codex/skills/market-downloader.ts`
- `apps/daemon/test/unit/codex-skill-market-downloader.test.ts`

### 关注点

- 本轮提交只暂存 downloader 源文件和 downloader 单测；报告追加留在工作区未提交。
- 既有 `.superpowers/sdd/task-2-report.md` 和 `apps/web` 未提交改动未触碰、未暂存。
