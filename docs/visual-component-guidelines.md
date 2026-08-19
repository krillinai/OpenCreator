# OpenCreator 视觉与组件规范

本文档整理当前 Web 客户端已经形成的视觉语言和组件规则，后续新增功能或页面时优先延续这些规范。对应实现主要位于：

- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/app.css`
- `apps/web/src/features/shell/OpenCreatorSidebar.tsx`
- `apps/web/src/features/runs/Composer.tsx`
- `apps/web/src/features/files/FileTopBar.tsx`
- `apps/web/src/components/timeline/Timeline.tsx`

## 1. 视觉基调

OpenCreator 当前是深色、低噪声、偏工具型的桌面应用界面。整体气质应该克制、轻量、专注，不做营销页式大卡片和强装饰。

核心方向：

- 深色背景为主，避免大面积纯黑以外的单一色块。
- 主题高亮统一使用暖橙色，不再使用紫色作为主高亮。
- 面板、输入框、弹层使用轻微半透明和模糊，形成“玻璃感”，但不要过亮。
- 交互动效保持短、轻，主要用于 hover、active、侧栏收起展开、toast 自动消失等。
- 页面主体不要堆叠卡片。卡片只用于设置项、代码块、重复列表项、弹层和实际需要框定的工具区域。

## 2. Design Tokens

所有新增样式应优先使用 `tokens.css` 中的 CSS 变量。

### 颜色

| 用途 | Token | 当前值 |
| --- | --- | --- |
| 全局背景 | `--bg` | `#0e1116` |
| 对话区背景 | `--conversation-bg` | `#090d12` |
| 侧栏背景 | `--sidebar` | `#080d12` |
| 默认面板 | `--surface` | `#16191e` |
| 次级面板 | `--surface-2` | `#1c2026` |
| 悬浮/活跃面 | `--surface-3` | `#24282e` |
| 弹层 | `--popover` | `#24282e` |
| 主文字 | `--text` | `#fcfdff` |
| 次文字 | `--muted` | `rgba(252, 253, 255, 0.68)` |
| 弱文字/图标 | `--subtle` | `rgba(252, 253, 255, 0.42)` |
| 主题色 | `--accent` | `#AD4D1F` |
| 强主题色 | `--accent-strong` | `#D86532` |
| 主题弱背景 | `--accent-soft` | `rgba(173, 77, 31, 0.18)` |
| 主题辉光 | `--accent-glow` | `rgba(173, 77, 31, 0.34)` |
| 危险 | `--danger` | `#ff766e` |
| 警告 | `--warning` | `#f0a866` |
| 成功 | `--success` | `#72d6a7` |

使用规则：

- 主操作按钮、选中态、当前项目 icon、输入框渐变描边都使用 `--accent` / `--accent-strong`。
- 非主操作按钮不要直接大面积使用主题色，只在 hover 或 selected 时轻微提示。
- 警告、错误、成功状态使用专用 token，不要复用主题色表达状态。
- 新增渐变建议使用 `linear-gradient(180deg, var(--accent-strong), var(--accent))` 或现有发送按钮渐变。

### 字体

| 用途 | Token |
| --- | --- |
| 默认字体 | `--font` |
| 展示标题 | `--font-display` |
| 代码/路径/命令 | `--font-mono` |

使用规则：

- 普通 UI 文本使用 Inter 系列，即 `var(--font)`。
- 初始页大标题、少量展示型标题可以使用 `var(--font-display)`。
- 文件路径、代码块、命令、技术状态使用 `var(--font-mono)`。
- 不使用 viewport 宽度动态缩放字体。
- 字间距保持默认，不使用负字距。

### 圆角与阴影

- 默认圆角：`--radius: 10px`。
- 常规按钮：`7px` 到 `10px`。
- 图标圆按钮：圆形或 `12px`。
- 输入框主容器：桌面 `22px`，移动端 `10px`。
- 选项卡、工具按钮、文件树行：`7px` 到 `9px`。
- 阴影使用深色低透明阴影，避免亮色厚重投影。

## 3. 全局布局

主应用布局：

- 展开侧栏：`248px + main`。
- 右侧详情展开：`248px + main + 320-400px`。
- 收起侧栏：`72px + main`。
- 文件工作区内：对话区和文件区之间使用 `6px` resize handle。

页面结构原则：

- 顶部 header 高度通常在 `56px` 到 `72px`。
- 主内容区必须 `min-width: 0`、`min-height: 0`，滚动交给内部区域。
- 新功能页应使用 `var(--bg)` 或 `var(--conversation-bg)` 作为底色，内容面板使用 `var(--surface)`。
- 宽屏不要把内容拉满，列表或正文区域建议设置合理 `max-width`。

响应式：

- `920px` 以下主布局变为单列，详情面板隐藏。
- `480px` 以下侧栏导航变紧凑，部分文字可隐藏，输入框和工具栏允许换行。

## 4. 背景规范

### 对话默认态背景

动态背景只在“初始状态，无选中会话且暂无 timeline 内容”时展示。

当前参数：

- 颜色：`#AD4D1F`、`#D86532`、`#F0A866`
- `speed: 0.28`
- `streakCount: 3`
- `density: 0.12`
- `glow: 0.48`
- `backgroundGlow: 0.34`
- `opacity: 0.72`
- 禁用鼠标交互：`mouseInteraction={false}`

使用规则：

- 开始对话后或加载已有会话时，背景切换为纯色 `var(--conversation-bg)`。
- 设置页中的“动态背景”开关关闭后，默认态也使用纯色背景。
- resize 时背景底色必须保持 `var(--conversation-bg)`，避免纯色和动态背景之间闪白或变色。
- 动态背景只作为氛围，不能抢占文字层级。

### 对话底部渐变

输入框上方使用柔和遮罩：

- `.composer-wrap` 承接底部背景。
- `.composer-wrap::before` 向上延伸渐变，避免消息列表和输入框硬切。

新增对话页底部内容时，要保留这层渐变过渡。

## 5. 滚动条

全局滚动条：

- 宽度和高度：`6px`。
- track 透明，不展示背景轨道。
- thumb：`rgba(145, 153, 168, 0.28)`。
- hover：`rgba(161, 170, 186, 0.38)`。
- Firefox 使用 `scrollbar-color: rgba(145, 153, 168, 0.3) transparent`。

使用规则：

- 不要给局部滚动区域额外添加可见 track。
- 侧栏项目列表滚动条尽量靠右，保持 `.sidebar-project-tree` 当前负 margin 和右侧 padding 的思路。
- 新增滚动容器应保持 `overflow: auto`，避免整个页面滚动导致布局跳动。

## 6. 左侧导航

### 品牌区

展开态：

- 使用 `OpenCreator` 文字品牌，不加载图片标识。
- 品牌文字宽度约 `124px`，高度约 `24px`。
- 右侧展示收起按钮。

收起态：

- 宽度 `72px`。
- 展示通用菜单图标。
- hover 或 focus 时切换为展开 icon。

### 顶部主导航

当前入口：

- 新对话
- 搜索
- 已安排
- 插件

样式规则：

- 行高固定：`40px`。
- icon 列宽：`22px`。
- icon 与文本间距：`4px`。
- 默认文字权重较高，项目标题除外。
- hover 背景：`rgba(252, 253, 255, 0.07)`。
- 当前页可用主题弱背景和轻描边。

### 项目与会话

项目行：

- 项目标题不加粗，使用 `font-weight: 520`。
- 当前项目只改变 folder icon 颜色为 `var(--accent)`，项目整行不高亮。
- 展开项目使用 `FolderOpen`，收起项目使用 `Folder`。

会话行：

- 与项目文本左侧对齐。
- 高度固定，避免刷新前后间距跳动。
- 只有选中的会话高亮，项目和会话不能同时整行高亮。
- 选中会话使用 `rgba(173, 77, 31, 0.14)` 背景，不要添加高亮描边。

底部设置：

- 与 logo 左侧视觉对齐。
- icon 与文本间距保持紧凑。
- “更新”入口当前已移除，后续没有真实功能不要提前放置入口。

## 7. 对话 Header

高度和布局：

- 最小高度 `64px`。
- 左侧标题和项目名，右侧文件按钮与详情按钮。
- 背景为深色透明渐变，并带 `backdrop-filter: blur(18px)`。
- 底部分割线使用低透明白色，不要过亮。

标题：

- 对话标题 `17px`，`font-weight: 680`。
- 项目名 `12px`，使用 `--muted`。
- 状态 pill 使用小号圆角胶囊，包含成功状态圆点。

工具按钮：

- 图标优先使用 `lucide-react`。
- icon-only 按钮尺寸 `32px`。
- 文本按钮高度 `32px`，左右 padding `11px`。

## 8. 对话消息列表

消息区域：

- 背景使用 `var(--conversation-bg)`。
- 有动态背景时 body 透明，无动态背景时 body 使用纯色。
- 历史加载时使用半透明深色 overlay，不清空原有内容，避免闪白。

消息栈：

- 最大宽度约 `960px`。
- 消息间距约 `28px`。
- 气泡最大宽度约 `820px`。

用户消息：

- 右对齐。
- 不展示头像和昵称。
- 气泡右上角保持直角：`border-top-right-radius: 0`。
- 背景为 `surface-3` 混合少量主题色。

Agent 消息：

- 不展示头像和昵称，回复正文直接进入消息区。
- 气泡左上角保持直角：`border-top-left-radius: 0`。
- 默认背景：`rgba(36, 40, 46, 0.88)`。
- 可使用轻微玻璃模糊和深色阴影。

过程消息：

- reasoning、tool、diagnostic 等内容使用更小字号和更弱颜色。
- 过程 details 保持扁平，不要做重卡片。
- 命令和 payload 使用 monospace。

## 9. 输入框 Composer

主输入框是当前产品最重要的交互组件，新增页面如果需要任务输入，应复用该形态。

容器：

- 类名：`.opencreator-composer`。
- 最大宽度：`980px`。
- 背景为深色半透明渐变。
- 边框使用渐变色：白色亮边到暖橙色，再回到低透明白色。
- `backdrop-filter: blur(22px)`。
- 桌面圆角 `22px`，移动端 `10px`。
- 不使用 focus 后的高亮边框。

textarea：

- 默认一行，高度约 `28px`。
- 自动根据内容增高。
- 最高为 3 行，超过后内部滚动。
- 手动 resize 关闭：`resize: none`。
- 输入时保证当前行可见。
- placeholder 使用 `--subtle`。
- focus 和 focus-visible 不显示 outline 或额外 box-shadow。

工具栏：

- 左侧：添加上下文、权限选择。
- 右侧：模型选择、发送按钮。
- “完全访问”和“默认模型”只展示图标和文字，不加圆角矩形背景。
- 附件按钮为圆形 icon button。

发送按钮：

- 尺寸 `38px * 38px`。
- 圆角方形，`border-radius: 12px`。
- 可发送状态使用紫色以外的暖橙渐变：
  `linear-gradient(180deg, #DF7440 0%, #AD4D1F 54%, #7C3217 100%)`。
- icon 为白色。
- 输入为空或禁用时按钮置灰。

弹层：

- 背景使用 `var(--popover)` 混合透明。
- 圆角 `14px`。
- `backdrop-filter: blur(20px)`。
- 菜单项高度 `38px`，hover 使用 `var(--surface-3)`。

## 10. 文件工作区

### 顶部栏

高度：

- 文件顶部栏最小高度 `72px`。
- 左侧标题与路径上下排列。
- 右侧为模式切换、保存、打开目录、目录树切换、关闭。

路径区：

- 使用小字号 `12px` 和 `--muted`。
- 路径分隔符使用 `--subtle`。
- 复制路径按钮跟在路径后面。
- 复制按钮只展示 icon，不要矩形外轮廓。
- icon 尺寸约 `14px`，按钮尺寸约 `18px`。

Toast：

- 复制路径后的提示展示在复制按钮右侧。
- 使用 inline pill，不占用预览区顶部空间。
- 自动隐藏时间：`2200ms`。
- 背景：`rgba(22, 25, 30, 0.92)`。
- 圆角胶囊，轻阴影，`backdrop-filter: blur(16px)`。

### 编辑/预览模式

模式切换：

- 使用 segmented control。
- 外层背景 `var(--surface-2)`。
- 当前状态高亮为暖橙渐变，并使用白色文字。
- 未选中项使用 `--muted`。

保存按钮：

- 有可保存内容时使用主操作渐变。
- 无法保存时置灰。
- 不要只靠文字提示状态，禁用态应明显。

### 文件树

目录树：

- 行高 `32px` 左右。
- hover 使用 `var(--surface-3)`。
- 当前文件使用 `--accent-soft` 背景和左侧 `2px` accent 指示。
- 文件名必须省略号截断。

编辑器：

- CodeMirror 背景使用 `var(--surface)`。
- gutter 使用 `var(--surface-2)`。
- 选择色使用 `color-mix(in srgb, var(--accent) 42%, transparent)`。

## 11. 设置页

布局：

- 左侧设置导航 `240px`。
- 右侧内容 padding：桌面 `48px clamp(24px, 6vw, 72px)`。
- 移动端单列布局。

设置卡片：

- 使用 `var(--surface)`。
- 边框使用 `var(--border)`。
- 圆角 `12px`。
- 行高度不低于 `48px`。

开关：

- 宽 `42px`，高 `24px`。
- 关闭态为低透明白色背景。
- 开启态使用 `rgba(173, 77, 31, 0.86)`。
- 圆点位移 `18px`。

设置导航当前态：

- 背景 `var(--accent-soft)`。
- 左侧 `2px` accent 指示。

## 12. Markdown 与代码块

正文：

- 默认 `14px / 1.68`。
- assistant/document 变体可使用 `14.5px / 1.72`。
- process/tool/diagnostic 使用 `12.5px / 1.58` 和 `--muted`。

代码块：

- 外层使用 `var(--surface-2)`，边框 `var(--border)`。
- 圆角使用 `var(--radius)`。
- 代码字体使用 `var(--font-mono)`。
- header 高度约 `34px`。
- 复制等 action 按钮采用轻量 icon/text，不做重背景。

链接：

- 颜色 `var(--accent)`。
- 使用低透明底边线，不使用默认蓝色。

表格：

- 外层可横向滚动。
- 表头背景 `var(--surface-2)`。
- 单元格边框使用 `var(--border)`。

## 13. 按钮规范

主按钮：

- 用于发送、保存、关键确认。
- 背景：暖橙垂直渐变。
- 文字和 icon 使用白色。
- hover 稍微提亮，不改变色相。
- disabled 使用灰色渐变或 `var(--surface-3)`，文字使用 `--subtle`。

次级按钮：

- 背景为深色半透明或 `var(--surface-2)`。
- 边框使用 `var(--border)`。
- hover 时可加入很淡的 accent ring：`rgba(173, 77, 31, 0.08)`。

图标按钮：

- 优先使用 `lucide-react`。
- 常规尺寸 `32px` 到 `38px`。
- 不熟悉的 icon 必须有 `aria-label` 和 `title`。
- 能用 icon 表达的工具命令优先用 icon，不强行放文字。

## 14. 表单与输入

输入框：

- 默认深色背景。
- focus 后不要出现明显高亮边框。
- 需要强调时用容器级渐变边框，而不是 input 自身的焦点边框。
- placeholder 使用 `--subtle`。

搜索框：

- 高度 `32px` 到 `34px`。
- 背景 `var(--surface-2)`。
- 边框 `var(--border)`。
- 左侧搜索 icon 时 padding 预留 `34px`。

下拉菜单：

- 使用 popover 样式。
- 当前项可用 check icon，不需要整行强高亮。

## 15. 状态反馈

Toast：

- 用于轻量成功、复制、短反馈。
- 就近出现，优先贴近触发按钮。
- 自动隐藏。
- 不占用主内容布局高度。

Notice / Error bar：

- 只用于需要用户处理或持续可见的状态，例如冲突、错误。
- 可以占用顶部空间。
- 错误使用 `--danger-soft` 与 `--danger`。
- 冲突或保存状态使用 `--warning-soft` 与 `--warning`。

Loading：

- 切换会话或加载历史时，不清空右侧内容后再渲染。
- 使用 overlay 或原内容保持策略，避免闪白。
- overlay 背景使用 `rgba(9, 13, 18, 0.72)` 和模糊。

## 16. 图标与品牌资产

当前品牌资产：

- `apps/desktop/resources/icon.png`：桌面应用图标，使用深色圆角底板和白色 v2 图标。
- `apps/desktop/resources/tray.png`：macOS 菜单栏模板图，只保留透明背景的 v2 图标。
- Web 不提供旧 OpenCreator logo 或历史兼容路径；Agent 消息不加载品牌图片。

使用规则：

- Web 暂不加载品牌 favicon。
- Agent 消息不展示头像或品牌图片。
- 品牌图不要拉伸，保持 `object-fit: contain`。
- 不再保留 `logo.png`、`logo-cor.png`、`logo-all.png` 等旧 OpenCreator 静态资源或兼容路径。
- 新增 icon 优先从 `lucide-react` 选取。

## 17. 新增页面检查清单

新增功能或页面前，先检查：

- 是否复用了 `tokens.css`，没有写新的主色。
- 是否仍然使用 `#AD4D1F` 作为主题高亮，而不是紫色。
- 是否有可见滚动条 track，如果有则移除。
- 是否有输入框 focus 高亮边框，如果有则改为无 outline 或容器级效果。
- 是否有页面切换闪白，如果有则保持底色或 overlay。
- 是否出现卡片套卡片，如果有则改为 full-width band 或简单分组。
- 是否所有按钮有 disabled、hover、active 状态。
- 是否 icon-only 按钮有 `aria-label`。
- 是否长标题、路径、文件名会省略号截断。
- 是否移动端 `920px`、`480px` 下不重叠、不溢出。

## 18. 命名建议

继续沿用当前语义化 class 命名：

- 页面级：`*-page`、`*-shell`、`*-layout`
- 区域级：`*-header`、`*-body`、`*-content`、`*-sidebar`
- 组件级：`*-button`、`*-row`、`*-card`、`*-popover`、`*-toast`
- 状态：使用 `data-*`、`aria-current`、`aria-pressed`、`aria-checked`，少用额外 JS class

新增组件优先让状态通过可访问属性表达，CSS 再基于这些属性设置视觉。
