# Task 2 报告：Daemon 文件核心服务

## 状态

DONE_WITH_CONCERNS

## TDD 证据

### RED

先新增 `apps/daemon/test/unit/workspace-files.test.ts`，覆盖 brief 指定的 12 个单测。

由于仓库 `@clawee/daemon` 的 `test` 脚本在 `apps/daemon` 包目录内执行，brief 里的原命令：

```bash
pnpm --filter @clawee/daemon test -- apps/daemon/test/unit/workspace-files.test.ts
```

在当前仓库结构下不会命中测试文件，只会得到 `No test files found`。因此改用当前仓库可命中的等价命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
```

首次 RED 输出摘要：

- suite 失败
- 原因：`../../src/workspace-files/service.js` 不存在
- 关键信息：`Does the file exist?`

这符合 brief 对“先看到实现缺失导致失败”的要求。

### GREEN

实现 `apps/daemon/src/workspace-files/` 下 7 个模块后，再次运行：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
```

GREEN 输出摘要：

- `1 passed`
- `12 passed`
- 所有目标用例通过

## 运行记录

### 单测

执行命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
```

结果摘要：

- 通过
- `workspace-files.test.ts`
- `12 tests passed`

### Typecheck

执行命令：

```bash
pnpm --filter @clawee/daemon typecheck
```

结果摘要：

- 通过
- `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json`

## 修改文件

- `apps/daemon/src/workspace-files/types.ts`
- `apps/daemon/src/workspace-files/errors.ts`
- `apps/daemon/src/workspace-files/mime.ts`
- `apps/daemon/src/workspace-files/paths.ts`
- `apps/daemon/src/workspace-files/tree.ts`
- `apps/daemon/src/workspace-files/reveal.ts`
- `apps/daemon/src/workspace-files/service.ts`
- `apps/daemon/test/unit/workspace-files.test.ts`

## 实现摘要

- 新增 daemon workspace file core service，不注册 API routes。
- `threadId` 统一解析到 `RuntimeThread.canonicalCwd`。
- 所有输入路径都走相对路径校验，拒绝绝对路径、Windows drive path、空字符、`..`、ignored 段。
- 通过 `realpathSync` + root containment 阻止 symlink 逃逸。
- 敏感文件默认不可读不可写，`.env.example` / `.env.sample` 允许按文本处理。
- `.svg` 归类为 `code`，可文本读取，不可作为 blob 读取。
- `saveContent` 只覆盖已存在文件，不创建新文件，要求版本 token 一致。
- `read-only` sandbox 和 archived thread 禁止保存。
- 目录列表只读一层，目录优先，自然排序，超 500 截断并给 warning。
- `reveal` 使用注入 executor，默认 executor 仅在 macOS 下通过 `execFile('open', ...)` 执行。

## 自审

- 已按 brief 做到“只实现 daemon core service，不改 routes / web”。
- 已覆盖 brief 要求的 12 个单测。
- 保存逻辑在写前写后都做 root containment 检查。
- 现实现对普通文件覆盖采用临时文件 + rename；满足“不创建目标新文件”，但会在同目录短暂创建临时文件。
- 未引入 shell 拼接；reveal 默认实现使用 `execFile`。

## 疑虑

1. brief 写到“最终文件节点不得跟随 symlink；在平台支持时使用 `O_NOFOLLOW`”。当前实现对目标文件通过 `realpathSync` 和 `lstatSync` 做了防逃逸检查，但临时文件写入路径本身不是用户输入路径，因此 `O_NOFOLLOW` 只用于临时文件打开，目标覆盖依赖 `rename`。这在现有测试和大多数场景下可工作，但如果后续要进一步收紧 TOCTOU 风险，可能需要平台差异化的更低层写入流程。
2. `readBlob` 当前返回 `Buffer`。brief 没有单独要求响应包装结构，且当前测试未约束这一点；后续接 route 时如果需要 HTTP 元信息，可能要在 route 层补 mime/size/header。
3. 目录节点 `meta` 当前未附加 summary；brief 允许目录节点只携带 `hasChildren`/`childrenLoaded=false`，因此未额外填充。

## Task 2 审查修复追加

### 修复范围

- 补齐敏感文件拦截：新增 `.env.production`、`.env.development`、`.env.test`、`id_ed25519`、`.p12`、`.crt`、`.cert`；继续保留 `.env.example`、`.env.sample` 可读。
- 收紧路径校验：`validateRelativePath` 先检查原始 path segment，再做 normalize，确保 `a/../b`、`node_modules/../README.md` 在归一化前就被拒绝。
- 收紧目录树 symlink 行为：构建目录节点和文件节点前先 `realpath` 并做 root containment；超出 root 的 symlink 节点直接跳过，并写入 warnings，不泄露目标 meta。
- 修复 `saveContent` 并发删除/替换窗口：覆盖前复核目标仍存在、仍是同一 inode/dev 的常规文件；如果目标丢失或被替换，不允许通过 `rename` 落成新文件。
- 调整 archived thread 保存错误码：从 `PERMISSION_DENIED` 改为 `THREAD_ARCHIVED`。
- 扩展基础文本/代码类型识别：补齐 `.jsonc`、`.jsonl`、`.toml`、`.csv`、`.srt`、`.zsh`，并补查 `.markdown`、`.yaml`、`.yml`、`.htm`、`.scss`、`.sass`、`.less`、`.bash`、`.npmrc`、`.prettierrc`、`.eslintrc`。
- 调整 `readBlob` service contract：返回 `{ meta, buffer }`。
- 修复目录列表 meta.readonly：现在会反映 thread 的 sandbox/status。

### 新增测试

在 `apps/daemon/test/unit/workspace-files.test.ts` 追加覆盖：

- `.env.production`、`id_ed25519`、`.crt` 阻止读取。
- `a/../README.md`、`node_modules/../README.md` 在 normalize 前被拒绝。
- 目录树遇到 root 外 symlink 时跳过节点并返回 warning。
- `saveContent` 遇到目标被并发删除后不会新建文件。
- `.jsonc`、`.toml`、`.srt`、`.zsh` 作为文本/代码读取。
- `readBlob` 返回 `meta + buffer`。
- archived thread 保存返回 `THREAD_ARCHIVED`。
- read-only 目录列表 `meta.readonly=true`。

### 本轮验证

执行命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
pnpm --filter @clawee/daemon typecheck
```

结果摘要：

- 单测通过：`20 tests passed`
- Typecheck 通过

## Task 2 复审剩余阻塞修复追加

### 本轮修复

- 收紧敏感文件可见性：`getMeta` 对敏感路径直接返回 `PERMISSION_DENIED`，与 `readContent`/`saveContent`/`readBlob` 保持同口径。
- 收紧目录树构建：敏感文件在 `listDirectory` 中直接跳过，不返回节点、不返回任何 meta；warning 改为泛化的 `Skipped sensitive file.`。
- 收紧 root 外 symlink warning：不再带相对路径，统一为 `Skipped path outside workspace root.`，避免泄露隐藏节点名。
- 修复 `saveContent` 最后一跳 TOCTOU：移除临时文件 `rename` 覆盖，改为在目标文件通过校验后直接以 `O_WRONLY | O_NOFOLLOW` 打开目标 inode，`truncate + write` 覆盖，避免目标删除后通过 `rename` 重新创建新文件。

### 本轮新增测试

- `getMeta({ path: sensitive })` 对 `.env.production`、`id_rsa`、`credentials.json` 拒绝访问。
- 目录树中 `.env.production`、`id_rsa`、`credentials.json` 不出现在 `nodes`，`.env.example` 仍可列出。
- root 外 symlink 的目录树 warning 不带具体路径。
- 目标文件在保存前被删除时，`saveContent` 失败且不会新建目标文件。
- 参数化类型矩阵覆盖设计第 8 章基础文本类型：
  `.md/.markdown/.txt/.log/.srt/.json/.jsonc/.jsonl/.yaml/.yml/.toml/.csv/.xml/.html/.htm/.css/.scss/.sass/.less/.js/.jsx/.mjs/.cjs/.ts/.tsx/.sh/.bash/.zsh/.py/.gitignore/.npmrc/.prettierrc/.eslintrc/.env.example/.env.sample`

### 本轮验证

执行命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
pnpm --filter @clawee/daemon typecheck
```

结果摘要：

- 单测通过：`56 tests passed`
- Typecheck 通过

## Task 2 最终复审最后问题修复追加

### 本轮修复

- 修复 `saveContent` 对工作区内 symlink 的跟随问题：保存时不再使用最终节点的 realpath 作为写入目标，而是保留用户相对路径生成 root 下 `candidatePath`，先校验父目录 `realpath` 仍在 root 内，再对最终候选路径执行 `lstat`，若最终节点是 symlink 直接返回 `PATH_ESCAPE`。
- 保存时改为对 `candidatePath` 直接执行 `openSync(O_WRONLY | O_NOFOLLOW)`，继续只允许已存在常规文件，避免通过已解引用后的真实路径绕过最后一跳 symlink 防护。
- 修复覆写逻辑 partial write 风险：将内容转成 `Buffer`，循环调用 `writeSync`，直到所有字节写完，再做 inode/dev 与 root containment 复核。
- 修复 `listDirectory` 敏感文件 warning 泄露数量：多个敏感文件现在只返回一条目录级 warning，内容为 `Skipped sensitive files.`，且不带任何文件名。

### 本轮新增测试

- `target.md` + `link.md -> target.md` 场景下，对 `link.md` 调用 `saveContent` 必须返回 `PATH_ESCAPE`，并验证 `target.md` 内容保持不变。
- `saveContent` 覆写 256KB 大内容时必须完整写入，最终磁盘内容与返回 meta.size 一致。
- 目录下存在多个敏感文件时，`listDirectory` 只返回一次 `Skipped sensitive files.` warning。

### 本轮验证

执行命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
pnpm --filter @clawee/daemon typecheck
```

结果摘要：

- 单测通过：`58 tests passed`
- Typecheck 通过

## Task 2 最后一个 Important 修复追加

### 本轮修复

- 修复 `readContent` 的敏感文件顺序问题：先判断 `isSensitivePath(relativePath)`，再调用 `buildMeta`，避免对敏感文件先执行 `statSync` / `readFileSync` / `sha256` 计算。
- 复查 `getMeta`、`saveContent`、`readBlob` 的顺序后未发现同类问题：它们都在 `buildMeta` 之前完成了敏感路径拦截。

### 本轮新增测试

- 新增 `rejects sensitive readContent before file reads or hash computation`，覆盖 `.env` 的敏感路径拒绝。
- 测试保持对 `.env`、`.env.production`、`id_ed25519`、`.crt` 的直接拒绝断言。

### 本轮验证

执行命令：

```bash
pnpm --filter @clawee/daemon test -- test/unit/workspace-files.test.ts
pnpm --filter @clawee/daemon typecheck
```

结果摘要：

- 单测通过：`59 tests passed`
- Typecheck 通过
