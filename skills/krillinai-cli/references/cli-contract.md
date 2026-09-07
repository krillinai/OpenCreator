# KrillinAI CLI Contract

## Build And Binary

Use the repository build script from the OpenCreator root:

```bash
pnpm krillinai:build
```

It builds `runtime/krillinai/cmd/cli` and `runtime/krillinai/cmd/server`. Native binaries and a manifest are written under:

```text
.runtime/build/krillinai/<platform>-<arch>/
├── bin/krillinai-cli[.exe]
├── bin/krillinai-server[.exe]
└── manifest.json
```

Set reusable absolute paths from the repository root:

```bash
REPO_ROOT="$PWD"
TARGET="$(node -p "process.platform + '-' + process.arch")"
SUFFIX="$(node -p "process.platform === 'win32' ? '.exe' : ''")"
KRILLINAI_CLI="$REPO_ROOT/.runtime/build/krillinai/$TARGET/bin/krillinai-cli$SUFFIX"
KRILLINAI_CWD="$REPO_ROOT/runtime/krillinai"
WORKDIR="$REPO_ROOT/tasks/demo"
test -f "$KRILLINAI_CLI"
mkdir -p "$WORKDIR"
```

## Execution Working Directory

The CLI loads `config/config.toml` relative to the process working directory.

- Source checkout: run real commands with `runtime/krillinai` as the working directory. Create the ignored `runtime/krillinai/config/config.toml` from `config-example.toml` and configure only the providers needed by the requested stage.
- Release archive: run from the unpacked package root after creating `config/config.toml` from `config/config-example.toml`.
- OpenCreator: the Daemon prepares an isolated launcher directory and configuration automatically; do not replace that flow with a source-tree config.

Use absolute `--workdir`, input, subtitle, audio, and output paths when changing the process working directory.

## Commands

| Command | Purpose |
|---|---|
| `subtitle` | Generate source-language, target-language, bilingual, and short vertical subtitles |
| `tts` | Generate TTS audio and optional dubbed video |
| `speech` | Generate one audio file from text or a UTF-8 text file |
| `render-horizontal` | Render landscape subtitle/dubbed videos |
| `render-vertical` | Render portrait subtitle/dubbed videos |
| `cover` | Generate a cover image from a complete text prompt |
| `voices` | List voice codes for `aliyun`, `openai`, or `minimax`; Edge TTS has no CLI voice catalog |
| `pipeline` | Validate output plans with `--dry-run`; non-dry-run execution is unsupported |
| `status` | Reserved and unsupported |

## Manifest

Every working directory should contain:

```text
krillinai_manifest.json
```

Read this file to locate stage outputs. Important default paths:

| Output key | Default path |
|---|---|
| `origin_video` | `<workdir>/origin_video.mp4` |
| `origin_audio` | `<workdir>/origin_audio.mp3` |
| `origin_srt` | `<workdir>/origin_language_srt.srt` |
| `target_srt` | `<workdir>/target_language_srt.srt` |
| `bilingual_srt` | `<workdir>/bilingual_srt.srt` |
| `short_origin_mixed_srt` | `<workdir>/short_origin_mixed_srt.srt` |
| `tts_audio` | `<workdir>/tts_final_audio.wav` |
| `video_with_tts` | `<workdir>/video_with_tts.mp4` |
| `horizontal_video` | `<workdir>/horizontal_bilingual.mp4` |
| `vertical_video` | `<workdir>/vertical_bilingual.mp4` |
| `transferred_vertical_video` | `<workdir>/transferred_vertical_video.mp4` |
| `origin_cover` | `<workdir>/origin_cover.jpg` |
| `generated_cover` | `<workdir>/generated_cover.png` |
| `cover_prompt` | `<workdir>/cover_prompt.final.txt` |

Horizontal and vertical dubbed variants use `horizontal_dubbed.mp4` and `vertical_dubbed.mp4`; their manifest keys remain `horizontal_video` and `vertical_video`.

## JSON Lines

Parse stdout one line at a time as JSON. The terminal response is the object containing `ok`.

When `OPENCREATOR_KRILLINAI_CLI=1`, `subtitle` and `tts` can emit progress frames before the terminal response:

```json
{"type":"progress","phase":"translating_subtitles","percent":50,"message":"正在翻译字幕"}
```

Success shape:

```json
{
  "ok": true,
  "stage": "subtitle",
  "workdir": "tasks/demo",
  "task_id": "demo",
  "outputs": {}
}
```

Failure shape:

```json
{
  "ok": false,
  "error": {
    "kind": "retryable",
    "code": "audio_transcription_failed",
    "message": "connection timeout",
    "retryable": true
  }
}
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Usage error |
| `2` | Retryable error |
| `3` | Dependency error |

Internal errors currently also exit with code `1`, so use `error.kind` rather than the exit code alone for classification.

## Error Handling

- `usage`: fix flags or missing input.
- `retryable`: retry after delay or switch provider/source.
- `dependency`: install or expose `ffmpeg`, `ffprobe`, or `yt-dlp`.
- `internal`: inspect logs and generated files.

## Dry Run

- `subtitle`, `render-horizontal`, `render-vertical`, `speech`, and `pipeline` validate without writing a task manifest.
- `tts` and `cover` dry-runs apply default outputs and write `krillinai_manifest.json`, but do not produce media.
- `voices --dry-run` returns the same local voice list without an external provider call; use `aliyun`, `openai`, or `minimax`.

## Command-Shape Verification

This check does not need provider credentials or media dependencies:

```bash
(cd "$KRILLINAI_CWD" && "$KRILLINAI_CLI" subtitle local:demo.mp4 \
  --origin-lang en \
  --target-lang zh_cn \
  --workdir "$WORKDIR" \
  --dry-run)
```

For rendered media, inspect the output file and optionally extract preview frames with `ffmpeg`.
