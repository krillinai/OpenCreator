---
name: krillinai-tts
description: Use when generating target-language dubbing with KrillinAI CLI from SRT subtitles, including TTS audio creation and optional dubbed video generation.
---

# KrillinAI TTS

Use this skill for the `tts` stage. Read `skills/krillinai-cli/references/cli-contract.md` first for binary location, execution working directory, configuration, and JSON behavior.

## Command

```bash
(cd "$KRILLINAI_CWD" && "$KRILLINAI_CLI" tts \
  --workdir "$WORKDIR" \
  --input-srt "$WORKDIR/target_language_srt.srt" \
  --line-mode target-only \
  --video "$WORKDIR/origin_video.mp4")
```

## Inputs

- `--input-srt` is required. Usually use `target_language_srt.srt`.
- `--video` is optional but needed when generating `video_with_tts.mp4`.
- TTS provider must be configured in `<execution-cwd>/config/config.toml`.

## Important Flags

| Flag | Use |
|---|---|
| `--input-srt` | SRT to synthesize |
| `--line-mode target-only` | Use target-language lines only |
| `--line-mode bilingual-target-top` | Bilingual mode with target on top |
| `--line-mode bilingual-target-bottom` | Bilingual mode with target on bottom |
| `--voice` | Provider-specific voice |
| `--voice-clone-source` | Voice clone source audio URL/path when supported |
| `--dry-run` | Validate command shape |

## Outputs

Read paths from manifest:

- `tts_final_audio.wav`
- `video_with_tts.mp4` when a video input is available

## Verification

- Require terminal JSON with `"ok": true`.
- Confirm `tts_final_audio.wav` exists and has non-zero size.
- If `video_with_tts.mp4` is produced, inspect duration and audio stream with `ffprobe`.
- For JSON/error contract, read `skills/krillinai-cli/references/cli-contract.md`.
