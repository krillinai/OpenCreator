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
