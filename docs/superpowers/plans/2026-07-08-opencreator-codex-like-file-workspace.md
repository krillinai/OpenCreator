# OpenCreator Codex-like 文件工作区实施计划

> **面向 agent 工作者：** 实施本计划时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并按任务逐项执行。所有步骤使用 checkbox（`- [ ]`）追踪状态。

**目标：** 实现 OpenCreator 第一版真实本机文件工作区：基于当前会话 `threadId -> RuntimeThread.canonicalCwd` 读取真实目录和文件，提供 Codex-like 主工作区、目录树、文本预览编辑保存、图片/PDF 预览、不可预览状态、冲突检测和安全 reveal。

**架构：** daemon 是唯一可信文件系统访问层，负责 thread 根目录解析、路径安全、权限校验、文件分类、读写和 reveal；web 只通过 runtime API 访问文件，不直接碰本机文件系统。前端把文件功能做成 `activeView: 'files'` 主工作区，生产路径不再依赖 IndexedDB mock 文件服务。

**技术栈：** TypeScript、Fastify、Vitest、React 18、Vite、Testing Library、CodeMirror 6、lucide-react、pnpm。

## 全局约束

- 文件根入口只能使用 `threadId`，不能使用 `projectId`。
- 文件根从 daemon 内部 `RuntimeThread.canonicalCwd` 解析，前端不能传绝对根目录。
- 文件 API 只接受相对路径；拒绝绝对路径、Windows drive path、空字符、`..`、ignored 目录和 symlink 逃逸。
- 文件写权限唯一真相源是 thread 的 `SandboxMode`。
- `read-only` 和 archived thread 只能预览允许读取的文件，保存必须被后端拒绝。
- `danger-full-access` 只影响 Codex run；文件面板第一版仍只能访问当前 thread `cwd` 内路径。
- 第一版不做新建、删除、重命名、上传、拖拽导入、版本历史、全局文件搜索或任意目录选择。
- 保存端点使用 `POST /workspace/files/content`，不能使用 `PUT`。
- 保存只允许覆盖已存在的可编辑文本文件，不允许通过保存接口创建新文件。
- 目录树采用懒加载：`GET /workspace/files/directory?threadId=...&path=...` 每次只返回一层，单目录最多 500 个子节点。
- `versionToken` 使用 `mtimeMs + size + sha256(content)`；文本文件最大 2 MB，hash 成本可控。
- blob 预览必须由 runtime client 带 Bearer `fetch`，再转 `URL.createObjectURL`；不能把 authenticated URL 直接塞给 `<img src>` 或 `<object data>`。
- SVG 第一版按文本源码查看和编辑，不作为图片执行预览。
- HTML 第一版只做源码查看和编辑，不运行 iframe live preview。
- reveal 第一版只保证 daemon 与浏览器同机的 macOS 场景；其他平台返回 `REVEAL_UNAVAILABLE` 或只提供复制路径。
- reveal 必须使用 `execFile` 和数组参数，禁止 shell 字符串插值。
- UI 不保留无功能按钮；如果 quick open、多 tab、新建文件、布局切换没有实现，就不显示对应控件。

---

## 文件结构

### 协议层

- 修改 `packages/protocol/src/errors.ts`
  - 扩展 workspace file 错误码到 `RuntimeErrorCode`。
- 修改 `packages/protocol/src/api.ts`
  - 新增 workspace file 请求/响应类型。
- 修改 `apps/daemon/test/unit/protocol-shape.test.ts`
  - 增加协议类型和错误码闭合集合测试。

### Daemon

- 修改 `apps/daemon/src/api/errors.ts`
  - `apiError(code, message, details?)` 支持可选 details。
- 创建 `apps/daemon/src/workspace-files/types.ts`
  - 内部服务接口、常量、executor 类型。
- 创建 `apps/daemon/src/workspace-files/errors.ts`
  - `WorkspaceFileError`、错误构造和 HTTP status 映射。
- 创建 `apps/daemon/src/workspace-files/mime.ts`
  - 后端文件分类、MIME、previewable/editable/sensitive 判断。
- 创建 `apps/daemon/src/workspace-files/paths.ts`
  - 相对路径验证、安全 realpath、ignored 目录、regular file 校验。
- 创建 `apps/daemon/src/workspace-files/tree.ts`
  - 一层目录扫描、排序、截断、warning。
- 创建 `apps/daemon/src/workspace-files/reveal.ts`
  - macOS `open` executor，其他平台返回 unavailable。
- 创建 `apps/daemon/src/workspace-files/service.ts`
  - `createWorkspaceFileService` 主服务。
- 创建 `apps/daemon/src/api/routes.workspace-files.ts`
  - 注册 directory/meta/content/blob/reveal routes。
- 修改 `apps/daemon/src/api/server.ts`
  - 创建服务并注册 routes。
- 创建 `apps/daemon/test/unit/workspace-files.test.ts`
  - 覆盖路径安全、分类、读写、冲突、权限。
- 修改 `apps/daemon/test/integration/api.test.ts`
  - 覆盖真实 API、auth、CORS、blob、错误结构。

### Web 服务和状态

- 修改 `apps/web/src/runtime/client.ts`
  - 增加 `rawGet`/`rawRequest`，支持 blob fetch 保留 Authorization。
- 创建 `apps/web/src/services/workspace-file-service.ts`
  - runtime 文件服务封装和 objectURL 生命周期。
- 创建 `apps/web/src/services/workspace-file-service.test.ts`
  - 覆盖 endpoints、POST 保存、auth blob fetch、revoke。
- 修改 `apps/web/src/app/app-state.ts`
  - 新增 `activeView: 'files'` 和文件工作区 action。
- 修改 `apps/web/src/app/app-state.test.ts`
  - 覆盖文件视图状态转换。
- 创建 `apps/web/src/features/files/file-view-state.ts`
  - workspace key、最近文件选择、树节点合并、dirty 判断等纯函数。
- 创建 `apps/web/src/features/files/file-view-state.test.ts`
  - 覆盖纯函数。

### Web UI

- 创建 `apps/web/src/features/files/ProjectFileTree.tsx`
  - 懒加载文件树、搜索、展开/收起、高亮。
- 创建 `apps/web/src/features/files/ProjectFileTree.test.tsx`
  - 覆盖树渲染、搜索、选择、展开回调。
- 创建 `apps/web/src/features/files/FileTopBar.tsx`
  - `打开文件`、当前文件 tab、返回对话。
- 创建 `apps/web/src/features/files/FilePathBar.tsx`
  - breadcrumb、打开所在目录、复制路径。
- 创建 `apps/web/src/features/files/TextFileEditor.tsx`
  - CodeMirror 6 封装。
- 创建 `apps/web/src/features/files/FileEditorPane.tsx`
  - 编辑/预览切换、Markdown/JSON/source/image/PDF/unsupported 渲染。
- 创建 `apps/web/src/features/files/FileEditorPane.test.tsx`
  - 覆盖只读、保存、预览、不可预览、objectURL。
- 创建 `apps/web/src/features/files/FileWorkspaceView.tsx`
  - 组合文件工作区并管理加载、保存、冲突、目录展开。
- 创建 `apps/web/src/features/files/FileWorkspaceView.test.tsx`
  - 覆盖加载根目录、打开建议文件、保存、冲突提示。
- 修改 `apps/web/src/features/conversation/ConversationHeader.tsx`
  - 会话头部入口改为真实文件工作区。
- 修改 `apps/web/src/app/App.tsx`
  - 接入 `workspaceFileService`、`activeView='files'`，移除生产路径对 mock file service 的依赖。
- 修改 `apps/web/src/app/App.test.tsx`
  - 更新文件入口和旧 detail file 断言。
- 修改 `apps/web/src/styles/app.css`
  - 增加 Codex-like 文件工作区样式。
- 修改 `apps/web/package.json` 和 `pnpm-lock.yaml`
  - 增加 CodeMirror 依赖。

---

## Task 1: 协议类型和统一错误结构

**文件：**
- 修改：`packages/protocol/src/errors.ts`
- 修改：`packages/protocol/src/api.ts`
- 修改：`apps/daemon/src/api/errors.ts`
- 修改：`apps/daemon/test/unit/protocol-shape.test.ts`

**接口：**
- 产出：`WorkspaceFileKind`
- 产出：`WorkspaceFileMeta`
- 产出：`WorkspaceFileNode`
- 产出：`WorkspaceDirectoryResponse`
- 产出：`WorkspaceFileContentResponse`
- 产出：`WorkspaceFileSaveRequest`
- 产出：`WorkspaceFileSaveResponse`
- 产出：`WorkspaceFileRevealRequest`
- 产出：`WorkspaceFileRevealResponse`
- 产出：`apiError(code, message, details?)`

- [ ] **Step 1：补失败测试**

在 `apps/daemon/test/unit/protocol-shape.test.ts` 增加 workspace file 类型构造测试，断言：

```ts
const meta: WorkspaceFileMeta = {
  path: 'docs/readme.md',
  name: 'readme.md',
  type: 'file',
  kind: 'markdown',
  mime: 'text/markdown; charset=utf-8',
  size: 12,
  mtimeMs: 1000,
  versionToken: '1000:12:sha256:abc',
  previewable: true,
  editable: true,
  readonly: false
};
```

同时断言 `RuntimeErrorCode` 可接受：

```ts
[
  'WORKSPACE_NOT_FOUND',
  'FILE_NOT_FOUND',
  'PATH_INVALID',
  'PATH_ESCAPE',
  'PATH_IGNORED',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'FILE_NOT_EDITABLE',
  'FILE_CONFLICT',
  'PERMISSION_DENIED',
  'REVEAL_UNAVAILABLE'
]
```

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/daemon test -- apps/daemon/test/unit/protocol-shape.test.ts
```

预期：失败，原因是 workspace file 类型和错误码尚未导出。

- [ ] **Step 3：扩展协议错误码**

在 `packages/protocol/src/errors.ts` 的 `RuntimeErrorCode` 中加入 workspace file 错误码。不要新建另一套 ad hoc error code union，daemon routes 必须继续返回统一 `ApiError`。

- [ ] **Step 4：新增协议类型**

在 `packages/protocol/src/api.ts` 新增：

```ts
export type WorkspaceFileKind =
  | 'directory'
  | 'markdown'
  | 'text'
  | 'json'
  | 'code'
  | 'html'
  | 'image'
  | 'pdf'
  | 'binary'
  | 'unknown';
```

并新增本任务接口列表中的请求/响应类型。`WorkspaceFileNode` 必须符合懒加载模型：目录节点使用 `hasChildren`/`childrenLoaded`，不要内嵌 `children`。

- [ ] **Step 5：增强 `apiError`**

修改 `apps/daemon/src/api/errors.ts`：

```ts
export function apiError(
  code: RuntimeErrorCode,
  message: string,
  details?: Record<string, unknown>
): ApiError
```

返回结构必须保持 `{ error: { code, message, details? } }`。

- [ ] **Step 6：验证**

运行：

```bash
pnpm --filter @opencreator/daemon test -- apps/daemon/test/unit/protocol-shape.test.ts
pnpm --filter @opencreator/protocol typecheck
pnpm --filter @opencreator/daemon typecheck
```

预期：全部通过。

- [ ] **Step 7：提交**

```bash
git add packages/protocol/src/errors.ts packages/protocol/src/api.ts apps/daemon/src/api/errors.ts apps/daemon/test/unit/protocol-shape.test.ts
git commit -m "feat(protocol): add workspace file contracts"
```

---

## Task 2: Daemon 文件核心服务

**文件：**
- 创建：`apps/daemon/src/workspace-files/types.ts`
- 创建：`apps/daemon/src/workspace-files/errors.ts`
- 创建：`apps/daemon/src/workspace-files/mime.ts`
- 创建：`apps/daemon/src/workspace-files/paths.ts`
- 创建：`apps/daemon/src/workspace-files/tree.ts`
- 创建：`apps/daemon/src/workspace-files/reveal.ts`
- 创建：`apps/daemon/src/workspace-files/service.ts`
- 创建：`apps/daemon/test/unit/workspace-files.test.ts`

**接口：**
- 消费：`RuntimeThread` from `apps/daemon/src/threads/types.ts`
- 消费：Task 1 的 workspace file protocol types
- 产出：`createWorkspaceFileService(input): WorkspaceFileService`
- 产出：
  - `listDirectory({ threadId, path })`
  - `getMeta({ threadId, path })`
  - `readContent({ threadId, path })`
  - `saveContent(request)`
  - `readBlob({ threadId, path })`
  - `reveal(request)`

- [ ] **Step 1：补失败单元测试**

创建 `apps/daemon/test/unit/workspace-files.test.ts`，覆盖：

```ts
it('lists one directory level and suggests README.md', async () => {});
it('reads markdown content with sha256 version token', async () => {});
it('saves existing editable text when version token matches', async () => {});
it('does not create a new file through saveContent', async () => {});
it('rejects save conflicts with FILE_CONFLICT', async () => {});
it('rejects absolute paths and path traversal', async () => {});
it('rejects symlink escapes outside canonicalCwd', async () => {});
it('blocks sensitive files such as .env', async () => {});
it('allows .env.example as text', async () => {});
it('blocks read-only saves with PERMISSION_DENIED', async () => {});
it('classifies svg as code text instead of image blob', async () => {});
it('calls reveal executor only after path validation', async () => {});
```

测试使用 `mkdtempSync` 创建真实临时目录，构造 `RuntimeThread` 时必须设置 `canonicalCwd` 为临时目录 realpath，`sandbox` 分别覆盖 `read-only` 和 `workspace-write`。

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/daemon test -- apps/daemon/test/unit/workspace-files.test.ts
```

预期：失败，原因是 `workspace-files/service.js` 不存在。

- [ ] **Step 3：实现内部类型和错误**

在 `types.ts` 定义：

```ts
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_JSON_FORMAT_BYTES = 1 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_DIRECTORY_CHILDREN = 500;
```

在 `errors.ts` 定义 `WorkspaceFileError`，包含 `code: RuntimeErrorCode`、`statusCode`、`details?`。routes 后续只能通过这个错误映射到 `apiError`。

- [ ] **Step 4：实现文件分类**

在 `mime.ts` 实现：

- `mimeFor(path: string): string`
- `kindFor(path: string): WorkspaceFileKind`
- `isSensitivePath(path: string): boolean`
- `isEditable(kind, path, size): boolean`
- `isPreviewable(kind, path, size): boolean`
- `reasonForUnavailable(kind, path, size): string | undefined`

支持类型必须覆盖设计文档第 8 章。关键规则：

- `.svg` 返回 `kind='code'`。
- `.env`、`.env.local`、`.pem`、`.key`、`id_rsa`、`credentials.json`、`service-account*.json`、`*.secret` 不可读不可编辑。
- `.env.example` 和 `.env.sample` 是普通文本。

- [ ] **Step 5：实现路径安全**

在 `paths.ts` 实现：

- `validateRelativePath(raw, allowEmpty)`
- `resolveSafeExisting(root, relativePath)`
- `assertInsideRoot(rootReal, targetReal)`
- `isIgnoredDir(name)`
- `assertRegularFile(absolutePath)`

拒绝：

- 绝对路径
- Windows drive path
- 空字符
- `..`
- ignored 目录段
- symlink realpath 逃逸

- [ ] **Step 6：实现一层目录树**

在 `tree.ts` 实现目录懒加载：

- 只读取指定目录的一层。
- 排序：目录优先，同级名称自然排序。
- 忽略 `.git`、`node_modules`、`.runtime`、`dist`、`build`、`.next`、`.turbo`、`coverage`、`.cache`、`.parcel-cache`、`.vite`、`.DS_Store`。
- 超过 500 个子节点时 `truncated=true`，并返回 warning。
- 文件节点只携带 `meta` summary，目录节点携带 `hasChildren`/`childrenLoaded=false`。

- [ ] **Step 7：实现 reveal executor**

在 `reveal.ts` 实现：

- macOS：`execFile('open', mode === 'file' ? ['-R', absolutePath] : [absolutePath])`
- 非 macOS：抛出 `REVEAL_UNAVAILABLE`
- 禁止 `exec`、`spawn` shell 字符串和任何手写 shell 拼接。

- [ ] **Step 8：实现 service**

在 `service.ts` 实现核心行为：

- `threadId` 不存在返回 `THREAD_NOT_FOUND`。
- `canonicalCwd` 不存在返回 `WORKSPACE_NOT_FOUND`。
- `listDirectory` 对空 path 读取根目录。
- `readContent` 只允许文本类文件，敏感文件和超限文件必须拒绝。
- `saveContent` 只允许已存在文件，必须先检查版本冲突，再用安全写入覆盖。
- 保存必须拒绝 `read-only`、archived thread、非文本、敏感文件、超限文件。
- `readBlob` 只允许 `image` 和 `pdf` 且 `previewable=true`。
- `reveal` 必须先复用路径安全校验，再调用注入 executor。

写入安全要求：

- 不创建新文件。
- 写入前后都要确保目标仍在 root 内。
- 最终文件节点不得跟随 symlink；在平台支持时使用 `O_NOFOLLOW`。
- 如果检测到路径逃逸，返回 `PATH_ESCAPE`。

- [ ] **Step 9：验证**

运行：

```bash
pnpm --filter @opencreator/daemon test -- apps/daemon/test/unit/workspace-files.test.ts
pnpm --filter @opencreator/daemon typecheck
```

预期：全部通过。

- [ ] **Step 10：提交**

```bash
git add apps/daemon/src/workspace-files apps/daemon/test/unit/workspace-files.test.ts
git commit -m "feat(daemon): add workspace file service"
```

---

## Task 3: Daemon 文件 API Routes

**文件：**
- 创建：`apps/daemon/src/api/routes.workspace-files.ts`
- 修改：`apps/daemon/src/api/server.ts`
- 修改：`apps/daemon/test/integration/api.test.ts`

**接口：**
- 消费：Task 2 的 `WorkspaceFileService`
- 产出：
  - `GET /workspace/files/directory?threadId=&path=`
  - `GET /workspace/files/meta?threadId=&path=`
  - `GET /workspace/files/content?threadId=&path=`
  - `POST /workspace/files/content`
  - `GET /workspace/files/blob?threadId=&path=`
  - `POST /workspace/files/reveal`

- [ ] **Step 1：补失败集成测试**

在 `apps/daemon/test/integration/api.test.ts` 增加测试：

- 创建 external thread 指向临时 workspace。
- `GET /workspace/files/directory` 返回真实 `README.md`。
- `GET /workspace/files/content` 返回真实文本。
- `POST /workspace/files/content` 写入真实磁盘文件。
- `GET /workspace/files/blob` 带 auth 返回图片 `content-type`。
- 无 auth 请求返回 401。
- `OPTIONS /workspace/files/content` 对 localhost origin 允许 `POST`。
- path traversal 请求返回 `PATH_INVALID`。

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/daemon test -- apps/daemon/test/integration/api.test.ts -t "workspace files"
```

预期：失败，原因是 workspace file routes 尚未注册。

- [ ] **Step 3：实现 routes**

创建 `routes.workspace-files.ts`：

- 所有 query/body 手动校验，错误返回 `VALIDATION_FAILED`。
- route catch `WorkspaceFileError` 并用 `apiError(error.code, error.message, error.details)` 返回。
- `GET /workspace/files/blob` 返回 Buffer，设置 `Content-Type` 和 `Cache-Control: no-store`。
- blob route 仍走全局 Bearer auth，不做 query token。

- [ ] **Step 4：注册 routes**

在 `apps/daemon/src/api/server.ts`：

- import `registerWorkspaceFileRoutes`
- import `createWorkspaceFileService`
- import `createDefaultRevealExecutor`
- 在 `threadManager` 创建后创建 service：

```ts
const workspaceFileService = createWorkspaceFileService({
  getThread: id => threadManager.getThread(id),
  revealExecutor: createDefaultRevealExecutor()
});
```

- 在 `registerThreadRoutes` 附近注册：

```ts
await registerWorkspaceFileRoutes(server, workspaceFileService);
```

- [ ] **Step 5：验证**

运行：

```bash
pnpm --filter @opencreator/daemon test -- apps/daemon/test/integration/api.test.ts -t "workspace files"
pnpm --filter @opencreator/daemon typecheck
```

预期：全部通过。

- [ ] **Step 6：提交**

```bash
git add apps/daemon/src/api/server.ts apps/daemon/src/api/routes.workspace-files.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat(daemon): expose workspace file routes"
```

---

## Task 4: Web Runtime 文件服务

**文件：**
- 修改：`apps/web/src/runtime/client.ts`
- 创建：`apps/web/src/services/workspace-file-service.ts`
- 创建：`apps/web/src/services/workspace-file-service.test.ts`

**接口：**
- 消费：`RuntimeClient`
- 产出：`createWorkspaceFileService(client)`
- 产出方法：
  - `listDirectory(threadId, path)`
  - `getMeta(threadId, path)`
  - `openText(threadId, path)`
  - `saveText(input)`
  - `openBlob(threadId, path)`
  - `revokeBlob(objectUrl)`
  - `reveal(input)`

- [ ] **Step 1：补失败服务测试**

创建 `apps/web/src/services/workspace-file-service.test.ts`，覆盖：

- `listDirectory` 调 `GET /workspace/files/directory`
- `openText` 调 `GET /workspace/files/content`
- `saveText` 调 `POST /workspace/files/content`
- `reveal` 调 `POST /workspace/files/reveal`
- `openBlob` 通过 `RuntimeClient.rawGet` 带 `Authorization: Bearer ...`
- `openBlob` 生成 objectURL
- `revokeBlob` 调 `URL.revokeObjectURL`

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/services/workspace-file-service.test.ts
```

预期：失败，原因是文件服务尚未存在，`RuntimeClient.rawGet` 尚未存在。

- [ ] **Step 3：扩展 RuntimeClient**

在 `apps/web/src/runtime/client.ts`：

- 新增 `rawGet(path: string): Promise<Response>`
- 新增 `rawRequest(path, input): Promise<Response>`
- 现有 `request<T>` 改为调用 `rawRequest` 后再 `readJson`
- `rawRequest` 必须复用现有错误解析逻辑，非 2xx 仍抛 `ApiClientError`
- `/healthz` 仍不带 auth，其他 path 必须带 `Authorization`

- [ ] **Step 4：实现 workspace-file-service**

创建 `apps/web/src/services/workspace-file-service.ts`：

```ts
export function createWorkspaceFileService(client: RuntimeClient) {
  return {
    listDirectory,
    getMeta,
    openText,
    saveText,
    openBlob,
    revokeBlob,
    reveal
  };
}
```

`openBlob` 必须：

- 调 `client.rawGet('/workspace/files/blob?...')`
- `await response.blob()`
- `URL.createObjectURL(blob)`
- 返回 `{ objectUrl, mime, size }`

- [ ] **Step 5：验证**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/services/workspace-file-service.test.ts apps/web/src/runtime/client.test.ts
pnpm --filter @opencreator/web typecheck
```

预期：全部通过。

- [ ] **Step 6：提交**

```bash
git add apps/web/src/runtime/client.ts apps/web/src/services/workspace-file-service.ts apps/web/src/services/workspace-file-service.test.ts
git commit -m "feat(web): add workspace file service"
```

---

## Task 5: 文件工作区状态

**文件：**
- 修改：`apps/web/src/app/app-state.ts`
- 修改：`apps/web/src/app/app-state.test.ts`
- 创建：`apps/web/src/features/files/file-view-state.ts`
- 创建：`apps/web/src/features/files/file-view-state.test.ts`

**接口：**
- 产出：`ActiveView` 增加 `'files'`
- 产出 actions：
  - `{ type: 'open_files' }`
  - `{ type: 'select_workspace_file'; path: string }`
  - `{ type: 'close_file_workspace' }`
- 产出 helpers：
  - `workspaceKey(canonicalCwd: string): string`
  - `chooseSuggestedPath(directory): string | undefined`
  - `mergeDirectoryNodes(existing, directoryPath, nodes): WorkspaceFileNode[]`
  - `parentDirectories(path): string[]`

- [ ] **Step 1：补失败状态测试**

在 `app-state.test.ts` 覆盖：

- `open_files` 把 `activeView` 切到 `files`，关闭右侧详情。
- `select_workspace_file` 不打开 `rightPanelMode: 'file'`。
- 离开 conversation 到 files 时右侧详情关闭。

在 `file-view-state.test.ts` 覆盖：

- `workspaceKey('/Users/a/repo')` 稳定，格式为 `cwd_<16 hex>`。
- `chooseSuggestedPath` 优先使用后端 `suggestedOpenPath`。
- `mergeDirectoryNodes` 替换指定目录的一层子节点，不重复插入。
- `parentDirectories('a/b/c.md')` 返回 `['a', 'a/b']`。

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/app/app-state.test.ts apps/web/src/features/files/file-view-state.test.ts
```

预期：失败，原因是 action 和 helper 尚未存在。

- [ ] **Step 3：更新 app-state**

修改 `apps/web/src/app/app-state.ts`：

- `ActiveView` 增加 `'files'`
- 添加三个 action
- reducer 中 `open_files` 和 `select_workspace_file` 必须设置 `rightPanelMode: 'closed'`
- `back_to_app` 返回 `conversation`

- [ ] **Step 4：实现 file-view-state**

创建 `file-view-state.ts`：

- `workspaceKey` 用稳定 hash，不依赖 `projectId`。
- `chooseSuggestedPath` 顺序：
  1. `directory.suggestedOpenPath`
  2. `README.md`
  3. `readme.md`
  4. `package.json`
  5. 第一个 markdown
  6. 第一个可预览文件
- `mergeDirectoryNodes` 只更新目标目录下一层，保留其他已加载节点。

- [ ] **Step 5：验证**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/app/app-state.test.ts apps/web/src/features/files/file-view-state.test.ts
pnpm --filter @opencreator/web typecheck
```

预期：全部通过。

- [ ] **Step 6：提交**

```bash
git add apps/web/src/app/app-state.ts apps/web/src/app/app-state.test.ts apps/web/src/features/files/file-view-state.ts apps/web/src/features/files/file-view-state.test.ts
git commit -m "feat(web): add file workspace state"
```

---

## Task 6: Codex-like 文件树 UI

**文件：**
- 创建：`apps/web/src/features/files/ProjectFileTree.tsx`
- 创建：`apps/web/src/features/files/ProjectFileTree.test.tsx`
- 修改：`apps/web/src/styles/app.css`

**接口：**
- 消费：`WorkspaceFileNode[]`
- 产出：`ProjectFileTree`
- props：
  - `nodes`
  - `selectedPath`
  - `expandedPaths`
  - `search`
  - `truncatedPaths`
  - `onToggleDirectory(path)`
  - `onSelectFile(path)`
  - `onSearchChange(value)`

- [ ] **Step 1：补失败组件测试**

创建 `ProjectFileTree.test.tsx`，覆盖：

- 渲染搜索框 `筛选文件...`
- 渲染目录、文件和当前文件高亮
- 点击目录触发 `onToggleDirectory(path)`
- 点击文件触发 `onSelectFile(path)`
- 搜索 `readme` 时只显示匹配文件和必要父级
- 截断目录显示“当前目录文件较多，仅显示前 500 项”

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/features/files/ProjectFileTree.test.tsx
```

预期：失败，原因是组件尚未存在。

- [ ] **Step 3：实现组件**

`ProjectFileTree.tsx` 要求：

- 使用 lucide 图标：目录、文件、代码、图片、PDF、展开箭头、搜索。
- `role="tree"` / `role="treeitem"` 基础可访问性。
- 当前文件使用 `aria-current="page"`。
- 搜索只在已加载节点中过滤，不调用后端全局搜索。
- 没有节点时显示“当前工作区暂无可显示文件”。
- 不显示新建、删除、重命名、上传按钮。

- [ ] **Step 4：补样式**

在 `app.css` 增加：

- `.file-tree-panel`
- `.file-search`
- `.file-tree-list`
- `.file-tree-row`
- `.file-tree-row[aria-current="page"]`
- `.file-tree-empty`
- `.file-tree-warning`

固定宽度区间建议：右侧树 `280px` 到 `360px`，行高稳定，长文件名 ellipsis。

- [ ] **Step 5：验证**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/features/files/ProjectFileTree.test.tsx
pnpm --filter @opencreator/web typecheck
```

预期：全部通过。

- [ ] **Step 6：提交**

```bash
git add apps/web/src/features/files/ProjectFileTree.tsx apps/web/src/features/files/ProjectFileTree.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): add workspace file tree"
```

---

## Task 7: 文件编辑器和预览组件

**文件：**
- 修改：`apps/web/package.json`
- 修改：`pnpm-lock.yaml`
- 创建：`apps/web/src/features/files/TextFileEditor.tsx`
- 创建：`apps/web/src/features/files/FileEditorPane.tsx`
- 创建：`apps/web/src/features/files/FileEditorPane.test.tsx`
- 修改：`apps/web/src/styles/app.css`

**接口：**
- 消费：`WorkspaceFileMeta`
- 消费：`MarkdownRenderer`
- 产出：CodeMirror 文本编辑器
- 产出：Markdown/JSON/source/image/PDF/unsupported 预览

- [ ] **Step 1：安装 CodeMirror 依赖**

运行：

```bash
pnpm --filter @opencreator/web add @codemirror/view @codemirror/state @codemirror/commands @codemirror/language @codemirror/search @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-html @codemirror/lang-css @codemirror/lang-python @codemirror/lang-xml
```

预期：`apps/web/package.json` 和 `pnpm-lock.yaml` 更新。

- [ ] **Step 2：补失败组件测试**

创建 `FileEditorPane.test.tsx`，覆盖：

- markdown 默认源码编辑，可切换到 `MarkdownRenderer` 预览。
- JSON 预览会格式化；无效 JSON 显示解析失败但仍保留原文。
- `readonly=true` 时编辑器不可编辑，保存按钮不可用或不显示。
- dirty 时保存按钮可用，点击触发 `onSave`。
- image 使用 objectURL 渲染 `<img>`。
- PDF 使用 objectURL 渲染 `<object type="application/pdf">`。
- unsupported 文件显示文件名、MIME、大小、原因。
- `Mod-s` 触发保存。

- [ ] **Step 3：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/features/files/FileEditorPane.test.tsx
```

预期：失败，原因是组件尚未存在。

- [ ] **Step 4：实现 TextFileEditor**

`TextFileEditor.tsx` 要求：

- CodeMirror 6 初始化和销毁在 React effect 中完成。
- 显示行号。
- `EditorView.editable` 和 `EditorState.readOnly` 同时根据 readonly 设置。
- `Mod-s` 调 `onSave`。
- `docChanged` 时调 `onChange(value)`。
- 根据 `WorkspaceFileKind` 加载 markdown/json/html/css/js/ts/python/xml 等基础语言支持。
- `.svg` 作为 code/text 编辑，不走图片预览。

- [ ] **Step 5：实现 FileEditorPane**

`FileEditorPane.tsx` 要求：

- `meta` 为空时显示“选择一个文件”。
- 文本类支持“编辑/预览”切换。
- Markdown 预览复用 `MarkdownRenderer variant="document"`。
- HTML 预览仅显示源码，不执行。
- 图片/PDF 只使用传入的 `objectUrl`。
- unsupported 状态提供原因，不出现空白页。
- 不显示未实现的新建、删除、重命名按钮。

- [ ] **Step 6：补样式**

在 `app.css` 增加：

- `.file-editor-pane`
- `.file-editor-toolbar`
- `.text-file-editor`
- `.file-preview`
- `.unsupported-file-state`
- `.dirty-indicator`
- `.file-error-bar`

编辑器和预览区必须 `min-height: 0`，避免在主布局中撑破页面。

- [ ] **Step 7：验证**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/features/files/FileEditorPane.test.tsx
pnpm --filter @opencreator/web typecheck
```

预期：全部通过。

- [ ] **Step 8：提交**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/files/TextFileEditor.tsx apps/web/src/features/files/FileEditorPane.tsx apps/web/src/features/files/FileEditorPane.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): add workspace file editor"
```

---

## Task 8: 文件工作区主视图和 App 接入

**文件：**
- 创建：`apps/web/src/features/files/FileTopBar.tsx`
- 创建：`apps/web/src/features/files/FilePathBar.tsx`
- 创建：`apps/web/src/features/files/FileWorkspaceView.tsx`
- 创建：`apps/web/src/features/files/FileWorkspaceView.test.tsx`
- 修改：`apps/web/src/features/conversation/ConversationHeader.tsx`
- 修改：`apps/web/src/app/App.tsx`
- 修改：`apps/web/src/app/App.test.tsx`
- 修改：`apps/web/src/styles/app.css`

**接口：**
- 消费：Task 4 的 `createWorkspaceFileService`
- 消费：Task 5 的状态 helpers
- 消费：Task 6/7 的 UI 组件
- 产出：`activeView='files'` 的主工作区

- [ ] **Step 1：补失败集成组件测试**

创建 `FileWorkspaceView.test.tsx`，覆盖：

- 加载根目录后自动打开 `suggestedOpenPath`。
- 点击目录时调用 `listDirectory(threadId, path)` 并合并节点。
- 点击文本文件调用 `getMeta` + `openText`。
- 点击图片/PDF 调用 `getMeta` + `openBlob`。
- 切换文件或卸载时调用 `revokeBlob`。
- 编辑后保存调用 `POST` 服务方法并清 dirty。
- 409 `FILE_CONFLICT` 显示“重新加载 / 覆盖保存 / 取消”入口。
- `read-only` thread 显示只读提示且不能保存。

- [ ] **Step 2：确认测试失败**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/features/files/FileWorkspaceView.test.tsx
```

预期：失败，原因是主视图尚未存在。

- [ ] **Step 3：实现顶部栏和路径栏**

`FileTopBar.tsx`：

- 显示 `打开文件`。
- 显示当前文件 tab，dirty 时显示 `*` 或“未保存”。
- 显示返回对话按钮。
- 不显示未实现的 `+`、quick open、新建文件、多 tab 控件。

`FilePathBar.tsx`：

- 显示 breadcrumb。
- 提供“打开所在目录”和“复制路径”。
- reveal 失败时由父组件显示错误。

- [ ] **Step 4：实现 FileWorkspaceView**

`FileWorkspaceView.tsx` 管理：

- active thread 为空时显示“请选择或创建一个会话后查看文件”。
- 加载根目录和懒加载子目录。
- 根据 `workspaceKey(canonicalCwd)` 读取/写入最近打开文件。
- 打开文件时处理文本、blob、unsupported。
- 切换文件前处理 dirty 确认。
- 保存时带 `baseVersionToken`。
- `FILE_CONFLICT` 时提供重新加载、覆盖保存、取消。
- objectURL 生命周期释放。
- 只读提示和后端错误提示。

- [ ] **Step 5：接入 App**

修改 `apps/web/src/app/App.tsx`：

- import `FileWorkspaceView`
- import `createWorkspaceFileService`
- 从 `runtimeClient` 创建 `workspaceFileService`
- 根据 `state.selectedThreadId` 找到 `selectedThread`
- `state.activeView === 'files'` 时渲染 `FileWorkspaceView`
- 会话头部文件入口 dispatch `{ type: 'open_files' }`
- 生产路径不再调用 `createMockFileService()` 打开真实文件视图
- 旧 `rightPanelMode: 'file'` 不再作为主文件入口；如暂时保留，只能跳转到 `open_files`

- [ ] **Step 6：更新 ConversationHeader**

将按钮文案改为 `文件`。按钮必须打开真实文件工作区，不再表示“打开位置”或 mock 文件详情。

- [ ] **Step 7：补主布局样式**

在 `app.css` 增加：

- `.file-workspace-view`
- `.file-top-bar`
- `.file-path-bar`
- `.file-workspace-body`
- `.file-tab`
- `.file-workspace-empty`
- 响应式断点：窄屏下文件树可放到下方或隐藏，但不能覆盖编辑器。

布局要符合用户提供的 Codex 文件视图方向：左侧 OpenCreator 菜单不变，中间主工作区为编辑/预览，右侧为文件树。

- [ ] **Step 8：验证**

运行：

```bash
pnpm --filter @opencreator/web test -- apps/web/src/features/files/FileWorkspaceView.test.tsx apps/web/src/app/App.test.tsx
pnpm --filter @opencreator/web typecheck
```

预期：全部通过。若 `App.test.tsx` 仍断言 mock file detail，需要改为真实文件工作区入口。

- [ ] **Step 9：提交**

```bash
git add apps/web/src/features/files/FileTopBar.tsx apps/web/src/features/files/FilePathBar.tsx apps/web/src/features/files/FileWorkspaceView.tsx apps/web/src/features/files/FileWorkspaceView.test.tsx apps/web/src/features/conversation/ConversationHeader.tsx apps/web/src/app/App.tsx apps/web/src/app/App.test.tsx apps/web/src/styles/app.css
git commit -m "feat(web): wire codex-like file workspace"
```

---

## Task 9: 端到端验证和文档收尾

**文件：**
- 修改：`docs/superpowers/specs/2026-07-08-opencreator-codex-like-file-workspace-design.md`，仅当实现中发现设计需要澄清时修改。
- 创建：`docs/superpowers/test-reports/2026-07-08-opencreator-file-workspace.md`，如果目录不存在就先创建目录。

**接口：**
- 消费：前 8 个任务产物
- 产出：完整测试记录和可验收版本

- [ ] **Step 1：运行目标测试集**

运行：

```bash
pnpm --filter @opencreator/protocol typecheck
pnpm --filter @opencreator/daemon test -- apps/daemon/test/unit/protocol-shape.test.ts apps/daemon/test/unit/workspace-files.test.ts apps/daemon/test/integration/api.test.ts
pnpm --filter @opencreator/web test -- apps/web/src/services/workspace-file-service.test.ts apps/web/src/features/files/file-view-state.test.ts apps/web/src/features/files/ProjectFileTree.test.tsx apps/web/src/features/files/FileEditorPane.test.tsx apps/web/src/features/files/FileWorkspaceView.test.tsx apps/web/src/app/app-state.test.ts apps/web/src/app/App.test.tsx
pnpm --filter @opencreator/daemon typecheck
pnpm --filter @opencreator/web typecheck
```

预期：全部通过。

- [ ] **Step 2：运行全仓检查**

运行：

```bash
pnpm typecheck
pnpm test
```

预期：全部通过。

- [ ] **Step 3：浏览器功能测试**

启动：

```bash
pnpm daemon:dev
pnpm web:dev
```

手动验证：

- 打开或创建一个绑定当前 repo cwd 的会话。
- 点击 `文件`。
- 确认看到真实 repo 根目录，不是 mock 文件。
- 展开 `docs/superpowers/specs`。
- 打开 `2026-07-08-opencreator-codex-like-file-workspace-design.md`。
- 切换编辑/预览。
- 在临时测试文件中编辑并保存，确认磁盘内容变化。
- 打开图片，确认没有 401，能看到预览。
- 打开 PDF，如果浏览器不能内嵌预览，必须显示明确失败状态。
- 打开 `.zip` 或 `.db`，确认显示不可预览原因。
- 打开 `.env`，确认内容被后端拒绝。
- 在 `read-only` thread 中确认 UI 不可编辑，后端保存返回 `PERMISSION_DENIED`。
- 直接请求 `/workspace/files/blob?...` 且不带 Authorization，确认 401。
- 尝试 `../` 路径，确认后端拒绝。
- 创建 symlink 指向 cwd 外部，确认后端拒绝。

- [ ] **Step 4：记录测试报告**

创建 `docs/superpowers/test-reports/2026-07-08-opencreator-file-workspace.md`：

```md
# OpenCreator 文件工作区测试报告

## 自动化测试

- protocol typecheck: PASS
- daemon workspace file unit tests: PASS
- daemon workspace file integration tests: PASS
- web workspace file service tests: PASS
- web file workspace component tests: PASS
- repo typecheck: PASS
- repo test: PASS

## 手动功能测试

- 真实目录树: PASS
- Markdown 编辑和保存: PASS
- 代码文件查看: PASS
- 图片预览: PASS
- PDF 预览或明确失败状态: PASS
- 不可预览文件状态: PASS
- 只读权限拦截: PASS
- blob 无 auth 返回 401: PASS
- 路径逃逸被拒绝: PASS
- symlink 逃逸被拒绝: PASS

## 遗留风险

- 第一版不支持新建、删除、重命名、上传和全局搜索。
- 第一版文件树搜索只覆盖已加载节点。
```

- [ ] **Step 5：提交**

```bash
git add docs/superpowers/test-reports/2026-07-08-opencreator-file-workspace.md docs/superpowers/specs/2026-07-08-opencreator-codex-like-file-workspace-design.md
git commit -m "test: verify file workspace"
```

如果 Task 9 没有文档变更，不创建空提交。

---

## 自审清单

### 方案覆盖

- `threadId` 文件根：Task 2、Task 3、Task 8。
- 路径安全和 symlink 防护：Task 2、Task 3、Task 9。
- 懒加载目录树：Task 2、Task 3、Task 6、Task 8。
- `POST` 保存和冲突处理：Task 2、Task 3、Task 4、Task 8。
- blob auth + objectURL：Task 3、Task 4、Task 7、Task 8。
- `SandboxMode` 权限：Task 2、Task 8、Task 9。
- `RuntimeErrorCode` 和 `apiError(details)`：Task 1。
- CodeMirror 6：Task 7。
- SVG 源码模式：Task 2、Task 7。
- Codex-like 主工作区：Task 6、Task 7、Task 8。
- 移除 mock 文件生产路径：Task 8。

### 类型一致性

- 后端 endpoint 固定为 `/workspace/files/directory`、`/workspace/files/meta`、`/workspace/files/content`、`/workspace/files/blob`、`/workspace/files/reveal`。
- 前端 service 方法固定为 `listDirectory`、`getMeta`、`openText`、`saveText`、`openBlob`、`revokeBlob`、`reveal`。
- 文件分类权威在后端，前端不维护扩展名分类表。
- 保存请求固定使用 `baseVersionToken`，冲突覆盖使用 `overwriteConflict: true`。

### 不进入本阶段

- 不做任意目录选择。
- 不做文件新建。
- 不做文件删除。
- 不做文件重命名。
- 不做文件上传。
- 不做 Git diff。
- 不做 HTML live preview。
- 不做 Office 文档解析。
- 不做全局文件搜索。
