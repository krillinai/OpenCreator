# OpenCreator Desktop 最终验收报告

## 1. 报告信息

| 项目 | 内容 |
|---|---|
| 验收日期 | 2026-07-16 |
| 目标版本 | 0.1.0 |
| 本机平台 | macOS 26.3.1 arm64 |
| Node.js | 24.16.0 |
| Codex CLI | 0.144.4 |
| 验收范围 | P0、P1、P2 仓库实现与 macOS arm64 发布候选 |
| 状态定义 | `PASS`、`FAIL`、`BLOCKED_ENV`、`NOT_RUN` |
| 总体结论 | P0/P1 仓库实现与本机自动化通过；P2 本机发布候选通过，Windows、签名、公证和真实升级仍受环境阻塞 |

## 2. 本轮自动化证据

| 场景 | 状态 | 证据 |
|---|---|---|
| 全仓测试 | PASS | `pnpm test`；Desktop 48、Web 532、Daemon 663、Skill Market 5、Harness 3 项通过 |
| 全仓测试跳过项 | NOT_RUN | Daemon 23 项显式跳过，包含 14 项独立真实 Codex 套件、4 项 Search 集成测试和 5 项其他条件型用例，不计入 PASS |
| 全仓类型检查 | PASS | `pnpm typecheck` |
| 全仓生产构建 | PASS | `pnpm build` |
| Desktop 类型检查 | PASS | `pnpm --filter @opencreator/desktop typecheck` |
| 全离线 fresh package | PASS | `OPENCREATOR_DESKTOP_OFFLINE=1 CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @opencreator/desktop package`；生产依赖下载量为 0 |
| 构建清单 | PASS | `apps/desktop/release/opencreator-desktop-build-manifest.json` 记录 commit、dirty、时间、平台、架构和唯一包根目录 |
| 正式包独立校验 | PASS | `pnpm --filter @opencreator/desktop verify:package` |
| Desktop packaged E2E | PASS | Playwright 6/6，使用构建清单指向的 fresh package |
| 真实 Codex hello Smoke | PASS | `OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/desktop e2e:real-codex`；1/1 通过 |
| Probe 性能修正回归 | PASS | 最终正式包 `3048ms`；配置准备 `4ms`、首事件 `134ms`、回复 `2407ms`、退出 `3048ms` |
| OSV 依赖扫描 | PASS | OSV Scanner 2.3.8 对当前受版本控制及待提交源码快照扫描根锁文件 682 个包，结果为 `No issues found` |
| GitHub Actions 静态检查 | PASS | actionlint 1.7.7 检查 `.github/workflows/desktop-release.yml` 无错误 |
| 补丁格式检查 | PASS | `git diff --check` |

说明：

1. 直接递归扫描本机工作目录时，OSV 曾在 Git 忽略的 `Skills-Hub/02_projects/*` 参考项目中发现 3 个 `postcss 8.4.31` Medium 问题。
2. 这些目录由 `.git/info/exclude` 排除，不进入仓库和 CI checkout，不属于 OpenCreator 发布源码。
3. 为避免把本机参考目录误计入发布门禁，最终 OSV 结果来自 `git ls-files --cached --others --exclude-standard` 生成的当前发布源码快照。
4. GitHub Actions 中的 OSV、macOS x64/arm64 和 Windows x64 job 尚未实际触发，本地结果不能替代 CI 结果。

## 3. Desktop 功能与安全验收

| 场景 | 状态 | 证据 |
|---|---|---|
| 成功 Probe 后进入 Dashboard | PASS | Packaged E2E |
| Probe 失败停留诊断页 | PASS | `CODEX_PROBE_EXIT_NON_ZERO` 和重试计数断言 |
| Dashboard 握手失败恢复 | PASS | 本地错误页重载后不改变 Daemon PID，不重复 Probe |
| 连续刷新五次不重复 Probe | PASS | Probe attempt 保持 1 |
| JSON、二进制和 SSE 代理 | PASS | `/healthz`、附件上传下载和 Run events |
| Daemon 首次崩溃恢复 | PASS | Utility Process PID 替换，Runtime 恢复 200 |
| Daemon 第二次崩溃熔断 | PASS | `DAEMON_RESTART_EXHAUSTED` |
| IPC 非可信来源拒绝 | PASS | data URL 调用被拒绝 |
| Probe 中退出回收 Codex | PASS | Codex PID 最终不存在 |
| Renderer 不获得 Daemon Token | PASS | 连接配置仅返回 `/.opencreator/runtime` |
| Runtime 严格同源 | PASS | 只允许 `127.0.0.1:<port>`，拒绝网络路径、非法编码和前缀碰撞 |
| Runtime 重定向 | PASS | Main 标准 `fetch` 使用 `redirect: 'manual'` |
| Runtime 请求体上限 | PASS | 10 MiB 有界读取测试 |
| Probe 工具隔离 | PASS | Shell、Exec、MCP、Web Search、Computer Use 等工具事件被禁止或判定失败 |
| Renderer 安全配置 | PASS | Node API 不可见，Preload 仅暴露固定 Bridge |
| Electron Fuses | PASS | 六项 Fuse 状态由 `verify-package.mjs` 读取正式可执行文件验证 |
| ASAR 完整性 | PASS | `ElectronAsarIntegrity` 包含 `Resources/app.asar` SHA256，且只从 ASAR 加载应用代码 |

## 4. 性能与可靠性

| 指标 | 状态 | 结果 |
|---|---|---|
| Bootstrap 首屏 | PASS | Packaged E2E 断言 `appEntryAt` 到 `bootstrapDidFinishLoadAt` 不超过 1000ms |
| 登录 Shell 快速候选 | PASS | Resolver 单测断言慢 Shell 场景在 1500ms 内返回 |
| 真实 Codex Probe | PASS | 最终正式包报告记录 `3048ms`，较旧实现 `13255ms` 下降约 77%；刷新五次 Probe attempt 保持 1 |
| 窗口状态写入 | PASS | 300ms debounce 与退出前 flush 单测 |
| 日志与诊断 | PASS | 异步 flush、轮转和递归脱敏单测 |
| 子进程输出 | PASS | stdout/stderr 和未换行 frame 有界测试 |
| Web 生产 chunk | PASS | 构建通过；`FilesPage` 约 569 KiB、主 chunk 约 585 KiB，Vite 仍报告大于 500 KiB 警告 |

大 chunk 当前不阻塞 Desktop 发布候选，但会增加冷加载和解析成本，后续应按页面能力拆分或配置稳定的 manual chunks。

## 5. 包体与正式包校验

本轮 unsigned/ad-hoc macOS arm64 目录产物：

- 包根目录：`apps/desktop/release/mac-arm64/OpenCreator.app`
- 构建 commit：`f979586ba4bbfecdce0f02db3e59344f3c78fc7c`
- 构建工作区：dirty
- 包内容逻辑尺寸：`531206034` 字节
- 包磁盘占用：约 `346 MiB`
- Daemon 内容逻辑尺寸：`42999986` 字节
- Daemon 磁盘占用：约 `52 MiB`
- `app.asar`：`1294683` 字节
- 签名类型：ad-hoc，不是 Developer ID 正式签名

| 项目 | 状态 |
|---|---|
| Main、Preload、Bootstrap、共享类型存在 | PASS |
| Web 静态资源完整 | PASS |
| Daemon 生产依赖完整 | PASS |
| `better_sqlite3.node` 存在 | PASS |
| Packaged Daemon 可加载原生 SQLite | PASS |
| 不包含 `.runtime`、测试、源码映射和旧构建目录 | PASS |
| macOS `codesign --verify --deep --strict` | PASS |
| Electron ASAR 完整性元数据 | PASS |
| RunAsNode、NODE_OPTIONS、Node CLI Inspector 已关闭 | PASS |
| Cookie 加密、ASAR 校验、OnlyLoadAppFromAsar 已启用 | PASS |

## 6. 外部环境验收

| 场景 | 状态 | 说明 |
|---|---|---|
| 无 Node.js 独立干净机启动 | BLOCKED_ENV | 当前没有独立干净机 |
| macOS Developer ID 签名 | BLOCKED_ENV | 当前未提供证书 |
| macOS 公证和 stapling | BLOCKED_ENV | 当前未提供 Apple 公证凭据 |
| macOS Gatekeeper 正式包 | BLOCKED_ENV | 依赖 Developer ID 和公证产物 |
| 从上一正式版本自动更新 | BLOCKED_ENV | 当前没有上一正式版本和真实 Release 升级链路 |
| macOS 通知中心点击 | BLOCKED_ENV | 自动化覆盖路由，仍需正式包人工点击 |
| GitHub Actions 发布矩阵 | NOT_RUN | 工作流已通过 actionlint，但本轮未触发远端 CI |
| Windows x64 NSIS 构建与 E2E | BLOCKED_ENV | 当前不是 Windows x64 构建机 |
| Windows 协议、托盘、通知和进程树 | BLOCKED_ENV | 需要 Windows 实机 |
| Windows Authenticode | BLOCKED_ENV | 当前未提供 Windows 证书 |

## 7. 最终结论

1. 本轮没有未解释的 `FAIL`，此前审查中的 Critical 和 High 问题已通过实现与自动化证据关闭。
2. P0、P1 的仓库实现和 macOS arm64 自动化验收为 `PASS`。
3. P2 的离线打包、构建清单、Fuses、ASAR、packaged E2E、真实 Codex 和本地 OSV 为 `PASS`。
4. Windows、Developer ID、Apple 公证、Gatekeeper、真实升级和正式通知点击继续保持 `BLOCKED_ENV` 或 `NOT_RUN`，不能作为正式多平台发布已完成的证据。
5. 真实 Codex 报告位于 `test-results/opencreator-desktop-real-codex-smoke.json`。
