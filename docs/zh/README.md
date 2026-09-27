<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../images/OpenCreator_logo_vector_dark.svg" />
    <img src="../images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  面向创作者的开源 AI 工作台与 Skills
</h1>

<p>将可视化创作工具、可复用 Skills 与 Agent 融合在一个工作空间内，完成脚本、视频、图像、语音、数字人、翻译与剪辑。</p>

<p><strong>OpenCreator 原名 KrillinAI。</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator（原 KrillinAI）：Trendshift 单日排名第一仓库" width="250" height="55" /></a>

[English](../../README.md) | **简体中文** | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [Bahasa Indonesia](../id/README.md) | [Español](../es/README.md) | [Français](../fr/README.md) | [Deutsch](../de/README.md) | [Português](../pt/README.md) | [Русский](../ru/README.md) | [العربية](../ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![QQ 群](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[项目特色](#项目特色) · [创作工具](#创作工具) · [创作模板](#创作模板) · [Skills 技能](#skills-技能) · [对话与工作区](#对话与工作区协同推进) · [支持的模型](#支持的模型) · [案例展示](#案例展示) · [快速开始](#快速开始) · [Desktop](#desktop) · [OpenCreator 系统架构](#opencreator-系统架构) · [开发指南](#开发指南) · [文档](#文档) · [参与贡献](#参与贡献) · [贡献者](#贡献者) · [Star 趋势](#star-趋势)

</div>

![OpenCreator Agent 工作台](../images/opencreator-home-en.png)

## 项目介绍

OpenCreator 面向需要在本机持续完成创作与开发任务的个人和团队。它不重新实现一套 Agent loop，而是以 Codex CLI 作为执行内核，在其上提供稳定的本地 Runtime、可视化工作台和 Desktop 宿主。

OpenCreator 提供两种相互衔接的操作方式：

- **内容工作台**：通过可视化工具和创作模板，完成视频翻译与下载、图像与视频生成、智能配音、文章与社媒帖子写作、短视频脚本和火柴人动画等任务。
- **Agent 对话**：用自然语言发起和推进创作或开发任务，按项目组织会话，让 Run 在后台持续执行，并统一处理审批、附件、文件、技能、MCP、计划任务、通知、记忆和诊断。

Web 是唯一的前端实现；Desktop 直接加载同一份 Web 构建产物，只额外提供目录选择、窗口生命周期、托盘和原生通知等系统能力。因此在相同数据和内容视口下，两端拥有一致的通用界面与 Runtime 行为。

## 项目特色

- 🤖 **Codex 原生执行**：直接复用 Codex 的 Agent loop、模型、推理、工具调用、会话、Skills 和 MCP，不维护第二套执行引擎。

- 🚀 **桌面端开箱即用**：通过桌面应用直接启动 OpenCreator，默认内置 Codex CLI；本地 Runtime 按需拉起并自动准备默认项目。

- 🔄 **运行组件管理**：查看 yt-dlp 的内置版本、当前版本与最新版本，定期检查并由用户手动更新；更新失败时继续保留当前可用版本。

- 🎨 **多模态创作**：在同一套流程中创作和管理视频、图像、音频、字幕与文档。

- 🧩 **创作模板**：使用可复用模板直接创作图像和视频，无需从零编写提示词或配置参数。

- 🔗 **双模协同**：既可操作可视化工作台，也可通过 Agent 对话创作，同一状态机让步骤、进度和结果始终同步。

- 🕘 **版本管理**：每次修正创建新版本，保留历史配置与产出，方便回看和比较。

- 🧩 **可复用 Skills**：使用项目包含的视频工作流技能，以自己的 Skills 扩展 Agent 能力，并通过 Codex 原生配置管理 MCP。

- 🧠 **记忆摘要**：管理全局、项目和线程记忆，为每次 Run 保存摘要与输入快照。

- 🔐 **本地安全**：数据、附件和日志默认留在本机，支持权限审批和诊断脱敏。

- 🌐 **多语言界面**：Web 与 Desktop 客户端支持简体中文、英文和瑞典语，可自动跟随系统语言或手动选择。

## 创作工具

当前版本提供十项创作工具。实际可用的模型与服务由本地 Codex 环境和 AI 服务设置共同决定。

从工作台进入文章写作、小红书帖子、短视频脚本和火柴人动画，也可进行视频翻译与下载、封面与图像生成、智能配音或 Seedance 视频生成。

![OpenCreator 创作工作台](../images/product/opencreator-dashboard-en.png)

> 更多创作工具持续增加中。

<table width="100%">
<thead>
<tr>
<th width="18%">工作区</th>
<th width="14%">状态</th>
<th width="68%">具体能力</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">视频翻译</td><td valign="top">✅ 已开放</td><td>导入本地或公开视频；通过云端或本地 Whisper 服务转写；利用 LLM 上下文完成字幕断句、对齐、术语处理和翻译；设置双语字幕、配音或自定义声音样本、字幕样式及横竖屏合成，并导出 SRT、音频或成片</td></tr>
<tr><td valign="top">视频下载</td><td valign="top">✅ 已开放</td><td>解析 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书和 Pinterest 的单个公开视频，比较可用格式并下载视频或音频；部分平台可能需要 Cookie</td></tr>
<tr><td valign="top">封面生成</td><td valign="top">✅ 已开放</td><td>结合主题、视频链接和可选参考图片生成多版内容封面，并进行对比选择</td></tr>
<tr><td valign="top">图像生成</td><td valign="top">✅ 已开放</td><td>使用 GPT Image，根据提示词和可选参考图片生成图像，设置画幅与生成数量，并预览和单独下载图片</td></tr>
<tr><td valign="top">文章写作</td><td valign="top">✅ 已开放</td><td>根据主题、链接、视频或参考文档生成可编辑的候选选题、大纲和完整文章，支持添加生成配图，并导出 Markdown、HTML 或 PDF</td></tr>
<tr><td valign="top">小红书帖子</td><td valign="top">✅ 已开放</td><td>根据主题或素材生成完整的小红书帖子，可设置目标读者、内容类型和篇幅，并复制或下载结果</td></tr>
<tr><td valign="top">短视频脚本</td><td valign="top">✅ 已开放</td><td>根据主题或素材生成可直接拍摄的分段脚本，并按目标受众、发布平台、时长和语气调整，支持编辑、复制或下载</td></tr>
<tr><td valign="top">火柴人动画</td><td valign="top">✅ 已开放</td><td>将文本或 YouTube 内容转化为旁白、配音、角色一致的分镜画面、字幕及可下载的火柴人动画</td></tr>
<tr><td valign="top">自动剪辑</td><td valign="top">开发中</td><td>分析长视频内容、识别高光片段，并将选定内容制作成可复用的短视频</td></tr>
<tr><td valign="top">智能配音</td><td valign="top">✅ 已开放</td><td>将脚本生成为配音，并调整音色、节奏与情绪表达</td></tr>
<tr><td valign="top">视频生成</td><td valign="top">✅ 已开放</td><td>使用 Seedance 根据提示词和参考图片生成视频，并预览、重新生成或下载各个版本</td></tr>
<tr><td valign="top">数字人口播</td><td valign="top">开发中</td><td>组合文案、声音和数字人形象，制作口播视频</td></tr>
</tbody>
</table>

## 创作模板

无需从零编写提示词或设置参数：按分类浏览精选创作模板，探索视频创作和图像设计等方向，找到适合自己创意的起点。

创作模板库汇集 OpenCreator 原创及第三方创作者的模板。涉及第三方作品时，模板详情会注明作者并提供原始来源链接，方便了解创意出处。

![按视频创作和图像设计等分类展示的精选创作模板](../images/product/creation-templates-gallery-en.png)

打开模板可以预览案例效果，查看提示词、模板设置、标签、作者与原始来源。点击 **使用这个模板** 即可基于模板直接创作，并按需调整输入内容。

![图像创作模板详情，包括案例效果、模板设置和提示词](../images/product/creation-templates-detail-en.png)

## Skills 技能

创作工具提供可视化操作，Skills 则为 Agent 提供可复用的执行指引与工具工作流。OpenCreator 不仅支持管理本地 Codex Skills，还包含仓库中的视频制作技能，让工作流可以复用和扩展。

仓库的 [`skills/`](../../skills/) 目录提供了一组供 Agent 操作内嵌 KrillinAI CLI 的可复用指引。

| Skill | 具体能力 |
| --- | --- |
| [KrillinAI CLI](../../skills/krillinai-cli/SKILL.md) | 选择命令、检查配置，并解析进度、产物清单、输出与错误 |
| [字幕生成](../../skills/krillinai-subtitle/SKILL.md) | 获取平台字幕或转写音视频，翻译并生成双语字幕、竖屏短字幕 |
| [字幕配音](../../skills/krillinai-tts/SKILL.md) | 根据字幕生成目标语言配音，并可进一步生成配音视频 |
| [横屏合成](../../skills/krillinai-render-horizontal/SKILL.md) | 合成双语字幕横屏视频，或带目标语言字幕的配音视频 |
| [竖屏合成](../../skills/krillinai-render-vertical/SKILL.md) | 生成包含标题、双语字幕或配音的竖屏视频 |
| [封面生成](../../skills/krillinai-cover/SKILL.md) | 根据完整文字提示词生成封面，并保存图片与最终提示词 |
| [流程规划](../../skills/krillinai-pipeline/SKILL.md) | 以 dry-run 校验多阶段产出计划；实际任务由各阶段 Skill 分别执行 |

### 扩展自己的 Skills

OpenCreator 支持以 `SKILL.md` 定义的本地 Codex Skills，可接入自己的方法与工作流，不必局限于固定创作工具。实际可用技能取决于当前 Codex home 与已安装 Skills；视频工作流技能需要配置 CLI 和相关服务。仓库包含某个 Skill，不代表它已自动安装，也不代表相关外部服务已随应用提供。

## 对话与工作区，协同推进

用自然语言描述任务，需要精细控制时，随时进入可视化工具。

![OpenCreator 对话与可视化工作区协同界面](../images/examples/opencreator-auto-clips-en.png)

### 精细的工作区控制

精准调整字幕、镜头、音频和生成设置。

### 灵活的对话式修改

直接告诉 Agent 要修改什么，用自然语言持续完善结果。

### 状态同步

对话与工作区共享当前任务状态，无需重复说明。

### 独立版本

每次修订都会创建独立版本，不覆盖之前的结果或设置。

## 支持的模型

语言模型由 Codex 模型目录或你配置的 OpenAI 兼容服务提供；图像、视频、语音和转写模型使用 **设置 → AI 服务** 中配置的服务。

以下服务商与模型仅为示例；实际可用性取决于密钥配置、服务商账号权限及运行平台。

### 语言模型

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT</strong></td>
<td align="center" width="20%"><img src="../images/models/deepseek.png" alt="DeepSeek" width="40" height="40" /><br /><strong>DeepSeek</strong></td>
<td align="center" width="20%"><img src="https://github.com/QwenLM.png?size=80" alt="Qwen" width="40" height="40" /><br /><strong>Qwen</strong></td>
<td align="center" width="20%"><img src="https://github.com/MoonshotAI.png?size=80" alt="Kimi" width="40" height="40" /><br /><strong>Kimi</strong></td>
<td align="center" width="20%"><img src="https://github.com/zai-org.png?size=80" alt="Z.ai" width="40" height="40" /><br /><strong>GLM</strong></td>
</tr>
<tr>
<td align="center" width="20%"><img src="https://github.com/xai-org.png?size=80" alt="xAI" width="40" height="40" /><br /><strong>Grok</strong></td>
<td align="center" width="20%"><img src="../images/models/doubao.svg" alt="Doubao" width="40" height="40" /><br /><strong>Doubao</strong></td>
<td align="center" width="20%"><img src="../images/models/ernie.png" alt="ERNIE" width="40" height="40" /><br /><strong>ERNIE</strong></td>
<td align="center" width="20%"><img src="https://github.com/Tencent-Hunyuan.png?size=80" alt="Tencent Hunyuan" width="40" height="40" /><br /><strong>Hunyuan</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
</tr>
</table>

### 图像

<table>
<tr>
<td align="center" width="25%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="../images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

### 视频

<table>
<tr>
<td align="center" width="33%"><img src="../images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="../images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="../images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
</tr>
</table>

### 语音与转写

<table>
<tr>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="../images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

本地语音转写还支持 faster-whisper、WhisperKit 和 whisper.cpp，具体可用性取决于运行平台。

## 案例展示

### 视频翻译

下面的公开案例制作于 OpenCreator 仍使用 KrillinAI 名称的阶段，展示了成熟的字幕对齐、翻译、配音与竖屏交付流程。OpenCreator 的视频翻译工作区已把这套能力接入更完整的 Agent 创作流程。

项目曾对一段 46 分钟的本地视频进行一键处理，全程没有人工调整字幕。其公开结果完整覆盖原视频，没有字幕遗漏或重叠，断句自然，译文质量稳定。

![OpenCreator 字幕对齐案例](../images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### 字幕翻译

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### 智能配音

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### 竖屏模式

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> 这些视频与字幕对齐图片制作于 OpenCreator 仍使用 KrillinAI 名称的阶段。

### 视频生成

使用 Seedance 根据文本提示词或参考图片生成 AI 视频。设置模型、画面比例、分辨率和时长，然后在项目工作区预览、重新生成或下载各个版本。

![OpenCreator Seedance 视频生成](../images/examples/video-generation-seedance-en.png)

### 视频下载

解析公开视频链接，比较可用格式，并将视频或音频直接下载到项目中。

支持的视频来源：

<table align="center">
  <tr>
    <td align="center" width="96"><img src="../images/platforms/youtube.png" alt="YouTube" width="32" height="32" /><br /><strong>YouTube</strong></td>
    <td align="center" width="96"><img src="../images/platforms/bilibili.png" alt="Bilibili" width="32" height="32" /><br /><strong>Bilibili</strong></td>
    <td align="center" width="96"><img src="../images/platforms/x.png" alt="X" width="32" height="32" /><br /><strong>X</strong></td>
    <td align="center" width="96"><img src="../images/platforms/tiktok.png" alt="TikTok" width="32" height="32" /><br /><strong>TikTok</strong></td>
    <td align="center" width="96"><img src="../images/platforms/instagram.png" alt="Instagram" width="32" height="32" /><br /><strong>Instagram</strong></td>
    <td align="center" width="96"><img src="../images/platforms/douyin.png" alt="抖音" width="32" height="32" /><br /><strong>抖音</strong></td>
    <td align="center" width="96"><img src="../images/platforms/facebook.png" alt="Facebook" width="32" height="32" /><br /><strong>Facebook</strong></td>
    <td align="center" width="96"><img src="../images/platforms/xiaohongshu.png" alt="小红书" width="32" height="32" /><br /><strong>小红书</strong></td>
    <td align="center" width="96"><img src="../images/platforms/pinterest.png" alt="Pinterest" width="32" height="32" /><br /><strong>Pinterest</strong></td>
  </tr>
</table>

实际可用性取决于视频和地区；部分来源可能需要平台 Cookie。

**小红书视频笔记：**粘贴完整的公开 `https://www.xiaohongshu.com/explore/<24 位十六进制笔记 ID>` 链接；若带有 `xsec_token` 等查询参数，请一并保留。纯图片笔记没有可下载的视频格式；个人主页和 `xhslink.com` 分享短链暂不支持。识别链接不代表一定能下载：令牌过期、访问限制或平台变更都可能导致失败。OpenCreator 不会自动读取浏览器 Cookie。

**Pinterest 视频 Pin：**粘贴公开的 `https://www.pinterest.com/pin/<数字 ID>/` 链接。纯图片 Pin 没有可下载的视频格式；画板和个人主页暂不支持。

![OpenCreator 视频下载格式选择](../images/examples/video-downloader-formats-en.png)

### 火柴人动画

OpenCreator 与艺术家 [Harbor Hsia](https://www.behance.net/xiaheyuan1) 合作设计了这套原创火柴人角色形象，其作品可见 Behance 上的 [Stickman](https://www.behance.net/gallery/254715463/Stickman)。内置角色可在整个动画工作流中保持形象一致。

![OpenCreator 与艺术家合作设计的火柴人角色](../images/examples/stick-figure-characters.webp)

输入文本或YouTube内容源以后，可在引导式工作流中完成脚本审核、旁白配音、节奏调整、分镜画面、字幕、渲染及成片下载。

![OpenCreator 火柴人动画画面案例](../images/examples/stick-figure-animation-frame.jpg)

## 快速开始

### 环境要求

- Node.js 22 或更高版本
- pnpm 9.15.0（仓库已在 `packageManager` 中锁定版本）
- 可在终端执行的 Codex CLI
- 真实模型任务需要 Codex CLI 处于有效登录状态

先确认本地环境：

```bash
node --version
pnpm --version
codex --version
```

### 从源码启动 Web

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

打开 `http://127.0.0.1:19861/`。开发服务器会按需启动本地 daemon，并通过同源代理注入临时 Runtime token，不需要手工复制连接信息。

首次启动时，Runtime 会准备默认项目，并检查本机 Codex 配置。已有可用登录态或 API Key 时，确认使用本机 Codex 即可；否则在引导页选择供应商并填写模型、Base URL（使用 OpenAI 默认地址时可留空）和 API Key。配置完成后即可使用输入框。如果只需要调试 daemon：

```bash
pnpm daemon:dev
```

daemon 只监听本机回环地址，并在 stdout 输出一次连接地址和临时 token。

## Desktop

Desktop 与浏览器版使用 `apps/web` 的同一套 React 前端。通用项目、会话、任务和设置都调用相同的 Daemon/API；Electron 只补充真实系统路径、窗口、托盘和原生通知等能力。

### 开发模式

```bash
pnpm desktop:dev
```

### 本地打包

| 命令 | 产物 |
| --- | --- |
| `pnpm desktop:package` | 当前平台的可运行目录，适合本机验证 |
| `pnpm desktop:dist` | 当前平台的安装包 |
| `pnpm desktop:release` | 运行正式发布打包入口 |
| `pnpm --filter @opencreator/desktop verify:package` | 校验已生成的 Desktop 包 |

Desktop 打包会重新构建当前工作区的 Web，记录 commit、dirty 状态、平台、架构和 Web 哈希，并比较 `apps/web/dist` 与 App 内嵌资源；内容不一致时会直接失败。签名、公证、Windows 构建和正式发布要求见 [Desktop 发布手册](../operations/opencreator-desktop-release-runbook.md)。

## 核心工作流

### 会话与 Run

1. 选择项目或创建新对话。
2. 输入任务，并选择权限、Profile、模型和推理强度。
3. Run 执行期间可以排队发送后续任务，或立即打断当前任务后继续。
4. 在 Timeline 查看推理摘要、工具调用、文件变更、审批和最终结果。
5. 从任务中心统一追踪运行中、已完成、失败和待审批任务。

### 技能与 MCP

- 在插件中心浏览技能市场、安装记录和本机已有技能。
- 在输入框中通过 `/` 或添加菜单选择技能，让后续任务按对应工作流执行。
- MCP 管理优先透传 Codex 原生命令与配置，不维护第二套执行引擎。
- 默认使用当前 `$CODEX_HOME`，因此修改全局技能或 MCP 前应确认影响范围。

### 已安排与任务会话

- 每条计划任务拥有一个长期专属 OpenCreator 会话。
- 自动触发、立即运行和用户追问复用同一会话，并按 `queue` 或 `skip` 策略串行处理。
- 删除计划任务会归档专属会话，但保留既有 Run、结果和底层 Codex 历史。
- 底层 Codex thread 轮换或失效恢复不会改变 OpenCreator 的任务入口与页面路由。

## OpenCreator 系统架构

OpenCreator 将可视化工作台与 Agent 对话视为同一创作任务的两种交互界面，而不是两套彼此独立的流程。每个创作工作流都通过状态机建模：素材输入、参数设置、生成、审核、修改和导出被定义为明确的状态与事件。工作台操作和对话指令进入同一个状态机，当前步骤、配置、进度、版本与结果再同步呈现在两侧，从架构上避免出现两份相互冲突的任务状态。

创作天然需要反复调整，因此修改不会直接覆盖当前结果。每次修正或重新生成都会基于现有工作流状态创建新版本，同时保留历史版本的配置与产出，让创作者可以随时回看、比较，并从任一阶段继续完善。

```text
+-----------------------------+     +------------------------------------+
| 浏览器访问                  |     | 桌面宿主                           |
|                             |     | 共用 Web 构建 + Electron           |
+--------------+--------------+     +------------------+-----------------+
               |                                       |
               +-------------------+-------------------+
                                   v
+----------------------------------------------------------------------------+
| 创作体验 / apps/web                                                        |
| 工作台 / 创作工具 / Agent 对话 / 设置 / 文件                              |
+-------------------------------------+--------------------------------------+
                                      |
+-------------------------------------v--------------------------------------+
| 协作核心                                                                   |
| 共享工作流状态 / 步骤 / 进度 / 结果 / 版本                                |
+-------------------------------------+--------------------------------------+
                                      | Runtime API + SSE
+-------------------------------------v--------------------------------------+
| 本地 Runtime / apps/daemon                                                 |
| 项目 / Run / 审批 / 计划任务 / 记忆 / 通知                                |
| 组件状态 / 更新检查 / 更新验证 / 安全回退                                 |
+-------------+------------------------+------------------------+-------------+
              |                        |                        |
              v                        v                        v
+---------------------+  +---------------------+  +-------------------------+
| 本地数据            |  | Codex 引擎          |  | 媒体工具链              |
| SQLite / 文件       |  | CLI / app-server    |  | FFmpeg / yt-dlp         |
| 系统凭据            |  | Skills / MCP        |  | Whisper / AI 服务       |
+---------------------+  +---------------------+  +-------------------------+
```

| OpenCreator 组件 | 职责 | 实现方式 |
| --- | --- | --- |
| 创作体验 | 提供工作台、创作工具、Agent 对话、设置和文件界面 | `apps/web` · React 18 · Vite · TypeScript |
| 协作核心 | 同步工作区步骤、对话上下文、进度、结果和修订版本 | 共享工作流状态 · `CreatorCollaborationPanel` · 版本历史 |
| 本地 Runtime | 管理项目、Run、审批、计划任务、记忆和通知 | `apps/daemon` · Fastify · Runtime API · SSE |
| 运行组件 | 跟踪内置、当前和最新版本，定期检查并仅安装用户主动发起的更新 | yt-dlp nightly · 更新验证 · 当前可用版本回退 |
| Codex 引擎 | 提供 Agent loop、会话、推理、工具、Skills 和 MCP | Codex CLI · app-server |
| 媒体工具链 | 完成下载、转写、处理、生成和导出 | yt-dlp · Whisper · FFmpeg · 已配置的 AI 服务 |
| 本地数据 | 在本机保存项目数据、Run、附件、产物和凭据 | SQLite · 文件系统 · 系统凭据存储 |
| 桌面宿主 | 加载共用 Web 构建并补充操作系统能力 | `apps/desktop` · Electron · Preload Bridge |

核心原则：

- 工作台与 Agent 对话是同一份工作流状态的同步投影；两侧都向同一个状态机发送事件，不各自维护一套任务状态。
- 每次修正都会创建新版本而不是替换现有结果，完整保留每一轮创作的上下文与产出。
- 前端不直接启动 Codex，也不依赖 Codex 原始 JSONL 事件格式。
- daemon 负责进程生命周期、事件标准化、持久化、审批、计划任务和通知 outbox。
- Codex 仍然是 Agent loop、技能和 MCP 的执行真相源。
- Browser Bridge 与 Desktop Bridge 不分别实现通用业务逻辑。

## 项目结构

```text
OpenCreator/
├── apps/
│   ├── web/          # 唯一的 React 前端实现
│   ├── daemon/       # 本地 Fastify Runtime 与 Codex 适配层
│   ├── desktop/      # Electron Main、Preload、原生能力与打包
│   └── harness/      # Runtime 命令行验证工具
├── packages/
│   ├── protocol/     # Web、Daemon、Desktop 共用的 Runtime 契约
│   └── skill-market/ # 技能市场模型与共享逻辑
├── docs/             # 设计、API、运行手册和验收文档
├── scripts/          # 仓库级检查脚本
└── .runtime/         # 本地运行数据（首次启动后生成）
```

## 配置

### AI 服务 API Key

打开 **设置 → AI Services**，配置当前工作区所需的模型、语音识别、配音和图像服务。其他服务分类可能会为后续创作工具提前保留。每个分类只显示当前服务商需要的字段，包括 Base URL、API Key、模型、代理或服务商专属凭据。

![OpenCreator AI Services API Key 设置](../images/product/opencreator-ai-services-en.png)

凭据通过本地 Runtime 的系统凭据存储进行保存，不应提交到仓库。Edge TTS 等本地或系统服务不需要填写 API Key。

### 第三方运行组件

打开 **设置 → 第三方组件**，可以查看当前使用的 yt-dlp nightly 版本、OpenCreator 内置版本、当前来源和最新可用版本。OpenCreator 每 7 天检查一次更新，但不会自动安装；只有用户主动确认才会更新。如果下载、验证或安装失败，系统会继续使用当前可用版本。

![OpenCreator 第三方运行组件设置](../images/product/opencreator-third-party-components-en.png)

### Runtime 环境变量

大部分用户不需要设置环境变量。需要隔离数据、指定 Codex 或调整托管目录时，可以使用：

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator 数据库、Run、附件和托管工作区目录 |
| `OPENCREATOR_CODEX_BIN` | `codex` | Codex CLI 可执行文件路径 |
| `CODEX_HOME` | `~/.codex` | Codex 会话、配置、技能、MCP 和 Profile 的真相源 |
| `OPENCREATOR_DEFAULT_CWD` | 当前工作目录 | daemon 的默认执行目录 |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime 默认策略 | 托管项目根目录；设置后使用其下的 `OpenCreator/` |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | 长期计划任务底层 Codex thread 的终态 Run 轮换阈值，设为 `0` 可关闭主动轮换 |

例如，将 Runtime 数据与 Codex 环境都隔离到指定目录：

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## 数据与安全

默认 Runtime 数据位于仓库根目录的 `.runtime/`：

| 路径 | 内容 |
| --- | --- |
| `.runtime/app.sqlite` | 项目、线程、Run、事件、计划任务、通知、附件元数据、审批、记忆和摘要 |
| `.runtime/runs/` | 每次 Run 的脱敏日志、诊断与元数据 |
| `.runtime/attachments/` | 受控保存的附件文件 |
| `.runtime/workspaces/` | Runtime 托管的项目工作区 |

Codex 自身的会话与配置仍位于 `$CODEX_HOME`，备份时需要与 `.runtime/` 分开处理。

安全边界包括：

- daemon 仅监听 `127.0.0.1`，除健康检查外的 API 都要求 Bearer token。
- HTML 预览默认禁用脚本、导航和弹窗，只允许受控的同工作区相对资源。
- 敏感记忆必须二次确认，OpenCreator 不会自动永久保存未确认内容。
- Diagnostics 和 Run 日志在返回或导出前进行脱敏。
- Desktop 包启用 ASAR 完整性、Cookie 加密，并关闭 RunAsNode、`NODE_OPTIONS` 和 Node CLI Inspector。

完整备份、恢复、清理和重置步骤见 [用户指南与故障排查](../opencreator-user-guide-and-troubleshooting.md)。

## 开发指南

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm web:dev` | 启动 Web，并按需启动本地 daemon |
| `pnpm daemon:dev` | 只启动 daemon |
| `pnpm desktop:dev` | 构建依赖并启动 Electron 开发模式 |
| `pnpm test` | 运行工作区单元与集成测试 |
| `pnpm typecheck` | 运行全仓 TypeScript 类型检查 |
| `pnpm build` | 构建全部 workspace |
| `pnpm e2e` | 运行 Web Playwright E2E |
| `pnpm smoke:ci` | 运行 fake Codex Runtime smoke |
| `pnpm perf:check` | 检查已记录的性能基线 |

提交前至少运行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

涉及 Desktop、Host Bridge、Runtime 代理或通用前端流程时，还必须完成 Web/Desktop 一致性测试、实际打包 App E2E，以及 Web 构建产物哈希校验；只通过 Web 单测不能证明 Desktop 可发布。

真实 Codex smoke 默认不会运行，显式启用方式：

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## 文档

- [用户指南与故障排查](../opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](../runtime-api-for-ui-v1.md)
- [Codex-native Runtime 技术方案](../2026-07-03-codex-native-agent-runtime-design.md)
- [Desktop 发布手册](../operations/opencreator-desktop-release-runbook.md)
- [Windows Desktop 发布说明](../operations/opencreator-desktop-windows-release.md)
- [视觉组件规范](../visual-component-guidelines.md)

## 翻译约定

根目录 `README.md` 是内容基准英文版，持续维护的翻译统一放在 `docs/<locale>/README.md`。只有完成全文翻译并与英文结构同步后，才把对应语言加入顶部切换栏。

## 参与贡献

欢迎以多种方式参与 OpenCreator，不限于代码：

| 类型 | 可以贡献什么 | 如何准备 | 在哪里提交 |
| --- | --- | --- | --- |
| 代码 | 修复问题、改进创作流程或通用能力 | 明确改动范围，附演示或复现方式与相关测试 | [Issue][contribute-issue] 讨论 → [PR][contribute-pr]；`apps/web/` 或 `apps/daemon/` |
| Skill | 可复用的 Agent 工作流 | 提供 `SKILL.md`、依赖条件和使用示例 | [Issue][contribute-issue] 讨论 → [PR][contribute-pr]，提交至 `skills/` |
| 创作模板 | 可复用的图像、视频或封面模板 | 提供 `template.json`、封面与案例素材、提示词、设置、来源归属和使用授权 | 在 [`template/`](../../template/) 提交 [PR][contribute-pr]；新格式先通过 [Issue][contribute-issue] 讨论 |
| 插画设计 | 原创插画、图标或界面设计 | 提供预览、可编辑源文件及许可说明 | [Issue][contribute-issue] 讨论 → [PR][contribute-pr]，素材位置先确认 |
| 第三方服务接入 | AI 或媒体服务提供方 | 说明场景、配置、错误处理、密钥安全及测试 | [Issue][contribute-issue] 讨论 → [PR][contribute-pr]，修改对应 Web / Daemon 模块 |

创作模板按 `template/<module>/<id>/<version>/template.json` 组织，并将引用的素材放在同一版本目录。目前支持 `image-generation`、`video-generation` 和 `cover-generator`；标题与简介需同时提供中文和英文。提交 PR 前运行 `pnpm templates:validate`。

如何参与：

1. 在 [Issues](https://github.com/krillinai/OpenCreator/issues) 中描述问题、使用场景和预期行为。
2. 从最新分支创建范围清晰的功能或修复分支。
3. 遵循仓库现有架构，通用产品能力只在 Web + Daemon 实现一次，原生差异通过 capability 隔离。
4. 为行为变化补充相应的单元、集成或 E2E 测试，并在 Pull Request 中写明已运行和未运行的验证。
5. 不提交 `.runtime/`、本机凭据、Codex 会话、构建缓存或其他用户数据。

[contribute-issue]: https://github.com/krillinai/OpenCreator/issues
[contribute-pr]: https://github.com/krillinai/OpenCreator/pulls

## 贡献者

感谢每一位通过代码、文档、反馈、问题报告、Skills、设计和创意参与 OpenCreator 的贡献者。

<a href="https://github.com/krillinai/OpenCreator/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=KrillinAI/OpenCreator&amp;max=500&amp;columns=20" alt="OpenCreator 贡献者" />
</a>

<!-- contrib.rocks 刷新缓存期间，先显式保留近期贡献者。 -->
<br />
<a href="https://github.com/xiaheyuan">
  <img src="../images/contributors/xiaheyuan.svg" width="48" height="48" alt="XiaHeyuan 头像" />
</a>

## Star 趋势

OpenCreator 原名 KrillinAI。下图展示仓库在更名前后的完整 Star 历史。

[![OpenCreator Star 趋势](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

## 相关项目

| 项目 | 作用 |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | 提供模型访问、推理、工具调用、会话、Skills 和 MCP 集成等 Agent 执行能力。 |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 解析支持的公开媒体链接、查询可用格式，并为创作流程下载视频或音频。 |
| [FFmpeg](https://ffmpeg.org/) | 通过 FFmpeg 与 ffprobe 完成媒体转换、合成、抽帧和输出校验。 |
| [Whisper](https://github.com/openai/whisper)、[whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[faster-whisper](https://github.com/SYSTRAN/faster-whisper) 与 [WhisperKit](https://github.com/argmaxinc/WhisperKit) | 根据 Runtime 的平台能力提供云端或本地语音转写选项。 |
| [React](https://react.dev/) | Web 与 Desktop 共用界面的基础。 |
| [Fastify](https://fastify.dev/) | 本地 Runtime 的 HTTP 与 API 基础。 |
| [Electron](https://www.electronjs.org/) | 承载 Desktop 原生系统能力、应用生命周期与打包。 |
| [SQLite](https://www.sqlite.org/) | 持久化项目、会话、Run、计划任务、记忆及其他本地工作区数据。 |
| [Model Context Protocol](https://modelcontextprotocol.io/) | 将外部工具与服务连接到 Agent 工作台的开放协议。 |

---

<div align="center">

**OpenCreator · Create locally, work continuously.**

</div>
