---
name: krillinai-render-vertical
description: Use when rendering portrait videos with KrillinAI CLI, including converting source video to vertical format, adding short bilingual subtitles, rendering dubbed vertical videos, and checking vertical subtitle readability.
---

# KrillinAI Render Vertical

Use this skill for `render-vertical`. Read `skills/krillinai-cli/references/cli-contract.md` first for binary location, execution working directory, configuration, and JSON behavior.

## Bilingual Short-Subtitle Video

```bash
(cd "$KRILLINAI_CWD" && "$KRILLINAI_CLI" render-vertical \
  --workdir "$WORKDIR" \
  --video "$WORKDIR/origin_video.mp4" \
  --subtitle "$WORKDIR/short_origin_mixed_srt.srt" \
  --major-title "今日话题" \
  --minor-title "AI Video")
```

## Dubbed Vertical Video

```bash
(cd "$KRILLINAI_CWD" && "$KRILLINAI_CLI" render-vertical \
  --workdir "$WORKDIR" \
  --video "$WORKDIR/video_with_tts.mp4" \
  --subtitle "$WORKDIR/target_language_srt.srt" \
  --dubbed \
  --major-title "今日话题" \
  --minor-title "AI Video")
```

## Subtitle Behavior

The Go renderer follows the good behavior from `vertical_srt.py`:

- Chinese uses word segmentation before line decisions.
- Display width is used for line splitting: Chinese counts as width 2, other text as width 1.
- Long Chinese subtitles are split across time into multiple `Dialogue` entries instead of stacked with `\N`.
- The goal is to keep the screen to one English line plus one Chinese line when possible.

## Outputs

- `transferred_vertical_video.mp4`: source converted to portrait format.
- `vertical_bilingual.mp4`: default final vertical video.
- `vertical_dubbed.mp4`: final video with `--dubbed`.
- Final variants are reported through the manifest key `vertical_video`.

## Verification

Use text and visual checks:

```bash
rg -n -F '\\N' "$WORKDIR/formatted_vertical_bilingual.ass"
ffmpeg -y -ss 00:00:01 -i "$WORKDIR/vertical_bilingual.mp4" \
  -frames:v 1 "$WORKDIR/vertical_preview_%03d.jpg"
```

Also require terminal JSON with `"ok": true`, valid video/audio streams, readable subtitles, and non-garbled titles.
