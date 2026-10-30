# 无标点多语言字幕重构：先导实现进度（2026-10-25）

> 历史记录：下文保留先导阶段当时的状态，不代表当前工作树进度。后续完整字幕质量对比见 [KrillinAI 字幕质量评测](2026-10-25-subtitle-quality-comparison.md)：最新全片配对评分为旧版 78.7 分、优化后新版 80.3 分；切口改善，但仍有重复与含义反转，尚不能认定稳定替代。首轮结果保留在报告中。

当前处于阶段 0.5。核心实验代码、定向回放、多语言第二组输入和结构核对已落地；M0.5 验收尚未通过，阶段 1–5 未启动。生产默认仍是原路径，不能据此宣称已移除 spaCy 或已减小安装包。

| 阶段 | 当前状态 | 事实依据 / 剩余工作 |
| --- | --- | --- |
| 0 冻结基线与评测协议 | 部分完成 | 已有输入 hash、模型交换记录和调用成本；尚缺与当前生产入口匹配的完整冷跑基线、预先冻结的人工 rubric 和总成本门槛 |
| 0.5 核心先导 | 实现和诊断已补齐，质量验收进行中 | 指定全片已有两轮真实产物；本轮补充布局回放、全片分段和每语言第二份独立输入，仍有语言样本降级 |
| 1 源文档与恢复迁移 | 待执行 | 不把试验用源文档或稳定键视为生产 SourceManifest/ContentManifest 已完成 |
| 2 生产批量分段 | 待执行 | 新窗口算法当前通过先导入口使用，尚未接入生产全部入口 |
| 3 生产显示 v10 | 待执行 | 先导已有适配和次数记录；同指纹崩溃恢复、尝试次数持久化、旧任务隔离仍待迁移 |
| 4 默认切换 | 待执行 | 需完整质量、冷跑成本和恢复门禁 |
| 5 移除 NLP / 打包 | 待执行 | 尚未删除 Python NLP、模型资源或修改打包；未做 Desktop 验收 |

本轮补充的实现：

- 下标协议明确相邻区间必须共用端点，提供两个连续区间示例；重试指出实际缺失 token、最终覆盖或字节超限。
- 分段初始窗口从 64 提升到 256 tokens，允许有界扩展到 512。按序保留 pending，校验实际序列化请求不超过 16,000 字节。`hard_end` 改为文档末尾布尔标志，增加短上下文；英文大小提示只用于英文，其他语言按完整独立陈述分段。
- 源坐标准备保留 URL、日期、数值单位和受保护短语，无空格语言中的 Latin 词不再拆成字符。超过 800 字节的受保护原子明确失败；降级不再把超长词切成字素冒充完整单元。
- 显示生成提供每个源起点的最大合法终点和具体失败反馈。覆盖和切口结构合法但长度超限时，只在模型给出的各配对内部生成局部长度提案，再独立审查实际新切口；程序切分本身不会得到合格标记。
- 原两轮布局后至多一次完整单元展示适配；完整原译 `FullTarget` 保留，独立核验通过后才替换 `LayoutBaseTarget`。保留内容 hash、失败证据、布局/适配次数和显示输入指纹。服务失败不触发适配；已拒绝候选不得作为同一候选的近似降级交付。
- 主备模型的失败物理尝试、实际响应模型、返回内容及 usage 均进入实验记录；凭证脱敏。执行器跟随测试超时取消，并支持调用预算。先导计数用于审计，不构成生产恢复承诺。
- 增加只重跑指定单元显示、只重跑全片分段的入口，以及仅使用 Python 标准库的只读产物核对工具；它不属于 Runtime 依赖。

已有 `after-pilot-r2` 是旧先导全片，不是 spaCy 生产基线：288 个单元、696 条 cue、30 个近似布局单元，683 次请求、625,150 tokens、2,574.85 秒。它本身为 degraded。

`layout-replay-r4` 复用该全片所有内容，仅重跑预先列出的 6 个原近似单元及 2 个对照单元：6 个原近似单元均通过当轮模型布局审查，2 个对照单元也通过；18 次请求、11,146 tokens、59.46 秒，内容请求为 0。其余 280 个单元复用旧布局，混合全片仍有 24 个近似单元，仍为 degraded。不能将这次定向结果或其成本当作新全片冷跑。全片时间锚点缩短到 1/4 后，固定布局的时间硬校验通过，远端补请求为 0。首次 `layout-replay-r3` 使用过期代理且长度限制不同，只作为服务失败证据，不纳入质量比较。

最终代码的 `segmentation-r6` 对同一冻结词元流做全片独立冷分段：286 个单元、21 次请求、63,563 tokens、83.36 秒，降级单元 0；原 `after-pilot-r2` 分段为 123 次请求、125,228 tokens、416.79 秒。请求减少 82.9%，token 减少 49.2%。这是分段阶段的实测改善，不代表完整翻译链路降低同等比例，也不代表语义边界已通过人工评阅。

调试期间 `segmentation-r3` 曾得到 31 次请求、91,224 tokens、0 降级；`segmentation-r4` 加入全语言统一的独立陈述提示后，用尽 150,000 token 预算（实际最后在途响应后为 152,061），出现 22 个降级单元；撤回对英文的影响后，`segmentation-r5` 为 31 次请求、100,743 tokens、4 个降级单元。真实请求揭示模型有时把 exclusive end 当成 inclusive end；最终修正连续区间示例并提供具体缺失下标反馈，得到 r6。失败轮次保留，不追溯调大预算。

新增五份无标点合成输入，覆盖条件、否定、日期、价格和跨输入 cue 的完整意思。与既有 `multilingual-*-en` 相比，每个语言现有 2 个不同输入 hash；重复运行不增加独立样本数。以下为最终代码版本的 `independent-2-*-r5`，不隐藏之前各轮失败：

| 样本 | 翻译单元 | cue | 请求 | tokens | 耗时 | 自动状态 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 中文 → 英文 | 5 | 6 | 9 | 5,997 | 27.40s | degraded |
| 日文 → 英文 | 5 | 5 | 4 | 3,695 | 11.86s | qualified |
| 德文 → 英文 | 2 | 6 | 8 | 6,023 | 27.18s | qualified |
| 阿拉伯文 → 英文 | 3 | 5 | 6 | 4,768 | 18.99s | qualified |
| 泰文 → 英文 | 8 | 8 | 4 | 4,224 | 11.73s | qualified |

`qualified` 仅为执行器的结构、内容状态和模型审查判定，不代表人工或母语评阅通过。中文最后一轮仍包含 1 个近似布局，不能计入合格对齐；日文和泰文此前轮次也有降级，说明短样本自动通过不等于稳定支持。更早 `independent-2-zh` 的真实调用已经走通一次独立核验通过的展示适配，保留原始 `FullTarget`；最新长度提案减少了不必要的适配调用，但不能用一次较好的结果掩盖跨运行波动。

机器报告列出的字幕产物均直接导出原文、译文、双语三份 SRT，并通过单行角色、索引、覆盖、正时长和不重叠核对。Go 执行器另行检查双侧显示单位上限；核对脚本不做独立字素测宽，也未做真实字体烧录验收。

本轮验证为服务相关测试 45 个顶层用例，以及 OpenAI 包 23 个顶层用例，合计 150 个含子用例的测试通过。没有运行整个仓库测试、生产构建或 Desktop 打包。测试日志保存在 `/tmp/opencreator-pilot-service-final-20261025.jsonl` 和 `/tmp/opencreator-pilot-openai-final-20261025.jsonl`。

原始产物均位于 `runtime/krillinai/.tmp/krillinai-pilot/<RunID>/`。每次运行的 `manifest.json` 记录模型、输入 hash、工作树代码 hash、显示限制、预算和状态；最终 r6/r5 另有 `invocation.json` 保存准确命令、环境参数（仅配置文件路径，无凭证）及运行期间代码 hash 未变化的断言，`model-exchanges.jsonl` 保存未经人工修文的请求/响应及重试。真实配置文件不提交；每次输出目录必须为空。结构核对汇总见 [机器报告](assets/subtitle-pilot-20261025.json)。

从 `runtime/krillinai` 执行相关验证：

```sh
go test ./internal/service -run '^(TestPilot|TestParsePilotLayout|TestLayoutPilot|Test.*Filler|Test.*Hesitation)' -count=1
go test ./pkg/openai -count=1
python3 scripts/subtitle-pilot-report.py .tmp/krillinai-pilot/after-pilot-r2 .tmp/krillinai-pilot/layout-replay-r4
```

重跑真实先导时，设置 `KRILLINAI_PILOT_CONFIG`、有效的 `KRILLINAI_PILOT_ENDPOINT`、`KRILLINAI_PILOT_RUN_ID` 和 `KRILLINAI_PILOT_SOURCE_REVISION`。按入口补充参数：

| 入口 | 其他环境变量 | 测试命令 |
| --- | --- | --- |
| 完整先导 | `INPUT`、`OUTPUT`、`ORIGIN`、`TARGET`、`DISPLAY_LIMIT`、`MAX_REQUESTS`、`TOKEN_CAP`，统一加 `KRILLINAI_PILOT_` 前缀 | `go test ./internal/service -run '^TestUnpunctuatedSubtitlePilotLive$' -count=1 -timeout 8m -v` |
| 指定布局回放 | `KRILLINAI_PILOT_REPLAY` 指向完整实跑目录，`KRILLINAI_PILOT_OUTPUT`，`KRILLINAI_PILOT_UNIT_IDS` 逗号分隔；自动沿用原显示上限 | `go test ./internal/service -run '^TestSubtitlePilotLayoutReplayLive$' -count=1 -timeout 12m -v` |
| 全片只分段 | `KRILLINAI_PILOT_REPLAY`、`KRILLINAI_PILOT_OUTPUT` | `go test ./internal/service -run '^TestSubtitlePilotSegmentationLive$' -count=1 -timeout 8m -v` |

小样本完整运行前固定的上限为 32 次逻辑请求、50,000 tokens；布局诊断为 64 次请求、100,000 tokens；分段诊断为 64 次请求、150,000 tokens。一次在途响应可能越过 token 上限，之后不再发起请求。这些局部预算不追认旧全片的阶段 0 协议，也不能替代生产全链路成本门槛。

下一步仍按原方案门禁推进：先解决中文等语言的近似布局及重复运行的切口波动，冻结独立人工评阅与匹配的生产基线，再对最终代码进行完整英文冷跑和语言样本验收；达到 M0.5 的质量与成本门槛后，才开始源清单、内容指纹和生产恢复迁移。纯犹豫音省略、媒体实际边界及各导出入口的生产兼容仍属于后续明确验收项。
