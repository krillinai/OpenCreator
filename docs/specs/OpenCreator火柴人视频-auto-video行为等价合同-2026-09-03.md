# OpenCreator 火柴人视频与 auto-video 行为等价合同

> 状态：实施基线
> 参考实现：`auto-video@c85da4a2d86ec761baa0e697ed10d62982ff401b`
> 目标实现：`stickman-video@2`，TypeScript + CreatorJob + KrillinAI + Remotion

## 1. 等价边界

本合同约束生产行为，不要求复用 Python 代码，也不承诺模型输出逐像素一致。只有下列各项同时成立，才可称为与参考实现行为等价：

- 阶段先后关系、输入工件和输出工件一致。
- 来源先拆成有原文引用的 Claim，所有 Claim 必须明确保留或舍弃，不能静默遗漏。
- 脚本由一次 LLM 调用同时生成旁白、画面意图和生图描述；每段引用保留 Claim 及其原始来源片段。
- 角色参考图片以真实文件和 SHA-256 进入每次镜头生图请求。
- 旁白先按段生成，再以真实媒体时长建立分镜、字幕和时间线。
- 固定角色、品牌和 BGM 先物化并锁定风格合同，才允许全量镜头产生新的计费请求。
- 视觉、时间线、媒体和交付质量门真实执行；失败不得生成成功工件。
- 上游变化使所有依赖工件变为 `stale`，恢复时只复用指纹完全一致的成功工件。
- 占位资产、Fake Provider 和未验证媒体只能得到 `technical-draft`，不能得到 `publishable`。

## 2. 生产执行图

```text
文本或 URL 来源
  -> source-brief
  -> content-plan
  -> script（一次生成旁白 + 画面意图 + 生图描述，并完成结构校验）
  -> [唯一人工门：approve-script]
  -> locked-script（审核稿锁定为新的不可变工件）
  -> tts（逐旁白单元）
  -> audio-timing（ffprobe 累计真实 TTS 时长）
  -> storyboard（基于真实时间）
  -> prompt-pack
  -> character-reference（真实文件）
  -> style-assets（物化角色、品牌、BGM）
  -> style-calibration（自动合同锁）
  -> images（全量镜头）
  -> visual-validation
  -> timeline + narration-srt
  -> render-clean
  -> media-validation
  -> cover / bilingual-subtitles / publish-copy
  -> bilingual-render
  -> package-validation
```

工作台仍显示四个业务步骤；这些步骤是上述生产阶段的产品分组，不是第二套状态机。`CreatorCollaborationPanel` 是唯一 Agent、进度、Activity 和错误展示面。

## 3. 阶段与工件合同

| 阶段 | 必需输入 | 必需输出 | 硬性质量门 |
| --- | --- | --- | --- |
| `ingest-text` / `acquire-source` / `source-transcript` | 用户文本或 URL | `source_text` 或 `source_video` + `source_subtitle` | 输入非空；URL 媒体和字幕可读取 |
| `source-brief` | 来源文本 | `source_brief` | 每个来源片段进入至少一个 Claim；Claim 只能引用真实来源片段 |
| `content-plan` | `source_brief` | `content_plan` | 所有 Claim 必须且只能进入保留或舍弃集合；章节覆盖全部保留 Claim |
| `script` | `content_plan` + `source_brief` | `script_manifest` | 同一 Prompt 同时生成旁白、画面意图、生图描述；每段绑定 `claimIds` 和 `sourceSpanIds`；覆盖全部保留 Claim；满足总旁白预算；失败时携带整稿和校验原因重新生成整稿 |
| `approve-script` | 待审核 `script_manifest` | 新的已锁定 `script_manifest` | 审核状态为 approved、`contentLocked=true`；旧审核稿变为 stale；TTS 只能读取当前锁定稿 |
| `tts` | 已审核脚本中的单段旁白 | 每段一个 `narration_audio` | 真实非空音频；ffprobe 得到正时长；scope 与 segment 一致 |
| `audio-timing` | 全部段音频 | `audio_timing` | 每段 start/end/duration 来自 ffprobe；连续且总时长一致；30 秒任务真实总时长必须为 27–33 秒 |
| `storyboard` | `script_manifest` + `audio_timing` | `shot_spec` | 镜头时间必须引用真实 timing，不得按脚本估时比例分配 |
| `prompt-pack` | `shot_spec` | `image_prompt_pack` | 最终 Prompt 由画面意图、角色、风格、构图约束共同生成 |
| `character-reference` | `selectedPresetId` | `character_reference` | `path`、`sha256`、MIME、尺寸均存在；哈希与预设资源一致 |
| `style-assets` | `selectedPresetId` + 固定资源包 | `character_reference` + `style_contract` | 角色 `path`、`sha256`、MIME、尺寸均存在；哈希与预设资源一致 |
| `style-calibration` | `style_contract` | `style_calibration` | 自动合同锁必须证明风格、16:9 和角色引用完整 |
| `images` | 已校准 Prompt Pack + 角色参考图 | 每镜头一个 `shot_image` | 每个请求携带同一参考图字节；只复用相同指纹结果 |
| `visual-validation` | 全部镜头图 | `visual_validation` | 可解码、16:9、非空白、OCR 无字幕、哈希不重复；全部通过才成功 |
| `timeline` | `audio_timing` + 镜头图 + 音频 | `timeline_manifest` + `narration_subtitle` | 画面轨、旁白轨、字幕轨边界一致；SRT 机械导出自真实 timing |
| `render-clean` / `media-validation` | Timeline | `clean_video` + `media_validation` | Remotion 成功；ffprobe 和抽帧检查通过 |
| 交付阶段 | 已验证纯净视频 | 固定五项结果 + `delivery_manifest` | 文件存在、非空、哈希匹配、可探测；manifest 决定可发布性 |

## 4. Provider 请求合同

当 OpenAI 图像配置指向 RightCodes 兼容端点时，镜头图请求固定为：

```json
{
  "model": "gpt-image-2",
  "prompt": "<最终镜头 Prompt>",
  "size": "1024x576",
  "n": 1,
  "quality": "auto",
  "response_format": "b64_json",
  "async": true,
  "image": ["data:image/<type>;base64,<所选角色原始字节>"]
}
```

提交地址只能是 `/images/generations`，不能因有参考图而切换为 `/images/edits` multipart。异步响应必须保存 `task_id` 并查询原任务；远端是否接收未知时进入 `needs_input`，普通重试不得再次计费。

## 5. 审核、失败与失效矩阵

| 事件 | 当前工件 | 必须失效 | 不得发生 |
| --- | --- | --- | --- |
| 修改脚本 | 新 `script_manifest` | 旧锁定脚本、TTS、timing、分镜、Prompt、样图、全量图、Timeline、视频和交付 | 复用旧音频或旧时间线 |
| 修改单镜头画面描述 | 新 `shot_spec` | 对应 Prompt、样图/镜头图及全部聚合下游 | 删除无关镜头的当前图片 |
| 更换角色 | 新 `character_reference` | 全部样图、全量图、视觉校验、Timeline、视频和交付 | 只改 Prompt 文本而继续使用旧图 |
| 更换音色/TTS 模型 | 新分段音频 | timing、分镜节奏、Timeline、字幕、视频和交付 | 按旧估时拼接新音频 |
| 单镜头候选尺寸或内容校验失败 | 失败证据 | 当前候选不得晋级；按固定重试上限处理 | 把失败候选写成成功图片或继续下一镜头 |
| 任一真实依赖失败 | `failed` / `needs_input` | 下游保持缺失或 stale | 写入成功工件、显示 100% 成功、产出 publishable |

正常流程只保留脚本人工审核。样图自动校准成功后继续；自动检查无法证明可用时阻塞并给出可操作原因，不新增常态人工审核步骤。

旁白中的人物、事件和关系由脚本 Prompt 基于保留 Claim 与原始来源片段生成。Runtime 不通过制作词黑名单删词、替换句子或局部修补旁白，避免为了命中规则破坏语义；结构、引用闭环和预算不合格时，必须把完整失败原因交回模型并重新生成整稿。图片中禁止可见文字属于生图质量约束，只检查 `imagePrompt`，不参与改写旁白。

## 6. 进度与完成判定

- 同一时刻协作面板只展示一个当前业务进度。内部 scoped StageRun 可并行，但由 Adapter 聚合为单条标准进度。
- 标准进度只含 `phase`、`percent`、`message`、`completed`、`failed`、`total`，通用 Panel 不读取执行器私有字段。
- 等待执行的后续阶段不显示独立进度条；完成的内部阶段进入 Activity，不重复显示多条 100%。
- Fake Daemon、1x1 图片、伪 MP3、手填 duration 和跳过的真实 E2E 不能作为发布能力通过证据。
- `publishable` 只能由真实角色图、真实生图、真实 TTS、真实 timing/SRT、真实 Timeline、Remotion final、ffprobe、抽帧和包校验共同证明。

## 7. 验收最小样例

正式验收固定使用：短文本、`student` 非默认角色、3 个镜头、已配置的真实音色和真实图像服务。验收必须证明：

1. 每次生图请求中的参考图 SHA-256 与 `student.png` 一致。
2. 所有生成图为 16:9；单镜头候选按固定上限重试，耗尽后不得继续下一镜头。
3. 脚本一次生成旁白、画面意图和生图描述；每段引用有效的保留 Claim 和来源片段，且全部保留 Claim 都被覆盖。
4. TTS 恰好按脚本段数生成；每段时长来自 ffprobe，30 秒任务的真实总时长必须为 27–33 秒。
5. Storyboard 在 `audio_timing` 成功前没有 StageRun。
6. Timeline 三轨边界和 SRT cue 与真实 timing 一致。
7. 页面只显示一个当前进度，失败原因与 Daemon 事实一致。
8. 五项交付都通过实际文件、哈希、ffprobe/抽帧和 manifest 校验；否则状态保持 `BLOCKED`。
