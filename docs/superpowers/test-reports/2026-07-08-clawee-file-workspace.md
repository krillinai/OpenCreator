# Clawee 文件工作区测试报告

测试日期：2026-07-08

## 自动化测试

### 定向测试与类型检查

- `pnpm --filter @clawee/protocol typecheck`: PASS
- `pnpm --filter @clawee/daemon test -- apps/daemon/test/unit/protocol-shape.test.ts apps/daemon/test/unit/workspace-files.test.ts apps/daemon/test/integration/api.test.ts`: PASS（命令退出 0，但 `apps/...` filter 未命中，Vitest 输出 `No test files found`）
- `pnpm --filter @clawee/web test -- apps/web/src/services/workspace-file-service.test.ts apps/web/src/features/files/file-view-state.test.ts apps/web/src/features/files/ProjectFileTree.test.tsx apps/web/src/features/files/FileEditorPane.test.tsx apps/web/src/features/files/FileWorkspaceView.test.tsx apps/web/src/app/app-state.test.ts apps/web/src/app/App.test.tsx`: PASS（命令退出 0，但 `apps/...` filter 未命中，Vitest 输出 `No test files found`）
- `pnpm --filter @clawee/daemon test -- test/unit/protocol-shape.test.ts test/unit/workspace-files.test.ts test/integration/api.test.ts`: PASS
- `pnpm --filter @clawee/web test -- src/services/workspace-file-service.test.ts src/features/files/file-view-state.test.ts src/features/files/ProjectFileTree.test.tsx src/features/files/FileEditorPane.test.tsx src/features/files/FileWorkspaceView.test.tsx src/app/app-state.test.ts src/app/App.test.tsx`: PASS
- `pnpm --filter @clawee/daemon typecheck`: PASS
- `pnpm --filter @clawee/web typecheck`: PASS

### 全仓检查

- `pnpm typecheck`: PASS
- `pnpm test`: FAIL

`pnpm test` 的真实失败原因：

- `apps/web` 全量 Vitest 在 `src/features/files/FileEditorPane.test.tsx` 运行期间出现 1 个未处理异常。
- 异常内容：`TypeError: textRange(...).getClientRects is not a function`
- 相关栈来自 `@codemirror/view` 在 `jsdom` 环境中的测量逻辑。
- Vitest 汇总结果为 `34 passed, 201 passed, 1 error`，并以退出码 1 结束。
- 因此全仓测试不能记为 PASS。

## 真实功能验证

### 已执行

- 真实目录树显示 repo 根目录：PASS
  - 通过 `GET /workspace/files/directory` 验证 `rootName=clawee-agent`，`rootPathLabel=/Users/wulien/develop/clawee/clawee-agent`
  - 浏览器页面进入文件工作区后，`.file-workspace-view`、`.file-tree-panel`、`.file-editor-pane` 均已挂载

- Markdown 文件读取：PASS
  - 读取 `docs/superpowers/specs/2026-07-08-clawee-codex-like-file-workspace-design.md`
  - 返回 `kind=markdown`、`previewable=true`、`editable=true`

- 文本文件编辑并保存到真实磁盘：PASS
  - 使用写权限 thread 调用 `POST /workspace/files/content`
  - 实际把 `.tmp/task9-fixtures/note.txt` 保存为 `hello task9`
  - 保存后再次读取内容与磁盘文件一致

- 图片预览接口：PASS
  - `GET /workspace/files/blob?...tiny.png` 返回 `200 OK`
  - `Content-Type: image/png`

- PDF 元信息：PASS
  - `GET /workspace/files/meta?...test.pdf` 返回 `kind=pdf`、`previewable=true`

- 不可预览文件状态：PASS
  - `test.db` 返回 `kind=binary`、`previewable=false`、`reason=File type is not supported.`
  - `test.zip` 返回 `kind=binary`、`previewable=false`、`reason=File type is not supported.`

- 只读权限 UI 提示：PASS
  - 浏览器中打开只读 thread 后出现“当前会话为只读模式，不能保存文件”
  - 页面上的“保存”按钮为禁用态

- 只读权限后端拦截：PASS
  - 只读 thread 保存返回 `403 Forbidden`
  - 错误码：`PERMISSION_DENIED`

- blob 无 Authorization：PASS
  - 直接请求 `/workspace/files/blob` 未带 `Authorization`
  - 返回 `401 Unauthorized`

- 路径逃逸拦截：PASS
  - 请求 `path=../README.md`
  - 返回 `400 PATH_INVALID`

- symlink 逃逸拦截：PASS
  - 请求 workspace 内指向外部文件的 symlink
  - 返回 `403 PATH_ESCAPE`

- `.env` 敏感文件拦截：PASS
  - 请求 `.tmp/task9-fixtures/.env`
  - 返回 `403 PERMISSION_DENIED`

### 未执行

- Markdown 编辑/预览切换的浏览器内交互：NOT RUN
  - 已通过真实 API 验证 Markdown 内容与 meta，但本轮未在浏览器里完成编辑/预览切换操作录制

- 图片在浏览器中的实际可视预览：NOT RUN
  - 已验证 blob 接口成功返回 `image/png`，未进一步在页面内完成图片节点可见性断言

- PDF 在浏览器中的实际嵌入预览或明确失败态：NOT RUN
  - 已验证 PDF meta 为可预览，未在浏览器内完成 `<object>` 渲染态断言

- 不可预览文件“打开所在目录”交互：NOT RUN
  - 接口和组件代码路径已读，但未对系统 reveal 行为做实际点击验证，避免触发本机文件管理器副作用

- 直接在浏览器里展开 `docs/superpowers/specs` 并打开目标设计文档：NOT RUN
  - 已通过真实 API 读取该文件，未在页面树控件中逐层点击到该节点

## 结论

- 文件工作区核心后端能力、路径安全、真实目录根、保存链路、只读拦截均已获得真实验证。
- Task 9 brief 中“目标测试集”总体通过，但“全仓检查”未全部通过，因为 `pnpm test` 真实失败。
- 当前验收结论不能写成全绿；应以“定向验收通过，仓库全量测试仍有 1 个未处理异常待修复”作为真实状态。

## 遗留风险

- `pnpm test` 仍被 `apps/web` 的 CodeMirror/jsdom 未处理异常阻塞，影响全仓测试收口。
- 第一版未覆盖新建、删除、重命名、上传和全局搜索。
- 第一版文件树搜索只覆盖已加载节点。
- 本轮未对 reveal 系统打开动作做真实点击验证。
