# OpenCreator Desktop 发布手册

## 1. 适用范围

本文用于发布 OpenCreator Desktop 的 macOS x64、macOS arm64 和 Windows x64 安装包，暂不发布 Linux。Desktop 安装包包含固定版本的 Codex CLI、KrillinAI CLI、ffmpeg、ffprobe 和 yt-dlp；Whisper CLI 与模型不进入安装包，由 KrillinAI 在功能实际需要时下载到用户数据目录。

发布入口：

```bash
pnpm desktop:release
```

本地仅生成可运行目录、构建清单并执行正式包校验：

```bash
OPENCREATOR_DESKTOP_OFFLINE=1 \
CSC_IDENTITY_AUTO_DISCOVERY=false \
pnpm desktop:package
```

`OPENCREATOR_DESKTOP_OFFLINE=1` 要求 pnpm、Electron headers、原生模块、Codex Runtime 和 Creator Runtime 构建缓存已经完整。缓存缺失时必须明确失败，不能静默切换为在线下载。

## 2. 发布前条件

1. Node.js 22。
2. pnpm 9.15.0。
3. macOS 构建机安装 Xcode Command Line Tools。
4. Windows 构建机允许执行 PowerShell 和 NSIS 打包工具。
5. 仓库全量测试、类型检查和构建通过。
6. 打包脚本会删除目标架构旧目录，并要求构建后只找到一个 fresh package root。
7. Codex Runtime 三个平台清单中的 npm tarball integrity 和逐文件 SHA-256 已固定。
8. Creator Runtime 的 KrillinAI、ffmpeg、ffprobe、yt-dlp 下载地址和 SHA-256 已固定。
9. OSV Scanner 2.3.8 扫描发布源码无未解释漏洞。
10. `.github/workflows/desktop-release.yml` 通过 actionlint。

## 3. 版本与标签

1. 更新 `apps/desktop/package.json` 的版本。
2. 确认 GitHub Release 发布权限、签名凭据和目标版本更新元数据流程可用。
3. 创建并推送 `v<version>` Git tag 触发 `.github/workflows/desktop-release.yml`。标签版本必须与 `apps/desktop/package.json` 完全一致。
4. CI 先运行全仓验证，再使用 `macos-15-intel`、`macos-15` 和 `windows-latest` 并行构建三个原生目标平台。
5. 标签构建成功后，CI 将安装包和更新元数据上传到 GitHub Release。

示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 4. macOS 签名与公证

CI secrets：

| Secret | 用途 |
|---|---|
| `MACOS_CERTIFICATE` | Developer ID Application 的 `.p12`，支持 base64 或文件形式 |
| `MACOS_CERTIFICATE_PASSWORD` | `.p12` 密码 |
| `APPLE_ID` | 公证使用的 Apple ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

签名配置位于：

- `apps/desktop/electron-builder.yml`
- `apps/desktop/resources/entitlements.mac.plist`

未配置证书时，发布脚本会设置 `CSC_IDENTITY_AUTO_DISCOVERY=false` 并关闭 notarize，仍生成 unsigned artifact，用于内部测试，不能作为正式外发包。

正式包验证：

```bash
codesign --verify --deep --strict --verbose=2 "OpenCreator.app"
spctl --assess --type execute --verbose=4 "OpenCreator.app"
xcrun stapler validate "OpenCreator.app"
```

预期：

1. `codesign` 无错误。
2. `spctl` 返回 accepted。
3. `stapler` 返回 validation worked。
4. 从 DMG 拖入 Applications 后首次启动不提示应用已损坏。

## 5. Windows 签名

CI secrets：

| Secret | 用途 |
|---|---|
| `WINDOWS_CERTIFICATE` | Windows 代码签名证书 |
| `WINDOWS_CERTIFICATE_PASSWORD` | 证书密码 |

发布脚本会将其映射为 Electron Builder 使用的 `CSC_LINK` 和 `CSC_KEY_PASSWORD`。未配置证书时仍生成 unsigned NSIS 安装包。

## 6. 自动更新

正式包更新源固定为 Electron Builder 配置中的 GitHub Releases：

```text
provider: github
owner: krillinai
repo: OpenCreator
```

生产运行时不依赖 `OPENCREATOR_UPDATE_URL`。测试通过注入 fake updater 隔离，不允许把开发覆盖写入正式包。

GitHub Release 至少包含：

1. macOS arm64 的 `latest-mac.yml`、DMG/ZIP 和 blockmap。
2. macOS x64 的 `latest-x64-mac.yml`、DMG/ZIP 和 blockmap。
3. Windows x64 的 `latest.yml`、NSIS EXE 和 blockmap。
4. 每个平台独立命名的 Desktop 构建清单。
5. 文件名、版本和 SHA512 与 Electron Builder 产物一致。

客户端行为：

1. 每次启动和每 6 小时检查一次。
2. 发现更新后由用户确认下载。
3. 下载完成后由用户确认退出安装。
4. 不静默终止正在运行的任务。
5. 安装前停止通知、flush 窗口状态和日志，再停止 Daemon。
6. 安装准备或 `quitAndInstall()` 失败时恢复当前 Runtime 和通知能力。
7. 更新失败不影响当前版本继续运行。

## 7. 发布验证

```bash
pnpm test
pnpm typecheck
pnpm build
OPENCREATOR_DESKTOP_OFFLINE=1 \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  pnpm desktop:package
pnpm --filter @opencreator/desktop verify:package
pnpm --filter @opencreator/desktop e2e:package
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 pnpm --filter @opencreator/desktop e2e:real-codex
```

`verify:package` 会检查：

1. Desktop Main、Preload、Bootstrap 和共享运行时代码完整。
2. Web 静态资源完整。
3. Daemon 生产依赖完整。
4. 不包含 `.runtime`、源码映射、测试和旧打包目录。
5. `better_sqlite3.node` 存在。
6. RunAsNode、NODE_OPTIONS 和 Node CLI Inspector 已关闭。
7. Cookie 加密、ASAR 完整性和 OnlyLoadAppFromAsar 已启用。
8. macOS 代码签名结构和 `ElectronAsarIntegrity` 元数据有效。
9. Codex Runtime 与 Creator Runtime 的平台、架构、文件列表和 SHA-256 与固定清单一致。
10. Creator Runtime 不包含 Whisper 可执行文件或模型。

原生 SQLite 的真实加载、Runtime JSON/二进制/SSE、Daemon 恢复和进程回收由 packaged E2E 验证。启用 RunAsNode Fuse 后，不再使用正式可执行文件的 `-e` 模式执行 Node 烟测。

打包脚本会生成：

```text
apps/desktop/release/opencreator-desktop-build-manifest.json
```

`verify:package` 和 `e2e:package` 默认读取同一构建清单。CI 中打包脚本还会把 `OPENCREATOR_DESKTOP_PACKAGE_ROOT` 写入 `GITHUB_ENV`，禁止从多个旧目录中猜测产物。

### 7.1 依赖安全扫描

CI 使用：

```text
google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8
```

本地扫描应在干净 checkout 中执行：

```bash
osv-scanner scan source --recursive .
```

如果当前工作目录包含被 Git 忽略的参考仓库或样例项目，应先基于以下文件集生成临时发布源码快照，再扫描快照：

```bash
git ls-files --cached --others --exclude-standard
```

不得把本机忽略目录中的结果误记为 OpenCreator 发布依赖，也不得因扫描器下载、网络或 OSV 服务失败而记为 `PASS`。

### 7.2 Runtime 代理验收

Electron Main 使用 Node 24 标准 `fetch` 转发到固定 `127.0.0.1:<port>`，并设置 `redirect: 'manual'`。选择标准 `fetch` 是因为 Electron `net.fetch` 在 `protocol.handle` 内出现过无法稳定收敛的挂起；Token 仍只在 Main 完成最终同源校验后注入。

## 8. 发布后检查

1. 冷启动先显示 Codex 检测页。
2. 真实 hello Probe 成功后进入 Dashboard 。
3. 连续刷新五次不重复 Probe。
4. 关闭窗口后应用进入托盘，任务继续。
5. `opencreator://tasks` 和 `opencreator://thread/<id>` 聚焦现有实例。
6. 系统通知点击进入正确任务。
7. 真正退出后无 Daemon 或 Codex 子进程残留。
8. 日志和诊断文件中没有 token。
9. 更新检查直接使用 GitHub Releases，不依赖 `OPENCREATOR_UPDATE_URL`。
10. 构建清单中的 package root 与 verify、E2E 使用的产物一致。

## 9. 回滚

1. 停止分发有问题的更新元数据。
2. 恢复上一版本安装包、YAML 和 blockmap。
3. 不删除用户 `userData`。
4. 不降级或覆盖用户 `CODEX_HOME`。
5. 若数据库 schema 不支持降级，保留当前数据目录备份并发布前向修复版本。

环境缺失导致无法完成的签名、公证、干净机、Windows 和真实升级验证，必须在最终验收报告中标记为 `BLOCKED_ENV` 或 `NOT_RUN`，不能记为 `PASS`。
