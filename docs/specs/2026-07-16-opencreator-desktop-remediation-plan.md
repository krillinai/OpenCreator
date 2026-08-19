# OpenCreator Desktop 全面审查整改规格与实施计划

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 文档状态 | 整改实施与本机发布候选验收完成，外部平台项部分阻塞 |
| 版本 | 1.3 |
| 创建日期 | 2026-07-16 |
| 最近实施验收 | 2026-07-16 |
| 上游规格 | `docs/specs/2026-07-15-opencreator-desktop-app-host-design.md` |
| 审查报告 | `docs/test-reports/opencreator-desktop-final-acceptance.md` |
| 适用范围 | Electron Main、Preload、Bootstrap、Daemon、Runtime 代理、通知、迁移、日志、更新、打包和验收 |
| 实施约束 | 当前分支、当前工作区实施；禁止使用 Git Worktree；不得回退用户现有修改 |

本文用于修复 2026-07-16 全面复审中发现的安全、可靠性、性能和验收证据问题。用户已确认按本文直接执行；当前实现、测试、离线打包和 macOS arm64 发布候选验收已完成，Windows CI/实机、正式签名、公证和真实升级继续按实际状态保留为 `BLOCKED_ENV`。

### 0.1 实施结果总览

| 阶段 | 状态 | 证据摘要 |
|---|---|---|
| Phase A：P0 安全边界 | DONE | Runtime 严格同源、Renderer Token 隔离、Probe 工具禁用、结构化超时与回收测试通过 |
| Phase B：P0 启动与恢复 | DONE | Bootstrap 优先展示、Worker 迁移、Resolver、Capability、静态资源和 Renderer Ready 已实现并通过自动化 |
| Phase C：P1 可靠性与性能 | DONE | 通知确认语义、窗口写入合并、异步日志、诊断脱敏、有界输出、CORS 和深链接测试通过 |
| Phase D：P2 发布工程 | DONE / BLOCKED_ENV | 更新、Fuses、离线打包、构建清单、macOS packaged E2E、真实 Codex 和本地 OSV 已通过；Windows 与正式发布凭据待外部环境 |

本文后续任务级验收清单保留原始验收定义。最终状态和本轮命令证据以本节及 `docs/test-reports/opencreator-desktop-final-acceptance.md` 为准；未实际运行的平台项不得因代码已实现而视为 `PASS`。

## 1. 实施前复审结论

1. 原方案总体方向正确，但低估了开发代理、 Dashboard 空白页、通知重试、迁移 ABI、更新失败恢复和打包产物串用的复杂度。
2. Migration Worker 不再加载 `better-sqlite3`，统一使用 Electron 43 内置 Node 24 的 `node:sqlite`，避免新增运行时依赖和 Electron ABI 风险。
3. Capability 不新增独立 Store 服务，改为全进程共享同一个 Capability State 对象，并原地更新可热更新字段，降低改动面。
4. Dashboard 是否可用不能只依赖 `loadURL()` 成功，必须增加 Renderer 就绪握手，否则脚本缺失或首屏异常仍可能表现为空白页。
5. 通知不能固定拉取第一页，也不能展示后立即推进永久 cursor；必须使用循环扫描游标、展示待确认集合和系统通知稳定 ID。
6. 更新安装前不能提前销毁托盘；安装准备失败时必须恢复当前版本的 Runtime 和通知能力。
7. 500ms 启动目标保留为参考机性能目标，CI 使用独立硬门槛和相对回归门槛，避免不同机器性能差异造成假失败。
8. `pnpm audit` 的旧审计端点在 2026-07-16 返回 HTTP 410，发布门禁改用官方 OSV-Scanner 工作流，不把 registry 错误当成安全通过。
9. 每个任务主要控制在约 5 个文件；确实跨越启动协议或打包链路的任务标记为 `L`，并在检查点统一验证。
10. 完成本文全部任务后，才能重新声明 Desktop P0、P1、P2 已完成。

## 2. 目标与不变原则

### 2.1 整改目标

1. 修复 Runtime 代理跨 origin 后仍可能注入 Daemon Token 的严重漏洞。
2. 让 Codex Probe 技术上关闭 Shell、Exec 和其他非必要工具。
3. 修正 Probe、Daemon Host 和进程回收之间的超时预算与错误传播。
4. 保证 Bootstrap 先显示，再执行迁移、登录 Shell 读取和其他慢操作。
5. 保证 Dashboard 加载失败后有本地恢复界面，并且恢复不重复 Probe。
6. 修正系统通知展示失败仍被确认、失败项阻塞后续通知和 ACK 失败重复展示的问题。
7. 移除 Electron Main 高频同步磁盘 I/O、同步 Windows 进程回收和无界子进程输出。
8. 让 Capability 检测、自动更新、打包和跨平台验收符合真实运行状态。

### 2.2 保持不变的产品原则

1. OpenCreator 依赖用户本机 Codex CLI，不内置 Codex。
2. OpenCreator 不提供 Codex 登录页，不调用 `codex login status` 作为门禁。
3. 冷启动只通过一次真实最小 Codex 请求判断基础模型调用是否可用。
4. Probe 成功前不加载主 Dashboard 。
5. 页面刷新、项目切换、托盘恢复和 Daemon 自动恢复不重复 Probe。
6. Probe 不加载 OpenCreator Skills、Skill Market 或用户 MCP。
7. 生产 Renderer 和 Vite 同源代理页面都不获得 Daemon Token。
8. Daemon 继续监听 `127.0.0.1` 随机端口。
9. Web 开发服务器固定在 `127.0.0.1:9000`，并保持 `strictPort=true`。
10. 不新增登录、账号、API Key 或 Token 管理功能。

## 3. 整改前审查状态

下表记录 2026-07-16 实施前的审查基线，用于说明整改来源，不代表当前实现状态。整改后的结果以第 0.1 节和最终验收报告为准。

| 任务 | 当前结论 | 原因 |
|---|---|---|
| P0-B2 Codex 路径解析 | PARTIAL | 有效保存路径仍被登录 Shell 阻塞，2 秒目标不稳定 |
| P0-B3 Daemon Codex Probe | FAIL | Shell/Exec 工具未技术禁用，超时测试不足 |
| P0-B4 Daemon Bootstrap | PARTIAL | 完整 Capability 扫描阻塞 Runtime listen |
| P0-B5 Desktop DaemonManager | PARTIAL | Host 超时与 Probe 超时相同，错误码通过字符串拆分 |
| P0-B7 内部协议与 Bridge | FAIL | Runtime 代理存在跨 origin Token 泄漏风险 |
| P1-B1 窗口与托盘 | PARTIAL | 高频同步写窗口配置，Windows 进程回收会阻塞 Main |
| P1-B2 原生通知 | FAIL | 未等待系统通知成功展示就确认 outbox |
| P1-B3 深链接 | PARTIAL | 非法编码会被过滤后继续匹配，ID 校验不完整 |
| P1-B5 故障恢复与诊断 | PARTIAL | Dashboard 缺少 Renderer 就绪握手、本地错误页和最终脱敏 |
| P2-B1 生产打包 | PARTIAL | fresh package 容易受外部下载和旧产物选择影响 |
| P2-B2 自动更新 | PARTIAL/BLOCKED_ENV | 更新源依赖运行时环境变量，安装失败恢复和有序退出未验证 |
| P2-B3 Windows | BLOCKED_ENV | 代码路径存在，实机和完整自动化不足 |

只有对应任务的实现、自动化和要求的实机验收全部满足后，才能重新标记为 `DONE` 或 `PASS`。

## 4. 架构决策

### 4.1 Runtime 代理采用严格同源模型

1. Runtime 路由只匹配：
   - `/.opencreator/runtime`
   - `/.opencreator/runtime/...`
2. `/.opencreator/runtimeevil` 等前缀碰撞不得进入代理。
3. Daemon 地址只接受 `http://127.0.0.1:<有效端口>`，拒绝凭据、路径、查询、片段、`localhost` 和任意其他主机。
4. Runtime 子路径在原始值和解码值两个层面拒绝：
   - `//`、`\\` 和混合网络路径。
   - 反斜杠。
   - 控制字符和空字节。
   - 非法百分号编码。
5. 构建目标 URL 后必须再次断言 `target.origin === daemon.origin`。
6. Daemon Token 只能在最终断言通过后注入。
7. Electron Main 使用 Node 24 标准 `fetch` 并设置 `redirect: 'manual'`，不得自动跟随跨 origin 重定向。`net.fetch` 在 `protocol.handle` 内出现过无法稳定收敛的挂起，不再用于 Runtime 上游请求。
8. 请求体最多在 Main 中保留 10 MiB；先检查可信 `Content-Length`，再使用有界流读取，超过限制返回 `413`。
9. 缺失静态资源只对主文档导航执行 SPA fallback，缺失 JS、CSS、图片和 WASM 必须返回 `404`。

### 4.2 Vite 同源代理不向浏览器暴露 Token

1. `/.opencreator/runtime-config` 只返回 `{ baseUrl: '/.opencreator/runtime' }`。
2. Browser Bridge 接受同源配置中不存在 Token，但本地存储的直接 Daemon 配置仍要求 Token。
3. Vite 代理在服务端校验目标 origin 后注入 Token，并删除浏览器传入的 Authorization、Origin、Referer、Host 和 Connection。
4. Vite 代理应用与生产代理相同的网络路径和重定向限制。
5. Vite Daemon 启动 stdout/stderr 使用有界缓冲，解析出连接信息后不再无限累积。

### 4.3 Probe 使用技术工具隔离

在现有禁用项基础上增加：

```text
--disable shell_tool
--disable unified_exec
--disable shell_snapshot
```

规则：

1. 固定 Prompt 继续要求不调用工具，但 Prompt 只作为语义约束。
2. 工具禁用参数才是安全边界。
3. 保留真实用户 provider、model、认证和必要环境变量。
4. 不使用 `--ignore-user-config`，避免破坏自定义 provider 和 model。
5. 如果目标 Codex 不支持必需禁用项，Probe 直接失败并显示真实参数错误，不降级为有工具 Probe。
6. Probe JSONL 出现 `command_execution`、`file_change`、MCP、Web Search、Computer Use、图片生成或其他工具调用事件时，返回 `CODEX_PROBE_TOOL_USED`。
7. `error`、`reasoning` 和 `agent_message` 等非工具事件不应误判。
8. 本机 Codex `0.144.4` 已通过真实 hello Smoke 并确认支持三个新增禁用项；其他版本仍以真实 Probe 结果为准。

### 4.4 超时预算分层并使用结构化错误

| 阶段 | 预算 |
|---|---:|
| Probe 总执行时间 | 45 秒 |
| Probe Spawn 首次活动 | 5 秒 |
| Probe SIGTERM 宽限 | 2 秒 |
| Probe 强杀后最终收敛 | 1 秒 |
| Daemon Runtime 启动余量 | 10 秒 |
| Desktop Host 总启动超时 | 60 秒 |
| Notification Runtime 请求 | 10 秒 |
| Notification `show/failed` 等待 | 3 秒 |

要求：

1. Probe 自己产生的结构化错误优先于 Host 通用超时。
2. Desktop 使用 `DaemonStartError` 等结构化错误，不再从 `"CODE: message"` 字符串拆分。
3. 超时测试允许注入缩短预算，不等待真实 45 秒。
4. Windows `taskkill.exe` 使用异步子进程并等待结果，不得在 Electron Main 中 `spawnSync`。
5. 强杀后仍未收到 close 时，Promise 必须按最终预算收敛，同时记录残留进程诊断。

### 4.5 Probe 冷启动性能修正

真实分段测试确认，旧实现的 `13.255s` 不是 hello 模型响应时间，而是整份用户 `config.toml` 引入项目授权、插件市场、Hooks、通知和更新检查等无关初始化后的完整 Codex 子进程生命周期。整改规则如下：

1. Probe Home 解析用户基础配置后只写入 model、选中 provider、认证路由、模型目录和请求兼容字段；启动 Probe 没有显式 Profile，不读取旧式顶层 `profile`、内联 `[profiles.*]` 或 `<name>.config.toml`。
2. 保留 `auth.json`、自定义 provider 完整表和 `model_catalog_json`；模型目录文件复制到临时 Home 后重写路径。
3. 不复制 `projects`、`plugins`、`marketplaces`、`hooks`、`features`、`mcp_servers`、`tui`、`desktop`、`notify` 等无关配置。
4. argv 额外覆盖 `notify=[]` 和 `check_for_update_on_startup=false`，防止未来白名单变化时重新引入这两项启动行为。
5. 成功和失败结果都记录 `homePreparationMs`、`firstEventMs`、`responseReceivedMs`、`processExitMs`。
6. 2026-07-16 macOS arm64 最终正式包真实 Smoke 为 `3048ms`：配置准备 `4ms`、首事件 `134ms`、回复 `2407ms`、退出 `3048ms`；刷新五次未重复 Probe。此前两个正式包样本分别为 `3052ms` 和 `4388ms`，差异来自真实 provider 响应波动，本地配置初始化和首事件保持稳定。

### 4.6 Bootstrap 先显示，迁移在 Worker 中执行

新的冷启动顺序：

```text
app.whenReady()
  -> 初始化最小 Logger 和 Settings
  -> 注册本地协议和 IPC
  -> 创建 BrowserWindow
  -> 加载并显示 Bootstrap
  -> 并行预取登录 Shell 环境
  -> 如需要，在 Worker 中迁移 Runtime 数据
  -> 解析 Codex 路径
  -> 启动 Daemon 和 Probe
  -> Runtime listen
  -> 加载 Dashboard 并等待 Renderer Ready
```

迁移规则：

1. Worker 文件位于 `apps/desktop/src/main/workers/`，自动进入现有 Main 编译和 `dist/main/**` 打包范围。
2. SQLite 校验使用 Electron 内置 `node:sqlite`，不加载 Daemon 的 `better-sqlite3`。
3. source、temporary、target 必须在规范化和 realpath 后不存在父子递归关系。
4. 拒绝符号链接、设备文件和其他特殊文件，避免迁移结果依赖源目录外部内容。
5. 正确判断源 Runtime 锁：只有 `ESRCH` 表示进程不存在，`EPERM` 等错误仍视为可能在用。
6. 以只读方式打开源 SQLite 并执行 `PRAGMA quick_check`。
7. 复制到 target 同级临时目录，再对复制后的 SQLite 执行 `PRAGMA quick_check`。
8. target 非空时保持现有 `TARGET_EXISTS` 行为；target 不存在或为空时使用同文件系统 rename 切换。
9. 失败时删除临时目录并恢复空 target 目录，源目录保持不变。
10. 当前版本只提供阶段状态和取消退出，不实现逐文件百分比进度，避免为一次性迁移引入额外协议。

### 4.7 Codex 路径和 Shell 环境分层解析

1. 立即检查手动路径、成功保存路径、普通保存路径和进程 `PATH`。
2. 登录 Shell 环境读取与 Bootstrap 展示、迁移并行执行。
3. 已找到有效快速候选时，登录 Shell 最多等待 2 秒，以补充 provider 所需环境；超时后使用进程环境并终止 Shell 进程组。
4. 没有快速候选时，允许登录 Shell 使用完整 5 秒硬超时。
5. Windows 继续使用 `where.exe` 和 `.cmd/.bat/.exe` 规则，不启动登录 Shell。
6. 所有超时子进程必须完成进程树回收。

### 4.8 Capability 使用单一共享状态对象

1. 命中有效指纹缓存时立即使用缓存，不重复阻塞启动。
2. 无缓存时，启动必需检测只包含：
   - `codex --version`
   - `codex exec --help`
   - `codex exec resume --help`
   - `codex app-server --help`
3. 四项并行执行，总等待上限 500ms；超时后使用保守矩阵启动 Runtime。
4. Runtime listen 后异步执行完整 Capability 扫描并原子写缓存。
5. 不新增重量级 Capability Store 类；`buildServer`、MCP Manager、Run Routes 和 Codex Status 共享同一个对象引用。
6. 完整扫描完成后原地更新允许热更新的字段，使 `/codex/status`、MCP 校验和图片能力读取新值。
7. `runtimeTransport`、resume transport 等不能安全热切换的决策在本次生命周期固定，下次启动使用新缓存。
8. 后台收集器支持取消，Daemon 关闭时回收仍在运行的 Codex help 子进程。

### 4.9 通知采用循环扫描和展示成功后确认

1. `NotificationManager.show()` 返回 `Promise<'shown' | 'failed' | 'unsupported'>`。
2. Electron `show` 事件表示成功；`failed`、构造异常、3 秒超时表示失败。
3. Notification 的 `id` 使用 outbox ID，相同通知重试时由系统更新同一个通知。
4. 保留 Notification 对象引用，直到 `show`、`failed`、`close` 或超时。
5. 维护 `shownAwaitingAck` 集合；ACK 失败时不重复展示，只重试 ACK。
6. 使用循环 `scanCursor`：
   - 每轮读取一页未确认通知。
   - 无论单项成功或失败都推进本轮 cursor。
   - 到达空页后重置为 `0`，下一轮重试失败项。
7. 单项失败使用有界退避，不能阻塞同页和后续页通知。
8. Runtime 请求使用 AbortController，10 秒超时后释放消费锁。
9. `stop()` 终止当前请求并清理待处理 Notification。
10. 崩溃发生在系统展示成功但 ACK 前时仍属于至少一次语义；稳定 ID用于降低重复，不宣称跨崩溃严格 exactly-once。

### 4.10 Main I/O 和子进程内存必须有界

1. 窗口位置保存使用 300ms debounce，隐藏、关闭和退出前 flush。
2. Desktop Logger 使用串行异步队列；退出前显式 flush。
3. 高频 Daemon stderr 按固定窗口合并和限频。
4. 日志轮转在 macOS 和 Windows 上都能替换旧备份。
5. Desktop 和 Daemon 使用同等级脱敏规则。
6. 诊断导出前执行最终递归脱敏，并使用异步写文件。
7. Codex Runner stdout 仅保留最近 10,000 行或 4 MiB，stderr 仅保留最近 1 MiB。
8. App Server stderr 仅保留最近 1 MiB。
9. Codex Runner、App Server 和 Desktop Daemon 的未换行 frame 均设置上限，超限丢弃当前 frame 并记录截断。
10. 超限只影响诊断快照，不影响后续实时事件和最终 assistant/terminal 事件处理。

### 4.11 Dashboard 使用 Renderer Ready 握手

1. `loadURL()` 成功只表示主文档完成，不表示 React Dashboard 可用。
2. Web Renderer 首次挂载后通过 Preload 发送 `workspaceReady`。
3. Main 在加载 Dashboard 后等待固定握手超时；超时、主 frame 加载失败或 Renderer 崩溃都进入 `workspace_failed`。
4. 错误页只加载本地 Bootstrap 资源，提供：
   - 重新加载 Dashboard 。
   - 重启 Runtime。
   - 导出诊断。
   - 退出。
5. 重新加载 Dashboard 不重启 Daemon，不重复 Probe。
6. 重启 Runtime 复用已验证 Codex 指纹，不重复 Probe。
7. 错误页不得加载远程资源。

### 4.12 更新、打包和发布安全模型

1. 正式更新源固定为 GitHub Releases `wulien/opencreator-agent`，由 Electron Builder 生成 packaged update 配置。
2. 生产运行时不依赖 `OPENCREATOR_UPDATE_URL`；测试使用注入的 fake updater，必要的开发覆盖不得进入正式包。
3. Updater 使用显式状态机：

```text
idle -> checking -> available -> downloading -> downloaded
     -> preparing_install -> installing
     -> error
```

4. `checkForUpdates()` 和 `downloadUpdate()` Promise 必须捕获；`quitAndInstall()` 按同步调用捕获异常，并监听 updater `error` 事件。
5. 安装准备顺序：
   - 阻止新的更新操作。
   - 停止通知轮询。
   - flush 窗口状态和日志。
   - 有序停止 Daemon。
   - 设置 `allowQuit`。
   - 调用 `quitAndInstall()`。
6. 托盘在安装器真正接管前保持存在；准备失败时恢复 Runtime 和通知。
7. 正式包启用 Electron Fuses，至少关闭 RunAsNode、Node CLI inspect 和 NODE_OPTIONS，并启用 ASAR 完整性相关保护。
8. fresh package 必须生成构建清单，绑定 commit、dirty 状态、平台、架构、时间和包根目录。
9. verify 与 E2E 必须通过显式 package root 使用同一产物。
10. 依赖安全扫描使用官方 OSV-Scanner 工作流；任何例外必须记录 advisory、原因、负责人和到期时间。

## 5. 性能与可靠性预算

性能指标分为参考机目标和 CI 硬门槛。参考机数据每项至少运行 10 次，记录中位数和 P95；CI 同时检查绝对硬门槛和相对基线回归。

| 场景 | 参考机目标 | CI/可靠性硬门槛 |
|---|---:|---:|
| 应用入口到 Bootstrap `did-finish-load` | P95 不超过 500ms | 不超过 1000ms，且相对基线回归不超过 25% |
| 有效保存路径的 Codex 解析 | P95 不超过 2.2 秒 | 不超过 2.5 秒 |
| 无快速候选的登录 Shell 解析 | 不超过 5 秒 | 不超过 5.5 秒 |
| Probe 正常成功 | P95 不超过 8 秒 | 总执行硬超时 45 秒 |
| Probe 配置准备 | P95 不超过 50ms | 不超过 250ms |
| Probe 首个 JSON 事件 | P95 不超过 1 秒 | 由总超时兜底 |
| Desktop Host 总启动 | 60 秒 | 必须晚于 Probe 结构化错误 |
| Probe 成功到 Renderer Ready | P95 不超过 1.5 秒 | 不超过 3 秒 |
| 托盘恢复窗口 | P95 不超过 500ms | 不超过 1 秒 |
| 页面刷新恢复连接 | 不超过 2 秒 | Probe 计数不增加 |
| 窗口连续移动 5 秒 | 无同频磁盘写入 | 写入次数符合 300ms debounce |
| Runtime 代理请求体 | 最大 10 MiB | 超限返回 `413` |
| Notification Runtime 请求 | 10 秒 | 超时后释放消费锁 |
| Codex 输出内存快照 | 符合 4.9 节 | 不随总输出线性增长 |

性能测试必须记录 Main 内部时间戳，不能只使用 Playwright 进程启动耗时替代应用内部指标。

## 6. 实施任务

所有任务默认使用测试驱动方式：先增加可复现失败测试，再修改实现，最后运行任务级和检查点级验证。

### Phase A：P0 安全边界

#### Task A1：固定生产 Runtime 代理 origin 和请求体上限

**实现内容：**

1. 提取可测试的 Daemon origin、Runtime 路径和目标 URL 校验函数。
2. 使用精确前缀，拒绝网络路径、反斜杠、非法编码和非 `127.0.0.1` Daemon。
3. 只在最终同源断言后注入 Token，使用手动重定向。
4. 使用有界流读取请求体，超过 10 MiB 返回 `413`。

**验收标准：**

- [ ] `//attacker.example`、`\\attacker.example`、混合编码和前缀碰撞全部被拒绝。
- [ ] 攻击服务器未收到请求和 Authorization Header。
- [ ] JSON、二进制和 SSE 正常代理继续通过。
- [ ] 超限请求不会完整进入 Main 内存。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- runtime-proxy
pnpm --filter @opencreator/desktop e2e:package --grep "Runtime 代理"
pnpm --filter @opencreator/desktop typecheck
```

**依赖：** 无。

**主要文件：**

- `apps/desktop/src/main/protocol-handler.ts`
- `apps/desktop/test/runtime-proxy.test.ts`
- `apps/desktop/e2e/desktop.spec.ts`
- `apps/desktop/test/protocol-path.test.ts`

**规模：** M。

#### Task A2：收紧 Vite 同源代理并移除浏览器 Token

**实现内容：**

1. 新增可测试的开发代理目标解析模块。
2. `runtime-config` 只返回同源 base URL。
3. Vite 服务端校验目标后注入 Token，并清理敏感请求头。
4. 限制开发 Daemon 启动输出缓冲。

**验收标准：**

- [ ] 浏览器无法从 `runtime-config` 获得 Token。
- [ ] Browser Bridge 可使用无 Token 的同源配置。
- [ ] 直接 Daemon 的本地存储配置仍要求 Token。
- [ ] 开发代理不能通过网络路径向其他 origin 发请求。

**验证：**

```bash
pnpm --filter @opencreator/web test -- dev-proxy-target browser-bridge
pnpm --filter @opencreator/web typecheck
pnpm --filter @opencreator/web build
```

**依赖：** 无。

**主要文件：**

- `apps/web/vite.config.ts`
- `apps/web/src/runtime/dev-proxy-target.ts`
- `apps/web/src/runtime/dev-proxy-target.test.ts`
- `apps/web/src/host/browser-bridge.ts`
- `apps/web/src/host/browser-bridge.test.ts`

**规模：** M。

#### Task A3：关闭 Probe Shell 和 Exec 工具

**实现内容：**

1. 增加 Shell、Unified Exec 和 Shell Snapshot 禁用参数。
2. Probe 解析 JSONL 并识别工具调用事件。
3. 工具事件返回稳定隔离错误。
4. 扩展 fake Codex 和 gated real smoke。

**验收标准：**

- [ ] argv 包含全部必需工具禁用项。
- [ ] fake Codex 模拟工具调用时 Probe 失败。
- [ ] 正常 assistant 响应仍成功。
- [ ] 真实 Smoke 的 JSONL 不包含工具调用事件。

**验证：**

```bash
pnpm --filter @opencreator/daemon test -- codex-probe
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/desktop e2e:real-codex
```

**依赖：** 无。

**主要文件：**

- `apps/daemon/src/codex/probe-argv.ts`
- `apps/daemon/src/codex/probe.ts`
- `apps/daemon/test/unit/codex-probe-argv.test.ts`
- `apps/daemon/test/unit/codex-probe.test.ts`
- `apps/desktop/e2e/fixtures/fake-codex.mjs`

**规模：** M。

#### Task A4：重构 Probe、Host 超时和进程回收协议

**实现内容：**

1. 将 Probe、回收和 Host 预算定义为具名常量。
2. Host 默认超时调整为 60 秒。
3. 使用结构化错误传递 Probe 错误码。
4. Windows 进程树回收改为异步，并限制 Daemon 输出 frame。

**验收标准：**

- [ ] Probe 超时后输出 `CODEX_PROBE_TIMEOUT`，Host 不抢先失败。
- [ ] 工具调用输出 `CODEX_PROBE_TOOL_USED`。
- [ ] 超时后不存在可确认的残留 Codex 进程。
- [ ] Windows `taskkill` 不同步阻塞 Main。
- [ ] 普通 Daemon 启动超时仍映射为 `DAEMON_START_FAILED`。

**验证：**

```bash
pnpm --filter @opencreator/daemon test -- codex-probe codex-process
pnpm --filter @opencreator/desktop test -- daemon-manager
pnpm --filter @opencreator/desktop e2e:package --grep "Probe"
```

**依赖：** A3。

**主要文件：**

- `apps/daemon/src/main.ts`
- `apps/daemon/src/codex/probe.ts`
- `apps/desktop/src/main/daemon-manager.ts`
- `apps/desktop/src/main/bootstrap-controller.ts`
- `apps/desktop/test/daemon-manager.test.ts`

**规模：** L。

### Checkpoint A：安全门禁

- [x] A1 至 A4 新增测试先失败后通过。
- [x] 生产和开发 Renderer 都无法获得或外带 Daemon Token。
- [x] Probe 技术上没有 Shell/Exec 工具。
- [x] Probe 错误在 Host 超时前稳定传递。
- [x] `pnpm test`、`pnpm typecheck` 通过。

### Phase B：P0 启动性能和恢复

#### Task B1：调整冷启动顺序并建立启动指标

**实现内容：**

1. 在迁移和 Shell 等待前加载 Bootstrap。
2. 增加 `migrating_data` 和 `workspace_failed` 状态。
3. 记录应用入口、窗口创建、DOM Ready 和 did-finish-load 时间戳。
4. 增加启动性能 E2E。

**验收标准：**

- [ ] 无迁移场景先显示 Bootstrap。
- [ ] Bootstrap 不展示 Skills、MCP 或登录状态。
- [ ] 参考机和 CI 指标按第 5 节分别判断。
- [ ] 指标来自 Main 内部时间戳。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- bootstrap
pnpm --filter @opencreator/desktop e2e:package --grep "启动性能"
```

**依赖：** Checkpoint A。

**主要文件：**

- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/window-manager.ts`
- `apps/desktop/src/main/bootstrap-controller.ts`
- `apps/desktop/src/bootstrap/main.ts`
- `apps/desktop/src/shared/types.ts`
- `apps/desktop/e2e/startup-performance.spec.ts`

**规模：** L。

#### Task B2：将 Runtime 数据迁移移出 Main

**实现内容：**

1. 新增 Main Worker 和消息协议。
2. 使用 `node:sqlite` 执行迁移前后 `quick_check`。
3. 增加路径关系、符号链接、锁和切换失败处理。
4. 应用退出时终止仍在运行的迁移 Worker。

**验收标准：**

- [ ] 20 MiB/5000 文件迁移期间 Main 仍可响应窗口事件。
- [ ] source 与 target 父子关系、符号链接和 SQLite 损坏均被拒绝。
- [ ] 迁移失败后源目录保持不变。
- [ ] packaged Worker 可加载 `node:sqlite`。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- data-migration
pnpm --filter @opencreator/desktop e2e:package --grep "数据迁移"
pnpm --filter @opencreator/desktop package
```

**依赖：** B1。

**主要文件：**

- `apps/desktop/src/main/data-migration.ts`
- `apps/desktop/src/main/workers/data-migration-worker.ts`
- `apps/desktop/test/data-migration.test.ts`
- `apps/desktop/e2e/desktop.spec.ts`

**规模：** L。

#### Task B3：实现 Codex 路径快速候选

**实现内容：**

1. 先验证 selected、successful、saved 和进程 PATH。
2. 登录 Shell 读取与其他启动工作并行。
3. 快速候选使用 2 秒环境合并预算，无候选使用 5 秒预算。
4. 完整回收慢 Shell 进程组。

**验收标准：**

- [ ] 有效保存路径配合慢 Shell 时不超过 2.5 秒硬门槛。
- [ ] 进程 PATH 无 Codex 时仍能通过登录 Shell 找到。
- [ ] Shell 超时没有残留进程。
- [ ] Windows `where.exe` 和 `.cmd/.bat/.exe` 行为不回归。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- codex-resolver
pnpm --filter @opencreator/desktop typecheck
```

**依赖：** B1。

**主要文件：**

- `apps/desktop/src/main/codex-resolver.ts`
- `apps/desktop/src/main/bootstrap-controller.ts`
- `apps/desktop/test/codex-resolver.test.ts`
- `apps/desktop/src/shared/types.ts`

**规模：** M。

#### Task B4：拆分启动 Capability 和完整 Capability

**实现内容：**

1. 增加启动必需 Capability 收集器和 500ms 总预算。
2. Runtime listen 后异步收集完整矩阵。
3. 共享同一 Capability State 引用并原地更新。
4. 使用异步原子方式写入指纹缓存。

**验收标准：**

- [ ] 冷缓存完整扫描不阻塞 Runtime listen。
- [ ] 慢 Codex help 在 500ms 后保守启动。
- [ ] 完整矩阵完成后 `/codex/status` 和可热更新校验读取新值。
- [ ] transport 本次生命周期不热切换。
- [ ] 下一次启动命中完整缓存。

**验证：**

```bash
pnpm --filter @opencreator/daemon test -- codex-capabilities startup
pnpm --filter @opencreator/daemon typecheck
```

**依赖：** A4。

**主要文件：**

- `apps/daemon/src/codex/capabilities.ts`
- `apps/daemon/src/main.ts`
- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/unit/codex-capabilities.test.ts`
- `apps/daemon/test/unit/startup.test.ts`

**规模：** L。

#### Task B5：异步加载本地静态资源并收紧 SPA fallback

**实现内容：**

1. 静态资源改用异步 `stat/readFile`。
2. 只对主文档或无扩展路由执行 SPA fallback。
3. 缺失资源返回真实 `404` 和正确 MIME。
4. 保持现有 CSP 和静态路径逃逸防护。

**验收标准：**

- [ ] Dashboard 加载大量静态资源时不连续阻塞 Main。
- [ ] 缺失 JS/CSS 不再返回 `index.html`。
- [ ] 合法 hash 路由刷新仍进入 Dashboard 。
- [ ] 路径逃逸测试继续通过。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- protocol-path static-response
pnpm --filter @opencreator/desktop e2e:package --grep "静态资源"
```

**依赖：** A1。

**主要文件：**

- `apps/desktop/src/main/protocol-handler.ts`
- `apps/desktop/test/protocol-path.test.ts`
- `apps/desktop/test/static-response.test.ts`
- `apps/desktop/e2e/desktop.spec.ts`

**规模：** M。

#### Task B6：增加 Renderer Ready 握手

**实现内容：**

1. 新增 `workspaceReady` IPC。
2. Preload 暴露只写就绪信号，不暴露额外主进程能力。
3. Web 首次挂载后发送就绪信号。
4. Main 对 main-frame load、Renderer crash 和握手超时统一处理。

**验收标准：**

- [ ] 正常 Dashboard 在超时前完成握手。
- [ ] 缺失 bundle、Renderer 异常和未握手都进入失败状态。
- [ ] 非受信页面无法发送就绪 IPC。
- [ ] 重复就绪信号幂等。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- workspace-ready
pnpm --filter @opencreator/web test -- desktop-bridge
pnpm --filter @opencreator/desktop typecheck
```

**依赖：** B1、B5。

**主要文件：**

- `apps/desktop/src/shared/ipc.ts`
- `apps/desktop/src/shared/types.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/main/main.ts`
- `apps/web/src/main.tsx`

**规模：** M。

#### Task B7：增加 Dashboard 本地错误页和无 Probe 恢复

**实现内容：**

1. 在本地 Bootstrap 中增加 Dashboard 失败视图。
2. 增加仅重载 Renderer 的 IPC。
3. 复用现有无 Probe Runtime 重启。
4. 增加 packaged E2E 故障注入。

**验收标准：**

- [ ] Dashboard 资源缺失或握手超时时显示本地错误页。
- [ ] “重新加载 Dashboard”不改变 Daemon PID 和 Probe 计数。
- [ ] “重启 Runtime”不重复 Probe。
- [ ] 错误页可以导出诊断和退出。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- workspace-load
pnpm --filter @opencreator/desktop e2e:package --grep "Dashboard 加载失败"
```

**依赖：** B6、B4。

**主要文件：**

- `apps/desktop/src/main/window-manager.ts`
- `apps/desktop/src/main/bootstrap-controller.ts`
- `apps/desktop/src/bootstrap/main.ts`
- `apps/desktop/src/bootstrap/style.css`
- `apps/desktop/e2e/desktop.spec.ts`

**规模：** M。

### Checkpoint B：P0 主闭环

- [x] Bootstrap 性能符合参考机目标和 CI 门槛。
- [x] 首次迁移不阻塞 Main。
- [x] Probe 成功后在预算内完成 Renderer Ready。
- [x] 刷新五次 Probe 计数保持 1。
- [x] Dashboard 加载失败可恢复且不重复 Probe。
- [x] P0 打包 E2E 全部通过。

### Phase C：P1 可靠性、性能和诊断

#### Task C1：修正通知展示、扫描和确认语义

**实现内容：**

1. 注入 Notification 和 fetch 依赖，`show()` 返回展示结果。
2. 使用 outbox ID 作为系统 Notification ID。
3. 增加循环 scan cursor、`shownAwaitingAck` 和失败退避。
4. 增加请求超时和 stop 中止。

**验收标准：**

- [ ] `failed` 通知不被确认。
- [ ] ACK 失败不导致同一进程内重复展示。
- [ ] 长期失败项不阻塞后续通知。
- [ ] Runtime 请求挂起 10 秒后下一轮可以继续。
- [ ] 点击仍能打开 Thread、Run 和 Approval。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- notification-manager
pnpm --filter @opencreator/daemon test -- notification
```

**依赖：** Checkpoint B。

**主要文件：**

- `apps/desktop/src/main/notification-manager.ts`
- `apps/desktop/test/notification-manager.test.ts`
- `apps/desktop/e2e/desktop.spec.ts`

**规模：** L。

#### Task C2：窗口状态防抖和退出 flush

**实现内容：**

1. resize/move 使用 300ms debounce。
2. hide、close、before-quit 前 flush。
3. 最大化、恢复和显示器变化保持可见。
4. SettingsStore 支持可测试持久化适配器。

**验收标准：**

- [ ] 连续移动 5 秒不会产生同频磁盘写入。
- [ ] 退出前最后位置一定落盘。
- [ ] 最大化时保存正常窗口位置。
- [ ] 配置损坏时使用默认值且 Main 不崩溃。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- window-manager settings-store
```

**依赖：** Checkpoint B。

**主要文件：**

- `apps/desktop/src/main/window-manager.ts`
- `apps/desktop/src/main/settings-store.ts`
- `apps/desktop/test/window-manager.test.ts`
- `apps/desktop/test/settings-store.test.ts`

**规模：** M。

#### Task C3：统一 Desktop 脱敏和异步日志

**实现内容：**

1. 提取 Desktop redaction 模块，对齐 Daemon 规则。
2. Logger 使用串行异步队列、限频和可等待 flush。
3. Windows 轮转前安全替换旧 `.1`。
4. Daemon stderr 使用合并日志。

**验收标准：**

- [ ] JSON Token、环境变量、Bearer、`sk-*` 和 `clwcap_*` 均不落盘。
- [ ] 高频 stderr 不阻塞 Main。
- [ ] 日志轮转目标已存在时仍成功。
- [ ] graceful quit 等待日志 flush。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- logger redaction
```

**依赖：** Checkpoint B。

**主要文件：**

- `apps/desktop/src/main/logger.ts`
- `apps/desktop/src/main/redaction.ts`
- `apps/desktop/src/main/daemon-manager.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/test/logger.test.ts`

**规模：** L。

#### Task C4：诊断导出最终递归脱敏

**实现内容：**

1. 诊断 payload 在写入前递归脱敏。
2. 文件写入改为异步。
3. 增加嵌套对象、数组和混合字符串测试。

**验收标准：**

- [ ] 诊断导出不包含测试注入的任何 secret。
- [ ] Prompt、Token、路径中的非敏感信息按规则保留。
- [ ] 用户取消导出不写文件。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- diagnostics
```

**依赖：** C3。

**主要文件：**

- `apps/desktop/src/main/diagnostics.ts`
- `apps/desktop/src/main/redaction.ts`
- `apps/desktop/test/diagnostics.test.ts`

**规模：** S。

#### Task C5：限制 Codex 子进程内存和 frame

**实现内容：**

1. 新增通用有界文本、行和 frame buffer。
2. Runner stdout/stderr 改用有界缓冲。
3. App Server stderr 和未换行 stdout frame 增加上限。
4. 保持实时事件回调和最终事件识别。

**验收标准：**

- [ ] 超大 stdout/stderr 不造成线性内存增长。
- [ ] 无换行超大 frame 不造成线性内存增长。
- [ ] 最后的 assistant 和 terminal 事件仍能识别。
- [ ] 截断信息进入诊断元数据。

**验证：**

```bash
pnpm --filter @opencreator/daemon test -- bounded-buffer codex-runner codex-app-server
```

**依赖：** A3。

**主要文件：**

- `apps/daemon/src/codex/runner.ts`
- `apps/daemon/src/codex/app-server-runner.ts`
- `apps/daemon/src/codex/bounded-buffer.ts`
- `apps/daemon/test/unit/bounded-buffer.test.ts`
- `apps/daemon/test/integration/codex-runner.test.ts`

**规模：** L。

#### Task C6：收紧 CORS 和深链接输入

**实现内容：**

1. 默认只允许 `http://127.0.0.1:9000`。
2. Harness 和测试额外 origin 使用显式配置。
3. 深链接任一 path 或 query 编码失败时整体拒绝。
4. 拒绝控制字符、替换字符、空 ID 和超长 UTF-8 ID。

**验收标准：**

- [ ] 任意 localhost 高位端口默认不再获得 CORS Header。
- [ ] 固定 9000 origin 正常工作。
- [ ] 非法编码不能通过过滤后变成合法路由。
- [ ] 中文、空格和编码斜杠等合法 ID 继续工作。

**验证：**

```bash
pnpm --filter @opencreator/daemon test -- cors
pnpm --filter @opencreator/desktop test -- deep-link
```

**依赖：** A1、A2。

**主要文件：**

- `apps/daemon/src/api/server.ts`
- `apps/daemon/test/integration/api.test.ts`
- `apps/desktop/src/main/deep-link-manager.ts`
- `apps/desktop/test/deep-link-manager.test.ts`

**规模：** M。

### Checkpoint C：P1 完整体验

- [x] 通知成功、失败、超时、ACK 失败、循环扫描和点击均有自动化。
- [x] 窗口拖动没有同步写放大。
- [x] 日志和诊断脱敏测试通过。
- [x] Codex 输出和 frame 内存有明确上限。
- [x] CORS 和深链接边界测试通过。
- [x] 全仓测试、类型检查和构建通过。

### Phase D：P2 发布工程

#### Task D1：重构更新状态机和有序安装

**实现内容：**

1. Updater、Dialog 和安装协调器使用依赖注入。
2. 捕获 check、download、dialog 和 quitAndInstall 错误。
3. 安装前 flush 状态并停止 Daemon，托盘保持到安装器接管。
4. 准备失败时恢复 Runtime 和通知。
5. 正式更新源改为 GitHub Releases 配置。

**验收标准：**

- [x] 下载失败不产生未处理 Promise rejection。
- [x] 用户拒绝安装时当前任务不受影响。
- [x] 用户确认安装后 Daemon 先停止，安装器后启动。
- [x] 安装准备失败后当前版本继续可用。
- [x] dispose 后不残留 updater listener。

**验证：**

```bash
pnpm --filter @opencreator/desktop test -- updater
pnpm --filter @opencreator/desktop typecheck
```

**依赖：** Checkpoint C。

**主要文件：**

- `apps/desktop/src/main/updater.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/test/updater.test.ts`
- `apps/desktop/electron-builder.yml`
- `docs/operations/opencreator-desktop-release-runbook.md`

**规模：** L。

#### Task D2：启用 Electron Fuses 和正式包安全约束

**实现内容：**

1. 关闭 RunAsNode、Node CLI inspect 和 NODE_OPTIONS。
2. 启用 ASAR 完整性和只从 ASAR 加载应用代码。
3. 修改原生 SQLite 验证方式，不再依赖 packaged executable 的 `-e`。
4. verify 检查正式 Fuse 状态。

**验收标准：**

- [x] `ELECTRON_RUN_AS_NODE=1 OpenCreator -e ...` 不再执行任意 Node 代码。
- [x] packaged Daemon 仍能通过 Utility Process 加载 `better-sqlite3`。
- [x] app.asar 完整性和加载范围符合配置。
- [x] macOS arm64 打包 E2E 不回归。
- [ ] Windows 打包 E2E 待 Windows x64 CI 实际执行。

**验证：**

```bash
pnpm --filter @opencreator/desktop package
pnpm --filter @opencreator/desktop verify:package
pnpm --filter @opencreator/desktop e2e:package
```

**依赖：** D1。

**主要文件：**

- `apps/desktop/electron-builder.yml`
- `apps/desktop/scripts/verify-package.mjs`
- `apps/desktop/package.json`
- `apps/desktop/e2e/desktop.spec.ts`
- `docs/operations/opencreator-desktop-release-runbook.md`

**规模：** L。

#### Task D3：提高打包可重复性和依赖安全检查

**实现内容：**

1. 打包步骤增加阶段日志和子步骤超时。
2. `pnpm deploy` 强制锁文件，增加缓存完整时的 offline 路径。
3. Electron headers 和下载缓存路径显式配置。
4. 生成构建清单，并让 verify/E2E 接受同一个显式 package root。
5. CI 接入官方 OSV-Scanner `v2.3.8` 可复用工作流。

**验收标准：**

- [x] fresh package 清单记录 commit、dirty、时间、平台、架构和包根目录。
- [x] 依赖缓存完整时可以 offline 完成 Daemon prepare。
- [x] 打包卡住时在明确超时内失败。
- [x] verify 和 E2E 使用同一次构建产物。
- [x] OSV 2.3.8 对当前发布源码快照扫描无已知漏洞；CI 工作流仍需在 GitHub Actions 实际运行。

**验证：**

```bash
pnpm --filter @opencreator/desktop package
pnpm --filter @opencreator/desktop verify:package
OPENCREATOR_DESKTOP_PACKAGE_ROOT="<当前构建清单中的包根目录>" pnpm --filter @opencreator/desktop e2e:package
osv-scanner scan source --recursive .
```

**依赖：** D2。

**主要文件：**

- `apps/desktop/scripts/prepare-daemon.mjs`
- `apps/desktop/scripts/package-release.mjs`
- `apps/desktop/scripts/verify-package.mjs`
- `apps/desktop/e2e/desktop.spec.ts`
- `apps/desktop/package.json`
- `.github/workflows/desktop-release.yml`

**规模：** L。

#### Task D4：补齐 Windows 自动化和实机清单

**实现内容：**

1. Windows CI 执行 `.cmd/.bat/.exe`、`where.exe`、异步进程树和打包 E2E。
2. 增加 Windows 日志轮转、深链接参数、通知失败和更新退出测试。
3. 实机记录安装、覆盖升级、托盘、通知、协议和卸载数据保留。

**验收标准：**

- [ ] Windows x64 CI 生成并验证 NSIS 包。
- [ ] Windows E2E 使用构建清单指定产物。
- [ ] 正常退出、Probe 超时和 Daemon 异常后无残留进程树。
- [ ] 未签名和已签名结果在报告中明确区分。

**验证：**

```powershell
pnpm test
pnpm typecheck
pnpm desktop:release
$env:OPENCREATOR_DESKTOP_PACKAGE_ROOT = "<win-unpacked>"
pnpm --filter @opencreator/desktop e2e:package
```

**依赖：** D3。

**主要文件：**

- `.github/workflows/desktop-release.yml`
- `apps/desktop/e2e/desktop.spec.ts`
- `apps/daemon/test/unit/codex-process.test.ts`
- `docs/operations/opencreator-desktop-windows-release.md`

**规模：** L。

#### Task D5：重新执行最终验收并修订状态

**实现内容：**

1. 重新运行全仓测试、类型检查、构建、fresh package 和 Desktop E2E。
2. 运行真实 Codex Smoke。
3. 记录性能、Fuses、OSV 和跨平台结果。
4. 更新上游规格、发布手册和最终验收报告。

**验收标准：**

- [x] 每个 `PASS` 都有可定位的自动化或实机证据。
- [x] 未运行、跳过和环境缺失不能写成 `PASS`。
- [x] Critical、High 问题全部关闭。
- [x] P0、P1、P2 状态与任务实际结果一致。

**验证：**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @opencreator/desktop package
pnpm --filter @opencreator/desktop verify:package
pnpm --filter @opencreator/desktop e2e:package
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/desktop e2e:real-codex
```

**依赖：** D1、D2、D3、D4。

**主要文件：**

- `docs/specs/2026-07-15-opencreator-desktop-app-host-design.md`
- `docs/test-reports/opencreator-desktop-final-acceptance.md`
- `docs/operations/opencreator-desktop-release-runbook.md`
- `docs/operations/opencreator-desktop-windows-release.md`

**规模：** M。

### Checkpoint D：发布候选

- [x] macOS fresh package、verify、E2E 和真实 Codex Smoke 使用同一份源码和产物。
- [ ] Windows 自动化通过，实机项按真实状态记录。
- [x] Electron Fuses 验证通过。
- [x] OSV 依赖安全扫描完成。
- [x] 性能预算有可复现报告。
- [x] 上游规格不再包含无证据的完成标记。

## 7. 测试矩阵

| 领域 | 单元测试 | 集成测试 | 打包 E2E | 实机 |
|---|---|---|---|---|
| 生产 Runtime origin 固定 | 必须 | 攻击服务必须 | 必须 | 不要求 |
| Vite Token 隔离 | 必须 | Vite 中间件必须 | 开发 Smoke | 不要求 |
| Probe 工具隔离 | 必须 | fake Codex | 真实 Smoke | 发布前一次 |
| 超时和进程回收 | 必须 | 必须 | 必须 | Windows 必须 |
| 数据迁移 | 必须 | Worker 集成 | 必须 | 大目录人工复验 |
| Codex Resolver | 必须 | 不要求 | 必须 | macOS/Windows |
| Capability 异步刷新 | 必须 | 必须 | 必须 | 不要求 |
| 静态资源和 Renderer Ready | 必须 | 必须 | 必须 | 不要求 |
| Notification show/failed/ACK | 必须 | Daemon outbox | fake/受控 | macOS/Windows |
| Window 和 Settings | 必须 | 不要求 | 必须 | macOS/Windows |
| Logger 和 Diagnostics | 必须 | 必须 | 必须 | 不要求 |
| 有界子进程输出 | 必须 | 大输出必须 | 不要求 | 不要求 |
| Updater | fake 必须 | 本地更新服务 | 必须 | 正式服务 |
| Electron Fuses | 脚本验证 | verify script | 必须 | 正式包 |
| 打包和原生 SQLite | 不适用 | verify script | 必须 | 干净机 |
| 依赖安全 | 不适用 | OSV CI | 发布门禁 | 不要求 |

## 8. 实施边界

### 必须执行

1. 每个任务先增加失败测试。
2. 每完成 2 至 3 个任务运行任务级测试，每个 Phase 结束运行完整 Checkpoint。
3. 保持 Browser 模式和固定 `9000` 端口不回归。
4. 保持用户已有未提交修改，不回退无关文件。
5. 所有文档和用户界面文案继续使用中文。
6. 所有新日志默认脱敏。
7. 不得用旧 package、旧报告或跳过项证明当前源码已通过。

### 实施前需要再次确认

1. 新增运行时第三方依赖。
2. 修改 SQLite schema。
3. 改变 Probe 45 秒产品超时。
4. 放弃对自定义 Codex provider 或 model 的兼容。
5. 改变“Probe 失败不能跳过”的产品原则。
6. 正式更新源不再使用 `wulien/opencreator-agent` GitHub Releases。
7. 因兼容原因不能启用计划中的 Electron Fuses。

### 禁止执行

1. 禁止向 Renderer 暴露 Daemon Token 简化代理。
2. 禁止在 Probe 失败后自动重复真实模型调用。
3. 禁止恢复启动时 Skills、MCP 或 Skill Market 全量加载。
4. 禁止通过放宽 CSP、IPC sender 校验或 CORS 解决兼容问题。
5. 禁止未运行测试就回填 `PASS`。
6. 禁止创建 Git Worktree。

## 9. 风险和缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 旧 Codex 不认识工具禁用参数 | Probe 失败 | 展示真实参数错误，不降级为有工具 Probe；记录最低兼容范围 |
| Capability 原地更新误改固定 transport | 运行中 transport 不一致 | 明确区分热更新字段和生命周期固定决策，并增加测试 |
| `node:sqlite` Worker 行为跨平台差异 | 迁移失败 | packaged Worker smoke、只读 quick_check、失败保留源数据 |
| Worker 复制符号链接或特殊文件 | 数据越界或不可移植 | lstat 遍历并拒绝符号链接和特殊文件 |
| Renderer 页面加载成功但 React 未挂载 | 长时间空白 | Renderer Ready 握手和超时错误页 |
| Notification 事件平台差异 | 误确认或重复 | fake 单测、稳定 ID、循环扫描和双平台实机验收 |
| 更新安装准备失败 | Runtime 已停但应用未退出 | 托盘保留、状态回滚、无 Probe 恢复 Runtime |
| Electron Fuses 影响原有原生烟测 | verify 失败 | 改用 Utility Process/E2E 验证，不依赖 RunAsNode |
| 500ms 指标受 CI 抖动影响 | 假失败 | 参考机 P95、CI 绝对门槛和相对回归三者分离 |
| OSV 服务或网络不可用 | 无安全证据 | 发布任务失败并标记 BLOCKED_ENV，不能降级为 PASS |
| 打包依赖外部下载 | CI 长时间挂起 | 缓存、offline 路径、阶段超时和构建清单 |

## 10. 实施顺序

```text
A1 -> A2 -> A3 -> A4
  -> Checkpoint A
  -> B1 -> B2 -> B3 -> B4 -> B5 -> B6 -> B7
  -> Checkpoint B
  -> C1 -> C2 -> C3 -> C4 -> C5 -> C6
  -> Checkpoint C
  -> D1 -> D2 -> D3 -> D4 -> D5
  -> Checkpoint D
```

允许在同一 Phase 内并行准备互不修改同一文件的测试，但合并和验证仍按上述顺序执行。

## 11. 方案确认门

开始实施前必须满足：

- [x] 用户确认本文的整改范围和优先级。
- [x] 用户确认旧 Codex 不支持必需禁用项时直接 Probe 失败，不降级为有工具模式。
- [x] 用户确认迁移 Worker 使用内置 `node:sqlite`，不新增运行时 SQLite 依赖。
- [x] 用户确认正式自动更新源使用 GitHub Releases `wulien/opencreator-agent`。
- [x] 用户确认正式包启用 Electron Fuses，并移除 RunAsNode 验证方式。
- [x] 用户确认性能采用“参考机目标 + CI 硬门槛 + 相对回归”三层标准。
- [x] 用户确认 P0 安全与启动整改完成前不继续维持“全部完成”的状态。
- [x] 实施者已确认每个任务都有验收、验证、依赖和文件范围。

本文已完成技术复审、用户确认、Task A1 至 D5 的仓库内实施和本机验收。未完成项仅限 Windows CI/实机、正式签名、公证、Gatekeeper、真实升级和正式通知点击，均已在最终验收报告中按 `BLOCKED_ENV` 或 `NOT_RUN` 记录。
