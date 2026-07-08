# Clawee Codex-like 文件工作区设计评审

评审对象：`docs/superpowers/specs/2026-07-08-clawee-codex-like-file-workspace-design.md`
评审角色：高级架构师
评审基准：已核对当前代码库（`apps/daemon`、`apps/web`、`packages/protocol`）真实实现

## 0. 总体结论

方案方向（daemon 真实文件 API + Codex-like 主工作区 UI）是正确的，范围裁剪（只访问项目 `cwd`、不做文件管理器）也合理。但设计里有**多处对现有代码库的假设与实际不符**，其中至少 3 处是"按文档直接实现就会跑不起来"的硬伤，还有若干安全/部署模型问题被一句"后续增强"带过。

结论：**方向通过，细节不通过，需要修订后再进入实施。** 下面按严重程度分级。

---

## 1. 阻断级问题（不修无法落地）

### B1. `projectId` 在 daemon 侧无法解析——整个后端契约的地基是空的

设计 6/7.2/12 章所有 API 都以 `projectId` 为入口，并轻描淡写地说"新增 `WorkspaceProjectResolver` 把 projectId 解析为 cwd"。但实际情况是：

- daemon **完全没有 project 概念**。`grep project apps/daemon/src` 无任何业务命中，daemon 只有 `threads`（`apps/daemon/src/threads/`）。
- 前端的 `projectId` 是**纯前端捏造**的：
  - 静态项目来自 `apps/web/src/features/projects/project-model.ts`，id 是硬编码字符串（`content-design`、`playground`…），cwd 是硬编码的 `~/develop/...`；
  - 运行时项目 id 来自 `App.tsx:844` 的 `projectIdFromCwd`，形如 `cwd-<目录名小写>`，由 `thread.cwd` 现算。

也就是说，daemon 收到 `projectId=content-design` 或 `projectId=cwd-bili` 后，**没有任何数据源能把它映射回 cwd**。设计 7.2 第 3 点说"预置项目必须迁移为 daemon 可读取的配置或 API"，这不是一句实现要求，而是一个**独立的、体量不小的前置工程**（需要 daemon 侧新建 project 存储/迁移前端静态列表/统一 id 生成规则），却被塞进 R1 的一个 bullet。

**要求：**
1. 在进入 R1 之前，先出一份"项目模型统一"的子设计，明确 project 的**权威存储位置**（daemon DB？runtime thread 派生？两者合并？）和 **id 生成规则**（必须稳定、可被 daemon 反解）。
2. 或者，第一版直接**放弃 projectId 抽象，改用 `threadId` 作为文件根入口**——因为 daemon 已经有 `RuntimeThread.canonicalCwd`（`threads/types.ts:16`）这个可信字段。文件视图从"当前会话"进入本就自然。这条路径能绕开整个项目模型迁移，强烈建议第一版采用。

### B2. `PUT` 方法会被 CORS 直接拦截

设计 7.6 用 `PUT /workspace/files/content` 保存文件。但 `apps/daemon/src/api/server.ts:58` 的 CORS 配置是：

```
methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
```

**没有 `PUT`。** 浏览器预检 `OPTIONS` 会拒绝 `PUT`，保存功能直接不可用。

**要求：** 要么把保存改为 `POST /workspace/files/content` 或 `PATCH`（与现有约定一致，现有写操作都是 POST/PATCH），要么显式在 CORS methods 里加 `PUT`。建议改 `POST`/`PATCH`，与仓库现状对齐，避免为一个端点动全局 CORS。

### B3. blob 预览（图片/PDF）无法通过 Bearer 鉴权

设计 12 章的 `blobUrl(projectId, path): string` 返回一个 URL，供 `<img src>` / `<object data>` 使用（9.5 图片/PDF 明确用 `/workspace/files/blob`）。但：

- daemon 的 `preHandler`（`server.ts:128`）对**除 `/healthz` 外的所有请求**强制 `Bearer` token 鉴权（`auth.ts:6`）。
- `<img>` / `<object>` 由浏览器发起，**无法携带 `Authorization` 头**。

结果：所有 blob 预览请求返回 401，图片/PDF 永远加载失败。设计 14.2 还写了"未授权仍返回 401"作为验收项，与 blob 预览需求**自相矛盾**。

**要求：** 明确 blob 的鉴权方案。可选：
1. 短时效签名 query token（`?token=...` 或专用一次性 ticket），blob 路由单独放行 preHandler；
2. 或前端 `fetch` blob 后转 `objectURL`（`URL.createObjectURL`）——能带 header，但要处理内存释放，且 PDF 用 objectURL + `<object>` 兼容性要验证。
建议方案 2（fetch → objectURL），安全性最好，代价是 `blobUrl` 不再是同步 `string`，服务接口签名要改成异步。设计需据此修正 12 章接口。

---

## 2. 严重级问题（会导致返工或安全隐患）

### S1. 权限模型是两套互不兼容的枚举拼在一起，且"最终权限"来源未定义

设计第 10 章列了 4 种权限：`read-only` / `workspace-write` / `danger-full-access` / `follow-global`。但代码里存在**两套不同的枚举**：

- `packages/protocol/src/api.ts:3`：`SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'`（**无 follow-global**）
- `apps/web/src/features/projects/project-model.ts:1`：`ProjectPermission = 'follow-global' | 'workspace-write' | 'danger-full-access'`（**无 read-only**）

设计把两套并集当成一套用。更关键的是：**没有任何地方定义 `follow-global` 的"全局默认"落到哪个具体权限**。`grep follow-global apps/daemon` 在 daemon 侧毫无命中——它只是前端/run 请求里的一个值。设计 10.4 说"后端解析最终有效权限"，但后端目前根本没有这个解析器，也没有"全局默认权限"的存储。

**要求：**
1. 明确文件写权限判定的**唯一真相源**：是复用 run 的 `SandboxMode`，还是新引入 project 级权限？
2. 明确 `follow-global` 解析规则和全局默认值存在哪、由谁读。
3. 统一枚举：要么文件模块只认 `SandboxMode`（把 read-only 纳入、把 follow-global 在边界解析掉），别在设计里混用两套词汇。

### S2. `reveal` 的 daemon 部署模型未定义，且是需要审视的能力

设计 7.6 的 `reveal` 在 daemon 侧执行 `open -R <file>` / `open <dir>`。两个问题：

1. **部署模型假设未言明**：这假设 daemon 与用户浏览器在**同一台桌面机**。一旦 daemon 跑在远程/容器（Clawee 的 runtime 是 CLI daemon，完全可能远程），`open` 打开的是 daemon 机器的 Finder，用户什么都看不到。设计通篇没交代 daemon 的部署形态，而 reveal、`~` 展开、realpath 都强依赖"daemon=本机"。**必须显式声明第一版假设 daemon 与用户同机，否则 reveal 该降级为"复制路径"。**
2. **能力面**：让前端触发 daemon 执行 shell `open`，即使路径受限，也是把一个"执行本机命令"的口子暴露给了 web。参数必须走 `execFile`（数组参数，禁止 shell 插值），路径必须先过与读写完全相同的安全校验后再传给 `open`。设计只说"macOS 用 `open -R`"，没提这些约束，也没提 Windows/Linux 的降级（`explorer`/`xdg-open` 或直接不支持）。

### S3. 错误码体系与现有 `RuntimeErrorCode` 不兼容

设计 7.7 新增 12 个 `WorkspaceFileErrorCode`，并说"沿用现有 `{error:{code,message,details}}`"。但：

- `apiError(code, message)`（`apps/daemon/src/api/errors.ts:3`）的 `code` 类型是 `RuntimeErrorCode`（固定 union，`packages/protocol/src/errors.ts`），**新错误码一个都不在里面**，直接调用会 TypeScript 编译不过。
- 该 helper **不接受 `details` 参数**（虽然 `ApiError` 类型允许 `details?`，但 helper 没暴露）。

**要求：** 明确是"扩展 `RuntimeErrorCode` union + 增强 `apiError` 支持 details"，还是"文件模块自建错误映射层"。这决定了要不要动 `packages/protocol`。设计现在的措辞给人"直接就能用"的错觉。

### S4. 一次性全量扫描 5000 节点，在本仓库这种带巨型子目录的项目上会踩雷

设计 7.5/9.4 是"一次性递归扫整棵树、超过 5000 截断"。风险 17.2 的对策是"后续再加懒加载"。问题在于**默认忽略清单（7.4）不够**：本仓库根目录就有 `codex-main`（47 项）、`open-design-main`（53 项）这类未被 ignore 的巨型子目录，会被全量深扫。任何 clone 了子项目/vendored 源码的目录都会命中。

- 全量深扫 + 5000 截断意味着：要么扫描慢（同步递归会阻塞事件循环），要么在 5000 处截断得莫名其妙，用户看不到想要的文件。

**要求：** 第一版就应做**目录懒加载**（点开目录才拉下一层），而不是全量树 + 截断。这不是"后续增强"，而是决定第一版可用性的基础决策。若坚持全量，至少要：异步遍历（不阻塞）、node 上限下调、并明确截断策略是"广度优先保浅层"。

---

## 3. 需要修正的设计缺陷（中等）

### M1. 冲突检测只用 `mtimeMs` 不可靠
7.6 用 `baseMtimeMs !== 当前 mtimeMs` 判冲突。mtime 存在：部分文件系统精度只有秒级；外部工具可能重置/保留 mtime；快速连续保存 mtime 可能不变。建议 `mtimeMs + size` 联合判定，或直接用内容 hash（文件不大，2MB 上限内 hash 成本可接受）。

### M2. 写入存在 TOCTOU，realpath 校验后到写入前仍可被 symlink 抢占
7.3 的 realpath 校验思路正确，但"校验通过→open 写入"之间存在时间窗，攻击/意外可在此期间把路径替换为指向根外的 symlink。建议写入用 `O_NOFOLLOW`（对最终文件节点），或写入后再次 realpath 校验并在失败时回滚。作为安全加固项写进设计。

### M3. `.svg` 归入"图片预览"有 XSS 风险，需特判
8.2 把 `.svg` 当图片。若用 `<img src>` 加载相对安全；但 SVG 可内嵌 `<script>`，一旦哪天改成 inline 渲染或用 objectURL 在同源加载，就是存储型 XSS。设计应显式规定：SVG 只走 `<img>`/受限渲染，或第一版把 SVG 降级为"按文本源码查看"。

### M4. 敏感文件黑名单必然不全
7.4/8.3 用扩展名+文件名黑名单挡密钥文件（`.env`、`.pem`、`id_rsa`…）。黑名单天然漏：`.env.local`、`.env.production`、`credentials.json`、`*.secret`、`service-account*.json` 等都不在列。设计已把"文本默认可读 + 黑名单"作为策略，风险就是漏网。建议：扩充为更完整的 glob 集合，并在设计里明确"黑名单是尽力而为、非安全边界"，真正的边界是路径不逃逸 + 权限校验。

### M5. 前端持久化 key 用 `projectId`，而 projectId 不稳定
13 章用 `clawee.files.recentOpenByProject`（key=projectId）。但运行时项目 id 是 `cwd-<目录名>`（`App.tsx:846`），目录改名/移动就变，recent/expanded 状态会静默丢失。若采纳 B1 的 threadId 方案则同理需固定。建议用 **canonicalCwd 的稳定 hash** 作为持久化 key，而非易变的展示型 id。

### M6. `kind` 分类前后端双份，未定单一真相源
第 8 章后端定 kind/editable/previewable，9.2 前端又有 `file-kind.ts`。两处扩展名表极易漂移。应明确：**分类权威在后端**（meta 已带 `kind/previewable/editable/readonly`），前端只按后端返回的 kind 选渲染器，`file-kind.ts` 只做"kind→组件"映射，不重复维护扩展名表。

### M7. 移除 mock `file-service` 主路径依赖被低估
R2 一句"移除文件主路径对 mock file-service 的依赖"，但 `App.tsx` 已深度耦合 `selectedFilePath / rightPanelMode:'file' / draftContentByPath / savedFileByPath / loadErrorByPath / saveErrorByPath` 等一大片状态（见 App.tsx:305-366）。这是一次实打实的状态重构，工作量应单列，不能算作 bullet。

### M8. 编辑器选型含糊会拖累 R3/R4
风险 17.3 说"先用轻量文本编辑器加行号和基础高亮"。但需求（行号+语法高亮+可编辑+JSON 无效仍可编辑+Cmd/Ctrl+S）自研并不轻，且做出来的东西体验差、还要返工换成成熟编辑器。建议**第一版直接定 CodeMirror 6**（体积可控、按语言懒加载），把"选型"从风险变成决策，避免 R3/R4 被编辑器基础能力反复卡。

---

## 4. 建议明确但非阻塞（轻微）

- **L1**：`blob` 的 20MB/50MB size gate 对已流式返回的场景意义有限；真正该防的是"别把 200MB 视频当图片塞进 `<img>`"，size 判定应在 meta 阶段就决定 previewable，而非到 blob 才拦。设计已有此意，建议明确 gate 发生在 meta。
- **L2**：14 章测试计划扎实，但缺 **B2/B3（CORS+blob 鉴权）** 的回归用例。修完 B2/B3 后必须补：`POST/PATCH 保存能通过 CORS`、`blob 在无 Authorization 头时的鉴权路径`。
- **L3**：`WorkspaceFileNode` 里 `children` 和"懒加载"冲突——若采纳 S4 懒加载，node 应带 `hasChildren`/`childrenLoaded` 而非直接内嵌 `children`。设计需与最终扫描策略对齐。
- **L4**：11.1 打开视图的默认文件回退链（README→package.json→…）会**逐个探测 meta**，对大项目多几次往返。可在 tree 响应里直接带一个 `suggestedOpenPath`，由后端一次算好。
- **L5**：设计未提**并发保存/多标签下同一文件**的处理。虽然第一版单 tab，但 `OpenFileTab[]` 结构已预留多 tab，建议一句话说明第一版单文件、冲突以 mtime/hash 为准即可，避免后面歧义。

---

## 5. 修订前必须回答的问题清单

1. 文件根入口用 `projectId` 还是 `threadId`？（B1）——建议 threadId。
2. daemon 与用户浏览器是否保证同机？reveal 是否第一版就要，还是降级为复制路径？（S2）
3. 文件写权限的唯一真相源是什么？`follow-global` 解析到哪、默认值存哪？（S1）
4. 保存端点用 POST 还是 PATCH？（B2）
5. blob 鉴权走签名 token 还是 fetch→objectURL？（B3）
6. 错误码是扩 `RuntimeErrorCode` 还是自建映射层？（S3）
7. 目录树第一版是否懒加载？（S4）

以上 1、2、3、5 属于必须在实施前拍板的架构决策，建议以 `AskUserQuestion` 或补充子设计的方式先行确认，再修订本设计文档进入 R1。

---

## 6. 一句话总结

设计的产品形态和范围裁剪是对的，但"projectId 解析、CORS 放行 PUT、blob 鉴权、权限模型、错误码"这几处把"现有代码库已经支持"当成了默认前提，而代码库并不支持。建议：**改用 threadId 作根、保存改 POST/PATCH、blob 走 fetch+objectURL、权限统一到 SandboxMode、目录树第一版即懒加载**，并把项目模型统一与 App.tsx 状态重构单列为前置工作项，然后再启动 R1。
