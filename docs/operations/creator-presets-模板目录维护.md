# Creator Presets（创作模板目录）维护

## 目录与边界

- 正式模板放在 `template/<module>/<id>/<version>/template.json`；封面与模板放在同一目录。`id`、运行时模板版本和模块字段必须匹配 `apps/daemon/src/creator/presets/module-schemas.ts`。
- `status: published` 才出现在首页；`featured: true` 还会进入默认的「推荐」列表。编译产物位于 `.runtime/generated/creator-presets/`，不要手改。
- 模板只预填用户可修改的业务参数。不要内置外部视频链接、用户文件、固定音色、凭证、阶段状态或假生成结果；点击「使用此模板」只创建草稿任务，不自动运行付费阶段。
- 没有经过真实生成验收的封面应在中英文描述中标为「场景示意」，不得称为成品或真实效果。封面需精确 16:9、至少 640×360、且不超过 2 MiB。
- 视频翻译示例预览最长 65 秒，其他模块保持 10 秒；单个 MP4 不超过 8 MiB、全部预览 MP4 总计不超过 20 MiB。预览成片不是模板任务的默认输入。

## 本地验证

1. `pnpm templates:validate`：校验模板字段、资源、尺寸和运行时绑定。
2. `pnpm templates:compile`：重新生成目录及资源哈希；正在运行的 Daemon（后台服务）需要重新启动才能读取新目录。
3. 检查 `/.opencreator/runtime-config`，再检查 `/.opencreator/runtime/creator/presets?locale=zh-CN` 与封面 URL；仅确认 Vite（开发服务器）首页返回 `200` 不足以证明模板加载成功。
4. 点击模板进入对应工作区，核对草稿参数、源素材仍待用户提供，且没有自动执行生成或下载。

## 覆盖快照（2026-09-24）

- 源目录共 106 个模板，其中 105 个已发布；图像生成 66、视频生成 25、封面生成 4，视频翻译 4、视频下载 2、智能配音 4。
- 首批新增 `bilingual-interview`、`source-video-archive`、`knowledge-narration`。通过目录校验、目录注册表与首页组件定向测试、Web 类型检查及本地目录 API 检查；未运行真实翻译、下载或付费配音，也未做 Desktop（桌面端）打包验收。
- 从 2026-09-18 删除提交 `4b69a8fb` 的父提交恢复了 12 个历史正式模板；随后按用户要求从正式目录移除 `cover-generator/personal-growth`，当前保留视频翻译 3、视频下载 2、智能配音 3、封面生成 3，共 11 个恢复项。历史测试夹具未删除；图像和视频生成的 6 个旧开发样例继续留在测试夹具或 Git 历史中。恢复项只含参数预设和示意封面，不含可播放的真实成品，不应当作运行能力验收。
- 视频下载正式目录只保留 `audio-download` 和 `highest-quality-video`；后者显示名称改为“高清视频下载”，ID 不变。首批新增的 `source-video-archive` 已按用户要求移出正式目录，原目录留在本机废纸篓，可恢复；不改动视频下载 Runtime。
- 首次恢复时执行 `pnpm templates:validate`（108 个通过）、`pnpm templates:compile`、Daemon 目录注册表与编译器测试（18 项通过）、Web 首页组件测试（30 项通过）；移除个人成长封面后再次通过目录校验（107 个）、注册表测试（8 项）并编译、重载 Runtime，当时目录 API 返回 106 个已发布模板，移除项原资源返回 HTTP 404。随后移除 `source-video-archive`、更新两个视频下载模板，再次通过目录校验（106 个）、注册表测试（8 项）并编译、重载 Runtime；中文和英文目录 API 均返回 105 个已发布模板，视频下载分类恰好 2 个，封面资源均返回 HTTP 200。未以真实来源或付费服务重新运行翻译、下载、配音及封面生成，也未验证 Desktop 打包产物。
- 火柴人、视频切片、文章写作、小红书帖子和短视频脚本目前不在模板协议的模块枚举内；下一批需要先扩展协议、参数校验、运行时绑定和首页分类，再放入正式模板。

## 视频翻译示例（2026-09-24）

- `bilingual-interview` 的示例片段取自 The Economist 的 [The full-length interview with Elon Musk](https://www.youtube.com/watch?v=XuoqKYxDHVc)，原片 `01:09–02:10`，成片约 61 秒、1280×720、H.264/AAC，约 3.2 MiB。封面取自成片第 29 秒，不再是场景示意。
- 英文来自平台自动字幕，逐句校订并人工翻译成中文；使用项目打包的 FFmpeg/libass 烧录中英双语字幕，抽帧检查了字幕位置、字体和主体遮挡。这证明示例媒体是真实原片的译制剪辑，**不证明** OpenCreator 的自动翻译服务已跑通：独立 KrillinAI CLI 的字幕阶段因缺少配置文件未执行。
- 示例烧录按参考样式调整为靠近画面底边的中文白字、英文暖黄色，带黑色描边；1280×720 成片的双语字幕底边距约 60 像素。模板的 `subtitlePosition: top` 表示“译文在原文上方”，并非字幕位于画面顶部；模板字号改为 `large`、描边宽度改为 3。
- 平台公开可观看不代表可再分发。此片段的再利用授权尚未核实；当前只作为本地开发工作台示例，外部发布或打包分发前必须确认素材许可或替换为已获授权的视频。模板使用者仍需自行提供有权使用的源视频。

## 本轮封面来源与提示词

首批三张封面均由 RightCodes Draw 的 `gpt-image-2` 生成，未使用备用服务；生成结果规范为 1280×720 JPEG。视频翻译封面后来换成真实译制示例第 29 秒画面；视频下载与智能配音仍为场景示意。

- 视频翻译原始示意封面（已被真实成片帧替换）：`Use case: productivity-visual. Asset type: 16:9 cover image for a video translation workflow preset card. Primary request: a tasteful editorial photograph of a video editing desk with a wide monitor showing one paused documentary interview frame and two distinct subtitle tracks below it, one white and one warm yellow. Show the idea of English-to-Chinese bilingual subtitles without legible text, flags, logos, named people, or fabricated interface labels. Clean restrained workspace, natural daylight, muted charcoal, warm yellow, and teal details. The scene must clearly suggest video translation, not a finished sample output. Sharp readable composition at thumbnail scale; no watermark, no branding, no UI text.`
- 竖屏视频切片：旧 `vertical-knowledge` 模板只改中英文显示名称，模板 ID 与运行时绑定保持不变。RightCodes Draw 的 `gpt-image-2` 生成横屏虚构人物原画面到同一人物 9:16 竖屏近景的工作流示意，规范为 1280×720 WebP（65,754 字节）。画面不含平台标志、可读文字或伪造的生成结果，真实竖屏成片尚未验收。
- 高清音频下载：以 `highest-quality-video` 的旧封面为构图和配色参考，RightCodes Draw 的 `gpt-image-2` 编辑出同系列音频主题封面，规范为 1280×720 WebP（81,642 字节）。保留左侧大标题和右侧设备布局，用波形、耳机、下载图标及 MP3/WAV 标识取代视频画面、清晰度选择和平台标志；只作场景示意，不代表真实下载结果。
- 视频下载：`Use case: productivity-visual. Asset type: 16:9 cover image for a video download workflow preset card. Primary request: an editorial photograph of a tidy desktop with one monitor showing an unbranded paused nature video of a mountain lake, plus a small removable storage drive and neatly arranged video media cards beside the screen. The visual idea is saving a source video for later editing. No invented app interface, no site logos, no platform marks, no file URLs, no progress indicators, no legible text, no human subjects. Warm daylight, graphite desk, natural green and blue from the lake, one crisp focal subject. Distinct realistic cover that reads at thumbnail size; no watermark.`
- 智能配音：`Use case: photorealistic-natural. Asset type: 16:9 cover image for a calm narration voice generation workflow preset card. Primary request: a close editorial photograph of a high-quality tabletop studio microphone, headphones, and a neatly folded script page on a small recording desk. The script is face down so no text is visible. Calm, focused atmosphere with warm natural light and forest-green acoustic panels; a subtle analog audio waveform visible on an out-of-focus screen in the background, no legible UI. No human subjects, no voice actor impersonation, no logos, no watermarks, no extra copy. Sharp microphone silhouette, visually distinct and legible at thumbnail size. This is a conceptual workspace cover, not a generated audio result.`
