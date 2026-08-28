# OpenCreator Agent 用户指南与故障排查

## 1. 启动

在仓库根目录运行：

```bash
corepack enable
pnpm install
pnpm web:dev
```

打开 `http://127.0.0.1:19861/`。首次访问会按需启动 daemon；页面顶部显示“本地运行内核正常”后即可发送任务。

## 2. 核心工作流

### 会话和任务

1. 从左侧选择项目或新建对话。
2. 输入任务，选择权限、Profile、模型和推理强度。
3. 运行中可排队发送后续任务，或选择立即打断并继续。
4. 切换会话不会停止后台 Run；侧栏转圈表示该会话仍在执行。
5. 任务中心可查看运行中、失败、完成和待审批任务，并跳转到 Run Detail。

### 已安排和任务会话

1. 在“已安排”中手动创建任务，或选择“使用 OpenCreator 创建”并用自然语言描述任务。
2. 每条任务会创建一个长期专属会话；创建完成后可以从侧栏“任务”直接进入。
3. “已安排”负责编辑时间、暂停、恢复、立即运行和删除；任务会话负责查看触发历史、
   审批、结果和继续对话。
4. 同一任务的自动触发、立即运行和会话内消息不会并行写入。默认策略为 `queue`，
   也可以选择运行中跳过本次触发。
5. 删除任务会归档任务会话，但不会删除已有 Run、结果或底层 Codex 历史。
6. 底层 Codex thread 失效或达到轮换阈值时可以更换，但侧栏任务入口和 OpenCreator Thread
   不会变化。

### 附件和文件

- Composer 支持选择、拖放和粘贴图片。
- 文件工作区支持文本编辑、图片、PDF 和 HTML 预览。
- HTML 默认在无脚本 sandbox 中预览；外部链接必须显式打开。

### 审批

Codex 请求执行受控命令时，Timeline 和任务中心会显示待审批卡片。批准或拒绝均会写入本地数据库；刷新后仍能恢复。不要批准不理解的命令。

### 记忆和摘要

- 设置 -> 记忆：创建全局、项目或线程记忆。
- Agent 只会显示“保存为长期记忆”的建议，不会自动保存。
- 可能包含 token、password、secret 等内容时必须二次确认。
- 会话头部“生成摘要”会创建版本化摘要；Run Detail 可查看该次 Run 实际使用的记忆和摘要快照。

## 3. 备份与恢复

备份前先停止 `pnpm web:dev` 或独立 daemon，避免复制过程中 SQLite 仍在写入。

```bash
mkdir -p backups
cp -R .runtime "backups/runtime-$(date +%Y%m%d-%H%M%S)"
```

恢复：

1. 停止 Web 和 daemon。
2. 将当前 `.runtime` 移到其他位置保留。
3. 把备份目录复制回仓库根目录并命名为 `.runtime`。
4. 重新运行 `pnpm web:dev`。
5. 检查历史会话、任务中心、附件和记忆。

不要只恢复 `app.sqlite` 而遗漏 `attachments/` 和 `runs/`，否则元数据仍在但文件快照可能缺失。

Codex 自身会话和配置位于 `$CODEX_HOME`，需要单独按目录备份。

## 4. 清理与诊断

- 设置 -> 清理：先预览，再确认删除旧 Run 日志和已归档托管工作区。
- 设置 -> 诊断：检查 Codex 版本、路径、能力和 Runtime 状态。
- Run Detail -> 导出脱敏诊断包：只导出 daemon 已脱敏的当前 Run 诊断响应。

清理不会删除 SQLite 中的线程和 Run 状态，也不会删除外部项目目录。

## 5. 常见故障

### 页面一直显示正在连接

1. 确认终端中的 `pnpm web:dev` 未退出。
2. 请求 `http://127.0.0.1:19861/.opencreator/runtime/healthz`，应返回 `{"ok":true}`。
3. 检查终端是否出现 `RUNTIME_START_FAILED` 或 `RUNTIME_PROXY_FAILED`。
4. 确认 19861 端口没有被旧进程占用；该端口被占用时 Vite 会直接退出。

### 刷新后历史为空

- 等待顶部连接状态恢复后再检查。
- 页面只加载当前可见会话的首批历史，其他会话在点击后按需加载。
- 若某个会话不存在，检查 `$CODEX_HOME/sessions` 是否被移动，以及 `.runtime/app.sqlite` 是否来自正确备份。

### Run 长时间没有输出

1. 在任务中心确认状态是运行中、排队中还是待审批。
2. 打开 Run Detail 查看 diagnostics。
3. 检查 Codex 登录：

```bash
codex --version
codex exec --json --skip-git-repo-check --sandbox read-only "Reply with OK only."
```

出现 `401 token_expired` 或 `refresh_token_reused` 时，需要重新登录 Codex；不要通过删除 OpenCreator 数据规避登录问题。

### 图片无法发送

- 设置 -> 诊断中确认当前 Codex 支持图片输入。
- 单个附件必须在大小上限内，且实际文件类型必须与声明 MIME 一致。
- 版本过低时更新 Codex CLI 后重启 Web。

### HTML 预览与源码相同

在编辑器工具栏切换到“预览”。HTML 预览故意禁用脚本；依赖脚本执行的页面不会按普通网站方式运行。

### 通知没有出现

- 在任务中心显式启用系统通知。
- 浏览器或操作系统必须允许该站点通知。
- 当前前台可见会话完成时会抑制系统通知，避免重复提醒。
- 浏览器页面关闭后是否仍有通知取决于原生 Desktop Host；浏览器版不能保证后台展示。
- 通知已出现但跳转不正确时，从“任务”进入对应会话并在 Run Detail 导出脱敏诊断。

### 旧任务没有出现在侧栏

1. 重启新版 daemon，让启动流程先执行迁移和任务会话绑定修复。
2. 在“已安排”确认任务未删除；已暂停任务仍应显示，已删除任务不会显示。
3. 查看 Schedule 操作记录是否存在 `SCHEDULE_THREAD_REPAIR_FAILED`。
4. 修复失败的任务会被禁用，通常需要先修正不存在的项目目录或无效 Profile。
5. 不要手工删除 `thread_id`、任务 Thread 或旧 Codex session。

## 6. 重置本地 Runtime 数据

该操作会移除 OpenCreator 本地线程、Run、附件元数据、审批、记忆和摘要。先完成备份，再停止服务并手工移动 `.runtime`。不要删除 `$CODEX_HOME`，除非明确要同时重置 Codex 本身。
