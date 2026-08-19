# OpenCreator Desktop Windows 发布说明

## 1. 目标平台

- Windows 10/11 x64。
- NSIS 安装包。
- 用户本机预先安装 Codex CLI。
- OpenCreator 不依赖用户安装 Node.js。

## 2. Codex 解析规则

Desktop 按以下顺序查找 Codex：

1. 用户上次真实 Probe 成功的绝对路径。
2. 当前进程 `PATH`。
3. `where.exe codex` 返回的绝对路径。
4. `%APPDATA%\npm`。
5. `%USERPROFILE%\AppData\Roaming\npm`。
6. `%USERPROFILE%\.local\bin`。

支持：

- `codex.exe`
- `codex.cmd`
- `codex.bat`

`.cmd` 和 `.bat` 由 `cross-spawn` 启动，避免直接使用 Node `spawn` 时无法执行命令包装脚本。

## 3. 本地构建

```powershell
$env:OPENCREATOR_DESKTOP_TARGET_PLATFORM = "win"
$env:OPENCREATOR_DESKTOP_TARGET_ARCH = "x64"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
pnpm desktop:release
```

主要产物：

```text
apps/desktop/release/
├── win-unpacked/
├── OpenCreator Setup <version>.exe
├── OpenCreator Setup <version>.exe.blockmap
└── latest.yml
```

打包完成后还必须存在：

```text
apps/desktop/release/opencreator-desktop-build-manifest.json
```

构建清单中的 `platform` 必须为 `win32`、`arch` 必须为 `x64`，`packageRoot` 必须唯一指向 `win-unpacked`。`verify:package` 和 packaged E2E 必须使用该清单，不能扫描旧目录猜测产物。

## 4. 安装与数据

1. NSIS 使用非 one-click 安装，允许用户选择安装目录。
2. 卸载不删除 OpenCreator 用户数据。
3. 升级不得删除 Desktop 设置、SQLite、任务、附件和日志。
4. 用户数据位于 Electron `userData` 对应目录。
5. Codex 配置继续位于用户的 `CODEX_HOME`。

## 5. 协议、托盘和通知

安装包注册：

```text
opencreator://
```

必须验证：

1. `opencreator://tasks` 打开现有 OpenCreator 实例。
2. Thread、Run 和 Approval 参数能正确编码。
3. 第二次启动不创建第二个 Runtime。
4. 关闭窗口默认只隐藏到托盘。
5. 托盘退出会有序停止 Daemon。
6. 通知点击复用现有窗口。

Windows 第二实例参数由 `findDeepLink(argv)` 解析，不能绕过 Codex 启动门禁。

## 6. 进程回收

Daemon 和 Codex 子进程退出兜底使用：

```powershell
taskkill.exe /PID <pid> /T
taskkill.exe /PID <pid> /T /F
```

Electron Main 必须异步启动并等待 `taskkill.exe`，不得使用 `spawnSync` 阻塞主线程。正常退出先尝试不带 `/F` 的回收，超时后再强制终止。

验收时必须确认：

1. 正常退出后无 Daemon 残留。
2. Probe 超时后无 Codex 残留。
3. Daemon 被强杀后无 Codex 子进程树残留。
4. 应用崩溃恢复最多自动重启一次。

## 7. Windows 签名

CI 使用：

- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

正式发布前验证 Authenticode：

```powershell
Get-AuthenticodeSignature ".\OpenCreator Setup <version>.exe" | Format-List
```

预期 `Status` 为 `Valid`。没有证书时生成的 unsigned 安装包只能用于内部测试。

## 8. 验收清单

### 8.1 CI 自动化

`.github/workflows/desktop-release.yml` 的 `windows-x64` job 必须执行：

1. `pnpm test`。
2. `pnpm typecheck`。
3. `pnpm desktop:release` 生成 NSIS、blockmap、`latest.yml` 和构建清单。
4. `pnpm --filter @opencreator/desktop e2e:package`。
5. `pnpm --filter @opencreator/desktop verify:package`，由打包脚本自动调用。
6. 上传安装包、更新元数据和构建清单。

工作流已经通过 actionlint 1.7.7 静态检查，但截至 2026-07-16 尚未在 GitHub Actions Windows runner 实际执行，因此不能标记为 `PASS`。

### 8.2 实机验收

1. 终端执行 `where.exe codex` 能找到与 Desktop 相同路径。
2. 真实 hello Probe 成功。
3. Probe 失败进入诊断页，不显示登录页面。
4. Dashboard JSON、SSE 和二进制代理正常。
5. 连续刷新五次不重复 Probe。
6. 关闭窗口后任务继续。
7. 深链接和通知点击可用。
8. 安装、覆盖升级和卸载不删除用户数据。
9. Electron Fuses、ASAR 完整性和原生 SQLite 在 Windows 正式包中通过。
10. Windows Defender 和 SmartScreen 结果已记录。

当前 macOS arm64 环境无法完成 Windows NSIS 构建、packaged E2E、安装、托盘、通知、协议注册、进程树和 Authenticode 实机验证。上述项目在最终报告中保持 `BLOCKED_ENV` 或 `NOT_RUN`。
