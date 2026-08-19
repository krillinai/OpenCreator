# OpenCreator Codex-like 文件工作区设计

## 1. 背景

OpenCreator 当前已经具备 Agent runtime、项目、会话、Skills、MCP、定时任务和 Web UI 基础能力，但文件功能仍停留在前端 mock 层。

当前前端已有以下雏形：

1. `apps/web/src/services/file-service.ts` 提供 IndexedDB mock 文件服务。
2. `apps/web/src/components/editor/FileTree.tsx` 提供扁平文件树展示。
3. `apps/web/src/features/details/DetailPanel.tsx` 的 `mode="file"` 支持 Markdown、JSON、HTML/text 源码预览。
4. `apps/web/src/app/App.tsx` 已维护 `selectedFilePath`、`rightPanelMode: file`、文件 draft、保存状态和 mock `fileService`。

这些能力还不是本机真实文件功能：

1. 没有 daemon 文件系统 API。
2. 文件树不是当前工作区 `cwd` 的真实目录树。
3. 文件内容来自 mock IndexedDB，不来自当前工作区目录。
4. 文件预览不是 Codex/Open Design 式文件工作区。
5. 没有真实保存、路径安全、权限校验、外部修改冲突处理。

本阶段目标是为 OpenCreator 设计第一版真实文件工作区。用户明确要求：

1. 参考 `open-design-main` 的文件预览实现。
2. 参考 Codex 桌面文件视图样式。
3. 支持基本文件预览。
4. 支持可编辑文本文件的编辑和保存。
5. 支持目录树查看。
6. 不可预览文件支持打开所在目录。
7. 第一版只访问当前工作区 `cwd`，不做任意目录选择。

## 2. 参考结论

### 2.1 open-design-main 可借鉴点

本次调研了当前目录下 `open-design-main` 的以下关键实现：

1. `open-design-main/apps/web/src/providers/registry.ts`
   - `fetchProjectFiles`
   - `fetchProjectFolders`
   - `fetchProjectFileText`
   - `fetchProjectFilePreview`
   - `writeProjectTextFile`
   - `projectRawUrl`
   - `deleteProjectFile`
   - `renameProjectFile`
2. `open-design-main/apps/daemon/src/projects.ts`
   - `listFiles`
   - `listProjectFolders`
   - `writeProjectFile`
   - `sanitizePath`
   - `resolveSafeReal`
   - `mimeFor`
   - `kindFor`
3. `open-design-main/apps/daemon/src/routes/project/index.ts`
   - `/api/projects/:id/files`
   - `/api/projects/:id/folders`
   - `/api/projects/:id/raw/*`
   - `/api/projects/:id/files/:name/preview`
4. `open-design-main/apps/daemon/src/document-preview.ts`
   - PDF、docx、pptx、xlsx 的文本摘要预览。
5. `open-design-main/apps/web/src/components/DesignFilesPanel.tsx`
   - 文件面板、目录、搜索、文件分类、空态和操作入口。
6. `open-design-main/apps/web/src/components/FileViewer.tsx`
   - 预览、代码、文档、导出、版本等复杂文件视图。

可吸收的模式：

1. daemon 负责真实文件系统访问。
2. daemon 负责路径清洗、realpath 校验和 symlink 逃逸防护。
3. daemon 返回文件元信息、mime、kind、size、mtime。
4. web 通过 provider/service 调用 API，不直接操作本机文件。
5. 文件类型由后端粗分类，前端按分类选择预览器。
6. 文本读写和二进制 raw/blob 访问分开。
7. 不可预览文件明确显示原因，不用空白页糊弄用户。

不直接复制的部分：

1. Open Design 的 `FileViewer` 绑定了 artifacts、导出、部署、评论、版本、品牌设计等大量业务，OpenCreator 第一版不能照搬。
2. Open Design 的项目存储有 `.od/projects/<id>` 和外部项目目录两种模式，OpenCreator 第一版只围绕当前 thread `cwd`。
3. Open Design 的 HTML live preview、iframe bridge、export、snapshot、部署链路不进入本阶段。
4. Open Design 的 docx/pptx/xlsx 文档解析可以作为后续增强，第一版不作为必需能力。
5. Open Design 的文件删除、重命名、上传、版本历史不进入本阶段核心范围。

### 2.2 Codex 文件视图参考

用户提供的 Codex 文件视图截图包含以下关键特征：

1. 文件视图和会话内容在同一工作区内并排显示，不是独立跳转页，也不是窄右侧详情面板。
2. 左侧仍保留应用菜单。
3. 文件区域顶部有“打开文件”、文件 Tab、加号和布局操作。
4. 第二行是 breadcrumb 路径和“打开”操作。
5. 中间左侧是编辑器/预览区，包含行号、语法高亮和文件内容。
6. 中间右侧是文件树，包含搜索框、可折叠目录和当前文件高亮。

OpenCreator 第一版应对齐这个形态，而不是继续使用当前 `DetailPanel` 作为文件预览主入口。

## 3. 目标

本阶段完成 OpenCreator 第一版真实文件工作区设计，为后续实现提供明确边界。

具体目标：

1. 文件功能访问当前会话 `threadId` 绑定的 `cwd` 下的真实文件。
2. 前端显示 Codex-like 文件工作区。
3. 支持真实目录树浏览。
4. 支持文件树搜索、展开、收起、当前文件高亮。
5. 支持文本类文件查看、编辑、保存。
6. 支持 Markdown 预览。
7. 支持 JSON 格式化预览。
8. 支持源码类文件按文本源码查看和编辑。
9. 支持图片预览。
10. 支持 PDF 预览或明确失败状态。
11. 不可预览文件显示原因，并提供打开所在目录和复制路径。
12. 文件写入必须遵守项目权限语义。
13. 后端必须做路径安全校验和文件大小限制。
14. 保存时必须处理外部修改冲突。
15. 页面刷新后恢复最近打开文件和当前会话。

## 4. 非目标

本阶段不做：

1. 任意本机目录选择。
2. 全盘文件管理器。
3. 文件新建。
4. 文件删除。
5. 文件重命名。
6. 文件上传或拖拽导入。
7. 多文件批量操作。
8. 文件版本历史。
9. Git diff 视图。
10. HTML live preview 或 iframe 运行预览。
11. docx、pptx、xlsx 的 Office 文档解析预览。
12. 音频、视频播放预览。
13. 外部编辑器深度集成。
14. 文件 watcher 实时同步。
15. 任意路径写入，即使 thread 权限是 `danger-full-access`，文件面板第一版也只允许访问当前 thread `cwd` 内路径。

## 5. 方案选择

### 5.1 方案 A：daemon 真实文件 API + Codex-like 文件工作区

daemon 增加真实文件系统 API，前端新增 `FileWorkspaceView`。文件根来自当前 thread `canonicalCwd`，所有路径限制在该根目录内。

优点：

1. 是真实本机文件能力，不是 mock。
2. 符合 OpenCreator 作为本机 Agent 桌面应用的方向。
3. 后续桌面版可以复用 runtime API。
4. 安全边界集中在 daemon，前端不承担本机文件系统信任边界。
5. 能对齐 Codex 文件视图体验。

缺点：

1. 需要补 daemon 文件模块、协议类型、前端服务、UI 和测试。
2. 第一版需要谨慎处理路径安全和权限。

### 5.2 方案 B：只增强前端 mock 文件面板

继续用当前 `file-service.ts` mock/IndexedDB，前端实现类似文件树和预览。

优点：

1. 实现最快。
2. UI 可先看到效果。

缺点：

1. 不是用户需要的真实文件功能。
2. 不能编辑当前工作区文件。
3. 后续必然返工。

### 5.3 方案 C：完整桌面文件管理器

一次性实现任意目录选择、文件新建/删除/重命名、拖拽上传、外部编辑器、watcher、多标签、版本历史。

优点：

1. 能力完整。
2. 接近 IDE/文件管理器。

缺点：

1. 第一版范围过大。
2. 会提前引入桌面壳权限、文件对话框、watcher 和批量操作复杂度。
3. 容易偏离当前“先把 Agent runtime 打牢”的路线。

### 5.4 推荐

推荐方案 A。

原因：

1. 用户明确选择第一版只访问当前工作上下文的 `cwd`，并且当前 daemon 已有可信的 thread `canonicalCwd`。
2. 这个方案能满足真实文件预览、编辑和目录树目标。
3. 相比完整文件管理器，范围可控。
4. 相比 mock 方案，它不会制造后续返工。

## 6. 总体架构

新增文件能力分为四层：

```text
daemon workspace-files 模块
  ├── 解析 threadId 到 cwd
  ├── 路径规范化与安全校验
  ├── 目录树扫描
  ├── 文件类型识别
  ├── 文本读取/保存
  ├── blob 文件读取
  └── 打开所在目录

protocol 类型
  ├── WorkspaceFileNode
  ├── WorkspaceFileMeta
  ├── WorkspaceFileContent
  ├── WorkspaceFileSaveRequest
  └── WorkspaceFileErrorCode 扩展项

web service
  ├── createWorkspaceFileService(client)
  ├── listDirectory(threadId, path)
  ├── getMeta(threadId, path)
  ├── openText(threadId, path)
  ├── saveText(threadId, path, content, versionToken)
  ├── openBlob(threadId, path)
  └── reveal(threadId, path)

web UI
  ├── FileWorkspaceView
  ├── FileTopBar
  ├── FilePathBar
  ├── FileEditorPane
  └── ProjectFileTree
```

文件视图不再使用 `DetailPanel` 作为主入口。`DetailPanel` 继续用于运行详情、变更详情等侧边辅助信息。

## 7. 后端设计

### 7.1 模块边界

新增 `apps/daemon/src/workspace-files/`：

```text
workspace-files/
  service.ts
  paths.ts
  tree.ts
  types.ts
  mime.ts
  errors.ts
```

职责：

1. `service.ts`：对外提供文件树、meta、content、save、blob、reveal 能力。
2. `paths.ts`：实现路径规范化、realpath 校验、symlink 逃逸防护。
3. `tree.ts`：目录遍历、忽略规则、排序、截断。
4. `mime.ts`：扩展名、mime、kind、editable/previewable 判断。
5. `errors.ts`：统一错误类型和错误码。

### 7.2 cwd 解析

第一版后端文件 API 使用 `threadId` 作为文件根入口，前端不直接传绝对路径作为文件根。

采用 `threadId` 的原因：

1. 当前 daemon 没有独立 project 存储。
2. 当前 daemon 已有 thread repository，`RuntimeThread` 持有可信的 `cwd/canonicalCwd/sandbox`。
3. 前端的 `projectId` 当前是 UI 分组和展示概念，不能被 daemon 反解为可信 cwd。
4. 以 `threadId` 作为根入口可以直接落地，不需要先做项目模型统一工程。

后端解析规则：

1. 根据 `threadId` 从 thread repository 读取 `RuntimeThread`。
2. 使用 thread 的 `canonicalCwd` 作为文件根。
3. 使用 thread 的 `sandbox` 作为文件写权限的唯一真相源。
4. 若 thread 不存在，返回 `THREAD_NOT_FOUND`。
5. 若 thread 已归档，文件视图仍允许只读预览，但保存返回 `THREAD_ARCHIVED` 或 `PERMISSION_DENIED`。
6. 若 `canonicalCwd` 不存在，返回 `WORKSPACE_NOT_FOUND`。

项目与会话关系：

1. OpenCreator 左侧项目仍作为 UI 分组存在。
2. 文件工作区必须绑定到一个 active thread。
3. 从项目但没有会话进入文件视图时，前端先创建或选择该项目下的 active thread，再打开文件视图。
4. 后续若要让 project 成为 daemon 一等模型，需要单独设计项目存储和 id 规则；不进入本阶段。

### 7.3 路径安全

所有文件 API 只接受相对路径。

拒绝：

1. 空路径。
2. 绝对路径。
3. Windows drive path。
4. 包含空字符的路径。
5. 包含 `..` 的路径。
6. realpath 后逃逸项目根的路径。
7. 通过 symlink 指向项目根外部的路径。
8. 被忽略目录下的路径。

安全策略：

1. `rootReal = realpath(cwd)`。
2. `candidate = path.resolve(rootReal, relativePath)`。
3. 对已存在文件使用 `realpath(candidate)`。
4. 对写入路径使用最长已存在前缀 realpath，然后拼接剩余路径。
5. 校验最终 real path 必须等于 `rootReal` 或以 `rootReal + path.sep` 开头。

这部分直接吸收 Open Design `resolveSafeReal` 的思路，但在 OpenCreator 中重新实现。

### 7.4 忽略规则

目录树默认忽略：

1. `.git`
2. `node_modules`
3. `.runtime`
4. `dist`
5. `build`
6. `.next`
7. `.turbo`
8. `coverage`
9. `.cache`
10. `.parcel-cache`
11. `.vite`
12. `.DS_Store`

隐藏文件不一刀切隐藏，因为项目中可能存在 `.env.example`、`.gitignore`、`.npmrc` 等有价值文件。

敏感文件策略：

1. 默认可在树中显示文件名。
2. 禁止读取和编辑高风险密钥文件内容。
3. `.env` 第一版不可预览、不编辑；`.env.example`、`.env.sample` 可读写。

### 7.5 目录加载和文件大小限制

第一版限制：

1. 目录树第一版采用懒加载：每次只读取指定目录的一层子节点。
2. 单目录最多返回 `500` 个子节点。
3. 单目录超过上限时返回 `truncated=true` 和 warning，排序后保留目录优先、名称靠前的节点。
4. 文本文件预览/编辑最大 `2 MB`。
5. JSON 格式化预览最大 `1 MB`。
6. 图片预览最大 `20 MB`。
7. PDF 预览最大 `50 MB`。
8. size gate 在 meta 阶段完成，超过限制的文件 `previewable=false` 或 `editable=false`，blob/content 端点也必须重复校验。
9. 单目录读取遇到权限错误跳过该目录并返回 warnings。

超过限制时返回 meta，但 `previewable=false` 或 `editable=false`，并给出明确原因。

### 7.6 API 契约

#### `GET /workspace/files/directory?threadId=xxx&path=`

返回当前 thread 工作目录下指定目录的一层子节点。根目录使用空 `path`。

```ts
type WorkspaceDirectoryResponse = {
  threadId: string;
  rootName: string;
  rootPathLabel: string;
  path: string;
  suggestedOpenPath?: string;
  truncated: boolean;
  warnings: string[];
  nodes: WorkspaceFileNode[];
};

type WorkspaceFileNode = {
  type: 'directory' | 'file';
  name: string;
  path: string;
  depth: number;
  hasChildren?: boolean;
  childrenLoaded?: false;
  meta?: WorkspaceFileMetaSummary;
};
```

#### `GET /workspace/files/meta?threadId=xxx&path=docs/a.md`

返回单个文件或目录元信息。

```ts
type WorkspaceFileMeta = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  kind: WorkspaceFileKind;
  mime: string;
  size: number;
  mtimeMs: number;
  versionToken: string;
  previewable: boolean;
  editable: boolean;
  readonly: boolean;
  reason?: string;
};
```

`versionToken` 由后端生成，第一版使用 `mtimeMs + size + sha256(content)`。文本文件最大 `2 MB`，hash 成本可控；非文本文件可使用 `mtimeMs + size`。

#### `GET /workspace/files/content?threadId=xxx&path=docs/a.md`

只返回文本文件内容。

```ts
type WorkspaceFileContentResponse = {
  meta: WorkspaceFileMeta;
  content: string;
  encoding: 'utf8';
};
```

若文件不可读或不是文本，返回：

1. `UNSUPPORTED_FILE_TYPE`
2. `FILE_TOO_LARGE`
3. `FILE_NOT_FOUND`

#### `POST /workspace/files/content`

保存文本文件。

```ts
type WorkspaceFileSaveRequest = {
  threadId: string;
  path: string;
  content: string;
  baseVersionToken: string;
  overwriteConflict?: boolean;
};

type WorkspaceFileSaveResponse = {
  meta: WorkspaceFileMeta;
  saved: true;
};
```

冲突处理：

1. 如果当前文件 `versionToken !== baseVersionToken`，且 `overwriteConflict !== true`，返回 `409 FILE_CONFLICT`。
2. 前端提示用户重新加载、覆盖保存或取消。
3. 覆盖保存仍必须重新做路径和权限校验。
4. 写入使用安全文件打开策略：最终路径不得跟随 symlink；写入后再次 realpath 校验，若发现路径逃逸则失败并尽力回滚。

保存端点使用 `POST` 而不是 `PUT`，原因是当前 daemon CORS 允许 `GET/POST/PATCH/DELETE/OPTIONS`，并且现有写操作主要使用 `POST/PATCH`。

#### `GET /workspace/files/blob?threadId=xxx&path=assets/a.png`

用于图片/PDF 预览。

要求：

1. 设置正确 `Content-Type`。
2. 只允许 previewable blob 类型。
3. 禁止敏感文件通过 blob 读取。
4. 可加 `Cache-Control: no-store`。
5. 该端点仍要求 Bearer token；前端不得把 URL 直接塞进 `<img src>` 或 `<object data>`。
6. 前端必须用 `fetch` 携带 Authorization 读取 Blob，再通过 `URL.createObjectURL` 渲染图片/PDF，并在切换文件或卸载组件时 `URL.revokeObjectURL`。

#### `POST /workspace/files/reveal`

打开文件或所在目录。

```ts
type WorkspaceFileRevealRequest = {
  threadId: string;
  path?: string;
  mode: 'file' | 'directory';
};

type WorkspaceFileRevealResponse = {
  ok: true;
};
```

第一版 reveal 的部署假设：

1. daemon 与用户浏览器运行在同一台桌面机器。
2. 若后续支持远程 daemon 或容器 daemon，reveal 必须降级为复制路径，不得尝试打开远端机器目录。
3. reveal 必须复用与读写相同的路径安全校验。
4. 执行系统打开命令必须使用 `execFile` 和数组参数，禁止 shell 字符串插值。
5. macOS 使用 `open -R <file>` 或 `open <dir>`。
6. Windows/Linux 第一版返回 `REVEAL_UNAVAILABLE`，除非实现并测试 `explorer`/`xdg-open` 的安全调用。

### 7.7 错误码

```ts
type WorkspaceFileErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'PATH_INVALID'
  | 'PATH_ESCAPE'
  | 'PATH_IGNORED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_NOT_EDITABLE'
  | 'FILE_CONFLICT'
  | 'PERMISSION_DENIED'
  | 'REVEAL_UNAVAILABLE'
  | 'INTERNAL_ERROR';
```

错误响应沿用 OpenCreator Runtime 现有 `{ error: { code, message, details } }` 结构。

实现要求：

1. 扩展 `packages/protocol/src/errors.ts` 的 `RuntimeErrorCode` union，加入文件错误码。
2. 增强 `apps/daemon/src/api/errors.ts` 的 `apiError`，支持可选 `details`。
3. 文件模块不得绕开统一错误结构返回 ad hoc JSON。

## 8. 支持文件类型

### 8.1 可预览并可编辑

文本和源码类：

1. Markdown：`.md`, `.markdown`
2. 普通文本：`.txt`, `.log`
3. 字幕：`.srt`
4. JSON：`.json`, `.jsonc`, `.jsonl`
5. YAML：`.yaml`, `.yml`
6. TOML：`.toml`
7. CSV：`.csv`
8. XML：`.xml`
9. HTML：`.html`, `.htm`
10. CSS：`.css`, `.scss`, `.sass`, `.less`
11. JavaScript：`.js`, `.jsx`, `.mjs`, `.cjs`
12. TypeScript：`.ts`, `.tsx`
13. Shell：`.sh`, `.bash`, `.zsh`
14. Python：`.py`
15. 环境示例：`.env.example`, `.env.sample`
16. 常见配置：`.gitignore`, `.npmrc`, `.prettierrc`, `.eslintrc`

第一版只保证基础文本编辑，不承诺 IDE 级语言服务。

### 8.2 可预览但不编辑

图片：

1. `.png`
2. `.jpg`
3. `.jpeg`
4. `.gif`
5. `.webp`

SVG：

1. `.svg` 第一版按文本源码查看和编辑，不作为图片执行预览。
2. 不使用 `<object>`、iframe 或 inline SVG 渲染 SVG。
3. 后续若要做 SVG 图像预览，只能使用受限 `<img>` 路径，并单独补安全评审。

PDF：

1. `.pdf`

### 8.3 不可预览

二进制、媒体、归档、数据库、证书密钥类：

1. `.zip`
2. `.tar`
3. `.gz`
4. `.rar`
5. `.7z`
6. `.db`
7. `.sqlite`
8. `.sqlite3`
9. `.mp4`
10. `.mov`
11. `.webm`
12. `.mp3`
13. `.wav`
14. `.m4a`
15. `.pem`
16. `.key`
17. `.p12`
18. `.crt`
19. `.cert`
20. `id_rsa`
21. `id_ed25519`
22. `.env`
23. `.env.local`
24. `.env.production`
25. `.env.development`
26. `.env.test`
27. `credentials.json`
28. `service-account.json`
29. `service-account*.json`
30. `*.secret`

不可预览并不表示不显示。UI 应显示文件名、路径、大小、mime/kind、不可预览原因，并提供打开所在目录、复制路径。

敏感文件黑名单是用户体验层的尽力保护，不是完整安全边界。真正的安全边界仍是路径不逃逸、thread sandbox 权限校验、敏感文件重复拦截和后端统一鉴权。

## 9. 前端设计

### 9.1 页面模型

文件功能作为会话工作区内的并排面板打开，不再跳转到独立 `activeView: 'files'` 页面。

前端状态建议：

1. `activeView` 继续保持 `conversation`。
2. 使用 `rightPanelMode: 'file'` 或等价状态表示文件工作区已展开。
3. `rightPanelMode: 'file'` 不渲染旧 `DetailPanel`，而是在主工作区内渲染会话 + 文件工作区的分栏布局。
4. 旧的 `activeView: 'files'` 若已存在，应降级为兼容入口或逐步移除，不能作为会话顶部“文件”按钮的跳转目标。

主布局：

```text
┌──────────────┬───────────────────────────────────────────────────────┐
│ OpenCreator 菜单   │ 会话区                         Codex-like 文件工作区    │
│              │                                顶部文件 Tab / breadcrumb│
│ 项目          │ 消息 / 思考过程 / 结果          编辑器          文件树    │
│ 会话          │ 输入框                                                  │
│ 搜索          │                                                       │
│ 已安排        │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

文件视图：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 打开文件   [ProjectView.tsx  x]   [+]                         [布局] │
├──────────────────────────────────────────────────────────────────────┤
│ content-design > apps > web > src > components > ProjectView.tsx  打开 │
├───────────────────────────────────────────────┬──────────────────────┤
│  1  import {                                  │  筛选文件...          │
│  2    useCallback,                            │                      │
│  3    useEffect,                              │  ▾ apps               │
│  4    useMemo,                                │    ▾ web              │
│  5  } from 'react';                           │      ▾ src            │
│                                               │        ▾ components   │
│     文件编辑器 / 预览区                        │          ProjectView  │
│     行号 / 语法高亮 / 可编辑                   │          Prompt...     │
│     Cmd/Ctrl+S 保存                            │          Toast.tsx    │
│                                               │        package.json   │
│                                               │        README.md      │
└───────────────────────────────────────────────┴──────────────────────┘
```

### 9.2 组件结构

```text
apps/web/src/features/files/
  FileWorkspaceView.tsx
  FileTopBar.tsx
  FilePathBar.tsx
  FileTabs.tsx
  FileEditorPane.tsx
  TextFileEditor.tsx
  MarkdownFilePreview.tsx
  ImageFilePreview.tsx
  PdfFilePreview.tsx
  UnsupportedFileState.tsx
  ProjectFileTree.tsx
  file-view-state.ts
```

第一版可以只支持一个 active tab，但状态结构按多 tab 预留：

```ts
type OpenFileTab = {
  id: string;
  path: string;
  name: string;
  kind: WorkspaceFileKind;
  dirty: boolean;
};
```

### 9.3 顶部栏

顶部第一行：

1. `打开文件`
   - 点击后进入文件树搜索焦点。
   - 后续可扩展为 quick open。
2. 文件 Tab
   - 显示当前打开文件。
   - dirty 时显示 `*`。
   - 第一版只保留一个 tab，关闭后回到文件空态。
3. `+`
   - 打开项目内 quick open，不做新建文件。
   - 若 quick open 未在同一阶段实现，则不显示 `+`，不能放置无功能按钮。
4. 布局按钮
   - 第一版提供隐藏/显示文件树。
   - 若该能力未实现，则不显示布局按钮，不能放置无功能按钮。

顶部第二行：

1. breadcrumb：从项目根到当前文件。
2. `打开` 下拉：
   - 在系统中打开文件。
   - 打开所在目录。
   - 复制相对路径。
   - 复制绝对路径。

### 9.4 文件树

行为：

1. 搜索框 placeholder：`筛选文件...`
2. 目录可展开/收起。
3. 当前文件自动展开父目录并高亮。
4. 默认展开到当前文件所在路径。
5. 文件排序：目录优先，同级按名称自然排序。
6. 搜索时保留路径上下文。
7. 空目录显示“当前目录为空”。
8. 当前工作区无文件显示“当前工作区暂无可显示文件”。
9. 展开目录时调用 `GET /workspace/files/directory` 懒加载下一层。
10. 单目录截断时显示“当前目录文件较多，仅显示前 500 项”。
11. 文件分类权威在后端，前端只按 meta 的 `kind/previewable/editable/readonly` 选择渲染器，不重复维护扩展名分类表。

### 9.5 编辑器/预览区

文本文件：

1. 第一版编辑器使用 CodeMirror 6。
2. 显示行号。
3. 支持语法高亮，语言包按需懒加载。
4. 支持编辑。
5. `Cmd/Ctrl + S` 保存。
6. dirty 时 tab 和路径栏显示标记。
7. 保存中显示轻量状态。
8. 保存失败显示错误条。
9. 只读模式不可编辑。

Markdown：

1. 支持源码编辑。
2. 支持预览切换。
3. 复用现有 `MarkdownRenderer`。
4. 第一版不做左右同步滚动。

JSON：

1. 预览时格式化。
2. 编辑时保留原文。
3. JSON 无效时预览显示解析错误，但仍允许编辑原文。

HTML：

1. 第一版作为源码查看/编辑。
2. 不执行 HTML。
3. 不创建 iframe live preview。

图片：

1. 通过 runtime client `fetch` `/workspace/files/blob`，携带 Authorization。
2. 将响应 Blob 转为 `objectURL` 后渲染。
3. 切换文件或组件卸载时释放 `objectURL`。
4. 按容器自适应显示。
5. 提供打开所在目录和复制路径。
6. 不编辑。

PDF：

1. 通过 runtime client `fetch` `/workspace/files/blob`，携带 Authorization。
2. 将响应 Blob 转为 `objectURL` 后交给 `<object>` 或浏览器 PDF viewer。
3. 切换文件或组件卸载时释放 `objectURL`。
4. 加载失败时显示不可预览状态。
5. 不编辑。

不可预览文件：

```text
无法预览此文件

文件：archive.zip
类型：application/zip
大小：18.4 MB
原因：二进制文件暂不支持预览

[打开所在目录] [复制路径]
```

## 10. 权限设计

文件编辑权限以 thread 的 `SandboxMode` 为唯一真相源，不能只是前端展示。

权限规则：

1. `read-only`
   - 可看目录树。
   - 可预览允许读取的文件。
   - 编辑器只读。
   - 保存 API 返回 `PERMISSION_DENIED`。
2. `workspace-write`
   - 可编辑当前 thread `cwd` 内文本文件。
   - 不能写 `cwd` 外路径。
3. `danger-full-access`
   - Codex run 可以有更大权限。
   - 文件面板第一版仍只允许访问当前 thread `cwd`。

前端项目模型里的 `follow-global` 不是 daemon 文件模块权限。实现阶段必须在创建 thread 或切换会话前将 `follow-global` 解析为具体 `SandboxMode`，并把最终 `sandbox` 写入 thread。文件模块不接收、不解析 `follow-global`。

这解决“只读模式下仍能生成文件却没有提醒”的体验问题：文件面板必须明确当前权限，并由后端强校验。

## 11. 状态流

### 11.1 打开文件工作区

1. 用户从会话顶部、变更卡片或项目入口进入文件视图。
2. 前端保持 `activeView: 'conversation'`，在会话内展开文件工作区。
3. 确认存在 active thread；若从项目入口进入且没有 active thread，先创建或选择该项目下的 active thread。
4. 调用 `GET /workspace/files/directory?threadId=...&path=`。
5. 读取本地最近打开文件状态。
6. 若最近文件存在，打开该文件。
7. 若 directory 响应提供 `suggestedOpenPath`，优先打开该文件。
8. 若不存在，按顺序选择：
   - `README.md`
   - `readme.md`
   - `package.json`
   - 第一个 Markdown 文件
   - 第一个文本/源码文件
   - 第一个可预览文件
   - 空态

### 11.2 点击文件

1. 点击文件树节点。
2. 若当前文件 dirty，弹出确认。
3. 调用 `GET /workspace/files/meta`。
4. 根据 `kind` 调用 content 或 blob。
5. 渲染编辑器、预览器或不可预览状态。

### 11.3 保存文件

1. 用户编辑文本。
2. 当前 tab 标记 dirty。
3. 用户按 `Cmd/Ctrl + S` 或点击保存。
4. 调用 `POST /workspace/files/content`，带 `baseVersionToken`。
5. 后端检查权限、路径、文件类型、大小和冲突。
6. 成功后更新 meta，dirty=false。
7. 409 冲突时显示冲突操作：
   - 重新加载。
   - 覆盖保存。
   - 取消。

### 11.4 切换会话或项目

1. 清空当前文件树。
2. 如果当前文件 dirty，先确认。
3. 切换到新 active thread。
4. 加载新 thread 的根目录。
5. 按 `canonicalCwdHash` 恢复最近打开文件。

## 12. 前端服务

新增 `apps/web/src/services/workspace-file-service.ts`：

```ts
export function createWorkspaceFileService(client: RuntimeClient) {
  return {
    listDirectory(threadId: string, path: string): Promise<WorkspaceDirectoryResponse>;
    getMeta(threadId: string, path: string): Promise<WorkspaceFileMeta>;
    openText(threadId: string, path: string): Promise<WorkspaceFileContentResponse>;
    saveText(input: WorkspaceFileSaveRequest): Promise<WorkspaceFileSaveResponse>;
    openBlob(threadId: string, path: string): Promise<{ objectUrl: string; mime: string; size: number }>;
    revokeBlob(objectUrl: string): void;
    reveal(input: WorkspaceFileRevealRequest): Promise<WorkspaceFileRevealResponse>;
  };
}
```

现有 `apps/web/src/services/file-service.ts` 的 mock 服务不再作为真实文件工作区依赖。实现阶段可保留测试用 mock，但生产路径必须走 runtime client。

## 13. 持久化

第一版前端本地持久化：

1. 每个 workspace 最近打开文件路径。
2. 当前 workspace 文件树展开状态。
3. 文件树搜索值不持久化。
4. 未保存草稿不跨刷新持久化，避免用户以为已保存到真实文件。

workspace key 使用 `canonicalCwd` 的稳定 hash，不使用前端展示型 `projectId` 或可变目录名。前端可从 thread response 的 `canonicalCwd` 计算 hash；hash 只作为本地 UI 状态 key，不传给 daemon 做安全决策。

固定 key：

```text
opencreator.files.recentOpenByWorkspace
opencreator.files.expandedPathsByWorkspace
```

## 14. 测试方案

### 14.1 daemon 单元测试

覆盖：

1. 相对路径正常解析。
2. 绝对路径被拒绝。
3. `../` 被拒绝。
4. 空字符路径被拒绝。
5. symlink 指向项目外部被拒绝。
6. ignored 目录不进入树。
7. `.env` 不可读取。
8. `.env.example` 可读取。
9. 文本文件大小超限不可编辑。
10. 图片/PDF meta previewable 正确。
11. 二进制文件不可预览。
12. 外部修改导致 `versionToken` 变化并返回 `FILE_CONFLICT`。
13. `overwriteConflict=true` 后可覆盖保存。
14. 只读权限保存返回 `PERMISSION_DENIED`。
15. `.svg` 归类为文本源码查看，不进入图片 blob 预览。

### 14.2 daemon 集成测试

使用 Fastify `server.inject`：

1. `GET /workspace/files/directory` 返回真实临时目录的一层子节点。
2. `GET /workspace/files/content` 返回文本内容。
3. `POST /workspace/files/content` 写入真实文件。
4. `GET /workspace/files/blob` 在带 Bearer token 时返回图片/PDF content type。
5. `POST /workspace/files/reveal` 在测试环境可 mock reveal executor。
6. 未授权请求仍返回 401。
7. 错误响应不泄漏本机绝对敏感路径。
8. 浏览器 CORS 预检允许 `POST /workspace/files/content`。
9. blob 端点无 Authorization 时返回 401，前端必须通过 runtime client fetch。
10. `RuntimeErrorCode` 扩展后的文件错误码可通过 `apiError` 返回。

### 14.3 前端单元测试

覆盖：

1. 文件树渲染目录和文件。
2. 目录展开/收起。
3. 搜索过滤保留父级上下文。
4. 当前文件高亮。
5. dirty tab 标记。
6. 保存按钮启用/禁用。
7. 只读模式禁用编辑。
8. 不可预览文件状态展示。
9. Markdown 预览复用 `MarkdownRenderer`。
10. JSON 无效时展示错误。
11. CodeMirror 编辑器收到只读状态时不可编辑。
12. objectURL 在切换文件或卸载时被释放。

### 14.4 前端集成测试

覆盖：

1. 进入文件视图加载树。
2. 点击 `.md` 显示内容并可切换预览。
3. 点击 `.ts` 显示源码和行号。
4. 编辑并保存调用 `POST /workspace/files/content`。
5. 409 冲突显示处理入口。
6. 点击图片时通过 `openBlob` 获取 objectURL 并显示图片预览。
7. 点击不可预览文件显示原因和打开目录按钮。
8. 切换会话或项目重新加载 active thread 的文件树。

### 14.5 浏览器功能测试

使用 Playwright 或现有浏览器测试流程：

1. 启动 daemon 和 web。
2. 创建临时项目目录，包含：
   - `README.md`
   - `package.json`
   - `src/App.tsx`
   - `docs/design.md`
   - `assets/logo.png`
   - `docs/sample.pdf`
   - `archive.zip`
3. 进入项目文件视图。
4. 验证文件树、搜索、展开/收起。
5. 打开并编辑 `README.md`。
6. 刷新磁盘文件，确认内容已保存。
7. 验证图片/PDF/不可预览状态。
8. 验证路径逃逸请求失败。

## 15. 验收标准

功能验收：

1. 打开文件视图后看到当前 thread `cwd` 的真实目录树。
2. 文件树不是 mock 数据。
3. 点击 `.md/.ts/.json/.txt` 能看到真实内容。
4. 文本文件能编辑并保存到真实磁盘文件。
5. 只读模式不能保存，并且 UI 有明确提示。
6. 图片能预览。
7. PDF 能预览或显示明确失败原因。
8. `.zip/.db/.mp4` 等不可预览文件不显示空白页。
9. 不可预览文件能打开所在目录。
10. 搜索文件树能过滤结果。
11. 展开/收起目录正常。
12. 刷新页面后当前 workspace 最近打开文件可恢复。
13. `../`、绝对路径、symlink 逃逸都被后端拒绝。

体验验收：

1. 整体布局接近用户提供的 Codex 文件视图。
2. 文件视图和会话同屏显示，不是独立跳转页，也不是右侧详情面板。
3. 编辑器和文件树区域稳定，不因加载、hover、长文件名而跳动。
4. 保存、冲突、错误都有明确反馈。
5. 不伪造文件能力，不出现 mock 文件冒充真实文件。

## 16. 实施分期

### R1：后端文件 API 基础

1. 新增 workspace-files service。
2. 实现路径安全、mime/kind、懒加载目录、文本读写和 blob 读取。
3. 注册 API routes。
4. 扩展 `RuntimeErrorCode` 和 `apiError(details)`。
5. 补 daemon 单元和集成测试。

### R2：前端服务和状态

1. 新增 `workspace-file-service`。
2. 会话内新增文件工作区展开状态。
3. 接入 active thread、`canonicalCwdHash` 最近打开文件、展开状态。
4. 重构 `App.tsx` 中与 `rightPanelMode: 'file'`、`selectedFilePath`、draft/save/load/error 相关的旧 mock 文件状态，文件主路径改走 `workspace-file-service`。

### R3：Codex-like 文件工作区 UI

1. 实现 `FileWorkspaceView`。
2. 实现会话 + 文件工作区同屏布局、顶部栏、breadcrumb、文件树。
3. 接入 CodeMirror 6 文本编辑器、Markdown/JSON/源码预览。
4. 实现图片/PDF/不可预览状态。

### R4：编辑保存和冲突处理

1. 支持 dirty 状态。
2. 支持 `Cmd/Ctrl + S`。
3. 支持保存成功/失败反馈。
4. 支持外部修改冲突提示和覆盖保存。

### R5：功能测试和体验打磨

1. 完整跑 daemon、web、浏览器功能测试。
2. 对照 Codex 截图修 UI 密度、间距和布局。
3. 验证只读、workspace-write、danger-full-access 的实际表现。

## 17. 风险与对策

### 17.1 项目模型和 cwd 来源不够统一

风险：当前前端项目列表有静态项目，也有从 runtime thread 派生的项目。

对策：第一版文件 API 不使用 `projectId` 作为后端文件根，统一使用 `threadId`。项目仍是前端分组概念；从项目入口进入文件视图时，前端必须先选定或创建 active thread，再用 thread 的 `canonicalCwd` 打开文件视图。项目模型统一作为后续独立设计，不阻塞本阶段。

### 17.2 文件树加载太慢

风险：大型项目目录较深、单目录文件较多，加载和渲染会卡顿。

对策：第一版采用目录懒加载，不做全量递归扫描。单目录最多返回 `500` 个子节点，超过时返回 truncated 和 warning。忽略常见大目录，文件树搜索只在已加载节点内过滤，后续再单独设计全局文件搜索。

### 17.3 编辑器依赖和体积

风险：引入编辑器依赖会增加包体积和按语言加载复杂度。

对策：第一版直接使用 CodeMirror 6，不自研行号、高亮和可编辑组合。语言包按需懒加载，先覆盖 Markdown、JSON、HTML/CSS/JS/TS、Python、Shell、XML/YAML/TOML。

### 17.4 HTML 预览安全

风险：HTML live preview 会涉及脚本执行和相对资源加载。

对策：第一版只做 HTML 源码查看/编辑，不运行 HTML。后续单独设计 sandbox preview。

### 17.5 只读权限形同虚设

风险：前端禁用编辑，但后端仍允许保存。

对策：后端保存 API 必须检查最终有效权限。测试必须覆盖只读保存被拒绝。

## 18. 结论

第一版文件功能应采用“daemon 真实文件 API + Codex-like 主工作区 UI”的方案。

该方案满足用户核心目标：

1. 文件能力是真实本机项目文件能力。
2. UI 形态贴近 Codex 文件视图。
3. 目录树、预览、编辑保存、不可预览处理都在范围内。
4. 范围控制在当前 thread `cwd`，避免演变成完整文件管理器。
5. 后续桌面版可以复用同一套 runtime API 和前端组件。
