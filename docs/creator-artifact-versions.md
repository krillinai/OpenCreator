# Creator Artifact 版本与来源（第一版）

本实现基于 `origin/develop@1437396`；发布状态以合并和发行记录为准。
主线已有 Artifact、sourceArtifactIds、结果快照、历史结果菜单和文件接口。本次补充共享详情与持久化选择，不实现 DAG、自动恢复或媒体内容比较。

- `CreatorArtifactDetails` 位于唯一 `CreatorCollaborationPanel` 的任务上下文中，所有模板复用。
- `state.resultVersion` 仍是项目结果选择；详情内的产物/比较选择仅用于浏览，不作为第二套项目版本状态。
- `select-result-version` 由模板注册器统一提供，通过已有 REST / Agent Command Dispatcher 执行；同一事务保存新 Revision、Activity、Receipt。已有队列或运行阶段时拒绝切换。
- 命令选择整个项目结果快照，不修改生成设置、不启动 Stage、不修改 Artifact、旧快照或 stale 标记。图像、封面、视频、视频翻译和火柴人结果读取持久选择。
- 详情从 `changedArtifactIds` 读取生成快照，从 `sourceArtifactIds` 追踪上游。缺失来源或生成信息明确显示未知，不猜测 Stage。
- stale 原因仅显示上游 stale、缺失来源或快照失效记录。当前选中不等于当前有效。
- 同一项目内的历史文件继续通过鉴权后的 Artifact content 接口下载，包括未被快照引用的 stale 文件。无快照的旧产物不支持项目采用，只能浏览与下载。
- 文本按行号并排高亮，最多 20 万字符、显示 2000 行；插入行会使后续行高亮，不作智能对齐。图片、音频、视频使用原生预览并排展示。

验证：Daemon/Web 类型检查及构建、Dispatcher/API SQLite 重开持久化测试、公共组件测试、图像与封面复用测试、受影响工作区测试通过。真实 Chromium 的 Browser/Desktop Bridge 测试验证相同视口、文案、详情尺寸、Command 请求、刷新恢复、下载及预览。

未运行实际打包 Electron App 或包内 Web 哈希门禁；本次不是 Desktop 交付任务，不据此声明可发布或实际 App 已验收。无 Provider 执行，也未运行全量测试。原工作区字幕导出修改保留不动。
