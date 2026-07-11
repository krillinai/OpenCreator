# Clawee Skills Hub 插件市场设计

## 1. 状态

状态：设计已确认，等待用户审阅书面规格。

本文定义将 `Skills-Hub/02_projects/clawee-skills-hub/` 的现有产品页面原生整合到 Clawee“插件”Tab 的第一版方案。

## 2. 背景

Clawee 当前“插件”Tab 仍为占位页面，但项目已经具备以下基础能力：

1. daemon 可以扫描、读取、安装和删除全局 Codex Skills。
2. 前端 Composer 已支持 Slash 命令，并能生成 `$skill-id `。
3. Skills Hub 已有完整的插件市场产品页面，包括搜索、筛选、视觉卡片、收藏、安装状态和悬浮详情弹窗。

Skills Hub 当前的安装状态使用 `localStorage` 模拟，“去使用”通过 `clawee://chat?skill=<skill-id>` 占位跳转。正式整合需要保留现有产品设计，并将占位状态和协议替换为 Clawee 的真实安装、版本和对话能力。

## 3. 目标

第一版目标：

1. 用 Skills Hub 市场替换 Clawee“插件”Tab 的占位页面。
2. 保留现有搜索、分类、场景、排序、收藏、视觉卡片和悬浮详情弹窗。
3. 市场目录随 Clawee 版本内置，并且只包含经过审核的条目。
4. 只有包含标准 `SKILL.md` 的条目可以安装和使用。
5. 可安装 Skill 从市场清单指定的 GitHub commit 下载并安装到全局 Codex Skills 目录。
6. 以全局 Skills 目录扫描结果作为真实安装状态。
7. 使用 Clawee 市场安装记录判断已知版本是否需要更新。
8. 点击“使用”时创建新对话，并向输入框插入 `$skill-id `。
9. 安装、更新和对话创建失败时提供明确、可重试的错误状态。

## 4. 非目标

第一版不做：

1. 不使用 iframe 或独立 Skills Hub Web 服务。
2. 不在运行时从 GitHub 更新市场目录。
3. 不为缺少标准 `SKILL.md` 的工具自动生成适配 Skill。
4. 不允许前端提交任意 GitHub 地址、本地路径或 commit。
5. 不在市场卡片或详情弹窗中提供卸载入口。
6. 不做 Skill 排行榜、创作者激励、GitHub stars 或原仓库跳转。
7. 不自动发送插入输入框的 Skill 命令。
8. 不自动执行远端仓库中的安装脚本。
9. 不实现跨设备的收藏、安装记录或版本同步。

## 5. 已确认的产品规则

### 5.1 页面形态

1. “插件”Tab 正常展示完整 Skills Hub 市场。
2. 保留顶部搜索、收藏、已安装、主分类、细场景和排序。
3. 保留三列视觉 Skill 卡片。
4. 点击卡片继续打开悬浮详情弹窗，不改成独立详情页。
5. 关闭详情后保留原来的筛选条件和滚动位置。
6. 嵌入 Clawee 后移除独立网站外壳，只保留市场内容区域。

### 5.2 安装范围

1. Skill 默认安装到全局 Codex Skills 目录。
2. 安装一次后，可在所有项目中被 Codex 使用。
3. 点击“安装”后直接开始下载和安装，不显示二次确认弹窗。
4. 用户对“安装”的明确点击视为本次全局写入确认。

### 5.3 不可安装条目

1. 缺少标准 `SKILL.md` 的条目仍正常展示。
2. 此类条目的主按钮固定显示“暂不可安装”。
3. 按钮不可点击，不能进入使用流程。
4. 第一版不提供自动适配、安装教程或外部跳转作为替代操作。

### 5.4 使用行为

1. 只有已安装且不要求更新的 Skill 才显示“使用”。
2. 每次点击“使用”都在当前选中的项目下创建一个新对话。
3. 创建成功后切换到对话 Tab。
4. 新对话输入框自动插入：

```text
$skill-id
```

命令末尾保留一个空格，方便用户继续输入任务描述。

5. 输入框获得焦点，但不自动发送。
6. 用户可以继续补充任务描述后手动发送。

### 5.5 目录与版本更新

1. 市场目录随 Clawee 发版更新，不在应用启动时远程拉取。
2. 每个可安装条目记录单调递增的市场修订号和已审核 Git commit。
3. 安装时下载清单指定的 commit，不安装远端分支最新内容。
4. 全局目录中的同名 Skill 即使由其他方式安装，也显示为已安装。
5. 有 Clawee 市场安装记录时，比较本地市场修订号与内置市场修订号。
6. 本地市场修订号较低时显示“更新”。
7. 外部安装且没有版本记录时显示“已安装，版本未知”，允许使用，不直接判定为低版本。

## 6. 方案选择

### 6.1 方案 A：原生整合到 Clawee

将 Skills Hub 的页面组件、样式和审核目录迁入 Clawee 前端，安装、更新和使用接入 Clawee 真实能力。

优点：

1. 与 Clawee 项目、对话和 Composer 状态直接集成。
2. 安装状态可以实时反映 daemon 扫描结果。
3. 不需要跨页面消息协议。
4. 页面体验和应用导航保持一致。

缺点：

1. 需要将独立页面适配到 Clawee 现有组件、主题和状态管理。

### 6.2 方案 B：iframe 嵌入

保留独立 Skills Hub 页面，通过 iframe 和消息协议调用 Clawee。

优点：

1. 页面迁移工作较少。

缺点：

1. 路由、尺寸、主题、焦点、状态同步和错误处理复杂。
2. 安装和创建对话需要维护额外的跨页面信任边界。
3. 不适合作为 Clawee 的核心本机能力。

### 6.3 方案 C：抽取共享前端包

将 Skills Hub 抽成独立组件包，由 Clawee 和原项目共同使用。

优点：

1. 多个产品可以共享同一套组件。

缺点：

1. 首版工程量较大。
2. 当前只有 Clawee 一个明确的正式消费端。
3. 会提前引入发布、版本和跨项目兼容成本。

### 6.4 决策

采用方案 A：原生整合到 Clawee。

## 7. 总体架构

整体分为五个边界：

```text
审核后的市场目录
  ├── 前端渲染所需展示数据
  ├── 安装资格
  ├── GitHub 来源
  ├── 仓库内 Skill 相对路径
  ├── 市场修订号
  └── 已审核 commit

daemon 全局 Skill 扫描
  ├── 真实安装状态
  ├── Skill 有效性
  └── 全局 Skill 路径

daemon 市场安装器
  ├── 按市场条目 ID 解析可信来源
  ├── 下载固定 commit
  ├── 安全校验
  ├── 调用现有本地 Skill 安装能力
  ├── 原子安装或更新
  └── 记录市场安装修订号

web 插件市场
  ├── 搜索、筛选、排序和收藏
  ├── 卡片和详情弹窗
  ├── 安装、更新、使用状态
  └── 错误反馈和重试

对话启动桥接
  ├── 在当前项目创建新对话
  ├── 切换到对话 Tab
  └── 向 Composer 设置初始草稿
```

### 7.1 单一市场目录

市场目录必须只有一个源码来源，由 Clawee web 和 daemon 构建时共同消费。

前端使用目录中的展示字段渲染页面；daemon 使用同一目录中的安装字段解析来源。前端只向 daemon 传递市场条目 ID，daemon 不信任前端传入的仓库地址、路径、版本或 commit。

### 7.2 真相源

1. Skill 是否安装：以全局 Codex Skills 目录扫描为准。
2. Skill 是否有效：以现有 daemon Skill 校验结果为准。
3. Skill 市场修订号：以 Clawee 市场安装记录为准。
4. 市场最新修订号：以内置市场目录为准。
5. 收藏：以 Clawee 本地持久化状态为准。

SQLite 或本地设置不是 Skill 是否存在的真相源。用户手动删除、增加或修改全局 Skill 后，页面必须以重新扫描结果为准。

## 8. 市场数据模型

建议的目录模型：

```ts
type SkillMarketEntry = {
  id: string;
  title: string;
  description: string;
  category: string;
  subcategory: string;
  scenarios: string[];
  platforms: string[];
  author: {
    name: string;
    avatarUrl?: string;
  };
  cover: {
    type: "image" | "generated";
    url?: string;
  };
  examples: SkillMarketExample[];
  inputs: string[];
  outputs: string[];
  risks: SkillMarketRisks;
  usageCount?: number;
  install:
    | {
        available: false;
        reason: "missing_skill_manifest";
      }
    | {
        available: true;
        repository: string;
        skillPath: string;
        commit: string;
        marketRevision: number;
      };
};
```

市场安装记录：

```ts
type SkillMarketInstallRecord = {
  skillId: string;
  repository: string;
  skillPath: string;
  commit: string;
  marketRevision: number;
  installedAt: string;
  updatedAt: string;
};
```

`marketRevision` 是从 `1` 开始的正整数。每次审核后的 Skill 内容发生变化时递增，不使用自由格式版本字符串做大小比较。

该记录建议保存在 daemon 的 SQLite 数据库中，不写入 Skill 目录，避免改变第三方 Skill 内容。

## 9. 状态合并规则

前端加载页面时并行取得：

1. 内置市场目录。
2. daemon 全局 Skill 列表。
3. daemon 市场安装记录。
4. Clawee 本地收藏状态。

状态计算顺序：

1. `install.available === false`：`unavailable`。
2. 全局目录不存在同名 Skill：`not_installed`。
3. 全局目录存在但 Skill 无效：`invalid`。
4. 存在市场安装记录且记录修订号低于目录修订号：`update_available`。
5. 全局目录存在但没有市场安装记录：`installed_unknown_version`。
6. 其他情况：`installed`。

异步操作状态覆盖静态状态：

1. 安装中：`installing`。
2. 更新中：`updating`。
3. 操作失败：保留操作前状态，并附加错误信息和重试动作。

对应按钮：

| 状态 | 主按钮 |
|---|---|
| `unavailable` | 暂不可安装 |
| `not_installed` | 安装 |
| `installing` | 安装中 |
| `invalid` | Skill 无效 |
| `update_available` | 更新 |
| `updating` | 更新中 |
| `installed_unknown_version` | 使用 |
| `installed` | 使用 |

`installed_unknown_version` 需要在卡片或详情中补充“版本未知”提示。

## 10. 页面设计

### 10.1 插件 Tab

“插件”Tab 直接渲染市场内容，不增加营销落地页。

保留 Skills Hub 现有结构：

1. 搜索框。
2. “我的收藏”和“已安装”状态入口。
3. 推荐、使用人数、已安装和收藏排序。
4. 主任务分类。
5. 当前分类的细场景筛选。
6. 三列视觉 Skill 卡片。
7. 无结果空态。

独立站点的品牌 Header 不进入 Clawee，避免与应用导航重复。

### 10.2 Skill 卡片

卡片继续展示：

1. 封面。
2. 子分类和产出类型。
3. 主分类、平台和安装状态。
4. 中文任务标题。
5. 简介。
6. 作者。
7. 使用人数。
8. 收藏按钮。
9. 当前主操作按钮。

点击卡片主体打开详情弹窗；收藏和主操作按钮阻止卡片点击事件。

### 10.3 详情弹窗

保留现有悬浮弹窗，展示：

1. Skill 摘要、作者、分类、使用人数和安装状态。
2. 适合做什么。
3. 需要输入。
4. 会产出什么。
5. 精选案例。
6. 使用风险。
7. 底部主操作按钮。

弹窗支持遮罩关闭、关闭按钮和 Escape 关闭。打开时锁定背景滚动，关闭后恢复原来的列表位置。

### 10.4 收藏

收藏是本机 Clawee 偏好，不影响真实 Skill 安装状态。

收藏必须在刷新和应用重启后保留。第一版不要求账号同步。

## 11. 安装流程

点击“安装”后：

1. 前端将市场条目 ID 发送给 daemon。
2. daemon 从自身加载的内置目录解析 repository、skillPath、commit 和 marketRevision。
3. daemon 将指定 commit 下载到临时目录。
4. daemon 将 `skillPath` 解析到下载根目录内。
5. daemon 校验目标目录和 `SKILL.md`。
6. daemon 校验 Skill ID 与目标全局目录名。
7. daemon 调用现有本地 Skill 安装能力写入全局 Codex Skills 目录。
8. daemon 写入市场安装记录和操作日志。
9. 前端重新扫描 Skills，确认文件系统真实状态。
10. 成功后按钮切换为“使用”。

前端点击安装时不再弹确认框。调用现有全局 Skills 写 API 时，由可信的市场安装器传入全局写确认字段。

安装成功以前，前端不能仅依靠乐观状态显示“使用”。

## 12. 更新流程

当市场安装记录修订号低于内置目录修订号时显示“更新”。

点击“更新”后：

1. 下载目录指定的新 commit。
2. 完成与安装相同的路径和 `SKILL.md` 校验。
3. 使用现有 Skill 覆盖能力备份当前版本。
4. 原子替换全局 Skill 目录。
5. 更新市场安装记录。
6. 重新扫描并切换为“使用”。

更新失败时：

1. 保留原 Skill 目录。
2. 保留原市场安装记录。
3. 页面回到“更新”状态。
4. 展示失败原因和重试入口。

## 13. 使用流程

点击“使用”后：

1. 调用 Clawee 现有新建对话能力，在当前选中的项目下创建新对话。
2. 等待新对话创建成功。
3. 将应用切换到对话 Tab，并选中新对话。
4. 通过显式的 Composer 草稿接口设置：

```text
$skill-id
```

命令末尾保留一个空格。

5. Composer 获得焦点。
6. 用户补充任务后手动发送。

不能通过 DOM 查询或模拟键盘事件插入文本。Composer 需要提供稳定的初始草稿或外部草稿写入接口。

如果新对话创建失败：

1. 保持在插件市场。
2. 不清空当前筛选、弹窗或滚动位置。
3. 显示错误和重试入口。

## 14. daemon 能力扩展

现有 Skill API 只接受本地 `sourcePath`。市场能力应作为现有安装器之上的可信下载层，而不是在原安装 API 中开放任意远程 URL。

建议新增市场用例：

```text
installMarketSkill(skillId)
updateMarketSkill(skillId)
listMarketInstallRecords()
```

建议新增 API：

```text
POST /codex/skill-market/:id/install
POST /codex/skill-market/:id/update
GET  /codex/skill-market/install-records
```

`install` 和 `update` 请求只包含路由中的市场条目 ID。来源解析、下载、校验和全局写确认全部由 daemon 完成。

## 15. 安全设计

### 15.1 来源限制

1. 只允许安装内置市场目录中的可安装条目。
2. 只下载清单指定的 GitHub repository 和 commit。
3. 前端不能覆盖 repository、skillPath、commit 或市场修订号。

### 15.2 文件安全

1. 下载和解压在 Clawee 管理的临时目录中完成。
2. `skillPath` 规范化后必须仍位于下载根目录内。
3. 拒绝路径穿越。
4. 拒绝目标目录中逃逸下载根目录的符号链接。
5. 校验 `SKILL.md` 可读且 frontmatter 合法。
6. 安装目录名必须与市场 `skillId` 一致。
7. 安装和更新使用写锁，避免并发覆盖。

### 15.3 执行边界

1. 安装只复制 Skill 目录及其静态资源。
2. 不执行远端仓库的 shell、Node、Python 或其他安装脚本。
3. 不自动安装仓库声明的系统依赖。
4. Skill 运行时仍遵循 Codex 当前 sandbox 和审批策略。

## 16. 错误处理

需要覆盖：

1. 网络不可用或 GitHub 下载失败。
2. 仓库或 commit 不存在。
3. `skillPath` 不存在。
4. `SKILL.md` 缺失或不合法。
5. Skill ID 不匹配。
6. 临时目录创建失败。
7. 全局 Skills 目录无写权限。
8. 磁盘空间不足。
9. 安装锁冲突。
10. 备份、替换或数据库记录失败。
11. 新对话创建失败。
12. Composer 草稿写入失败。

错误提示必须说明当前动作未完成，并提供可执行的重试入口。更新失败时必须明确旧版本仍然保留。

## 17. 测试设计

### 17.1 市场目录测试

1. 所有条目 ID 唯一。
2. 可安装条目必须包含 repository、skillPath、commit 和 marketRevision。
3. 不可安装条目必须有明确原因。
4. 分类、场景和排序字段合法。
5. 目录中不存在前端可提交的任意安装来源。

### 17.2 daemon 单元测试

1. 按市场 ID 正确解析固定来源。
2. 未知或不可安装 ID 被拒绝。
3. 路径穿越和符号链接逃逸被拒绝。
4. 缺少或非法 `SKILL.md` 被拒绝。
5. Skill ID 不匹配被拒绝。
6. 安装成功后写入市场安装记录。
7. 更新成功后替换版本并更新记录。
8. 更新失败时恢复旧版本和旧记录。
9. 并发安装由写锁串行化。

### 17.3 前端组件测试

1. 搜索、状态、分类、场景和排序正确过滤。
2. 收藏持久化。
3. 卡片和详情弹窗展示一致状态。
4. 不可安装、安装、安装中、更新、更新中和使用按钮正确。
5. 操作失败后显示错误与重试。
6. 打开和关闭详情不丢失列表状态。

### 17.4 集成测试

1. 安装后全局目录出现 Skill，刷新后仍显示已安装。
2. 手动放入全局目录的同名 Skill 被识别。
3. 外部安装且无记录时显示版本未知。
4. 低市场修订号显示更新。
5. 更新失败不破坏旧版本。
6. 点击使用创建新对话并插入 `$skill-id `。
7. 插入后不自动发送，Composer 获得焦点。
8. 创建对话失败时保留市场页面状态。

### 17.5 回归测试

1. 现有 Slash 命令仍能生成相同的 `$skill-id ` 格式。
2. 项目选择和刷新恢复行为不回归。
3. 对话恢复不回归。
4. 文件链接和预览不回归。
5. 现有本地 Skill 列表、详情、安装、删除和操作日志 API 不回归。

## 18. 验收标准

满足以下条件后可认为第一版完成：

1. “插件”Tab 显示 Skills Hub 正式市场，而不是占位页面。
2. 页面视觉和信息架构与现有 Clawee Skills Hub 保持一致。
3. 约 55 个目录条目可以正常浏览、搜索和筛选。
4. 缺少标准 `SKILL.md` 的条目不可安装。
5. 可安装条目能从固定 commit 下载并全局安装。
6. 安装状态来自全局目录真实扫描。
7. 市场安装修订号较低时可以更新。
8. 外部安装能识别，未知版本不会被误判为低版本。
9. 点击使用每次创建新对话并插入正确命令。
10. 所有失败路径有明确反馈，且更新失败不破坏旧版本。
11. 没有引入任意远程 URL 安装或自动执行远端脚本的能力。
