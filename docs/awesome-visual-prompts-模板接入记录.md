# awesome-visual-prompts 模板接入记录

来源：`dingle-kb/awesome-visual-prompts` 的 `main`，核对提交 `005dd18357dd94bcb68c4a1b532e835fe0859750`（2026-09-29）。来源 `style.json` 是案例资料，不是 OpenCreator 可运行模板。

本次新增 `template/` 中 12 个图像模板、3 个视频模板。图像模板使用现有单参考图或文生图工作区；视频模板使用最长 10 秒的单次生成工作区。提示词、画幅、时长或候选数量按现有协议配置，进入工作区后可编辑。封面从来源案例预览裁成 16:9；完整图片预览和三段视频样片仍为来源案例，不是 OpenCreator 的实测生成结果。部分来源案例本身标记 `unverified`，详情文案统一明确未复测。

仍未接入的图像案例：`concert-confetti-perspective-photo`（双图）、`pet-driver-movie-poster-swap`（三图）、`travel-memory-suitcase-stickers`（十二图）。现有图像模板一次只能绑定一张参考图，不能准确实现这些输入关系。

仍未接入的视频案例：`1990s-pixel-text-game`、`animated-encyclopedia-collage-explainer`、`barbecue-macro-food-film`、`chinese-ink-seamless-transitions`、`clay-robot-startup-story`、`college-physics-experiment`、`crystal-particle-kitchen-transformation`、`exhausted-daily-life-montage`、`frozen-fountain-rainbow-reveal`、`knitted-doll-breakfast-stop-motion`、`luxury-perfume-ugc-review`、`luxury-skincare-water-ad`、`miniature-workers-usb-repair`、`office-cat-workday-animation`、`paris-street-fashion-transformation`、`pop-up-atlas-paper-animation`、`regency-film-montage`、`volcano-evacuation-city-build-timelapse`。来源样片为 15-45 秒，或要求多个制作阶段；当前单次 10 秒 Runtime 无法忠实完成整段工作流。后续若引入多片段编排，应重新设计参数和验收，不宜只截取样片后宣称功能已支持。

来源仓库明确说明案例媒体和第三方提示词不因收录而获得 MIT 授权。本次仅在本地分支引入案例素材；对外分发前仍需核实相应来源的转载、改编和商业使用权限。未进行真实付费生成、提示词效果对比或最终分发授权审查。
