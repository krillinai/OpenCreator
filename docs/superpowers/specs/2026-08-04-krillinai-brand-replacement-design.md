# KrillinAI 品牌替换设计

## 目标

将当前 Clawee 定制界面中的 Coca-Cola 品牌替换为 KrillinAI，同时保持 Clawee 产品名称、版本号、侧边栏结构和交互不变。

## 替换范围

- 侧边栏展开状态中的合作品牌名称由 `Coca-Cola` 改为 `KrillinAI`。
- 侧边栏收起状态中的 Coca-Cola Logo 改为用户提供的 KrillinAI Logo。
- Logo 的替代文本、测试断言和静态资源路径同步使用 KrillinAI 命名。
- 共享云盘示例文件 `可口可乐品牌视觉规范 2026.pdf` 改为 `KrillinAI 品牌视觉规范 2026.pdf`。
- 删除不再被引用的 Coca-Cola 静态 Logo 资源。

本次不修改 Clawee 名称、`v0.1.0` 版本标识、其他示例文件、功能流程或数据结构。

## Logo 资源

以用户提供的黑色 KrillinAI 图形为视觉来源，制作透明背景的本地 `krillinai-mark.svg`。资源仅包含图形，不保留上传图片的白色画布，避免在侧边栏中形成白色方块。

Logo 沿用现有侧边栏标识尺寸和布局约束。浅色模式显示黑色图形，深色模式通过现有主题样式显示白色图形，确保两种背景下均有清晰对比度。Logo 不依赖外部 URL，保证离线 Web 与打包 Desktop 一致。

## 组件行为

展开侧边栏继续按两行品牌锁定结构展示：第一行 `KrillinAI`，第二行 `Clawee v0.1.0`。收起侧边栏继续以 Logo 作为展开按钮的主要视觉信号，按钮行为、tooltip 和自动收起逻辑保持不变。

本次替换发生在 `apps/web` 共享实现中，不增加 Browser Bridge 或 Desktop Bridge 分支。相同内容视口和主题下，Web 与 Desktop 使用同一资源、文案、DOM 和样式。

## 验证

- 侧边栏组件测试验证展开状态显示 `KrillinAI`，且不再显示 `Coca-Cola`。
- 侧边栏组件测试验证收起状态的图片替代文本和资源路径均指向 KrillinAI。
- 共享云盘页面测试验证 KrillinAI 示例文件名，并确认旧名称不存在。
- Web 类型检查和相关单元测试通过。
- 在浅色和深色主题下检查 Logo 可见性、尺寸和品牌区布局。

本次不涉及 Daemon、Host Bridge、Preload 或 Desktop 原生能力。实际 Desktop 打包与嵌入资源哈希校验仍是发布前门禁。
